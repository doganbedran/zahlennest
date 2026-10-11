# Zahlennest – Konzept (freigegeben 2026-10-11)

Erarbeitet von Bildungsplan-Fachberaterin, Montessori-Pädagogin, Kinderpsychologin und UX-Gestalterin.
Ansicht mit Skizzen: https://claude.ai/artifact/QkhZ69DqL326biX9aSA6tr

## Warum Zahlen
- Berliner Bildungsprogramm 2026 (7 Bereiche, Mathematik 2.4, S. 79–85): Mathematik ist mit Sprache, emotionalen und
  sozialen Kompetenzen „basal“ (S. 48, nach SWK/KMK 2022). Beispiel 4 J.: „im Zahlenraum bis 5 abzählen,
  Mengenverständnis zeigen“ (S. 50). Haltung: alltagsintegriert, über konkrete Erfahrungen, ohne Druck.
  Grundpfeiler: Sortieren/Klassifizieren, Muster/Symmetrie, Zahl/Menge, Raum/Geometrie, Wiegen/Messen/Vergleichen,
  grafische Darstellung.
- Bayern § 6 AVBayKiBiG: Zahlen, Mengen, Formen erkennen und benennen.
- Studien: Mathe-Vorwissen sagt spätere Leistung am stärksten voraus (Duncan 2007, Watts 2014; Krajewski).
  Korrelativ; Fördereffekte verblassen → regelmäßig kurze Runden statt Drill.
- Bildschirmzeit (AWMF): 3–6 J. höchstens 30 Min an einzelnen Tagen, mit Erwachsenem – **für beide Apps zusammen**.
- Selbstregulation/sozial-emotional: kein eigenes App-Thema, sondern Gestaltungsprinzip.

## Grundregeln
- Mengen vor Ziffern, kleine vor großen Zahlen. Mit 3: Mengen 1–3 auf einen Blick, zählen bis 5. Ziffern und 10 ab 4.
- Ein Lernziel pro Spiel. Gleich große Dinge, gleicher Abstand (sonst Fläche statt Anzahl); Größe erst später variieren.
- Schieben statt Tippen; Zahl genau beim Ankommen; letzte Zahl betonen (Kardinalität).
- Jede Runde endet in der echten Welt („Hol mir …“), Eltern-Anregungen im Elternbereich.
- Kein „falsch“: nach 2 Versuchen zählt die App langsam mit (Dinge leuchten), nach 3 Lösung zeigen und weiter.
- Keine Zahlen über das Kind (keine Zähler, Summen, „heute 12 geschafft“), nie Geschwister vergleichen,
  „mehr“ ≠ „besser“ (mal mehr, mal weniger fragen; kleinere Menge nicht traurig darstellen). Zu zweit nur gemeinsam.
- Nicht hinein: Rechnen mit Ziffern, Plus/Minus, > 10, Uhr, Geld, Zeitdruck, Abfragen.

## Spiele (Reihenfolge der Freischaltung)
Start mit **„Wie viele?“** (Entscheidung User), dann:

1. **Wie viele?** (ab 3) – Drei-Stufen-Lektion: „Das sind zwei.“ → „Wo sind drei?“ → „Wie viele sind das? Sag es!“.
   Würfel-Punktbilder + Fingerbild, nur 1–3. Stufe 3 ohne Prüfung (Stimme sagt die Antwort nach Pause).
   Basis: „Zeig mir“ aus Wortnest.
2. **Mehr oder weniger?** (ab 3) – zwei Teller (Entscheidung User: Teller statt Körbe, damit es sich von „In den Korb“ unterscheidet), ganzen Teller antippen. Erst nur „mehr“, große Unterschiede (1:4),
   nie 3:4 am Anfang. Daneben: Dinge stellen sich paarweise gegenüber (Eins-zu-eins sichtbar).
3. **In den Korb zählen** (3–4) – „Leg drei Äpfel in den Korb.“ (Punktbild, keine Ziffer). Vorrat oben (Dinge 80–90 px,
   24 px Abstand, ≥ 40 px vom Rand), Freiraum, Korb unten (~300×200). Jedes Ankommen zählt („eins … zwei … drei“),
   am Ende leuchten alle: „Drei Äpfel!“. Vorrat immer 2 mehr als gesucht. Korb nimmt anfangs nicht mehr an als
   gesucht (später sanft: „Jetzt sind es vier. Eins darf wieder raus.“). Herausnehmen erlaubt.
   Finger: Fangbereich ~1,5× Korbbild, Magnet ab ~60 px; Daneben **bleibt liegen** (kein Zurückspringen = kein
   „falsch“); nur ein Finger zählt; `touch-action: none`, `overscroll-behavior: none`; Ding wächst 10 % beim
   Greifen und sitzt ~30 px über dem Finger. Eltern-Option: Antippen lässt das Ding von selbst in den Korb fliegen.
4. **Zahlen-Trommel** (3–4) – „Hau dreimal!“, je Schlag ein Punkt + Zählwort; App trommelt vor, dann gemeinsam.
   Schläge < 150 ms zählen als einer. Nach der Zahl ruht die Trommel (Weitertrommeln ist kein Fehler), kein
   Takt-Zeitfenster, Lautstärke begrenzt, keine Blitze. Basis: Silben-Trommel.
5. **Hol mir …** (3–4) – „Hol mir zwei Löffel!“ (+ Punktbild), Kind holt echte Dinge, Erwachsener 👍, App zählt
   langsam, Kind zeigt auf jedes Ding. Keine Zeitgrenze. Dinge wählen die Eltern (nur Ungefährliches; Wörter mit
   gleichem Plural: Löffel, Becher, Teller, Eimer; eigene Fotos möglich). Basis: „Wo ist bei dir …?“.

