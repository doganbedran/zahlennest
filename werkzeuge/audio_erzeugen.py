#!/usr/bin/env python3
"""Erzeugt vorläufige Audiodateien mit Piper „Thorsten“ (lokale Sprachsynthese) – Platzhalter, bis der Sprecher
alles selbst eingesprochen hat.

Aufruf (aus dem Projektordner):
    .venv/bin/python werkzeuge/audio_erzeugen.py                 # alle Teile
    .venv/bin/python werkzeuge/audio_erzeugen.py --teile ansagen

Dateien:  audio/ansage-<name>.wav   Ansagen der Spiele (Texte in ansagen.js)

Erzeugt nur fehlende Dateien (Piper klingt bei jedem Lauf etwas anders); --neu überschreibt vorhandene.
Dateien in audio/sprecher.json (Aufnahmen des Sprechers) werden nie überschrieben.
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
# Zählfolgen („Eins, zwei, drei. Drei!“): langsam, mit deutlicher Pause nach jeder Zahl – ein Kind zählt mit dem Finger
# mit. Weiter ein einziger Piper-Lauf (Satzmelodie bleibt), nur die Pausen zwischen den Sätzen werden eingefügt.
ZAEHLFOLGE = re.compile(r'^(zaehlen-\d|finger-\d|korb-welt-\d-fertig|trommel-welt-\d-fertig|trommel-vor-\d|hol-fertig-[1-5]-\w+|zaehlen-10|huepfen-vers-\d+)$')
ZAEHL_TEMPO = 1.3        # länger gesprochen (1.0 = normal)
ZAEHL_PAUSE = 0.55       # Sekunden Pause nach jeder Zahl


def synth(stimme, text, tempo=1.0):
    cfg = SynthesisConfig(length_scale=tempo)
    teile = [c.audio_float_array for c in stimme.synthesize(text, syn_config=cfg)]
    return trimmen(np.concatenate(teile)) if teile else np.zeros(0, dtype=np.float32)


# Piper („Thorsten“) spricht manche Wörter allein schlecht, im Satz aber gut (Rückmeldung des Users: „fünf“).
# Dann: „Das sind fünf.“ sprechen und das Wort an der leisesten Stelle nach „Das sind“ herausschneiden.
ALLEIN_SCHLECHT = {'fünf'}
TRAEGER = 'Das sind'


def aus_traeger(stimme, wort, rate, tempo, zeichen='.'):
    cfg = SynthesisConfig(length_scale=tempo)
    roh = lambda t: np.concatenate([c.audio_float_array for c in stimme.synthesize(t, syn_config=cfg)])
    voll = trimmen(roh(f'{TRAEGER} {wort.lower()}{zeichen}'))
    vor = len(trimmen(roh(TRAEGER)))
    fenster = int(rate * 0.01)
    energie = np.array([np.sqrt(np.mean(voll[i:i + fenster] ** 2)) for i in range(0, len(voll) - fenster, fenster)])
    von, bis = int(vor * 0.85 / fenster), min(len(energie) - 1, int(vor * 1.15 / fenster))
    schnitt = (von + int(np.argmin(energie[von:bis + 1]))) * fenster
    return trimmen(voll[schnitt:])


def satz_sprechen(stimme, satz, rate, tempo):
    kern = satz.strip().rstrip('.!?')
    if kern.lower() in ALLEIN_SCHLECHT:
        return aus_traeger(stimme, kern, rate, tempo, '!' if satz.strip().endswith('!') else '.')
    cfg = SynthesisConfig(length_scale=tempo)
    return trimmen(np.concatenate([c.audio_float_array for c in stimme.synthesize(satz, syn_config=cfg)]))


def synth_zaehlen(stimme, text, rate):
    # Jede Zahl als eigener Satz („Eins. Zwei. Drei. Drei!“ – großgeschrieben, sonst erkennt Piper keinen Satzanfang),
    # dazwischen Stille
    saetze = re.split(r'(?<=[.!?])\s+', re.sub(r', (\w)', lambda m: '. ' + m.group(1).upper(), text).strip())
    stille = np.zeros(int(rate * ZAEHL_PAUSE), dtype=np.float32)
    teile = []
    for i, satz in enumerate(saetze):
        teil = satz_sprechen(stimme, satz, rate, ZAEHL_TEMPO)
        teile += [stille, teil] if i else [teil]
    return np.concatenate(teile) if teile else np.zeros(0, dtype=np.float32)


def trimmen(audio, schwelle=0.02):
    laut = np.where(np.abs(audio) > schwelle)[0]
    if not len(laut):
        return audio
    rand = 400  # wenige ms behalten, damit nichts abgeschnitten klingt
    return audio[max(0, laut[0] - rand): laut[-1] + rand]


def sprecher_dateien():
    liste = PROJEKT / 'audio' / 'sprecher.json'
    return set(json.loads(liste.read_text(encoding='utf-8'))) if liste.exists() else set()


def speichern(pfad, audio, rate, neu=False):
    if pfad.exists() and not neu:
        return
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
    p.add_argument('--neu', action='store_true', help='vorhandene Dateien neu erzeugen')
    args = p.parse_args()
    teile = args.teile.split(',')
    stimme = PiperVoice.load(str(MODELL))
    rate = stimme.config.sample_rate
    ziel = PROJEKT / 'audio'
    ziel.mkdir(exist_ok=True)
    if 'ansagen' in teile:
        for name, satz in ANSAGEN.items():
            if args.neu or not (ziel / f'ansage-{name}.wav').exists():
                if ZAEHLFOLGE.match(name):
                    audio = synth_zaehlen(stimme, satz, rate)
                elif satz.strip().rstrip('.!?').lower() in ALLEIN_SCHLECHT:
                    audio = satz_sprechen(stimme, satz, rate, 1.05)
                else:
                    audio = synth(stimme, satz, tempo=1.05)
                speichern(ziel / f'ansage-{name}.wav', audio, rate, args.neu)


if __name__ == '__main__':
    main()
