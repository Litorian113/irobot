#!/bin/bash
# HfG Köpfe - richtet einen Bildschirm der Wand ein. Vom USB-Stick per Doppelklick,
# oder übers Netz im Terminal:  curl -s 192.168.0.100:8090/setup | bash
# Ohne Dialog, z.B. per SSH:    HFG_SLOT=3 bash -c "$(curl -s 192.168.0.100:8090/setup)"
#
# - installiert Chromium 103 nach ~/Applications (Chromium-103.zip daneben oder vom Server)
# - fragt, welcher Platz der Wand dieser iMac ist (vorausgewählt anhand der IP)
# - legt "HfG Köpfe" und "HfG Köpfe beenden" auf den Schreibtisch
# - startet die Seite bei jeder Anmeldung im Vollbild, nach einem Absturz von selbst neu
#
# Chromium statt Firefox: Firefox 78 rendert WebGL auf den iMacs mit NVIDIA GeForce GT 120
# mit 1 Bild pro Sekunde und geht unter OS X nicht ins Vollbild. Chromium 103 ist die letzte
# Version für OS X 10.11.
#
# Läuft mit dem bash 3.2 von OS X 10.11. Ändert nichts, wofür ein Admin-Passwort nötig wäre.

set -e

# Der Rechner mit Kamera und Server hat im Kabelnetz immer diese Adresse.
SERVER="192.168.0.100:8080"
# Dort liefert `npm run setup-server` dieses Skript und Chromium aus.
SETUP_SERVER="192.168.0.100:8090"

# Bekannte iMacs: IP -> Platz (0 oben links ... 8 unten rechts).
known_slot() {
  case "$1" in
    192.168.0.2) echo 1 ;;
    192.168.0.4) echo 2 ;;
    192.168.0.5) echo 3 ;;
    192.168.0.6) echo 4 ;;
    192.168.0.1) echo 5 ;;
    192.168.0.8) echo 7 ;;
    192.168.0.7) echo 8 ;;
    *) echo "" ;;
  esac
}

HERE="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/HfG-Koepfe"
APP="$HOME/Applications/Chromium HfG.app"
PROFILE="$SUPPORT/chromium-profile"
AGENT_ID="de.hfg-gmuend.koepfe"
AGENT="$HOME/Library/LaunchAgents/$AGENT_ID.plist"
# Was eine frühere Einrichtung gestartet hat: Firefox oder Chromium mit unserem Profil.
BROWSERS="HfG-Koepfe/(firefox|chromium)-profile"

say_error() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with icon stop with title \"HfG Köpfe\"" >/dev/null 2>&1 || true
  echo "FEHLER: $1"
  exit 1
}

echo "== HfG Köpfe einrichten =="

ZIP="$HERE/Chromium-103.zip"
if [ ! -f "$ZIP" ]; then
  echo "Chromium vom Kamera-Rechner laden ..."
  ZIP="$(mktemp -d)/Chromium-103.zip"
  curl -fsS -o "$ZIP" "http://$SETUP_SERVER/Chromium-103.zip" \
    || say_error "Chromium konnte nicht von $SETUP_SERVER geladen werden. Läuft dort 'npm run setup-server'?"
fi

# --- Platz wählen -------------------------------------------------------------
ip=""
for interface in en0 en1 en2 en3 en4; do
  candidate="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
  case "$candidate" in 192.168.0.*) ip="$candidate"; break ;; esac
done
[ -n "$ip" ] || say_error "Kein Kabelnetz 192.168.0.x gefunden. Ist das Netzwerkkabel eingesteckt?"

if [ -n "${HFG_SLOT:-}" ]; then
  slot="$HFG_SLOT"
else
  names='"0 - oben links", "1 - oben Mitte", "2 - oben rechts", "3 - Mitte links", "4 - Mitte (Werbung)", "5 - Mitte rechts", "6 - unten links", "7 - unten Mitte", "8 - unten rechts"'
  preset="$(known_slot "$ip")"
  default_item=""
  if [ -n "$preset" ]; then
    default_item="$(osascript -e "item $((preset + 1)) of {$names}")"
    default_item="default items {\"$default_item\"}"
  fi
  choice="$(osascript -e "choose from list {$names} $default_item with title \"HfG Köpfe\" with prompt \"Welcher Platz der Wand ist dieser iMac? ($ip)\" OK button name \"Einrichten\" cancel button name \"Abbrechen\"")"
  [ "$choice" != "false" ] && [ -n "$choice" ] || { echo "Abgebrochen."; exit 0; }
  slot="${choice%% *}"
