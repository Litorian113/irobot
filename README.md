# HfG Köpfe — eine Wand, die zurückschaut

Ein Regal mit alten iMacs im Fenster der HfG Schwäbisch Gmünd. Auf jedem Bildschirm ein Kopf, in der
Mitte die HfG-Werbung. Eine Kamera über dem Regal erkennt Menschen, die draußen vorbeigehen, und alle
Köpfe drehen sich zu ihnen. Wer im WLAN der HfG ist, kann die Wand vom Handy aus umbauen.

Diese Datei ist die Übergabe: was wo läuft, wie man daran arbeitet, was zu tun ist, wenn etwas hängt,
und was noch offen ist.

---

## Auf einen Blick

| | |
|---|---|
| **Wand ansehen und umbauen** | im WLAN `hfg`: **http://hfg-wall.local:8080** → Tab **Gestalten** (umbauen) bzw. **Live** (ansehen) |
| **Betriebszeit** | iMacs **Montag bis Freitag 16:55 an, 21:30 aus** (von selbst); Ausnahmen und Änderungen im **Zeitplan** auf der Wand-Seite (Kalender-Symbol) |
| **Server** | Windows-Rechner **`hfg-wall`**, läuft durchgehend |
| **Änderung ausrollen** | `git push` auf `main` → spätestens 2 Minuten später live |
| **Auf den Server** | `ssh nakumu-02@hfg-wall.local` (nur mit eingetragenem Schlüssel, siehe unten) |
| **Alle iMacs steuern** | auf dem Server in Git Bash: `bash scripts/imacs.sh status` / `reload` / … |

---

## Wie alles zusammenhängt

```
                 WLAN "hfg" (HfG-Netz)                         Internet
   Handy / Laptop ─────────────┐                                   │
   http://hfg-wall.local:8080  │                          GitHub (Auto-Update)
                               │                                   │
                      ┌────────┴─────────────────────────────────┴───┐
                      │  Windows-Rechner  hfg-wall                     │
                      │  · Wand-Server (vite preview, Port 8080)       │
                      │    liefert die Seite, verteilt die Blickdaten  │
                      │  · Kamera-Seite in Chrome + USB-Webcam         │
                      │    Personenerkennung (YOLO) auf der GTX 1060   │
                      └────────┬───────────────────────────────────────┘
                               │ LAN-Kabel, 192.168.0.100 (ohne Router)
                           ┌───┴───┐
                           │Switch │  eigenes Netz 192.168.0.x, kein Internet
                           └───┬───┘
        ┌──────────┬──────────┼──────────┬──────────┬──────────┐
      iMac        iMac       iMac       iMac       iMac       iMac …
    Chromium 103 im Vollbild, je eine Seite: http://192.168.0.100:8080/?wall=custom&slot=N
```

- **Die Kamera-Seite** läuft auf dem Windows-Rechner. Sie wertet das Kamerabild aus und schickt nur drei
  Zahlen an den Server: wo das Gesicht der Person ist, in Metern. Kein Bild verlässt den Rechner.
- **Der Server** gibt diese Position an alle Bildschirme weiter (WebSocket `/gaze`). Jeder iMac rechnet
  daraus selbst, wohin sein Kopf schauen muss, abhängig davon, wo er im Regal steht.
- **Die iMacs** sind nur Anzeigen. Sie haben keinen Internetzugang, ihr WLAN ist aus. Sie hängen allein
  am Switch.

### Das Regal

```
 Spalte:   0           1              2
 Reihe 0   (kein iMac)  1 D.U.S.T.     2 V.O.L.T.
 Reihe 1   3 S.T.E.V.E. 4 Werbung      5 O.N.Y.X.
 Reihe 2   (kein iMac)  7 O.T.L.       8 R.A.M.S.
```

Die Zahl ist der **Platz** (`slot`) des iMacs. Belegung, Stand jetzt:

