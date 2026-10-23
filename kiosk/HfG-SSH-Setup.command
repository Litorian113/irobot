#!/bin/bash
# HfG Köpfe - SSH für einen Bildschirm der Wand. Vom USB-Stick per Doppelklick,
# oder übers Netz im Terminal:  curl -s 192.168.0.100:8090/ssh | bash
#
# - trägt den Schlüssel des Kamera-Rechners für diesen Benutzer ein ("key" daneben oder vom Server)
# - schaltet "Entfernte Anmeldung" ein; fragt dafür einmal nach Name und Passwort eines Admins
# - lässt nur diesen Benutzer herein, nur mit Schlüssel (kein Passwort), nur aus dem Kabelnetz 192.168.0.x
#
# Läuft mit dem bash 3.2 von OS X 10.11. Erneut ausführen trägt einen weiteren Schlüssel ein
# (z.B. den des Windows-Rechners) und lässt die schon eingetragenen stehen.

set -e

# Dort liefert `npm run setup-server` dieses Skript und den Schlüssel aus.
SETUP_SERVER="192.168.0.100:8090"
# Nur aus diesem Netz darf sich jemand anmelden (sshd-Muster).
NETWORK="192.168.0.*"

HERE="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/HfG-Koepfe"

say_error() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with icon stop with title \"HfG Köpfe\"" >/dev/null 2>&1 || true
  echo "FEHLER: $1"
  exit 1
}

echo "== HfG Köpfe: SSH einrichten =="

# --- Schlüssel ----------------------------------------------------------------
if [ -f "$HERE/key" ]; then
  key="$(cat "$HERE/key")"
else
  echo "Schlüssel vom Kamera-Rechner laden ..."
  key="$(curl -fsS "http://$SETUP_SERVER/key")" \
    || say_error "Der Schlüssel konnte nicht von $SETUP_SERVER geladen werden. Läuft dort 'npm run setup-server'?"
fi
case "$key" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;;
  *) say_error "Das ist kein SSH-Schlüssel: ${key:0:40}" ;;
esac

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if grep -qxF "$key" "$HOME/.ssh/authorized_keys"; then
  echo "Schlüssel ist schon eingetragen."
else
  echo "$key" >> "$HOME/.ssh/authorized_keys"
  echo "Schlüssel eingetragen: ${key##* }"
fi

# --- sshd (als Admin) ---------------------------------------------------------
# Läuft als root; $USER ist schon eingesetzt. sshd nimmt von jeder Einstellung den ersten Wert,
# deshalb steht unser Block ganz oben in der sshd_config.
ROOT_SCRIPT="$(mktemp -t hfg-ssh)"
cat > "$ROOT_SCRIPT" <<ROOT
set -e
CONFIG=/etc/ssh/sshd_config
[ -f "\$CONFIG" ] || CONFIG=/etc/sshd_config
[ -f "\$CONFIG.hfg-original" ] || cp "\$CONFIG" "\$CONFIG.hfg-original"
NEW="\$(mktemp -t hfg-sshd)"
{
  echo "# >>> HfG Koepfe (kiosk/HfG-SSH-Setup.command)"
  echo "PubkeyAuthentication yes"
  echo "PasswordAuthentication no"
  echo "ChallengeResponseAuthentication no"
  echo "PermitRootLogin no"
  echo "AllowUsers $USER@$NETWORK"
  echo "# <<< HfG Koepfe"
  sed '/^# >>> HfG Koepfe/,/^# <<< HfG Koepfe/d' "\$CONFIG"
} > "\$NEW"
/usr/sbin/sshd -t -f "\$NEW"
cat "\$NEW" > "\$CONFIG"
rm -f "\$NEW"
# Ist "Entfernte Anmeldung" auf bestimmte Benutzer beschränkt, gehört dieser dazu.
if dseditgroup -o read com.apple.access_ssh >/dev/null 2>&1; then
  dseditgroup -o edit -a "$USER" -t user com.apple.access_ssh
fi
systemsetup -setremotelogin on
ROOT

echo "Entfernte Anmeldung einschalten (Admin-Passwort) ..."
if ! osascript -e "do shell script \"/bin/bash '$ROOT_SCRIPT'\" with administrator privileges" >/dev/null; then
  rm -f "$ROOT_SCRIPT"
  say_error "SSH wurde nicht eingeschaltet: abgebrochen, kein Admin-Passwort oder die sshd_config ließ sich nicht prüfen. Der Schlüssel ist eingetragen."
fi
rm -f "$ROOT_SCRIPT"

# --- fertig ---------------------------------------------------------------------
ip=""
for interface in en0 en1 en2 en3 en4; do
  candidate="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
  case "$candidate" in 192.168.0.*) ip="$candidate"; break ;; esac
done
slot="$(cat "$SUPPORT/slot" 2>/dev/null || echo "?")"

echo ""
echo "Fertig. Vom Kamera-Rechner:  ssh $USER@${ip:-<IP>}   (Platz $slot)"
echo "Passwort-Anmeldung per SSH ist aus, nur der Schlüssel kommt herein."
osascript -e "display notification \"SSH ist an: $USER@${ip:-?}\" with title \"HfG Köpfe\"" 2>/dev/null || true
