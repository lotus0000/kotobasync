import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.auth.tokens import generate_token, hash_token
from kotobasync.db.models import Device

_LAST_SEEN_THROTTLE_MS = 60_000


def create_device(session: Session, name: str, now: int) -> tuple[Device, str]:
    token = generate_token()
    device = Device(
        id=str(uuid.uuid4()),
        name=name.strip()[:64] or "device",
        token_hash=hash_token(token),
        created_at=now,
        last_seen_at=now,
        revoked_at=None,
    )
    session.add(device)
    session.flush()
    return device, token


def authenticate(session: Session, token: str, now: int) -> Device | None:
    device = session.scalars(select(Device).where(Device.token_hash == hash_token(token))).first()
    if device is None or device.revoked_at is not None:
        return None
    if device.last_seen_at is None or now - device.last_seen_at >= _LAST_SEEN_THROTTLE_MS:
        device.last_seen_at = now
    return device


def revoke_device(session: Session, device_id: str, now: int) -> bool:
    device = session.get(Device, device_id)
    if device is None:
        return False
    if device.revoked_at is None:
        device.revoked_at = now
    return True
