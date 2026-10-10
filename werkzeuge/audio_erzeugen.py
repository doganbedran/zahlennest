#!/usr/bin/env python3
"""Erzeugt vorläufige Audiodateien mit Piper „Thorsten“ (lokale Sprachsynthese) – Platzhalter, bis der Sprecher
alles selbst eingesprochen hat.

Aufruf (aus dem Projektordner):
    .venv/bin/python werkzeuge/audio_erzeugen.py                 # alle Teile
    .venv/bin/python werkzeuge/audio_erzeugen.py --teile ansagen

Dateien:  audio/ansage-<name>.wav   Ansagen der Spiele (Texte in ansagen.js)

Dateien in audio/sprecher.json (Aufnahmen des Sprechers) werden nie überschrieben.
Piper klingt bei jedem Lauf etwas anders: nur die nötigen Teile erzeugen.
"""
import argparse
import json
import re
import wave
from pathlib import Path

import numpy as np
from piper import PiperVoice, SynthesisConfig

PROJEKT = Path(__file__).resolve().parent.parent
MODELL = PROJEKT / '.stimmen' / 'de_DE-thorsten-high.onnx'
ANSAGEN = dict(re.findall(r"'([a-z0-9-]+)': \['([^']+)'", (PROJEKT / 'ansagen.js').read_text(encoding='utf-8')))
TEILE = ['ansagen']


def synth(stimme, text, tempo=1.0):
    cfg = SynthesisConfig(length_scale=tempo)
    teile = [c.audio_float_array for c in stimme.synthesize(text, syn_config=cfg)]
    return trimmen(np.concatenate(teile)) if teile else np.zeros(0, dtype=np.float32)


def trimmen(audio, schwelle=0.02):
    laut = np.where(np.abs(audio) > schwelle)[0]
    if not len(laut):
        return audio
    rand = 400  # wenige ms behalten, damit nichts abgeschnitten klingt
    return audio[max(0, laut[0] - rand): laut[-1] + rand]


def sprecher_dateien():
    liste = PROJEKT / 'audio' / 'sprecher.json'
    return set(json.loads(liste.read_text(encoding='utf-8'))) if liste.exists() else set()


def speichern(pfad, audio, rate):
    if pfad.name in sprecher_dateien():
        print('übersprungen (Sprecher-Aufnahme):', pfad.name)
        return
    audio = audio / max(1e-6, np.abs(audio).max()) * 0.9  # gleiche Lautstärke für alle Clips
    with wave.open(str(pfad), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((audio * 32767).astype(np.int16).tobytes())
    print('erzeugt:', pfad.name)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--teile', default=','.join(TEILE))
    teile = p.parse_args().teile.split(',')
    stimme = PiperVoice.load(str(MODELL))
    rate = stimme.config.sample_rate
    ziel = PROJEKT / 'audio'
    ziel.mkdir(exist_ok=True)
    if 'ansagen' in teile:
        for name, satz in ANSAGEN.items():
            speichern(ziel / f'ansage-{name}.wav', synth(stimme, satz, tempo=1.05), rate)


if __name__ == '__main__':
    main()
