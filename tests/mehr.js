// Testet „Mehr oder weniger?“: Rundenplan, Treffer, Daneben (paaren / zählen / Lösung), ohne Tipp, „weniger“-Schalter,
// echte Welt mit 👍, Ende, 🔊, 🏠, Aussehen. Frisches Browserprofil (ohne Begrüßung). Zeiten verkürzt, Töne mitgeschrieben.
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
  Object.assign(MEHR_ZEIT, { nochmalFragen: 5000, pause: 10, paarSchritt: 20, zeigen: 50, daumen: 120, auftragNochmal: 250 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const teller = () => mwTeller();
  const frei = async () => { await bis(() => !mw.gesperrt); await warte(420); };
  pruefe((await fetch('audio/ansage-zaehlen-5.wav')).ok && (await fetch('audio/ansage-mehr-wo.wav')).ok, 'Ansagen fehlen');

  // 1. Neues Gerät: nicht im Regal (erst zeigen, wenn zusammen ausprobiert); im Elternbereich wählbar, mit Zeichnung
  const kachel = $('#home .spiel-btn[data-spiel="mehr"]');
  pruefe(kachel.hidden, '„Mehr oder weniger?“ steht schon auf einem neuen Gerät im Regal');
  elternOeffnen();
  const regalKnopf = [...document.querySelectorAll('#spiele-wahl .regal-spiel')].find((b) => b.textContent.includes('Mehr oder weniger'));
  pruefe(regalKnopf && regalKnopf.querySelector('svg'), 'Nicht im Regal des Elternbereichs');
  regalKnopf.click();
  pruefe(!$('.spiel-option[data-spiel="mehr"]').hidden, 'Schalter „weniger“ fehlt');
  zurStartseite(); await warte(300);
  pruefe(!kachel.hidden && kachel.querySelector('svg'), 'Kachel nicht sichtbar');

  // 2. Rundenplan: 8 Runden, nur „mehr“, nie knapp/gleich, nie dreimal dieselbe Seite, erst große Unterschiede
  for (let k = 0; k < 30; k++) {
    const plan = mehrRundenPlanen();
    pruefe(plan.length === 8 && plan.every((r) => r.frage === 'mehr'), 'Plan ohne „weniger“ falsch');
    pruefe(plan.every((r) => Math.max(...r.mengen) / Math.min(...r.mengen) >= 5 / 3 && r.mengen[0] !== r.mengen[1]), `Knappes Paar: ${JSON.stringify(plan.map((r) => r.mengen))}`);
    pruefe(plan.slice(0, 4).every((r) => Math.max(...r.mengen) - Math.min(...r.mengen) >= 2), 'Am Anfang kein großer Unterschied');
    const seiten = plan.map((r) => r.mengen.indexOf(Math.max(...r.mengen)));
    pruefe(!seiten.some((x, i) => i >= 2 && x === seiten[i - 1] && x === seiten[i - 2]), 'Dreimal dieselbe Seite');
    pruefe(plan.every((r) => r.mengen[r.ziel] === Math.max(...r.mengen)), 'Ziel nicht der volle Teller');
    pruefe(!plan.some((r, i) => i && r.ding === plan[i - 1].ding), 'Zweimal dasselbe Ding hintereinander');
  }

  // 3. Start: zwei Teller, Einleitung, gleich große Dinge, im Bild
  kachel.click();
  pruefe(aktiv('mehr'), 'Spiel nicht geöffnet');
  await frei();
  pruefe(zuletzt() === 'mehr-start' && teller().length === 2, `Start: ${zuletzt()}`);
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#mehr').innerText), `Text auf dem Kinder-Bildschirm: ${$('#mehr').innerText}`);
  const r0 = mwRunde();
  teller().forEach((t, i) => {
    pruefe(mwDinge(t).length === r0.mengen[i], `Teller ${i}: ${mwDinge(t).length} statt ${r0.mengen[i]}`);
    const b = t.getBoundingClientRect();
    pruefe(b.width >= 180 && b.left >= 12 && b.right <= innerWidth - 12 && b.bottom <= innerHeight - 20 && b.top >= 70,
      `Teller ${i} nicht gut im Bild: ${Math.round(b.left)}–${Math.round(b.right)} / ${Math.round(b.top)}–${Math.round(b.bottom)}`);
  });
  const groessen = new Set([...document.querySelectorAll('#mehr .ding')].map((d) => Math.round(d.getBoundingClientRect().width)));
  pruefe(groessen.size <= 2, `Dinge verschieden groß: ${[...groessen]}`);

  // 4. Treffer → „Hier sind mehr!“, nächste Runde mit kurzer Frage
  teller()[r0.ziel].click();
  pruefe(teller()[r0.ziel].classList.contains('richtig'), 'Treffer ohne Ring');
  await bis(() => mw.runde === 1);
  await frei();
  pruefe(gesagt.includes('mehr-hier') && zuletzt() === 'mehr-wo' && mw.runde === 1, `Nach Treffer: ${gesagt.slice(-3)}`);
  pruefe(!document.querySelector('#mehr .blass'), 'Ein Teller ist blass');

  // 5. Daneben 1: „Schau mal!“ + paaren (gleiche Spalten untereinander), dann Frage; 2: zählen (erst weniger);
  //    3: Lösung und weiter
  const r1 = mwRunde();
  const falsch = 1 - r1.ziel;
  teller()[falsch].click();
  await frei();
  pruefe(gesagt.slice(-2).join() === 'schau-mal,mehr-wo', `1. Daneben: ${gesagt.slice(-3)}`);
  const xs = teller().map((t) => mwDinge(t).map((d) => Math.round(d.getBoundingClientRect().left + d.getBoundingClientRect().width / 2)));
  const ys = teller().map((t) => new Set(mwDinge(t).map((d) => Math.round(d.getBoundingClientRect().top))));
  pruefe(ys.every((y) => y.size === 1), 'Nach dem Paaren nicht in einer Reihe');
  const kurz = xs[0].length < xs[1].length ? 0 : 1;
  pruefe(xs[kurz].every((x, i) => Math.abs(x - xs[1 - kurz][i]) <= 2), `Paare stehen nicht untereinander: ${JSON.stringify(xs)}`);
  pruefe(mw.versuche === 1 && mw.runde === 1, 'Daneben zählt als Schritt');
  teller()[falsch].click();
  await frei();
  const klein = Math.min(...r1.mengen), gross = Math.max(...r1.mengen);
  pruefe(gesagt.slice(-3).join() === `zaehlen-${klein},zaehlen-${gross},mehr-wo`, `2. Daneben: ${gesagt.slice(-4)}`);
  pruefe(!document.querySelector('#mehr .ding.leuchtet'), 'Leuchten bleibt hängen');
  teller()[falsch].click();
  await bis(() => mw.runde === 2);
  pruefe(mw.runde === 2 && gesagt.includes('mehr-hier'), '3. Daneben: keine Lösung');

  // 6. 🔊: nur die Frage, Teller bleiben; ohne Tipp: Frage nochmal, dann paaren (zählt nicht als Versuch)
  MEHR_ZEIT.nochmalFragen = 150;
  await frei();
  const vorher = teller().map((t) => mwDinge(t).length).join();
  $('#btn-mehr-laut').click();
  await frei();
  pruefe(zuletzt() === 'mehr-wo' && teller().map((t) => mwDinge(t).length).join() === vorher && mw.runde === 2, '🔊 ändert die Runde');
  await bis(() => mw.gepaart, 2000);
  pruefe(mw.gepaart && mw.versuche === 0 && mw.runde === 2, 'Ohne Tipp: kein stilles Paaren oder als Versuch gezählt');
  pruefe(gesagt.filter((g) => g === 'mehr-wo').length >= 3, 'Ohne Tipp: Frage nicht wiederholt');
  // Nach dem stillen Paaren bleibt nichts stehen: Frage nochmal, dann pulsiert der gesuchte Teller
  await bis(() => teller()[mwRunde().ziel].classList.contains('pulsiert'), 2000);
  pruefe(teller()[mwRunde().ziel].classList.contains('pulsiert') && !mw.gesperrt, 'Nach dem stillen Paaren passiert nichts mehr');
  MEHR_ZEIT.nochmalFragen = 5000;

  // 7. Restliche Runden richtig → echte Welt: Bilder, 👍 erst nach kurzer Zeit, Tipp aufs Bild zählt nicht
  while (!mw.auftrag) {
    await frei();
    if (mw.auftrag) break;
    teller()[mwRunde().ziel].click();
    await bis(() => mw.gesperrt === false || mw.auftrag, 3000);
  }
  await bis(() => !mw.gesperrt);
  // „Jetzt in echt!“, dann der Auftrag in zwei Teilen; ruhiger Bildschirm mit kleiner Karte und 👐, nichts Greifbares
  pruefe(gesagt.slice(-3)[0] === 'jetzt-in-echt' && ['welt-nase', 'welt-mund'].includes(zuletzt()) && gesagt.slice(-2)[0].match(/^welt-(augen|haende)$/), `Auftrag: ${gesagt.slice(-3)}`);
  pruefe($('#btn-mehr-daumen').hidden, '👍 sofort da');
  pruefe($('#mehr').classList.contains('ruhig') && document.querySelectorAll('#mehr .in-echt-karte .karte-bild').length === 2
    && $('#mehr .in-echt-haende') && !teller().length, 'Kein ruhiger In-echt-Bildschirm');
  // Tippen aufs Bild: einmal sanft umlenken
  $('#mehr .in-echt').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await bis(() => zuletzt() === 'echt-umlenken');
  pruefe(zuletzt() === 'echt-umlenken' && !mw.fertig, 'Tippen aufs Bild lenkt nicht um');
  await bis(() => !$('#btn-mehr-daumen').hidden);
  const db = $('#btn-mehr-daumen').getBoundingClientRect();
  pruefe(db.width >= 56 && db.bottom <= innerHeight - 16 && db.right <= innerWidth - 12, `👍 nicht gut erreichbar: unten ${Math.round(db.bottom)} von ${innerHeight}`);
  $('#btn-mehr-daumen').click(); $('#btn-mehr-daumen').click();
  await bis(() => $('#mehr .spiel-ende') && !$('#mehr .spiel-ende').hidden);
  pruefe(gesagt.filter((g) => g.endsWith('-fertig')).length === 1 && gesagt.slice(-3)[0] === 'zeig-mal' && MEHR_ENDE.includes(zuletzt()), `Ende: ${gesagt.slice(-3)}`);
  pruefe(mw.runde === 8, `Runden: ${mw.runde}`);

  // 8. Auftrag ohne Tipp: einmal wiederholt, dann wartet die App (keine Zeitgrenze); Lob am Ende wechselt
  const ende1 = zuletzt();
  $('#mehr .ende-nochmal').click();
  pruefe(mw.runde === 0 && $('#mehr .spiel-ende').hidden, '🔁 beginnt nicht neu');
  await frei();
  const vorAuftrag = gesagt.length;
  mw.runde = 8;
  mehrAuftrag();
  await warte(1500);
  pruefe(mw.inEcht && !mw.fertig && (!$('#mehr .spiel-ende') || $('#mehr .spiel-ende').hidden), 'Auftrag endet ohne 👍 von selbst');
  pruefe(gesagt.slice(vorAuftrag).filter((g) => /^welt-(augen|haende)$/.test(g)).length === 2, `Auftrag nicht einmal wiederholt: ${gesagt.slice(vorAuftrag)}`);
  $('#btn-mehr-daumen').click();
  await bis(() => !$('#mehr .spiel-ende').hidden, 3000);
  pruefe(zuletzt() !== ende1, 'Lob am Ende zweimal gleich');

  // 9. „weniger“ einschalten (je Kind): 4× mehr, dann angesagter Wechsel, 4× weniger mit großen Unterschieden
  window.prompt = () => 'Lina';
  elternOeffnen();
  await kindNeu();
  pruefe(!$('#kind .spiel-option[data-spiel="mehr"]').hidden, 'Schalter beim Kind fehlt');
  $('#kind-weniger').click();
  await bis(() => zustand.weniger === true);
  pruefe(kinder[0].weniger === true && zustand.weniger === true, '„weniger“ nicht gespeichert');
  const plan = mehrRundenPlanen();
  pruefe(plan.slice(0, 4).every((r) => r.frage === 'mehr') && plan.slice(4).every((r) => r.frage === 'weniger'), 'Plan mit „weniger“ falsch');
  pruefe(plan.slice(4).every((r) => r.mengen[r.ziel] === Math.min(...r.mengen) && Math.max(...r.mengen) - Math.min(...r.mengen) >= 2), 'weniger: Ziel/Unterschied falsch');
  $('#btn-kind-zurueck').click(); await bis(() => aktiv('eltern'));
  $('#btn-eltern-zurueck').click(); await bis(() => aktiv('home'));
  kachel.click();
  await frei();
  mw.runde = 4;
  mehrNeueRunde();
  await frei();
  pruefe(zuletzt() === 'weniger-start', `Wechsel zu „weniger“ nicht angesagt: ${zuletzt()}`);
  teller()[mwRunde().ziel].click();
  await bis(() => mw.runde === 5);
  pruefe(gesagt.includes('weniger-hier'), '„Hier sind weniger!“ fehlt');
  await frei();
  pruefe(zuletzt() === 'weniger-wo', `Frage danach: ${zuletzt()}`);

  // 10. 🏠 mitten im Paaren: still, nichts läuft weiter
  teller()[1 - mwRunde().ziel].click();
  await warte(30);
  $('#btn-mehr-home').click();
  await warte(300);
  const n0 = gesagt.length;
  await warte(800);
  pruefe(aktiv('home') && gesagt.length === n0, `Nach 🏠 läuft das Spiel weiter: ${gesagt.slice(n0)}`);

  // 11. Kinderhände: schnelles Mehrfachtippen, 🔊 während Paaren/Zählen, 🏠/Zurück in Wartepausen, Pause am Ende,
  //     Kind wechseln. Befunde, die (noch) Fehler sind, stehen in `befunde` und färben die Leiste nicht rot.
  const befunde = [];
  const meldung = (b, t) => { if (!b) befunde.push(t); };
  const spielAuf = async () => { kachel.click(); await bis(() => aktiv('mehr')); await frei(); };
  const rundeSetzen = async (mengen, frage = 'mehr') => {
    mw.runden[mw.runde] = { mengen, ding: 'ball', frage, ziel: frage === 'mehr' ? mengen.indexOf(Math.max(...mengen)) : mengen.indexOf(Math.min(...mengen)) };
    mehrNeueRunde();
    await frei();
  };
  const homeUndStill = async (wartenMs) => {
    $('#btn-mehr-home').click();
    await bis(() => aktiv('home'), 1000);
    const n = gesagt.length;
    await warte(wartenMs);
    return gesagt.slice(n);
  };

  // 11a. Beide Teller fast gleichzeitig (Doppeltipp, zwei Finger): nur der erste Tipp zählt
  await spielAuf();
  mw.runde = 1;
  await rundeSetzen([1, 4]);
  let n = gesagt.length;
  teller()[0].click(); teller()[1].click(); teller()[0].click();
  await frei();
  pruefe(mw.versuche === 1 && !teller()[1].classList.contains('richtig') && mw.runde === 1,
    `Doppeltipp: Versuche ${mw.versuche}, Runde ${mw.runde}`);
  pruefe(gesagt.slice(n).filter((g) => g === 'schau-mal').length === 1, `Doppeltipp: ${gesagt.slice(n)}`);
  // … und während „Schau mal!“/Paaren weitertippen: nichts zählt mit
  await rundeSetzen([4, 1]);
  n = gesagt.length;
  const tippe = setInterval(() => { mw.letzterTipp = 0; teller()[1].click(); teller()[0].click(); }, 30);
  await warte(250);
  clearInterval(tippe);
  await frei();
  pruefe(mw.versuche === 1 && mw.runde === 1, `Dauertippen während Paaren: Versuche ${mw.versuche}, Runde ${mw.runde}`);

  // 11b. 🔊 während Paaren und während des Zählens: nichts Neues, Zählfolge bleibt vollständig
  const PS = MEHR_ZEIT.paarSchritt;
  MEHR_ZEIT.paarSchritt = 150;
  await rundeSetzen([1, 5]);
  n = gesagt.length;
  teller()[0].click();
  await bis(() => gesagt.length > n);
  $('#btn-mehr-laut').click(); await warte(200); $('#btn-mehr-laut').click();
  await frei();
  pruefe(gesagt.slice(n).join() === 'schau-mal,mehr-wo' && mw.gepaart, `🔊 beim Paaren: ${gesagt.slice(n)}`);
  MEHR_ZEIT.paarSchritt = PS;
  const ZM = zaehlenMitLeuchten;
  zaehlenMitLeuchten = async (name, el) => { gesagt.push(name); await warte(150); };
  n = gesagt.length;
  teller()[0].click();
  await bis(() => gesagt.length > n);
  $('#btn-mehr-laut').click(); await warte(300); $('#btn-mehr-laut').click();
  await frei();
  pruefe(gesagt.slice(n).join() === 'zaehlen-1,zaehlen-5,mehr-wo', `🔊 beim Zählen: ${gesagt.slice(n)}`);

  // 11c. 🏠 kurz nach dem Zählen-Beginn (2. Daneben): darf auf der Startseite nicht weiterzählen
  await rundeSetzen([2, 5]);
  teller()[0].click(); await frei();
  n = gesagt.length;
  teller()[0].click();
  await bis(() => gesagt.length > n);
  await warte(200);   // im Warten nach „eins, zwei“
  let nachHome = await homeUndStill(900);
  pruefe(!nachHome.length, `Muss: 🏠 während des Zählens – auf der Startseite geht es weiter: ${nachHome}`);
  zaehlenMitLeuchten = ZM;

  // 11d. 🏠 direkt nach einem Treffer (in den 400 ms vor „Hier sind mehr!“)
  await spielAuf();
  await rundeSetzen([1, 4]);
  teller()[1].click();
  await warte(100);
  nachHome = await homeUndStill(700);
  pruefe(!nachHome.length, `Muss: 🏠 direkt nach Treffer – Ansage auf der Startseite: ${nachHome}`);

  // 11e. Android-Zurück mitten im Paaren: still
  await spielAuf();
  await rundeSetzen([1, 4]);
  teller()[0].click();
  await bis(() => mw.gepaart, 1000);
  history.back();
  await bis(() => aktiv('home'), 1000);
  n = gesagt.length;
  await warte(900);
  pruefe(aktiv('home') && gesagt.length === n, `Zurück beim Paaren: ${gesagt.slice(n)}`);

  // 11f. 🔊 im Auftrag (Erwachsener tippt nochmal): 👍 verschwindet wieder
  await spielAuf();
  mw.runde = 8;
  mehrAuftrag();
  await bis(() => !$('#btn-mehr-daumen').hidden, 2000);
  $('#btn-mehr-laut').click();
  await warte(20);
  pruefe(!$('#btn-mehr-daumen').hidden, '🔊 im Auftrag versteckt 👍 wieder');
  await bis(() => !$('#btn-mehr-daumen').hidden, 2000);

  // 11g. Pause fällig am Spielende: Pausenbild statt 🏠/🔁, kein Spiel mehr, 🏠 führt heim, Spiel zeigt Pause
  speicher.schreiben('nest:pauseNach', 10);
  speicher.schreiben('nest:spielzeit', { ms: 11 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 11 * 60000 });
  n = gesagt.length;
  $('#btn-mehr-daumen').click();
  await bis(() => aktiv('pause'), 3000);
  pruefe(aktiv('pause') && (!$('#mehr .spiel-ende') || $('#mehr .spiel-ende').hidden), 'Pause am Ende: kein Pausenbild');
  pruefe(gesagt.slice(n).filter((g) => MEHR_ENDE.includes(g)).length === 1, `Pause am Ende: ${gesagt.slice(n)}`);
  const nPause = gesagt.length;
  await warte(600);
  pruefe(gesagt.length === nPause, `Nach Pausenbild läuft noch etwas: ${gesagt.slice(nPause)}`);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'), 1000);
  kachel.click();
  pruefe(aktiv('pause') && !aktiv('mehr'), 'Während der Pause startet das Spiel');
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'), 1000);
  speicher.schreiben('nest:pauseAm', 0);
  speicher.schreiben('nest:pauseNach', 0);
  pruefe(aktiv('home'), 'Nach der Pause nicht auf der Startseite');

  // 11h. Kind wechseln: Lina (mit „weniger“) ↔ Ben (ohne); Plan folgt dem Kind
  window.prompt = () => 'Ben';
  elternOeffnen();
  const ben = await kindNeu();
  $('#btn-kind-zurueck').click(); await bis(() => aktiv('eltern'));
  $('#btn-eltern-zurueck').click(); await bis(() => aktiv('home'));
  pruefe(zustand.weniger === true && aktivesKind().name === 'Lina', 'Neues Kind ändert die Einstellung des aktiven Kindes');
  const wechseln = async (name) => {
    $('#btn-kind').click(); await bis(() => aktiv('wer'));
    [...document.querySelectorAll('#wer-liste .wer-kachel')].find((b) => b.textContent.includes(name)).click();
    await bis(() => aktiv('home'));
  };
  await wechseln('Ben');
  pruefe(zustand.weniger === false && mehrRundenPlanen().every((r) => r.frage === 'mehr'), 'Ben bekommt „weniger“');
  await spielAuf();
  pruefe(mw.runden.every((r) => r.frage === 'mehr'), 'Ben: Plan im Spiel mit „weniger“');
  $('#btn-mehr-home').click(); await bis(() => aktiv('home'));
  await wechseln('Lina');
  pruefe(zustand.weniger === true && mehrRundenPlanen().slice(4).every((r) => r.frage === 'weniger'), 'Lina verliert „weniger“');

  // 11i. Erstes Kind auf einem Gerät mit „weniger“ (ohne Kinder eingeschaltet): übernimmt es den Schalter (wie das Regal)?
  for (const k of [...kinder]) await datenbank.kindLoeschen(k.id);
  await kinderLaden();
  zustand.kind = null; speicher.schreiben('kind', null);
  elternOeffnen();
  pruefe(!$('#karte-regal').hidden && !$('#weniger').closest('.spiel-option').hidden, 'Schalter ohne Kinder fehlt');
  if (!$('#weniger').checked) $('#weniger').click();
  pruefe(zustand.weniger === true, 'Schalter ohne Kinder wirkt nicht');
  window.prompt = () => 'Mia';
  await kindNeu();
  pruefe(kinder[0].weniger === true && zustand.weniger === true,
    `Sollte: erstes Kind übernimmt das Regal, aber nicht „weniger“ (Kind ${kinder[0].weniger}, aktiv ${zustand.weniger})`);
  $('#btn-kind-zurueck').click(); await bis(() => aktiv('eltern'));
  $('#btn-eltern-zurueck').click(); await bis(() => aktiv('home'));
  if (!kinder[0].weniger) { kindInArbeit = kinder[0]; await kindAendern((k) => { k.weniger = true; }); }

  // 11j. Mit „weniger“: wo liegt der gesuchte Teller? Nie dreimal hintereinander dieselbe Seite (auch beim Wechsel)
  let dreimal = 0;
  for (let k = 0; k < 300; k++) {
    const z = mehrRundenPlanen().map((r) => r.ziel);
    if (z.some((x, i) => i >= 2 && x === z[i - 1] && x === z[i - 2])) dreimal++;
  }
  pruefe(!dreimal, `Sollte: mit „weniger“ liegt der gesuchte Teller in ${dreimal} von 300 Plänen dreimal hintereinander auf derselben Seite`);
  window.befunde = befunde;
  void ben;

  // Ansicht: Runde mit 2 und 5, danach gepaart, eine Seite leuchtet
  kachel.click();
  await frei();
  mw.runden[mw.runde] = { mengen: [5, 2], ding: 'apfel', frage: 'mehr', ziel: 0 };
  mehrNeueRunde();
  await frei();
  mehrStoppen();
  await mehrPaaren(mw.nummer + 0) ;
  mwDinge(teller()[1]).forEach((d) => d.classList.add('leuchtet'));

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = (fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'MEHR-TESTS OK') + ` (${Math.round(performance.now() / 1000)} s)` + (befunde.length ? ' · BEFUNDE: ' + befunde.join(' | ') : '');
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
