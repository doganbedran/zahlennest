# Zahlennest

Montessori-inspirierte Lern-App für Kinder ab 3: Mengen erleben, zählen, vergleichen – später Ziffern.
Läuft im Browser als installierbare App (PWA), offline, ohne Werbung, ohne Konto und ohne Tracking; alle Daten bleiben
auf dem Gerät. Zahlennest · eine App vom Lauschling – Schwester-App von
[Wortnest](https://doganbedran.github.io/buchstaben/).

**Ausprobieren:** https://doganbedran.github.io/zahlennest/ – im Browser öffnen, auf dem Handy „Zum Startbildschirm
hinzufügen“. Elternbereich: ⚙️ oben rechts 2 Sekunden halten. Fragen und Ideen gern als Issue hier auf GitHub.

**Stand:** im Aufbau – Grundgerüst steht, die Spiele kommen eins nach dem anderen. Konzept: [`docs/konzept.md`](docs/konzept.md).

## Spiele
- ✋ **Wie viele?** (ab 3) – Mengen 1 bis 3 auf einen Blick erkennen, als Drei-Stufen-Lektion mit Würfelpunkten:
  👀 „Das sind zwei.“ → 👂 „Wo sind drei?“ → 🗣️ „Wie viele sind das? Sag es!“. Daneben getippt: Die App benennt,
  beim zweiten Mal zählt sie mit (Punkte leuchten), beim dritten zeigt sie die Lösung. Zum Schluss: „Zeig mir zwei
  Finger!“ – ein Erwachsener tippt 👍, die App zählt die Finger mit.
- **Mehr oder weniger?** (ab 3, Kachel: zwei Teller) – zwei Teller mit Äpfeln, Eiern oder Bällen: „Wo sind mehr?“.
  8 Runden, erst große Unterschiede (1:4), dann kleinere (1:2), nie knapp. Daneben getippt: Die Dinge stellen sich
  paarweise gegenüber („Schau mal!“), beim zweiten Mal zählt die App beide Teller, beim dritten zeigt sie die Lösung.
  Im Elternbereich je Kind: nach 4 Runden auch „Wo sind weniger?“. Zum Schluss: „Zeig mir deine Augen! Und jetzt
  deine Nase!“ – „Zwei Augen und eine Nase. Da sind mehr Augen!“
- 🧺 **In den Korb zählen** (3–4) – „Leg drei Äpfel in den Korb.“ (Auftrag als Punktkarte, keine Ziffer). Das Kind
  schiebt die Dinge mit dem Finger in den Korb, bei jedem Ankommen sagt die App die neue Zahl; sind es genug, leuchten
  alle: „Drei Äpfel!“. Daneben bleibt liegen, Herausnehmen geht. Ohne Tun: Auftrag nochmal, dann Mitzählen und eine
  Hand zeigt den Weg, dann legt die App den Rest hinein. Je Kind: Mengen bis 5 (sonst 1–3), Antippen statt Schieben.
  Zum Schluss: „Leg drei Bausteine in einen Becher!“
- 🥁 **Zahlen-Trommel** (3–4) – „Hau dreimal auf die Trommel!“ (Auftrag als Punktkarte). In den ersten zwei Runden
  trommelt die App vor, dann das Kind: jeder Schlag „Bumm“, ein Punkt füllt sich, die Zahl wird gesagt; danach ruht
  die Trommel und die App sagt „Dreimal!“. Doppeltipps zählen als ein Schlag, kein Takt. Bei einer Pause bleiben die
  Punkte: „Hau weiter!“, dann trommelt die App den Rest mit. Je Kind: Mengen 3 bis 5. Zum Schluss: „Klatsch dreimal
  in die Hände!“
- 🥄 **Hol mir …** (3–4) – ganz in der echten Welt: „Hol mir zwei Löffel!“ (Karte mit Punkten und Ding). Das Kind holt
  die Dinge, ein Erwachsener tippt 👍: „Leg sie hin! … Zeig auf jeden Löffel!“, die App zählt langsam mit, dann
  „Danke! Bring sie wieder zurück.“ 2 Runden, keine Zeitgrenze. Je Kind: welche Dinge (Löffel, Becher aus Plastik,
  Bausteine, Kuscheltiere – nur Ungefährliches) und Mengen 3 bis 5.

Alle Spiele enden gleich: Das Spiel macht den Auftrag einmal vor, dann „Jetzt in echt!“ – der Bildschirm wird ruhig
(👐, kleine Erinnerungskarte), das Kind macht es mit echten Dingen; ein Erwachsener tippt 👍, dann zählt die App mit.

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
Caches (`zahlennest-…`) auf. Kinder lassen sich im Elternbereich aus Wortnest übernehmen (nur lesend, Name/Tier/Foto).
