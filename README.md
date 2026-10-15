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
  (kein WebGL 2), stattdessen **Firefox ESR 78** oder Chrome ≤ 103.

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

legt `HfG-Koepfe/` mit Firefox 78 und `HfG-Koepfe-Setup.command` auf den Stick. Am iMac: Stick einstecken,
`HfG-Koepfe-Setup.command` doppelklicken, Platz auswählen (bekannte iMacs sind anhand der IP vorausgewählt,
siehe `known_slot` im Skript). Das Skript

- installiert Firefox 78 nach `~/Applications/Firefox HfG.app`, ohne Updates und Begrüßung, mit freigeschaltetem WebGL,
- legt **HfG Köpfe** und **HfG Köpfe beenden** auf den Schreibtisch,
- startet die Seite bei jeder Anmeldung im Vollbild, wartet dafür auf den Server, hält den Bildschirm wach
  und startet Firefox nach einem Absturz neu (nach Cmd+Q nicht).

Erneut ausführen, um den Platz zu ändern. Kein Admin-Passwort nötig.

## Am Laptop ausprobieren

```
npm run dev
```

`http://localhost:5173/` zeigt die ganze Wand auf einem Bildschirm, mit Kameravorschau unten links.
Die externe Webcam wird automatisch der eingebauten vorgezogen.

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
| `src/wall.ts` | welcher Kopf wo, Abstände, URL-Parameter |
| `src/Promo.tsx` | alle Texte der Mitte |
| `src/tracking/` | Kamera, YOLO-Worker, Blick-Geometrie, Sync |
| `src/viki/ParticleFace.ts` | ein Kopf, der sich zu einem Punkt dreht |
| `public/models/yolo26n-320.onnx` | Personenerkennung (Ultralytics YOLO26n, AGPL-3.0) |

`npm test` prüft Blick-Geometrie und Kopf-Rig.

## Credits

**Franz Anhäupl** · HfG Schwäbisch Gmünd. Kopf: MakeHuman CC0 + Face Units von Mika Suominen.
Erkennung: Ultralytics YOLO26n über ONNX Runtime Web. Rendering: three.js.
