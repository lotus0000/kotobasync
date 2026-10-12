from ipaddress import IPv4Network, IPv6Network, ip_network
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KOTOBA_")

    database_url: str = "sqlite:////data/kotoba.db"
    public_url: str = "http://localhost:8900"
    extension_origin: str = ""
    # First-boot defaults only; values saved from the PWA (settings table) win afterwards.
    enrich_mode: Literal["auto", "external", "off"] = "auto"
    llm_base_url: str = "http://host.docker.internal:11434/v1"
    llm_model: str = "qwen3-coder:30b"
    llm_api_key: str = ""
    trusted_proxies: str = "127.0.0.1/32,172.16.0.0/12"
    static_dir: str = "/app/static"
    auto_create_schema: bool = False
    start_worker: bool = True

    @property
    def trusted_networks(self) -> list[IPv4Network | IPv6Network]:
        return [ip_network(part.strip()) for part in self.trusted_proxies.split(",") if part.strip()]
