import json
import re

import httpx
from pydantic import ValidationError

from kotobasync.enrich.config import AiConfig
from kotobasync.enrich.prompt import build_messages
from kotobasync.enrich.types import EnrichError, EnrichResult

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


def parse_enrich_content(content: str) -> EnrichResult:
    """Pull the first JSON object out of chatty / fenced / <think>-prefixed model output."""
    text = _THINK.sub("", content).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise EnrichError("no JSON object in LLM output")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise EnrichError(f"invalid JSON from LLM: {exc}") from exc
    try:
        return EnrichResult.model_validate(data)
    except ValidationError as exc:
        raise EnrichError(f"unusable enrichment: {exc.errors()[0]['msg']}") from exc


class OpenAICompatEnricher:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, timeout: float = 60.0) -> None:
        self._transport = transport
        self._timeout = timeout

    def _client(self, cfg: AiConfig) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {cfg.llm_api_key}"} if cfg.llm_api_key else {}
        return httpx.AsyncClient(
            base_url=cfg.llm_base_url.rstrip("/") + "/",
            headers=headers,
            timeout=self._timeout,
            transport=self._transport,
        )

    async def enrich(self, cfg: AiConfig, surface: str, sentence: str) -> EnrichResult:
        payload = {
            "model": cfg.llm_model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": build_messages(surface, sentence),
        }
        try:
            async with self._client(cfg) as client:
                response = await client.post("chat/completions", json=payload)
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise EnrichError(f"LLM request failed: {exc}") from exc
        return parse_enrich_content(content)

    async def list_models(self, cfg: AiConfig) -> list[str]:
        try:
            async with self._client(cfg) as client:
                response = await client.get("models")
                response.raise_for_status()
                return sorted(m["id"] for m in response.json()["data"])
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EnrichError(f"could not list models: {exc}") from exc
