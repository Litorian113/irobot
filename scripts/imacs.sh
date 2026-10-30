#!/bin/bash
# Die iMacs der Wand per SSH, vom Kamera-Rechner aus. Auf jedem iMac einmal SSH einschalten:
# HfG-SSH-Setup.command vom Stick, oder übers Netz  curl -s 192.168.0.100:8090/ssh | bash  (npm run setup-server).
#
#   npm run imacs -- scan            iMacs im Kabelnetz suchen und ihren Platz merken
#   npm run imacs -- list            die gemerkten iMacs
#   npm run imacs -- ssh 3           Terminal auf dem iMac von Platz 3 (oder eine IP)
#   npm run imacs -- run "uptime"    Befehl auf allen iMacs
#   npm run imacs -- status          läuft der Browser, seit wann ist der iMac an
#   npm run imacs -- reload          Browser auf allen neu starten: die Seite lädt neu
#   npm run imacs -- setup           HfG-Koepfe-Setup auf allen neu ausrollen, jeder behält seinen Platz (Admin-Passwort)
#   npm run imacs -- kiosk           WLAN aus, keine WLAN-Anmeldefenster, kein Tastatur-/Maus-Assistent (Admin-Passwort)
#   npm run imacs -- schedule        Mo-Fr 16:55 an, 21:30 aus, prüft die automatische Anmeldung (Admin-Passwort)
#                                    (eigene Zeiten und Tage: schedule 16:55 21:30 MTWRF, Tage wie bei pmset: MTWRFSU)
#   npm run imacs -- program ...     was der Server alle paar Minuten aus dem Zeitplan einstellt (scripts/windows/plan.ps1)
#   npm run imacs -- shutdown        alle iMacs jetzt ausschalten (Admin-Passwort)
#
# Benutzer auf den iMacs: IMAC_USER, sonst wird beim ersten Mal gefragt und gemerkt.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/kiosk/.cache"
# Eine Zeile pro iMac: "Platz IP".
HOSTS="$CACHE/imacs"
KEY="$HOME/.ssh/hfg-koepfe"
NET="192.168.0"
SELF="192.168.0.100"
SLOT_FILE='$HOME/Library/Application Support/HfG-Koepfe/slot'

mkdir -p "$CACHE"
[ -f "$KEY" ] || { echo "Kein Schlüssel $KEY. Erst 'npm run setup-server' (oder 'npm run usb') ausführen."; exit 1; }

imac_user() {
  if [ -n "${IMAC_USER:-}" ]; then echo "$IMAC_USER"; return; fi
  if [ -s "$CACHE/imac-user" ]; then cat "$CACHE/imac-user"; return; fi
  read -r -p "Benutzername auf den iMacs: " name </dev/tty
  echo "$name" > "$CACHE/imac-user"
  echo "$name"
}

# Nur mit dem Wand-Schlüssel; die iMacs bekommen ein eigenes known_hosts.
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o LogLevel=ERROR -o ConnectTimeout=4 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$CACHE/known_hosts")

remote() {
  local ip="$1"
  shift
  # -n: never read stdin, the loops over the host list need it.
  ssh -n "${SSH_OPTS[@]}" -o BatchMode=yes "$USER_NAME@$ip" "$@"
}

need_hosts() {
  [ -s "$HOSTS" ] || { echo "Noch keine iMacs gemerkt. Erst: npm run imacs -- scan"; exit 1; }
}

# Platz (0-8) oder IP -> IP.
resolve() {
  case "$1" in
    *.*) echo "$1" ;;
    *) need_hosts; awk -v slot="$1" '$1 == slot { print $2; exit }' "$HOSTS" ;;
  esac
}

# Einen Befehl auf allen erreichbaren iMacs, gleichzeitig; jede Zeile mit ihrem Platz davor.
on_all() {
  need_hosts
  while read -r slot ip; do
    [ "$slot" = "kein-zugang" ] && continue
    ( remote "$ip" "$1" 2>&1 | sed "s/^/[Platz $slot $ip] /" ) &
  done < "$HOSTS"
  wait
}

# Ein Skript als root auf allen iMacs; das Admin-Passwort geht über stdin an sudo, nirgends sonst hin.
on_all_as_admin() {
  need_hosts
  local password="${IMAC_ADMIN_PASSWORD:-}"
  # Auf dem Server: aus einer Datei, die nur sein Benutzerkonto lesen kann (nicht im Repo).
  if [ -z "$password" ] && [ -s "$HOME/.hfg-imac-admin" ]; then password="$(head -n 1 "$HOME/.hfg-imac-admin" | tr -d '\r')"; fi
  if [ -z "$password" ]; then
    read -r -s -p "Admin-Passwort der iMacs: " password </dev/tty
    echo
  fi
  # The script travels base64-encoded as an argument: sudo -S may read all of stdin for the password.
  local encoded
  encoded="$(printf '%s' "$1" | base64 | tr -d '\n')"
  while read -r slot ip; do
    [ "$slot" = "kein-zugang" ] && continue
    ( printf '%s\n' "$password" \
        | ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$USER_NAME@$ip" "sudo -S -p '' /bin/bash -c \"\$(echo $encoded | base64 -D)\"" 2>&1 \
        | grep -v -E '^$|sudo command|enter your password|deletion of important|typing when using' \
        | sed "s/^/[Platz $slot $ip] /" ) &
  done < "$HOSTS"
  wait
}

