import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import cloud
from app.main import app

USER = "11111111-1111-4111-8111-111111111111"
OPERATION = "22222222-2222-4222-8222-222222222222"


@pytest.fixture
def scenario():
    return {"currency": "USD", "deadline_days": 1, "target_kits": 1,
            "needs": [{"id": "food", "name": "Food", "category": "food", "quantity": 1}],
            "funds": [{"id": "grant", "name": "Grant", "available_cents": 1000, "categories": ["food"], "confirmed": True}],
            "offers": [{"id": "offer", "supplier": "Supplier", "need_id": "food", "unit_cost_cents": 1000, "stock": 1, "delivery_days": 1, "active": True}]}


@pytest.fixture
def database(monkeypatch, scenario):
    monkeypatch.delenv("RELIEFOPS_SERVER_KEY", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    state = {"operation": {"id": OPERATION, "owner_id": USER, "name": "Relief", "scenario": scenario, "revision": 1},
             "plans": [], "requests": [], "conflict": False, "pending_payment": False}

    def handler(request):
        state["requests"].append(request)
        assert request.headers["apikey"] == "sb_publishable_test"
        assert request.headers["authorization"].startswith("Bearer ")
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": USER}) if request.headers["authorization"] == "Bearer valid" else httpx.Response(401)
        if request.url.path == "/rest/v1/operations":
            if request.method == "GET":
                requested = request.url.params.get("id")
                return httpx.Response(200, json=[state["operation"]] if not requested or requested == f"eq.{OPERATION}" else [])
            if request.method == "DELETE":
                assert request.url.params["id"] == f"eq.{OPERATION}"
                assert request.url.params["owner_id"] == f"eq.{USER}"
                if state["pending_payment"]:
                    return httpx.Response(400, json={"code": "55000"})
                rows = [{"id": OPERATION}] if request.url.params["revision"] == f'eq.{state["operation"]["revision"]}' else []
                return httpx.Response(200, json=rows)
            data = json.loads(request.content)
            if request.method == "POST":
                assert data["owner_id"] == USER
                state["operation"] = {**state["operation"], **data}
            if request.method == "PATCH":
                if state["conflict"] or request.url.params.get("revision") != f'eq.{state["operation"]["revision"]}':
                    return httpx.Response(200, json=[])
                assert "owner_id" not in data and "revision" not in data
                state["operation"] = {**state["operation"], **data, "revision": state["operation"]["revision"] + 1}
            return httpx.Response(200, json=[state["operation"]])
        if request.url.path == "/rest/v1/operation_plans":
            if request.method == "POST":
                data = json.loads(request.content)
                assert data["owner_id"] == USER and data["operation_id"] == OPERATION
                state["plans"].append(data)
                return httpx.Response(201, json=[data])
            return httpx.Response(200, json=state["plans"])
        raise AssertionError(f"Unexpected request: {request.method} {request.url.path}")

    original = httpx.Client
    monkeypatch.setattr(cloud.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return state


def test_cloud_requires_verified_identity(database):
    client = TestClient(app)
    assert client.get("/api/operations").status_code == 401
    assert database["requests"] == []
    assert client.get("/api/operations", headers={"Authorization": "Bearer forged"}).status_code == 401
    assert len(database["requests"]) == 1


def test_create_update_and_restore_operation(database, scenario):
    client = TestClient(app, headers={"Authorization": "Bearer valid"})
    created = client.post("/api/operations", json={"name": "  Flood response  ", "scenario": scenario})
    assert created.status_code == 201 and created.json()["name"] == "Flood response"
    scenario["target_kits"] = 2
    updated = client.patch(f"/api/operations/{OPERATION}", json={"name": "Revised", "scenario": scenario, "expected_revision": 1})
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    restored = client.get(f"/api/operations/{OPERATION}").json()
    assert restored["operation"]["scenario"]["target_kits"] == 2
    assert restored["plans"] == []


def test_stale_save_and_forged_owner_are_rejected(database, scenario):
    client = TestClient(app, headers={"Authorization": "Bearer valid"})
    database["conflict"] = True
    response = client.patch(f"/api/operations/{OPERATION}", json={"name": "New", "scenario": scenario, "expected_revision": 1})
    assert response.status_code == 409
    assert database["operation"]["name"] == "Relief"
    response = client.post("/api/operations", json={"name": "New", "scenario": scenario, "owner_id": "forged"})
    assert response.status_code == 422


def test_operation_can_be_saved_before_funding_is_confirmed(database, scenario):
    client = TestClient(app, headers={"Authorization": "Bearer valid"})
    scenario["funds"] = []
    created = client.post("/api/operations", json={"name": "Awaiting grant review", "scenario": scenario})
    assert created.status_code == 201
    assert created.json()["scenario"]["funds"] == []
    plan = client.post(f"/api/operations/{OPERATION}/plans", json={"expected_revision": 1})
    assert plan.status_code == 422
    assert plan.json()["detail"] == "Add or confirm funding before building a plan."
    assert database["plans"] == []


def test_inaccessible_operation_returns_not_found(database):
    client = TestClient(app, headers={"Authorization": "Bearer valid"})
    assert client.get("/api/operations/33333333-3333-4333-8333-333333333333").status_code == 404


def test_delete_uses_the_current_revision_and_reports_pending_payments(database):
    client = TestClient(app, headers={"Authorization": "Bearer valid"})
    url = f"/api/operations/{OPERATION}"
    assert client.request("DELETE", url, json={"expected_revision": 2}).status_code == 409
    database["pending_payment"] = True
    pending = client.request("DELETE", url, json={"expected_revision": 1})
    assert pending.status_code == 409 and "pending PayPal" in pending.json()["detail"]
    database["pending_payment"] = False
    assert client.request("DELETE", url, json={"expected_revision": 1}).json() == {"deleted": True}


def test_saved_plan_is_calculated_from_saved_revision(database):
    client = TestClient(app, headers={"Authorization": "Bearer valid"})
    wrong = client.post(f"/api/operations/{OPERATION}/plans", json={"expected_revision": 2})
    assert wrong.status_code == 409 and database["plans"] == []
    response = client.post(f"/api/operations/{OPERATION}/plans", json={"expected_revision": 1})
    assert response.status_code == 201
    result = response.json()
    assert result["result"]["complete_kits"] == 1
    assert result["result"]["total_cost_cents"] == 1000
    assert result["input_revision"] == 1
    assert result["scenario"] == database["operation"]["scenario"]


def test_public_configuration_never_exposes_server_secrets(database, monkeypatch):
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "never-public")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "never-public-paypal")
    response = TestClient(app).get("/api/public-config")
    assert response.status_code == 200
    assert response.json()["supabase"]["publishable_key"] == "sb_publishable_test"
    assert "never-public" not in response.text


def test_network_failure_is_sanitized(database, monkeypatch):
    def fail(*args, **kwargs):
        raise httpx.ConnectError("private provider information")
    monkeypatch.setattr(cloud.httpx, "Client", fail)
    response = TestClient(app).get("/api/operations", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 503
    assert "private provider information" not in response.text
