// Testet „Zwei Nester“: Eier (3, 4, 5) frei auf zwei Nester verteilen, Umlegen erlaubt, jede Aufteilung gilt, Zählen je
// Nest und „Zwei hier und eins da. Zusammen sind es drei!“, keine Ziffern/kein Plus, Auftrag mit den Händen.
// Frisches Profil. Ansicht am Ende: fünf Eier, teils verteilt.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const bis = async (fn, ms = 5000) => {
    const ende = Date.now() + ms;
    while (!fn() && Date.now() < ende) await warte(20);
    return fn();
  };
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;

  const gesagt = [];
  folgeAbspielen = async (folge) => { gesagt.push(...folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', ''))); await warte(5); };
  zaehlenMitLeuchten = async (name, el) => { gesagt.push(name); el.forEach((e) => e.classList.add('leuchtet')); await warte(5); };
  Object.assign(NESTER_ZEIT, { rundenPause: 30, zaehlPause: 10, daumen: 100, auftragNochmal: 3000 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const mitte = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ev = (el, typ, p) => el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: p.x, clientY: p.y }));
  const nestMitte = (k) => mitte($('#nester-feld').querySelectorAll('.nest.klein')[k]);
  const schieben = async (ei, ziel) => {
    const von = mitte(ei.el);
    ev(ei.el, 'pointerdown', von);
    for (let i = 1; i <= 6; i++) ev(document, 'pointermove', { x: von.x + ((ziel.x - von.x) * i) / 6, y: von.y + ((ziel.y + 30 - von.y) * i) / 6 });
    ev(document, 'pointerup', { x: ziel.x, y: ziel.y + 30 });
    await warte(20);
  };
  const lose = () => ns.eier.filter((e) => e.nest === null);

  // 1. Ansagen: alle Aufteilungen, kein Plus/Minus
  const saetze = Object.keys(ANSAGEN).filter((k) => /^nester-\d-\d$/.test(k));
  pruefe(saetze.length === 4 + 5 + 6, `Aufteilungen: ${saetze.length}`);
  pruefe(ANSAGEN['nester-2-1'][0] === 'Zwei hier und eins da. Zusammen sind es drei!'
    && saetze.every((k) => !/plus|minus|und noch/i.test(ANSAGEN[k][0])), 'Ansagen');
  pruefe((await fetch('audio/ansage-nester-0-5.wav')).ok, 'Ansage-Datei fehlt');

  // 2. Start: drei Eier im großen Nest
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="nester"]');
  pruefe(!kachel.hidden, 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('nester'), 'Spiel nicht geöffnet');
  await bis(() => !ns.gesperrt);
  pruefe(ns.eier.length === 3 && lose().length === 3 && zuletzt() === 'nester-start-3', `Start: ${gesagt}`);
  pruefe(!/[A-Za-zÄÖÜäöüß0-9]/.test($('#nester').innerText), `Text/Ziffern auf dem Kinder-Bildschirm: ${$('#nester').innerText}`);

  // 3. Verteilen: zwei links, eins rechts – mit Umlegen dazwischen
  await schieben(lose()[0], nestMitte(1));
  pruefe(ns.eier.filter((e) => e.nest === 1).length === 1, 'Ei kommt nicht ins Nest');
  await schieben(ns.eier.find((e) => e.nest === 1), nestMitte(0));
  pruefe(ns.eier.filter((e) => e.nest === 0).length === 1 && !ns.eier.some((e) => e.nest === 1), 'Umlegen klappt nicht');
  await schieben(lose()[0], nestMitte(0));
  await schieben(lose()[0], nestMitte(1));
  await bis(() => ns.runde === 1 && !ns.gesperrt);
  const r1 = gesagt.slice(gesagt.indexOf('zaehlen-2'), gesagt.indexOf('nester-2-1') + 1);
  pruefe(r1.join() === 'zaehlen-2,zaehlen-1,nester-2-1', `Runde 1: ${r1}`);

  // 4. Runde 2: alle vier in ein Nest – gilt auch („Keins hier und vier da“)
  for (let i = 0; i < 4; i++) await schieben(lose()[0], nestMitte(1));
  await bis(() => ns.runde === 2 && !ns.gesperrt);
  pruefe(gesagt.includes('nester-0-4') && !gesagt.includes('zaehlen-0'), `Runde 2: ${gesagt.slice(-3)}`);

  // 5. Runde 3: fünf Eier, alles im Bild; drei / zwei
  const feldR = $('#nester-feld').getBoundingClientRect();
  pruefe(ns.eier.length === 5 && ns.eier.every((e) => { const r = e.el.getBoundingClientRect(); return r.left >= feldR.left - 1 && r.right <= feldR.right + 1 && r.top >= feldR.top - 1; }), 'Eier ragen heraus');
  for (let i = 0; i < 3; i++) await schieben(lose()[0], nestMitte(0));
  for (let i = 0; i < 2; i++) await schieben(lose()[0], nestMitte(1));
  await bis(() => ns.inEcht && !$('#btn-nester-daumen').hidden);
  const welt = gesagt.slice(gesagt.lastIndexOf('nester-3-2'));
  pruefe(welt.join() === 'nester-3-2,jetzt-in-echt,nester-welt', `Auftrag: ${welt}`);
  $('#btn-nester-daumen').click();
  await bis(() => $('#nester .spiel-ende') && !$('#nester .spiel-ende').hidden);
  pruefe(gesagt.slice(-3).join() === 'nester-welt-zeig,zaehlen-3,nester-welt-fertig', `Schluss: ${gesagt.slice(-3)}`);

  // Ansicht: fünf Eier, zwei schon verteilt
  $('#nester .ende-nochmal').click();
  nesterStoppen();
  ns.runde = 2;
  nsRundenZeichnen();
  nesterNeueRunde();
  await bis(() => !ns.gesperrt);
  ns.eier[0].nest = 0; ns.eier[1].nest = 1;
  nsAnordnen();
  await warte(400);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'NESTER OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
