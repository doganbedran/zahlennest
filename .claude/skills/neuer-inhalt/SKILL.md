---
name: neuer-inhalt
description: Neuen Lerninhalt oder ein neues Spiel mit dem ganzen virtuellen Team entwickeln – Ideen (Pädagogin, Bildungsplan), Gestaltung (UX), Bauen, Prüfen (Testerin, Reviewer, Datenschutz, Psychologin, Kinder-Tester), Veröffentlichen, Beobachtungs-Checkliste für den echten Test. Nur für größere Inhalte, nicht für kleine Korrekturen.
---

# Neuer Inhalt mit dem Team

Argument (optional): Thema oder Wunsch des Users, z. B. „Reime“ oder „Silben klatschen“. Ohne Argument: Team schlägt vor.
Die Rollen liegen in `.claude/agents/`. Berichte dem User zwischendurch kurz und ohne Fachjargon auf Deutsch.

## 1. Ideen
- Agenten `paedagogin` und `bildungsplan` **gleichzeitig** starten: Thema, Ist-Stand der App (Spiele aus README) mitgeben;
  Auftrag: 3–6 Vorschläge bzw. Einordnung und Lücken.
- Ergebnisse zusammenführen: doppelte zusammenlegen, Widersprüche benennen. Dem User eine kurze Auswahl zeigen
  (je Vorschlag: was das Kind tut, was es lernt, Aufwand) mit Empfehlung. **Warten, bis der User wählt.**

## 2. Gestaltung
- Agent `ux-kinder` mit dem gewählten Vorschlag: Bildschirm-Skizze, Ablauf, benötigte Ansagen/Bilder/Wörter.
- Prüfen gegen CLAUDE.md: keine Texte für Kinder, kein „falsch“, farbenblind-sicher, saubere Anlaute,
  „Wörter legen“ nur lautgetreu. Neue Ansagen nach den Audio-Regeln (nur neue Dateien, Zwischenordner).
- Plan in 5–8 Zeilen dem User zeigen; bei offenen Konzeptfragen fragen, sonst weiter.

## 3. Bauen
- Selbst bauen nach dem Arbeitsablauf in CLAUDE.md (Testserver, Test `tests/<name>.js`, Eintrag in beide
  Werkzeug-Skripte, README-Abschnitt „Spiele“ ergänzen). Version noch **nicht** erhöhen – das macht `/veroeffentlichen`.

## 4. Prüfen
- Diese Agenten **gleichzeitig** starten, jeweils mit kurzer Beschreibung der Änderung und der betroffenen Dateien:
  `testerin`, `reviewer`, `datenschutz`, `kinderpsychologin`, `kinder-tester`; dazu `paedagogin` für die Umsetzung.
- Befunde sammeln und selbst gegenprüfen (nicht blind übernehmen). Alle **Muss** beheben, **Sollte** beheben, wenn
  klein; **Idee** nur notieren. Bei Widersprüchen zwischen Rollen: Kinderwohl und Projektregeln gehen vor.
- Nach Korrekturen: `./werkzeuge/alle_tests.sh` muss komplett OK sein.

## 5. Veröffentlichen
- Skill `/veroeffentlichen` ausführen.

## 6. Bericht an den User
Kurz auf Deutsch:
- Was neu ist (aus Sicht des Kindes)
- Was das Team gefunden und was behoben wurde (2–5 Punkte), was als Idee offen bleibt
- Was getestet ist, was nur auf dem Handy prüfbar ist
- **Beobachtungs-Checkliste für den echten Test** (aus `kinder-tester` + `kinderpsychologin`), z. B.:
  Versteht das Kind ohne Erklärung, was zu tun ist? Wo zögert es / tippt daneben? Wann hört es auf und warum?
  Lacht es, will es nochmal? Unterschied zwischen 3- und 4-Jährigem?
- Bitte um Rückmeldung; die echten Beobachtungen haben Vorrang vor den Einschätzungen des virtuellen Teams.
