from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text

from kotobasync.db.models import Base
from kotobasync.db.session import make_engine

SERVER_DIR = Path(__file__).resolve().parent.parent


def test_migrations_produce_the_model_schema(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    monkeypatch.setenv("KOTOBA_DATABASE_URL", url)
    cfg = Config(str(SERVER_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
    command.upgrade(cfg, "head")

    engine = make_engine(url)
    with engine.connect() as conn:
        assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []
        index_sql = conn.execute(
            text("SELECT sql FROM sqlite_master WHERE name = 'uq_words_live_surface_reading'")
        ).scalar_one()
    assert "WHERE deleted_at IS NULL AND reading != ''" in index_sql
    engine.dispose()
