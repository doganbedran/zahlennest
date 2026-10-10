---
name: veroeffentlichen
description: Fertige Änderung an der App veröffentlichen – Version und Cache erhöhen, alle Tests, Datenschutz-Blick, Commit, Push, Live-Prüfung, kurzer Bericht. Nach jeder App-Änderung verwenden.
---

# Veröffentlichen

1. **Stand ansehen:** `git status`, `git diff`. Nichts Privates dabei (Namen, Fotos, Aufnahmen, Sicherungs-JSON,
   Screenshots)? Bei größeren Änderungen Agent `datenschutz` auf den Diff ansetzen.
2. **Version erhöhen** (nur wenn App-Dateien geändert wurden, nicht bei reinen Doku/Werkzeug-Änderungen):
   `APP_VERSION` in `app.js` und `CACHE` in `sw.js` **gemeinsam** um 1. Neue Dateien, die offline gebraucht werden,
   in `DATEIEN` in `sw.js` aufnehmen und prüfen, dass sie existieren.
3. **Testserver** prüfen (`ss -ltn 'sport = :8765'`), sonst starten: `.venv/bin/python werkzeuge/testserver.py 8765 &`
4. **Alle Tests:** `./werkzeuge/alle_tests.sh` – jede Zeile muss OK sein. Bei FEHLER: Screenshot unter
   `~/snap/firefox/common/zahlennest-test/t-<name>.png` ansehen, beheben, erneut. Nicht veröffentlichen, solange etwas rot ist.
5. **Commit** auf Deutsch, kurze Überschrift (was das Kind/die Eltern davon haben), dann `git push` – **nur gekoppelt an den Exit-Code der Tests** (`if ./werkzeuge/alle_tests.sh > datei; then … git push; fi`) und nur, wenn `git status` keine nicht freigegebenen `.wav` zeigt.
6. **Live prüfen:** nach ~1 Minute `curl -s https://doganbedran.github.io/zahlennest/sw.js | grep CACHE` – muss die neue
   Nummer zeigen (GitHub Pages braucht manchmal einige Minuten; ggf. nochmal prüfen).
7. **Bericht** an den User, kurz auf Deutsch ohne Fachjargon: was neu ist, was getestet wurde, was nur auf dem echten
   Handy prüfbar ist (Kamera, Mikrofon, Vibration, Finger). Hinweis: App einmal neu öffnen, damit das Update kommt.
