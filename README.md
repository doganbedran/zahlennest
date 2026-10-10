# Zahlennest

Montessori-inspirierte Lern-App für Kinder ab 3: Mengen erleben, zählen, vergleichen – später Ziffern.
Läuft im Browser als installierbare App (PWA), offline, ohne Werbung, ohne Konto und ohne Tracking; alle Daten bleiben
auf dem Gerät. Zahlennest · eine App vom Lauschling – Schwester-App von
[Wortnest](https://doganbedran.github.io/buchstaben/).

**Ausprobieren:** https://doganbedran.github.io/zahlennest/ – im Browser öffnen, auf dem Handy „Zum Startbildschirm
hinzufügen“. Elternbereich: ⚙️ oben rechts 2 Sekunden halten. Fragen und Ideen gern als Issue hier auf GitHub.

**Stand:** im Aufbau – Grundgerüst steht, die Spiele kommen eins nach dem anderen. Konzept: [`docs/konzept.md`](docs/konzept.md).

## Lizenz
- Programmcode und eigene Zeichnungen (`bilder/`, Symbol): [GNU AGPL 3.0](LICENSE)
- Aufnahmen des Sprechers (sobald es sie gibt, Liste in `audio/sprecher.json`): CC BY-NC-ND 4.0 – siehe [audio/LIZENZ.md](audio/LIZENZ.md)
- Vorläufige Aufnahmen: Piper „Thorsten“ (Datensatz CC0, Modell MIT)
- Schrift: Andika von SIL International, mitgeliefert in `fonts/` (SIL Open Font License 1.1, `fonts/OFL.txt`)

## Dateien
- `app.js` – Logik (Startseite, Kinder, Regal, Pause, Elternbereich); `index.html`, `style.css` – Oberfläche
- `ansagen.js` – Texte aller Ansagen (eine Quelle für App, Offline-Speicher und Piper)
- `sw.js`, `manifest.webmanifest`, `icons/` – Installation & Offline; `bilder/` – eigene Zeichnungen
- `tests/<name>.js` – Tests (grüne Leiste unten = OK); `werkzeuge/testseiten_erzeugen.sh` baut daraus mit der aktuellen
  `index.html` die Seiten `tests/<name>.html` (nicht im Repo). Alle auf einmal: `./werkzeuge/alle_tests.sh`
  (Testserver: `.venv/bin/python werkzeuge/testserver.py 8766`)
- `werkzeuge/audio_erzeugen.py` – vorläufige Ansagen mit Piper; `werkzeuge/symbol_erzeugen.sh` + `symbol.html` – App-Symbol

## Daten neben Wortnest
Beide Apps liegen unter `doganbedran.github.io` und teilen sich damit den Browser-Speicher. Zahlennest nutzt darum
eine eigene Datenbank `zahlennest`, nur Schlüssel mit `zn:` und gemeinsam mit Wortnest nur die Pause (`nest:spielzeit`,
`nest:pauseNach`, `nest:pauseAm`; Format in `app.js` beim Abschnitt „Pause“). Der Offline-Speicher räumt nur eigene
Caches (`zahlennest-…`) auf.
