from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from kotobasync.config import Settings
from kotobasync.db.models import Setting

_FIELDS = ("enrich_mode", "llm_base_url", "llm_model", "llm_api_key")
_PREFIX = "ai."


@dataclass(frozen=True)
class AiConfig:
    enrich_mode: str
    llm_base_url: str
    llm_model: str
    llm_api_key: str


def load_ai_config(session: Session, defaults: Settings) -> AiConfig:
    stored = {
        row.key.removeprefix(_PREFIX): row.value
        for row in session.scalars(select(Setting).where(Setting.key.startswith(_PREFIX)))
    }
    return AiConfig(**{f: stored.get(f, getattr(defaults, f)) for f in _FIELDS})


def save_ai_config(session: Session, changes: dict[str, str]) -> None:
    for field, value in changes.items():
        if field not in _FIELDS:
            raise KeyError(field)
        row = session.get(Setting, _PREFIX + field)
        if row is None:
            session.add(Setting(key=_PREFIX + field, value=value))
        else:
            row.value = value