fi
# 0-8: die Plätze des 3x3-Regals; ab 9: Bildschirme, die im Editor dazukommen (dann ?wall=custom).
case "$slot" in ''|*[!0-9]*) say_error "Platz '$slot' ist keine Zahl." ;; esac
echo "Platz $slot ($ip)"

# --- Chromium -----------------------------------------------------------------
echo "Chromium installieren ..."
mkdir -p "$HOME/Applications" "$SUPPORT" "$PROFILE" "$HOME/Library/LaunchAgents"
rm -rf "$SUPPORT/unpack"
ditto -x -k "$ZIP" "$SUPPORT/unpack"
rm -rf "$APP"
mv "$SUPPORT/unpack/Chromium.app" "$APP"
rm -rf "$SUPPORT/unpack"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "$slot" > "$SUPPORT/slot"

# --- Starter ------------------------------------------------------------------
cat > "$SUPPORT/start.sh" <<START
#!/bin/bash
# Startet diesen Bildschirm der Wand. Wird bei der Anmeldung von launchd aufgerufen.
SLOT="\$(cat "$SUPPORT/slot")"
URL="http://$SERVER/?slot=\$SLOT"
# Warten, bis der Kamera-Rechner erreichbar ist, statt eine Fehlerseite zu zeigen.
until curl -s -m 2 -o /dev/null "http://$SERVER/"; do sleep 3; done
pkill -f "$BROWSERS" 2>/dev/null
sleep 1
# Nach einem Absturz oder pkill keine "Seiten wiederherstellen?"-Blase.
sed -i '' -e 's/"exited_cleanly":false/"exited_cleanly":true/' -e 's/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' \\
  "$PROFILE/Default/Preferences" 2>/dev/null
# Bildschirm wach halten, solange Chromium läuft (exec behält die Prozessnummer).
caffeinate -di -w \$\$ &
exec "$APP/Contents/MacOS/Chromium" --user-data-dir="$PROFILE" --kiosk \\
  --no-first-run --no-default-browser-check --ignore-gpu-blocklist \\
  --use-mock-keychain --password-store=basic --noerrdialogs --disable-session-crashed-bubble \\
  --disable-features=Translate,MediaRouter --disable-renderer-backgrounding --disable-background-timer-throttling \\
  --check-for-update-interval=31536000 "\$URL"
START
chmod +x "$SUPPORT/start.sh"

# Autostart bei der Anmeldung. Nach einem Absturz neu starten, nach "Beenden" (Cmd+Q) nicht.
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_ID</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SUPPORT/start.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
PLIST

# Schreibtisch: Starten und Beenden per Doppelklick.
rm -rf "$HOME/Desktop/HfG Köpfe.app" "$HOME/Desktop/HfG Köpfe beenden.app"
osacompile -o "$HOME/Desktop/HfG Köpfe.app" \
  -e "do shell script \"launchctl unload \" & quoted form of \"$AGENT\" & \" 2>/dev/null; launchctl load -w \" & quoted form of \"$AGENT\""
osacompile -o "$HOME/Desktop/HfG Köpfe beenden.app" \
  -e "do shell script \"launchctl unload \" & quoted form of \"$AGENT\" & \" 2>/dev/null; pkill -f '$BROWSERS'; true\""

# --- jetzt starten ------------------------------------------------------------
if [ -n "${SSH_CONNECTION:-}" ]; then
  # Per SSH erreicht launchctl die Anmeldung am Bildschirm nicht: Ist der Starter dort geladen,
  # den laufenden Browser hart beenden, launchd startet ihn neu - jetzt mit dem neuen start.sh.
  # (Sanft beendet sich Chromium "erfolgreich", das nimmt launchd als Cmd+Q und startet nicht neu.)
  if launchctl print "gui/$(id -u)/$AGENT_ID" >/dev/null 2>&1; then
    pkill -9 -f "$BROWSERS" 2>/dev/null || true
    echo "Fertig: Platz $slot. Der Bildschirm startet neu."
  else
    echo "Fertig: Platz $slot. Der Starter läuft erst nach der nächsten Anmeldung (oder 'HfG Köpfe' auf dem Schreibtisch)."
  fi
  exit 0
fi
launchctl unload "$AGENT" 2>/dev/null || true
launchctl load -w "$AGENT"

echo "Fertig: Platz $slot. Die Seite öffnet sich, sobald $SERVER erreichbar ist."
osascript -e "display notification \"Platz $slot ist eingerichtet.\" with title \"HfG Köpfe\"" 2>/dev/null || true