| Platz | Ort | IP | Modell | Grafik | Hinweis |
|---|---|---|---|---|---|
| 0 | oben links | – | – | – | **defekt**, findet sein Startvolume nicht (blinkender Ordner) |
| 1 | oben Mitte | 192.168.0.2 | iMac9,1 | NVIDIA GT 120 | |
| 2 | oben rechts | 192.168.0.4 | iMac7,1 | Radeon HD 2600 | |
| 3 | Mitte links | 192.168.0.5 | iMac8,1 | Radeon HD 2600 Pro | steht weiter außen, siehe `SLOT_SHIFT` |
| 4 | Mitte | 192.168.0.6 | iMac8,1 | Radeon HD 2600 Pro | Werbung; Kamera darüber |
| 5 | Mitte rechts | 192.168.0.1 | iMac8,1 | Radeon HD 2600 Pro | |
| 6 | unten links | – | – | – | **ohne Zugang** (Admin-Passwort unbekannt) |
| 7 | unten Mitte | 192.168.0.8 | iMac9,1 | NVIDIA GT 120 | |
| 8 | unten rechts | 192.168.0.7 | iMac7,1 | Radeon HD 2600 | |

Plätze ohne iMac stehen in `src/layout.ts` in `OFFLINE_SLOTS` und werden in allen Ansichten ausgelassen.

---

## Täglicher Betrieb

**Was von selbst passiert:**

1. Der **Windows-Rechner** läuft durchgehend. Nach einem Neustart meldet er sich automatisch an und
   startet Wand-Server, Kamera-Seite und WLAN-Wächter. Er geht nie in den Ruhezustand.
2. Die **iMacs** schalten sich **Montag bis Freitag** um **16:55** selbst ein, melden sich automatisch als `wall` an, warten,
   bis der Server antwortet, und öffnen ihre Seite im Vollbild. Um **21:30** fahren sie herunter.
   Nach einem Stromausfall starten sie von selbst wieder.
3. Stürzt ein Browser ab, startet er von selbst neu. Fällt der Server kurz aus, verbinden sich die
   Bildschirme innerhalb von 15 Sekunden wieder (Herzschlag alle 5 s).

Ein ausgeschalteter iMac lässt sich **nicht übers Netz** einschalten. Deshalb hat jeder seine eigene
Einschaltzeit (`pmset`), und der Server kann ihn nicht wecken.

**Zeiten ändern:** Kalender-Symbol oben rechts auf der Wand-Seite (`http://hfg-wall.local:8080/?view=schedule`).
Dort stehen die **Woche** (an, aus, Tage) und die **Ausnahmen**: von wann bis wann die Wand an bleibt oder aus bleibt
(Sonderbetrieb, Weihnachten, Ferien). Ändern darf das jeder im WLAN `hfg`, wie die Wand selbst. Gespeichert wird in
`walls/schedule.json` auf dem Server (übersteht Deploys, nicht im Repo).

So kommt das auf die iMacs (`src/schedule.ts`, `scripts/windows/plan.ps1`, `imacs.sh program`):

- **Alle 2 Minuten** (in „HfG Koepfe Update“) und einmal am Tag programmiert der Server die iMacs neu, wenn der
  Plan sich geändert hat und mindestens einer an ist: die Woche als Wiederholung, die nächste Abweichung als
  einmaliges Ereignis. Die Abschaltung selbst macht dann der iMac, auch ohne Server.
- **Sind alle aus, geht das nicht:** Sie wachen dann zur zuletzt programmierten Zeit auf und bekommen den Plan danach.
  Ein früheres Einschalten muss also eingetragen sein, solange sie noch an sind. Die Seite zeigt, ob der Plan auf den iMacs ist.
- **Täglich 17:05** („HfG Koepfe Ruhetage“): Soll die Wand laut Plan aus sein und ein iMac ist doch an (z.B. nach
  einem Stromausfall), fährt er ihn herunter.
- Probelauf ohne Wirkung: `powershell -File scripts\windows\plan.ps1 tick -dry`.

Protokoll: `logs\imacs.log`. Das Admin-Passwort der iMacs liegt dafür auf dem Server in
`C:\Users\nakumu-02\.hfg-imac-admin` (nur dieses Konto darf die Datei lesen).

---

## Werbung auf dem mittleren Bildschirm

Die HfG-Banner stehen in **Gestalten** in der Kategorie **Werbung**: Banner auf einen Bildschirm ziehen oder dort auswählen,
speichern, fertig. Jedes Banner zeigt erst seinen Kopf und blendet sich ein, wenn jemand 8 Sekunden stehen bleibt.
Banner und Sprüche stehen in `src/banners.ts`: `Werbung` (Weiß, vor F.L.U.X.) und `Werbung Halloween` (dunkel, vor J.A.C.K.,
wechselnde Sprüche).

---

## Analytics

Oben rechts in der Kopfleiste (am Handy in der Leiste unten) steht, wie viele vorbeigelaufen und wie viele
stehen geblieben sind. Der Server zählt mit, ob die Seite offen ist oder nicht (`src/analytics.ts`):

