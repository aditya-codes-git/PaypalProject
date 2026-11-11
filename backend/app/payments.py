"""PayPal sandbox only. Durable intents precede provider side effects."""

import os
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from uuid import UUID, NAMESPACE_URL, uuid5

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from .cloud import UserSession
from . import finance
from .models import Record

router = APIRouter(tags=["PayPal sandbox"])
BASE = "https://api-m.sandbox.paypal.com"


class PayPal:
    def __init__(self):
        if os.getenv("PAYPAL_ENVIRONMENT", "sandbox") != "sandbox":
            raise HTTPException(503, "Only PayPal sandbox is supported.")
        self.client_id = os.getenv("PAYPAL_CLIENT_ID", "")
        self.secret = os.getenv("PAYPAL_CLIENT_SECRET", "")
        if not self.client_id or not self.secret:
            raise HTTPException(503, "PayPal sandbox credentials are missing.")
        self.token = None

    def request(self, method, path, payload=None, request_id=None):
        try:
            with httpx.Client(timeout=25) as client:
                if not self.token:
                    auth = client.post(BASE + "/v1/oauth2/token", auth=(self.client_id, self.secret), data={"grant_type": "client_credentials"})
                    if auth.status_code != 200:
                        raise HTTPException(503, "PayPal sandbox authentication failed. Check the application credentials.")
                    self.token = auth.json()["access_token"]
                headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "Prefer": "return=representation"}
                if request_id:
                    headers["PayPal-Request-Id"] = request_id
                response = client.request(method, BASE + path, headers=headers, json=payload)
        except httpx.RequestError:
            raise HTTPException(503, "PayPal did not confirm the result. Funds remain committed; reconcile before retrying.")
        if response.status_code >= 400:
            # Capture can succeed while its response is lost. Never infer failure from an HTTP error.
            raise HTTPException(502, "PayPal could not confirm this action. Reconcile the purchase; its funding remains protected.")
        try:
            return response.json()
        except ValueError:
            raise HTTPException(502, "PayPal returned an incomplete response. Reconcile the purchase.")


def stable_id(purchase, action):
    return str(uuid5(NAMESPACE_URL, "reliefops:" + purchase["id"] + ":" + action))


def transition(operation_id, owner, purchase_id, change, kind, message):
    for attempt in range(3):
        data = finance.read(operation_id, owner)
        purchase = finance.find_purchase(data, purchase_id)
        change(purchase)
        finance.event(data["state"], owner, kind, message)
        try:
            finance.write(data, owner)
            return purchase
        except HTTPException as error:
            if error.status_code != 409 or attempt == 2:
                raise
    raise HTTPException(409, "Reload the purchase status.")


def mark_unknown(operation_id, owner, purchase_id, action):
    def change(p):
        # Never demote a success already reconciled by another request/webhook.
        if p["status"] not in ("paid", "refunded"):
            p.update(status="refund_unknown" if action == "refund" else "unknown", pending_action=action)
    return transition(operation_id, owner, purchase_id, change, "outcome_unknown", f"Purchase {purchase_id}: {action} outcome requires reconciliation.")


def cents(amount):
    try:
        value = Decimal(amount["value"]) * 100
        if amount["currency_code"] != "USD" or value != value.to_integral_value():
            raise ValueError()
        return int(value)
    except (KeyError, InvalidOperation, ValueError, TypeError):
        raise HTTPException(409, "The provider amount/currency does not match the approved purchase.")


def validate_order(order, purchase):
    units = order.get("purchase_units", [])
    if order.get("id") != purchase["order_id"] or len(units) != 1:
        raise HTTPException(409, "Provider order identity does not match this purchase.")
    unit = units[0]
    if unit.get("custom_id") != purchase["id"] or unit.get("reference_id") != purchase["id"] or cents(unit.get("amount", {})) != purchase["cost_cents"]:
        raise HTTPException(409, "Provider order contents do not match the approved purchase.")
    expected = purchase.get("merchant_id") or purchase.get("resolved_merchant_id")
    actual = unit.get("payee", {}).get("merchant_id")
    if not actual or expected and actual != expected:
        raise HTTPException(409, "Provider recipient does not match the approved sandbox merchant.")
    return unit


