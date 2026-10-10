#!/usr/bin/env python3
"""Lokaler Testserver. Wie `python3 -m http.server`, plus /_warten?ms=N (antwortet verzögert).
Testseiten binden /_warten als iframe ein, damit das load-Ereignis (und damit ein Screenshot)
erst nach asynchronen Tests kommt.
Fürs Aufnahme-Studio (werkzeuge/aufnahme-studio.html): POST /_speichern?datei=<name>.wav legt die Aufnahme in
audio/ ab – nur von der Studio-Seite selbst (Origin/Host geprüft, sonst könnte jede fremde Webseite im Browser
hierher schreiben). Jede gespeicherte Datei kommt in audio/sprecher.json: Das ist die Liste der Dateien mit der
Sprecher-Stimme; audio_erzeugen.py (Piper) überschreibt sie nie.
Lauscht nur auf diesem Rechner; mit --lan auch im WLAN (z. B. zum Testen am Handy)."""
import json
import re
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def sprecher_merken(ordner, datei):
    """audio/sprecher.json um die Datei ergänzen (beim ersten Mal mit den schon aufgenommenen Silben)."""
    liste = ordner / 'sprecher.json'
    if liste.exists():
        dateien = set(json.loads(liste.read_text(encoding='utf-8')))
    else:
        dateien = {p.name for p in ordner.glob('silbe-*.wav')}
    dateien.add(datei)
    liste.write_text(json.dumps(sorted(dateien), indent=0) + '\n', encoding='utf-8')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/_warten':
            time.sleep(int(parse_qs(url.query).get('ms', ['3000'])[0]) / 1000)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'ok')
            return
        super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        datei = parse_qs(url.query).get('datei', [''])[0]
        port = self.server.server_address[1]
        eigene = {f'localhost:{port}', f'127.0.0.1:{port}'}
        laenge = int(self.headers.get('Content-Length', 0))
        if url.path != '/_speichern' or self.client_address[0] not in ('127.0.0.1', '::1') \
                or self.headers.get('Host') not in eigene \
                or self.headers.get('Origin') not in {f'http://{h}' for h in eigene} \
                or self.headers.get('Content-Type') != 'audio/wav' \
                or not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*\.wav', datei):
            self.send_error(403)
            return
        if not 44 < laenge <= 5_000_000:
            self.send_error(413)
            return
        daten = self.rfile.read(laenge)
        if daten[:4] != b'RIFF' or daten[8:12] != b'WAVE':
            self.send_error(400)
            return
        ordner = Path(self.directory) / 'audio'
        (ordner / datei).write_bytes(daten)
        sprecher_merken(ordner, datei)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    argumente = [a for a in sys.argv[1:] if a != '--lan']
    port = int(argumente[0]) if argumente else 8765
    adresse = '' if '--lan' in sys.argv else '127.0.0.1'
    root = Path(__file__).resolve().parent.parent
    ThreadingHTTPServer((adresse, port), partial(Handler, directory=str(root))).serve_forever()