- **Passant**: jemand ist mindestens 1 Sekunde im Bild.
- **Besucher**: jemand bleibt mindestens 8 Sekunden, so lange, bis auch die Werbung kommt (`VISITOR_AFTER_MS`).

Das sind Schätzungen aus der Anzahl, die die Kamera sieht; die Kamera kennt keine Personen wieder. Wer länger als
3 Sekunden verloren geht, zählt doppelt. Gezählt wird, solange die Kamera läuft, also auch nachts. Die Zahlen
stehen pro Stunde in `walls/analytics.json` auf dem Server (übersteht Deploys, nicht im Repo).

## Die Wand umbauen (für alle im HfG-WLAN)

`http://hfg-wall.local:8080` → Tab **Gestalten**. Auf dem Handy landet man direkt dort. Die Seite läuft auf
Handy, Tablet und Laptop gleich (im Stil von iOS) und lässt sich auf dem iPhone über Teilen →
„Zum Home-Bildschirm“ wie eine App ablegen.

- Einen Bildschirm antippen bzw. anklicken → Kopf wählen → **Speichern**. Die iMacs laden innerhalb
  weniger Sekunden neu.
- Am Laptop lassen sich Köpfe auch aus der Liste auf einen Bildschirm ziehen und Bildschirme
  untereinander tauschen.
- **Bearbeiten** ändert das Regal selbst: **+** am Ende einer Reihe fügt einen Bildschirm hinzu (neue
  Platznummer ab 9), das rote Minus entfernt einen, **Reihe hinzufügen** eine Reihe; zwei Bildschirme
  nacheinander antippen tauscht sie. Für einen neuen Bildschirm muss natürlich auch ein iMac mit dieser
  Platznummer eingerichtet werden.
- **Wie die Hauptwand belegen** (unter Bearbeiten) setzt die Belegung aus `src/heads/designs.ts` zurück.
- **Speichern** und **Verwerfen** erscheinen unten, sobald es ungespeicherte Änderungen gibt.
- Gespeichert wird auf dem Server in `walls/custom.json`. Ist dort nichts gespeichert, zeigen die
  iMacs die Hauptwand.

**Die Werbung in der Mitte** zeigt normalerweise einen Kopf (F.L.U.X.). Steht jemand **8 Sekunden**
vor der Wand, blendet die HfG-Werbung darüber; **4 Sekunden** nachdem die Person weg ist, kommt der Kopf
zurück. Kopf und Zeiten: `PROMO_STAND_IN`, `PROMO_AFTER_MS`, `PROMO_HOLD_MS` in `src/wall.ts`.

Die anderen Tabs: **Köpfe** zeigt einen Kopf nach dem anderen (folgt der Maus bzw. dem Finger).
**Live** zeigt die gespeicherte Wand so, wie sie gerade läuft: die Köpfe folgen der echten Kamera am
Server, darunter Status, Anzahl der Personen und eine Draufsicht, wo jemand steht. Das Kamerabild selbst
geht nie übers Netz, nur Position und Anzahl. Der Tab startet keine eigene Kamera.

---

## Weiterentwickeln

Das Repo ist **öffentlich**, damit der Server ohne Anmeldung holen kann. Deshalb gehören keine Passwörter
und Schlüssel hinein (`hfg.env` steht in `.gitignore`). Pushen darf nur, wer auf GitHub als Collaborator
eingeladen ist.

```
git clone https://github.com/Litorian113/irobot.git
cd irobot
npm install
npm run dev          # http://localhost:5173, alle Tabs, Köpfe zum Ausprobieren
```

Gearbeitet wird auf **`main`**: genau diesen Branch rollt der Server aus. Das frühere Voice-/AI-Projekt
(LEIRA, VIKI) liegt unverändert im Branch **`voice-ai`**.

### Ausrollen

- **Von überall:** committen und `git push`. Der Server sieht alle 2 Minuten auf GitHub nach, holt den
  neuen Stand, baut, startet den Wand-Server neu und lädt alle iMacs und die Kamera-Seite neu.
  Was passiert ist, steht auf dem Server in `C:\hfg\irobot\logs\deploy.log`.
  Jeder Ausroll-Vorgang endet dort mit einer Zeile `Deploy: <Commit> - <Nachricht>` oder `Deploy abgebrochen: …`.
