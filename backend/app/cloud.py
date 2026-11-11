"""User-scoped Supabase access. No service-role key and no privileged bypass."""

import os
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field

from .models import PlanningRequest, Record
from .planner import solve

router = APIRouter(prefix="/api/operations", tags=["saved operations"])
bearer = HTTPBearer(auto_error=False)


def configuration() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise HTTPException(503, "Supabase is not configured on the backend.")
    return url, key


def public_configuration():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    return {"supabase": {"url": url, "publishable_key": key} if url and key else None}


class CloudSession:
    def __init__(self, token: str):
        self.url, self.key = configuration()
        self.token = token
        self.user_id = ""

    def request(self, method: str, path: str, **kwargs):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.token}",
                   "Prefer": "return=representation"}
        try:
            with httpx.Client(timeout=20) as client:
                response = client.request(method, self.url + path, headers=headers, **kwargs)
        except httpx.RequestError:
            raise HTTPException(503, "Cannot reach Supabase. Your unsaved edits are still in the workspace.")
        if response.status_code in (401, 403):
            raise HTTPException(response.status_code, "Your session is invalid or does not permit this action. Sign in again.")
        if response.status_code >= 400:
            # Do not reflect provider responses, SQL details, or tokens to the browser.
            raise HTTPException(502, "The database request failed. Check that the ReliefOps schema is installed.")
        try:
            return response.json()
        except ValueError:
            raise HTTPException(502, "Supabase returned an unexpected response.")

    def operation(self, operation_id: UUID):
        rows = self.request("GET", "/rest/v1/operations", params={"id": f"eq.{operation_id}", "select": "*", "limit": "1"})
        if not rows:
            raise HTTPException(404, "Operation not found or not accessible.")
        return rows[0]


def authenticated(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> CloudSession:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Sign in to save or load an operation.")
    session = CloudSession(credentials.credentials)
    user = session.request("GET", "/auth/v1/user")
    try:
        session.user_id = str(UUID(user["id"]))
    except (KeyError, ValueError, TypeError):
        raise HTTPException(401, "Supabase could not verify this user.")
    return session


UserSession = Annotated[CloudSession, Depends(authenticated)]


class OperationDraft(Record):
    name: str = Field(min_length=1, max_length=100)
    scenario: PlanningRequest


class OperationUpdate(OperationDraft):
    expected_revision: int = Field(ge=1)


class RevisionRequest(Record):
    expected_revision: int = Field(ge=1)


@router.get("")
def list_operations(session: UserSession):
    return session.request("GET", "/rest/v1/operations", params={"select": "id,name,revision,updated_at", "order": "updated_at.desc", "limit": "50"})


@router.post("", status_code=201)
def create_operation(draft: OperationDraft, session: UserSession):
    name = draft.name.strip()
    if not name:
        raise HTTPException(422, "Enter an operation name.")
    rows = session.request("POST", "/rest/v1/operations", json={"owner_id": session.user_id, "name": name, "scenario": draft.scenario.model_dump()})
    if not rows:
        raise HTTPException(502, "The operation could not be created.")
    return rows[0]


@router.get("/{operation_id}")
def get_operation(operation_id: UUID, session: UserSession):
    operation = session.operation(operation_id)
    plans = session.request("GET", "/rest/v1/operation_plans", params={"operation_id": f"eq.{operation_id}", "select": "id,input_revision,result,scenario,created_at", "order": "created_at.desc", "limit": "20"})
    return {"operation": operation, "plans": plans}


@router.patch("/{operation_id}")
def update_operation(operation_id: UUID, draft: OperationUpdate, session: UserSession):
    name = draft.name.strip()
    if not name:
        raise HTTPException(422, "Enter an operation name.")
    session.operation(operation_id)
    # PostgREST performs this conditional update atomically. The database trigger advances revision.
    rows = session.request("PATCH", "/rest/v1/operations", params={"id": f"eq.{operation_id}", "revision": f"eq.{draft.expected_revision}"},
                           json={"name": name, "scenario": draft.scenario.model_dump()})
    if not rows:
        raise HTTPException(409, "Another tab changed this operation. Reload the saved version before saving again.")
    return rows[0]


@router.post("/{operation_id}/plans", status_code=201)
def calculate_saved_plan(operation_id: UUID, revision: RevisionRequest, session: UserSession):
    operation = session.operation(operation_id)
    if operation["revision"] != revision.expected_revision:
        raise HTTPException(409, "This operation changed before planning. Reload it and try again.")
    try:
        scenario = PlanningRequest.model_validate(operation["scenario"])
    except ValueError:
        raise HTTPException(422, "The saved operation contains unsupported inputs. Correct and save it first.")
    if not any(fund.confirmed for fund in scenario.funds):
        raise HTTPException(422, "Add or confirm funding before building a plan.")
    # Legacy installations can still calculate until the additive finance migration is installed.
    if os.getenv("RELIEFOPS_SERVER_KEY"):
        from .finance import read, effective_scenario
        financial = read(operation_id, session.user_id)
        if financial["operation"]["revision"] != revision.expected_revision:
            raise HTTPException(409, "The operation changed. Reload before planning.")
        scenario = effective_scenario(financial["operation"], financial["state"])
    plan = solve(scenario)
    if os.getenv("RELIEFOPS_SERVER_KEY"):
        plan.finance_version = financial["version"]
    if plan.status not in ("OPTIMAL", "FEASIBLE"):
        raise HTTPException(503, "The solver did not produce a usable plan. Try again or simplify the inputs.")
    rows = session.request("POST", "/rest/v1/operation_plans", json={"operation_id": str(operation_id), "owner_id": session.user_id,
                           "input_revision": operation["revision"], "scenario": operation["scenario"], "result": plan.model_dump()})
    if not rows:
        raise HTTPException(502, "The plan was calculated but could not be saved. No purchase was executed.")
    return rows[0]
