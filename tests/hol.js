// Testet „Hol mir …“: Rundenplan (2 Runden, Dinge nach Eltern-Wahl, 1–3 bzw. 3–5), ruhiger Auftrag mit Karte (Punkte +
// Ding, kein „Jetzt in echt!“), 👍 → „Leg sie hin!“ – „Zeig auf jeden …!“ – Mitzählen – „Bring sie zurück“, keine
// Zeitgrenze, Tippen lenkt um, 🔊, 🏠, Grammatik der Ansagen, Eltern-Schalter (mindestens ein Ding). Frisches Profil.
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
  Object.assign(HOL_ZEIT, { daumen: 120, auftragNochmal: 300, hinlegen: 10, hinlegenViele: 10, selbstZaehlen: 10, rundenPause: 30 });
  const zuletzt = () => gesagt[gesagt.length - 1];

  // 1. Grammatik der Ansagen
  pruefe(ANSAGEN['hol-1-loeffel'][0] === 'Hol mir einen Löffel!' && ANSAGEN['hol-1-kuscheltier'][0] === 'Hol mir ein Kuscheltier!'
    && ANSAGEN['hol-2-baustein'][0] === 'Hol mir zwei Bausteine!' && ANSAGEN['hol-zeig-jeden-kuscheltier'][0] === 'Zeig auf jedes Kuscheltier!'
    && ANSAGEN['hol-fertig-3-becher'][0] === 'Eins, zwei, drei. Drei Becher!', 'Grammatik der Ansagen');
  pruefe((await fetch('audio/ansage-hol-3-loeffel.wav')).ok && (await fetch('audio/ansage-hol-fertig-2-kuscheltier.wav')).ok, 'Ansagen fehlen');

  // 2. Neues Gerät: nicht im Regal; im Elternbereich: einschalten, Dinge (alle an), letztes Ding bleibt an
  const kachel = $('#home .spiel-btn[data-spiel="holmir"]');
  pruefe(kachel.hidden, '„Hol mir …“ steht schon auf einem neuen Gerät im Regal');
  elternOeffnen();
  [...document.querySelectorAll('#spiele-wahl .regal-spiel')].find((b) => b.textContent.includes('Hol mir')).click();
  const dingBoxen = [...document.querySelectorAll('#karte-regal .hol-dinge input')];
  pruefe(!$('#karte-regal .hol-dinge').hidden && dingBoxen.length === 4 && dingBoxen.every((b) => b.checked), 'Dinge-Auswahl fehlt oder nicht alle an');
  dingBoxen.forEach((b) => { b.checked = false; b.dispatchEvent(new Event('change')); });
  pruefe(dingBoxen.filter((b) => b.checked).length === 1 && zustand[HOL_DINGE_OPTIONEN.find((o) => zustand[o])], 'Letztes Ding ließ sich ausschalten');
  const uebrig = HOL_DINGE_OPTIONEN.filter((o) => zustand[o]);
  pruefe(uebrig.length === 1, `Dinge an: ${uebrig}`);
  for (let k = 0; k < 10; k++) {
    const plan = holRundenPlanen();
    pruefe(plan.every((r) => HOL_DINGE[r.ding].option === uebrig[0]), 'Ausgeschaltetes Ding im Plan');
  }
  dingBoxen.forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change')); });
  zurStartseite(); await warte(300);
  pruefe(!kachel.hidden, 'Kachel nicht sichtbar');

  // 3. Rundenplan: 2 Runden, verschiedene Dinge, 1–3 (Beginn 2), nie zweimal dieselbe Menge; „bis 5“: 3–5 (Beginn 3)
  for (let k = 0; k < 30; k++) {
    const plan = holRundenPlanen();
    pruefe(plan.length === 2 && plan[0].n === 2 && plan[1].n !== 2 && plan.every((r) => r.n >= 1 && r.n <= 3) && plan[0].ding !== plan[1].ding, `Plan: ${JSON.stringify(plan)}`);
  }
  zustand.holBis5 = true;
  pruefe(holRundenPlanen().every((r) => r.n >= 3 && r.n <= 5) && holRundenPlanen()[0].n === 3, 'bis 5: Mengen');
  zustand.holBis5 = false;

  // 4. Runde: sofort ruhig, große Karte (bei 1–3 die Dinge selbst), 👐, kein „Jetzt in echt!“, nur der Auftrag; 👍 erst nach kurzer Zeit
  kachel.click();
  pruefe(aktiv('hol'), 'Spiel nicht geöffnet');
  holStoppen();
  hl.runden = [{ n: 2, ding: 'loeffel' }, { n: 1, ding: 'kuscheltier' }];
  hl.runde = 0;
  const n4 = gesagt.length;
  holNeueRunde();
  await bis(() => hl.inEcht && !hl.gesperrt);
  pruefe(zuletzt() === 'hol-2-loeffel' && !gesagt.includes('jetzt-in-echt'), `Auftrag: ${gesagt.slice(-2)}`);
  pruefe($('#hol').classList.contains('ruhig') && $('#hol .in-echt-karte.gross') && document.querySelectorAll('#hol .karte-dinge .karte-ding').length === 2
    && $('#hol .karte-ding svg') && $('#hol .in-echt-haende'), 'Kein ruhiger Auftrag mit Karte');
  pruefe($('#btn-hol-daumen').hidden, '👍 sofort da');
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#hol').innerText), `Text auf dem Kinder-Bildschirm: ${$('#hol').innerText}`);
  const kR = $('#hol .in-echt-karte').getBoundingClientRect();
  pruefe(kR.left >= 0 && kR.right <= innerWidth && kR.bottom <= innerHeight, 'Karte ragt heraus');
  // Tippen aufs Bild: einmal sanft umlenken, kein Fortschritt
  $('#hol .in-echt').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await bis(() => zuletzt() === 'echt-umlenken');
  pruefe(zuletzt() === 'echt-umlenken' && hl.runde === 0 && !hl.fertig, 'Tippen aufs Bild');
  // ohne 👍: Auftrag einmal nochmal, dann warten (keine Zeitgrenze)
  await warte(900);
  pruefe(gesagt.slice(n4).filter((g) => g === 'hol-2-loeffel').length === 2 && hl.runde === 0 && !$('#btn-hol-daumen').hidden, `Ohne 👍: ${gesagt.slice(-3)}`);
  // 🔊: Auftrag nochmal
  $('#btn-hol-laut').click();
  await warte(50);
  pruefe(zuletzt() === 'hol-2-loeffel', `🔊: ${zuletzt()}`);

  // 5. 👍: „Leg sie hin!“ – „Zeig auf jeden Löffel!“ – Mitzählen (Karte leuchtet) – „Danke! Bring sie wieder zurück.“
  await bis(() => !hl.gesperrt);
  $('#btn-hol-daumen').click(); $('#btn-hol-daumen').click();
  // nach „Bring sie zurück“ wartet die App auf ein zweites 👍 (zurückgebracht), erst dann die nächste Runde
  await bis(() => hl.wartetZurueck);
  await warte(300);
  pruefe(hl.runde === 0 && zuletzt() === 'hol-zurueck' && !$('#btn-hol-daumen').hidden, 'Nach „Bring sie zurück“ geht es ohne 👍 weiter');
  const r1 = gesagt.slice(gesagt.lastIndexOf('hol-leg-hin'));
  pruefe(r1.join() === 'hol-leg-hin,hol-zeig-jeden-loeffel,hol-fertig-2-loeffel,hol-zurueck', `Runde 1: ${r1}`);
  pruefe(!document.querySelector('#hol .in-echt-karte .leuchtet'), 'Beim Mitzählen leuchtet etwas auf dem Bildschirm');
  $('#btn-hol-daumen').click();
  await bis(() => hl.runde === 1);
  // 6. Runde 2 mit einem Kuscheltier: „Leg es hin!“, „Zeig auf das Kuscheltier!“, „Eins. Ein Kuscheltier!“, „Bring es zurück“
  await bis(() => hl.inEcht && !hl.gesperrt && zuletzt() === 'hol-1-kuscheltier');
  await bis(() => !$('#btn-hol-daumen').hidden);
  $('#btn-hol-daumen').click();
  await bis(() => hl.wartetZurueck);
  $('#btn-hol-daumen').click();
  await bis(() => $('#hol .spiel-ende') && !$('#hol .spiel-ende').hidden);
  const r2 = gesagt.slice(gesagt.lastIndexOf('hol-leg-hin-1-es'));
  pruefe(r2.join() === 'hol-leg-hin-1-es,hol-zeig-1-kuscheltier,hol-fertig-1-kuscheltier,hol-zurueck-1-es,ende-hol', `Runde 2/Ende: ${r2}`);

  // 7. 🔁 neu (nicht mehr ruhig bis zum Auftrag), 🏠 mitten im Zählen: still
  $('#hol .ende-nochmal').click();
  await bis(() => hl.inEcht && !hl.gesperrt);
  await bis(() => !$('#btn-hol-daumen').hidden);
  $('#btn-hol-daumen').click();
  await warte(3);
  $('#btn-hol-home').click();
  await bis(() => aktiv('home'));
  const n7 = gesagt.length;
  await warte(500);
  pruefe(aktiv('home') && gesagt.length === n7, `Nach 🏠 läuft das Spiel weiter: ${gesagt.slice(n7)}`);

  // 8. Je Kind: erstes Kind übernimmt Dinge-Wahl und „bis 5“
  speicher.schreiben('holBecher', false);
  speicher.schreiben('holBis5', true);
  window.prompt = () => 'Lina';
  elternOeffnen();
  await kindNeu();
  pruefe(kinder[0].holBecher === false && kinder[0].holLoeffel === true && kinder[0].holBis5 === true, 'Erstes Kind übernimmt die Schalter nicht');
  pruefe(!$('#kind-holBecher').checked && $('#kind-holLoeffel').checked, 'Schalter beim Kind falsch angezeigt');
  $('#btn-kind-zurueck').click(); await bis(() => aktiv('eltern'));
  $('#btn-eltern-zurueck').click(); await bis(() => aktiv('home'));

  // ---------- Randfälle, die Kind oder Eltern auslösen können ----------
  // Ansagen dauern jetzt wie echte: laufen, bis sie vorbei sind oder eine neue sie abbricht (wie abspielen())
  let dauer = 5;
  const spielen = (namen, fn) => { wiedergabeStoppen(); gesagt.push(...namen); if (fn) fn();
    return new Promise((r) => { wiedergabe.beenden = r; setTimeout(r, dauer); }); };
  folgeAbspielen = (folge) => spielen(folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', '')));
  zaehlenMitLeuchten = (name, el) => spielen([name], () => el.forEach((e) => e.classList.add('leuchtet')));
  const daumen = $('#btn-hol-daumen');
  const laut = $('#btn-hol-laut');
  const seit = (n) => gesagt.slice(n);
  const zaehle = (liste, name) => liste.filter((g) => g === name).length;
  const zuHause = async () => { if (!aktiv('home')) { zurStartseite(); await bis(() => aktiv('home')); } };
  const rundeStarten = async (runden, i = 0) => {
    await zuHause();
    kachel.click();
    holStoppen();
    hl.runden = runden; hl.runde = i; hlRundenZeichnen();
    const ab = gesagt.length;   // ab hier zählt (der echte Start hat schon einen Auftrag gesagt)
    holNeueRunde();
    await bis(() => !daumen.hidden);
    return ab;
  };

  // 9. 👍 doppelt/dreifach, während der Auftrag ein zweites Mal läuft; 🔊 zwischen den Runden
  dauer = 400;
  let n9 = await rundeStarten([{ n: 2, ding: 'becher' }, { n: 3, ding: 'baustein' }]);
  await bis(() => zaehle(seit(n9), 'hol-2-becher') === 2);   // der Auftrag kommt gerade nochmal
  daumen.click(); daumen.click(); await warte(30); daumen.click();
  await bis(() => zuletzt() === 'hol-zurueck' && hl.wartetZurueck, 4000);
  laut.click();   // 🔊 nach „Bring sie zurück“ (wartet aufs Zurückbringen): nichts
  await warte(50);
  daumen.click(); daumen.click();
  await bis(() => zuletzt() === 'hol-3-baustein', 3000);
  await warte(100);
  let s9 = seit(n9);
  pruefe(zaehle(s9, 'hol-leg-hin') === 1 && zaehle(s9, 'hol-zurueck') === 1 && zaehle(s9, 'hol-3-baustein') === 1 && hl.runde === 1,
    `👍 mehrfach während des Auftrags: ${s9} (Runde ${hl.runde})`);
  // 10. 🔊 während „Leg sie hin“, während des Mitzählens und am Spielende: nichts (Zählen wird nicht unterbrochen)
  await bis(() => !daumen.hidden);
  n9 = gesagt.length;
  daumen.click();
  await warte(50); laut.click();
  await bis(() => zuletzt() === 'hol-fertig-3-baustein', 3000);
  await warte(50); laut.click(); daumen.click();
  await bis(() => hl.wartetZurueck, 4000);
  daumen.click();
  await bis(() => $('#hol .spiel-ende') && !$('#hol .spiel-ende').hidden, 4000);
  laut.click(); await warte(50);
  s9 = seit(n9);
  pruefe(s9.join() === 'hol-leg-hin,hol-zeig-jeden-baustein,hol-fertig-3-baustein,hol-zurueck,ende-hol', `🔊/👍 während der Ansagen: ${s9}`);
  const endeR = $('#hol .spiel-ende').getBoundingClientRect();
  pruefe(getComputedStyle($('#hol .spiel-ende')).display !== 'none' && endeR.bottom <= innerHeight && endeR.height > 0, 'Spielende nicht sichtbar');

  // 11. 🏠 zwischen den Runden und während „Leg sie hin“ – danach neu starten: nichts Altes spricht hinein
  dauer = 5;
  Object.assign(HOL_ZEIT, { rundenPause: 500, hinlegen: 500 });
  const n11a = await rundeStarten([{ n: 1, ding: 'loeffel' }, { n: 3, ding: 'becher' }]);
  daumen.click();
  await bis(() => /^hol-zurueck/.test(zuletzt()));
  $('#btn-hol-home').click();
  await bis(() => aktiv('home'));
  let n11 = gesagt.length;
  await warte(700);
  pruefe(aktiv('home') && gesagt.length === n11, `🏠 in der Rundenpause: ${seit(n11)}`);
  // Grammatik bei einem Ding: der Löffel → „Leg ihn hin!“, nicht „Leg es hin!“
  const einzeln = seit(n11a).filter((g) => /^hol-(leg-hin|zurueck)/.test(g)).map((g) => ANSAGEN[g][0]);
  pruefe(!einzeln.some((t) => /\bes\b/.test(t)), `Ein Löffel heißt „es“: ${einzeln.join(' / ')}`);
  kachel.click();
  await bis(() => !daumen.hidden);
  pruefe(hl.runde === 0 && !$('#hol-runden .voll') && $('#hol').classList.contains('ruhig')
    && $('#hol .spiel-ende') && $('#hol .spiel-ende').hidden, 'Neustart nach 🏠 nicht frisch');
  daumen.click();
  await bis(() => /^hol-leg-hin/.test(zuletzt()));
  $('#btn-hol-home').click();
  await bis(() => aktiv('home'));
  kachel.click();   // sofort wieder hinein (Kind tippt schnell)
  n11 = gesagt.length;
  await warte(800);
  pruefe(!seit(n11).some((g) => /^(hol-zeig|zeig-mal|hol-fertig|hol-zurueck)/.test(g)), `Altes Spiel spricht nach Neustart: ${seit(n11)}`);
  // Android-Zurück während des Mitzählens: still
  dauer = 400;
  await bis(() => !daumen.hidden);
  daumen.click();
  await bis(() => /^hol-fertig/.test(zuletzt()), 3000);
  history.back();
  await bis(() => aktiv('home'));
  n11 = gesagt.length;
  await warte(900);
  pruefe(aktiv('home') && gesagt.length === n11, `Zurück-Taste im Zählen: ${seit(n11)}`);
  Object.assign(HOL_ZEIT, { rundenPause: 30, hinlegen: 10 });
  dauer = 5;

  // 12. Pause am Spielende: Pausen-Bild statt 🏠/🔁, danach startet das Spiel nicht
  speicher.schreiben('nest:pauseNach', 10);
  speicher.schreiben('nest:spielzeit', { ms: 11 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 11 * 60000 });
  await rundeStarten([{ n: 2, ding: 'loeffel' }, { n: 1, ding: 'becher' }], 1);
  daumen.click();
  await bis(() => hl.wartetZurueck, 3000);
  daumen.click();
  await bis(() => aktiv('pause'), 3000);
  pruefe(aktiv('pause') && (!$('#hol .spiel-ende') || $('#hol .spiel-ende').hidden) && zuletzt() === 'pause', `Pause am Spielende: ${gesagt.slice(-2)}`);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  const n12 = gesagt.length;
  kachel.click();
  await warte(300);
  pruefe(aktiv('pause') && !seit(n12).some((g) => g.startsWith('hol-')), `Spiel startet in der Pause: ${seit(n12)}`);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  speicher.schreiben('nest:pauseNach', 0);
  speicher.schreiben('nest:pauseAm', 0);

  // 13. Kind wechseln: jedes Kind holt nur seine Dinge; älteres Kind ohne Schalter = alle Dinge, 1–3
  const kindDazu = (id, name, dinge) => datenbank.kindSpeichern({ id, name, tier: TIERE[3], spieleAus: [], erstellt: Date.now(),
    ...(dinge ? Object.fromEntries(HOL_DINGE_OPTIONEN.map((o) => [o, dinge.includes(o)])) : {}) });
  await kindDazu('k-a', 'Anna', ['holBecher']);
  await kindDazu('k-b', 'Ömer-Groß', ['holKuscheltier', 'holLoeffel']);
  await kindDazu('k-alt', 'Jörg', null);
  await kinderLaden();
  const spieltMit = async (id, erwartet, text) => {
    await zuHause();
    $('#btn-kind').click();
    [...document.querySelectorAll('#wer .wer-kachel')].find((b) => b.textContent.includes(kinder.find((k) => k.id === id).name)).click();
    await bis(() => aktiv('home'));
    pruefe(!kachel.hidden, `${text}: Kachel fehlt`);
    for (let k = 0; k < 8; k++) {
      kachel.click();
      const dinge = hl.runden.map((r) => r.ding);
      pruefe(dinge.every((d) => erwartet.includes(d)) && hl.runden.every((r) => r.n >= 1 && r.n <= 3), `${text}: ${JSON.stringify(hl.runden)}`);
      holStoppen(); await zuHause();
    }
  };
  await spieltMit('k-a', ['becher'], 'Anna');
  await spieltMit('k-b', ['kuscheltier', 'loeffel'], 'Ömer');
  await spieltMit('k-alt', Object.keys(HOL_DINGE), 'Kind ohne Schalter');
  await spieltMit('k-a', ['becher'], 'Anna wieder');

  // 14. Kind-Formular: letztes Ding bleibt an, auch bei schnellem Hin- und Herschalten; Formular = Gespeichertes
  elternOeffnen();
  kindBearbeiten('k-b');
  const kb = (o) => $(`#kind-${o}`);
  const klick = (o) => { kb(o).checked = !kb(o).checked; kb(o).dispatchEvent(new Event('change')); };
  klick('holKuscheltier'); klick('holLoeffel');
  await warte(300);
  let gespeichert = (await datenbank.kinder()).find((k) => k.id === 'k-b');
  pruefe(HOL_DINGE_OPTIONEN.filter((o) => gespeichert[o]).length === 1, `Kind-Formular: alle Dinge aus: ${JSON.stringify(gespeichert)}`);
  for (let k = 0; k < 25; k++) { klick(zufall(HOL_DINGE_OPTIONEN)); await warte(Math.random() * 25); }
  await warte(500);
  gespeichert = (await datenbank.kinder()).find((k) => k.id === 'k-b');
  const anzeige = HOL_DINGE_OPTIONEN.map((o) => kb(o).checked);
  pruefe(HOL_DINGE_OPTIONEN.some((o) => gespeichert[o]) && anzeige.join() === HOL_DINGE_OPTIONEN.map((o) => !!gespeichert[o]).join(),
    `Schnelles Schalten: gespeichert ${HOL_DINGE_OPTIONEN.map((o) => !!gespeichert[o])}, angezeigt ${anzeige}`);
  history.back(); await bis(() => aktiv('eltern'));
  $('#btn-eltern-zurueck').click(); await bis(() => aktiv('home'));

  // Ansicht: Auftrag mit drei Bausteinen
  kachel.click();
  holStoppen();
  hl.runden = [{ n: 3, ding: 'baustein' }, { n: 1, ding: 'loeffel' }];
  hl.runde = 0;
  holNeueRunde();
  await bis(() => !$('#btn-hol-daumen').hidden);
  holStoppen();
  // 15. Größe/Drehung: 👍, 🏠, 🔊 im Bild; 👍 verdeckt weder Karte noch 👐
  const r = (sel) => $(sel).getBoundingClientRect();
  const drin = (q) => q.left >= 0 && q.top >= 0 && q.right <= innerWidth && q.bottom <= innerHeight && q.width > 0;
  const ueber = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  pruefe(drin(r('#btn-hol-daumen')) && drin(r('#btn-hol-home')) && drin(r('#btn-hol-laut')) && drin(r('#hol .in-echt-haende')),
    `Knöpfe nicht im Bild (${innerWidth}×${innerHeight})`);
  pruefe(!ueber(r('#btn-hol-daumen'), r('#hol .in-echt-karte')) && !ueber(r('#btn-hol-daumen'), r('#hol .in-echt-haende')),
    `👍 verdeckt Karte/👐 (${innerWidth}×${innerHeight})`);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = (fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'HOL-TESTS OK') + ` (${Math.round(performance.now() / 1000)} s)`;
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
