// Strichfolge der Ziffern in Schreibrichtung, wie in der Grundschule: 1 mit Aufstrich, 4 offen, 7 mit Querstrich.
// Koordinaten: y = 0 oben, 100 unten (Ziffern sind so hoch wie Großbuchstaben); x etwa 0 bis 60.
// Jede Ziffer ist eine Liste von Strichen, jeder Strich eine Liste von Punkten [x, y] in Zeichenrichtung
// (Vorlage: Wortnest striche.js – gleiche Hilfsfunktionen).

// Gerade Linie von (x1, y1) nach (x2, y2)
function gerade(x1, y1, x2, y2) {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
  return Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]);
}

// Bogen um (cx, cy) mit Radien rx/ry, Winkel in Grad wie in der Mathematik (0° = rechts, 90° = oben).
// von < bis: gegen den Uhrzeigersinn, von > bis: im Uhrzeigersinn.
function bogen(cx, cy, rx, ry, von, bis) {
  const n = Math.max(8, Math.ceil(Math.abs(bis - von) / 4));
  return Array.from({ length: n + 1 }, (_, i) => {
    const w = ((von + ((bis - von) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(w), cy - ry * Math.sin(w)];
  });
}

// Teilstücke zu einem Strich verbinden (doppelte Punkte an den Übergängen entfernen)
function verbinde(...teile) {
  return teile.reduce((alle, teil) => alle.concat(alle.length ? teil.slice(1) : teil), []);
}

const ZIFFER_STRICHE = {
  // Oval, oben beginnend, gegen den Uhrzeigersinn
  0: [bogen(28, 50, 28, 50, 90, 450)],
  // Aufstrich schräg nach oben, dann gerade runter
  1: [verbinde(gerade(8, 32, 36, 0), gerade(36, 0, 36, 100))],
  // Bogen oben (links beginnend), schräg nach links unten, Fuß nach rechts
  2: [verbinde(bogen(30, 28, 27, 27, 160, -35), gerade(52, 43.5, 3, 100), gerade(3, 100, 60, 100))],
  // Zwei Bäuche rechts, in einem Zug
  3: [verbinde(bogen(30, 24, 25, 24, 150, -90), bogen(30, 73, 27, 25, 90, -150))],
  // Offene 4: schräg runter und quer, dann der Strich von oben
  4: [verbinde(gerade(36, 0, 2, 66), gerade(2, 66, 60, 66)), gerade(46, 28, 46, 100)],
  // Hals runter, Bauch; das Dach zuletzt
  5: [verbinde(gerade(9, 0, 7, 50), bogen(28, 70, 27, 28, 135, -140)), gerade(9, 0, 52, 0)],
  // Von oben in großem Bogen nach unten, dann der Kreis
  6: [verbinde(bogen(60, 70, 55, 70, 115, 180), bogen(30, 72, 25, 26, 180, 530))],
  // Dach und schräg runter in einem Zug, Querstrich zuletzt
  7: [verbinde(gerade(2, 0, 56, 0), gerade(56, 0, 20, 100)), gerade(16, 52, 52, 52)],
  // Oben rechts beginnend: oberer Bogen links herum, unterer rechts herum, zurück nach oben
  8: [verbinde(bogen(30, 24, 22, 23, 50, 270), bogen(30, 73, 26, 26, 90, -270), bogen(30, 24, 22, 23, 270, 410))],
  // Kreis oben (rechts beginnend, gegen den Uhrzeigersinn), dann gerade runter
  9: [verbinde(bogen(28, 27, 24, 27, 0, 360), gerade(52, 27, 50, 100))],
};

// Gruppen zum Freischalten (Konzept: 1 2 3 → 4 5 6 → 7 8 9 → 0); leicht verwechselbare Paare nie zusammen in einem Besuch
const ZIFFER_GRUPPEN = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [0]];
const ZIFFER_VERWECHSLUNG = [[6, 9], [1, 7], [2, 5]];

// Ziffer als SVG (Kachel, Karte in der echten Welt): die Striche als dicke, runde Linien
function zifferSvg(n, farbe = '#4a3f35') {
  const d = ZIFFER_STRICHE[n].map((s) => `M${s.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`).join('');
  return `<svg class="ziffer-svg" viewBox="-14 -12 88 124" aria-hidden="true"><path d="${d}" pathLength="1" fill="none" stroke="${farbe}" `
    + 'stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
