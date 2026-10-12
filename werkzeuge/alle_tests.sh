#!/usr/bin/env bash
# Führt alle Testseiten in Firefox (headless) aus und meldet OK/FEHLER je Test.
# Erwartet den Testserver:  .venv/bin/python werkzeuge/testserver.py 8766   (Wortnest nutzt 8765)
# Nur bestimmte Läufe:  ./werkzeuge/alle_tests.sh kinder start   (Anfang des Namens)
# Ergebnis = Farbe der Leiste unten (grün = OK); Screenshots in ~/snap/firefox/common/zahlennest-test/.
set -uo pipefail
cd "$(dirname "$0")/.."
./werkzeuge/testseiten_erzeugen.sh >/dev/null
D=~/snap/firefox/common/zahlennest-test   # Snap-Firefox darf nur in ~/snap schreiben
mkdir -p "$D"
URL=http://localhost:8766
# Firefox direkt starten (die Snap-Hülle scheitert manchmal mit "cannot create transient scope"); sonst die Hülle
FF=/snap/firefox/current/usr/lib/firefox/firefox
[ -x "$FF" ] || FF=firefox
LAEUFE=(
  "startseite|tests/startseite.html|412,860|60"
  "start-klein|tests/startseite.html|360,640|60"
  "start-tab|tests/startseite.html|1280,800|60"
  "start-quer|tests/startseite.html|860,412|60"
  "willkommen|tests/willkommen.html|412,860|60"
  "info|tests/info.html|412,860|60"
  "kinder|tests/kinder.html#wer|412,860|90"
  "pause|tests/pause.html|412,860|60"
  "uebernehmen|tests/uebernehmen.html|412,860|60"
  "stimme|tests/stimme.html|412,860|60"
  "stimme-quer|tests/stimme.html|860,412|60"
  "daten|tests/daten.html|412,860|60"
  "wieviele|tests/wieviele.html|412,860|90"
  "wieviele-klein|tests/wieviele.html|360,640|90"
  "wieviele-tab|tests/wieviele.html|1280,800|90"
  "wieviele-quer|tests/wieviele.html|860,412|90"
  "mehr|tests/mehr.html|412,860|120"
  "mehr-klein|tests/mehr.html|360,640|120"
  "mehr-tab|tests/mehr.html|1280,800|120"
  "mehr-quer|tests/mehr.html|860,412|120"
  "korb|tests/korb.html|412,860|150"
  "korb-klein|tests/korb.html|360,640|150"
  "korb-tab|tests/korb.html|1280,800|150"
  "korb-quer|tests/korb.html|860,412|150"
  "trommel|tests/trommel.html|412,860|120"
  "trommel-klein|tests/trommel.html|360,640|120"
  "trommel-tab|tests/trommel.html|1280,800|120"
  "trommel-quer|tests/trommel.html|860,412|120"
  "hol|tests/hol.html|412,860|90"
  "hol-klein|tests/hol.html|360,640|90"
  "hol-tab|tests/hol.html|1280,800|90"
  "hol-quer|tests/hol.html|860,412|90"
  "holeigen|tests/holeigen.html|412,860|60"
  "sicherheit|tests/sicherheit.html|412,860|60"
  "offline|tests/offline.html|412,860|60"
)
fehler=0
for lauf in "${LAEUFE[@]}"; do
  IFS='|' read -r name seite groesse zeit <<< "$lauf"
  if [ $# -gt 0 ]; then
    passt=0; for f in "$@"; do [[ "$name" == "$f"* ]] && passt=1; done
    [ $passt = 1 ] || continue
  fi
  rm -rf "$D/p-$name" "$D/t-$name.png"; mkdir -p "$D/p-$name"
  # Sprachausgabe im Test-Firefox aus: sonst schreibt speech-dispatcher bei jedem Start Tausende Zeilen
  # Stimmenliste in /run/user/<uid>/speech-dispatcher/log (lief einmal voll und legte die Sitzung lahm)
  echo 'user_pref("media.webspeech.synth.enabled", false);' > "$D/p-$name/user.js"
  timeout "$zeit" "$FF" --headless --profile "$D/p-$name" --window-size="$groesse" --screenshot "$D/t-$name.png" "$URL/$seite" >/dev/null 2>&1
  # System-Python (hat PIL), auch wenn .venv aktiv ist
  ergebnis=$(/usr/bin/python3 -c "
from PIL import Image
import os, sys
p = '$D/t-$name.png'
if not os.path.exists(p): print('KEIN BILD'); sys.exit()
im = Image.open(p).convert('RGB'); r, g, b = im.getpixel((3, im.height - 3))
print('OK' if g > 100 and r < 60 else 'FEHLER')")
  printf '%-12s %s\n' "$name" "$ergebnis"
  [ "$ergebnis" = OK ] || fehler=1
done
exit $fehler
