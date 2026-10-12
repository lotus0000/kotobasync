"""All writes to `words` go through here: LWW, duplicate merging and server_seq assignment."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.db.models import EnrichJob, Word
from kotobasync.db.seq import next_seq
from kotobasync.words.normalize import normalize_surface
from kotobasync.words.schemas import EDITABLE_FIELDS, WordIn

CONTENT_FIELDS = ("surface", "reading", "meaning_zh", "example_ja", "example_zh", "sentence")


def find_live_duplicate(session: Session, surface_norm: str, reading: str, exclude_id: str) -> Word | None:
    if not reading:
        return None
    return session.scalars(
        select(Word).where(
            Word.surface_norm == surface_norm,
            Word.reading == reading,
            Word.deleted_at.is_(None),
            Word.id != exclude_id,
        )
    ).first()


def canonical_word(session: Session, word: Word) -> Word:
    seen = {word.id}
    while word.merged_into:
        target = session.get(Word, word.merged_into)
        if target is None or target.id in seen:
            break
        seen.add(target.id)
        word = target
    return word


def ensure_job(session: Session, word_id: str, now: int, *, reset: bool = False) -> None:
    job = session.get(EnrichJob, word_id)
    if job is None:
        session.add(EnrichJob(word_id=word_id, attempts=0, next_run_at=now))
    elif reset:
        job.attempts = 0
        job.next_run_at = now
        job.last_error = None


def _delete_job(session: Session, word_id: str) -> None:
    job = session.get(EnrichJob, word_id)
    if job is not None:
        session.delete(job)


def _incoming_values(data: WordIn) -> dict[str, Any]:
    return {
        "surface": data.surface.strip(),
        "surface_norm": normalize_surface(data.surface),
        "reading": normalize_surface(data.reading),
        "meaning_zh": data.meaning_zh.strip(),
        "example_ja": data.example_ja.strip(),
        "example_zh": data.example_zh.strip(),
        "sentence": data.sentence.strip(),
        "source": data.source,
        "familiarity": data.familiarity,
        "user_edited": sorted(set(data.user_edited)),
        "updated_at": data.updated_at,
    }


def _set(word: Word, values: dict[str, Any]) -> None:
    for key, value in values.items():
        setattr(word, key, value)


def _snapshot(word: Word) -> dict[str, Any]:
    snap = {f: getattr(word, f) for f in CONTENT_FIELDS}
    snap.update(
        familiarity=word.familiarity,
        user_edited=list(word.user_edited),
        updated_at=word.updated_at,
        enrich_status=word.enrich_status,
    )
    return snap


def _older(a: Word, b: Word) -> bool:
    return (a.created_at, a.id) <= (b.created_at, b.id)


def _settle_status(session: Session, word: Word, now: int, prefer: str | None = None) -> None:
    """Complete words need no AI; incomplete pending words must have a queued job."""
    complete = bool(word.reading and word.meaning_zh)
    if word.enrich_status in ("pending", "failed") and complete:
        word.enrich_status = prefer if prefer in ("done", "manual") else "manual"
        _delete_job(session, word.id)
    elif word.enrich_status in ("done", "manual") and not complete and word.deleted_at is None:
        # A whole-record write from a copy pulled before enrichment blanked AI fields; refill them
        # unless the user cleared them on purpose.
        blanks = {f for f in ("reading", "meaning_zh") if not getattr(word, f)}
        if not blanks <= set(word.user_edited):
            word.enrich_status = "pending"
            ensure_job(session, word.id, now)
    elif word.enrich_status == "pending" and word.deleted_at is None:
        ensure_job(session, word.id, now)


def _absorb(
    session: Session,
    *,
    keep: Word,
    drop: Word,
    now: int,
    keep_values: dict[str, Any] | None = None,
    drop_values: dict[str, Any] | None = None,
) -> Word:
    """Merge `drop` into `keep`.

    `drop` is tombstoned and flushed *before* `keep` changes, so the partial unique index never
    sees two live twins. `keep_values` are newer values for `keep` (applied after the flush);
    `drop_values` override what `drop` contributes (defaults to its current content).
    """
    source = drop_values if drop_values is not None else _snapshot(drop)
    drop.deleted_at = now
    drop.merged_into = keep.id
    _delete_job(session, drop.id)
    session.flush()

    if keep_values:
        _set(keep, keep_values)
    for field in CONTENT_FIELDS:
        if not getattr(keep, field) and source.get(field):
            setattr(keep, field, source[field])
    keep.familiarity = max(keep.familiarity, source.get("familiarity", 0))
    keep.user_edited = sorted(set(keep.user_edited) | set(source.get("user_edited", [])))
    keep.updated_at = max(keep.updated_at, source.get("updated_at", 0), drop.updated_at) + 1
    drop.updated_at = max(drop.updated_at, keep.updated_at)
    _settle_status(session, keep, now, prefer=source.get("enrich_status"))
    drop.server_seq = next_seq(session)
    keep.server_seq = next_seq(session)
    return keep


def upsert_word(session: Session, word_id: str, data: WordIn, now: int) -> Word:
    values = _incoming_values(data)
    existing = session.get(Word, word_id)

    if existing is not None:
        if existing.merged_into:
            return canonical_word(session, existing)
        if data.updated_at <= existing.updated_at:
            return existing
        # Look for a twin *before* touching `existing`, so autoflush can't trip the unique index.
        dup = find_live_duplicate(session, values["surface_norm"], values["reading"], exclude_id=word_id)
        if dup is None:
            _set(existing, {**values, "deleted_at": None})
            _settle_status(session, existing, now)
            existing.server_seq = next_seq(session)
            return existing
        if _older(existing, dup):
            return _absorb(session, keep=existing, drop=dup, now=now, keep_values={**values, "deleted_at": None})
        return _absorb(session, keep=dup, drop=existing, now=now, drop_values=values)

    dup = find_live_duplicate(session, values["surface_norm"], values["reading"], exclude_id=word_id)
    word = Word(id=word_id, created_at=data.created_at, enrich_status="pending", server_seq=0, **values)
    if dup is not None:
        word.deleted_at = now
        session.add(word)
        return _absorb(session, keep=dup, drop=word, now=now)
    session.add(word)
    session.flush()
    _settle_status(session, word, now)
    word.server_seq = next_seq(session)
    return word


def delete_word(session: Session, word_id: str, deleted_at: int, now: int) -> Word | None:
    word = session.get(Word, word_id)
    if word is None:
        return None
    target = canonical_word(session, word)
    if deleted_at <= target.updated_at:
        return target
    target.deleted_at = deleted_at
    target.updated_at = deleted_at
    _delete_job(session, target.id)
    target.server_seq = next_seq(session)
    return target


def apply_enrichment(
    session: Session,
    word: Word,
    values: dict[str, str],
    *,
    overwrite: bool,
    fix_surface: bool,
    now: int,
) -> Word:
    """Write AI / agent output. Fills blanks (or overwrites when asked) but never user-edited fields.

    `fix_surface` lets the local LLM correct a partial selection (食べ → 食べる) even though the
    surface is never blank.
    """
    changes: dict[str, Any] = {}
    for field in EDITABLE_FIELDS:
        value = (values.get(field) or "").strip()
        if not value or field in word.user_edited:
            continue
        if field == "reading":
            value = normalize_surface(value)
        current = getattr(word, field)
        if overwrite or not current or (field == "surface" and fix_surface and value != current):
            changes[field] = value
    if "surface" in changes:
        changes["surface_norm"] = normalize_surface(changes["surface"])
    changes["enrich_status"] = "done"
    changes["updated_at"] = word.updated_at + 1

    _delete_job(session, word.id)
    dup = find_live_duplicate(
        session,
        changes.get("surface_norm", word.surface_norm),
        changes.get("reading", word.reading),
        exclude_id=word.id,
    )
    if dup is None:
        _set(word, changes)
        word.server_seq = next_seq(session)
        return word
    if _older(word, dup):
        return _absorb(session, keep=word, drop=dup, now=now, keep_values=changes)
    return _absorb(session, keep=dup, drop=word, now=now, drop_values={**_snapshot(word), **changes})


def request_enrichment(session: Session, word: Word, now: int) -> Word:
    word.enrich_status = "pending"
    ensure_job(session, word.id, now, reset=True)
    word.updated_at += 1
    word.server_seq = next_seq(session)
    return word
