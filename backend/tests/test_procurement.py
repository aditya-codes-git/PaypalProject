"""Real PostgreSQL CAS plus provider failure simulations. No live payments or AI calls."""
import base64
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import httpx
import psycopg
from psycopg.types.json import Jsonb
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app

from app import finance, payments, documents, fulfillment
from app.models import PlanningRequest
from app.planner import solve


@pytest.fixture(scope="module")
def database_url():
    base = os.getenv("TEST_DATABASE_URL")
    if not base:
        pytest.skip("Set TEST_DATABASE_URL to a disposable local PostgreSQL server for transaction tests.")
    if "127.0.0.1" not in base and "localhost" not in base:
        pytest.fail("Integration tests require a disposable local database.")
    name = "reliefops_test_" + uuid4().hex
    with psycopg.connect(base, autocommit=True) as connection:
        connection.execute(f'create database "{name}"')
    from psycopg.conninfo import make_conninfo
    url = make_conninfo(base, dbname=name)
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute("""do $$ begin
          if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
          if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
          if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
        end $$;
        create schema auth; create schema extensions;
        create extension pgcrypto with schema extensions;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
        grant usage on schema auth to anon, authenticated;
        grant execute on function auth.uid() to anon, authenticated;
        """)
        connection.execute(Path("database/operations.sql").read_text(encoding="utf-8"))
        connection.execute(Path("database/finance.sql").read_text(encoding="utf-8"))
        connection.execute("insert into reliefops_private.server_credential values(true,%s)", (hashlib.sha256(b"local-server-test").hexdigest(),))
    yield url
    with psycopg.connect(base, autocommit=True) as connection:
        connection.execute(f'drop database "{name}" with (force)')


@pytest.fixture
def workspace(database_url, monkeypatch):
    owner, operation_id = str(uuid4()), str(uuid4())
    scenario = {"currency": "USD", "target_kits": 2, "deadline_days": 1,
        "needs": [{"id": "food", "name": "Food", "category": "food", "quantity": 1}, {"id": "blanket", "name": "Blanket", "category": "shelter", "quantity": 1}],
        "funds": [{"id": "food", "name": "Food only", "available_cents": 2000, "categories": ["food"], "confirmed": True}, {"id": "flex", "name": "Flexible", "available_cents": 1000, "categories": ["food", "shelter"], "confirmed": True}],
        "offers": [{"id": "food", "supplier": "A", "need_id": "food", "stock": 2, "unit_cost_cents": 1000, "delivery_days": 1, "active": True}, {"id": "blanket", "supplier": "B", "need_id": "blanket", "stock": 2, "unit_cost_cents": 500, "delivery_days": 1, "active": True}]}
    with psycopg.connect(database_url) as connection:
        connection.execute("insert into auth.users values(%s)", (owner,))
        connection.execute("insert into public.operations(id,owner_id,name,scenario) values(%s,%s,'Fixture',%s)", (operation_id, owner, Jsonb(scenario)))

    def gateway(command, **kwargs):
        with psycopg.connect(database_url) as connection:
            try:
                return connection.execute("select public.reliefops_finance_command(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    ("local-server-test", command, kwargs.get("op_id"), kwargs.get("actor_id"), kwargs.get("expected_version"), kwargs.get("expected_revision"),
                     Jsonb(kwargs["new_state"]) if kwargs.get("new_state") is not None else None, kwargs.get("order_id"),
                     Jsonb(kwargs["updated_scenario"]) if kwargs.get("updated_scenario") else None)).fetchone()[0]
            except psycopg.errors.SerializationFailure:
                raise HTTPException(409, "Operation changed")
            except psycopg.errors.NoDataFound:
                raise HTTPException(404, "Not accessible")
    monkeypatch.setattr(finance, "gateway", gateway)
    monkeypatch.setenv("PAYPAL_CLIENT_ID", "fixture-app")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "fixture-secret-no-provider-access")
    monkeypatch.setenv("PAYPAL_ENVIRONMENT", "sandbox")
    monkeypatch.setenv("APP_ORIGIN", "http://127.0.0.1:5173")
    monkeypatch.delenv("PAYPAL_SUPPLIER_MERCHANTS", raising=False)
    monkeypatch.delenv("PAYPAL_MERCHANT_ID", raising=False)
    yield SimpleNamespace(id=operation_id, owner=owner, session=SimpleNamespace(user_id=owner), scenario=scenario, db=database_url)
    with psycopg.connect(database_url) as connection:
        connection.execute("delete from auth.users where id=%s", (owner,))


