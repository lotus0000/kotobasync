from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.api.deps import get_db, require_device
from kotobasync.db.models import Word
from kotobasync.words.schemas import WordOut

router = APIRouter(dependencies=[Depends(require_device)])


class SyncOut(BaseModel):
    changes: list[WordOut]
    next_seq: int
    has_more: bool


@router.get("/sync", response_model=SyncOut)
def sync(
    since: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> SyncOut:
    rows = db.scalars(
        select(Word).where(Word.server_seq > since).order_by(Word.server_seq).limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return SyncOut(
        changes=[WordOut.model_validate(w) for w in rows],
        next_seq=rows[-1].server_seq if rows else since,
        has_more=has_more,
    )
