#!/usr/bin/env bash
# Daily online backup of the SQLite DB; keeps the newest 7. Run daily from cron on the server.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/backups
docker compose exec -T kotobasync python -c "
import sqlite3, datetime
src = sqlite3.connect('/data/kotoba.db')
dst = sqlite3.connect('/data/backups/kotoba-' + datetime.date.today().strftime('%Y%m%d') + '.db')
src.backup(dst)
dst.close(); src.close()
"
ls -1t data/backups/kotoba-*.db | tail -n +8 | xargs -r rm --
