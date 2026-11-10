"""Small, bounded single-process limits for the free single-instance demo."""
import time
from collections import OrderedDict
from threading import BoundedSemaphore

from fastapi import Request
from starlette.responses import JSONResponse

COUNTS = OrderedDict()
SOLVER_SLOTS = BoundedSemaphore(2)


async def limits(request: Request, call_next):
    path = request.url.path
    slot = False
    if path.startswith("/api/"):
        size = request.headers.get("content-length", "0")
        if not size.isdigit() or int(size) > 3_000_000:
            return JSONResponse({"detail": "Request body exceeds the 3 MB limit."}, status_code=413)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 3_000_000:
                return JSONResponse({"detail": "Request body exceeds the 3 MB limit."}, status_code=413)
        request._body = bytes(body)
        if request.method == "POST" and path != "/api/paypal/webhook":
            bucket = "ai" if path.endswith("/documents") else "compute" if path.endswith(("/plan", "/plans", "/approve")) else "write"
            key = (request.client.host if request.client else "unknown", bucket)
            current = time.monotonic()
            recent = [t for t in COUNTS.pop(key, []) if current - t < 60]
            cap = {"ai": 2, "compute": 30, "write": 60}[bucket]
            COUNTS[key] = recent
            while len(COUNTS) > 2000:
                COUNTS.popitem(last=False)
            if len(recent) >= cap:
                return JSONResponse({"detail": "Request limit reached. Try again in a minute."}, status_code=429, headers={"Retry-After": "60"})
            recent.append(current)
            if bucket == "compute":
                slot = SOLVER_SLOTS.acquire(blocking=False)
                if not slot:
                    return JSONResponse({"detail": "The planner is busy. Try again shortly."}, status_code=429)
    try:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response
    finally:
        if slot:
            SOLVER_SLOTS.release()
