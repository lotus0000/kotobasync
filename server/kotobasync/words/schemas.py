from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator

from kotobasync.words.normalize import normalize_surface

EditableField = Literal["surface", "reading", "meaning_zh", "example_ja", "example_zh"]
EDITABLE_FIELDS: tuple[str, ...] = get_args(EditableField)


class WordIn(BaseModel):
    surface: str = Field(min_length=1, max_length=64)
    reading: str = Field("", max_length=1000)
    meaning_zh: str = Field("", max_length=1000)
    example_ja: str = Field("", max_length=1000)
    example_zh: str = Field("", max_length=1000)
    sentence: str = Field("", max_length=300)
    source: Literal["chatgpt", "manual"]
    familiarity: int = Field(0, ge=0, le=5)
    user_edited: list[EditableField] = []
    created_at: int = Field(ge=0)
    updated_at: int = Field(ge=0)

    @field_validator("surface")
    @classmethod
    def _surface_not_blank(cls, v: str) -> str:
        if not normalize_surface(v):
            raise ValueError("surface is blank")
        return v


class WordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    surface: str
    surface_norm: str
    reading: str
    meaning_zh: str
    example_ja: str
    example_zh: str
    sentence: str
    source: str
    familiarity: int
    enrich_status: str
    user_edited: list[str]
    created_at: int
    updated_at: int
    deleted_at: int | None
    merged_into: str | None
    server_seq: int


class UpsertOut(BaseModel):
    canonical_id: str
    word: WordOut


class DeleteIn(BaseModel):
    deleted_at: int = Field(ge=0)
