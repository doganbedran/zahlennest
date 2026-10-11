// Testet „In den Korb zählen“: Schieben (Pointer-Ereignisse), Zählen beim Ankommen, daneben liegen lassen,
// herausnehmen, automatisch fertig, Hilfe-Stufen, Antippen-Schalter, „bis 5“, zweiter Finger, echte Welt, 🏠, Maße.
// Frisches Browserprofil (ohne Begrüßung). Zeiten verkürzt, Töne mitgeschrieben.
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
  const stand = document.createElement('div');
  stand.style.cssText = 'position:fixed;left:0;top:0;background:#000;color:#fff;font:11px monospace;z-index:99';
  document.body.appendChild(stand);

  const gesagt = [];
  folgeAbspielen = async (folge) => { gesagt.push(...folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', ''))); await warte(5); };
  zaehlenMitLeuchten = async (name, el) => { gesagt.push(name); el.forEach((e) => e.classList.add('leuchtet')); await warte(5); };
  Object.assign(KORB_ZEIT, { versuch: 60000, fertigPause: 10, rundenPause: 50, loesungSchritt: 10, daumen: 120, auftragNochmal: 250, vormachenPause: 10 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const frei = () => bis(() => !kb.gesperrt && !kb.ziehen && !kb.sprech.offen);

  // Schieben wie ein Finger: greifen, in Schritten bewegen, loslassen (Zielpunkt = wo der Finger ist; Ding sitzt 30 px darüber)
  const feldRect = () => $('#korb-feld').getBoundingClientRect();
  const zeiger = (typ, ziel, x, y, id = 1) => ziel.dispatchEvent(new PointerEvent(typ, { pointerId: id, clientX: x, clientY: y,
    bubbles: true, isPrimary: id === 1, pointerType: 'touch' }));
  async function schiebe(d, zx, zy, { id = 1, loslassen = true } = {}) {
    const f = feldRect();
    const sx = f.left + d.x, sy = f.top + d.y;
    zeiger('pointerdown', d.el, sx, sy, id);
    for (let i = 1; i <= 6; i++) zeiger('pointermove', document, sx + ((f.left + zx - sx) * i) / 6, sy + ((f.top + zy + 30 - sy) * i) / 6, id);
    if (loslassen) zeiger('pointerup', document, f.left + zx, f.top + zy + 30, id);
    await warte(30);
  }
  const tippe = async (d) => { const f = feldRect(); zeiger('pointerdown', d.el, f.left + d.x, f.top + d.y); zeiger('pointerup', document, f.left + d.x, f.top + d.y); await warte(30); };
  const korbMitte = () => [kb.mass.kx + kb.mass.kw / 2, kb.mass.ky + kb.mass.kh / 2];
  const draussen = () => kb.dinge.filter((d) => !d.imKorb);
  // freie Stelle außerhalb des Fangbereichs (hochkant zwischen Vorrat und Korb, quer links unten)
  const daneben = (dx = 0) => (kb.mass.quer ? [kb.mass.W / 4 + dx, kb.mass.H - kb.mass.S * 0.6] : [30 + kb.mass.S / 2 + dx, kb.mass.fang.o - kb.mass.S]);

  stand.textContent = 'Abschnitt 1';
  // 1. Neues Gerät: nicht im Regal; im Elternbereich einstellbar, dann auf der Startseite
  const kachel = $('#home .spiel-btn[data-spiel="korb"]');
  pruefe(kachel.hidden, '„In den Korb“ steht schon auf einem neuen Gerät im Regal');
  elternOeffnen();
  [...document.querySelectorAll('#spiele-wahl .regal-spiel')].find((b) => b.textContent.includes('In den Korb')).click();
  pruefe(document.querySelectorAll('#karte-regal .spiel-option[data-spiel="korb"]:not([hidden])').length === 2, 'Schalter für „In den Korb“ fehlen');
  zurStartseite(); await warte(300);
  pruefe(!kachel.hidden, 'Kachel nicht sichtbar');

  stand.textContent = 'Abschnitt 2';
  // 2. Rundenplan: 4 Runden, 1–3 (bzw. 3–5), nie zweimal dieselbe Menge hintereinander
  for (let k = 0; k < 30; k++) {
    const plan = korbRundenPlanen();
    pruefe(plan.length === 4 && plan.every((r) => r.n >= 1 && r.n <= 3) && plan.every((r, i) => !i || r.n !== plan[i - 1].n), `Plan: ${JSON.stringify(plan)}`);
  }
  zustand.korbBis5 = true;
  pruefe(korbRundenPlanen().every((r) => r.n >= 3 && r.n <= 5), 'bis 5: Mengen falsch');
  zustand.korbBis5 = false;

  stand.textContent = 'Abschnitt 3';
  // 3. Start: Auftrag, Vorrat = gesucht + 2, Karte mit leeren Ringen, alles im Bild
  kachel.click();
  pruefe(aktiv('korb'), 'Spiel nicht geöffnet');
  kb.runden = [{ n: 3, ding: 'apfel' }, { n: 2, ding: 'ei' }, { n: 1, ding: 'ball' }, { n: 2, ding: 'apfel' }];
  korbNeueRunde();
  await frei();
  pruefe(zuletzt() === 'korb-leg-3-apfel', `Auftrag: ${zuletzt()}`);
  pruefe(kb.dinge.length === 5 && document.querySelectorAll('#korb-feld .karte-punkt').length === 3
    && !document.querySelector('#korb-feld .karte-punkt.voll'), 'Vorrat/Karte falsch');
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#korb').innerText), `Text auf dem Kinder-Bildschirm: ${$('#korb').innerText}`);
  const f0 = feldRect();
  kb.dinge.forEach((d) => {
    const r = d.el.getBoundingClientRect();
    pruefe(r.width >= 60 && r.left >= f0.left + 16 && r.right <= f0.right - 16 && r.top >= f0.top, `Ding schlecht platziert: ${Math.round(r.left)}–${Math.round(r.right)}, ${Math.round(r.width)} px, Feld ${Math.round(f0.left)}–${Math.round(f0.right)}×${Math.round(f0.height)}, Maße ${JSON.stringify({ S: kb.mass.S, vx: Math.round(kb.mass.vorratX), quer: kb.mass.quer })}`);
  });
  const korbR = $('#korb-feld .korb-korb').getBoundingClientRect();
  pruefe(korbR.left >= 0 && korbR.right <= innerWidth && korbR.bottom <= innerHeight - 30, 'Korb ragt heraus');
  const vorratUnten = Math.max(...kb.dinge.map((d) => d.y + kb.mass.S / 2));
  pruefe(kb.mass.quer || kb.mass.fang.o > vorratUnten, 'Fangbereich berührt den Vorrat');
  pruefe(getComputedStyle($('#korb-feld')).touchAction === 'none', 'touch-action fehlt');

  stand.textContent = 'Abschnitt 4';
  // 4. Ein Ding hineinschieben → „eins“, Ring gefüllt, liegt im Korb
  await schiebe(kb.dinge[0], ...korbMitte());
  await bis(() => zuletzt() === 'korb-zahl-1');
  pruefe(kb.imKorb.length === 1 && zuletzt() === 'korb-zahl-1', `Ankommen: ${gesagt.slice(-2)}`);
  pruefe(document.querySelectorAll('#korb-feld .karte-punkt.voll').length === 1, 'Ring nicht gefüllt');

  stand.textContent = 'Abschnitt 5';
  // 5. Daneben loslassen: bleibt dort liegen, kein Ton
  const n5 = gesagt.length;
  const d5 = draussen()[0];
  const ziel5 = daneben();
  await schiebe(d5, ...ziel5);
  pruefe(!d5.imKorb && gesagt.length === n5, 'Daneben: wurde gezählt');
  pruefe(Math.abs(d5.y - ziel5[1]) < 2 && Math.abs(d5.x - ziel5[0]) < 2, `Daneben: nicht liegen geblieben (${Math.round(d5.x)},${Math.round(d5.y)})`);

  stand.textContent = 'Abschnitt 6';
  // 6. Herausnehmen: kein Rückwärtszählen, Ring wieder leer; wieder hinein → wieder „eins“
  const n6 = gesagt.length;
  await schiebe(kb.imKorb[0], ...daneben(10));
  pruefe(kb.imKorb.length === 0 && gesagt.length === n6 && !document.querySelector('#korb-feld .karte-punkt.voll'), 'Herausnehmen');
  await schiebe(d5, ...korbMitte());
  await bis(() => kb.imKorb.length === 1 && zuletzt() === 'korb-zahl-1');

  stand.textContent = 'Abschnitt 7';
  // 7. Zweiter Finger wird nicht beachtet, während der erste schiebt
  const [a7, b7] = draussen();
  await schiebe(a7, ...korbMitte(), { loslassen: false });
  await schiebe(b7, ...korbMitte(), { id: 2 });
  zeiger('pointerup', document, feldRect().left + korbMitte()[0], feldRect().top + korbMitte()[1] + 30);
  await bis(() => zuletzt() === 'korb-zahl-2');
  pruefe(kb.imKorb.length === 2 && !b7.imKorb, `Zweiter Finger: ${kb.imKorb.length}`);

  stand.textContent = 'Abschnitt 8';
  // 8. Das letzte → fertig: alle leuchten, „Drei Äpfel!“, übrige blass, nächste Runde
  await schiebe(draussen()[0], ...korbMitte());
  await bis(() => gesagt.includes('korb-fertig-3-apfel'));
  pruefe(gesagt.slice(-2).join() === 'korb-zahl-3,korb-fertig-3-apfel', `Fertig: ${gesagt.slice(-3)}`);
  pruefe(document.querySelectorAll('#korb-feld .korb-ding.leuchtet').length === 3, 'Nicht alle leuchten');
  // nach „fertig“ lässt sich nichts mehr schieben
  const n8 = kb.imKorb.length;
  await schiebe(draussen()[0], ...korbMitte());
  pruefe(kb.imKorb.length === n8 || kb.runde === 1, 'Nach fertig noch geschoben');
  await bis(() => kb.runde === 1 && zuletzt() === 'korb-leg-2-ei');
  pruefe(kb.runde === 1 && kb.dinge.length === 4 && $('#korb-runden .voll'), `Nächste Runde: ${zuletzt()}`);

  stand.textContent = 'Abschnitt 9';
  // 9. Antippen: ohne Schalter nichts (nur Hüpfen), mit Schalter fliegt es hinein
  await frei();
  await tippe(draussen()[0]);
  pruefe(kb.imKorb.length === 0, 'Antippen legt ohne Schalter hinein');
  // zweites Antippen: die Hand zeigt einmal, dass man schieben muss (zählt nicht als Versuch)
  await tippe(draussen()[0]);
  await bis(() => !!document.querySelector('#korb-feld .geist-hand'), 1500);
  pruefe(document.querySelector('#korb-feld .geist-hand') && kb.versuche === 0, 'Nach zweimal Antippen zeigt keine Hand den Weg');
  // auf die Punktkarte gelegt: rutscht daneben (die Karte bleibt sichtbar)
  const k9 = kb.mass.karte, d9 = draussen()[0];
  await schiebe(d9, k9.x + k9.s / 2, k9.y + k9.s / 2);
  const S9 = kb.mass.S;
  pruefe(!(d9.x + S9 / 2 > k9.x && d9.x - S9 / 2 < k9.x + k9.s && d9.y + S9 / 2 > k9.y && d9.y - S9 / 2 < k9.y + k9.s) && !d9.imKorb,
    `Ding verdeckt die Punktkarte (${Math.round(d9.x)},${Math.round(d9.y)})`);
  zustand.korbTippen = true;
  await tippe(draussen()[0]);
  await bis(() => zuletzt() === 'korb-zahl-1');
  pruefe(kb.imKorb.length === 1, 'Antippen mit Schalter legt nicht hinein');
  zustand.korbTippen = false;

  stand.textContent = 'Abschnitt 10';
  // 10. 🔊: Auftrag nochmal, nichts ändert sich
  await frei();
  $('#btn-korb-laut').click();
  await frei();
  pruefe(zuletzt() === 'korb-leg-2-ei' && kb.imKorb.length === 1, `🔊: ${zuletzt()}`);

  stand.textContent = 'Abschnitt 11';
  // 11. Hilfe ohne Tun: 1 = Auftrag nochmal, 2 = mitzählen (was drin ist) + Hand, 3 = Lösung (Rest fliegt hinein)
  KORB_ZEIT.versuch = 150;
  korbHilfeAbwarten(kb.nummer);
  await bis(() => kb.versuche === 1 && !kb.gesperrt);
  pruefe(zuletzt() === 'korb-leg-2-ei', `1. Versuch: ${zuletzt()}`);
  await bis(() => kb.versuche === 2, 2000);
  await bis(() => !!document.querySelector('#korb-feld .geist-hand'), 1500);
  pruefe(gesagt.includes('zaehlen-1'), `2. Versuch ohne Mitzählen: ${gesagt.slice(-3)}`);
  await bis(() => kb.runde === 2, 6000);
  pruefe(kb.runde === 2 && gesagt.includes('korb-fertig-2-ei'), `3. Versuch ohne Lösung: ${gesagt.slice(-4)}`);
  KORB_ZEIT.versuch = 60000;

  stand.textContent = 'Abschnitt 12';
  // 12. Restliche Runden → echte Welt: Bilder, 👍 nach kurzer Zeit, dann Zählfolge, Lob, Ende
  while (!kb.auftrag) {
    await frei();
    if (kb.auftrag) break;
    await schiebe(draussen()[0], ...korbMitte());
    await bis(() => kb.gesperrt === false || kb.auftrag, 3000);
  }
  await bis(() => !kb.gesperrt);
  // Vormachen (Bausteine fliegen beim Zählen in den Becher), dann „Jetzt in echt!“ + Auftrag, ruhiger Bildschirm
  const w12 = kb.weltMenge;
  pruefe(gesagt.slice(-4).join() === `korb-welt-${w12},korb-welt-${w12}-fertig,jetzt-in-echt,korb-welt-${w12}` && $('#btn-korb-daumen').hidden,
    `Auftrag: ${gesagt.slice(-4)}`);
  pruefe($('#korb').classList.contains('ruhig') && document.querySelectorAll('#korb .in-echt-karte .karte-punkt').length === w12
    && !document.querySelector('#korb .welt-klotz, #korb .korb-ding'), 'Kein ruhiger In-echt-Bildschirm');
  await bis(() => !$('#btn-korb-daumen').hidden);
  $('#btn-korb-daumen').click(); $('#btn-korb-daumen').click();
  await bis(() => $('#korb .spiel-ende') && !$('#korb .spiel-ende').hidden);
  pruefe(gesagt.slice(-3).join() === `korb-zeig-jeden,korb-welt-${w12}-fertig,ende-korb`, `Ende: ${gesagt.slice(-3)}`);
  pruefe(document.querySelectorAll('#korb .in-echt-karte .karte-punkt.leuchtet').length === w12, 'Punkte auf der Karte leuchten beim Mitzählen nicht');
  pruefe(kb.runde === 4, `Runden: ${kb.runde}`);

  stand.textContent = 'Abschnitt 13';
  // 13. 🔁 neu; 🏠 mitten im Schieben/Zählen: danach still, gegriffenes Ding losgelassen
  $('#korb .ende-nochmal').click();
  await frei();
  pruefe(kb.runde === 0 && !kb.auftrag, '🔁 beginnt nicht neu');
  await schiebe(draussen()[0], ...korbMitte(), { loslassen: false });
  $('#btn-korb-home').click();
  await warte(300);
  const n13 = gesagt.length;
  zeiger('pointerup', document, 10, 10);
  await warte(600);
  pruefe(aktiv('home') && gesagt.length === n13 && !kb.ziehen, `Nach 🏠 läuft das Spiel weiter: ${gesagt.slice(n13)}`);

  stand.textContent = 'Abschnitt 15';
  // 15. Was Kinder tun: Ansagen dauern jetzt wie echt, eine neue unterbricht die alte – deren Ablauf läuft dann
  // weiter (wie in folgeAbspielen: Anhalten meldet die Aufnahme als beendet) und prüft selbst, ob er noch dran ist
  const folgeAlt = folgeAbspielen, zaehlenAlt = zaehlenMitLeuchten;
  let sprechDauer = 150;
  const echtSprechen = async (namen) => {
    const nr = ++wiedergabe.nummer;
    gesagt.push(...namen);
    await warte(sprechDauer);
  };
  folgeAbspielen = (folge) => echtSprechen(folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', '')));
  zaehlenMitLeuchten = (name, el) => { el.forEach((e) => e.classList.add('leuchtet')); return echtSprechen([name]); };
  // Schieben ohne Pause dazwischen (ganz schneller Finger); ziel = Element, auf dem losgelassen wird
  const sofort = (d, zx, zy, { ende = 'pointerup', ziel = document } = {}) => {
    const f = feldRect();
    zeiger('pointerdown', d.el, f.left + d.x, f.top + d.y);
    zeiger('pointermove', document, f.left + (d.x + zx) / 2, f.top + (d.y + zy) / 2 + 30);
    zeiger('pointermove', document, f.left + zx, f.top + zy + 30);
    if (ende) zeiger(ende, ziel, f.left + zx, f.top + zy + 30);
  };
  // Bild und Zustand passen zusammen: Liste = Dinge mit imKorb, Ringe = Anzahl, jedes auf seinem Platz, alles im Feld,
  // und nichts liegt sichtbar im Korb, ohne gezählt zu sein
  const stimmig = (wo) => {
    const { S, W, H, kx, ky, kw, kh } = kb.mass;
    pruefe(kb.dinge.filter((d) => d.imKorb).length === kb.imKorb.length && kb.imKorb.every((d) => d.imKorb), `${wo}: Korb-Liste ≠ Dinge`);
    const voll = document.querySelectorAll('#korb-feld .karte-punkt.voll').length;
    pruefe(voll === kb.imKorb.length, `${wo}: ${voll} Ringe voll, ${kb.imKorb.length} im Korb`);
    kb.imKorb.forEach((d, i) => { const [x, y] = korbPlatz(i); pruefe(Math.hypot(d.x - x, d.y - y) < 2, `${wo}: Ding ${i + 1} nicht auf seinem Platz im Korb`); });
    kb.dinge.forEach((d) => pruefe(d.x >= S / 2 - 1 && d.x <= W - S / 2 + 1 && d.y >= S / 2 - 1 && d.y <= H - S / 2 + 1, `${wo}: Ding außerhalb des Felds`));
    kb.dinge.filter((d) => !d.imKorb && !(kb.ziehen && kb.ziehen.d === d)).forEach((d) => pruefe(
      !(d.x > kx && d.x < kx + kw && d.y > ky && d.y < ky + kh), `${wo}: Ding liegt im Korb, ist aber nicht gezählt (${Math.round(d.x)},${Math.round(d.y)})`));
  };
  const runde = async (n, ding = 'apfel') => {
    kb.runden[kb.runde] = { n, ding };
    korbNeueRunde();
    await frei();
    kb.versuche = 0;
  };
  kachel.click();
  await frei();

  stand.textContent = 'Abschnitt 15a';
  // 15a. Sehr schnell hin und her (ohne Pause), zwei Dinge abwechselnd
  await runde(3);
  const [a15, b15] = draussen();
  for (let i = 0; i < 6; i++) {
    sofort(a15, ...korbMitte());
    sofort(i % 2 ? a15 : b15, ...korbMitte());
    sofort(a15, ...daneben(i));
  }
  await warte(sprechDauer * 3);
  stimmig('Schnell hin und her');
  pruefe(kb.imKorb.length === 1 && b15.imKorb && !a15.imKorb, `Schnell hin und her: ${kb.imKorb.length} im Korb`);
  pruefe(!document.querySelector('#korb-feld .korb-ding.greift') && !kb.ziehen, 'Schnell: Ding bleibt „gegriffen“');

  stand.textContent = 'Abschnitt 15b';
  // 15b. Über 🏠 und 🔊 losgelassen: Spiel bleibt offen, Ding bleibt sichtbar im Feld, nichts gezählt
  for (const knopf of ['#btn-korb-home', '#btn-korb-laut']) {
    await frei();
    const n15 = gesagt.length;
    const d = draussen()[0];
    const r = $(knopf).getBoundingClientRect(), f = feldRect();
    sofort(d, r.left + r.width / 2 - f.left, r.top + r.height / 2 - f.top - 30, { ziel: $(knopf) });
    await warte(100);
    pruefe(aktiv('korb') && gesagt.length === n15 && !d.imKorb, `Über ${$(knopf).textContent} losgelassen: ${gesagt.slice(n15)}`);
    pruefe(d.el.getBoundingClientRect().top >= f.top - 1, `Über ${$(knopf).textContent}: Ding unter der Leiste`);
    stimmig(`Über ${$(knopf).textContent}`);
  }

  stand.textContent = 'Abschnitt 15c';
  // 15c. pointercancel (z. B. Anruf, Wisch vom Rand) mitten im Schieben – einmal über dem Korb, einmal aus dem Korb heraus
  await frei();
  const c15 = draussen()[0];
  sofort(c15, ...korbMitte(), { ende: 'pointercancel' });
  await warte(100);
  pruefe(!kb.ziehen && !c15.el.classList.contains('greift'), 'pointercancel: Ding bleibt gegriffen');
  stimmig('pointercancel über dem Korb');
  await frei();
  sofort(b15, ...daneben(20), { ende: 'pointercancel' });
  await warte(100);
  stimmig('pointercancel aus dem Korb');
  await frei();
  const n15c = kb.imKorb.length;
  sofort(draussen().find((d) => d !== c15) || c15, ...korbMitte());
  await bis(() => kb.imKorb.length === n15c + 1);
  pruefe(kb.imKorb.length === n15c + 1, 'Nach pointercancel geht Schieben nicht mehr');

  stand.textContent = 'Abschnitt 15d';
  // 15d. Herausnehmen, während die Zahl gesagt wird; danach kommt die Hilfe-Uhr trotzdem
  sprechDauer = 300;
  await runde(3);
  KORB_ZEIT.versuch = 200;
  const [d1, d2] = draussen();
  sofort(d1, ...korbMitte());
  await warte(50);
  sofort(d2, ...korbMitte());
  await warte(50);
  sofort(d2, ...daneben());
  await warte(20);
  stimmig('Herausnehmen während „zwei“');
  pruefe(kb.imKorb.length === 1, `Herausnehmen während „zwei“: ${kb.imKorb.length}`);
  await bis(() => kb.versuche >= 1, 2500);
  pruefe(kb.versuche >= 1, `Nach Herausnehmen während der Zahl kommt keine Hilfe mehr: drin ${kb.imKorb.length} g${+kb.gesperrt} o${kb.sprech.offen} h${+kb.hilfeLaeuft} z${+!!kb.ziehen} seit ${Date.now() - kb.letztesAnkommen} ms, zeit ${KORB_ZEIT.versuch}, aktuell ${kbAktuell(kb.nummer)}, ${gesagt.slice(-4)}`);
  KORB_ZEIT.versuch = 60000;

  stand.textContent = 'Abschnitt 15e';
  // 15e. Hilfe-Uhr gegen Ankommen: Kind greift schon während „eins“ das nächste, schiebt lange und legt es hinein –
  // die Hilfe darf das frische „zwei“ nicht unterbrechen (eine Weile ohne Ankommen beginnt mit dem Ankommen neu)
  sprechDauer = 1200;
  await runde(3);
  KORB_ZEIT.versuch = 100;
  const [e1, e2] = draussen();
  sofort(e1, ...korbMitte());
  await warte(100);
  sofort(e2, ...korbMitte(), { ende: null });   // greift das zweite, solange „eins“ noch klingt
  await warte(1100 + 100 + 700);                // „eins“ zu Ende, Hilfe-Uhr läuft ab und wartet aufs Loslassen
  const n15e = gesagt.length;
  zeiger('pointerup', document, feldRect().left + korbMitte()[0], feldRect().top + korbMitte()[1] + 30);
  await warte(1300);
  pruefe(gesagt[n15e] === 'korb-zahl-2' && !gesagt.slice(n15e + 1).some((g) => g.startsWith('korb-leg')),
    `Hilfe unterbricht das frische „zwei“: ${gesagt.slice(n15e)}`);
  // 🔊 während „zwei“ – die Hilfe-Uhr muss danach wieder laufen
  korbStoppen(); sprechDauer = 300; KORB_ZEIT.versuch = 200;
  await runde(3);
  sofort(draussen()[0], ...korbMitte());
  await warte(50);
  $('#btn-korb-laut').click();
  await bis(() => kb.versuche >= 1, 2500);
  pruefe(kb.versuche >= 1, '🔊 während der Zahl: Hilfe-Uhr steht danach still');
  // Fertig und Hilfe-Uhr gleichzeitig: genau beim Ablaufen der Uhr das letzte hinein
  sprechDauer = 150;
  await runde(1);
  KORB_ZEIT.versuch = 150;
  korbHilfeAbwarten(kb.nummer);
  await warte(145);
  const n15f = gesagt.length;
  sofort(draussen()[0], ...korbMitte());
  await bis(() => kb.runde > 0 && !kb.gesperrt, 3000);
  // (die Ansage der nächsten Runde darf kommen – nur keine Hilfe zur fertigen Runde)
  pruefe(gesagt.slice(n15f, gesagt.indexOf('korb-fertig-1-apfel', n15f)).every((g) => !g.startsWith('korb-leg')) && kb.versuche === 0,
    `Fertig + Hilfe gleichzeitig: ${gesagt.slice(n15f)}, Versuche ${kb.versuche}`);
  KORB_ZEIT.versuch = 60000;

  stand.textContent = 'Abschnitt 15f';
  // 15f. Herausnehmen nach „fertig“: geht nicht, nichts ändert sich bis zur nächsten Runde
  sprechDauer = 300;
  kb.runde = 0;
  await runde(2);
  sofort(draussen()[0], ...korbMitte());
  await warte(50);
  sofort(draussen()[0], ...korbMitte());
  await warte(50);
  const f15 = kb.imKorb[0];
  sofort(f15, ...daneben());
  await warte(50);
  pruefe(f15.imKorb && kb.imKorb.length === 2, 'Nach „fertig“ herausgenommen');
  stimmig('Nach „fertig“');
  await bis(() => kb.runde === 1 && !kb.gesperrt, 4000);

  stand.textContent = 'Abschnitt 15g';
  // 15g. Gerät drehen mitten in der Runde (auch mitten im Schieben): alles ordnet sich neu, Gezähltes bleibt im Korb
  sprechDauer = 20;
  await runde(3);
  sofort(draussen()[0], ...korbMitte()); await frei();
  sofort(draussen()[0], ...korbMitte()); await frei();
  sofort(draussen()[0], ...daneben());
  await frei();
  const g15 = draussen()[1];
  sofort(g15, ...korbMitte(), { ende: null });
  const feld = $('#korb-feld'), fw = feld.clientWidth, fh = feld.clientHeight, querVorher = kb.mass.quer;
  feld.style.cssText = `flex:none;width:${fh}px;height:${fw}px`;
  dispatchEvent(new Event('resize'));
  await warte(50);
  pruefe(kb.mass.quer !== querVorher, 'Drehen: Anordnung nicht gewechselt');
  stimmig('Nach dem Drehen');
  zeiger('pointermove', document, feldRect().left + korbMitte()[0], feldRect().top + korbMitte()[1] + 30);
  zeiger('pointerup', document, feldRect().left + korbMitte()[0], feldRect().top + korbMitte()[1] + 30);
  await bis(() => gesagt.includes('korb-fertig-3-apfel') && kb.runde === 1, 3000);
  pruefe(g15.imKorb && kb.imKorb.length === 3, `Drehen mitten im Schieben: ${kb.imKorb.length} im Korb`);
  feld.style.cssText = '';
  dispatchEvent(new Event('resize'));
  await frei();
  stimmig('Zurückgedreht');

  stand.textContent = 'Abschnitt 15h';
  // 15h. Pause am Spielende: statt 🏠/🔁 kommt das Pausen-Bild, danach ist es still und das Spiel startet nicht neu
  speicher.schreiben('nest:pauseNach', 10);
  speicher.schreiben('nest:spielzeit', { ms: 11 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 11 * 60000 });
  korbStoppen();
  kb.runde = KORB_RUNDEN;
  korbAuftrag();
  await bis(() => !$('#btn-korb-daumen').hidden);
  $('#btn-korb-daumen').click();
  await bis(() => aktiv('pause'));
  pruefe(aktiv('pause') && zuletzt() === 'pause' && gesagt.includes('ende-korb'), `Pause am Ende: ${gesagt.slice(-3)}`);
  const n15h = gesagt.length;
  await warte(400);
  pruefe(gesagt.length === n15h, `Nach der Pause spricht das Spiel weiter: ${gesagt.slice(n15h)}`);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  kachel.click();
  pruefe(aktiv('pause'), 'Während der Pause startet das Spiel');
  speicher.schreiben('nest:pauseAm', 0);
  speicher.schreiben('nest:pauseNach', 0);
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  folgeAbspielen = folgeAlt; zaehlenMitLeuchten = zaehlenAlt;

  stand.textContent = 'Abschnitt 14';
  // 14. „bis 5“ und „Antippen“ je Kind, erstes Kind übernimmt die app-weiten Schalter
  speicher.schreiben('korbBis5', true);
  window.prompt = () => 'Lina';
  elternOeffnen();
  await kindNeu();
  pruefe(kinder[0].korbBis5 === true && zustand.korbBis5 === true, 'Erstes Kind übernimmt „bis 5“ nicht');
  pruefe(document.querySelectorAll('#kind .spiel-option[data-spiel="korb"]:not([hidden])').length >= 2, 'Schalter beim Kind fehlen');
  $('#kind-korbTippen').click();
  await bis(() => zustand.korbTippen === true);
  pruefe(zustand.korbTippen === true, '„Antippen“ beim Kind nicht gespeichert');
  $('#btn-kind-zurueck').click(); await bis(() => aktiv('eltern'));
  $('#btn-eltern-zurueck').click(); await bis(() => aktiv('home'));

  // Ansicht: Runde mit 5 (bis 5), drei drin, eines daneben liegen geblieben, die Hand zeigt den Weg
  kachel.click();
  await frei();
  kb.runden[0] = { n: 5, ding: 'ei' };
  korbNeueRunde();
  await frei();
  for (let i = 0; i < 3; i++) { await schiebe(draussen()[0], ...korbMitte()); await bis(() => !kb.gesperrt); }
  await schiebe(draussen()[1], ...daneben(kb.mass.S * 1.2));
  korbStoppen();

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = (fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'KORB-TESTS OK') + ` (${Math.round(performance.now() / 1000)} s)`;
  stand.remove();
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
