# HfG Köpfe — eine Wand, die zurückschaut

Neun Bildschirme im Fenster der HfG Schwäbisch Gmünd. Acht zeigen je einen Kopf, der mittlere wirbt für
ein Studium an der HfG. Eine Kamera über dem mittleren Bildschirm erkennt Menschen, die draußen vorbeigehen,
und alle Köpfe drehen sich zu ihnen.

Die Köpfe sind M.A.X. (weiß, aus Kacheln) und D.U.S.T. (lila, aus Partikeln), schachbrettartig verteilt,
jeder mit leicht anderem Gesicht.

## Datenschutz

Die Kamerabilder werden im Browser des Kamera-Rechners von YOLO26n ausgewertet und sofort verworfen.
Es wird nichts aufgezeichnet und kein Bild verlässt den Rechner. Über das Netzwerk geht nur, *ob* jemand da ist
und wo ungefähr (drei Zahlen in Metern).

## Aufbau

```
0  1  2
3  4  5      4 = Mitte: HfG-Werbung, Kamera darüber
6  7  8
```

- **Kamera-Rechner** (zurzeit das MacBook): Webcam, Erkennung, Server. Er liefert die Seite aus und
  verteilt die Blickrichtung über WebSocket (`/gaze`) an alle Bildschirme.
- **Bildschirme** (iMacs): öffnen nur ihre Seite im Browser. Auf OS X 10.11 läuft Safari 11 *nicht*
  (kein WebGL 2), und Firefox 78 rendert auf den iMacs mit NVIDIA GeForce GT 120 mit 1 Bild/s und kann kein
  Vollbild: deshalb **Chromium 103** (der letzte Stand für 10.11) im Kiosk-Modus.

## Starten

Auf dem Kamera-Rechner:

```
npm install
npm run wall
```

Der Befehl baut die App und gibt alle Links aus: einen für die Kamera (`localhost`, damit der Browser die
Kamera freigibt) und einen pro Bildschirm, z.B. `http://192.168.0.100:8080/?slot=0`.
Auf jedem iMac den passenden Link öffnen und mit `F` auf Vollbild schalten. Die Bildschirme verbinden sich
von selbst neu, wenn der Server kurz weg war.

Netzwerk: Die iMacs hängen über den Switch in einem eigenen Netz (192.168.0.x, feste IPs). Der Kamera-Rechner
braucht dort per Kabel immer die Adresse **192.168.0.100** / 255.255.255.0, ohne Router. Auf diese Adresse
sind alle Bildschirme eingerichtet.

## iMacs einrichten (USB-Stick, nur Maus)

```
npm run usb -- /Volumes/MEINSTICK
```

legt `HfG-Koepfe/` mit Chromium 103 und `HfG-Koepfe-Setup.command` auf den Stick. Am iMac: Stick einstecken,
`HfG-Koepfe-Setup.command` doppelklicken, Platz auswählen (bekannte iMacs sind anhand der IP vorausgewählt,
siehe `known_slot` im Skript). Das Skript

- installiert Chromium 103 nach `~/Applications/Chromium HfG.app` (eigenes Profil, keine Dialoge, GPU erzwungen),
- legt **HfG Köpfe** und **HfG Köpfe beenden** auf den Schreibtisch,
- startet die Seite bei jeder Anmeldung im Vollbild, wartet dafür auf den Server, hält den Bildschirm wach
  und startet Chromium nach einem Absturz neu (nach Cmd+Q nicht).

Erneut ausführen, um den Platz zu ändern. Kein Admin-Passwort nötig.

### SSH auf die iMacs

Damit der Kamera-Rechner alle iMacs fernsteuern kann, einmal pro iMac (fragt nach einem Admin-Passwort):
`HfG-SSH-Setup.command` vom Stick doppelklicken, oder bei laufendem `npm run setup-server` im Terminal
`curl -s 192.168.0.100:8090/ssh | bash`. Das trägt den Wand-Schlüssel des Kamera-Rechners ein
(`~/.ssh/hfg-koepfe`, wird beim ersten `npm run usb`/`setup-server` angelegt) und schaltet „Entfernte
Anmeldung" ein: nur für diesen Benutzer, nur mit Schlüssel, nur aus 192.168.0.x. Die alte
`sshd_config` bleibt als `sshd_config.hfg-original` liegen. Für einen weiteren Rechner (z.B. Windows)
dessen öffentlichen Schlüssel als `key` ausliefern und das Skript noch einmal laufen lassen.

Am Kamera-Rechner dann:

