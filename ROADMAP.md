# VIKI – Überarbeitung umgesetzt

## Ziel und akzeptierter Stand

Die aktuelle Darstellung gefällt dem Nutzer grundsätzlich. Beibehalten: lesbares Gesicht aus feinen Datenpunkten,
weiches Licht, dezente Übergänge, drehbare Ansicht und Sprechvorschau. Noch offen:

- Augen wirken verzerrt.
- Der räumliche Datenwürfel um den Kopf fehlt.
- Das Gesicht soll femininer und näher an der beigefügten VIKI-Filmreferenz wirken.

Die Referenz zeigt einen großen, frontal lesbaren Gesichtsausschnitt innerhalb gestaffelter rechteckiger Lichtzellen.
Das Gesicht entsteht durch deren Helligkeit; es wirkt weniger wie ein vollständig freigestellter Kopf.
Die Bilder befinden sich im bisherigen Chat, nicht als bekannte Dateien im Repository. Bei einem neuen Chat ohne
Bilder die Filmreferenz erneut beilegen, bevor die abschließende visuelle Abstimmung erfolgt.

## Umsetzungsstand – 7. September 2026

Die fünf Implementierungsschritte sind eingebaut. Die folgenden Abschnitte halten den ursprünglichen Auftrag
als Prüfliste fest; „aktuell“ bezeichnet dort die Ausgangsbasis vor dieser Überarbeitung.

- Vergleichsbasis einschließlich damaliger Änderungen gesichert unter `/private/tmp/viki-roadmap-baseline/`.
- Feminines MakeHuman-Modell mit getrennten Augen, Mundraum und neun Morph Targets lokal erzeugt und integriert.
  Quellen, Lizenz und reproduzierbarer Blender-Build: `scripts/model-source/SOURCES.md`.
- Gemeinsame relative Positions-/Normalenmorphs in allen Stilen und im Tiefenpass; Iris nur auf echten Augäpfeln.
  Fehler korrigiert, durch den beim Zusammenführen der Geometrie jeder Gesichtsausdruck den Kopf verkleinerte.
  Augen und Lippen verwenden eine einzelne frontale Punktprojektion, die übrige Oberfläche stabile Modellkoordinaten.
- `DataCube.ts`: geordnete, versetzte Ebenen rechteckiger Lichtzellen mit Reglern für Dichte, Helligkeit, Tiefe und Abstand.
  Gesichtstextur und Tiefenpass halten die Zellen über Augen, Nase und Mund zurück.
- Audioanalyse steuert Öffnung, Breite und Rundung; Mundschluss in Pausen und Sprechvorschau bleiben erhalten.
- Neue Standardwerte unter `viki.config.v5.*`; vorhandene v3/v4-Einstellungen bleiben gespeichert.
- Diagnose `?inspect=1` und feste Vergleichsposen mit `?preview=neutral&freeze=1&mouth=0&blink=0&yaw=0` ergänzt.
- Vier Modell-/Rig-Integrationstests bestehen. Browserprüfung prüft zusätzlich alle fünf Stile, Sprechvorschau,
  synthetische Audioquelle/Stille, Würfelregler, Speicherung/Reset, Mobilansicht und den alten Modellpfad.

Die visuelle Prüfung verwendet weiterhin die im Chat beigefügte Filmreferenz. Die Umsetzung ist daran angelehnt;
Filmgeometrie und Filmtexturen wurden nicht übernommen. Offen bleibt ein echtes Gespräch mit Mikrofon und der
Antwortstimme auf dem Zielgerät; die automatisierten Kontrollen verwenden lokale Simulation und synthetisches Audio.

## 1. Vergleichsbasis sichern

- Vorhandene uncommittete Änderungen berücksichtigen und den funktionierenden Stand separat sichern.
- Vergleichsbilder frontal, in Dreiviertelansicht sowie mit geschlossenem/offenem Mund aufnehmen.
- Für vergleichbare Aufnahmen Zeit, Blickrichtung und Blinzeln fixieren.
- Diagnoseansicht mit normaler, undurchsichtiger Beleuchtung ergänzen. Damit unterscheiden wir Fehler des
  Kopfmodells und seiner Verformung von Fehlern der Punktprojektion oder Transparenz.

