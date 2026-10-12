# Zahlennest – Arbeitsanweisung für Claude

Montessori-inspirierte Lern-App (PWA) für Kinder ab 3: Mengen erleben, zählen, vergleichen – später Ziffern.
Zweite App der Nest-Familie (Absender **Lauschling**, „Zahlennest · eine App vom Lauschling“); Schwester-App
**Wortnest** liegt in `../Kinder-Lernapp` (live https://doganbedran.github.io/buchstaben/). Läuft offline im Browser,
keine Cloud, kein Tracking. Geplante Adresse: https://doganbedran.github.io/zahlennest/ (GitHub Pages aus `main`,
Repo `doganbedran/zahlennest`, **öffentlich**). Alles auf Deutsch: Oberfläche, Bezeichner, Kommentare, Commits.

Konzept (vom User freigegeben): `docs/konzept.md`, Konzept-Seite https://claude.ai/artifact/QkhZ69DqL326biX9aSA6tr
Gestaltungsrichtlinie der Familie: https://claude.ai/artifact/Gz3dEtZzQPZcjPagrsc398

## Wichtigste Regeln
- **Adresse nie ändern**, sobald sie online ist (Daten hängen an der Origin).
- **Wortnest nie verändern.** Beide Apps teilen die Origin `doganbedran.github.io` und damit localStorage/IndexedDB:
  - eigene IndexedDB **`zahlennest`** (nie `lernapp` öffnen außer *lesend* für „Aus Wortnest übernehmen“);
  - alle localStorage-Schlüssel mit Präfix **`zn:`** (Wortnest nutzt ungepräfixte Schlüssel wie `sterne`, `kind`,
    `spielzeit` – nie schreiben! Wortnest erkennt ein neues Gerät an fehlendem `sterne`);
  - gemeinsam mit Wortnest nur die Pause: `nest:spielzeit`, `nest:pauseNach`, `nest:pauseAm` (Wortnest nutzt sie
    seit seiner Version 71; Format nur in beiden Apps zugleich ändern).
  - Was Zahlennest aus Wortnest lesen darf, regelt **`../Kinder-Lernapp/docs/datenvertrag.md`** – vor dem Bau von
    „Aus Wortnest übernehmen“ lesen (u. a. `indexedDB.open('lernapp')` ohne Versionsnummer, nur lesend; Test
    `daten` dann anpassen).
- **Nichts Privates ins Repo:** keine Namen, Fotos oder Aufnahmen der Familie, keine Sicherungsdateien. Ausnahme:
  die Stimme des Users als Sprecher. Nie Kinderstimmen/Namen; neue Aufnahmen vor dem Push vom User anhören lassen,
  Push von Aufnahmen nur mit ausdrücklicher Freigabe im Chat.
- Keine Cloud-KI/-Dienste einbauen oder vorschlagen, außer der User fragt ausdrücklich.
- Zielgruppe 3–4: große Knöpfe, keine Texte für Kinder, kein „falsch“, Eltern-Funktionen hinter ⚙️ (2 s halten).
- Mathe-Regeln: Mengen vor Ziffern, kleine vor großen Zahlen (mit 3: 1–3 erkennen, bis 5 zählen; Ziffern/10 ab 4);
  ein Lernziel pro Spiel; gleich große Dinge in gleichem Abstand; **schieben statt tippen** beim Zählen; letzte Zahl
  betonen („eins, zwei, drei – drei Äpfel!“); jede Runde endet mit einem Auftrag in der echten Welt.
  Nicht hinein: Rechnen mit Ziffern, Plus/Minus, Zahlen über 10, Uhr, Geld, Zeitdruck, Abfragen.
  Keine Zahlen über das Kind (keine Zähler/Summen), nie Geschwister vergleichen; nach 2 Versuchen mitzählen,
  nach 3 Lösung zeigen und weiter.
- Farben: Akzent Petrol `#00796b` (Weiß 5,3:1). Beim Ziffern-Nachspuren **kein Petrol** – dort nur Blau `#1d5fbf`
  (Start) + Orange `#b8470b` (Pfeile) wie in Wortnest. Grundfarben/Formen/Schrift laut Gestaltungsrichtlinie.
