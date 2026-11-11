from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import PlanningRequest
from app.planner import solve, validate_plan


@pytest.fixture
def payload():
    return {"currency": "USD", "deadline_days": 1, "target_kits": 2,
            "needs": [{"id": "food", "name": "Food", "category": "food", "quantity": 1},
                      {"id": "blanket", "name": "Blanket", "category": "shelter", "quantity": 1}],
            "funds": [{"id": "food-only", "name": "Food grant", "available_cents": 2000, "categories": ["food"]},
                      {"id": "flexible", "name": "Reserve", "available_cents": 1000, "categories": ["food", "shelter"]}],
            "offers": [{"id": "a", "supplier": "A", "need_id": "food", "unit_cost_cents": 1000, "stock": 2, "delivery_days": 1},
                       {"id": "b", "supplier": "B", "need_id": "blanket", "unit_cost_cents": 500, "stock": 2, "delivery_days": 1}]}


def test_protects_flexible_funds(payload):
    request = PlanningRequest.model_validate(payload)
    plan = solve(request)
    assert plan.status == "OPTIMAL"
    assert plan.complete_kits == 2 and plan.total_cost_cents == 3000
    blanket = next(p for p in plan.purchases if p.need_id == "blanket")
    assert [(a.fund_id, a.amount_cents) for a in blanket.allocations] == [("flexible", 1000)]


@pytest.mark.parametrize("change", ["withdrawn", "late", "stock", "unconfirmed", "restricted"])
def test_constraints_prevent_impossible_kits(payload, change):
    if change == "withdrawn": payload["offers"][1]["active"] = False
    if change == "late": payload["offers"][1]["delivery_days"] = 2
    if change == "stock": payload["offers"][1]["stock"] = 0
    if change == "unconfirmed": payload["funds"][1]["confirmed"] = False
    if change == "restricted": payload["funds"][1]["categories"] = ["food"]
    plan = solve(PlanningRequest.model_validate(payload))
    # Zero kits is a valid optimum, not solver INFEASIBLE.
    assert plan.status == "OPTIMAL"
    assert plan.complete_kits == 0 and plan.purchases == []
    assert plan.unmet == {"food": 2, "blanket": 2}


def test_partial_fulfillment_is_complete_kits(payload):
    payload["offers"][1]["stock"] = 1
    plan = solve(PlanningRequest.model_validate(payload))
    assert plan.complete_kits == 1
    assert sum(p.quantity for p in plan.purchases) == 2


def test_minimizes_cost_after_maximizing_kits(payload):
    payload["offers"].append({**payload["offers"][1], "id": "c", "supplier": "C", "unit_cost_cents": 300})
    plan = solve(PlanningRequest.model_validate(payload))
    assert plan.complete_kits == 2
    assert plan.total_cost_cents == 2600
    assert "b" not in [p.offer_id for p in plan.purchases]


def test_replans_when_supplier_withdraws(payload):
    payload["offers"].append({**payload["offers"][1], "id": "c", "supplier": "C", "unit_cost_cents": 600})
    first = solve(PlanningRequest.model_validate(payload))
    payload["offers"][1]["active"] = False
    second = solve(PlanningRequest.model_validate(payload))
    assert first.complete_kits == 2 and second.complete_kits == 1
    assert first.input_digest != second.input_digest
    assert "b" not in [p.offer_id for p in second.purchases]


def test_validator_rejects_tampered_funding(payload):
    request = PlanningRequest.model_validate(payload)
    plan = solve(request)
    blanket = next(p for p in plan.purchases if p.need_id == "blanket")
    blanket.allocations[0].fund_id = "food-only"
    with pytest.raises(ValueError, match="Ineligible"):
        validate_plan(request, plan)


def test_validator_rejects_tampered_quantity(payload):
    request = PlanningRequest.model_validate(payload)
    plan = solve(request)
    plan.purchases[0].quantity += 1
    with pytest.raises(ValueError):
        validate_plan(request, plan)


@pytest.mark.parametrize("mutation", ["duplicate", "unknown", "float", "negative", "currency", "unbounded", "extra"])
def test_rejects_invalid_inputs(payload, mutation):
    if mutation == "duplicate": payload["offers"][1]["id"] = "a"
    if mutation == "unknown": payload["offers"][0]["need_id"] = "missing"
    if mutation == "float": payload["funds"][0]["available_cents"] = 1000.1
    if mutation == "negative": payload["offers"][0]["unit_cost_cents"] = -1
    if mutation == "currency": payload["currency"] = "INR"
    if mutation == "unbounded": payload["target_kits"] = 1000
    if mutation == "extra": payload["offers"][0]["approved"] = True
    with pytest.raises(ValidationError):
        PlanningRequest.model_validate(payload)


def test_small_cases_match_exhaustive_search(payload):
    for budget in (0, 499, 500, 999, 1000):
        for stock in (0, 1, 2):
            case = deepcopy(payload)
            case["funds"][1]["available_cents"] = budget
            case["offers"][1]["stock"] = stock
            plan = solve(PlanningRequest.model_validate(case))
            expected = max(k for k in range(3) if k <= stock and k * 500 <= budget)
            assert plan.complete_kits == expected
            assert plan.total_cost_cents == expected * 1500


def test_api_contract_and_configuration_does_not_leak_secrets(payload, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "private-test-value")
    monkeypatch.delenv("RELIEFOPS_SERVER_KEY", raising=False)
    client = TestClient(app)
    assert client.get("/api/health").json()["payments_enabled"] is False
    config = client.get("/api/integrations")
    assert config.json()["groq"] == {"configured": True, "implemented": True}
    assert "private-test-value" not in config.text
    response = client.post("/api/plan", json=payload)
    assert response.status_code == 200
    assert response.json()["complete_kits"] == 2
    payload["target_kits"] = 0
    assert client.post("/api/plan", json=payload).status_code == 422

