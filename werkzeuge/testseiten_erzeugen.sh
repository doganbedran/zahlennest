#!/usr/bin/env bash
# Erzeugt die Testseiten tests/<name>.html aus der aktuellen index.html (läuft automatisch in alle_tests.sh).
# Jede Seite = App + tests/<name>.js; <base href="/"> lässt die App ihre Dateien (app.js, audio/ …) vom Hauptordner laden.
# Die erzeugten .html-Dateien stehen in .gitignore.
set -euo pipefail
cd "$(dirname "$0")/.."

# seite <name> <Wartezeit ms oder 0> [Skript, das vor der App läuft (z. B. Daten von Wortnest vorbelegen)]
seite() {
  local name=$1 warten=$2 vorher=${3:-}
  # Begrüßung beim ersten Start überspringen (außer im Test dafür)
  [ "$name" != willkommen ] && vorher='  localStorage.setItem("zn:willkommen", "true");'$'\n'"$vorher"
  local nachher="  <script src=\"tests/$name.js\"></script>"
  # Sobald unten die Ergebnisleiste (OK/FEHLER/ABSTURZ) erscheint, dem Testserver „fertig“ melden: dann kommt das
  # Bildschirmfoto gleich und nicht erst nach der Höchstzeit
  nachher+=$'\n'"  <script>new MutationObserver((_, b) => { const l = [...document.body.children].find((e) => e.style && e.style.bottom === '0px' && /OK|FEHLER|ABSTURZ/.test(e.textContent)); if (l) { b.disconnect(); setTimeout(() => fetch('/_fertig?id=$name'), 400); } }).observe(document.body, { childList: true });</script>"
  [ "$warten" != 0 ] && nachher+=$'\n'"  <iframe src=\"/_warten?ms=$warten&id=$name\" hidden></iframe>"
  VORHER="$vorher" NACHHER="$nachher" /usr/bin/python3 - "$name" <<'PY'
import os, sys
s = open('index.html', encoding='utf-8').read()
s = s.replace('<head>', '<head>\n  <base href="/">', 1)
s = s.replace('  <script src="ansagen.js"></script>', f"  <script>\n{os.environ['VORHER']}\n  </script>\n  <script src=\"ansagen.js\"></script>", 1)
s = s.replace('  <script src="app.js"></script>', '  <script src="app.js"></script>\n' + os.environ['NACHHER'], 1)
open(f'tests/{sys.argv[1]}.html', 'w', encoding='utf-8').write(s)
PY
}

# Wortnest-Daten auf derselben Adresse vortäuschen: dürfen danach unverändert sein
WORTNEST='  localStorage.setItem("sterne", "{\"a\":2}");
  localStorage.setItem("kind", "\"k-wortnest\"");
  localStorage.setItem("spielzeit", "{\"ms\":5000,\"letzte\":1}");
  localStorage.setItem("pauseNach", "15");'

seite startseite 10000
seite willkommen 6000
seite info 5000
seite kinder 10000
seite pause 8000
seite daten 10000 "$WORTNEST"
seite wieviele 45000
seite mehr 60000
seite korb 90000
seite offline 20000
echo "Testseiten erzeugt"
