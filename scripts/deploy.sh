#!/bin/bash
# Den aktuellen Stand auf den Wand-Server bringen: pushen, dort holen, bauen, neu starten.
#   npm run deploy            Server: HFG_SERVER (Standard nakumu-02@desktop-15hcs5o.local, über das WLAN "hfg")
set -euo pipefail
SERVER="${HFG_SERVER:-nakumu-02@desktop-15hcs5o.local}"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ -z "$(git status --porcelain)" ] || { echo "Nicht committete Änderungen: erst committen, dann deployen."; exit 1; }
git push origin "$branch"
ssh -o ConnectTimeout=8 "$SERVER" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\hfg\\irobot\\scripts\\windows\\deploy.ps1"