def approval_for(w):
    data = finance.read(w.id, w.owner)
    plan = solve(finance.effective_scenario(data["operation"], data["state"]))
    return finance.Approve(expected_revision=data["operation"]["revision"], input_digest=plan.input_digest,
                           purchases=plan.purchases, request_id=uuid4())


def approved(w):
    request = approval_for(w)
    finance.approve(w.id, request, w.session)
    return finance.read(w.id, w.owner)["state"]["purchases"][0]


def test_closed_short_delivery_replans_only_missing_units_and_preserves_finances(workspace):
    w = workspace
    purchase = approved(w)
    purchase_id = purchase["id"]
    details = fulfillment.SupplierConfirmation(supplier_reference="SO-17", invoice_reference="INV-17")
    fulfillment.confirm_supplier(w.id, purchase_id, details, w.session)
    receipt = fulfillment.Receipt(request_id=uuid4(), reference="RC-1", location="North shelter",
                                  accepted_units=1, rejected_units=1, close_delivery=True)
    with pytest.raises(HTTPException) as error:
        fulfillment.record_receipt(w.id, purchase_id, receipt, w.session)
    assert error.value.status_code == 409
    data = finance.read(w.id, w.owner)
    finance.find_purchase(data, purchase_id)["status"] = "paid"
    finance.write(data, w.owner)
    fulfillment.record_receipt(w.id, purchase_id, receipt, w.session)
    fulfillment.record_receipt(w.id, purchase_id, receipt, w.session)
    with pytest.raises(HTTPException) as conflict:
        fulfillment.record_receipt(w.id, purchase_id, receipt.model_copy(update={"location": "Other shelter"}), w.session)
    assert conflict.value.status_code == 409

    data = finance.read(w.id, w.owner)
    request = finance.effective_scenario(data["operation"], data["state"])
    assert request.committed[purchase["need_id"]] == 1
    assert next(offer.stock for offer in request.offers if offer.id == purchase["offer_id"]) == 0
    report = fulfillment.funding_report(w.id, w.session)
    line = next(row for row in report["purchases"] if row["purchase_id"] == purchase_id)
    assert line["received_units"] == 1 and line["receipts"][0]["location"] == "North shelter"
    assert len(line["receipts"]) == 1 and "reference" not in line["receipts"][0]
    assert sum(fund["spent_cents"] for fund in report["funds"]) == purchase["cost_cents"]
    with pytest.raises(HTTPException) as denied:
        fulfillment.funding_report(w.id, SimpleNamespace(user_id=str(uuid4())))
    assert denied.value.status_code == 404

    finance.find_purchase(data, purchase_id)["status"] = "refunded"
    finance.write(data, w.owner)
    request = finance.effective_scenario(data["operation"], data["state"])
    assert request.committed[purchase["need_id"]] == 1
    assert sum(fund["spent_cents"] for fund in fulfillment.funding_report(w.id, w.session)["funds"]) == 0


def test_concurrent_delivery_receipts_cannot_overcount(workspace, monkeypatch):
    w = workspace
    purchase_id = approved(w)["id"]
    data = finance.read(w.id, w.owner)
    finance.find_purchase(data, purchase_id)["status"] = "paid"
    finance.write(data, w.owner)
    barrier = Barrier(2)
    write = finance.write

    def race(data, owner):
        barrier.wait(timeout=10)
        return write(data, owner)

    monkeypatch.setattr(finance, "write", race)

    def submit(_):
        receipt = fulfillment.Receipt(request_id=uuid4(), reference="RC", location="North shelter",
                                      accepted_units=2, rejected_units=0)
        try:
            fulfillment.record_receipt(w.id, purchase_id, receipt, w.session)
            return 200
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == [200, 409]
    saved = finance.find_purchase(finance.read(w.id, w.owner), purchase_id)
    assert finance.received_units(saved) == 2 and saved["delivery_closed"]


def order(p, status="APPROVED", captured=None):
    unit = {"reference_id": p["id"], "custom_id": p["id"], "amount": {"currency_code": "USD", "value": f"{p['cost_cents']/100:.2f}"}, "payee": {"merchant_id": "MERCHANT"}}
    if captured:
        unit["payments"] = {"captures": [{"id": "CAPTURE", "status": captured, "amount": unit["amount"]}]}
    return {"id": "ORDER", "status": status, "purchase_units": [unit], "links": [{"rel": "payer-action", "href": "https://www.sandbox.paypal.com/checkoutnow?token=ORDER"}]}


