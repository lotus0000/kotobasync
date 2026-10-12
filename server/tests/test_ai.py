import asyncio
import json

import httpx
import pytest

from kotobasync.enrich.cache import cache_key
from kotobasync.enrich.config import AiConfig
from kotobasync.enrich.openai_compat import OpenAICompatEnricher, parse_enrich_content
from kotobasync.enrich.types import EnrichError

CFG = AiConfig(enrich_mode="auto", llm_base_url="http://llm.test/v1", llm_model="qwen-test", llm_api_key="")
GOOD = {"surface": "食べる", "reading": "たべる", "meaning_zh": "吃", "example_ja": "ご飯を食べる。", "example_zh": "吃饭。"}
GOOD_JSON = json.dumps(GOOD, ensure_ascii=False)


@pytest.mark.parametrize(
    "content",
    [
        GOOD_JSON,
        f"```json\n{GOOD_JSON}\n```",
        f"<think>先想想</think>\n{GOOD_JSON}",
        f"好的：{GOOD_JSON} 以上。",
    ],
)
def test_parse_accepts_common_llm_wrappings(content):
    assert parse_enrich_content(content).reading == "たべる"


@pytest.mark.parametrize(
    "content",
    [
        "不是JSON",
        "{bad json}",
        json.dumps({**GOOD, "reading": "タベル"}),
        json.dumps({**GOOD, "reading": "食べる"}),
        json.dumps({k: v for k, v in GOOD.items() if k != "meaning_zh"}),
    ],
)
def test_parse_rejects_bad_output(content):
    with pytest.raises(EnrichError):
        parse_enrich_content(content)


def test_openai_compat_enricher_calls_chat_completions():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": GOOD_JSON}}]})

    enricher = OpenAICompatEnricher(transport=httpx.MockTransport(handler))
    cfg = AiConfig(enrich_mode="auto", llm_base_url="http://llm.test/v1/", llm_model="qwen-test", llm_api_key="sk-local")
    result = asyncio.run(enricher.enrich(cfg, "食べ", "ご飯を食べた。"))
    assert result.surface == "食べる"
    assert seen["url"] == "http://llm.test/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-local"
    assert seen["body"]["model"] == "qwen-test"
    assert "ご飯を食べた。" in seen["body"]["messages"][-1]["content"]


def test_openai_compat_enricher_omits_auth_header_without_key():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"choices": [{"message": {"content": GOOD_JSON}}]})

    asyncio.run(OpenAICompatEnricher(transport=httpx.MockTransport(handler)).enrich(CFG, "食べ", ""))
    assert seen["auth"] is None


@pytest.mark.parametrize(
    "response",
    [httpx.Response(500, text="boom"), httpx.Response(200, json={"unexpected": True})],
)
def test_openai_compat_enricher_wraps_failures(response):
    enricher = OpenAICompatEnricher(transport=httpx.MockTransport(lambda _r: response))
    with pytest.raises(EnrichError):
        asyncio.run(enricher.enrich(CFG, "x", ""))


def test_openai_compat_lists_models_sorted():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://llm.test/v1/models"
        return httpx.Response(200, json={"data": [{"id": "b"}, {"id": "a"}]})

    assert asyncio.run(OpenAICompatEnricher(transport=httpx.MockTransport(handler)).list_models(CFG)) == ["a", "b"]


def test_cache_key_normalizes_surface_and_depends_on_model():
    assert cache_key("m", "ＡＩ", "") == cache_key("m", " AI ", "")
    assert cache_key("m", "AI", "") != cache_key("n", "AI", "")
    assert cache_key("m", "AI", "a") != cache_key("m", "AI", "b")


PREVIEW = {"surface": "食べ", "sentence": "ご飯を食べた。"}


def test_preview_requires_auth(client):
    assert client.post("/api/enrich/preview", json=PREVIEW).status_code == 401


def test_preview_returns_enrichment_and_caches(client, auth, enricher):
    r1 = client.post("/api/enrich/preview", json=PREVIEW, headers=auth)
    r2 = client.post("/api/enrich/preview", json=PREVIEW, headers=auth)
    assert r1.status_code == 200
    assert r1.json() == r2.json()
    assert r1.json()["reading"] == "てすと"
    assert len(enricher.calls) == 1


def test_preview_disabled_outside_auto_mode(client, auth, enricher):
    client.put("/api/settings/ai", json={"enrich_mode": "external"}, headers=auth)
    assert client.post("/api/enrich/preview", json=PREVIEW, headers=auth).status_code == 204
    assert enricher.calls == []


def test_preview_timeout_returns_504(app, client, auth, enricher):
    app.state.preview_timeout = 0.05
    enricher.delay = 0.5
    assert client.post("/api/enrich/preview", json=PREVIEW, headers=auth).status_code == 504


def test_preview_bad_llm_output_returns_502(client, auth, enricher):
    enricher.error = EnrichError("garbage")
    assert client.post("/api/enrich/preview", json=PREVIEW, headers=auth).status_code == 502


def test_ai_settings_defaults_then_live_update(client, auth, enricher):
    assert client.get("/api/settings/ai", headers=auth).json() == {
        "enrich_mode": "auto",
        "llm_base_url": "http://host.docker.internal:11434/v1",
        "llm_model": "qwen3-coder:30b",
        "has_api_key": False,
    }
    r = client.put("/api/settings/ai", json={"llm_model": "m2", "llm_api_key": "secret-key"}, headers=auth)
    assert r.status_code == 200
    assert r.json()["llm_model"] == "m2"
    assert r.json()["has_api_key"] is True
    assert "secret-key" not in r.text
    client.post("/api/enrich/preview", json={"surface": "猫", "sentence": ""}, headers=auth)
    assert enricher.calls[-1][0] == "m2"


@pytest.mark.parametrize("payload", [{"enrich_mode": "sometimes"}, {"llm_base_url": "ftp://x"}, {"llm_model": ""}])
def test_ai_settings_validation(client, auth, payload):
    assert client.put("/api/settings/ai", json=payload, headers=auth).status_code == 422


def test_ai_models_listing(client, auth, enricher):
    assert client.get("/api/settings/ai/models", headers=auth).json() == {"models": ["m1", "m2"]}
    enricher.models_error = EnrichError("down")
    assert client.get("/api/settings/ai/models", headers=auth).status_code == 502
