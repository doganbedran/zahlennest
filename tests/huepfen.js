// Testet „Zahlen-Hüpfen“: Vormachen mit dem ganzen Vers (Frosch hüpft im Takt), dann schiebt das Kind den Frosch von
// Stein zu Stein (Zahlwort je Stein, nur der nächste Stein zählt, daneben = zurück auf den Stein), „Fünf Steine!“,
// Auftrag „Jetzt hüpfst du!“ mit Mitzählen nach 👍; Schalter bis 10. Frisches Profil. Ansicht am Ende: zehn Steine.
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
  zaehlenMitLeuchten = async (name, el, beiJedem) => { gesagt.push(name); el.forEach((e, i) => { e.classList.add('leuchtet'); if (beiJedem) beiJedem(i); }); await warte(5); };
  Object.assign(HUEPFEN_ZEIT, { vormachenPause: 20, daumen: 100, auftragNochmal: 3000 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const mitte = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ev = (el, typ, p) => el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: p.x, clientY: p.y }));
  const feldPunkt = ([x, y]) => { const r = $('#huepfen-feld').getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; };
  // Frosch auf einen Punkt schieben (der Frosch sitzt 30 px über dem Finger)
  const schieben = async (ziel) => {
    const von = mitte(hp.frosch);
    ev(hp.frosch, 'pointerdown', von);
    for (let i = 1; i <= 6; i++) ev(document, 'pointermove', { x: von.x + ((ziel.x - von.x) * i) / 6, y: von.y + ((ziel.y + 30 - von.y) * i) / 6 });
    ev(document, 'pointerup', { x: ziel.x, y: ziel.y + 30 });
    await warte(20);
    await bis(() => !hp.sprech.offen);
  };

  // 1. Ansagen: Vers als ganze Zählfolge, Zahlwörter bis zehn
  pruefe(ANSAGEN['huepfen-vers-5'][0].startsWith('Eins, zwei, drei, vier, fünf.') && ANSAGEN['korb-zahl-10'][0] === 'zehn'
    && ANSAGEN['zaehlen-10'][0].endsWith('zehn. Zehn!'), 'Ansagen');
  pruefe((await fetch('audio/ansage-huepfen-vers-10.wav')).ok && (await fetch('audio/ansage-huepfen-welt-5.wav')).ok, 'Ansage-Dateien fehlen');

  // 2. Start: fünf Steine, Vormachen (Frosch landet auf dem letzten Stein), dann „Jetzt du!“, Frosch am Ufer
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="huepfen"]');
  pruefe(!kachel.hidden, 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('huepfen'), 'Spiel nicht geöffnet');
  await bis(() => !hp.gesperrt);
  pruefe(hp.steine.length === 5 && gesagt.join() === 'huepfen-vers-5,huepfen-du' && hp.stein === 0, `Start: ${gesagt}`);
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#huepfen').innerText), `Text auf dem Kinder-Bildschirm: ${$('#huepfen').innerText}`);

  // 3. Übersprungen (gleich auf den dritten Stein) oder ins Wasser: zurück, nichts gezählt
  await schieben(feldPunkt(hp.mass.stellen[2]));
  pruefe(hp.stein === 0 && !gesagt.includes('korb-zahl-1'), 'Überspringen zählt');
  await schieben(feldPunkt([hp.mass.W - 10, hp.mass.H - 10]));
  pruefe(hp.stein === 0, 'Daneben zählt');

  // 4. Stein für Stein: eins … fünf, dann „Fünf Steine!“ und Auftrag
  for (let i = 0; i < 5; i++) await schieben(feldPunkt(hp.mass.stellen[i]));
  pruefe(['korb-zahl-1', 'korb-zahl-2', 'korb-zahl-3', 'korb-zahl-4', 'korb-zahl-5'].every((g, i) => gesagt.indexOf(g) >= 0
    && (!i || gesagt.indexOf(g) > gesagt.indexOf(`korb-zahl-${i}`))), `Zahlwörter: ${gesagt}`);
  await bis(() => hp.inEcht && !$('#btn-huepfen-daumen').hidden);
  const welt = gesagt.slice(gesagt.lastIndexOf('korb-zahl-5'));
  pruefe(welt.join() === 'korb-zahl-5,huepfen-ende-5,jetzt-in-echt,huepfen-welt-5', `Auftrag: ${welt}`);
  $('#btn-huepfen-daumen').click();
  await bis(() => $('#huepfen .spiel-ende') && !$('#huepfen .spiel-ende').hidden);
  pruefe(gesagt.slice(-2).join() === 'zaehlen-5,huepfen-fertig', `Schluss: ${gesagt.slice(-2)}`);

  // 5. Bis zehn: zehn Steine, alle im Bild und ohne Überlappen
  zustand.huepfenBis10 = true;
  $('#huepfen .ende-nochmal').click();
  await bis(() => !hp.gesperrt);
  pruefe(hp.steine.length === 10 && gesagt.includes('huepfen-vers-10'), 'Bis zehn: keine zehn Steine');
  const feldR = $('#huepfen-feld').getBoundingClientRect();
  const rects = hp.steine.map((s) => s.getBoundingClientRect());
  pruefe(rects.every((r) => r.left >= feldR.left - 1 && r.right <= feldR.right + 1 && r.top >= feldR.top - 1 && r.bottom <= feldR.bottom + 1), 'Stein ragt heraus');
  pruefe(!rects.some((a, i) => rects.some((b, k) => k > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)), 'Steine überlappen');
  for (let i = 0; i < 3; i++) await schieben(feldPunkt(hp.mass.stellen[i]));
  await warte(400);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'HUEPFEN OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