- **Sofort, aus dem HfG-WLAN:** `npm run deploy`. Pusht und rollt per SSH direkt aus
  (`scripts/deploy.sh`, Server über `HFG_SERVER`, Standard `nakumu-02@hfg-wall.local`).

Schlägt der Build fehl, läuft der alte Stand weiter. Vor dem Push lohnt sich lokal:

```
npm run build        # TypeScript + Build, wie auf dem Server
npm run lint
npm test             # Blick-Geometrie, Kopf-Rig
```

**Ganz wichtig: Alles, was auf den iMacs läuft, muss mit Chromium 103 und WebGL 1 auskommen.**
Im Tab Köpfe gibt es dafür „WebGL 1 testen".

### Einen neuen Kopf bauen

Gruselige Köpfe (Kategorie `gruselig`) nehmen denselben dunklen Hintergrund: `addDarkBackdrop` aus `src/heads/darkBackdrop.ts`.

Ein Eintrag in `src/heads/designs.ts`: Name, Beschreibung, Kategorien für den Filter über den Listen
(`categories`, ein Kopf darf in mehreren stehen), Platz (`slot`, oder `null` für „nur in der Auswahl") und eine `create`-Funktion, die ein `HeadView` liefert (`src/heads/types.ts`: `setLook`,
`setExpression`, `debug`, `dispose`). Die vorhandenen Köpfe in `src/heads/*/` sind gute Vorlagen,
z.B. `rams/` (einfache Geometrie) oder `onyx/` (eigene Shader). Danach die Vorschaubilder neu machen:
`npm run snapshots` (braucht Google Chrome).

### Code

| | |
|---|---|
| `src/heads/designs.ts` | alle Köpfe: Name, Platz, Renderer |
| `src/heads/*/` | die einzelnen Köpfe (Geometrie, Shader) |
| `src/layout.ts` | Wand als Reihen von Bildschirmen; `OFFLINE_SLOTS` |
| `src/analytics.ts` | Passanten und Besucher zählen (läuft auf dem Server) |
| `src/wall.ts` | Abstände, Kamera-Montage, Werbung, URL-Parameter, `SLOT_SHIFT` |
| `src/WallView.tsx`, `src/HeadCell.tsx` | eine Wand bzw. ein Bildschirm, wie die iMacs sie zeigen |
| `src/workbench/` | die Arbeitsseite: `Workbench.tsx` (Tabs, Seitenleiste), `Studio.tsx` (Köpfe), `WallEditor.tsx` + `useWallDraft.ts` (Gestalten), `LiveView.tsx` + `CameraCard.tsx` (Live), gemeinsame Bausteine in `ui.tsx`, Styles in `workbench.css` |
| `src/Promo.tsx` | die Werbung in der Mitte und ihr Kopf |
| `src/tracking/` | Kamera, Personenerkennung (Worker), Blick-Geometrie, WebSocket |
| `src/remoteLog.ts` | Bildschirme melden ihre Fehler an den Server |
| `vite.config.ts` | Server: WebSocket-Relay mit Herzschlag, `/api/custom-wall`, `/api/log` |
| `kiosk/` | Einrichtung der iMacs (Chromium, Autostart, SSH) |
| `scripts/imacs.sh` | alle iMacs fernsteuern |
| `scripts/windows/` | der Windows-Server: Autostart, Kamera, WLAN, Deploy, Auto-Update |
| `public/models/` | Kopfmodelle und das Erkennungsmodell YOLO26n |

---

## Der Windows-Rechner `hfg-wall`

Windows 10 Pro, Intel i5-7500T, NVIDIA GTX 1060, 16 GB. Repo unter **`C:\hfg\irobot`**.

**Netz**

