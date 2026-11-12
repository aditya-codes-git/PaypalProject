from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import assistant, documents, finance
from app.cloud import authenticated
from app.main import app


def test_assistant_only_returns_grounded_drafts_from_an_owned_operation(monkeypatch):
    owner, operation_id, purchase_id = map(str, (uuid4(), uuid4(), uuid4()))
    source = "Northline delivered four hygiene kits to Hillview Hall."
    data = {"version": 1, "operation": {"id": operation_id, "name": "Hillview", "revision": 1, "scenario": {
        "target_kits": 4, "deadline_days": 2, "needs": [], "funds": [], "offers": [],
    }}, "state": {**finance.empty_state(), "purchases": [
        {"id": purchase_id, "supplier": "Northline", "supply_name": "Hygiene kit", "status": "paid",
         "quantity": 4, "capture_id": "INTERNALPAYMENT", "allocations": []},
    ]}}
    seen = []

    def read(op, actor):
        assert str(op) == operation_id
        if actor != owner:
            raise HTTPException(404, "Operation not found.")
        return deepcopy(data)

    def ask(_prompt, context, *_args):
        seen.append(context)
        assert "INTERNALPAYMENT" not in context
        if len(seen) == 6:
            return assistant.AssistantReply(message="Recorded receipt.", action="draft", operation=None, offer=None,
                                            purchase_id=purchase_id, receipt=assistant.ReceiptDraft(
                                                accepted_units=3, rejected_units=1, location="Hillview Hall",
                                                reference=None, short=True, quote=None,
                                            )), {"model": "openai/gpt-oss-120b"}
        return assistant.AssistantReply(message="Review the receipt.", action="delivery", operation=None, offer=None,
                                        purchase_id=purchase_id, receipt=assistant.ReceiptDraft(
                                            accepted_units=4, rejected_units=0, location="Hillview Hall",
                                            reference=None, short=False, quote=source if len(seen) == 2 else "Invented quote."
                                        )), {}

    monkeypatch.setattr(finance, "read", read)
    monkeypatch.setattr(finance, "gateway", lambda command: seen.append(command) if command == "ai_budget" else None)
    monkeypatch.setattr(finance, "write", lambda updated, _actor: data.update(state=deepcopy(updated["state"])))
    monkeypatch.setattr(documents, "ask_groq", ask)
    session = SimpleNamespace(user_id=owner)
    monkeypatch.setitem(app.dependency_overrides, authenticated, lambda: session)
    client = TestClient(app, client=("assistant-test", 50000))
    body = {"operation_id": operation_id, "messages": [{"role": "user", "text": source}]}
    # The shared budget call precedes the model call.
    seen.clear()
    result = client.post("/api/operations/assistant", json=body)
    assert result.status_code == 200
    assert result.json()["purchase_id"] == purchase_id
    assert result.json()["receipt"]["quote"] == source
    assert client.post("/api/operations/assistant", json=body).json()["receipt"] is None
    short = "Northline delivered three hygiene kits to Hillview Hall. The last kit will not ship."
    result = client.post("/api/operations/assistant", json={**body, "messages": [{"role": "user", "text": short}]})
    assert result.status_code == 200
    verified = result.json()
    assert verified["action"] == "delivery" and verified["receipt"]["rejected_units"] is None
    assert verified["short_delivery_draft"]["proposal"]["quote"] == short
    assert verified["short_delivery_draft"]["proposal"]["reported_total_received"] == 3
    session.user_id = str(uuid4())
    assert client.post("/api/operations/assistant", json=body).status_code == 404
    assert len(seen) == 6
    assert not data["state"]["purchases"][0].get("receipts")


def test_closeout_is_blocked_until_receipts_are_complete_and_then_idempotent(monkeypatch):
    owner, operation_id = str(uuid4()), str(uuid4())
    data = {"version": 2, "operation": {"id": operation_id, "revision": 1, "name": "Hillview", "scenario": {
        "target_kits": 4, "needs": [{"id": "hygiene", "name": "Hygiene kit", "quantity": 1}], "funds": [],
    }}, "state": {**finance.empty_state(), "purchases": [
        {"id": str(uuid4()), "need_id": "hygiene", "status": "paid", "quantity": 4, "receipts": []},
    ]}}

    def write(updated, actor):
        assert actor == owner and updated["version"] == data["version"]
        data["version"] += 1
        data["state"] = deepcopy(updated["state"])

    monkeypatch.setattr(finance, "read", lambda *_: deepcopy(data))
    monkeypatch.setattr(finance, "write", write)
    monkeypatch.setitem(app.dependency_overrides, authenticated, lambda: SimpleNamespace(user_id=owner))
    client = TestClient(app, client=("closeout-test", 50000))
    url = f"/api/operations/{operation_id}/closeout"
    assert client.post(url).status_code == 409
    data["state"]["purchases"][0].update(delivery_closed=True, receipts=[{"accepted_units": 4}])
    first = client.post(url)
    assert first.status_code == 200 and first.json()["complete_households"] == 4
    assert first.json()["recorded_at"] == client.post(url).json()["recorded_at"]
    assert data["state"]["events"][0]["kind"] == "closeout_recorded"
