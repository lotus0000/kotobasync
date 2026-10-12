#!/usr/bin/env python3
"""Create/refresh the Cloudflare Access app + service token that guard the KotobaSync hostname.

Usage:
    KOTOBA_ACCESS_HOST=kotoba.example.com KOTOBA_ACCESS_TEMPLATE_HOST=app.example.com \
        python3 -I scripts/cf_access_setup.py

KOTOBA_ACCESS_TEMPLATE_HOST is an existing Access app on the same account whose allow rule is copied.
The Cloudflare API token is read from CF_API_TOKEN_FILE (default ~/.config/cloudflare/api.token).

Idempotent. Copies the owner-only allow rule from an existing app so identity rules stay identical.
Never prints secrets; service-token credentials go to a 0600 file.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
HOST = os.environ.get("KOTOBA_ACCESS_HOST", "")
TEMPLATE_HOST = os.environ.get("KOTOBA_ACCESS_TEMPLATE_HOST", "")
ZONE = ".".join(HOST.split(".")[-2:])
APP_NAME = "KotobaSync"
SERVICE_TOKEN_NAME = "kotobasync-clients"
TOKEN_FILE = Path(os.environ.get("CF_API_TOKEN_FILE", Path.home() / ".config/cloudflare/api.token"))
OUT_FILE = Path.home() / ".config/cloudflare/kotobasync-service-token.json"


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN_FILE.read_text().strip()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as exc:
        data = json.load(exc)
    if not data.get("success"):
        sys.exit(f"{method} {path} failed: {data.get('errors')}")
    return data["result"]


def domains(app: dict) -> list[str]:
    """Every hostname an Access app covers (apps may list several, e.g. app.example.com + app.example.org)."""
    dests = [d.get("uri") or d.get("domain") for d in app.get("destinations") or []]
    return [d for d in (dests or app.get("self_hosted_domains") or [app.get("domain")]) if d]


def save_credentials(token: dict) -> None:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(OUT_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"client_id": token["client_id"], "client_secret": token["client_secret"], "token_id": token["id"]}, f)


def main() -> None:
    if not HOST or not TEMPLATE_HOST:
        sys.exit("set KOTOBA_ACCESS_HOST and KOTOBA_ACCESS_TEMPLATE_HOST")
    account = call("GET", f"/zones?name={ZONE}")[0]["account"]["id"]
    apps = call("GET", f"/accounts/{account}/access/apps")
    template = next((a for a in apps if TEMPLATE_HOST in domains(a)), None)
    if template is None:
        sys.exit(f"template app {TEMPLATE_HOST} not visible; check the token's Access permissions")
    allow = [p for p in template.get("policies", []) if p.get("decision") == "allow"]
    if not allow:
        sys.exit("template app has no allow policy to copy")

    tokens = call("GET", f"/accounts/{account}/access/service_tokens")
    service_token = next((t for t in tokens if t["name"] == SERVICE_TOKEN_NAME), None)
    if service_token is None:
        service_token = call(
            "POST", f"/accounts/{account}/access/service_tokens", {"name": SERVICE_TOKEN_NAME, "duration": "8760h"}
        )
        save_credentials(service_token)
        print(f"service token created; credentials saved to {OUT_FILE}")
    elif not OUT_FILE.exists():
        sys.exit(f"service token {SERVICE_TOKEN_NAME} exists but {OUT_FILE} is missing; rotate it in the dashboard")
    else:
        print(f"service token {SERVICE_TOKEN_NAME} already exists")

    body = {
        "name": APP_NAME,
        "domain": HOST,
        "type": "self_hosted",
        "session_duration": "720h",
        "options_preflight_bypass": True,
        "app_launcher_visible": False,
        "allowed_idps": template.get("allowed_idps", []),
        "auto_redirect_to_identity": template.get("auto_redirect_to_identity", False),
        "policies": [
            {
                "name": "owner",
                "decision": "allow",
                "include": allow[0]["include"],
                "exclude": allow[0].get("exclude", []),
                "require": allow[0].get("require", []),
                "precedence": 1,
            },
            {
                "name": "kotobasync clients",
                "decision": "non_identity",
                "include": [{"service_token": {"token_id": service_token["id"]}}],
                "precedence": 2,
            },
        ],
    }
    existing = next((a for a in apps if HOST in domains(a)), None)
    if existing:
        call("PUT", f"/accounts/{account}/access/apps/{existing['id']}", body)
        print("Access app updated")
    else:
        call("POST", f"/accounts/{account}/access/apps", body)
        print("Access app created")


if __name__ == "__main__":
    main()