def validate_current(data, purchase):
    scenario = data["operation"]["scenario"]
    offer = next((o for o in scenario["offers"] if o["id"] == purchase["offer_id"]), None)
    snapshot = purchase["offer_snapshot"]
    if not offer or not offer["active"] or offer["unit_cost_cents"] != snapshot["unit_cost_cents"] or offer["supplier"] != purchase["supplier"] or offer["need_id"] != purchase["need_id"] or offer["delivery_days"] > scenario["deadline_days"]:
        raise HTTPException(409, "The approved offer changed or is unavailable. Cancel the unsubmitted purchase and replan.")
    committed_stock = sum(p["quantity"] for p in data["state"]["purchases"] if p["offer_id"] == purchase["offer_id"] and p["status"] in finance.COMMITTED)
    if offer["stock"] < committed_stock:
        raise HTTPException(409, "Reported stock no longer covers the approved commitments.")
    category = next((n["category"] for n in scenario["needs"] if n["id"] == purchase["need_id"]), None)
    for allocation in purchase["allocations"]:
        fund = next((f for f in scenario["funds"] if f["id"] == allocation["fund_id"]), None)
        if not fund or not fund.get("confirmed", True) or category not in fund["categories"]:
            raise HTTPException(409, "Funding eligibility changed. Review before payment.")


def public_origin():
    origin = os.getenv("APP_ORIGIN", "http://127.0.0.1:5173").rstrip("/")
    parsed = urlparse(origin)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")):
        raise HTTPException(503, "APP_ORIGIN must be the application HTTPS URL or local loopback URL.")
    return origin


