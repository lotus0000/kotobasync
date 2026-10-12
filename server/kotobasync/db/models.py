from sqlalchemy import JSON, ForeignKey, Index, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    token_hash: Mapped[str] = mapped_column(unique=True)
    created_at: Mapped[int]
    last_seen_at: Mapped[int | None]
    revoked_at: Mapped[int | None]


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str]


class Meta(Base):
    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[int]


class Word(Base):
    __tablename__ = "words"
    __table_args__ = (
        # Two live words may share a surface only if their readings differ (同形異読).
        Index(
            "uq_words_live_surface_reading",
            "surface_norm",
            "reading",
            unique=True,
            sqlite_where=text("deleted_at IS NULL AND reading != ''"),
        ),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    surface: Mapped[str]
    surface_norm: Mapped[str]
    reading: Mapped[str] = mapped_column(default="", server_default="")
    meaning_zh: Mapped[str] = mapped_column(default="", server_default="")
    example_ja: Mapped[str] = mapped_column(default="", server_default="")
    example_zh: Mapped[str] = mapped_column(default="", server_default="")
    sentence: Mapped[str] = mapped_column(default="", server_default="")
    source: Mapped[str]
    familiarity: Mapped[int] = mapped_column(default=0, server_default="0")
    enrich_status: Mapped[str]
    user_edited: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    created_at: Mapped[int]
    updated_at: Mapped[int]
    deleted_at: Mapped[int | None]
    merged_into: Mapped[str | None]
    server_seq: Mapped[int] = mapped_column(index=True)


class EnrichJob(Base):
    __tablename__ = "enrich_jobs"

    word_id: Mapped[str] = mapped_column(ForeignKey("words.id", ondelete="CASCADE"), primary_key=True)
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    next_run_at: Mapped[int] = mapped_column(index=True)
    last_error: Mapped[str | None]


class AiCache(Base):
    __tablename__ = "ai_cache"

    key: Mapped[str] = mapped_column(primary_key=True)
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int]
