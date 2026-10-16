// Testet „Zahlentreppe“: Punktstangen 1–5 durcheinander, eine Stange rastet nur auf ihrer Stufe ein (sonst bleibt sie
// liegen), Punkte werden gezählt, fertige Treppe: Käfer läuft hinauf, „Jede Stufe hat einen mehr!“, keine Ziffern,
// Auftrag Bausteintreppe. Frisches Profil. Ansicht am Ende: halb gebaute Treppe.
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
  zaehlenMitLeuchten = async (name, el, beiJedem) => { gesagt.push(name); el.forEach((e, i) => { e.classList.add('leuchtet'); if (beiJedem) beiJedem(i); }); await warte(5); };
  Object.assign(TREPPE_ZEIT, { fertigPause: 20, daumen: 100, auftragNochmal: 3000 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const mitte = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ev = (el, typ, p) => el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: p.x, clientY: p.y }));
  const stufe = (n) => $('#treppe-feld').querySelectorAll('.stufe')[n - 1];
  // Stange an ihrer Mitte greifen und mit der Mitte auf die Mitte des Ziels ziehen (die Stange hängt 20 px höher)
  const schieben = async (s, ziel) => {
    const von = mitte(s.el);
    ev(s.el, 'pointerdown', von);
    for (let i = 1; i <= 6; i++) ev(document, 'pointermove', { x: von.x + ((ziel.x - von.x) * i) / 6, y: von.y + ((ziel.y + 20 - von.y) * i) / 6 });
    ev(document, 'pointerup', { x: ziel.x, y: ziel.y + 20 });
    await warte(20);
    await bis(() => !tp.gesperrt || tp.stangen.every((x) => x.drin));
  };
  const stange = (n) => tp.stangen.find((s) => s.n === n);

  // 1. Start: fünf Stangen, nicht schon sortiert, keine Ziffern
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="treppe"]');
  pruefe(!kachel.hidden, 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('treppe'), 'Spiel nicht geöffnet');
  await bis(() => !tp.gesperrt);
  pruefe(tp.stangen.length === 5 && !tp.stangen.every((s, i) => s.n === i + 1) && zuletzt() === 'treppe-start', `Start: ${tp.stangen.map((s) => s.n)}`);
  pruefe(!/[A-Za-zÄÖÜäöüß0-9]/.test($('#treppe').innerText), `Text/Ziffern auf dem Kinder-Bildschirm: ${$('#treppe').innerText}`);
  pruefe(tp.stangen.every((s) => s.el.querySelectorAll('.menge-punkt').length === s.n), 'Punkte auf den Stangen falsch');

  // 2. Falsche Stufe: rastet nicht ein, liegt über der Treppe
  await schieben(stange(3), mitte(stufe(1)));
  pruefe(!stange(3).drin && stange(3).unten <= tp.mass.vorratUnten + 1, 'Stange rastet auf falscher Stufe ein');
  await warte(400);   // zurückgleiten lassen (gegriffen wird, wo die Stange zu sehen ist)

  // 3. Richtig: 3, 1, 5, 2, 4 – jede wird gezählt; dann läuft der Käfer hinauf
  for (const n of [3, 1, 5, 2, 4]) {
    await schieben(stange(n), mitte(stufe(n)));
    pruefe(stange(n).drin && gesagt.includes(`zaehlen-${n}`), `Stange ${n} rastet nicht ein`);
  }
  await bis(() => tp.inEcht && !$('#btn-treppe-daumen').hidden);
  pruefe($('#treppe-feld .treppe-kaefer') || tp.inEcht, 'Kein Käfer');
  const welt = gesagt.slice(gesagt.lastIndexOf('treppe-fertig') - 1);
  pruefe(welt.join() === 'zaehlen-5,treppe-fertig,jetzt-in-echt,treppe-welt', `Schluss/Auftrag: ${welt}`);
  $('#btn-treppe-daumen').click();
  await bis(() => $('#treppe .spiel-ende') && !$('#treppe .spiel-ende').hidden);
  pruefe(zuletzt() === 'treppe-welt-fertig', `Ende: ${zuletzt()}`);

  // 4. Anordnung: alles im Bild, Stufen nebeneinander, steigend
  $('#treppe .ende-nochmal').click();
  await bis(() => !tp.gesperrt);
  const feldR = $('#treppe-feld').getBoundingClientRect();
  const st = [...$('#treppe-feld').querySelectorAll('.stufe')].map((s) => s.getBoundingClientRect());
  pruefe(st.every((r, i) => !i || (r.left > st[i - 1].right - 1 && r.height > st[i - 1].height && Math.abs(r.bottom - st[0].bottom) < 1)), 'Treppe nicht steigend');
  const alle = [...st, ...tp.stangen.map((s) => s.el.getBoundingClientRect())];
  pruefe(alle.every((r) => r.left >= feldR.left - 1 && r.right <= feldR.right + 1 && r.top >= feldR.top - 1 && r.bottom <= feldR.bottom + 1), 'Etwas ragt heraus');
  const lose = tp.stangen.map((s) => s.el.getBoundingClientRect());
  pruefe(lose.every((r) => r.bottom <= st[0].top + 1 || r.bottom <= Math.min(...st.map((x) => x.top)) + 1), 'Vorrat liegt in der Treppe');
  for (const n of [1, 2]) await schieben(stange(n), mitte(stufe(n)));
  await warte(400);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'TREPPE OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
