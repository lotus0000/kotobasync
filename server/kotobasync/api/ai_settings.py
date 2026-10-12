from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from kotobasync.api.deps import get_db, require_device
from kotobasync.enrich.config import AiConfig, load_ai_config, save_ai_config
from kotobasync.enrich.types import EnrichError

router = APIRouter(dependencies=[Depends(require_device)])


class AiSettingsOut(BaseModel):
    enrich_mode: str
    llm_base_url: str
    llm_model: str
    has_api_key: bool


class AiSettingsIn(BaseModel):
    enrich_mode: Literal["auto", "external", "off"] | None = None
    llm_base_url: str | None = Field(None, max_length=500, pattern=r"^https?://\S+$")
    llm_model: str | None = Field(None, min_length=1, max_length=200)
    llm_api_key: str | None = Field(None, max_length=500)


def _out(cfg: AiConfig) -> AiSettingsOut:
    return AiSettingsOut(
        enrich_mode=cfg.enrich_mode,
        llm_base_url=cfg.llm_base_url,
        llm_model=cfg.llm_model,
        has_api_key=bool(cfg.llm_api_key),
    )


@router.get("/settings/ai", response_model=AiSettingsOut)
def get_ai_settings(request: Request, db: Session = Depends(get_db)) -> AiSettingsOut:
    return _out(load_ai_config(db, request.app.state.settings))


@router.put("/settings/ai", response_model=AiSettingsOut)
def put_ai_settings(body: AiSettingsIn, request: Request, db: Session = Depends(get_db)) -> AiSettingsOut:
    save_ai_config(db, body.model_dump(exclude_none=True))
    db.commit()
    return _out(load_ai_config(db, request.app.state.settings))


@router.get("/settings/ai/models")
async def list_models(request: Request, db: Session = Depends(get_db)) -> dict:
    cfg = load_ai_config(db, request.app.state.settings)
    try:
        return {"models": await request.app.state.enricher.list_models(cfg)}
    except EnrichError as exc:
        raise HTTPException(502, str(exc)) from exc
