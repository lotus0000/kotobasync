from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from kotobasync import __version__

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@router.get("/relogin", include_in_schema=False)
def relogin() -> RedirectResponse:
    """A navigation the PWA's service worker never serves, so Cloudflare Access can re-authenticate."""
    return RedirectResponse("/", status_code=302)
