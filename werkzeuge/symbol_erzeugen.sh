#!/usr/bin/env bash
# Erzeugt icons/icon-512.png, icon-192.png und icon-512-maskable.png aus werkzeuge/symbol.html (Firefox headless).
# Erwartet den Testserver:  .venv/bin/python werkzeuge/testserver.py 8766
set -euo pipefail
cd "$(dirname "$0")/.."
D=~/snap/firefox/common/zahlennest-test   # Snap-Firefox darf nur in ~/snap schreiben
FF=/snap/firefox/current/usr/lib/firefox/firefox
[ -x "$FF" ] || FF=firefox
for art in rund maskable; do
  rm -rf "$D/p-symbol"; mkdir -p "$D/p-symbol"
  echo 'user_pref("media.webspeech.synth.enabled", false);' > "$D/p-symbol/user.js"
  timeout 60 "$FF" --headless --profile "$D/p-symbol" --window-size=512,512 --screenshot "$D/symbol-$art.png" \
    "http://localhost:8766/werkzeuge/symbol.html?$art" >/dev/null 2>&1
done
# System-Python (hat PIL): Ecken abrunden (normales Symbol), maskable bleibt eckig
/usr/bin/python3 - "$D" <<'PY'
import sys
from PIL import Image, ImageDraw
d = sys.argv[1]
rund = Image.open(f'{d}/symbol-rund.png').convert('RGBA').crop((0, 0, 512, 512))
maske = Image.new('L', (512 * 4, 512 * 4), 0)
ImageDraw.Draw(maske).rounded_rectangle((0, 0, 512 * 4 - 1, 512 * 4 - 1), radius=96 * 4, fill=255)
rund.putalpha(maske.resize((512, 512), Image.LANCZOS))
rund.save('icons/icon-512.png', optimize=True)
rund.resize((192, 192), Image.LANCZOS).save('icons/icon-192.png', optimize=True)
Image.open(f'{d}/symbol-maskable.png').convert('RGB').crop((0, 0, 512, 512)).save('icons/icon-512-maskable.png', optimize=True)
print('Symbole erzeugt')
PY
