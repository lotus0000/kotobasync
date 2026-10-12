from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel, Field, field_validator

from kotobasync.words.normalize import is_hiragana_reading, normalize_surface

if TYPE_CHECKING:
    from kotobasync.enrich.config import AiConfig


class EnrichError(Exception):
    """The LLM call failed or produced unusable output."""


class EnrichResult(BaseModel):
    surface: str = Field(min_length=1, max_length=64)
    reading: str = Field(min_length=1, max_length=1000)
    meaning_zh: str = Field(min_length=1, max_length=1000)
    example_ja: str = Field("", max_length=1000)
    example_zh: str = Field("", max_length=1000)

    @field_validator("surface", "reading", "meaning_zh", "example_ja", "example_zh", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("reading")
    @classmethod
    def _hiragana(cls, v: str) -> str:
        v = normalize_surface(v)
        if not is_hiragana_reading(v):
            raise ValueError("reading must be hiragana")
        return v


class Enricher(Protocol):
    async def enrich(self, cfg: "AiConfig", surface: str, sentence: str) -> EnrichResult: ...

    async def list_models(self, cfg: "AiConfig") -> list[str]: ...