- Zählfolgen als ganze Aufnahme einsprechen (nicht aus Einzel-Clips), „eins“ beim Zählen, „ein/eine“ vor Wörtern.

## Arbeitsablauf je Änderung
1. Testserver: `.venv/bin/python werkzeuge/testserver.py 8766 &` (Port 8766, Wortnest nutzt 8765).
2. Bauen; bei neuer Funktion Test `tests/<name>.js` + Eintrag in `werkzeuge/testseiten_erzeugen.sh` und
   `werkzeuge/alle_tests.sh` (Vorlagen: `../Kinder-Lernapp/werkzeuge/`).
3. `APP_VERSION` in `app.js` und `CACHE` in `sw.js` gemeinsam um 1 erhöhen; neue Offline-Dateien in `DATEIEN`.
4. `./werkzeuge/alle_tests.sh` – alle OK. **Push nur gekoppelt an den Exit-Code** und ohne nicht freigegebene `.wav`.
5. Commit + Push; danach live prüfen (`sw.js` mit neuer Cache-Nummer).
6. Kurzer Bericht auf Deutsch ohne Fachjargon: neu / getestet / nur am Handy prüfbar.

## Team und Abläufe (`.claude/`)
- Rollen: `paedagogin`, `bildungsplan`, `kinderpsychologin`, `ux-kinder`, `testerin`, `reviewer`, `datenschutz`,
  `kinder-tester` – Befunde als Muss / Sollte / Idee. `/neuer-inhalt`, `/veroeffentlichen`.
- Echte Beobachtungen der Kinder gehen vor dem virtuellen Team. Kinderwohl und Projektregeln entscheiden Widersprüche.

## Übernehmen aus Wortnest (Code als Vorlage, nicht verlinken)
Elternbereich, Kinder, Menschen/Hauptstimme, Studio, Mitmachen/Stimm-Paket, Sicherung (Prüfregeln beim Einspielen!),
Pause, Willkommen, Infoseite, Offline-Speicher (Test `offline`), Schrift Andika (`fonts/`, OFL), Spielende 🏠/🔁,
Drei-Stufen-Lektion („Zeig mir“), Trommel (Silben), „Wo ist bei dir …?“ → „Hol mir …“, Nachspuren (`striche.js`).
Gast-Lob neu: ein Gast fest je Spiel, lobt einmal am Spielende; nie Stimmwechsel mitten im Zählen.

## Testen – Stolperfallen (wie Wortnest)
- `.venv` und `.stimmen` sind lokale Verweise auf `../Kinder-Lernapp/` (Piper „Thorsten“); `./werkzeuge/alle_tests.sh kinder`
  startet nur Läufe, deren Name so beginnt.
- Wortnest löschte bis v72 beim Update fremde Caches (seit v73 behoben); Zahlennest füllt seinen Cache trotzdem bei
  jedem Start nach (`cache-pruefen`, Test `offline`).
- **Sicherheitsregel (CSP) wie Wortnest:** keine eingebetteten `<script>`, keine `on…`-Attribute, kein `eval`, keine
  fremden Adressen – auch nicht in Testseiten (`tests/<name>.vorher.js`, `tests/fertig-melden.js`). Test `sicherheit`,
  Beschreibung `docs/technik.md`.
- Firefox-Snap: Profile/Screenshots nur unter `~/snap/firefox/common/zahlennest-test/`; Firefox direkt starten
  (`/snap/firefox/current/usr/lib/firefox/firefox`), `user.js` mit `media.webspeech.synth.enabled=false`.
- Bildprüfung mit System-`python3` (PIL). Testserver über den Port stoppen, nie `pkill -f` im selben Befehl.
- Asynchrone Tests: `/_warten?ms=…` als iframe; auf `startFertig` warten. Skripte nie ändern, während Tests laufen.
- Schieben testen: Pointer-Events per `dispatchEvent` (Muster in Wortnest `tests/name.js`), `touch-action: none`.
