#!/bin/bash
# Zugang zum Wand-Server hfg-wall (Windows). Läuft im HfG-WLAN bzw. per VPN.
#
#   bash scripts/server-access.sh join      Für Freunde: Schlüssel aus hfg.env einrichten, danach `ssh hfg-wall`
#   bash scripts/server-access.sh team      Einmal, vom eigenen Rechner: Team-Schlüssel aus hfg.env auf dem Server eintragen
#   bash scripts/server-access.sh github    Einmal: dem Server einen Lese-Schlüssel für das private GitHub-Repo geben,
#                                           damit git push → Auto-Deploy wieder geht
#   bash scripts/server-access.sh revoke    Team-Schlüssel auf dem Server wieder sperren
#
# hfg.env liegt nur lokal (.gitignore) und enthält den Team-Schlüssel: nur an Leute geben, die an die Wand dürfen.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="hfg.env"
REPO="Litorian113/irobot"
[ -f "$ENV_FILE" ] && . "./$ENV_FILE"
HOST="${HFG_SERVER_HOST:-hfg-wall.local}"
USER_ON_SERVER="${HFG_SERVER_USER:-nakumu-02}"
# Wer den Server schon erreicht (eigener Schlüssel), nimmt user@host; Freunde nach `join` den Alias.
SERVER="${HFG_ADMIN_SERVER:-$USER_ON_SERVER@$HOST}"
KEY_FILE="$HOME/.ssh/hfg-wall-team"

need_env() { [ -n "${HFG_SSH_KEY_B64:-}" ] || { echo "hfg.env fehlt oder hat keinen HFG_SSH_KEY_B64."; exit 1; }; }

# A PowerShell script on the server, sent encoded: no quoting through ssh and cmd.
remote_ps() {
  local encoded
  encoded="$(printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | openssl base64 -A)"
  ssh -o ConnectTimeout=8 "$SERVER" "powershell -NoProfile -NonInteractive -EncodedCommand $encoded"
}

team_public_key() {
  need_env
  local tmp
  tmp="$(mktemp)"
  printf '%s' "$HFG_SSH_KEY_B64" | openssl base64 -d -A > "$tmp"
  chmod 600 "$tmp"
  ssh-keygen -y -f "$tmp" | awk '{print $1, $2, "hfg-wall-team"}'
  rm -f "$tmp"
}

case "${1:-}" in
  join)
    need_env
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    printf '%s' "$HFG_SSH_KEY_B64" | openssl base64 -d -A > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    if ! grep -q '^Host hfg-wall$' "$HOME/.ssh/config" 2>/dev/null; then
      printf '\nHost hfg-wall\n  HostName %s\n  User %s\n  IdentityFile %s\n  IdentitiesOnly yes\n' \
        "$HOST" "$USER_ON_SERVER" "$KEY_FILE" >> "$HOME/.ssh/config"
    fi
    echo "Eingerichtet. Im HfG-WLAN: ssh hfg-wall    Webseite: ${HFG_WEB:-http://$HOST:8080}"
    ;;

  team)
    key="$(team_public_key)"
    remote_ps "
      \$file = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'
      \$key = '$key'
      if ((Get-Content \$file -ErrorAction SilentlyContinue) -notcontains \$key) { Add-Content -Path \$file -Value \$key -Encoding ascii; 'eingetragen' } else { 'war schon eingetragen' }
    "
    ;;

  revoke)
    remote_ps "
      \$file = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'
      \$rest = Get-Content \$file | Where-Object { \$_ -notmatch ' hfg-wall-team\$' }
      Set-Content -Path \$file -Value \$rest -Encoding ascii
      'Team-Schlüssel gesperrt'
    "
    ;;

  github)
    # 1. A key only for reading the repo, made on the server and never leaving it.
    pub="$(remote_ps "
      \$k = \"\$env:USERPROFILE\\.ssh\\github-irobot\"
      if (-not (Test-Path \$k)) { ssh-keygen -q -t ed25519 -N '\"\"' -C hfg-wall-deploy -f \$k | Out-Null }
      Get-Content \"\$k.pub\"
    " | tr -d '\r')"
    case "$pub" in ssh-ed25519\ *) ;; *) echo "Kein Schlüssel vom Server bekommen: $pub"; exit 1 ;; esac
    # 2. Registered on GitHub as a read-only deploy key.
    if gh repo deploy-key list --repo "$REPO" | grep -q 'hfg-wall'; then
      echo "Deploy-Key hfg-wall gibt es schon auf GitHub."
    else
      printf '%s\n' "$pub" | gh repo deploy-key add - --repo "$REPO" --title hfg-wall
    fi
    # 3. The server's clone fetches over SSH with it, and tries once.
    remote_ps "
      Set-Location C:\\hfg\\irobot
      \$k = (\"\$env:USERPROFILE\\.ssh\\github-irobot\") -replace '\\\\', '/'
      git remote set-url origin git@github.com:$REPO.git
      git config core.sshCommand \"C:/Windows/System32/OpenSSH/ssh.exe -i \$k -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new\"
      git fetch origin 2>&1
      if (\$LASTEXITCODE -eq 0) { 'GitHub-Zugang geht: Auto-Deploy holt wieder' } else { 'git fetch ging nicht' }
    "
    ;;

  *)
    sed -n '2,11p' "$0"
    exit 1
    ;;
esac