def test_approval_idempotency_and_no_double_purchase(workspace):
    w = workspace
    request = approval_for(w)
    first = finance.approve(w.id, request, w.session)
    assert finance.approve(w.id, request, w.session)["id"] == first["id"]
    state = finance.read(w.id, w.owner)["state"]
    assert len(state["purchases"]) == 2
    assert all(b["available_cents"] == 0 for b in finance.balances(state).values())
    plan = solve(finance.effective_scenario(finance.read(w.id, w.owner)["operation"], state))
    assert plan.complete_kits == 2 and plan.purchases == []


def test_true_competing_approvals_reserve_only_once(workspace, monkeypatch):
    w = workspace
    request1, request2 = approval_for(w), approval_for(w)
    barrier = Barrier(2)
    original = finance.write
    def competing_write(data, owner, updated_scenario=None):
        barrier.wait(timeout=10)
        return original(data, owner, updated_scenario)
    monkeypatch.setattr(finance, "write", competing_write)
    def submit(request):
        try:
            finance.approve(w.id, request, w.session)
            return 200
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(2) as pool:
        outcomes = list(pool.map(submit, [request1, request2]))
    assert sorted(outcomes) == [200, 409]
    state = finance.read(w.id, w.owner)["state"]
    assert len(state["purchases"]) == 2
    assert all(b["available_cents"] >= 0 for b in finance.balances(state).values())


def test_cancellation_partial_replan_preserves_other_commitment(workspace):
    w = workspace
    p = approved(w)
    finance.cancel(w.id, p["id"], w.session)
    finance.cancel(w.id, p["id"], w.session)
    data = finance.read(w.id, w.owner)
    plan = solve(finance.effective_scenario(data["operation"], data["state"]))
    assert plan.complete_kits == 2
    assert len(plan.purchases) == 1 and plan.purchases[0].offer_id == p["offer_id"]
    assert len([e for e in data["state"]["events"] if e["kind"] == "cancelled"]) == 1


def test_draft_balance_edit_cannot_replenish_reserved_funds(workspace):
    w = workspace
    approved(w)
    changed = deepcopy(w.scenario)
    for f in changed["funds"]: f["available_cents"] = 999999
    with psycopg.connect(w.db) as connection:
        connection.execute("update public.operations set scenario=%s where id=%s", (Jsonb(changed), w.id))
    data = finance.read(w.id, w.owner)
    assert all(f.available_cents == 0 for f in finance.effective_scenario(data["operation"], data["state"]).funds)
    with pytest.raises(HTTPException):
        finance.adjust_funding(w.id, finance.FundingAdjustment(expected_revision=2, fund_id="food", opening_cents=0, reason="fixture reduction"), w.session)


def test_owner_and_server_credential_boundaries(workspace):
    w = workspace
    approved(w)
    with pytest.raises(HTTPException) as error:
        finance.read(w.id, str(uuid4()))
    assert error.value.status_code == 404
    with psycopg.connect(w.db) as connection:
        connection.execute("set local role authenticated")
        connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(uuid4()),))
        assert connection.execute("select count(*) from public.operation_finance where operation_id=%s", (w.id,)).fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("select public.reliefops_finance_command('wrong','read',%s,%s)", (w.id,w.owner))
    with psycopg.connect(w.db) as connection:
        connection.execute("set local role authenticated")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("update public.operation_finance set state='{}' where operation_id=%s", (w.id,))


def test_capture_timeout_retains_reservation_and_reconciles_success(workspace, monkeypatch):
    w = workspace
    p = approved(w)
    monkeypatch.setattr(payments.PayPal, "request", lambda self, method, path, payload=None, request_id=None: order(p))
    payments.checkout(w.id, p["id"], w.session)
    def provider(self, method, path, payload=None, request_id=None):
        if method == "POST": raise HTTPException(503, "lost response after capture")
        return order(p)
    monkeypatch.setattr(payments.PayPal, "request", provider)
    with pytest.raises(HTTPException): payments.capture(w.id, p["id"], w.session)
    data = finance.read(w.id,w.owner)
    current = finance.find_purchase(data,p["id"])
    assert current["status"] == "unknown"
    assert finance.balances(data["state"])[current["allocations"][0]["fund_id"]]["reserved_cents"] > 0
    monkeypatch.setattr(payments.PayPal, "request", lambda *args, **kwargs: order(p, "COMPLETED", "COMPLETED"))
    assert payments.reconcile_purchase(w.id,w.owner,p["id"])["status"] == "paid"
    assert payments.capture(w.id,p["id"],w.session)["status"] == "paid"


