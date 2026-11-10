"""Local planning plus authenticated, owner-scoped saved operations."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .models import Plan, PlanningRequest
from .planner import solve

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from .cloud import public_configuration, router as cloud_router
from .finance import router as finance_router
from .payments import router as payments_router
from .documents import router as documents_router
from .limits import limits

@asynccontextmanager
async def lifespan(app):
    worker = None
    if os.getenv("RELIEFOPS_SERVER_KEY") and os.getenv("RECOVERY_WORKER", "true") == "true":
        from .recovery import start_worker
        worker = start_worker()
    yield
    if worker:
        worker[0].set()
        worker[1].join(timeout=2)


app = FastAPI(title="ReliefOps", version="0.3.0", lifespan=lifespan, description="Evidence, constrained planning, approvals and PayPal sandbox procurement.")
app.middleware("http")(limits)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", os.getenv("APP_ORIGIN", "http://127.0.0.1:5173")],
                   allow_methods=["GET", "POST", "PATCH"], allow_headers=["Content-Type", "Authorization"])
app.include_router(cloud_router)
app.include_router(finance_router)
app.include_router(payments_router)
app.include_router(documents_router)


@app.get("/api/public-config")
def client_configuration():
    return public_configuration()


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "sandbox-procurement", "payments_enabled": bool(os.getenv("RELIEFOPS_SERVER_KEY") and os.getenv("PAYPAL_CLIENT_ID") and os.getenv("PAYPAL_CLIENT_SECRET"))}


@app.get("/api/integrations")
def integrations():
    # Report presence only. A configured key is not evidence of a working integration.
    return {"groq": {"configured": bool(os.getenv("GROQ_API_KEY")), "implemented": True},
            "paypal": {"configured": bool(os.getenv("PAYPAL_CLIENT_ID") and os.getenv("PAYPAL_CLIENT_SECRET")), "implemented": True},
            "supabase": {"configured": bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_PUBLISHABLE_KEY")), "implemented": True}}


@app.post("/api/plan", response_model=Plan)
def generate_plan(request: PlanningRequest):
    return solve(request)


# A single hosted service serves the compiled frontend and API on the same origin.
dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if os.getenv("SERVE_FRONTEND") == "true" and dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")

