import asyncio
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.api.deps import get_clock, get_db, require_device
from kotobasync.enrich.cache import enrich_with_cache
from kotobasync.enrich.config import load_ai_config
from kotobasync.db.models import Word
from kotobasync.enrich.types import EnrichError, EnrichResult
from kotobasync.words.normalize import is_hiragana_reading, normalize_surface
from kotobasync.words.schemas import UpsertOut, WordOut
from kotobasync.words.service import apply_enrichment, canonical_word, request_enrichment

router = APIRouter(dependencies=[Depends(require_device)])


class PreviewIn(BaseModel):
    surface: str = Field(min_length=1, max_length=64)
    sentence: str = Field("", max_length=300)


@router.post("/enrich/preview", response_model=EnrichResult, responses={204: {"description": "AI preview disabled"}})
async def preview(
    body: PreviewIn,
    request: Request,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
):
    cfg = load_ai_config(db, request.app.state.settings)
    if cfg.enrich_mode != "auto":
        return Response(status_code=204)
    try:
        result = await asyncio.wait_for(
            enrich_with_cache(db, request.app.state.enricher, cfg, body.surface, body.sentence, clock()),
            timeout=request.app.state.preview_timeout,
        )
    except TimeoutError:
        raise HTTPException(504, "enrichment timed out") from None
    except EnrichError as exc:
        raise HTTPException(502, f"enrichment failed: {exc}") from exc
    db.commit()
    return result


WordId = Annotated[str, Path(min_length=1, max_length=64)]


class PendingOut(BaseModel):
    id: str
    surface: str
    reading: str
    meaning_zh: str
    sentence: str
    user_edited: list[str]
    enrich_status: str


class EnrichmentIn(BaseModel):
    surface: str | None = Field(None, max_length=64)
    reading: str | None = Field(None, max_length=1000)
    meaning_zh: str | None = Field(None, max_length=1000)
    example_ja: str | None = Field(None, max_length=1000)
    example_zh: str | None = Field(None, max_length=1000)
    overwrite: bool = False

    @field_validator("reading")
    @classmethod
    def _hiragana(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return v
        v = normalize_surface(v)
        if not is_hiragana_reading(v):
            raise ValueError("reading must be hiragana")
        return v


def _live_word(db: Session, word_id: str) -> Word:
    word = db.get(Word, word_id)
    if word is not None and word.merged_into:
        word = canonical_word(db, word)
    if word is None or word.deleted_at is not None:
        raise HTTPException(404, "word not found")
    return word


@router.get("/enrich/pending", response_model=list[PendingOut])
def pending(
    limit: int = Query(50, ge=1, le=500),
    include_failed: bool = True,
    db: Session = Depends(get_db),
) -> list[PendingOut]:
    statuses = ["pending", "failed"] if include_failed else ["pending"]
    rows = db.scalars(
        select(Word)
        .where(Word.deleted_at.is_(None), Word.enrich_status.in_(statuses))
        .order_by(Word.created_at, Word.id)
        .limit(limit)
    ).all()
    return [PendingOut.model_validate(w, from_attributes=True) for w in rows]


@router.put("/words/{word_id}/enrichment", response_model=UpsertOut)
def put_enrichment(
    word_id: WordId,
    body: EnrichmentIn,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
) -> UpsertOut:
    word = _live_word(db, word_id)
    values = body.model_dump(exclude={"overwrite"}, exclude_none=True)
    result = apply_enrichment(db, word, values, overwrite=body.overwrite, fix_surface=False, now=clock())
    db.commit()
    return UpsertOut(canonical_id=result.id, word=WordOut.model_validate(result))


@router.post("/words/{word_id}/enrich", response_model=UpsertOut)
def retry_enrichment(
    word_id: WordId,
    db: Session = Depends(get_db),
    clock: Callable[[], int] = Depends(get_clock),
) -> UpsertOut:
    word = request_enrichment(db, _live_word(db, word_id), clock())
    db.commit()
    return UpsertOut(canonical_id=word.id, word=WordOut.model_validate(word))
