import asyncio
import logging
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.config import Settings
from kotobasync.db.models import EnrichJob, Word
from kotobasync.db.seq import next_seq
from kotobasync.enrich.cache import enrich_with_cache
from kotobasync.enrich.config import load_ai_config
from kotobasync.enrich.types import Enricher
from kotobasync.words.service import apply_enrichment

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
BACKOFF_BASE_MS = 30_000


async def process_one(
    session_factory: Callable[[], Session],
    enricher: Enricher,
    settings: Settings,
    clock: Callable[[], int],
) -> bool:
    """Process at most one due job. Returns True if a job was handled (success or failure)."""
    with session_factory() as s:
        cfg = load_ai_config(s, settings)
        if cfg.enrich_mode != "auto":
            return False
        job = s.scalars(
            select(EnrichJob)
            .where(EnrichJob.next_run_at <= clock())
            .order_by(EnrichJob.next_run_at, EnrichJob.word_id)
            .limit(1)
        ).first()
        if job is None:
            return False
        word = s.get(Word, job.word_id)
        if not _still_wanted(word):
            s.delete(job)
            s.commit()
            return True
        word_id, surface, sentence = word.id, word.surface, word.sentence
        try:
            result = await enrich_with_cache(s, enricher, cfg, surface, sentence, clock())
            error = None
        except Exception as exc:  # noqa: BLE001 - any failure is retried with backoff, never fatal
            log.warning("enrichment failed for %s: %s", word_id, exc)
            result, error = None, exc
        # The LLM call takes seconds; requests may have edited, completed or deleted the word meanwhile.
        s.commit()  # keep the cache row
        s.expire_all()
        job = s.get(EnrichJob, word_id)
        word = s.get(Word, word_id)
        if job is None or not _still_wanted(word):
            if job is not None:
                s.delete(job)
            s.commit()
            return True
        if error is not None:
            job.attempts += 1
            job.last_error = str(error)[:500]
            if job.attempts >= MAX_ATTEMPTS:
                word.enrich_status = "failed"
                word.server_seq = next_seq(s)
                s.delete(job)
            else:
                job.next_run_at = clock() + BACKOFF_BASE_MS * 2**job.attempts
            s.commit()
            return True
        apply_enrichment(s, word, result.model_dump(), overwrite=False, fix_surface=True, now=clock())
        s.commit()
        return True


def _still_wanted(word: Word | None) -> bool:
    return (
        word is not None
        and word.deleted_at is None
        and word.merged_into is None
        and word.enrich_status in ("pending", "failed")
    )

async def run_worker(state, idle_seconds: float = 2.0) -> None:
    while True:
        try:
            worked = await process_one(state.session_factory, state.enricher, state.settings, state.clock)
        except Exception:
            log.exception("enrich worker iteration crashed")
            worked = False
        await asyncio.sleep(0 if worked else idle_seconds)
