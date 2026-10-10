// Ansagen der Spiele: Dateiname (audio/ansage-<name>.wav) -> [Text, Spiel].
// Eine Quelle für App, Offline-Speicher (sw.js) und Piper (werkzeuge/audio_erzeugen.py).
// Zählfolgen sind ganze Aufnahmen (nicht aus Einzelwörtern), die letzte Zahl betont; „eins“ beim Zählen.
const ANSAGEN = {
  'pause': ['Jetzt machen wir eine Pause.', 'Alle Spiele'],
  'zaehlen-1': ['Eins!', 'Alle Spiele'],
  'zaehlen-2': ['Eins, zwei. Zwei!', 'Alle Spiele'],
  'zaehlen-3': ['Eins, zwei, drei. Drei!', 'Alle Spiele'],
  'wieviele-1': ['Das ist eins.', 'Wie viele?'],
  'wieviele-2': ['Das sind zwei.', 'Wie viele?'],
  'wieviele-3': ['Das sind drei.', 'Wie viele?'],
  'wieviele-wo-1': ['Wo ist eins?', 'Wie viele?'],
  'wieviele-wo-2': ['Wo sind zwei?', 'Wie viele?'],
  'wieviele-wo-3': ['Wo sind drei?', 'Wie viele?'],
  'wieviele-sag-es': ['Wie viele sind das? Sag es!', 'Wie viele?'],
  'finger-zeig-1': ['Zeig mir einen Finger!', 'Wie viele?'],
  'finger-zeig-2': ['Zeig mir zwei Finger!', 'Wie viele?'],
  'finger-zeig-3': ['Zeig mir drei Finger!', 'Wie viele?'],
  'finger-1': ['Ein Finger!', 'Wie viele?'],
  'finger-2': ['Eins, zwei. Zwei Finger!', 'Wie viele?'],
  'finger-3': ['Eins, zwei, drei. Drei Finger!', 'Wie viele?'],
  // Ende der Runde: beschreiben, was das Kind getan hat (nicht bewerten), abwechselnd
  'ende-hingeschaut': ['Du hast genau hingeschaut!', 'Wie viele?'],
  'ende-angeschaut': ['Du hast dir die Punkte gut angeschaut!', 'Wie viele?'],
  'ende-finger': ['Du hast mit deinen Fingern gezählt!', 'Wie viele?'],
};
