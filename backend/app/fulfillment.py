"""Supplier confirmations, delivery receipts and owner-scoped grant reporting."""

from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import Field, StringConstraints

from . import finance
from .cloud import UserSession
from .models import Record

router = APIRouter(prefix="/api/operations", tags=["delivery and reporting"])
Reference = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class SupplierConfirmation(Record):
    supplier_reference: Reference
    invoice_reference: Reference | None = None


class ShortDeliveryReview(Record):
    expected_revision: int = Field(ge=1)
    expected_receipts: int = Field(ge=0, le=20)
    analysis_id: UUID | None = Field(default=None, strict=False)


class Receipt(Record):
    request_id: UUID = Field(strict=False)
    reference: Reference
    location: Reference
    accepted_units: int = Field(ge=0, le=500)
    rejected_units: int = Field(ge=0, le=500)
    close_delivery: bool = False
    short_delivery_review: ShortDeliveryReview | None = None


@router.post("/{operation_id}/purchases/{purchase_id}/supplier-confirmation")
def confirm_supplier(operation_id: UUID, purchase_id: UUID, confirmation: SupplierConfirmation, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    purchase = finance.find_purchase(data, purchase_id)
    if purchase["status"] not in finance.COMMITTED or purchase.get("delivery_closed"):
        raise HTTPException(409, "Supplier details can only change while the purchase is open.")
    details = confirmation.model_dump()
    if purchase.get("supplier_confirmation") != details:
        purchase["supplier_confirmation"] = details
        purchase.pop("short_delivery_draft", None)
        finance.event(data["state"], session.user_id, "supplier_confirmed",
                      f"Recorded supplier confirmation for {purchase['supplier']}.")
        finance.write(data, session.user_id)
    return purchase


@router.post("/{operation_id}/purchases/{purchase_id}/receipts")
def record_receipt(operation_id: UUID, purchase_id: UUID, receipt: Receipt, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    purchase = finance.find_purchase(data, purchase_id)
    receipts = purchase.setdefault("receipts", [])
    payload = receipt.model_dump(mode="json", exclude_none=True)
    previous = next((item for item in receipts if item["request_id"] == payload["request_id"]), None)
    if previous:
        if {key: value for key, value in previous.items() if key != "at"} != payload:
            raise HTTPException(409, "That receipt was already saved with different details.")
        return purchase
    if purchase["status"] != "paid" or purchase.get("delivery_closed"):
        raise HTTPException(409, "Only an open, paid purchase can receive a delivery.")
    if len(receipts) >= 20:
        raise HTTPException(422, "This purchase has reached its receipt limit.")
    remaining = purchase["quantity"] - finance.received_units(purchase)
    quantity = receipt.accepted_units + receipt.rejected_units
    if quantity > remaining or (quantity == 0 and not receipt.close_delivery):
        raise HTTPException(422, "Enter quantities within the outstanding units, or close the delivery.")
    review = receipt.short_delivery_review
    if review:
        if review.expected_revision != data["operation"]["revision"] or review.expected_receipts != len(receipts):
            raise HTTPException(409, "The purchase changed. Review the latest delivery before continuing.")
        if not receipt.close_delivery or receipt.accepted_units >= remaining:
            raise HTTPException(422, "A short delivery must leave units missing.")
        draft = purchase.get("short_delivery_draft")
        evidence = None
        if review.analysis_id:
            if not draft or draft["id"] != str(review.analysis_id) or draft["revision"] != review.expected_revision:
                raise HTTPException(409, "The AI review changed. Reopen the review or enter the delivery manually.")
            if draft["proposal"]["purchase_match"] == "different" or not draft["proposal"]["quote"]:
                raise HTTPException(422, "Use a matching supplier update or enter the delivery manually.")
            evidence = draft
        purchase["short_delivery"] = {"receipt_id": payload["request_id"], "evidence": evidence, "at": finance.now()}
    receipts.append({**payload, "at": finance.now()})
    purchase.pop("short_delivery_draft", None)
    purchase["delivery_closed"] = receipt.close_delivery or receipt.accepted_units == remaining
    finance.event(data["state"], session.user_id, "delivery_recorded",
                  f"Recorded {receipt.accepted_units} accepted and {receipt.rejected_units} rejected units from {purchase['supplier']}."
                  + (" Delivery closed." if purchase["delivery_closed"] else ""))
    finance.write(data, session.user_id)
    return purchase


def closeout_summary(data):
    operation = data["operation"]
    state = data["state"]
    scenario = operation["scenario"]
    received = {}
    for purchase in state["purchases"]:
        need_id = purchase["need_id"]
        received[need_id] = received.get(need_id, 0) + finance.received_units(purchase)
    target = scenario["target_kits"]
    supplies = [
        {"name": need["name"], "required": need["quantity"] * target, "received": received.get(need["id"], 0)}
        for need in scenario["needs"]
    ]
    unsettled = finance.HELD | {"refunding", "refund_unknown"}
    pending = sum(row["status"] in unsettled for row in state["purchases"])
    open_deliveries = sum(row["status"] == "paid" and not row.get("delivery_closed")
                          and finance.received_units(row) < row["quantity"] for row in state["purchases"])
    delivered = min(target, *(received.get(need["id"], 0) // need["quantity"] for need in scenario["needs"]))
    record = state.get("closeout")
    current = bool(record and record["revision"] == operation["revision"] and record["version"] == data["version"])
    return {"households": target, "complete_households": delivered, "pending_payments": pending,
            "open_deliveries": open_deliveries, "supplies": supplies,
            "ready": pending == 0 and open_deliveries == 0 and delivered == target,
            "recorded_at": record["at"] if current else None}


@router.post("/{operation_id}/closeout")
def record_closeout(operation_id: UUID, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    summary = closeout_summary(data)
    if summary["recorded_at"]:
        return summary
    if not summary["ready"]:
        raise HTTPException(409, "Resolve outstanding payments and deliveries before recording closeout.")
    at = finance.now()
    data["state"]["closeout"] = {"at": at, "actor": session.user_id,
                                 "revision": data["operation"]["revision"], "version": data["version"] + 1}
    finance.event(data["state"], session.user_id, "closeout_recorded",
                  f"Recorded closeout with complete supplies delivered for {summary['households']} households.")
    finance.write(data, session.user_id)
    return {**summary, "recorded_at": at}


@router.get("/{operation_id}/funding-report")
def funding_report(operation_id: UUID, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    state = data["state"]
    operation = data["operation"]
    sources = {fund["id"]: fund for fund in operation["scenario"]["funds"]}
    balances = finance.balances(state)
    for fund_id, fund in sources.items():
        if fund_id not in balances:
            opening = 0 if state["opening"] else fund["available_cents"]
            balances[fund_id] = dict(opening_cents=opening, reserved_cents=0, spent_cents=0, available_cents=opening)
    evidence = {
        fund_id: {"filename": doc["filename"], "page": doc["proposals"]["funds"][int(index)]["page"]}
        for doc in state["documents"]
        for index, fund_id in doc.get("fund_links", {}).items()
    }
    needs = {need["id"]: need["name"] for need in operation["scenario"]["needs"]}
    lines = []
    for purchase in state["purchases"]:
        receipts = [{key: item[key] for key in ("location", "accepted_units", "rejected_units", "at")}
                    for item in purchase.get("receipts", [])]
        lines.append({
            "purchase_id": purchase["id"],
            "approval_id": purchase.get("approval_id"),
            "supplier": purchase["supplier"],
            "supply": purchase.get("supply_name") or needs.get(purchase["need_id"], purchase["need_id"]),
            "status": purchase["status"],
            "ordered_units": purchase["quantity"],
            "received_units": finance.received_units(purchase),
            "delivery_closed": purchase.get("delivery_closed", False),
            "replaces_purchase_id": purchase.get("replaces_purchase_id"),
            "receipts": receipts,
            "allocations": purchase["allocations"],
        })
    return {
        "operation": operation["name"], "currency": "USD", "generated_at": finance.now(),
        "closeout": closeout_summary(data),
        "funds": [{"id": key, "name": sources.get(key, {}).get("name", key), **value, "source": evidence.get(key)}
                  for key, value in balances.items()],
        "purchases": lines,
    }
