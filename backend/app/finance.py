"""Authoritative operation commitments, protected by transactional compare-and-swap."""

import hashlib
import os
from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import Field

from .cloud import UserSession, configuration
from .models import PlanningRequest, Purchase, Record
from .planner import solve

router = APIRouter(prefix="/api/operations", tags=["approvals and commitments"])
HELD = {"reserved", "creating", "awaiting_approval", "capturing", "unknown", "review"}
SPENT = {"paid", "refunding", "refund_unknown"}
COMMITTED = HELD | SPENT


def now():
    return datetime.now(timezone.utc).isoformat()


def event(state, actor, kind, message):
    state["events"].insert(0, {"id": str(uuid4()), "at": now(), "actor": actor, "kind": kind, "message": message})


def empty_state():
    return {"opening": {}, "purchases": [], "approvals": [], "events": [], "documents": []}


def gateway(command, **kwargs):
    url, key = configuration()
    secret = os.getenv("RELIEFOPS_SERVER_KEY")
    if not secret:
        raise HTTPException(503, "The financial workspace server credential is not configured.")
    try:
        with httpx.Client(timeout=25) as client:
            response = client.post(url + "/functions/v1/finance-gateway", headers={"apikey": key},
                                   json={"server_key": secret, "command": command, **kwargs})
    except httpx.RequestError:
        raise HTTPException(503, "The financial workspace is unavailable. No commitment has been released; reload before retrying.")
    if response.status_code >= 400:
        code = response.json().get("code", "") if response.headers.get("content-type", "").startswith("application/json") else ""
        if code == "40001":
            raise HTTPException(409, "Operation or commitments changed. Reload and generate a current plan.")
        if code == "P0002":
            raise HTTPException(404, "Operation not found or not accessible.")
        if code == "53000":
            raise HTTPException(429, "The application's daily AI evaluation budget is exhausted. Manual entry remains available.")
        raise HTTPException(503, "The financial database is not ready. Check the migration and server credential.")
    return response.json()


def read(operation_id, owner):
    data = gateway("read", op_id=str(operation_id), actor_id=owner)
    data["state"] = data["state"] or empty_state()
    return data


def write(data, owner, updated_scenario=None):
    validate_state(data["state"])
    return gateway("write", op_id=data["operation"]["id"], actor_id=owner,
                   expected_version=data["version"], expected_revision=data["operation"]["revision"], new_state=data["state"],
                   updated_scenario=updated_scenario)


def balances(state):
    result = {key: {"opening_cents": value, "reserved_cents": 0, "spent_cents": 0, "available_cents": value}
              for key, value in state["opening"].items()}
    for purchase in state["purchases"]:
        if purchase["status"] not in COMMITTED:
            continue
        bucket = "spent_cents" if purchase["status"] in SPENT else "reserved_cents"
        for allocation in purchase["allocations"]:
            fund = result[allocation["fund_id"]]
            fund[bucket] += allocation["amount_cents"]
            fund["available_cents"] -= allocation["amount_cents"]
    return result


