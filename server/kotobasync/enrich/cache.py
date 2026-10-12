import hashlib

from sqlalchemy.orm import Session

from kotobasync.db.models import AiCache
from kotobasync.enrich.config import AiConfig
from kotobasync.enrich.prompt import PROMPT_VERSION
from kotobasync.enrich.types import Enricher, EnrichResult
from kotobasync.words.normalize import normalize_surface


def cache_key(model: str, surface: str, sentence: str) -> str:
    raw = "\x1f".join([model, str(PROMPT_VERSION), normalize_surface(surface), sentence.strip()])
    return hashlib.sha256(raw.encode()).hexdigest()


async def enrich_with_cache(
    session: Session, enricher: Enricher, cfg: AiConfig, surface: str, sentence: str, now: int
) -> EnrichResult:
    """Caller commits. Preview and worker share this, so a previewed word is free to enrich later."""
    key = cache_key(cfg.llm_model, surface, sentence)
    hit = session.get(AiCache, key)
    if hit is not None:
        return EnrichResult.model_validate(hit.result)
    result = await enricher.enrich(cfg, surface, sentence)
    session.merge(AiCache(key=key, result=result.model_dump(), created_at=now))
    return result