def test_stale_order_cannot_reopen_active_capture(workspace, monkeypatch):
    w = workspace
    p = approved(w)
    p = payments.transition(w.id,w.owner,p["id"],lambda p: p.update(order_id="ORDER",status="capturing",pending_action="capture",capture_started_at=finance.now()),"test","fixture")
    assert payments.apply_order(w.id,w.owner,p,order(p))["status"] == "capturing"


def test_failed_refund_keeps_spent_funding_and_terminal_refund_does_not_regress(workspace, monkeypatch):
    w = workspace
    p = approved(w)
    payments.transition(w.id,w.owner,p["id"],lambda p: p.update(order_id="ORDER",capture_id="CAPTURE",status="paid"),"test","fixture")
    result = {"id":"REFUND", "status":"FAILED", "amount":{"currency_code":"USD","value":f"{p['cost_cents']/100:.2f}"}}
    monkeypatch.setattr(payments.PayPal,"request",lambda *args,**kwargs: result)
    assert payments.refund(w.id,p["id"],w.session)["status"] == "paid"
    result["status"] = "COMPLETED"
    assert payments.refund(w.id,p["id"],w.session)["status"] == "refunded"
    assert payments.apply_order(w.id,w.owner,{**p,"order_id":"ORDER"},order(p,"COMPLETED","COMPLETED"))["status"] == "refunded"


def test_unknown_create_retry_window_does_not_extend(workspace, monkeypatch):
    w = workspace
    p = approved(w)
    long_ago=(datetime.now(timezone.utc)-timedelta(hours=6)).isoformat()
    payments.transition(w.id,w.owner,p["id"],lambda p: p.update(status="unknown",pending_action="create",first_submitted_at=long_ago,submitted_at=long_ago),"test","fixture")
    monkeypatch.setattr(payments.PayPal,"request",lambda *a,**k: pytest.fail("must not retry an expired idempotency window"))
    with pytest.raises(HTTPException) as error: payments.reconcile_purchase(w.id,w.owner,p["id"])
    assert error.value.status_code == 409


def test_amount_and_recipient_mismatch_are_rejected(workspace):
    p = approved(workspace)
    p.update(order_id="ORDER", merchant_id="EXPECTED")
    with pytest.raises(HTTPException): payments.validate_order(order(p),p)
    p["merchant_id"]="MERCHANT"
    invalid=order(p); invalid["purchase_units"][0]["amount"]["value"]="0.01"
    with pytest.raises(HTTPException): payments.validate_order(invalid,p)


def test_evidence_confirmation_is_atomic_and_idempotent(workspace,monkeypatch):
    w=workspace
    text="Emergency grant: USD 100 for food only."
    proposal={"funds":[{"name":"Food aid","amount_cents":10000,"categories":["food"],"quote":text,"page":1,"requires_review":False,"warnings":[]}],"warnings":[]}
    monkeypatch.setattr(documents,"extract",lambda pages,categories:(proposal,{"model":"fixture","usage":{}}))
    doc=documents.upload(w.id,documents.DocumentInput(filename="grant.txt",content_base64=base64.b64encode(text.encode()).decode()),w.session)
    assert not finance.read(w.id,w.owner)["state"]["opening"]
    confirm=documents.ConfirmProposal(expected_revision=1,proposal_index=0,name="Food aid",amount_cents=10000,categories=["food"],acknowledge_review=True)
    result=documents.confirm(w.id,doc["id"],confirm,w.session)
    assert result["operation"]["revision"]==2
    confirm.expected_revision=2
    assert documents.confirm(w.id,doc["id"],confirm,w.session)["already_confirmed"]
    data=finance.read(w.id,w.owner)
    assert len(data["operation"]["scenario"]["funds"])==3
    assert data["state"]["documents"][0]["confirmed"]==[0]
    fund = next(row for row in fulfillment.funding_report(w.id, w.session)["funds"] if row["id"] == result["fund"]["id"])
    assert fund["source"] == {"filename": "grant.txt", "page": 1}


def test_ai_rejects_fabricated_source_and_handles_rate_limit(monkeypatch):
    original=httpx.Client
    monkeypatch.setenv("GROQ_API_KEY","fixture")
    payload={"funds":[{"name":"Fake","amount_cents":100,"categories":["food"],"quote":"invented quotation","page":1,"requires_review":False,"warnings":[]}],"warnings":[]}
    response=httpx.Response(200,json={"choices":[{"message":{"content":json.dumps(payload)}}]})
    monkeypatch.setattr(documents.httpx,"Client",lambda **kwargs:original(transport=httpx.MockTransport(lambda r:response),**kwargs))
    with pytest.raises(HTTPException) as error: documents.extract(["Actual source text"],["food"])
    assert error.value.status_code==422
    response=httpx.Response(429)
    with pytest.raises(HTTPException) as error: documents.extract(["Actual source text"],["food"])
    assert error.value.status_code==429


