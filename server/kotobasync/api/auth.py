from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from kotobasync.api.deps import get_clock, get_db
from kotobasync.auth.client_ip import client_ip
from kotobasync.auth.devices import create_device
from kotobasync.auth.passphrase import verify_passphrase

router = APIRouter()


class LoginIn(BaseModel):
    passphrase: str = Field(min_length=1, max_length=200)
    device_name: str = Field(min_length=1, max_length=64)


class LoginOut(BaseModel):
    token: str
    device_id: str


@router.post("/auth/login", response_model=LoginOut)
def login(
    body: LoginIn,
    request: Request,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
) -> LoginOut:
    now = clock()
    limiter = request.app.state.login_limiter
    ip = client_ip(request, request.app.state.settings.trusted_networks)
    if limiter.is_locked(ip, now):
        raise HTTPException(429, "too many failed attempts, try again later")
    ok = verify_passphrase(db, body.passphrase)
    if ok is None:
        raise HTTPException(503, "passphrase not set; run `kotobasync set-passphrase` on the server")
    if not ok:
        limiter.record_failure(ip, now)
        raise HTTPException(401, "invalid passphrase")
    limiter.reset(ip)
    device, token = create_device(db, body.device_name, now)
    db.commit()
    return LoginOut(token=token, device_id=device.id)
