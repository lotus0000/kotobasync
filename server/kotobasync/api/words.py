from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from kotobasync.api.deps import get_clock, get_db, require_device
from kotobasync.db.models import Word
from kotobasync.words.schemas import DeleteIn, UpsertOut, WordIn, WordOut
from kotobasync.words.service import delete_word, upsert_word

router = APIRouter(dependencies=[Depends(require_device)])

WordId = Annotated[str, Path(min_length=1, max_length=64)]


@router.put("/words/{word_id}", response_model=UpsertOut)
def put_word(
    word_id: WordId,
    body: WordIn,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
) -> UpsertOut:
    word = upsert_word(db, word_id, body, clock())
    db.commit()
    return UpsertOut(canonical_id=word.id, word=WordOut.model_validate(word))


@router.delete("/words/{word_id}", response_model=UpsertOut, responses={204: {"description": "unknown word"}})
def remove_word(
    word_id: WordId,
    body: DeleteIn,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
):
    word = delete_word(db, word_id, body.deleted_at, clock())
    if word is None:
        return Response(status_code=204)
    db.commit()
    return UpsertOut(canonical_id=word.id, word=WordOut.model_validate(word))


@router.get("/words", response_model=list[WordOut])
def search_words(
    q: str = "",
    familiarity: int | None = Query(None, ge=0, le=5),
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[WordOut]:
    stmt = select(Word).where(Word.deleted_at.is_(None))
    term = q.strip()
    if term:
        stmt = stmt.where(
            or_(
                Word.surface.contains(term, autoescape=True),
                Word.reading.contains(term, autoescape=True),
                Word.meaning_zh.contains(term, autoescape=True),
            )
        )
    if familiarity is not None:
        stmt = stmt.where(Word.familiarity == familiarity)
    if status:
        stmt = stmt.where(Word.enrich_status == status)
    rows = db.scalars(stmt.order_by(Word.created_at.desc(), Word.id).limit(limit).offset(offset)).all()
    return [WordOut.model_validate(w) for w in rows]
