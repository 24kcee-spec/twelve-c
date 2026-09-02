import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.routes import assets, auth, businesses, qpd
from app.config import get_settings
from app.core.limiter import limiter

settings = get_settings()
logger = logging.getLogger("twelvec")

app = FastAPI(title="TwelveC API")

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again shortly."})


# IMPORTANT - this is deliberately NOT an @app.exception_handler(Exception).
# FastAPI/Starlette special-cases a handler registered for the bare
# `Exception` class: it gets pulled out to ServerErrorMiddleware, which sits
# OUTSIDE (wraps around) CORSMiddleware. That means a response built by an
# `@app.exception_handler(Exception)` handler never passes back through
# CORSMiddleware, so it never gets an Access-Control-Allow-Origin header -
# which is exactly what showed up as "blocked by CORS policy" in the browser
# even though the server *did* respond, with a real 500.
#
# A regular middleware, added BEFORE CORSMiddleware (Starlette nests
# middleware so the last one added ends up outermost), sits INSIDE
# CORSMiddleware instead. So this catches the exception, logs it, and
# returns a plain JSONResponse - and that response then passes back out
# through CORSMiddleware like any normal response, picking up proper CORS
# headers. The browser will now show a real "500" with a real body in the
# Network tab instead of an opaque CORS block, for any bug that's left.
class CatchAllMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=500,
                content={"detail": "Something went wrong on our end. Please try again."},
            )


app.add_middleware(CatchAllMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(businesses.router, tags=["businesses"])
app.include_router(qpd.router, tags=["qpd-calculations"])
app.include_router(assets.router, tags=["capital-assets"])


@app.get("/")
def root():
    return {"status": "ok"}