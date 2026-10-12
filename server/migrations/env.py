from alembic import context

from kotobasync.config import Settings
from kotobasync.db.models import Base
from kotobasync.db.session import make_engine

target_metadata = Base.metadata


def run_migrations() -> None:
    engine = make_engine(Settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations()