@router.post("/api/operations/{operation_id}/purchases/{purchase_id}/checkout")
def checkout(operation_id: UUID, purchase_id: UUID, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    p = finance.find_purchase(data, purchase_id)
    if p["status"] == "awaiting_approval":
        return p
    if p["status"] != "reserved":
        raise HTTPException(409, "This purchase was already submitted. Reconcile its existing payment.")
    validate_current(data, p)
    if finance.recipient(p["supplier"])[1] != p["recipient_fingerprint"]:
        raise HTTPException(409, "Sandbox merchant configuration changed. Reapprove before payment.")
    p.update(status="creating", pending_action="create", first_submitted_at=finance.now(), submitted_at=finance.now())
    finance.event(data["state"], session.user_id, "checkout_started", f"Creating sandbox checkout for {purchase_id}.")
    finance.write(data, session.user_id)
    return create_order(operation_id, session.user_id, p)


def create_order(operation_id, owner, p):
    origin = public_origin()
    payload = {"intent": "CAPTURE", "purchase_units": [{"reference_id": p["id"], "custom_id": p["id"],
               "description": f"ReliefOps sandbox: {p['supplier']} ({p['quantity']} units)",
               "amount": {"currency_code": "USD", "value": f"{p['cost_cents'] / 100:.2f}"}}],
               "payment_source": {"paypal": {"experience_context": {"shipping_preference": "NO_SHIPPING", "user_action": "PAY_NOW",
                   "return_url": f"{origin}/?operation={operation_id}&purchase={p['id']}&payment=approved",
                   "cancel_url": f"{origin}/?operation={operation_id}&purchase={p['id']}&payment=cancelled"}}}}
    if p["merchant_id"]:
        payload["purchase_units"][0]["payee"] = {"merchant_id": p["merchant_id"]}
    try:
        result = PayPal().request("POST", "/v2/checkout/orders", payload, stable_id(p, "create"))
        candidate = {**p, "order_id": result["id"]}
        unit = validate_order(result, candidate)
        link = next(link["href"] for link in result.get("links", []) if link["rel"] in ("approve", "payer-action"))
        parsed = urlparse(link)
        if parsed.scheme != "https" or parsed.hostname != "www.sandbox.paypal.com":
            raise HTTPException(502, "PayPal returned an unexpected approval URL.")
        def change(current):
            if current["status"] not in ("creating", "unknown"):
                raise HTTPException(409, "Purchase state changed. Reconcile the order.")
            current.update(status="awaiting_approval", order_id=result["id"], approval_url=link,
                           resolved_merchant_id=unit["payee"]["merchant_id"], pending_action=None)
        return transition(operation_id, owner, p["id"], change, "checkout_created", f"Sandbox order {result['id']} awaits buyer approval.")
    except (HTTPException, KeyError, StopIteration):
        mark_unknown(operation_id, owner, p["id"], "create")
        raise HTTPException(503, "Checkout outcome is unresolved. Reconcile this purchase; funding remains reserved.")


class CheckoutReturn(Record):
    order_id: str = Field(pattern=r"^[A-Za-z0-9]{1,32}$")


@router.post("/api/operations/{operation_id}/purchases/{purchase_id}/capture")
def capture(operation_id: UUID, purchase_id: UUID, session: UserSession, checkout_return: CheckoutReturn | None = None):
    data = finance.read(operation_id, session.user_id)
    p = finance.find_purchase(data, purchase_id)
    if checkout_return and checkout_return.order_id != p["order_id"]:
        raise HTTPException(409, "The PayPal return does not match this purchase.")
    if p["status"] in ("paid", "refunded"):
        return p
    if checkout_return and p.get("pending_action") == "capture" and p["status"] in ("capturing", "unknown", "review"):
        return p
    if p["status"] != "awaiting_approval" or not p["order_id"]:
        raise HTTPException(409, "Reconcile the existing payment before submitting a capture.")
    validate_current(data, p)
    provider = PayPal()
    order = provider.request("GET", f"/v2/checkout/orders/{p['order_id']}")
    validate_order(order, p)
    if order.get("status") == "COMPLETED":
        return apply_order(operation_id, session.user_id, p, order)
    if order.get("status") != "APPROVED":
        raise HTTPException(409, "Complete buyer approval in PayPal before capturing this purchase.")
    first_capture = p.get("first_capture_started_at")
    if first_capture and (datetime.now(timezone.utc) - datetime.fromisoformat(first_capture)).total_seconds() > 5 * 3600:
        raise HTTPException(409, "The safe capture retry window passed. Review the existing order manually; funding remains committed.")
    p.update(status="capturing", pending_action="capture", capture_started_at=finance.now(),
             first_capture_started_at=first_capture or finance.now())
    finance.event(data["state"], session.user_id, "capture_started", f"Capturing sandbox order {p['order_id']}.")
    finance.write(data, session.user_id)
    try:
        order = provider.request("POST", f"/v2/checkout/orders/{p['order_id']}/capture", {}, stable_id(p, "capture"))
        return apply_order(operation_id, session.user_id, p, order)
    except HTTPException:
        mark_unknown(operation_id, session.user_id, purchase_id, "capture")
        raise


def apply_order(operation_id, owner, purchase, order):
    unit = validate_order(order, purchase)
    captures = unit.get("payments", {}).get("captures", [])
    if len(captures) > 1:
        raise HTTPException(409, "Multiple captures require manual review; commitment retained.")
    capture_data = captures[0] if captures else None
    if capture_data and cents(capture_data.get("amount", {})) != purchase["cost_cents"]:
        raise HTTPException(409, "Capture amount differs from the approved total.")
    status = "unknown"
    if capture_data and capture_data["status"] == "COMPLETED":
        status = "paid"
    elif capture_data and capture_data["status"] == "REFUNDED":
        status = "refunded"
    elif capture_data and capture_data["status"] == "PENDING":
        status = "unknown"
    elif capture_data and capture_data["status"] in ("DECLINED", "FAILED"):
        status = "failed"
    elif order.get("status") == "VOIDED":
        status = "failed"
    elif order.get("status") in ("CREATED", "PAYER_ACTION_REQUIRED", "APPROVED") and not capture_data:
        status = "awaiting_approval"
    def change(current):
        # Delayed events cannot regress refunded/paid captures back to a pending state.
        if current["status"] == "refunded" or current["status"] in finance.SPENT and status not in ("paid", "refunded"):
            return
        if current["status"] in ("refunding", "refund_unknown") and status != "refunded":
            return
        if current.get("pending_action") == "capture" and status == "awaiting_approval":
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(current.get("first_capture_started_at", current["capture_started_at"]))).total_seconds()
            since_last = (datetime.now(timezone.utc) - datetime.fromisoformat(current["capture_started_at"])).total_seconds()
            # A stale GET while capture is in flight cannot reopen submission.
            if since_last < 60:
                return
            if age > 5 * 3600:
                current["status"] = "review"
                return
        current["status"] = status
        if status == "awaiting_approval":
            current["buyer_approved"] = order.get("status") == "APPROVED"
        if capture_data:
            current["capture_id"] = capture_data["id"]
        current["pending_action"] = None if status in ("paid", "refunded", "failed", "awaiting_approval") else "capture"
    return transition(operation_id, owner, purchase["id"], change, "reconciled", f"Order {purchase['order_id']}: provider reported {status}; previously confirmed outcomes retained.")


