"""Profile data export and explicit self-service account deletion."""

import base64
import json
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field

from . import finance
from .cloud import UserSession
from .models import Record

router = APIRouter(prefix="/api/account", tags=["account settings"])


def account_rows(session, table, order):
    limit = 100
    offset = 0
    while True:
        batch = session.request("GET", f"/rest/v1/{table}", params={
            "select": "*", "owner_id": f"eq.{session.user_id}", "order": order, "limit": str(limit), "offset": str(offset),
        })
        yield from batch
        if len(batch) < limit:
            break
        offset += limit


@router.get("/export")
def export_account(session: UserSession):
    return {"exported_at": finance.now(),
            "operations": list(account_rows(session, "operations", "id.asc")),
            "plans": list(account_rows(session, "operation_plans", "id.asc")),
            "financial_records": list(account_rows(session, "operation_finance", "operation_id.asc"))}


class DeleteAccount(Record):
    email: str = Field(min_length=1, max_length=320)


@router.post("/delete")
def delete_account(request: DeleteAccount, session: UserSession):
    # The dependency verifies the bearer with Supabase before this claim is used.
    try:
        payload = session.token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        session_id = str(UUID(claims["session_id"]))
    except (ValueError, IndexError, KeyError, TypeError, AttributeError):
        raise HTTPException(401, "Sign in again before deleting your account.")
    if request.email.strip().casefold() != session.user_email.casefold():
        raise HTTPException(422, "Enter the email address on your account to confirm deletion.")
    result = finance.gateway("delete_account", actor_id=session.user_id, auth_session_id=session_id,
                             confirmation_email=request.email.strip())
    if result != {"deleted": True}:
        raise HTTPException(503, "Account deletion could not be confirmed. Try again.")
    return result
