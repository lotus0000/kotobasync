from collections.abc import Callable, Iterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from kotobasync.auth.devices import authenticate
from kotobasync.config import Settings
from kotobasync.db.models import Device


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def get_clock(request: Request) -> Callable[[], int]:
    return request.app.state.clock


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_device(
    request: Request,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
) -> Device:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    device = authenticate(db, token.strip(), clock())
    if device is None:
        raise HTTPException(401, "invalid or revoked token", headers={"WWW-Authenticate": "Bearer"})
    db.commit()
    return device