@router.post("/api/operations/{operation_id}/purchases/{purchase_id}/reconcile")
def reconcile(operation_id: UUID, purchase_id: UUID, session: UserSession):
    return reconcile_purchase(operation_id, session.user_id, purchase_id)


def reconcile_purchase(operation_id, owner, purchase_id):
    data = finance.read(operation_id, owner)
    p = finance.find_purchase(data, purchase_id)
    if p["status"] in ("reserved", "cancelled", "failed", "refunded"):
        return p
    provider = PayPal()
    if not p["order_id"]:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(p.get("first_submitted_at", p["submitted_at"]))).total_seconds()
        since_last = (datetime.now(timezone.utc) - datetime.fromisoformat(p["submitted_at"])).total_seconds()
        if since_last < 60:
            raise HTTPException(409, "The submission may still be running. Wait a minute, then reconcile.")
        if age > 5 * 3600:
            raise HTTPException(409, "The safe create-order retry window has passed. Review PayPal manually; funding remains reserved.")
        # Claim the retry atomically so overlapping reconciliation requests do not submit together.
        p.update(status="creating", submitted_at=finance.now())
        finance.write(data, owner)
        return create_order(operation_id, owner, p)
    order = provider.request("GET", f"/v2/checkout/orders/{p['order_id']}")
    if p["status"] in ("refunding", "refund_unknown"):
        if p.get("refund_id"):
            result = provider.request("GET", f"/v2/payments/refunds/{p['refund_id']}")
            if result.get("status") == "COMPLETED" and cents(result.get("amount", {})) == p["cost_cents"]:
                return transition(operation_id, owner, p["id"], lambda current: current.update(status="refunded", pending_action=None),
                                  "refunded", f"Full refund confirmed for {p['id']}.")
            if result.get("status") in ("FAILED", "CANCELLED", "DENIED"):
                def fail_same_attempt(current):
                    if current["status"] != "refunded" and current.get("refund_attempt") == p.get("refund_attempt") and current.get("refund_id") == p.get("refund_id"):
                        current.update(status="paid", pending_action=None)
                return transition(operation_id, owner, p["id"], fail_same_attempt,
                                  "refund_failed", f"Refund {p['refund_id']} definitively failed; spent allocation retained.")
        capture_data = provider.request("GET", f"/v2/payments/captures/{p['capture_id']}")
        if capture_data.get("status") == "REFUNDED" and cents(capture_data.get("amount", {})) == p["cost_cents"]:
            return transition(operation_id, owner, p["id"], lambda current: current.update(status="refunded", pending_action=None),
                              "refunded", f"Full capture refund confirmed for {p['id']}.")
        return p  # An uncertain refund retains spent funding until positively confirmed.
    return apply_order(operation_id, owner, p, order)