```
npm run imacs -- scan          # iMacs suchen, ihren Platz merken
npm run imacs -- status        # läuft der Browser, seit wann an
npm run imacs -- reload        # Seite auf allen neu laden (Browser neu starten)
npm run imacs -- setup         # Setup auf allen neu ausrollen, Plätze bleiben (Admin-Passwort)
npm run imacs -- kiosk         # WLAN aus, keine Anmelde- und Bluetooth-Fenster (Admin-Passwort)
npm run imacs -- ssh 3         # Terminal auf Platz 3
npm run imacs -- run "uptime"  # Befehl auf allen
```

## Am Laptop ausprobieren

```
npm run dev
```

`http://localhost:5173/` öffnet die Arbeitsseite mit zwei Tabs:

- **Köpfe**: die 8 Köpfe der Wand, immer nur einer gerendert, im iMac-Format 16:9. Der Kopf folgt der Maus.
  „WebGL 1 testen" rendert wie auf den alten iMacs. Leere Plätze zeigen, welcher Kopf dort fehlt.
- **Halloween**: eine zweite Wand mit 9 eigenen Plätzen (`src/heads/halloween.ts`), noch alle leer.
  Kamera startet erst, wenn dort ein Kopf steht. Auf den iMacs: `?wall=halloween&slot=N`.
- **Eigene Wand**: links alle fertigen Köpfe und die Werbung mit Vorschaubild, rechts die 9 Bildschirme.
  Köpfe auf einen Bildschirm ziehen, Bildschirme untereinander tauschen, oder einen Bildschirm anklicken
  und im Popup auswählen. **Speichern** legt die Wand auf dem Server ab (`walls/custom.json`); alle
  Bildschirme mit `?wall=custom&slot=N` laden dann von selbst neu. Vorschaubilder neu machen, wenn sich
  ein Kopf ändert: `npm run snapshots` (braucht Google Chrome).
- **Wand**: alle 9 Bildschirme mit Kamera und Kameravorschau unten links. Die externe Webcam wird
  der eingebauten vorgezogen. Kamera und Erkennung laufen nur, solange dieser Tab offen ist.

Neue Köpfe kommen in `src/heads/designs.ts`: ein Eintrag mit Name und einer `create`-Funktion, die ein
`HeadView` liefert (`src/heads/types.ts`). Bis ein Platz gebaut ist, zeigt die Wand dort eine
M.A.X.- oder D.U.S.T.-Variante.

## URL-Parameter

| | |
|---|---|
| `?slot=0…8` | ein Bildschirm der Wand (ohne: die ganze Wand auf einer Seite) |
| `&camera=1` | Kamera und Erkennung in diesem Fenster |
| `&preview=1` | Kameravorschau mit Erkennung (Taste `D`) |
| `&cam=logitech` | Kamera nach Namen wählen |
| `&mouse=1` | die Maus spielt die Person (Test ohne Kamera) |
| `&stats=1` | fps-Anzeige |
| `&spacing=0.55,0.5` | Abstand der Bildschirmmitten in Metern (x,y) |
| `&cameray=0.3` | Höhe der Kamera über der Wandmitte in Metern |
| `&fov=70` | horizontaler Bildwinkel der Kamera in Grad |
| `&style=dust` | Kopf eines Slots überschreiben (`dust` / `lattice`) |

Tasten: `D` Kameravorschau, `F` Vollbild.

## Code

| | |
|---|---|
| `src/heads/designs.ts` | die 8 Köpfe: Name, Platz, Renderer |
| `src/wall.ts` | Platzhalter-Varianten, Abstände, URL-Parameter |
| `src/Promo.tsx` | alle Texte der Mitte |
| `src/tracking/` | Kamera, YOLO-Worker, Blick-Geometrie, Sync |
| `src/viki/ParticleFace.ts` | ein Kopf, der sich zu einem Punkt dreht |
| `public/models/yolo26n-320.onnx` | Personenerkennung (Ultralytics YOLO26n, AGPL-3.0) |

`npm test` prüft Blick-Geometrie und Kopf-Rig.

## Credits

**Franz Anhäupl** · HfG Schwäbisch Gmünd. Kopf: MakeHuman CC0 + Face Units von Mika Suominen.
Erkennung: Ultralytics YOLO26n über ONNX Runtime Web. Rendering: three.js.
S.T.E.V.E.: Pixelporträt nach dem Foto „Steve Jobs Headshot 2010" von Matthew Yohe
(Wikimedia Commons, CC BY-SA 3.0), erzeugt mit `scripts/portrait-from-photo.py`; das Porträt steht
ebenfalls unter CC BY-SA 3.0.
