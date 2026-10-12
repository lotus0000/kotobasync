import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from kotobasync.app import create_app
from kotobasync.config import Settings


class FakeClock:
    def __init__(self, start: int = 1_760_000_000_000) -> None:
        self.t = start

    def __call__(self) -> int:
        return self.t

    def advance(self, ms: int) -> None:
        self.t += ms


class FakeEnricher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.results: dict = {}
        self.error: Exception | None = None
        self.delay = 0.0
        self.models = ["m1", "m2"]
        self.models_error: Exception | None = None
        self.during = None  # callable run mid-call, to simulate requests landing while the LLM thinks

    async def enrich(self, cfg, surface: str, sentence: str):
        from kotobasync.enrich.types import EnrichResult

        self.calls.append((cfg.llm_model, surface, sentence))
        if self.during:
            self.during()
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.results.get(surface) or EnrichResult(surface=surface, reading="てすと", meaning_zh="测试")

    async def list_models(self, cfg) -> list[str]:
        if self.models_error:
            raise self.models_error
        return self.models


@pytest.fixture
def enricher() -> FakeEnricher:
    return FakeEnricher()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        database_url="sqlite://",
        auto_create_schema=True,
        start_worker=False,
        static_dir=str(tmp_path / "static"),
        extension_origin="chrome-extension://testextensionid",
    )


@pytest.fixture
def app(settings, clock, enricher):
    return create_app(settings, clock=clock, enricher=enricher)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


PASSPHRASE = "correct horse battery"


@pytest.fixture
def auth(app, client) -> dict[str, str]:
    from kotobasync.auth.passphrase import set_passphrase

    with app.state.session_factory() as s:
        set_passphrase(s, PASSPHRASE)
        s.commit()
    r = client.post("/api/auth/login", json={"passphrase": PASSPHRASE, "device_name": "pytest"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def new_id() -> str:
    return str(uuid.uuid4())


def word_body(**overrides) -> dict:
    body = {
        "surface": "食べ物", "reading": "", "meaning_zh": "", "example_ja": "", "example_zh": "",
        "sentence": "", "source": "chatgpt", "familiarity": 0, "user_edited": [],
        "created_at": 1_000, "updated_at": 1_000,
    }
    body.update(overrides)
    return body


@pytest.fixture
def put(client, auth):
    def _put(word_id: str, **overrides):
        return client.put(f"/api/words/{word_id}", json=word_body(**overrides), headers=auth)

    return _put


def delete_req(client, auth, word_id: str, ts: int):
    return client.request("DELETE", f"/api/words/{word_id}", json={"deleted_at": ts}, headers=auth)


def live_count(app) -> int:
    from kotobasync.db.models import Word

    with app.state.session_factory() as s:
        return s.scalar(select(func.count()).select_from(Word).where(Word.deleted_at.is_(None)))
