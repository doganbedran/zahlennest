# Technik (für Entwickler)

## Schutz gegen Angriffe (wie Wortnest)
- **Sicherheitsregel (Content Security Policy)** als `<meta>` in `index.html`: Skripte, Stile, Schriften, Bilder, Töne
  und Verbindungen nur von der eigenen Adresse; Fotos vom Gerät als `blob:`/`data:`. Damit laufen eingeschleuste
  Skripte, `onerror`-/`onclick`-Attribute und `javascript:`-Links nicht, und nichts kann Daten an fremde Adressen
  schicken. `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
  Folgen für den Code: **keine eingebetteten `<script>`-Blöcke, keine `on…`-Attribute, kein `eval`/`new Function`,
  keine fremden Adressen** – auch nicht in Testseiten: deren Vorbereitung steht in `tests/<name>.vorher.js` (erzeugt),
  die „fertig“-Meldung an den Testserver in `tests/fertig-melden.js`. Stil-Attribute sind erlaubt (`style-src-attr`).
- **Nicht einbettbar:** Läuft die App in einem fremden Rahmen (`window.top !== window.self`), zeigt sie nur einen Link
  „in einem eigenen Fenster öffnen“ und startet nicht (Schutz vor Klick-Fallen). GitHub Pages erlaubt keine eigenen
  HTTP-Header, darum per Skript.
- **Link-Schutz:** `<meta name="referrer" content="no-referrer">`; externe Links mit `rel="noopener"`.
- Test `sicherheit` versucht all das (Skript einschleusen, Attribut, `javascript:`, fremdes Skript, Bild und `fetch` an
  fremde Adresse, Einbetten) und prüft, dass eigene Fotos weiter funktionieren. Gegenprobe: ohne die Regel ist er rot.
- Grenze: Wer das GitHub-Konto übernimmt, kann auch diese Regeln ändern – Konto-Schutz steht in Wortnests
  `docs/betrieb.md` (gleiches Konto).

## Daten neben Wortnest
Eigene Datenbank `zahlennest`, Schlüssel nur mit `zn:`, gemeinsam nur die Pause (`nest:…`). Was Zahlennest aus Wortnest
lesen darf: `../Kinder-Lernapp/docs/datenvertrag.md`. Der Offline-Speicher räumt nur eigene Caches (`zahlennest-…`) auf
und füllt sich beim Start selbst nach (`cache-pruefen`).

**Kinder aus Wortnest übernehmen** (Elternbereich, Knopf nur sichtbar, wenn es `lernapp` gibt): öffnet `lernapp` an
genau einer Stelle ohne Versionsnummer (`wortnestKinderLesen`), bricht ein Anlegen ab und liest nur `kinder`.
Übernommen werden Name (Text, ≤ 20), Tier (nur aus der eigenen Liste) und Foto (nur JPEG/PNG/WebP); das Kind bekommt
eine eigene ID und merkt sich `wortnestId`, damit nichts doppelt kommt. Tests `uebernehmen` und `daten`.

**Eigene Stimmen** (Elternbereich „Stimmen“): Menschen = Store `profile` (`{ id 'p-…', name, erstellt, wortnestId? }`),
Fotos und Aufnahmen im Store `medien` mit Schlüssel `<profil>|<platz>|<art>` wie in Wortnest (`ich|bild`,
`datei:ansage-<name>.wav|stimme`). Wer spricht: `kind.stimme`, ohne Kinder `zn:stimme`; `null` = Computerstimme.
`stimmeLaden()` legt die Aufnahmen der aktiven Stimme als Objekt-URLs bereit, `ansageUrl(name)` nimmt sie vor
`audio/ansage-<name>.wav`. Studio wie Wortnest (gedrückt halten, 22 050 Hz, Stille abschneiden, angleichen);
Mikrofon nur im Studio, beim Verlassen/im Hintergrund zu. Aus Wortnest kommen Menschen mit Name/Foto und die
Hauptstimme der Kinder, keine Aufnahmen (andere Sätze). Test `stimme`.
