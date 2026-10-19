// Testet „Zahlenweg“: gerader Weg 1–10, Würfel nur 1 oder 2, Kind und Teddy abwechselnd mit demselben Käfer (kein
// Gewinner), Zahl jedes Feldes beim Ziehen, nur das nächste Feld zählt, nie übers Ziel, „Wir sind am Ziel!“, Auftrag
// Treppenstufen. Frisches Profil. Ansicht am Ende: Käfer unterwegs.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const bis = async (fn, ms = 6000) => {
    const ende = Date.now() + ms;
    while (!fn() && Date.now() < ende) await warte(20);
    return fn();
  };
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;

  const gesagt = [];
  folgeAbspielen = async (folge) => { gesagt.push(...folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', ''))); await warte(5); };
  Object.assign(WEG_ZEIT, { wurf: 20, teddySchritt: 20, wechsel: 20, daumen: 100, auftragNochmal: 3000 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const mitte = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ev = (el, typ, p) => el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: p.x, clientY: p.y }));
  const feldPunkt = ([x, y]) => { const r = $('#weg-feld').getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; };
  // Käfer auf einen Punkt schieben (der Käfer sitzt über dem Finger: Finger auf die Feldmitte)
  const schieben = async (ziel) => {
    const von = mitte(wg.kaefer);
    ev(wg.kaefer, 'pointerdown', von);
    const z = { x: ziel.x, y: ziel.y - wg.mass.F * 0.5 };
    for (let i = 1; i <= 6; i++) ev(document, 'pointermove', { x: von.x + ((z.x - von.x) * i) / 6, y: von.y + ((z.y - von.y) * i) / 6 });
    ev(document, 'pointerup', z);
    await warte(20);
  };
  const kindDran = () => wg.dran === 'kind' && !wg.gesperrt;

  // 1. Ansagen
  pruefe(ANSAGEN['weg-schieb-2'][0] === 'Schieb den Käfer zwei Felder weiter.' && ANSAGEN['weg-ziel'][0].includes('Ziel'), 'Ansagen');
  pruefe((await fetch('audio/ansage-weg-teddy.wav')).ok && (await fetch('audio/ansage-weg-welt.wav')).ok, 'Ansage-Dateien fehlen');

  // 2. Start: zehn Felder in einer geraden Reihe, Käfer am Start, das Kind beginnt
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="weg"]');
  pruefe(!kachel.hidden, 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('weg'), 'Spiel nicht geöffnet');
  await bis(kindDran);
  const felder = [...document.querySelectorAll('#weg-feld .weg-feld')].map((f) => f.getBoundingClientRect());
  pruefe(felder.length === 10 && felder.every((r, i) => !i || (Math.abs(r.top - felder[0].top) < 1 && r.left > felder[i - 1].right - 1)), 'Weg nicht gerade von links nach rechts');
  const feldR = $('#weg-feld').getBoundingClientRect();
  pruefe(felder[0].left >= feldR.left && felder[9].right <= feldR.right, 'Weg ragt heraus');
  pruefe(gesagt.join() === 'weg-start,weg-du' && wg.feld === 0, `Start: ${gesagt}`);
  // Startplatz vor Feld 1: der Käfer steht dort, nicht über Feld 1
  const startR = $('#weg-feld .weg-start').getBoundingClientRect(), kaeferM = mitte(wg.kaefer);
  pruefe(startR.right <= felder[0].left + 1 && kaeferM.x >= startR.left && kaeferM.x <= startR.right && kaeferM.x < felder[0].left,
    'Käfer steht nicht am Startplatz vor Feld 1');
  pruefe(startR.left >= feldR.left - 1, 'Startplatz ragt heraus');
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#weg').innerText), `Text auf dem Kinder-Bildschirm: ${$('#weg').innerText}`);

  // 3. Ohne Würfeln lässt sich nicht ziehen; würfeln (1 oder 2), dann Feld für Feld
  await schieben(feldPunkt(wg.mass.mitte(0)));
  pruefe(wg.feld === 0, 'Ziehen ohne Würfeln');
  const wuerfe = [];
  let teddyZuege = 0;
  for (let zug = 0; zug < 20 && wg.feld < 10; zug++) {
    await bis(() => (kindDran() && !wg.rest) || wg.feld >= 10 || wg.auftrag);
    if (wg.feld >= 10 || wg.auftrag) break;
    $('#weg-feld .weg-wuerfel').click();
    await bis(() => wg.rest > 0 && !wg.gesperrt);
    wuerfe.push(wg.wurf);
    // Erst übers nächste Feld hinaus: zählt nicht
    if (wg.feld + 2 <= 10 && zug === 0) {
      await schieben(feldPunkt(wg.mass.mitte(wg.feld + 1)));
      pruefe(wg.rest === wg.wurf, 'Übersprungenes Feld zählt');
    }
    const vorher = wg.feld;
    while (wg.rest > 0) { const f = wg.feld; await schieben(feldPunkt(wg.mass.mitte(wg.feld))); await bis(() => wg.feld === f + 1); }
    pruefe(wg.feld === vorher + wuerfe[wuerfe.length - 1], 'Kind zieht nicht so weit wie gewürfelt');
    pruefe(gesagt.includes(`korb-zahl-${wg.feld}`), `Feldzahl ${wg.feld} nicht gesagt`);
    // Teddy zieht selbst
    if (wg.feld < 10) { await bis(() => wg.dran === 'teddy'); teddyZuege++; await bis(() => wg.dran === 'kind' || wg.feld >= 10); }
  }
  await bis(() => wg.inEcht && !$('#btn-weg-daumen').hidden, 8000);
  pruefe(wg.feld === 10 && wuerfe.every((w) => w === 1 || w === 2) && teddyZuege > 0, `Ziel: Feld ${wg.feld}, Würfe ${wuerfe}, Teddy ${teddyZuege}`);
  pruefe(['korb-zahl-1', 'korb-zahl-5', 'korb-zahl-10'].every((g) => gesagt.includes(g)), 'Nicht jede Feldzahl gesagt');
  const welt = gesagt.slice(gesagt.lastIndexOf('weg-ziel'));
  pruefe(welt.join() === 'weg-ziel,jetzt-in-echt,weg-welt', `Auftrag: ${welt}`);
  $('#btn-weg-daumen').click();
  await bis(() => $('#weg .spiel-ende') && !$('#weg .spiel-ende').hidden);
  pruefe(zuletzt() === 'weg-welt-fertig', `Schluss: ${zuletzt()}`);

  // Ansicht: neues Spiel, Käfer auf Feld 4
  $('#weg .ende-nochmal').click();
  await bis(kindDran);
  wg.feld = 4;
  wgKaeferAufFeld();
  [...document.querySelectorAll('#weg-feld .weg-feld')].slice(0, 4).forEach((f) => f.classList.add('besucht'));
  await warte(400);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'WEG OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
