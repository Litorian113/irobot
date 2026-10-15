#!/bin/bash
# HfG Köpfe - richtet einen Bildschirm der Wand ein. Vom USB-Stick per Doppelklick,
# oder übers Netz im Terminal:  curl -s 192.168.0.100:8090/setup | bash
#
# - installiert Firefox 78 nach ~/Applications (Firefox-78.zip daneben oder vom Server)
# - fragt, welcher Platz der Wand dieser iMac ist (vorausgewählt anhand der IP)
# - legt "HfG Köpfe" und "HfG Köpfe beenden" auf den Schreibtisch
# - startet die Seite bei jeder Anmeldung im Vollbild, nach einem Absturz von selbst neu
#
# Läuft mit dem bash 3.2 von OS X 10.11. Ändert nichts, wofür ein Admin-Passwort nötig wäre.

set -e

# Der Rechner mit Kamera und Server hat im Kabelnetz immer diese Adresse.
SERVER="192.168.0.100:8080"
# Dort liefert `npm run setup-server` dieses Skript und Firefox aus.
SETUP_SERVER="192.168.0.100:8090"

# Bekannte iMacs: IP -> Platz (0 oben links ... 8 unten rechts).
known_slot() {
  case "$1" in
    192.168.0.5) echo 3 ;;
    *) echo "" ;;
  esac
}

HERE="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/HfG-Koepfe"
APP="$HOME/Applications/Firefox HfG.app"
PROFILE="$SUPPORT/firefox-profile"
AGENT_ID="de.hfg-gmuend.koepfe"
AGENT="$HOME/Library/LaunchAgents/$AGENT_ID.plist"

say_error() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with icon stop with title \"HfG Köpfe\"" >/dev/null 2>&1 || true
  echo "FEHLER: $1"
  exit 1
}

echo "== HfG Köpfe einrichten =="

ZIP="$HERE/Firefox-78.zip"
if [ ! -f "$ZIP" ]; then
  echo "Firefox vom Kamera-Rechner laden ..."
  ZIP="$(mktemp -d)/Firefox-78.zip"
  curl -fsS -o "$ZIP" "http://$SETUP_SERVER/Firefox-78.zip" \
    || say_error "Firefox konnte nicht von $SETUP_SERVER geladen werden. Läuft dort 'npm run setup-server'?"
fi

# --- Platz wählen -------------------------------------------------------------
ip=""
for interface in en0 en1 en2 en3 en4; do
  candidate="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
  case "$candidate" in 192.168.0.*) ip="$candidate"; break ;; esac
done
[ -n "$ip" ] || say_error "Kein Kabelnetz 192.168.0.x gefunden. Ist das Netzwerkkabel eingesteckt?"

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
echo "Platz $slot ($ip)"

# --- Firefox ------------------------------------------------------------------
echo "Firefox installieren ..."
pkill -f "HfG-Koepfe/firefox-profile" 2>/dev/null || true
mkdir -p "$HOME/Applications" "$SUPPORT" "$PROFILE" "$HOME/Library/LaunchAgents"
rm -rf "$APP" "$SUPPORT/unpack"
ditto -x -k "$ZIP" "$SUPPORT/unpack"
mv "$SUPPORT/unpack/Firefox.app" "$APP"
rm -rf "$SUPPORT/unpack"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# Firefox 78 ist die letzte Version für OS X 10.11: Updates aus, keine Begrüßung.
mkdir -p "$APP/Contents/Resources/distribution"
cat > "$APP/Contents/Resources/distribution/policies.json" <<'JSON'
{
  "policies": {
    "DisableAppUpdate": true,
    "DisableTelemetry": true,
    "DontCheckDefaultBrowser": true,
    "DisableProfileImport": true,
    "OverrideFirstRunPage": "",
    "OverridePostUpdatePage": ""
  }
}
JSON

# Eigenes Profil: WebGL trotz alter Grafikkarte, keine Nachfragen.
cat > "$PROFILE/user.js" <<'PREFS'
user_pref("webgl.force-enabled", true);
user_pref("webgl.disable-fail-if-major-performance-caveat", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("full-screen-api.warning.timeout", 0);
user_pref("browser.tabs.warnOnClose", false);
user_pref("app.update.auto", false);
PREFS

echo "$slot" > "$SUPPORT/slot"

# --- Starter ------------------------------------------------------------------
cat > "$SUPPORT/start.sh" <<START
#!/bin/bash
# Startet diesen Bildschirm der Wand. Wird bei der Anmeldung von launchd aufgerufen.
SLOT="\$(cat "$SUPPORT/slot")"
URL="http://$SERVER/?slot=\$SLOT"
# Warten, bis der Kamera-Rechner erreichbar ist, statt eine Fehlerseite zu zeigen.
until curl -s -m 2 -o /dev/null "http://$SERVER/"; do sleep 3; done
pkill -f "HfG-Koepfe/firefox-profile" 2>/dev/null
sleep 1
# Bildschirm wach halten, solange Firefox läuft (exec behält die Prozessnummer).
caffeinate -di -w \$\$ &
exec "$APP/Contents/MacOS/firefox" -profile "$PROFILE" -no-remote --kiosk "\$URL"
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
  -e "do shell script \"launchctl unload \" & quoted form of \"$AGENT\" & \" 2>/dev/null; pkill -f HfG-Koepfe/firefox-profile; true\""

# --- jetzt starten ------------------------------------------------------------
launchctl unload "$AGENT" 2>/dev/null || true
launchctl load -w "$AGENT"

echo "Fertig: Platz $slot. Die Seite öffnet sich, sobald $SERVER erreichbar ist."
osascript -e "display notification \"Platz $slot ist eingerichtet.\" with title \"HfG Köpfe\"" 2>/dev/null || true
