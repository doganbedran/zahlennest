// Testet „Ziffern nachspuren“: Strichdaten, Rundenplan (Gruppen, keine verwechselbaren Paare), Vormachen, geführtes
// Spuren per Fingerereignissen (daneben = nichts passiert, absetzen erlaubt, dreimal abrutschen = nochmal vormachen),
// Menge danach (auch die Null), Auftrag in der echten Welt, kein Petrol, kein Text. Frisches Profil.
// Ansicht am Ende: neue Ziffer mit Startpunkt und Pfeilen.
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
  Object.assign(ZIFFER_ZEIT, { daumen: 100, auftragNochmal: 3000, mengePause: 30, vormachenPause: 10 });
  const zuletzt = () => gesagt[gesagt.length - 1];

  // Finger: an den Startpunkt, den Strich entlang, loslassen (wahlweise mittendrin absetzen)
  const ereignis = (typ, p) => {
    const el = $('#ziffern-feld .ziffer-spur');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true, clientX: r.left + p.x, clientY: r.top + p.y }));
  };
  const fahre = async (punkte) => {
    ereignis('pointerdown', punkte[0]);
    punkte.forEach((p) => ereignis('pointermove', p));
    ereignis('pointerup', punkte[punkte.length - 1]);
    await warte(10);
  };
  const zifferFahren = async (absetzen = false) => {
    for (const pfad of zf.pfade.slice()) {
      if (zf.geschafft) break;
      const halb = Math.floor(pfad.p.length / 2);
      if (absetzen) { await fahre(pfad.p.slice(0, halb + 1)); await fahre(pfad.p.slice(halb)); }
      else await fahre(pfad.p);
    }
  };

  // 1. Strichdaten und Ansagen
  pruefe([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].every((n) => ZIFFER_STRICHE[n] && ZIFFER_STRICHE[n].every((s) => s.length > 2)), 'Strichdaten fehlen');
  pruefe(ZIFFER_STRICHE[7].length === 2 && ZIFFER_STRICHE[4].length === 2 && ZIFFER_STRICHE[1][0][0][1] > ZIFFER_STRICHE[1][0][5][1],
    'Grundschulform: 7 mit Querstrich, 4 offen, 1 mit Aufstrich');
  pruefe(ANSAGEN['ziffer-ist-3'][0] === 'Das ist die Drei.' && ANSAGEN['zaehlen-7'][0] === 'Eins, zwei, drei, vier, fünf, sechs, sieben. Sieben!'
    && ANSAGEN['ziffer-luft-1'][0] === 'Mal eine Eins mit dem Finger in die Luft!', 'Ansagen');
  pruefe((await fetch('audio/ansage-ziffer-ist-0.wav')).ok && (await fetch('audio/ansage-zaehlen-9.wav')).ok
    && (await fetch('audio/ansage-ziffer-null-nichts.wav')).ok, 'Ansage-Dateien fehlen');
  pruefe(!/00796b/i.test(JSON.stringify(ZIFFER_FARBE) + ZIFFER_SPUR.join()), 'Petrol beim Nachspuren');

  // 2. Rundenplan
  pruefe(JSON.stringify(ziffernRundenPlanen()) === '[1,2,3]', `Nur 1–3: ${ziffernRundenPlanen()}`);
  zustand.ziffern456 = true; zustand.ziffern789 = true;
  for (let k = 0; k < 60; k++) {
    const plan = ziffernRundenPlanen();
    const sortiert = plan.every((z, i) => !i || plan[i - 1] < z);
    const paar = ZIFFER_VERWECHSLUNG.some(([a, b]) => plan.includes(a) && plan.includes(b));
    pruefe(plan.length === 3 && sortiert && !paar && plan.filter((z) => z >= 7).length >= 2, `Plan: ${plan}`);
  }
  zustand.ziffern0 = true;
  pruefe(ziffernRundenPlanen().includes(0), 'Null fehlt im Plan');
  Object.assign(zustand, { ziffern456: false, ziffern789: false, ziffern0: false });

  // 3. Kachel und Start: „Das ist die Eins.“, Lichtpunkt macht vor, danach blauer Startpunkt
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="ziffern"]');
  pruefe(!kachel.hidden && kachel.querySelector('svg'), 'Kachel fehlt');
  kachel.click();
  pruefe(aktiv('ziffern'), 'Spiel nicht geöffnet');
  await bis(() => gesagt.includes('ziffer-ist-1'));
  pruefe(zf.vormachen && $('#ziffern-feld .ziffer-start').hidden, 'Kein Vormachen');
  await bis(() => !zf.vormachen, 6000);
  pruefe(!$('#ziffern-feld .ziffer-start').hidden && getComputedStyle($('#ziffern-feld .ziffer-start')).backgroundColor === 'rgb(29, 95, 191)', 'Startpunkt nicht blau');
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#ziffern').innerText), `Text auf dem Kinder-Bildschirm: ${$('#ziffern').innerText}`);

  // 4. Daneben aufsetzen: nichts passiert; dreimal abrutschen: nochmal vormachen
  const p0 = zf.pfade[0].p;
  await fahre([{ x: 5, y: 5 }, { x: 30, y: 10 }]);
  pruefe(zf.strichNr === 0 && zf.fortschritt === 0 && !zf.spuren.length, 'Daneben zählt');
  for (let i = 0; i < 3; i++) await fahre([p0[0], p0[3], { x: p0[3].x + 300, y: p0[3].y }]);
  pruefe(zf.vormachen && zf.strichNr === 0, 'Nach dreimal Abrutschen kein Vormachen');

  // 5. Eins nachfahren: Menge (ein Punkt), „Eins!“, dann die Zwei
  await zifferFahren();
  await bis(() => gesagt.includes('zaehlen-1'));
  pruefe($('#ziffern-feld .ziffer-menge.da') && document.querySelectorAll('#ziffern-feld .ziffer-menge .karte-punkt').length === 1, 'Menge zur Eins fehlt');
  await bis(() => zf.runde === 1 && zuletzt() === 'ziffer-ist-2');
  pruefe(zfZiffer() === 2 && !zf.geschafft, 'Zwei kommt nicht');

  // 6. Zwei mit Absetzen mittendrin
  await zifferFahren(true);
  await bis(() => gesagt.includes('zaehlen-2'));
  pruefe(gesagt.includes('zaehlen-2'), 'Absetzen mittendrin klappt nicht');

  // 7. Drei, dann der Auftrag in der echten Welt: vormachen – „Jetzt in echt!“ – 👍 – Ende
  await bis(() => zf.runde === 2 && !zf.geschafft);
  await zifferFahren();
  await bis(() => zf.inEcht && !$('#btn-ziffern-daumen').hidden);
  const welt = gesagt.slice(gesagt.lastIndexOf('zaehlen-3'));
  pruefe(welt.join() === 'zaehlen-3,ziffer-luft-vor,jetzt-in-echt,ziffer-luft-3', `Auftrag: ${welt}`);
  pruefe($('#ziffern .in-echt-karte .ziffer-svg'), 'Karte zeigt die Ziffer nicht');
  $('#btn-ziffern-daumen').click();
  await bis(() => $('#ziffern .spiel-ende') && !$('#ziffern .spiel-ende').hidden);
  pruefe(gesagt.slice(-1)[0] === 'ziffer-luft-fertig', `Schluss: ${gesagt.slice(-2)}`);

  // 8. Null: „Null. Da ist nichts!“, leere Karte
  $('#ziffern .ende-nochmal').click();
  ziffernStoppen();
  zf.runden = [0, 4, 8];
  zf.runde = 0;
  ziffernNeueRunde();
  await bis(() => !zf.geschafft && zf.pfade.length);
  await zifferFahren();
  await bis(() => gesagt.slice(-1)[0] === 'ziffer-null-nichts' || zuletzt() === 'ziffer-ist-4');
  pruefe(gesagt.includes('ziffer-null-nichts'), 'Null ohne „da ist nichts“');

  // 9. Alle Ziffern lassen sich nachfahren (auch Bögen über die ganze Runde wie 0, 6, 8)
  for (const n of [4, 5, 6, 7, 8, 9]) {
    ziffernStoppen();
    zf.runden = [n, 1, 2];
    zf.runde = 0;
    const vorher = gesagt.length;
    ziffernNeueRunde();
    await bis(() => !zf.geschafft && zf.pfade.length);
    await zifferFahren();
    await bis(() => gesagt.slice(vorher).includes(`zaehlen-${n}`));
    pruefe(gesagt.slice(vorher).includes(`zaehlen-${n}`), `${n} lässt sich nicht nachfahren`);
    if (n === 7) pruefe(document.querySelectorAll('#ziffern-feld .ziffer-menge .karte-punkt').length === 7, 'Sieben Punkte fehlen');
  }

  // 10. Tafel und Menge passen nebeneinander/untereinander ins Bild
  const t = $('#ziffern-feld .ziffer-tafel').getBoundingClientRect();
  const m = $('#ziffern-feld .ziffer-menge').getBoundingClientRect();
  const ueberlappt = !(m.left >= t.right - 1 || m.top >= t.bottom - 1 || m.right <= t.left + 1 || m.bottom <= t.top + 1);
  pruefe(!ueberlappt && m.bottom <= innerHeight && m.right <= innerWidth && t.height > 150, `Anordnung: Tafel ${Math.round(t.width)}×${Math.round(t.height)}, Menge ${Math.round(m.left)},${Math.round(m.top)}`);

  // Ansicht: neue Ziffer (Vier) mit Startpunkt und Pfeilen
  ziffernStoppen();
  zf.runden = [4, 5, 6];
  zf.runde = 0;
  zfRundenZeichnen();
  ziffernNeueRunde();
  zf.vormachen = null;
  zifferVorlageZeichnen();
  await warte(400);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'ZIFFERN OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
