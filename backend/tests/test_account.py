import base64
import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app import finance
from app.cloud import authenticated
from app.main import app


def test_delete_uses_the_verified_session_and_explicit_confirmation(monkeypatch):
    owner, session_id = str(uuid4()), str(uuid4())
    encoded = base64.urlsafe_b64encode(json.dumps({"session_id": session_id}).encode()).decode().rstrip("=")
    session = SimpleNamespace(user_id=owner, user_email="owner@example.test", token=f"header.{encoded}.signature")
    calls = []
    monkeypatch.setitem(app.dependency_overrides, authenticated, lambda: session)
    monkeypatch.setattr(finance, "gateway", lambda command, **kwargs: (calls.append((command, kwargs)) or {"deleted": True}))
    client = TestClient(app, client=("account-test", 50000))
    assert client.post("/api/account/delete", json={"email": "someone@example.test"}).status_code == 422
    assert client.post("/api/account/delete", json={"email": session.user_email, "actor_id": str(uuid4())}).status_code == 422
    assert calls == []
    response = client.post("/api/account/delete", json={"email": "Owner@example.test"})
    assert response.json() == {"deleted": True}
    assert calls == [("delete_account", {"actor_id": owner, "auth_session_id": session_id, "confirmation_email": "Owner@example.test"})]
    session.token = "bad-token"
    assert client.post("/api/account/delete", json={"email": session.user_email}).status_code == 401


def test_export_uses_the_owners_rls_session(monkeypatch):
    owner = str(uuid4())
    calls = []

    def request(method, path, *, params):
        assert method == "GET" and params["owner_id"] == f"eq.{owner}"
        calls.append(path)
        return [{"owner_id": owner}]

    monkeypatch.setitem(app.dependency_overrides, authenticated, lambda: SimpleNamespace(user_id=owner, request=request))
    result = TestClient(app).get("/api/account/export")
    assert result.status_code == 200
    assert result.json()["financial_records"] == [{"owner_id": owner}]
    assert calls == ["/rest/v1/operations", "/rest/v1/operation_plans", "/rest/v1/operation_finance"]
