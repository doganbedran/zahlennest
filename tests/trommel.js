// Testet die Zahlen-Trommel: Rundenplan, Vortrommeln („…mal!“), Schläge zählen (Bumm sofort, Ring mit dem Zahlwort),
// kurz hintereinander = ein Schlag, zweiter Finger zählt, stumm während die App trommelt, Schläge schon während
// „Jetzt du!“/„Trommel weiter!“, Trommel ruht nach der Zahl, Hilfe (Punkte bleiben, gemeinsam trommeln mit Kind-Schlägen),
// ohne Schlag erinnern/vortrommeln/wach warten, 🔊, ruhiger Ausklang, echte Welt (klatschen), 🏠, Drehen, Pause, Maße.
// Ansagen „dauern“ wie im Browser (eine neue bricht die laufende ab). Frisches Browserprofil (ohne Begrüßung).
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

  // Wiedergabe nachgebildet: jede Ansage dauert DAUER ms, eine neue bricht die laufende ab (abgebrochen = Liste)
  const gesagt = [];
  const abgebrochen = [];
  const toene = [];   // Lautstärke jedes „Bumm“
  let DAUER = 120;
  const spiele = (name, ms) => new Promise((r) => {
    let fertig = false;
    const ende = (ganz) => { if (fertig) return; fertig = true; if (!ganz) abgebrochen.push(name); r(); };
    const abbruch = () => ende(false);
    wiedergabe.beenden = abbruch;
    setTimeout(() => { if (wiedergabe.beenden === abbruch) wiedergabe.beenden = null; ende(true); }, ms);
  });
  folgeAbspielen = async (folge) => {
    wiedergabeStoppen();
    const nummer = wiedergabe.nummer;
    for (const q of folge) {
      if (nummer !== wiedergabe.nummer) return;
      const name = q.url.replace('audio/ansage-', '').replace('.wav', '');
      gesagt.push(name);
      await spiele(name, DAUER);
    }
  };
  zaehlenMitLeuchten = async (name, el, beiJedem) => {
    wiedergabeStoppen();
    const nummer = wiedergabe.nummer;
    gesagt.push(name);
    const dauer = DAUER * (el.length + 1);
    el.forEach((e, i) => setTimeout(() => {
      if (nummer !== wiedergabe.nummer) return;
      e.classList.add('leuchtet');
      if (beiJedem) beiJedem(i);
    }, (dauer * i) / (el.length + 1)));
    await spiele(name, dauer);
  };
  bumm = (laut = 0.4) => { toene.push(laut); };
  Object.assign(TROMMEL_ZEIT, { pause: 60000, erinnern: 60000, nochmalVor: 60000, zusammenTakt: 500, fertig: 10, rundenPause: 50,
    daumen: 120, auftragNochmal: 250, vormachenPause: 10 });
  const zeitAlt = { ...TROMMEL_ZEIT };
  const zuletzt = () => gesagt[gesagt.length - 1];
  const kindDran = () => bis(() => tr.phase === 'kind');
  const ruhig = () => bis(() => !tr.sprech.offen);
  const schlag = async (pause = 340, primaer = true, ziel = trTrommel()) => {
    ziel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: primaer ? 1 : 2, isPrimary: primaer }));
    await warte(pause);
  };
  const voll = () => document.querySelectorAll('#trommel-feld .trommel-karte .karte-punkt.voll').length;
  const runde = async (n) => {   // Runde ohne Vortrommeln (Runde 3)
    trommelStoppen();
    tr.runde = 2;
    tr.runden[2] = n;
    trRundenZeichnen();
    trommelNeueRunde();
    await kindDran();
    await bis(() => zuletzt() === 'trommel-jetzt-du');
    await warte(DAUER + 20);
  };
  const stillNach = async (fn, ms = 900) => { fn(); await bis(() => aktiv('home'), 1500); const n = gesagt.length; await warte(ms); return gesagt.slice(n); };

  // 1. Neues Gerät: nicht im Regal; im Elternbereich einstellbar (mit Schalter „bis 5“), dann auf der Startseite
  const kachel = $('#home .spiel-btn[data-spiel="trommel"]');
  pruefe(kachel.hidden, 'Trommel steht schon auf einem neuen Gerät im Regal');
  elternOeffnen();
  [...document.querySelectorAll('#spiele-wahl .regal-spiel')].find((b) => b.textContent.includes('Trommel')).click();
  pruefe(!$('#karte-regal .spiel-option[data-spiel="trommel"]').hidden, 'Schalter „bis 5“ fehlt');
  zurStartseite(); await warte(300);
  pruefe(!kachel.hidden, 'Kachel nicht sichtbar');

  // 2. Rundenplan: 4 Runden, 1–3, nie zweimal dieselbe Menge hintereinander; „bis 5“: 3–5, beginnt mit 3
  for (let k = 0; k < 30; k++) {
    const plan = trommelRundenPlanen();
    pruefe(plan.length === 4 && plan.every((n) => n >= 1 && n <= 3) && plan.every((n, i) => !i || n !== plan[i - 1]), `Plan: ${plan}`);
  }
  zustand.trommelBis5 = true;
  const plan5 = trommelRundenPlanen();
  pruefe(plan5[0] === 3 && plan5.every((n) => n >= 3 && n <= 5), `bis 5: ${plan5}`);
  zustand.trommelBis5 = false;
  pruefe(Object.keys(ANSAGEN).filter((a) => a.startsWith('trommel')).every((a) => !/\bhau/i.test(ANSAGEN[a][0])), 'Ansage mit „hau“');

  // 3. Erste Runde mit Dauertrommeln: „Trommel dreimal!“, „Hör zu!“, die App trommelt vor („… Dreimal!“), die Schläge
  //    des Kindes bleiben dabei stumm und zählen nicht; dann „Jetzt du!“, Trommel wach, Karte leer
  kachel.click();
  pruefe(aktiv('trommel'), 'Spiel nicht geöffnet');
  trommelStoppen();
  tr.runde = 0; tr.runden[0] = 3; tr.hilfeGebraucht = false;
  await warte(DAUER + 20);
  abgebrochen.length = 0;   // die vom Kachel-Start begonnene Runde wurde eben abgebrochen
  let n = gesagt.length, t0 = toene.length;
  const dauerTrommeln = setInterval(() => { if (tr.phase !== 'kind') schlag(0); }, 150);
  trommelNeueRunde();
  await kindDran();
  clearInterval(dauerTrommeln);
  await bis(() => zuletzt() === 'trommel-jetzt-du');
  pruefe(gesagt.slice(n).join() === 'trommel-hau-3,trommel-hoerzu,trommel-vor-3,trommel-jetzt-du', `Vortrommeln: ${gesagt.slice(n)}`);
  pruefe(!abgebrochen.length && tr.schlaege === 0 && voll() === 0, `Dauertrommeln: ${tr.schlaege} gezählt, abgebrochen ${abgebrochen}`);
  pruefe(toene.slice(t0).length === 3, `Während die App trommelt, klingen Kind-Schläge mit: Töne ${toene.slice(t0)}`);
  pruefe(!document.querySelector('#trommel-feld .karte-punkt.leuchtet') && trTrommel().classList.contains('wach'), 'Nach dem Vortrommeln: Karte/Trommel');
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#trommel').innerText), `Text auf dem Kinder-Bildschirm: ${$('#trommel').innerText}`);
  const tR = trTrommel().getBoundingClientRect(), kR = $('#trommel-feld .trommel-karte').getBoundingClientRect();
  pruefe(Math.min(tR.width, tR.height) >= 150 && tR.left >= 0 && tR.right <= innerWidth && tR.bottom <= innerHeight - 20, `Trommel schlecht platziert: ${Math.round(tR.width)} px, unten ${Math.round(tR.bottom)}`);
  pruefe(kR.bottom <= tR.top + 2 || kR.right <= tR.left + 2, 'Karte liegt über der Trommel');
  pruefe(getComputedStyle(trTrommel()).touchAction === 'none', 'touch-action fehlt');
  await warte(DAUER + 20);   // „Jetzt du!“ ausklingen lassen (ein Schlag würde es abbrechen – gewollt)

  // 4. Schläge: Bumm sofort, Ring mit dem Zahlwort; Doppeltipp (< 0,3 s) zählt einmal; zweiter Finger zählt (Daumen am Rand)
  t0 = toene.length; n = gesagt.length;
  await schlag(60);
  await schlag(340);
  pruefe(tr.schlaege === 1 && toene.slice(t0).length === 1, `Doppeltipp: ${tr.schlaege}`);
  await schlag(340, false);
  pruefe(tr.schlaege === 2, `Zweiter Finger zählt nicht: ${tr.schlaege}`);
  await schlag(10);
  pruefe(tr.phase === 'ruht' && tr.schlaege === 3, 'Trommel ruht nicht nach der Zahl');
  // nach der Zahl: weitertrommeln klingt leise, zählt nicht
  const tRuh = toene.length;
  await schlag(320); await schlag(10);
  pruefe(toene.slice(tRuh).every((l) => l < 0.2) && tr.schlaege === 3, `Weitertrommeln: ${toene.slice(tRuh)}`);
  await bis(() => tr.runde === 1, 4000);
  pruefe(gesagt.slice(n).join() === 'korb-zahl-1,korb-zahl-2,korb-zahl-3,trommel-fertig-3' && !abgebrochen.length,
    `Zählen/fertig: ${gesagt.slice(n)} abgebrochen ${abgebrochen}`);

  // 5. Ring füllt sich erst, wenn seine Zahl gesagt wird (schnell trommeln: Punkte laufen nicht vor)
  await runde(3);
  DAUER = 700;   // langsam gesprochene Zahlen
  await schlag(320); await schlag(320); await schlag(5);
  pruefe(voll() < 3, `Alle Ringe schon voll, bevor die Zahlen gesagt sind: ${voll()}`);
  await bis(() => voll() === 3, 4000);
  DAUER = 120;
  await bis(() => tr.runde === 3, 3000);
  // Zweite Runde ohne Vortrommeln, weil Runde 1 keine Hilfe brauchte
  pruefe(!tr.hilfeGebraucht, 'Hilfe gebraucht?');

  // 6. 🔊: während eines Zahlworts nichts, sonst Auftrag nochmal; Punkte bleiben
  await runde(3);
  await schlag(10);
  $('#btn-trommel-laut').click();
  await ruhig();
  pruefe(zuletzt() === 'korb-zahl-1', `🔊 während Zahlwort: ${zuletzt()}`);
  $('#btn-trommel-laut').click();
  await warte(20);
  pruefe(zuletzt() === 'trommel-hau-3' && voll() === 1, `🔊: ${zuletzt()}`);
  await warte(DAUER + 20);

  // 7. Pause: Punkte bleiben, „Trommel weiter!“ (Ring pulsiert; ein Schlag schon während des Satzes zählt)
  await runde(3);
  TROMMEL_ZEIT.pause = 600;
  await schlag(10);
  await bis(() => zuletzt() === 'trommel-weiter', 3000);
  pruefe(voll() === 1 && document.querySelector('#trommel-feld .karte-punkt.pulsiert'), 'Trommel weiter: Punkte weg oder kein Pulsieren');
  await schlag(10);   // sofort, während „Trommel weiter!“
  pruefe(tr.schlaege === 2, `Schlag während „Trommel weiter!“ zählt nicht: ${tr.schlaege}`);
  // dann gemeinsam: die App gibt den Takt; schlägt das Kind, zählt sein Schlag (keine App-Schläge doppelt)
  await bis(() => tr.phase === 'zusammen', 4000);
  pruefe(gesagt.includes('trommel-zusammen'), 'Kein gemeinsames Trommeln');
  await warte(320 - Math.min(320, performance.now() - tr.letzterSchlag));   // nicht als Doppeltipp
  await schlag(10);
  pruefe(tr.schlaege === 3, `Kind-Schlag beim gemeinsamen Trommeln zählt nicht: ${tr.schlaege}`);
  await bis(() => tr.runde === 3 && tr.phase === 'kind', 4000);
  TROMMEL_ZEIT.pause = 60000;
  // gemeinsam ohne Kind: die App schlägt den Rest (= Lösung), Zählfolge vollständig
  await runde(3);
  TROMMEL_ZEIT.pause = 150;
  n = gesagt.length;
  await schlag(10);
  await bis(() => gesagt.slice(n).includes('trommel-fertig-3'), 6000);
  const z7 = gesagt.lastIndexOf('trommel-zusammen');
  pruefe(z7 > n && gesagt.slice(z7 + 1, z7 + 4).join() === 'korb-zahl-2,korb-zahl-3,trommel-fertig-3', `Gemeinsam (App): ${gesagt.slice(n)}`);
  TROMMEL_ZEIT.pause = 60000;
  await bis(() => tr.phase === 'kind', 3000);

  // 8. 🏠 bzw. Zurück während des gemeinsamen Trommelns: danach still
  for (const weg of ['home', 'zurueck']) {
    if (!aktiv('trommel')) { kachel.click(); await bis(() => aktiv('trommel')); }
    await runde(3);
    TROMMEL_ZEIT.pause = 150;
    await schlag(10);
    await bis(() => tr.phase === 'zusammen', 4000);
    const still = await stillNach(() => (weg === 'home' ? $('#btn-trommel-home').click() : history.back()));
    pruefe(aktiv('home') && !still.length, `${weg} beim gemeinsamen Trommeln: ${still}`);
    TROMMEL_ZEIT.pause = 60000;
  }
  kachel.click();
  await bis(() => aktiv('trommel'));

  // 9. Gar kein Schlag: „Trommel mal!“ (Schlag schon währenddessen zählt), sonst einmal vortrommeln, dann wach warten
  await runde(2);
  Object.assign(TROMMEL_ZEIT, { erinnern: 150, nochmalVor: 250 });
  trHilfeAbwarten(tr.nummer);
  await bis(() => zuletzt() === 'trommel-erinnerung', 2000);
  await bis(() => gesagt.slice(-3).join() === 'trommel-hoerzu,trommel-vor-2,trommel-jetzt-du', 3000);
  pruefe(gesagt.slice(-3).join() === 'trommel-hoerzu,trommel-vor-2,trommel-jetzt-du', `Ohne Schlag: ${gesagt.slice(-4)}`);
  await bis(() => trTrommel().classList.contains('wartet'), 2000);
  const n9 = gesagt.length;
  await warte(700);
  pruefe(gesagt.length === n9 && tr.phase === 'kind' && trTrommel().classList.contains('wartet'), `Ohne Schlag nicht still/wach: ${gesagt.slice(n9)}`);
  Object.assign(TROMMEL_ZEIT, { erinnern: 60000, nochmalVor: 60000 });
  // Ein Tipp auf den (pulsierenden) Punkt zählt wie ein Schlag
  await schlag(340, true, $('#trommel-feld .trommel-karte'));
  pruefe(tr.schlaege === 1, 'Tipp auf die Karte zählt nicht');

  // 10. Drehen mitten in der Runde: Ringe und Zustand bleiben, Trommel im Bild
  await runde(3);
  await schlag(); await schlag();
  await ruhig();
  dispatchEvent(new Event('resize'));
  await warte(100);
  const dR = trTrommel().getBoundingClientRect();
  pruefe(voll() === 2 && tr.phase === 'kind' && dR.right <= innerWidth && dR.bottom <= innerHeight, 'Drehen: Ringe/Zustand verloren');

  // 11. Letzte Runde → ruhiger Ausklang („Die Trommel schläft jetzt.“) → echte Welt: Hände klatschen vor,
  //     „Jetzt in echt!“, ruhig (keine Trommel mehr); 👍 → „Klatsch mit!“ + Mitzählen, Ende
  tr.runde = TROMMEL_RUNDEN - 1;
  trRundenZeichnen();
  for (let i = tr.schlaege; i < tr.n; i++) await schlag();
  await bis(() => gesagt.includes('trommel-schlaeft'), 4000);
  await bis(() => tr.inEcht && !tr.gesperrt, 5000);
  const w = tr.weltMenge;
  const s11 = gesagt.lastIndexOf('trommel-schlaeft');
  pruefe(gesagt.slice(s11).join() === `trommel-schlaeft,trommel-welt-${w},trommel-welt-${w}-fertig,jetzt-in-echt,trommel-welt-${w}`, `Ausklang/echte Welt: ${gesagt.slice(s11)}`);
  pruefe($('#trommel').classList.contains('ruhig') && !trTrommel() && document.querySelectorAll('#trommel .in-echt-karte .karte-punkt').length === w,
    'Kein ruhiger In-echt-Bildschirm (oder Trommel noch da)');
  await bis(() => !$('#btn-trommel-daumen').hidden);
  $('#btn-trommel-daumen').click();
  await bis(() => $('#trommel .spiel-ende') && !$('#trommel .spiel-ende').hidden);
  pruefe(gesagt.slice(-3).join() === `trommel-klatsch-mit,trommel-welt-${w}-fertig,ende-trommel` && tr.runde === TROMMEL_RUNDEN, `Ende: ${gesagt.slice(-3)}`);

  // 12. Pause fällig am Spielende: Pausenbild statt 🏠/🔁, danach still; während der Pause startet das Spiel nicht
  $('#trommel .ende-nochmal').click();
  pruefe(tr.runde === 0 && !$('#trommel').classList.contains('ruhig'), '🔁 beginnt nicht neu');
  speicher.schreiben('nest:pauseNach', 10);
  speicher.schreiben('nest:spielzeit', { ms: 11 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 11 * 60000 });
  trommelStoppen();
  tr.runde = TROMMEL_RUNDEN;
  trommelAuftrag();
  await bis(() => !$('#btn-trommel-daumen').hidden, 4000);
  $('#btn-trommel-daumen').click();
  await bis(() => aktiv('pause'), 4000);
  pruefe(aktiv('pause') && zuletzt() === 'pause' && gesagt.includes('ende-trommel'), `Pause am Ende: ${gesagt.slice(-3)}`);
  n = gesagt.length;
  await warte(500);
  pruefe(gesagt.length === n, `Nach dem Pausenbild spricht das Spiel weiter: ${gesagt.slice(n)}`);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  kachel.click();
  pruefe(aktiv('pause'), 'Während der Pause startet die Trommel');
  speicher.schreiben('nest:pauseAm', 0);
  speicher.schreiben('nest:pauseNach', 0);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  Object.assign(TROMMEL_ZEIT, zeitAlt);

  // Ansicht: Runde mit 3, zwei Schläge, nächster Ring pulsiert
  kachel.click();
  await runde(3);
  await schlag(); await schlag();
  await ruhig();
  trRinge()[2].classList.add('pulsiert');
  trommelStoppen();

  // Schnelles Draufhauen: solange das Zahlwort klingt, zählt kein weiterer Schlag (ein Schlag – ein Wort)
  Object.assign(TROMMEL_ZEIT, zeitAlt);
  await runde(3);
  await schlag(30); await schlag(30); await schlag(30);
  pruefe(tr.schlaege === 1, `Schnelle Schläge zählen alle: ${tr.schlaege}`);
  await ruhig();
  await warte(TROMMEL_ZEIT.zittern);   // (zwei Schläge kurz hintereinander zählen ohnehin als einer)
  await schlag(30);
  pruefe(tr.schlaege === 2, `Nach dem Wort zählt der nächste Schlag nicht: ${tr.schlaege}`);
  trommelStoppen();

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = (fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'TROMMEL-TESTS OK') + ` (${Math.round(performance.now() / 1000)} s)`;
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