**Fertig, wenn:** Augenfehler reproduzierbar sind und wir ihre Ursache eingrenzen können.

## 2. Geeignetes feminines Kopfmodell als Grundlage

Der aktuelle Lee-Perry-Smith-Scan ist ein männlicher Kopf. Weitere extreme Änderungen an Kiefer, Nase und
Brauen im Shader sind keine verlässliche Grundlage für die gewünschte Ähnlichkeit.

- Ein geeignetes feminines GLB auswählen oder ein Modell gezielt bearbeiten; Nutzungsrechte und Attribution prüfen.
- Gewünschte Eigenschaften: natürliche Proportionen, saubere Augenlider, modellierter Mundraum und möglichst
  Morph Targets für Kieferöffnung, Lippenformen, Lächeln und linkes/rechtes Blinzeln.
- Modell zunächst ohne Punkte und ohne Bloom beurteilen. Erst danach die Datenoptik übertragen.
- `ParticleFace.loadHead()` umbauen: derzeit wird nur die Geometrie des ersten Meshes übernommen. Bei einem
  mehrteiligen oder animierten Modell müssen Gesicht, Augen und Mund sowie deren Transformationen gezielt geladen werden.
- Modellmaßstab und Merkmalspositionen neu bestimmen. Die aktuellen `REF_SCALE`-Werte und Augen-/Mundanker
  in `config.ts` und `headShader.ts` sind an den alten Scan gebunden.
- Bestehendes Modell bis zur erfolgreichen Integration als Rückfalloption behalten.

**Fertig, wenn:** Schon das neutral beleuchtete Modell die gewünschte feminine, freundliche Wirkung hat.

## 3. Augen und gemeinsame Verformung sauber integrieren

- Keine weiteren pauschalen hellen oder schwarzen Flecken über die Augen malen.
- Anatomie, Lidbewegung und ggf. dezente Iris aufeinander abstimmen. Augen im selben Datenmaterial halten;
  keine separat leuchtenden Augäpfel.
- Morph Targets bzw. Skinning ausdrücklich in die benutzerdefinierten Shader integrieren. Ein animiertes GLB
  allein genügt nicht: die bisherigen Shader verformen direkt `position` und berücksichtigen kein Rig.
- Oberflächen- und Tiefenpass müssen dieselbe Verformung erhalten. Sonst entstehen wieder Löcher oder Doppelkonturen.
- Normalen zur verformten Geometrie passend berechnen. Bei Bedarf Punktprojektion im Augenbereich auf stabile
  Modellkoordinaten/UVs umstellen; die aktuelle triplanare Projektion kann dort Verzerrungen beitragen.
- Blinzeln zunächst langsam prüfen, anschließend auf natürliche Geschwindigkeit abstimmen.

**Fertig, wenn:** Offene, halb geschlossene und geschlossene Augen frontal und seitlich ohne Verzerrungen erscheinen.

## 4. Den Datenwürfel wiederherstellen

- Eigenständige Würfelebene ergänzen, beispielsweise `DataCube.ts`, innerhalb derselben Rotationsgruppe wie der Kopf.
- Sichtbare räumliche Tiefe durch mehrere geordnete Ebenen kleiner rechteckiger Lichtzellen herstellen.
  Eine reine Umrissbox oder zufällige Sternenpunkte reichen für die Referenz nicht aus.
- Zunächst wenige Ebenen aufbauen und Dreidimensionalität beim Drehen prüfen; danach Dichte erhöhen.
- Gesicht als lesbare Oberfläche erhalten. Würfelzellen vor dem Gesicht sehr zurückhaltend darstellen;
  hintere Zellen durch den vorhandenen Tiefenpass verdecken oder kontrolliert abdunkeln.
