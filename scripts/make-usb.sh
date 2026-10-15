#!/bin/bash
# Befüllt einen USB-Stick für die iMacs: Firefox 78 + Einrichtungsskript.
#   npm run usb -- /Volumes/MEINSTICK
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME="${1:-}"
[ -n "$VOLUME" ] && [ -d "$VOLUME" ] || { echo "Ziel fehlt, z.B.: npm run usb -- /Volumes/MEINSTICK"; exit 1; }
TARGET="$VOLUME/HfG-Koepfe"
CACHE="$ROOT/kiosk/.cache"
DMG="$CACHE/Firefox-78.15.0esr-de.dmg"
URL="https://ftp.mozilla.org/pub/firefox/releases/78.15.0esr/mac/de/Firefox%2078.15.0esr.dmg"

mkdir -p "$CACHE" "$TARGET"
if [ ! -f "$CACHE/Firefox-78.zip" ]; then
  [ -f "$DMG" ] || { echo "Firefox 78 herunterladen ..."; curl -fL --progress-bar -o "$DMG" "$URL"; }
  hdiutil verify "$DMG" >/dev/null
  MNT="$(mktemp -d)"
  hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" >/dev/null
  # Als zip, damit Rechte und Verknüpfungen auch auf FAT32-Sticks erhalten bleiben.
  ditto -c -k --keepParent "$MNT/Firefox.app" "$CACHE/Firefox-78.zip"
  hdiutil detach "$MNT" >/dev/null
fi

cp "$CACHE/Firefox-78.zip" "$TARGET/Firefox-78.zip"
cp "$ROOT/kiosk/HfG-Koepfe-Setup.command" "$TARGET/"
chmod +x "$TARGET/HfG-Koepfe-Setup.command" 2>/dev/null || true
echo "Fertig: $TARGET"
ls -la "$TARGET"
