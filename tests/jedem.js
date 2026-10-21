// Testet „Jedem eins“: Tiere am Tisch, genau so viele Dinge wie Tiere, Hinlegen nur auf freie Plätze (kein Zahlwort
// dabei), belegter Platz nimmt nichts an, am Ende „Drei Tiere, drei Becher – gleich viele!“, 3 Runden, Auftrag
// „Deck den Tisch“. Frisches Profil. Ansicht am Ende: Runde mit vier Tieren, zwei haben schon einen Löffel.
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
  Object.assign(JEDEM_ZEIT, { rundenPause: 30, daumen: 100, auftragNochmal: 3000 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const mitte = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ev = (el, typ, p) => el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: p.x, clientY: p.y }));
  const schieben = async (d, ziel) => {
    const von = mitte(d.el);
    ev(d.el, 'pointerdown', von);
    for (let i = 1; i <= 6; i++) ev(document, 'pointermove', { x: von.x + ((ziel.x - von.x) * i) / 6, y: von.y + ((ziel.y + 30 - von.y) * i) / 6 });
    ev(document, 'pointerup', { x: ziel.x, y: ziel.y + 30 });
    await warte(20);
  };
  const frei = () => je.dinge.find((d) => !d.platz);
  const runde = async () => { for (const p of je.plaetze) if (!p.ding) await schieben(frei(), mitte(p.el)); };

  // 1. Ansagen (gleicher Plural, keine Zahlwörter beim Hinlegen)
  pruefe(ANSAGEN['jedem-fertig-3-becher'][0] === 'Jeder hat einen Becher. Drei Tiere, drei Becher – gleich viele!'
    && ANSAGEN['jedem-start-loeffel'][0] === 'Jedes Tier bekommt einen Löffel.', 'Ansagen');
  pruefe((await fetch('audio/ansage-jedem-welt.wav')).ok, 'Ansage-Datei fehlt');

  // 2. Start: zwei Tiere, zwei Teller
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="jedem"]');
  pruefe(!kachel.hidden, 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('jedem'), 'Spiel nicht geöffnet');
  await bis(() => !je.gesperrt);
  pruefe(je.plaetze.length === 2 && je.dinge.length === 2 && zuletzt() === 'jedem-start-teller', `Start: ${je.plaetze.length}/${je.dinge.length} ${zuletzt()}`);
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#jedem').innerText), `Text auf dem Kinder-Bildschirm: ${$('#jedem').innerText}`);

  // 3. Antippen zählt nicht; daneben bleibt liegen (unter dem Tisch); belegter Platz nimmt nichts an
  const d0 = frei();
  ev(d0.el, 'pointerdown', mitte(d0.el)); ev(document, 'pointerup', mitte(d0.el));
  await warte(50);
  pruefe(!d0.platz, 'Antippen legt hin');
  await schieben(d0, mitte(je.plaetze[0].el));
  pruefe(d0.platz === je.plaetze[0] && je.plaetze[0].ding === d0, 'Hinlegen auf freien Platz klappt nicht');
  const anzahlVorher = gesagt.length;
  pruefe(!gesagt.some((g) => /zahl|zaehlen/.test(g)), 'Zahlwort beim Hinlegen');
  const d1 = frei();
  await schieben(d1, mitte(je.plaetze[0].el));
  pruefe(!d1.platz && d1.y > je.mass.tischUnten, 'Belegter Platz nimmt an oder Ding liegt auf dem Tisch');
  pruefe(gesagt.length === anzahlVorher, 'Etwas gesagt beim Danebenlegen');

  // 4. Runde fertig: „Zwei Tiere, zwei Teller – gleich viele!“, dann drei Tiere mit Bechern
  await schieben(d1, mitte(je.plaetze[1].el));
  await bis(() => je.runde === 1 && !je.gesperrt);
  pruefe(gesagt.includes('jedem-fertig-2-teller') && zuletzt() === 'jedem-start-becher' && je.plaetze.length === 3, `Runde 2: ${gesagt.slice(-2)}`);
  await runde();
  await bis(() => je.runde === 2 && !je.gesperrt);
  pruefe(gesagt.includes('jedem-fertig-3-becher') && je.plaetze.length === 4, 'Runde 3 nicht mit vier Tieren');

  // 5. Anordnung mit vier Tieren: alles im Bild, Tiere/Plätze/Dinge überlappen nicht
  const feldR = $('#jedem-feld').getBoundingClientRect();
  const alle = [...je.plaetze.map((p) => p.tierEl), ...je.plaetze.map((p) => p.el), ...je.dinge.map((d) => d.el)].map((el) => el.getBoundingClientRect());
  pruefe(alle.every((r) => r.left >= feldR.left - 1 && r.right <= feldR.right + 1 && r.top >= feldR.top - 1 && r.bottom <= feldR.bottom + 1), 'Etwas ragt aus dem Feld');
  const ding = je.dinge.map((d) => d.el.getBoundingClientRect());
  pruefe(!ding.some((a, i) => ding.some((b, k) => k > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)), 'Dinge im Vorrat überlappen');

  // 6. Letzte Runde, dann Auftrag „Deck den Tisch“ – 👍 – Ende
  await runde();
  await bis(() => je.inEcht && !$('#btn-jedem-daumen').hidden);
  const welt = gesagt.slice(gesagt.lastIndexOf('jedem-fertig-4-loeffel'));
  pruefe(welt.join() === 'jedem-fertig-4-loeffel,jetzt-in-echt,jedem-welt', `Auftrag: ${welt}`);
  $('#btn-jedem-daumen').click();
  await bis(() => $('#jedem .spiel-ende') && !$('#jedem .spiel-ende').hidden);
  pruefe(zuletzt() === 'jedem-welt-fertig', `Schluss: ${zuletzt()}`);

  // Spielende: nur ein Haus auf dem Bild (oben ausgeblendet), „Nochmal“ zeigt das Bild des Spiels
  pruefe(getComputedStyle($('#btn-jedem-home')).visibility === 'hidden' && getComputedStyle($('#btn-jedem-laut')).visibility === 'hidden', 'Oben noch 🏠/🔊 am Spielende');
  pruefe($('#jedem .ende-nochmal').innerHTML.includes('🐻') && !$('#jedem .ende-nochmal').textContent.includes('🔁'), 'Nochmal zeigt nicht das Spielbild');
  const nR = $('#jedem .ende-nochmal').getBoundingClientRect(), hR = $('#jedem .ende-home').getBoundingClientRect();
  pruefe(nR.width < hR.width, 'Nochmal nicht kleiner als 🏠');
  // Ansicht: vier Tiere, zwei mit Löffel
  $('#jedem .ende-nochmal').click();
  pruefe(getComputedStyle($('#btn-jedem-home')).visibility === 'visible', 'Nach Nochmal oben kein 🏠');
  jedemStoppen();
  je.runde = 2;
  jeRundenZeichnen();
  jedemNeueRunde();
  await bis(() => !je.gesperrt);
  jeHinlegen(je.dinge[0], je.plaetze[0]);
  jeHinlegen(je.dinge[1], je.plaetze[2]);
  await warte(500);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'JEDEM OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