# Ausstellungsbetrieb: nichts darf sich über die Wand legen.
KIOSK_SCRIPT='
wifi="$(networksetup -listallhardwareports | awk "/Wi-Fi|AirPort/ { getline; print \$2 }")"
if [ -n "$wifi" ]; then networksetup -setairportpower "$wifi" off && echo "WLAN ($wifi) aus"; fi
# Kein "Mit ... verbinden"-Fenster für WLAN-Anmeldeseiten.
defaults write /Library/Preferences/SystemConfiguration/com.apple.captive.control Active -bool false
pkill -f "Captive Network Assistant" 2>/dev/null
# Ohne Tastatur und Maus beim Start nicht nach Bluetooth-Geräten suchen.
defaults write /Library/Preferences/com.apple.Bluetooth BluetoothAutoSeekKeyboard -bool false
defaults write /Library/Preferences/com.apple.Bluetooth BluetoothAutoSeekPointingDevice -bool false
pkill -f "Bluetooth Setup Assistant" 2>/dev/null
echo "Anmeldefenster und Bluetooth-Assistent aus"
'

# Jeden Tag selbst an und aus: ein ausgeschalteter iMac lässt sich übers Netz nicht wecken.
# Dazu Neustart nach Stromausfall. Die automatische Anmeldung (Systemeinstellungen > Benutzer & Gruppen >
# Anmeldeoptionen) wird nur geprüft: ohne sie bleibt ein iMac nach dem Einschalten am Anmeldefenster stehen.
# __ON__ und __OFF__ werden vor dem Senden eingesetzt.
SCHEDULE_SCRIPT='
pmset repeat wakeorpoweron __DAYS__ __ON__:00 shutdown __DAYS__ __OFF__:00
pmset -a autorestart 1
pmset -a sleep 0 displaysleep 0 disksleep 0
auto="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)"
echo "__DAYS__ an __ON__, aus __OFF__, automatische Anmeldung: ${auto:-AUS - bitte in den Systemeinstellungen einschalten}"
'

# Der Zeitplan der Seite: die Woche als Wiederholung, Ausnahmen als einmalige Ereignisse (src/schedule.ts).
# Vorher alle einmaligen Ereignisse löschen. Die Felder kommen geprüft von src/schedule.ts.
PROGRAM_SCRIPT='
pmset -g sched | sed -n "/Scheduled power events/,\$p" | sed -n -E "s/.*\[[0-9]+\] +([a-z]+) at ([0-9\/]+ [0-9:]+).*/\1|\2/p" | while IFS="|" read -r type when; do
  [ "$type" = "wakepoweron" ] && type=wakeorpoweron
  pmset schedule cancel "$type" "$when"
done
repeat=""
[ "__REPEAT_ON__" != "-" ] && repeat="wakeorpoweron __DAYS__ __REPEAT_ON__:00"
[ "__REPEAT_OFF__" != "-" ] && repeat="$repeat shutdown __DAYS__ __REPEAT_OFF__:00"
pmset repeat cancel
[ -n "$repeat" ] && pmset repeat $repeat
[ "__ONCE_ON__" != "-" ] && pmset schedule wakeorpoweron "__ONCE_ON__"
[ "__ONCE_OFF__" != "-" ] && pmset schedule shutdown "__ONCE_OFF__"
pmset -a autorestart 1
pmset -a sleep 0 displaysleep 0 disksleep 0
echo "Woche an __REPEAT_ON__, aus __REPEAT_OFF__ (__DAYS__); einmalig an __ONCE_ON__, aus __ONCE_OFF__"
'

# YYYY-MM-DDTHH:MM wie pmset es will: MM/DD/YY HH:MM:SS. "-" bleibt "-".
pmset_time() {
  case "$1" in
    -) echo "-" ;;
    *) echo "${1:5:2}/${1:8:2}/${1:2:2} ${1:11:5}:00" ;;
  esac
}

