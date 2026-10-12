import asyncio
import contextlib
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker

from kotobasync import __version__
from kotobasync.api import ai_settings, auth, devices, enrich, health, sync, words
from kotobasync.auth.ratelimit import LoginRateLimiter
from kotobasync.clock import now_ms
from kotobasync.config import Settings
from kotobasync.db.models import Base
from kotobasync.db.session import make_engine
from kotobasync.enrich.openai_compat import OpenAICompatEnricher
from kotobasync.enrich.types import Enricher
from kotobasync.enrich.worker import run_worker
from kotobasync.web import mount_pwa, security_headers


def create_app(
    settings: Settings | None = None,
    *,
    enricher: Enricher | None = None,
    clock: Callable[[], int] | None = None,
) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    if settings.auto_create_schema:
        Base.metadata.create_all(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(run_worker(app.state)) if settings.start_worker else None
        yield
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        engine.dispose()

    app = FastAPI(title="KotobaSync", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.settings = settings
    app.state.session_factory = sessionmaker(engine, expire_on_commit=False)
    app.state.clock = clock or now_ms
    app.state.enricher = enricher or OpenAICompatEnricher()
    app.state.login_limiter = LoginRateLimiter()
    app.state.preview_timeout = 3.0

    for module in (health, auth, devices, words, sync, enrich, ai_settings):
        app.include_router(module.router, prefix="/api")

    app.middleware("http")(security_headers)
    if settings.extension_origin:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[settings.extension_origin],
            allow_methods=["GET", "PUT", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "CF-Access-Client-Id", "CF-Access-Client-Secret"],
        )
    mount_pwa(app, settings.static_dir)  # last: the "/" mount must not shadow /api routes
    return app
