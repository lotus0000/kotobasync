from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.api.deps import get_clock, get_db, require_device
from kotobasync.auth.devices import revoke_device
from kotobasync.db.models import Device

router = APIRouter(dependencies=[Depends(require_device)])


class DeviceOut(BaseModel):
    id: str
    name: str
    created_at: int
    last_seen_at: int | None
    revoked_at: int | None
    current: bool


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db), me: Device = Depends(require_device)) -> list[DeviceOut]:
    rows = db.scalars(select(Device).order_by(Device.created_at)).all()
    return [
        DeviceOut(
            id=d.id, name=d.name, created_at=d.created_at, last_seen_at=d.last_seen_at,
            revoked_at=d.revoked_at, current=d.id == me.id,
        )
        for d in rows
    ]


@router.delete("/devices/{device_id}", status_code=204)
def delete_device(
    device_id: str,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
) -> Response:
    if not revoke_device(db, device_id, clock()):
        raise HTTPException(404, "device not found")
    db.commit()
    return Response(status_code=204)
