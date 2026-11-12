"""Exercise the recovery API with the real planner and controlled provider responses."""

import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import documents, finance, payments
from app.cloud import authenticated
from app.main import app
from app.models import PlanningRequest
from app.planner import solve


def test_recovery_from_ai_evidence_to_replacement_payment(monkeypatch):
    owner, operation_id = str(uuid4()), str(uuid4())
    scenario = {
        "target_kits": 12, "deadline_days": 2,
        "needs": [{"id": "blanket", "name": "Blanket", "category": "shelter", "quantity": 1}],
        "funds": [
            {"id": "shelter", "name": "Shelter fund", "available_cents": 13200, "categories": ["shelter"]},
            {"id": "hygiene", "name": "Hygiene grant", "available_cents": 6000, "categories": ["hygiene"]},
        ],
        "offers": [
            {"id": "first", "supplier": "Summit", "need_id": "blanket", "stock": 12, "unit_cost_cents": 800, "delivery_days": 1},
            {"id": "backup", "supplier": "Backup", "need_id": "blanket", "stock": 20, "unit_cost_cents": 900, "delivery_days": 2},
            {"id": "late", "supplier": "Late", "need_id": "blanket", "stock": 20, "unit_cost_cents": 300, "delivery_days": 5},
        ],
    }
    saved = {
        "operation": {"id": operation_id, "name": "Winter shelter", "revision": 1,
                      "scenario": PlanningRequest.model_validate(scenario).model_dump()},
        "state": finance.empty_state(), "version": 0,
    }
    ai_calls = 0

    def gateway(command, **args):
        nonlocal ai_calls
        if command == "ai_budget":
            ai_calls += 1
            return {}
        assert args["op_id"] == operation_id
        if args["actor_id"] != owner:
            raise HTTPException(404, "Operation not found.")
        if command == "write":
            assert args["expected_revision"] == saved["operation"]["revision"]
            assert args["expected_version"] == saved["version"]
            saved["state"] = deepcopy(args["new_state"])
            saved["version"] += 1
        return deepcopy(saved)

    source = "We delivered eight blankets. The remaining four will not ship."
    ai_payload = {
        "purchase_match": "matches", "reported_total_received": 8, "remaining_delivery": "cancelled",
        "quote": "Invented evidence", "summary": "Eight arrived and the rest were cancelled.",
        "operator_check": "Verify the eight blankets against the receipt.",
    }
    original_httpx = httpx.Client

    def groq_request(request):
        body = json.loads(request.content)
        assert body["model"] == "openai/gpt-oss-120b"
        assert body["response_format"]["json_schema"]["strict"]
        assert json.loads(body["messages"][1]["content"])["ordered_units"] == 12
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ai_payload)}}]})

    class Sandbox:
        def request(self, method, path, body=None, request_id=None):
            unit = {"reference_id": replacement_id, "custom_id": replacement_id,
                    "amount": {"currency_code": "USD", "value": "36.00"}, "payee": {"merchant_id": "MERCHANT"}}
            status = "APPROVED"
            if method == "POST" and path.endswith("/capture"):
                status = "COMPLETED"
                unit["payments"] = {"captures": [{"id": "REPLACEMENTCAPTURE", "status": status, "amount": unit["amount"]}]}
            elif method == "POST":
                assert body["purchase_units"][0]["amount"] == unit["amount"]
                status = "PAYER_ACTION_REQUIRED"
            return {"id": "REPLACEMENTORDER", "status": status, "purchase_units": [unit],
                    "links": [{"rel": "payer-action", "href": "https://www.sandbox.paypal.com/checkoutnow?token=REPLACEMENTORDER"}]}

    monkeypatch.setattr(finance, "gateway", gateway)
    monkeypatch.setattr(payments, "PayPal", Sandbox)
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-120b")
    monkeypatch.delenv("PAYPAL_MERCHANT_ID", raising=False)
    monkeypatch.delenv("PAYPAL_SUPPLIER_MERCHANTS", raising=False)
    monkeypatch.setattr(documents.httpx, "Client", lambda **kwargs: original_httpx(transport=httpx.MockTransport(groq_request), **kwargs))
    monkeypatch.setitem(app.dependency_overrides, authenticated, lambda: SimpleNamespace(user_id=owner))
    client = TestClient(app, client=("recovery-test", 50000))
    root = f"/api/operations/{operation_id}"

    def post(path, body=None):
        response = client.post(root + path, json=body)
        assert response.status_code == 200, response.text
        return response.json()

    initial_plan = solve(finance.effective_scenario(saved["operation"], saved["state"]))
    post("/approve", {
        "expected_revision": 1, "input_digest": initial_plan.input_digest, "request_id": str(uuid4()),
        "purchases": [row.model_dump() for row in initial_plan.purchases],
    })
    original = saved["state"]["purchases"][0]
    original.update(status="paid", order_id="ORIGINALORDER", capture_id="ORIGINALCAPTURE")
    original_id = original["id"]
    purchase = f"/purchases/{original_id}"
    assert client.post(root + purchase + "/short-delivery/analyze", json={"text": source}).status_code == 422
    assert "short_delivery_draft" not in saved["state"]["purchases"][0]

    # Requests are also limited per client minute. Use a fresh client for the next test action.
    client = TestClient(app, client=("recovery-test-second", 50000))
    ai_payload["quote"] = source
    draft = post(purchase + "/short-delivery/analyze", {"text": source})
    assert post(purchase + "/short-delivery/analyze", {"text": source})["id"] == draft["id"]
    assert ai_calls == 2
    assert finance.balances(saved["state"])["shelter"]["spent_cents"] == 9600
    assert not saved["state"]["purchases"][0].get("delivery_closed")
    receipt = {
        "request_id": str(uuid4()), "location": "North shelter", "reference": "SO-17",
        "accepted_units": 8, "rejected_units": 0, "close_delivery": True,
        "short_delivery_review": {"expected_revision": 1, "expected_receipts": 0, "analysis_id": draft["id"]},
    }
    assert post(purchase + "/receipts", receipt)["short_delivery"]["evidence"]["proposal"]["quote"] == source
    assert len(post(purchase + "/receipts", receipt)["receipts"]) == 1

    saved["state"]["opening"]["shelter"] = 10000
    blocked = post(purchase + "/short-delivery/plan")
    assert blocked["eligible_budget_cents"] == 400
    assert blocked["funding_gap_cents"] == 3200
    assert blocked["ineligible_funds"] == ["Hygiene grant"]
    assert blocked["plan"]["purchases"] == []
    saved["state"]["opening"]["shelter"] = 13200
    preview = post(purchase + "/short-delivery/plan")
    assert (preview["delivered_kits"], preview["projected_kits"]) == (8, 12)
    plan = preview["plan"]
    assert [(row["supplier"], row["quantity"], row["cost_cents"]) for row in plan["purchases"]] == [("Backup", 4, 3600)]
    assert plan["purchases"][0]["allocations"] == [{"fund_id": "shelter", "amount_cents": 3600}]
    approval = {
        "expected_revision": 1, "input_digest": plan["input_digest"], "request_id": str(uuid4()),
        "purchases": plan["purchases"], "replaces_purchase_id": original_id,
    }
    assert client.post(root + "/approve", json={**approval, "replaces_purchase_id": None}).status_code == 409
    assert post("/approve", approval) == post("/approve", approval)
    assert client.post(root + "/approve", json={**approval, "request_id": str(uuid4())}).status_code == 409
    assert len(saved["state"]["purchases"]) == 2
    replacement_id = saved["state"]["purchases"][1]["id"]
    replacement = f"/purchases/{replacement_id}"
    assert saved["state"]["purchases"][1]["replaces_purchase_id"] == original_id
    assert finance.balances(saved["state"])["shelter"]["reserved_cents"] == 3600
    assert post(replacement + "/checkout")["status"] == "awaiting_approval"
    result = post(replacement + "/capture", {"order_id": "REPLACEMENTORDER"})
    assert result["status"] == "paid" and result["capture_id"] == "REPLACEMENTCAPTURE"
    assert finance.balances(saved["state"])["shelter"]["spent_cents"] == 13200
    assert post(purchase + "/short-delivery/plan")["target_units"] == 0