- LAN-Anschluss **„Ethernet 2"**: fest **192.168.0.100** / 255.255.255.0, kein Gateway, kein DNS. Auf
  diese Adresse sind alle iMacs eingestellt. Der zweite LAN-Anschluss („Ethernet") bleibt frei.
- **WLAN `hfg`** (per DHCP): darüber Internet, GitHub und der Zugang von außen. Erreichbar unter
  **`hfg-wall.local`** (Name über mDNS). Achtung: Das WLAN-Profil nutzt ein persönliches HfG-Konto. Ändert
  sich dessen Passwort, ist der Rechner offline. Besser wäre ein Gerätezugang (z.B. `hfg-iot`), siehe
  offene Punkte.
- Firewall: Regel **„HfG Koepfe Wand"** erlaubt 8080 und 8090 aus 192.168.0.0/24 und 172.16.0.0/12,
  für jedes Netzprofil (Windows stuft das Kabelnetz ohne Router nach jedem Neustart als „öffentlich" ein).

**Aufgaben (Aufgabenplanung)**, eingerichtet mit `scripts\windows\install-server.ps1` (als Admin, wiederholbar):

| Aufgabe | Wann | Was |
|---|---|---|
| HfG Koepfe Server | beim Hochfahren, als SYSTEM | `wall-server.cmd`: Wand-Server, startet nach Absturz neu |
| HfG Koepfe Kamera | bei der Anmeldung | `camera.ps1`: Chrome im Vollbild, `http://127.0.0.1:8080/?slot=4&camera=1&preview=1` |
| HfG Koepfe WLAN | bei der Anmeldung | `wlan.ps1`: verbindet `hfg` neu, wenn die Verbindung fehlt |
| HfG Koepfe Update | alle 2 Minuten | `auto-update.ps1`: Zeitplan auf die iMacs (`plan.ps1 tick`), neuer Stand auf GitHub → `deploy.ps1` |
| HfG Koepfe Zeitplan | Mo–Fr 21:00 | `plan.ps1 abend`: Reserve, falls der Lauf alle 2 Minuten nicht geht |
| HfG Koepfe Ruhetage | täglich 17:05 | `plan.ps1 check`: laut Zeitplan aus, aber ein iMac an: herunterfahren |

**Protokolle** in `C:\hfg\irobot\logs\`: `wall-server.log` (Server und alle Meldungen der Bildschirme,
z.B. `[Platz 3 192.168.0.5] error: …`), `deploy.log`, `camera.log`.

**Automatische Anmeldung**: Benutzer `nakumu-02`. Das Passwort liegt verschlüsselt in Windows
(eingerichtet mit `netplwiz`).

**SSH**: OpenSSH-Server, **nur mit Schlüssel**, Passwort-Anmeldung ist aus. Einen neuen Schlüssel trägt
man in `C:\ProgramData\ssh\administrators_authorized_keys` ein (eine Zeile pro Schlüssel; die Datei darf
nur Administratoren und SYSTEM gehören). Den Schlüssel am besten als Datei übertragen, nicht abtippen.

**Zugang für weitere Leute** (`scripts/server-access.sh`, alles nur im WLAN `hfg` bzw. per HfG-VPN):

- Es gibt einen **Team-Schlüssel** nur für diesen Server. Er steht samt Verbindungsdaten in `hfg.env`, die nur
  lokal liegt (in `.gitignore`, nie ins Repo). Wer an die Wand darf, bekommt diese Datei, legt sie ins Repo
  und richtet sich mit `bash scripts/server-access.sh join` ein. Danach geht `ssh hfg-wall`, und
  `HFG_SERVER=hfg-wall npm run deploy` rollt sofort aus.
- Auf dem Server einmal eintragen (vom Rechner, der schon draufkommt): `bash scripts/server-access.sh team`.
- Sperren, z.B. wenn die Datei in falsche Hände geraten ist: `bash scripts/server-access.sh revoke`, dann mit
  `ssh-keygen -t ed25519 -N "" -C hfg-wall-team -f ~/.ssh/hfg-wall-team` einen neuen machen und `hfg.env`
  neu erzeugen.

**GitHub**: Der Server holt das öffentliche Repo ohne Anmeldung. Soll es einmal privat werden, braucht er
einen eigenen **Deploy-Key** (nur Lesen): vorher im WLAN `hfg` `bash scripts/server-access.sh github`.

**Software**: Node.js 24 LTS, Git for Windows (bringt Git Bash mit, darin laufen die `.sh`-Skripte),
Google Chrome.

---

## Die iMacs

OS X 10.11, Benutzer **`wall`** (automatische Anmeldung). Das Admin-Passwort bekommt ihr bei Franz.

**Browser: Chromium 103**, der letzte Stand für 10.11, im Kiosk-Modus.
Firefox 78 kommt nicht infrage, denn auf den iMacs mit NVIDIA GT 120 rendert er WebGL mit 1 Bild pro
Sekunde (der Treiber fällt dort auf die CPU zurück), und unter OS X geht er nicht ins Vollbild.

**Was auf jedem iMac eingerichtet ist** (`kiosk/HfG-Koepfe-Setup.command`):
`~/Applications/Chromium HfG.app`, ein Starter (`~/Library/Application Support/HfG-Koepfe/start.sh`), der bei
jeder Anmeldung auf den Server wartet und dann die Seite öffnet. Der Platz steht in `…/HfG-Koepfe/slot`.
Auf dem Schreibtisch liegen „HfG Köpfe" und „HfG Köpfe beenden".

Dazu, per `imacs.sh`:
- **`kiosk`**: WLAN aus, kein „Mit … verbinden"-Fenster, kein Tastatur-/Maus-Assistent beim Start.
- **`schedule`**: tägliche Ein-/Ausschaltzeit, Neustart nach Stromausfall, nie Ruhezustand.
- **SSH**: nur der Benutzer `wall`, nur mit Schlüssel, nur aus 192.168.0.x
  (`kiosk/HfG-SSH-Setup.command`; die alte Konfiguration liegt als `/etc/ssh/sshd_config.hfg-original`).

### Alle iMacs steuern

Auf dem Windows-Rechner in **Git Bash** (oder auf einem Mac, der am Switch hängt):

```
cd /c/hfg/irobot
bash scripts/imacs.sh status          # läuft der Browser, Platz, seit wann an
bash scripts/imacs.sh reload          # Seite auf allen neu laden
bash scripts/imacs.sh ssh 3           # Terminal auf Platz 3
bash scripts/imacs.sh run "uptime"    # Befehl auf allen
bash scripts/imacs.sh shutdown        # alle jetzt aus                        (Admin-Passwort)
bash scripts/imacs.sh schedule 16:55 21:30                                     (Admin-Passwort)
bash scripts/imacs.sh kiosk           # Pop-ups und WLAN aus                  (Admin-Passwort)
```

Das Admin-Passwort fragt das Skript ab oder nimmt es aus `IMAC_ADMIN_PASSWORD`. Die Liste der iMacs
(Platz und IP) steht in `kiosk/.cache/imacs`. `scan` erneuert sie, braucht aber `nc` und läuft deshalb nur
auf einem Mac. Der Server meldet sich mit seinem Schlüssel `~/.ssh/hfg-koepfe` an.

### Einen iMac (neu) einrichten

Am iMac mit Tastatur, als `wall` angemeldet:

1. Feste IP im Kabelnetz: Systemeinstellungen → Netzwerk → Ethernet → manuell, **192.168.0.x** (eine
   freie Adresse), Maske 255.255.255.0, kein Router.
2. Einrichtung: `HfG-Koepfe-Setup.command` vom USB-Stick doppelklicken (Stick bauen: `npm run usb --
   /Volumes/STICK`, **nur auf einem Mac**) und den Platz wählen.
3. SSH: `HfG-SSH-Setup.command` vom Stick (fragt einmal nach dem Admin-Passwort). Für den Windows-Server
   muss dessen Schlüssel `C:\Users\nakumu-02\.ssh\hfg-koepfe.pub` als `key` neben dem Skript liegen.
4. Danach vom Server aus: `kiosk` und `schedule`, und den iMac mit Platz und IP in `kiosk/.cache/imacs`
   eintragen.
5. Systemeinstellungen → Benutzer & Gruppen → Anmeldeoptionen → **automatische Anmeldung: wall**.

Der Weg übers Netz (`curl -s 192.168.0.100:8090/setup | bash`) braucht den Setup-Server
(`npm run setup-server`). Der läuft bisher nur auf einem Mac, siehe offene Punkte.

---

## Die Kamera

USB-Webcam („FULL HD webcam") am Windows-Rechner, oben über dem Regal, **kopfüber** montiert. Das
Bild wird deshalb vor der Erkennung um 180° gedreht, automatisch für jede externe Kamera (eine
eingebaute Laptop-Kamera nicht; erzwingen mit `?rotate=180` bzw. `?rotate=0`).

- **Vorschau**: auf dem Bildschirm des Windows-Rechners, Taste `D` blendet sie ein und aus. Sie zeigt das
  Bild, die erkannten Personen (lila: die, der die Köpfe folgen), die Montage und unter **„Ziel"**, wo die
  Person gerade ist (x, y, z in Metern, vom mittleren Bildschirm aus).
- **Dunkelheit**: Jedes Bild wird vor der Erkennung automatisch aufgehellt und im Kontrast gestreckt
  („Aufhellung" in der Vorschau, abschalten mit `?enhance=0`). Wer verfolgt wird, wird auch bei
  schwacher Erkennung gehalten; wer kurz verschwindet, wird noch 2 Sekunden angeschaut.
- **Fehler**: Ist die Kamera beim Start noch nicht bereit oder wird sie abgezogen, versucht die Seite es
  alle 5 Sekunden neu. Meldungen stehen mit `[Kamera]` in `wall-server.log`.

### Kalibrieren

Damit die Köpfe wirklich zur Person schauen, muss die Seite wissen, wo die Kamera hängt. Die Werte
kommen als Parameter an die Kamera-Adresse (in `scripts/windows/camera.ps1`, Variable `$url`):

| Parameter | Bedeutung | Stand |
|---|---|---|
| `cameray` | Höhe der Kamera über der Mitte des mittleren iMacs, Meter | 0.3 (Standard, **nicht gemessen**) |
| `camerax` | seitlicher Versatz, Meter, + = rechts von der Straße aus | 0 |
| `tilt` | wie viele Grad die Kamera nach unten schaut | 0 (**nicht gemessen**) |
| `spacing` | Abstand der Bildschirmmitten, Meter, `x,y` | 0.55,0.5 (**nachmessen**) |
| `fov` | horizontaler Bildwinkel der Kamera, Grad | 70 |

Vorgehen: messen und eintragen, dann stellt sich eine Person mittig etwa 2 m vor die Scheibe. Unter
„Ziel" sollte stehen: x ≈ 0, z ≈ 2, y ≈ Augenhöhe minus Höhe der mittleren Bildschirmmitte. Ist y zu
niedrig, ist `tilt` zu groß, und umgekehrt.

Steht ein iMac nicht im gleichmäßigen Raster (wie Mitte links), bekommt er in `SLOT_SHIFT`
(`src/wall.ts`) einen Versatz in Metern, damit sein Kopf richtig zielt.

---

## Wenn etwas nicht geht

| Was man sieht | Woran es liegt | Was hilft |
|---|---|---|
| Ein iMac zeigt den Schreibtisch statt der Wand | Starter wartet auf den Server, oder Browser beendet | `imacs.sh status`; Server prüfen; `imacs.sh reload` |
| Alle Köpfe schauen nur umher, folgen niemandem | Kamera-Seite läuft nicht oder sieht nichts | Bildschirm des Windows-Rechners: Vorschau? `logs\camera.log`, `[Kamera]` im Server-Log |
| `curl` / Seite auf dem iMac hängt stumm | keine Verbindung zum Server | Kabel, Switch (hat sich schon einmal aufgehängt: aus und wieder an) |
| `hfg-wall.local` geht nicht | Windows nicht im WLAN `hfg` | WLAN-Symbol am Rechner prüfen; der WLAN-Wächter verbindet nach der Anmeldung neu |
| iMacs nach Neustart des Servers „tot" | Firewall: Kabelnetz als öffentlich eingestuft | Regel „HfG Koepfe Wand" prüfen; `install-server.ps1` noch einmal ausführen |
| SSH: `Connection refused` | „Entfernte Anmeldung" am iMac aus | Systemeinstellungen → Freigaben → Entfernte Anmeldung |
| SSH: `Permission denied (publickey)` | Schlüssel fehlt oder ist falsch eingetragen | Schlüssel als Datei übertragen, nicht abtippen |
| Blinkender Ordner mit Fragezeichen | Mac findet kein Startvolume, oft Festplatte | Alt beim Start (Startvolume wählen), Cmd+R (Festplattendienstprogramm) |
| Ein Kopf ruckelt sehr | alte Grafikkarte | Kopf im Tab Köpfe mit „WebGL 1 testen" prüfen; Fehler stehen im Server-Log |
| Änderung kommt nicht an | Build fehlgeschlagen oder Auto-Update wartet | `logs\deploy.log`; `npm run deploy` zeigt den Fehler direkt |

Was ein bestimmter Bildschirm meldet (Fehler, Grafikkarte, Bildrate 20 s nach dem Laden), steht in
`wall-server.log`, z.B. `[Platz 1 192.168.0.2] info: Kopf nach 20 s: {… "renderedFps": 10 …}`.

---

## Offene Punkte

- [ ] **Team-Schlüssel eintragen** (im WLAN `hfg`): `bash scripts/server-access.sh team`, damit `hfg.env` geht.

- [ ] **Oben links**: iMac startet nicht (Startvolume / Festplatte). Ersetzen oder neu aufsetzen.
- [ ] **Unten links**: Admin-Passwort unbekannt. Zurücksetzen (Cmd+R → Terminal → `resetpassword`),
      dann einrichten wie oben. Danach in `OFFLINE_SLOTS` (`src/layout.ts`) die Platznummer entfernen.
- [ ] **Kamera kalibrieren**: `cameray`, `tilt`, `spacing` messen, und den Versatz von Mitte links in
      `SLOT_SHIFT`.
- [ ] **Setup-Server auf Windows**: `scripts/setup-server.sh` und `make-usb.sh` brauchen macOS
      (`ditto`, Python). Für die Einrichtung übers Netz von `hfg-wall` aus fehlt eine Windows-Fassung.
- [ ] **IT der HfG**: ein Gerätezugang fürs WLAN statt eines persönlichen Kontos (z.B. `hfg-iot`), eine
      feste Adresse oder ein Name (`wand.hfg-gmuend.de`) und ob man per VPN draufkommt. Damit dann:
      QR-Code auf der Werbung, und für Leute von außen eine Weiterleitung auf die HfG-Website.
- [ ] **Umbau auf Zeit**: Änderungen von Besuchern nach 15 Minuten automatisch zurücksetzen, mit
      Countdown (ist besprochen, noch nicht gebaut).
- [ ] M.A.X. (Platz 0) und W.A.L.L.·E (Platz 6) stehen auf ausgefallenen Plätzen und sind deshalb auf der
      Hauptwand nicht zu sehen; über die Live-Wand lassen sie sich anderswo hinsetzen.
- [ ] `npm run snapshots`: einige Vorschaubilder sind veraltet (z.B. O.T.L. noch mit rotem Hintergrund).

---

## URL-Parameter

| | |
|---|---|
| `?slot=N` | ein Bildschirm der Wand (ohne: alle auf einer Seite) |
| `?wall=custom` | die Live-Wand (so öffnen die iMacs ihre Seite) |
| `?view=heads` / `custom` / `live` / `analytics` | Ansicht der Arbeitsseite |
| `&camera=1` | Kamera und Erkennung in diesem Fenster (nur auf `localhost` / `127.0.0.1`) |
| `&preview=1` | Kameravorschau mit Erkennung (Taste `D`) |
| `&cam=logitech` | Kamera nach Namen wählen |
| `&rotate=180` / `0` | Kamerabild drehen oder nicht (Standard: externe Kamera gedreht) |
| `&enhance=0` | automatische Aufhellung aus |
| `&cameray=0.3` `&camerax=0` `&tilt=0` | Montage der Kamera (Meter, Grad) |
| `&spacing=0.55,0.5` | Abstand der Bildschirmmitten (Meter) |
| `&fov=70` | horizontaler Bildwinkel der Kamera |
| `&mouse=1` | die Maus spielt die Person (Test ohne Kamera) |
| `&stats=1` | Bildrate auf jedem Kopf |
| `&style=dust` | Kopf eines Platzes überschreiben (`dust` / `lattice`) |
| `&gltest=1` | statt des Kopfes ein WebGL-Leistungstest (Ergebnis im Server-Log) |

Tasten: `D` Kameravorschau, `F` Vollbild.

---

## Datenschutz

Die Kamerabilder werden auf dem Windows-Rechner im Browser von YOLO26n ausgewertet und sofort verworfen.
Es wird nichts aufgezeichnet, und kein Bild verlässt den Rechner. Über das Netzwerk geht nur, *ob* jemand
da ist und wo ungefähr (drei Zahlen in Metern). Auf dem Server bleibt davon nur, wie viele Passanten und Besucher
es pro Stunde waren.

## Credits

**Franz Anhäupl** · HfG Schwäbisch Gmünd. Köpfe: MakeHuman CC0 + Face Units von Mika Suominen.
Erkennung: Ultralytics YOLO26n (AGPL-3.0) über ONNX Runtime Web. Rendering: three.js.
S.T.E.V.E.: Pixelporträt nach dem Foto „Steve Jobs Headshot 2010" von Matthew Yohe
(Wikimedia Commons, CC BY-SA 3.0), erzeugt mit `scripts/portrait-from-photo.py`; das Porträt steht
ebenfalls unter CC BY-SA 3.0. Die Olympia-Piktogramme hinter O.T.L. sind eigene Figuren nach Otl Aichers
Gestaltungsregeln, nicht die Originale von 1972.