def test_verified_webhooks_deduplicate_and_delayed_events_cannot_regress_payment(workspace, monkeypatch):
    w = workspace
    p = approved(w)
    payments.transition(w.id,w.owner,p["id"],lambda p: p.update(status="capturing",order_id="ORDER",pending_action="capture",capture_started_at=finance.now()),"test","fixture")
    monkeypatch.setenv("PAYPAL_WEBHOOK_ID","fixture-webhook")
    provider_order = order(p,"COMPLETED","COMPLETED")
    def provider(self,method,path,payload=None,request_id=None):
        return {"verification_status":"SUCCESS"} if "verify-webhook" in path else provider_order
    monkeypatch.setattr(payments.PayPal,"request",provider)
    body={"id":"EVENT1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"supplementary_data":{"related_ids":{"order_id":"ORDER"}}}}
    client=TestClient(app)
    assert client.post('/api/paypal/webhook',json=body).status_code==400
    headers = {f"paypal-{key}": "fixture" for key in
               ("auth-algo", "cert-url", "transmission-id", "transmission-sig", "transmission-time")}
    assert client.post('/api/paypal/webhook',json=body,headers=headers).status_code==200
    assert client.post('/api/paypal/webhook',json=body,headers=headers).json()["duplicate"]
    provider_order=order(p,"APPROVED")
    body["id"]="EVENT2"
    assert client.post('/api/paypal/webhook',json=body,headers=headers).status_code==200
    assert finance.find_purchase(finance.read(w.id,w.owner),p["id"])["status"]=="paid"
    monkeypatch.setattr(payments.PayPal,"request",lambda *a,**k:{"verification_status":"FAILURE"})
    assert client.post('/api/paypal/webhook',json=body,headers=headers).status_code==400


def test_stale_and_forged_approval_are_rejected(workspace):
    w=workspace
    approval=approval_for(w)
    approval.purchases[0].quantity+=1
    with pytest.raises(HTTPException) as error: finance.approve(w.id,approval,w.session)
    assert error.value.status_code==409
    approval=approval_for(w); approval.expected_revision+=1
    with pytest.raises(HTTPException) as error: finance.approve(w.id,approval,w.session)
    assert error.value.status_code==409
    assert finance.read(w.id,w.owner)["state"]["purchases"]==[]


def test_old_refund_failure_does_not_reopen_new_refund(workspace, monkeypatch):
    w=workspace
    p=approved(w)
    payments.transition(w.id,w.owner,p["id"],lambda p:p.update(status="refunding",refund_attempt=1,refund_id="REFUND1",order_id="ORDER",capture_id="CAPTURE"),"test","fixture")
    def provider(self,method,path,payload=None,request_id=None):
        if 'refunds/REFUND1' in path:
            payments.transition(w.id,w.owner,p["id"],lambda p:p.update(status="refunding",refund_attempt=2,refund_id="REFUND2"),"test","concurrent new attempt")
            return {"status":"FAILED"}
        return order(p,"COMPLETED","COMPLETED")
    monkeypatch.setattr(payments.PayPal,"request",provider)
    result=payments.reconcile_purchase(w.id,w.owner,p["id"])
    assert result["status"]=="refunding" and result["refund_attempt"]==2


def test_recovery_rotates_unresolved_purchases_fairly(workspace):
    w=workspace
    p=approved(w)
    data=finance.read(w.id,w.owner)
    old=(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat()
    # Cancel originals; create twelve small unresolved commitments within existing balances.
    for original in data["state"]["purchases"]: original["status"]="cancelled"
    for i in range(12):
        copy=deepcopy(p); copy.update(id=str(uuid4()),quantity=1,cost_cents=1,status="unknown",created_at=old,submitted_at=old,allocations=[{"fund_id":"food","amount_cents":1}])
        data["state"]["purchases"].append(copy)
    finance.write(data,w.owner)
    first=finance.gateway('pending')
    assert len(first)==10
    for item in first:
        data=finance.read(w.id,w.owner)
        finance.find_purchase(data,item["purchase_id"])["last_reconciled_at"]=finance.now()
        finance.write(data,w.owner)
    second=finance.gateway('pending')
    assert len(second)==2
    assert not {p["purchase_id"] for p in first} & {p["purchase_id"] for p in second}
