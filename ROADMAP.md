# VIKI – aktueller Stand

## Akzeptierte Darstellung

Der feminine Kopf, die Augen und der Datenwürfel gefallen dem Nutzer. Diese Darstellung ist die Grundlage
für die weitere Arbeit. Die neutrale Geometrie, Normalen, Augen und bisherigen neun Modellposen wurden beim
Lippen-Upgrade nicht verändert; der direkte Vergleich mit der vorherigen GLB bestätigt identische Daten.
Bestehende Einstellungen unter `viki.config.v5.*` bleiben erhalten.

## Viseme-Upgrade umgesetzt – 7. September 2026

1. **Weitere Lippenposen auf demselben Kopf.** Aus dem bereits gebündelten CC0-Quellpaket sieben zusätzliche
   Targets exportiert: Mundschluss, Lippenpressen, Spitzen, Trichter, Oberlippe heben, Unterlippe senken und
   Unterlippe einrollen. Insgesamt 16 Positions-/Normalenmorphs; alle fünf Stile und der Tiefenpass teilen die Pose.
2. **Antwortaudio lokal auswerten.** Der gepinnte HeadAudio-Detektor klassifiziert die zurückkommende WebRTC-
   Audiospur in 15 Viseme einschließlich Stille. Keine zusätzliche API und keine Text-Timing-Schätzung.
   Modell und Worklet liegen lokal mit MIT-Lizenz und Herkunftsnachweis unter `public/vendor/headaudio/`.
3. **An die hörbare Ausgabe koppeln.** Ein einzelner WebAudio-Ausgang mit 100 ms Standardverzögerung.
   Zeitgestempelte Viseme werden anhand der Audioausgabe-Uhr abgespielt. Der letzte Laut läuft mit dem Ton aus;
   Unterbrechungen verwerfen gepufferten Ton und alte Animationen. Generationen schützen schnelle Neustarts
   vor verspäteten Nachrichten der vorherigen Antwort.
4. **Natürlicher mischen.** Kurze Fehlklassifikationen unterdrücken, Lautformen überblenden, Kieferöffnung
   begrenzen und B/P/M schneller schließen lassen. Während des Lippenverschlusses wird das Lächeln zurückgenommen.
   Bei einem Detektorfehler bleibt die Stimme hörbar; die einfache bisherige Mundanimation übernimmt.

Unter **Configure → Speech**: **Articulation** (0.5–1.5) und **Voice delay (ms)** (40–250), live einstellbar
und je Stil speicherbar. Die Vorschau zeigt eine simulierte Visemfolge; feste Posen sind mit
`?preview=neutral&freeze=1&viseme=PP` prüfbar. Weitere Namen und Diagnosehilfen stehen in der README.

## Durchgeführte Prüfungen

- 13 Node-Tests: tatsächliches Modell, alle Lippen-Targets, relative Morphs, unverformte Augäpfel,
  Blinzeln, Modellformat, Visem-ID 0, Zeitstempel, Glättung, Lippenverschluss, Stille und Zurücksetzen.
- Browser: alle fünf Stile, Vorschau, Speichern/Reset der Speech-Regler, Mobilansicht und altes Modell.
- Echter AudioWorklet mit englischem und deutschem lokalem Sprachclip über ein lokales WebRTC-Peer-Paar:
  unterschiedliche Lautformen, hörbarer Ausgang und geschlossener Mund nach Ende des verzögerten Tons.
- Verzögerung direkt auf der Audio-Uhr gemessen: 100 und 180 ms. Unterbrechen und schneller Neustart lassen
  keine gepufferten Testimpulse durch. Bei absichtlich fehlendem Detektormodell bleibt Audio hörbar.
- Realtime-Ereignisse separat mit simuliertem Handshake: normaler Abschluss, Unterbrechung, Neustart und Cleanup.
- Build und Lint. Keine OpenAI-Aufrufe oder echten Mikrofonaufnahmen in den automatisierten Prüfungen.

Wiederholbare Prüfskripte und Voraussetzungen stehen in `README.md`.

## Nächster Abgleich am Zielgerät

Ein echtes Gespräch mit der gewählten Realtime-Stimme führen. Zunächst **Articulation = 1** und
**Voice delay = 100 ms** verwenden. Mit kurzen Sätzen prüfen, z. B. „Bitte bring mir fünf blaue Blumen“ und
„Wie geht es dir? Oh, wirklich?“. Auf Lippenverschluss, gerundete Vokale, Pausen und Dazwischensprechen achten.
Die Artikulation kleiner stellen, wenn die Lippen zu stark arbeiten; bei träger Erkennung eine größere
Audioverzögerung ausprobieren, damit mehr Verarbeitungszeit verfügbar ist.

Das gebündelte Klassifikationsmodell ist auf englischer Sprache trainiert. Der deutsche Test bestätigt die
funktionierende Verarbeitung, keine phonetische Genauigkeit. Die Zuordnung bleibt eine Annäherung; die
Kopfgeometrie besitzt keine animierte Zunge. Falls einzelne deutsche Laute oder die Zielstimme unpassend wirken,
gezielt die Visemgewichte in `src/viki/visemes.ts` abstimmen oder ein sprach-/stimmenspezifisches Detektormodell
prüfen. Kopf und Augen dafür nicht erneut umformen.

## Dateien

- `scripts/build_head.py`, `scripts/model-source/SOURCES.md`: reproduzierbarer Blender-Build und CC0-Quellen.
- `src/viki/HeadRig.ts`: gemeinsames Rig; `src/viki/visemes.ts`: Lautposen und Animationstimeline.
- `src/viki/SpeechOutput.ts`: Ausgabe, Verzögerung, Detektor und Unterbrechungen.
- `public/audio/viseme-worklet.mjs`, `src/viki/visemeModel.ts`: lokale HeadAudio-Anbindung.
- `src/viki/realtime.ts`, `src/App.tsx`: Antwortstream und Ereignisse.
- `src/viki/config.ts`: Speech-Regler; `src/viki/ParticleFace.ts`: Übergabe an die gemeinsame Gesichtspose.
- `src/viki/SurfacePortrait.ts`, `headShader.ts`, `DataCube.ts`, `FacePass.ts`: akzeptierte Darstellung.


## Filmlook und Auflösung – umgesetzt

- Der Kopf verschwindet im inaktiven Zustand vollständig im Datenwürfel, einschließlich seiner Tiefensilhouette.
  Oberflächenpartikel verteilen sich während des Übergangs im Volumen; Aktivierung setzt den Kopf wieder zusammen.
- Zuhören, Denken und Sprechen halten das Gesicht vollständig sichtbar. Vorschau und Konfiguration funktionieren
  weiterhin ohne API-Verbindung. Der aktuelle Projektstand enthält die Stile Lattice und Dust.
- Lichtauswahl im rechten Konfigurationspanel: Soft portrait, Cinema grid und Butterfly. Gespeicherte Auswahl
  pro Stil, Regler für Höhe der Hauptlichtquelle, Schattenaufhellung und projiziertes Raster.
- Ein zusätzlicher Tiefenpass des animierten Kopfes erzeugt Schlagschatten von Nase, Lidern und Lippen.
  Keine Änderungen an GLB, Kopfproportionen oder Visemgewichten. Soft portrait erhält die frühere Lichtvariante.
- Browserprüfung erweitert: Ruhepose hat weder Farbe noch Tiefensilhouette, Vorschau löst sich nach Stop wieder
  auf, Lichtpresets schalten um und werden gespeichert. Visuelle Vergleiche frontal und während der Auflösung.
