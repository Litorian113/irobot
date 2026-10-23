#!/bin/bash
# Liefert das iMac-Setup übers Kabelnetz aus (statt USB-Stick).
# Am iMac im Terminal:  curl -s 192.168.0.100:8090/setup | bash   (Wand-Seite)
#                       curl -s 192.168.0.100:8090/ssh | bash     (SSH für scripts/imacs.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVE="$ROOT/kiosk/.cache/serve"
IP="192.168.0.100"
PORT=8090

mkdir -p "$SERVE"
bash "$ROOT/scripts/make-usb.sh" "$SERVE" >/dev/null
cp "$ROOT/kiosk/HfG-Koepfe-Setup.command" "$SERVE/HfG-Koepfe/setup"
cp "$ROOT/kiosk/HfG-SSH-Setup.command" "$SERVE/HfG-Koepfe/ssh"

ifconfig | grep -q "inet $IP " || { echo "Dieser Rechner hat nicht die Adresse $IP. Ist das Netzwerkkabel eingesteckt und fest eingestellt?"; exit 1; }
echo ""
echo "  Am iMac: Terminal öffnen (Programme > Dienstprogramme) und eintippen:"
echo ""
echo "    curl -s $IP:$PORT/setup | bash     Wand-Seite einrichten"
echo "    curl -s $IP:$PORT/ssh | bash       SSH einschalten (fragt nach einem Admin-Passwort)"
echo ""
echo "  Beenden mit Ctrl+C."
echo ""
cd "$SERVE/HfG-Koepfe"
exec python3 -m http.server "$PORT" --bind "$IP"