Später (ab 4): Muster (● ▲, auch Klatschmuster; Unterschied über Form/Helligkeit, nicht nur Farbe), Formen (auch
gedreht/gestreckt), Raum-Lage (drauf/drin/drunter, 📦 + 🐭), Ziffern nachspuren (1 2 3 → 4 5 6 → 7 8 9 → 0;
6/9, 1/7, 2/5 nie zusammen), Ziffer + Menge mit Null als „nichts“ (Spindelkasten-Gedanke), Zahlwortreihe über
Abzählverse. Nicht digital: Numerische Stangen, echtes Bündeln – die App regt nur an.

## Gestaltung
- Akzent Petrol `#00796b` (Weiß 5,3:1; ΔE zu Wortnest-Orange 91, auch bei Farbsehschwächen klar). Beim Ziffern-
  Nachspuren kein Petrol (nur Blau/Orange wie Wortnest). Verworfen: Violett (≈ Start-Blau bei Rot-Grün), Grün
  (≈ Pfeil-Orange bei Protan), Beere (≈ Pfeil-Orange bei Tritan).
- Symbol: weiße „3“ (Andika 700) im Nest, gelber Punkt `#fde26c` oben rechts – Bauplan der Gestaltungsrichtlinie.
  Idee: Startbild mit drei Eiern im Nest.
- Kacheln: Wie viele ✋ · Mehr/weniger eigenes SVG (voller + fast leerer Teller) · In den Korb 🧺 · Trommel 🥁 ·
  Hol mir 🥄. 🏠 oben links, ⚙️ 2 s halten, wie Wortnest.

## Familie, Daten, Pause
- Eigene IndexedDB `zahlennest`, localStorage-Präfix `zn:`. **„Aus Wortnest übernehmen“**: liest IndexedDB `lernapp`
  (Kinder, Profile/Menschen, Medien) nur lesend und kopiert sie; nie in Wortnest schreiben.
- Pause über beide Apps (Entscheidung: **je Gerät**, „je Kind“ evtl. später als Option): gemeinsame Schlüssel
  `nest:spielzeit`, `nest:pauseNach`, `nest:pauseAm`. Pause am nächsten Spielende; wer danach (~30 Min) in die
  andere App wechselt, sieht dort dasselbe ruhige Pausenbild. Eltern sehen „heute zusammen ca. … Min.“ (nie Kinder).
  Gemeinsamer Schalter mit Hinweis „gilt für Wortnest und Zahlennest“. Wortnest muss dafür später umgestellt werden.
- Gast-Lob (Entscheidung: **ein Gast fest je Spiel**, Eltern ordnen zu): lobt einmal am Spielende mit kurzem Foto.
  Bei „Hol mir …“ darf der Gast den Auftrag sprechen. Nie Stimmwechsel mitten im Zählen. Kein „reihum“.
- Zählfolgen als ganze Aufnahme; „eins“ beim Zählen, „ein/eine“ vor Wörtern.

## Benötigte Ansagen (Piper-Platzhalter, später Sprecher)
„Das sind eins/zwei/drei“ (bzw. „Das ist eins“), „Wo sind …?“, „Wie viele sind das? Sag es!“, „Wo sind mehr?“,
„Wo sind weniger?“, „Leg … in den Korb“ (je Ding), Zählfolgen „eins … zehn“, „Drei Äpfel!“ (betont), „Hau …mal!“,
„Hol mir …!“, „Leg sie hin“, „Jetzt sind es vier. Eins darf wieder raus.“

## Eltern-Anregungen (statt Erzählfragen)
„Wie viele Teller brauchen wir heute?“ · „Zeig mir zwei Finger.“ · „Wie viele Räder hat dein Laufrad?“ ·
„Zählen wir die Treppenstufen?“ · „Ich sehe drei Vögel. Was siehst du?“ · Vergleiche nur mit Erwachsenen oder
Kuscheltieren („Wer hat mehr Erbsen, du oder ich?“). Tipps: Aufsagen ist noch kein Mengenverständnis; die Puppe
darf sich verzählen; mit dem Finger zeigen lassen; nicht korrigieren, gemeinsam nachzählen.

## Erster Schritt
Grundgerüst (Startseite, Elternbereich, Kinder, Willkommen, Infoseite, Offline + Test, Symbol, Schrift, Tests,
GitHub-Repo + Pages anlegen – Repo-Anlage vorher kurz beim User bestätigen), dann „Wie viele?“, dann Spiel für Spiel.

## Quellen
BBP 2026 https://www.berlin.de/sen/jugend/familie-und-kinder/kindertagesbetreuung/bbp.pdf ·
SWK 2022 https://www.kmk.org/aktuelles-1/artikelansicht/swk.html ·
§ 6 AVBayKiBiG https://www.gesetze-bayern.de/Content/Pdf/BayAVKiBiG-6?all=False ·
Duncan 2007 https://bpb-us-e2.wpmucdn.com/sites.uci.edu/dist/1/1159/files/2021/03/School-readiness-pdf.pdf ·
Watts 2014 https://api.isr.umich.edu/?p=191394 ·
Nelson-Metaanalyse https://conservancy.umn.edu/items/1f340ef5-83bd-4727-9ce3-46f5e98957e8 ·
Fadeout https://edworkingpapers.com/ai26-1365 ·
AWMF https://register.awmf.org/assets/guidelines/027-075l_S2k_Praevention-dysregulierten-Bildschirmmediengebrauchs-Kinder-Jugendliche_2023-09.pdf
