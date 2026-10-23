#!/bin/bash
# Befüllt einen USB-Stick für die iMacs: Chromium 103, Einrichtungsskript, SSH-Skript und den Schlüssel dieses Rechners.
#   npm run usb -- /Volumes/MEINSTICK
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME="${1:-}"
[ -n "$VOLUME" ] && [ -d "$VOLUME" ] || { echo "Ziel fehlt, z.B.: npm run usb -- /Volumes/MEINSTICK"; exit 1; }
TARGET="$VOLUME/HfG-Koepfe"
CACHE="$ROOT/kiosk/.cache"
# Chromium 103.0.5060.0, der letzte Stand für OS X 10.11: ein offizieller Build aus Googles Chromium-Archiv.
URL="https://storage.googleapis.com/chromium-browser-snapshots/Mac/1002907/chrome-mac.zip"

mkdir -p "$CACHE" "$TARGET"
if [ ! -f "$CACHE/Chromium-103.zip" ]; then
  echo "Chromium 103 herunterladen ..."
  curl -fL --progress-bar -o "$CACHE/chrome-mac.zip" "$URL"
  UNPACK="$(mktemp -d)"
  ditto -x -k "$CACHE/chrome-mac.zip" "$UNPACK"
  # Als zip mit Chromium.app oben, damit Rechte und Verknüpfungen auch auf FAT32-Sticks erhalten bleiben.
  ditto -c -k --keepParent "$UNPACK/chrome-mac/Chromium.app" "$CACHE/Chromium-103.zip"
  rm -rf "$UNPACK" "$CACHE/chrome-mac.zip"
fi

rm -f "$TARGET/Firefox-78.zip"
cp "$CACHE/Chromium-103.zip" "$TARGET/Chromium-103.zip"
cp "$ROOT/kiosk/HfG-Koepfe-Setup.command" "$ROOT/kiosk/HfG-SSH-Setup.command" "$TARGET/"
chmod +x "$TARGET/HfG-Koepfe-Setup.command" "$TARGET/HfG-SSH-Setup.command" 2>/dev/null || true

# Ein eigener Schlüssel nur für die Wand, ohne Passphrase: scripts/imacs.sh meldet sich damit an.
KEY="$HOME/.ssh/hfg-koepfe"
if [ ! -f "$KEY" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -q -t ed25519 -N "" -C "hfg-koepfe $(scutil --get ComputerName 2>/dev/null || hostname)" -f "$KEY"
  echo "Neuer SSH-Schlüssel für die Wand: $KEY"
fi
cp "$KEY.pub" "$TARGET/key"
echo "Fertig: $TARGET"
ls -la "$TARGET"
