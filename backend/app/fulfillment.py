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


class Receipt(Record):
    request_id: UUID = Field(strict=False)
    reference: Reference
    location: Reference
    accepted_units: int = Field(ge=0, le=500)
    rejected_units: int = Field(ge=0, le=500)
    close_delivery: bool = False


@router.post("/{operation_id}/purchases/{purchase_id}/supplier-confirmation")
def confirm_supplier(operation_id: UUID, purchase_id: UUID, confirmation: SupplierConfirmation, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    purchase = finance.find_purchase(data, purchase_id)
    if purchase["status"] not in finance.COMMITTED or purchase.get("delivery_closed"):
        raise HTTPException(409, "Supplier details can only change while the purchase is open.")
    details = confirmation.model_dump()
    if purchase.get("supplier_confirmation") != details:
        purchase["supplier_confirmation"] = details
        finance.event(data["state"], session.user_id, "supplier_confirmed",
                      f"Recorded supplier confirmation for {purchase['supplier']}.")
        finance.write(data, session.user_id)
    return purchase


@router.post("/{operation_id}/purchases/{purchase_id}/receipts")
def record_receipt(operation_id: UUID, purchase_id: UUID, receipt: Receipt, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    purchase = finance.find_purchase(data, purchase_id)
    receipts = purchase.setdefault("receipts", [])
    payload = receipt.model_dump(mode="json")
    previous = next((item for item in receipts if item["request_id"] == payload["request_id"]), None)
    if previous:
        if any(previous[key] != value for key, value in payload.items()):
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
    receipts.append({**payload, "at": finance.now()})
    purchase["delivery_closed"] = receipt.close_delivery or receipt.accepted_units == remaining
    finance.event(data["state"], session.user_id, "delivery_recorded",
                  f"Recorded {receipt.accepted_units} accepted and {receipt.rejected_units} rejected units from {purchase['supplier']}."
                  + (" Delivery closed." if purchase["delivery_closed"] else ""))
    finance.write(data, session.user_id)
    return purchase


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
            "receipts": receipts,
            "allocations": purchase["allocations"],
        })
    return {
        "operation": operation["name"], "currency": "USD", "generated_at": finance.now(),
        "funds": [{"id": key, "name": sources.get(key, {}).get("name", key), **value, "source": evidence.get(key)}
                  for key, value in balances.items()],
        "purchases": lines,
    }
