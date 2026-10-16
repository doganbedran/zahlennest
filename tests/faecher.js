// Testet „Fächer füllen“: Fächer mit Ziffern (Gruppen wie beim Nachspuren), Vorrat = genau die Summe, nur das aktive
// Fach nimmt an (bis es voll ist), Zahlwort je Ankommen, Zählfolge bei vollem Fach, Null bleibt leer, Antippen zählt
// nicht, Auftrag in der echten Welt, Anordnung auch bei 7 8 9. Frisches Profil. Ansicht am Ende: 7 8 9, teils gefüllt.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const bis = async (fn, ms = 4000) => {
    const ende = Date.now() + ms;
    while (!fn() && Date.now() < ende) await warte(20);
    return fn();
  };
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;

  const gesagt = [];
  folgeAbspielen = async (folge) => { gesagt.push(...folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', ''))); await warte(5); };
  zaehlenMitLeuchten = async (name, el) => { gesagt.push(name); el.forEach((e) => e.classList.add('leuchtet')); await warte(5); };
  Object.assign(FAECHER_ZEIT, { nullPause: 30, fachPause: 30, daumen: 100, auftragNochmal: 3000 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const mitte = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ev = (el, typ, p) => el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: p.x, clientY: p.y }));
  // Stäbchen zum Ziel schieben (das Stäbchen sitzt 30 px über dem Finger: Finger 30 px tiefer ansetzen)
  const schieben = async (stab, ziel) => {
    const von = mitte(stab.el);
    ev(stab.el, 'pointerdown', von);
    for (let i = 1; i <= 6; i++) ev(document, 'pointermove', { x: von.x + ((ziel.x - von.x) * i) / 6, y: von.y + ((ziel.y + 30 - von.y) * i) / 6 });
    ev(document, 'pointerup', { x: ziel.x, y: ziel.y + 30 });
    await warte(20);
  };
  const frei = () => fa.staebe.find((s) => s.fach === null && !s.el.classList.contains('greift'));
  const raum = (i) => mitte(fa.faecher[i].el.querySelector('.fach-raum'));
  const fuellen = async (i, n) => { for (let k = 0; k < n; k++) { await schieben(frei(), raum(i)); await bis(() => !fa.sprech.offen); } };

  // 1. Ansagen
  pruefe(ANSAGEN['faecher-leg-1'][0] === 'Das ist die Eins. Leg ein Stäbchen hinein.' && ANSAGEN['faecher-leg-3'][0] === 'Das ist die Drei. Leg drei Stäbchen hinein.'
    && ANSAGEN['faecher-welt-1'][0] === 'Hol einen Baustein und leg ihn neben die Eins!' && ANSAGEN['korb-zahl-9'][0] === 'neun', 'Ansagen');
  pruefe((await fetch('audio/ansage-faecher-null.wav')).ok && (await fetch('audio/ansage-korb-zahl-7.wav')).ok, 'Ansage-Dateien fehlen');

  // 2. Start (1 2 3): drei Fächer, sechs Stäbchen, Fach 1 ist dran
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="faecher"]');
  pruefe(!kachel.hidden && kachel.querySelector('svg'), 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('faecher'), 'Spiel nicht geöffnet');
  await bis(() => !fa.gesperrt);
  pruefe(fa.faecher.length === 3 && fa.staebe.length === 6 && fa.faecher[0].el.classList.contains('dran') && zuletzt() === 'faecher-leg-1',
    `Start: ${fa.faecher.length} Fächer, ${fa.staebe.length} Stäbchen, ${zuletzt()}`);
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#faecher').innerText), `Text auf dem Kinder-Bildschirm: ${$('#faecher').innerText}`);

  // 3. Antippen zählt nicht; ins falsche Fach: bleibt liegen, oberhalb der Fächer
  const s0 = frei();
  ev(s0.el, 'pointerdown', mitte(s0.el)); ev(document, 'pointerup', mitte(s0.el));
  await warte(50);
  pruefe(s0.fach === null && !fa.faecher[0].staebe.length, 'Antippen zählt');
  await schieben(s0, raum(2));
  pruefe(s0.fach === null && !fa.faecher[2].staebe.length && s0.y < fa.mass.faecher[0].y - fa.mass.zifferH, 'Falsches Fach nimmt an oder Stäbchen liegt darin');

  // 4. Fach 1: ein Stäbchen → „eins“, „Eins!“; Fach 2 ist dran
  await fuellen(0, 1);
  await bis(() => fa.fachNr === 1 && !fa.gesperrt);
  pruefe(gesagt.includes('korb-zahl-1') && gesagt.includes('zaehlen-1') && zuletzt() === 'faecher-leg-2', `Fach 1: ${gesagt.slice(-4)}`);
  const st = fa.faecher[0].staebe[0];
  const fr = fa.faecher[0].el.querySelector('.fach-raum').getBoundingClientRect(), sr = st.el.getBoundingClientRect();
  pruefe(sr.top >= fr.top - 1 && sr.bottom <= fr.bottom + 1, 'Stäbchen liegt nicht im Fach');

  // 5. Fach 2 und 3, dann alle verteilt, Auftrag
  await fuellen(1, 2);
  await bis(() => fa.fachNr === 2 && !fa.gesperrt);
  pruefe(gesagt.includes('korb-zahl-2') && gesagt.includes('zaehlen-2'), 'Fach 2');
  await fuellen(2, 3);
  await bis(() => fa.inEcht && !$('#btn-faecher-daumen').hidden);
  pruefe(fa.staebe.every((s) => s.fach !== null), 'Nicht alle Stäbchen verteilt');
  const welt = gesagt.slice(gesagt.lastIndexOf('zaehlen-3'));
  pruefe(welt.join() === 'zaehlen-3,faecher-fertig,jetzt-in-echt,faecher-welt-3', `Auftrag: ${welt}`);
  $('#btn-faecher-daumen').click();
  await bis(() => $('#faecher .spiel-ende') && !$('#faecher .spiel-ende').hidden);
  pruefe(gesagt.slice(-3).join() === 'zeig-mal,zaehlen-3,faecher-welt-fertig', `Schluss: ${gesagt.slice(-3)}`);

  // 6. Null: ein Fach, in das nichts kommt – geht von selbst weiter
  faecherStoppen();
  zustand.ziffern0 = true;
  fa.ziffern = [0, 1, 2];
  Object.assign(fa, { fachNr: 0, inEcht: false, auftrag: false, fertig: false, sprech: { kette: Promise.resolve(), offen: 0 } });
  spielEndeWeg('faecher');
  faFeldAufbauen();
  faFachStarten();
  await bis(() => fa.fachNr === 1 && !fa.gesperrt);
  pruefe(gesagt.includes('faecher-null') && fa.staebe.length === 3 && zuletzt() === 'faecher-leg-1', `Null: ${gesagt.slice(-3)}`);
  zustand.ziffern0 = false;

  // 7. Anordnung bei 7 8 9 (24 Stäbchen): alles im Bild, Vorrat überlappt nicht mit den Fächern, Stäbchen getrennt
  faecherStoppen();
  fa.ziffern = [7, 8, 9];
  Object.assign(fa, { fachNr: 0, inEcht: false, auftrag: false, fertig: false, sprech: { kette: Promise.resolve(), offen: 0 } });
  faFeldAufbauen();
  faFachStarten();
  await bis(() => !fa.gesperrt);
  const feldR = $('#faecher-feld').getBoundingClientRect();
  const fachOben = Math.min(...fa.faecher.map((f) => f.el.getBoundingClientRect().top));
  const rects = fa.staebe.map((s) => s.el.getBoundingClientRect());
  pruefe(rects.every((r) => r.left >= feldR.left - 1 && r.right <= feldR.right + 1 && r.bottom <= fachOben + 1), 'Vorrat ragt heraus oder in die Fächer');
  const ueberlapp = rects.some((a, i) => rects.some((b, k) => k > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
  pruefe(!ueberlapp, 'Stäbchen im Vorrat überlappen');
  pruefe(rects[0].width >= 40, `Greifbereich zu schmal: ${rects[0].width}`);
  // sieben ins erste Fach: alle drin und nebeneinander
  for (let k = 0; k < 7; k++) faEinlegen(frei());
  await bis(() => fa.fachNr === 1);
  const raumR = fa.faecher[0].el.querySelector('.fach-raum').getBoundingClientRect();
  pruefe(fa.faecher[0].staebe.every((s) => { const r = s.el.firstChild.getBoundingClientRect(); return r.left >= raumR.left - 1 && r.right <= raumR.right + 1; }),
    'Sieben Stäbchen passen nicht ins Fach');
  for (let k = 0; k < 4; k++) faEinlegen(frei());
  await warte(400);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'FAECHER OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