- Erst danach Zellen nahe der Gesichtsoberfläche leicht durch deren Form/Helligkeit beeinflussen, damit Kopf
  und Würfel optisch zusammengehören. `FacePass.ts` kann dafür wieder als Hilfstextur genutzt werden.
- Regler für Würfeldichte, Zellenhelligkeit, Tiefe und Abstand zum Gesicht vorsehen.
- Nicht zum alten ungebremst additiven Volumen zurückkehren: Es hat Augen und Mund überstrahlt.

**Fertig, wenn:** Der Würfel frontal und gedreht klar erkennbar ist, während Augen, Nase und Lippen lesbar bleiben.

## 5. Sprechen und Filmlook abstimmen

- Vorhandene Audioanalyse aus `lipsync.ts` auf die neuen Mundformen abbilden: Öffnung, Breite und Rundung.
- Kiefer und Lippen zusammen bewegen; Mundschluss und Pausen zuverlässig erhalten.
- Mit Audioenergie allein keine exakte Phonem-Synchronität versprechen. Falls später präzise Lautformen nötig sind,
  eine zusätzliche Quelle für zeitlich passende Viseme prüfen.
- Erst mit stabilen Augen und Mundbewegungen Bildausschnitt, silbrig-kühle Farben, Zellgröße und Bloom an die
  Filmreferenz annähern. Schädel und Ohren können im Datenwürfel stärker zurücktreten.
- Grundausdruck mit leichtem Lächeln und ruhigen Brauen abstimmen, ohne das Modell zu überzeichnen.

**Fertig, wenn:** Eine kurze Sprechsequenz frontal und in Dreiviertelansicht freundlich und zusammenhängend wirkt.

## Prüfung und betroffene Dateien

- `npm run build`, `npm run lint`, WebGL-Konsole auf Fehler prüfen.
- Sprechvorschau starten/stoppen; geschlossener Mund, mehrere Öffnungen, Blinzeln, Lächeln und Drehung vergleichen.
- Alle fünf Stile, mobile Ansicht sowie Konfiguration/Speichern/Zurücksetzen prüfen.
- Bildrate auf dem Zielgerät messen; zusätzliche Würfelebenen und Bloom entsprechend begrenzen.
- Ein echtes Gespräch separat prüfen, sobald die Darstellung stabil ist. Die bisherigen Kontrollen nutzten Simulation.

Aktueller Aufbau nach Umsetzung:

- `HeadRig.ts`: mehrteiliger Modellimport, gemeinsame Morph-Reihenfolge und Pose.
- `SurfacePortrait.ts`: Oberflächenpunkte und identischer Tiefenpass.
- `headShader.ts`: relative Morphs, Beleuchtung und modellbezogene Merkmale.
- `DataCube.ts`: räumlicher Datenwürfel mit rechteckigen Zellen.
- `FacePass.ts`: Fronttextur für den Würfel; weitere Ansichten für Diagnose.
- `ParticleFace.ts`: Szene, Rotation, Blinzeln, Mundsteuerung und Kamera für schmale Displays.
- `sampleSurface.ts`: animierte Oberflächenpartikel für Dust.
- `config.ts`: neue Modellanker, Würfelregler und Speicherung unter `viki.config.v5.*`.
- `scripts/build_head.py`: reproduzierbarer Offline-Build des GLB.
- `scripts/head-rig.test.mjs`: Integrationstests des tatsächlichen Modells (`npm test`).
- `scripts/review-browser.mjs`: wiederholbare visuelle Prüfung; siehe README für Aufruf und Voraussetzungen.

## Noch separat zu prüfen

Ein echtes Gespräch starten, auf Mundschluss zwischen Antworten achten und die Wirkung beim Zuhören/Sprechen
am eigenen Display beurteilen. Exakte Phonem-Synchronität erfordert später eine zeitlich passende Visemquelle;
die aktuelle Audiosteuerung ist eine Annäherung über Frequenzband-Energie.
