from pathlib import Path

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
)


class SpaStaticFiles(StaticFiles):
    """Serves the built PWA; unknown non-API paths fall back to index.html for client-side routing."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path == "api" or path.startswith("api/"):
                raise
            return await super().get_response("index.html", scope)


def mount_pwa(app: FastAPI, static_dir: str) -> bool:
    root = Path(static_dir)
    if not (root / "index.html").is_file():
        return False
    app.mount("/", SpaStaticFiles(directory=root, html=True), name="pwa")
    return True


async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Content-Security-Policy", CSP)
    return response