@router.post("/api/operations/{operation_id}/purchases/{purchase_id}/refund")
def refund(operation_id: UUID, purchase_id: UUID, session: UserSession):
    data = finance.read(operation_id, session.user_id)
    p = finance.find_purchase(data, purchase_id)
    if p["status"] == "refunded":
        return p
    if p["status"] != "paid" or not p["capture_id"]:
        raise HTTPException(409, "Only a confirmed paid purchase can start a full refund. Reconcile pending refunds.")
    p.update(status="refunding", pending_action="refund", refund_started_at=finance.now(), refund_id=None,
             refund_attempt=p.get("refund_attempt", 0) + 1)
    finance.event(data["state"], session.user_id, "refund_started", f"Full sandbox refund requested for {p['id']}.")
    finance.write(data, session.user_id)
    try:
        result = PayPal().request("POST", f"/v2/payments/captures/{p['capture_id']}/refund", {}, stable_id(p, f"refund-{p['refund_attempt']}"))
        if cents(result.get("amount", {})) != p["cost_cents"]:
            raise HTTPException(409, "Unexpected refund amount; review required.")
        def change(current):
            if current["status"] != "refunded" and (result["status"] == "COMPLETED" or current.get("refund_attempt") == p.get("refund_attempt")):
                status = "refunded" if result["status"] == "COMPLETED" else "paid" if result["status"] in ("FAILED", "CANCELLED", "DENIED") else "refunding"
                current.update(refund_id=result["id"], status=status, pending_action=None if status in ("paid", "refunded") else "refund")
        return transition(operation_id, session.user_id, p["id"], change, "refund_response", f"Refund {result['id']}: {result['status']}.")
    except (HTTPException, KeyError):
        mark_unknown(operation_id, session.user_id, p["id"], "refund")
        raise HTTPException(503, "Refund outcome requires reconciliation. Spent funding has not been released.")


@router.post("/api/paypal/webhook")
async def webhook(request: Request):
    webhook_id = os.getenv("PAYPAL_WEBHOOK_ID")
    if not webhook_id:
        raise HTTPException(503, "PayPal webhook verification is not configured.")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Invalid webhook JSON.")
    if not isinstance(body, dict) or not isinstance(body.get("id"), str):
        raise HTTPException(400, "Invalid webhook event.")
    return await run_in_threadpool(process_webhook, body, dict(request.headers), webhook_id)


def process_webhook(body, headers, webhook_id):
    # Verify via PayPal; do not fetch arbitrary certificate URLs from untrusted headers.
    payload = {key: headers.get("paypal-" + key.replace("_", "-"), "")
               for key in ("auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time")}
    if not all(value.strip() for value in payload.values()):
        raise HTTPException(400, "Missing PayPal webhook signature headers.")
    payload.update(webhook_id=webhook_id, webhook_event=body)
    provider = PayPal()
    verified = provider.request("POST", "/v1/notifications/verify-webhook-signature", payload)
    if verified.get("verification_status") != "SUCCESS":
        raise HTTPException(400, "Invalid PayPal webhook signature.")
    order_id = body.get("resource", {}).get("supplementary_data", {}).get("related_ids", {}).get("order_id")
    if body.get("event_type", "").startswith("CHECKOUT.ORDER."):
        order_id = body.get("resource", {}).get("id")
    if not order_id:
        order_id = body.get("resource", {}).get("supplementary_data", {}).get("related_ids", {}).get("capture_id") or body.get("resource", {}).get("id")
    if not order_id or not re.fullmatch(r"[A-Za-z0-9]{1,64}", order_id):
        return {"accepted": True, "matched": False}
    location = finance.gateway("lookup", order_id=order_id)
    if not location:
        return {"accepted": True, "matched": False}
    data = finance.read(location["operation_id"], location["owner_id"])
    if any(e.get("provider_event_id") == body.get("id") for e in data["state"]["events"]):
        return {"accepted": True, "duplicate": True}
    purchase = next(p for p in data["state"]["purchases"] if order_id in (p.get("order_id"), p.get("capture_id"), p.get("refund_id")))
    reconcile_purchase(location["operation_id"], location["owner_id"], purchase["id"])
    # Persist dedup marker only after reconciliation succeeds; failed delivery remains retryable.
    for _ in range(3):
        latest = finance.read(location["operation_id"], location["owner_id"])
        if any(e.get("provider_event_id") == body.get("id") for e in latest["state"]["events"]):
            break
        finance.event(latest["state"], "paypal", "webhook", "Verified PayPal event reconciled from current provider state.")
        latest["state"]["events"][0]["provider_event_id"] = body.get("id")
        try:
            finance.write(latest, location["owner_id"])
            break
        except HTTPException as error:
            if error.status_code != 409:
                raise
    return {"accepted": True, "matched": True}
