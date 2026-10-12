# KotobaSync

English | [简体中文](README.zh-CN.md)

Self-hosted Japanese vocabulary capture and dictation: select words on ChatGPT to save them, sync offline-first to your own server, and review them with dictation in a PWA.

## Server development

```bash
cd server
uv sync
uv run pytest
```

## Frontend development (shared + PWA)

```bash
npm install
npm test            # shared + web unit tests
npm run typecheck
npm run dev -w web  # http://localhost:5173, /api is proxied to 127.0.0.1:8900
```

Icons are generated into `web/public/` by `python3 -I scripts/make_icons.py`.

## Deployment

```bash
cp .env.example .env      # set KOTOBA_PUBLIC_URL to your own domain
mkdir -p data
docker compose up -d --build
docker compose exec kotobasync kotobasync set-passphrase
curl -s http://127.0.0.1:8900/api/health
```

- The service listens on `127.0.0.1:8900` only. To expose it, put it behind a reverse proxy or a Cloudflare Tunnel, protected by Cloudflare Access.
  `scripts/cf_access_setup.py` creates the Access application and the service token the extension uses (see the script header for usage). **Set up Access before exposing the service.**
- Forgot the passphrase: run `set-passphrase` again to reset it (only a hash is stored, so it cannot be recovered). Devices already signed in stay signed in.
- Devices: `docker compose exec kotobasync kotobasync device add|list|revoke`.
- Batch enrichment by an external agent: see `docs/agent-enrichment.md`.
- Backups: `scripts/backup.sh` (run daily from cron).

## Chrome extension

```bash
npm install
KOTOBA_SERVER=https://kotoba.example.com npm run build -w extension   # output in extension/dist
```

`KOTOBA_SERVER` is the server the extension connects to by default (`http://localhost:8900` if unset); you can change it later on the settings page.

1. Open `chrome://extensions` in Chrome → enable "Developer mode" → "Load unpacked" → choose `extension/dist`.
   The extension ID is fixed by the manifest `key` and matches `KOTOBA_EXTENSION_ORIGIN` in `.env.example`.
2. Click the KotobaSync toolbar icon to open settings: check the server URL; if the server is behind Cloudflare Access,
   enter the service token's Client ID / Secret; sign in with your passphrase.
3. On chatgpt.com, select Japanese text → click 「＋ 收藏」 → edit the card if needed → press Enter or 「保存」.

Preconfigured build: set `KOTOBA_PRESET=/path/to/preset.json` (with `{"serverUrl", "cfClientId", "cfClientSecret"}`)
when building and it is packed into `extension/dist`, so a new PC only needs the passphrase.
**That dist contains secrets: do not share or commit it.**