command="${1:-}"
case "$command" in
  scan)
    USER_NAME="$(imac_user)"
    echo "Suche iMacs mit SSH in $NET.x ..."
    found="$(mktemp -d)"
    for i in $(seq 1 254); do
      ip="$NET.$i"
      [ "$ip" = "$SELF" ] && continue
      ( nc -z -G 1 "$ip" 22 >/dev/null 2>&1 && touch "$found/$ip" ) &
    done
    wait
    : > "$HOSTS.new"
    for file in "$found"/*; do
      [ -e "$file" ] || continue
      ip="$(basename "$file")"
      slot="$(remote "$ip" "cat \"$SLOT_FILE\" 2>/dev/null || echo '?'" 2>/dev/null)" || slot="kein-zugang"
      echo "$slot $ip" >> "$HOSTS.new"
    done
    rm -rf "$found"
    sort -n "$HOSTS.new" > "$HOSTS"
    rm -f "$HOSTS.new"
    if [ -s "$HOSTS" ]; then
      echo "Platz  IP"
      cat "$HOSTS"
      grep -q "^kein-zugang" "$HOSTS" && echo "kein-zugang: SSH ist an, aber der Schlüssel fehlt dort oder der Benutzer '$USER_NAME' stimmt nicht."
    else
      echo "Keinen iMac mit SSH gefunden. Ist auf ihnen HfG-SSH-Setup gelaufen?"
    fi
    ;;
  list)
    need_hosts
    echo "Platz  IP"
    cat "$HOSTS"
    ;;
  ssh)
    USER_NAME="$(imac_user)"
    ip="$(resolve "${2:?Platz oder IP fehlt, z.B. npm run imacs -- ssh 3}")"
    [ -n "$ip" ] || { echo "Platz $2 ist nicht gemerkt. npm run imacs -- list"; exit 1; }
    exec ssh "${SSH_OPTS[@]}" "$USER_NAME@$ip"
    ;;
  run)
    USER_NAME="$(imac_user)"
    on_all "${2:?Befehl fehlt, z.B. npm run imacs -- run uptime}"
    ;;
  status)
    USER_NAME="$(imac_user)"
    on_all 'b=$(ps -axo command | grep -o -E "HfG-Koepfe/(firefox|chromium)-profile" | head -1 | sed "s/.*\///; s/-profile//"); echo "an seit: $(uptime | sed "s/.*up *//; s/,.*//"); Browser: ${b:-aus}; Platz: $(cat "$HOME/Library/Application Support/HfG-Koepfe/slot" 2>/dev/null || echo ?)"'
    ;;
  reload)
    USER_NAME="$(imac_user)"
    # Beendet den Browser hart; launchd startet die Seite wieder (KeepAlive, siehe HfG-Koepfe-Setup.command).
    # Sanft beendet sich Chromium "erfolgreich", das nimmt launchd als Cmd+Q und startet nicht neu.
    on_all 'pkill -9 -f "HfG-Koepfe/(firefox|chromium)-profile" && echo "Browser neu gestartet" || echo "Browser lief nicht"'
    ;;
  setup)
    USER_NAME="$(imac_user)"
    # Jeder iMac behält seinen Platz; das Skript kommt vom Setup-Server (npm run setup-server).
    on_all 'HFG_SLOT="$(cat "$HOME/Library/Application Support/HfG-Koepfe/slot")" bash -c "$(curl -fsS 192.168.0.100:8090/setup)"'
    # Ist der Starter an der Anmeldung am Bildschirm nicht geladen, dort laden (braucht root).
    on_all_as_admin 'u="$(stat -f %u /dev/console)"; plist="$(dscl . -read /Users/$(stat -f %Su /dev/console) NFSHomeDirectory | awk "{print \$2}")/Library/LaunchAgents/de.hfg-gmuend.koepfe.plist"
if launchctl print "gui/$u/de.hfg-gmuend.koepfe" >/dev/null 2>&1; then echo "Starter läuft"; else launchctl bootstrap "gui/$u" "$plist" && echo "Starter geladen"; fi'
    ;;
  schedule)
    USER_NAME="$(imac_user)"
    on="${2:-16:55}"
    off="${3:-21:30}"
    days="${4:-MTWRF}"
    script="${SCHEDULE_SCRIPT//__ON__/$on}"
    script="${script//__DAYS__/$days}"
    on_all_as_admin "${script//__OFF__/$off}"
    ;;
  program)
    USER_NAME="$(imac_user)"
    script="${PROGRAM_SCRIPT//__REPEAT_ON__/${2:?}}"
    script="${script//__REPEAT_OFF__/${3:?}}"
    script="${script//__DAYS__/${4:?}}"
    script="${script//__ONCE_ON__/$(pmset_time "${5:?}")}"
    script="${script//__ONCE_OFF__/$(pmset_time "${6:?}")}"
    on_all_as_admin "$script"
    ;;
  shutdown)
    USER_NAME="$(imac_user)"
    on_all_as_admin 'echo "fährt herunter"; shutdown -h +0 >/dev/null 2>&1 &'
    ;;
  kiosk)
    USER_NAME="$(imac_user)"
    on_all_as_admin "$KIOSK_SCRIPT"
    ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