def validate_state(state):
    if any(b["available_cents"] < 0 for b in balances(state).values()):
        raise HTTPException(409, "Insufficient uncommitted funding.")
    ids = [p["id"] for p in state["purchases"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate purchase intent.")
    for p in state["purchases"]:
        if sum(a["amount_cents"] for a in p["allocations"]) != p["cost_cents"] or p["cost_cents"] <= 0:
            raise ValueError("Purchase funding arithmetic mismatch.")
    if len(state["purchases"]) > 300 or len(state["events"]) > 3000:
        raise HTTPException(422, "This demo operation reached its history limit. Export it and start a new operation.")


def effective_scenario(operation, state):
    request = PlanningRequest.model_validate(operation["scenario"])
    # Browser-written scenario JSON can never assert a paid/reserved commitment.
    request.committed = {}
    if not state["opening"]:
        return request
    remaining = balances(state)
    for fund in request.funds:
        fund.available_cents = remaining.get(fund.id, {"available_cents": 0})["available_cents"]
    committed_by_offer = {}
    for purchase in state["purchases"]:
        committed = purchase["status"] in COMMITTED
        received = received_units(purchase)
        quantity = purchase["quantity"] if committed and not purchase.get("delivery_closed") else received
        if quantity:
            need = next((n for n in request.needs if n.id == purchase["need_id"]), None)
            if need is None:
                raise HTTPException(409, "Restore the committed supply type before replanning.")
            request.committed[need.id] = request.committed.get(need.id, 0) + quantity
        stock_used = purchase["quantity"] if committed else received
        committed_by_offer[purchase["offer_id"]] = committed_by_offer.get(purchase["offer_id"], 0) + stock_used
    for offer in request.offers:
        offer.stock = max(0, offer.stock - committed_by_offer.get(offer.id, 0))
    return request


def received_units(purchase):
    return sum(receipt["accepted_units"] for receipt in purchase.get("receipts", []))


def recipient(supplier):
    # Controlled sandbox merchant mappings; no arbitrary marketplace payment authorization.
    import json
    try:
        mappings = json.loads(os.getenv("PAYPAL_SUPPLIER_MERCHANTS", "{}"))
        merchant = mappings.get(supplier) or os.getenv("PAYPAL_MERCHANT_ID", "")
        if not isinstance(merchant, str) or len(merchant) > 64:
            raise ValueError()
    except (ValueError, AttributeError):
        raise HTTPException(503, "Check the sandbox merchant mapping configuration.")
    fingerprint = hashlib.sha256((os.getenv("PAYPAL_CLIENT_ID", "") + ":" + merchant).encode()).hexdigest()
    return merchant, fingerprint


class Approve(Record):
    expected_revision: int = Field(ge=1)
    input_digest: str = Field(min_length=64, max_length=64)
    request_id: UUID = Field(strict=False)
    purchases: list[Purchase] = Field(min_length=1, max_length=24)


@router.get("/{operation_id}/finance")
def get_finance(operation_id: UUID, session: UserSession):
    data = read(operation_id, session.user_id)
    return {**data["state"], "version": data["version"], "balances": balances(data["state"])}


@router.post("/{operation_id}/approve")
def approve(operation_id: UUID, approval: Approve, session: UserSession):
    data = read(operation_id, session.user_id)
    state = data["state"]
    previous = next((a for a in state["approvals"] if a["request_id"] == str(approval.request_id)), None)
    if previous:
        return previous
    if data["operation"]["revision"] != approval.expected_revision:
        raise HTTPException(409, "The operation changed. Save and calculate again before approval.")
    if not state["opening"]:
        state["opening"] = {f["id"]: f["available_cents"] for f in data["operation"]["scenario"]["funds"]}
    request = effective_scenario(data["operation"], state)
    plan = solve(request)
    if plan.input_digest != approval.input_digest:
        raise HTTPException(409, "Funding commitments or inputs changed. Generate a fresh plan before approving.")
    if [p.model_dump() for p in plan.purchases] != [p.model_dump() for p in approval.purchases]:
        raise HTTPException(409, "The purchasing selection changed. Calculate and review it again.")
    if plan.status not in ("OPTIMAL", "FEASIBLE") or not plan.purchases:
        raise HTTPException(422, "This plan has no new purchasable supplies.")
    record = {"id": str(uuid4()), "request_id": str(approval.request_id), "input_digest": plan.input_digest,
              "revision": approval.expected_revision, "at": now(), "actor": session.user_id, "plan": plan.model_dump()}
    state["approvals"].append(record)
    for purchase in plan.purchases:
        merchant, fingerprint = recipient(purchase.supplier)
        state["purchases"].append({**purchase.model_dump(), "id": str(uuid4()), "approval_id": record["id"],
                                  "supply_name": next(n.name for n in request.needs if n.id == purchase.need_id),
                                  "status": "reserved", "merchant_id": merchant, "recipient_fingerprint": fingerprint,
                                  "currency": "USD", "created_at": now(), "order_id": None, "capture_id": None,
                                  "approval_url": None, "refund_id": None,
                                  "offer_snapshot": next(o.model_dump() for o in request.offers if o.id == purchase.offer_id)})
    event(state, session.user_id, "approved", f"Approved {len(plan.purchases)} purchases; {plan.total_cost_cents} USD cents reserved.")
    write(data, session.user_id)
    return record


@router.post("/{operation_id}/purchases/{purchase_id}/cancel")
def cancel(operation_id: UUID, purchase_id: UUID, session: UserSession):
    data = read(operation_id, session.user_id)
    purchase = find_purchase(data, purchase_id)
    if purchase["status"] == "cancelled":
        return purchase
    if purchase["status"] != "reserved":
        raise HTTPException(409, "Only an unsubmitted purchase can be cancelled. Reconcile submitted payments; reservations remain protected.")
    purchase["status"] = "cancelled"
    event(data["state"], session.user_id, "cancelled", f"Cancelled unsubmitted purchase {purchase_id}; reservation released.")
    write(data, session.user_id)
    return purchase


def find_purchase(data, purchase_id):
    purchase = next((p for p in data["state"]["purchases"] if p["id"] == str(purchase_id)), None)
    if not purchase:
        raise HTTPException(404, "Purchase not found.")
    return purchase


class FundingAdjustment(Record):
    expected_revision: int = Field(ge=1)
    fund_id: str = Field(min_length=1, max_length=60)
    opening_cents: int = Field(ge=0, le=100_000_000)
    reason: str = Field(min_length=5, max_length=300)


@router.post("/{operation_id}/funding")
def adjust_funding(operation_id: UUID, adjustment: FundingAdjustment, session: UserSession):
    data = read(operation_id, session.user_id)
    if data["operation"]["revision"] != adjustment.expected_revision:
        raise HTTPException(409, "Reload the operation before adjusting funding.")
    if adjustment.fund_id not in {f["id"] for f in data["operation"]["scenario"]["funds"]}:
        raise HTTPException(422, "Save the funding pool first.")
    if not data["state"]["opening"]:
        data["state"]["opening"] = {f["id"]: f["available_cents"] for f in data["operation"]["scenario"]["funds"]}
    data["state"]["opening"][adjustment.fund_id] = adjustment.opening_cents
    event(data["state"], session.user_id, "funding_adjusted", f"Opening allocation for {adjustment.fund_id} set to {adjustment.opening_cents} cents: {adjustment.reason}")
    write(data, session.user_id)
    return balances(data["state"])
