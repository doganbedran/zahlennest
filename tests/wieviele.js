// Testet „Wie viele?“: drei Stufen, Hilfe nach 2 Versuchen, Lösung nach 3, Auftrag mit Fingern, Ende, 🏠, Aussehen.
// Frisches Browserprofil (ohne Begrüßung). Wartezeiten werden verkürzt, Töne nur mitgeschrieben.
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
  const karten = () => [...document.querySelectorAll('#wieviele-karten .mengen-karte')];
  const karte = (n) => karten().find((k) => Number(k.dataset.menge) === n);
  await startFertig;
  // Andere Anordnungen ab Stufe 2 nur bei 2 und 3 – ein einzelner Punkt steht immer in der Mitte
  for (let k = 0; k < 20; k++) {
    const p = new DOMParser().parseFromString(gemischtSvg(1), 'image/svg+xml').querySelector('circle');
    pruefe(p.getAttribute('cx') === '50' && p.getAttribute('cy') === '50', 'Einzelner Punkt nicht in der Mitte');
  }

  // Echte Zählfolge mit Leuchten einmal prüfen (Datei vorhanden → alle leuchten am Ende)
  const echtesZaehlen = zaehlenMitLeuchten;
  const probe = document.createElement('div');
  probe.innerHTML = wuerfelSvg(3);
  document.body.appendChild(probe);
  await Promise.race([echtesZaehlen('zaehlen-3', [...probe.querySelectorAll('.menge-punkt')]), warte(6000)]);
  pruefe(probe.querySelectorAll('.menge-punkt.leuchtet').length === 3, 'Zählfolge lässt nicht alle Punkte leuchten');
  probe.remove();
  pruefe((await fetch('audio/ansage-zaehlen-3.wav')).ok && (await fetch('audio/ansage-finger-zeig-2.wav')).ok, 'Ansagen fehlen');

  // Ab hier: Töne nur mitschreiben, Zeiten kurz
  const gesagt = [];
  folgeAbspielen = async (folge) => { gesagt.push(...folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', ''))); await warte(5); };
  zaehlenMitLeuchten = async (name, el) => { gesagt.push(name); el.forEach((e) => e.classList.add('leuchtet')); await warte(5); };
  Object.assign(WIEVIELE_ZEIT, { nochmalFragen: 150, weiterOhneTipp: 150, antwort: 150, unsicherWeiter: 100, daumen: 120,
    auftragNochmal: 250, vormachenPause: 10, pause: 10 });
  const tippeInEcht = () => $('#wieviele .in-echt').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const zuletzt = () => gesagt[gesagt.length - 1];

  // 1. Kachel ✋ steht auf einem neuen Gerät im Regal und startet das Spiel
  const kachel = $('#home .spiel-btn[data-spiel="wieviele"]');
  pruefe(kachel && !kachel.hidden && $('#home-leer').hidden, '✋ nicht auf der Startseite');
  kachel.click();
  pruefe(aktiv('wieviele'), 'Spiel nicht geöffnet');

  // Keine Texte für Kinder (nur Bilder/Emoji)
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#wieviele').innerText), `Text auf dem Kinder-Bildschirm: ${$('#wieviele').innerText}`);

  // 2. Stufe 1: 1, 2, 3 der Reihe nach benannt; Tipp = Mitzählen mit Leuchten; ohne Tipp geht es weiter
  await bis(() => !wv.gesperrt);
  pruefe(zuletzt() === 'wieviele-1' && karten().length === 1 && karte(1).querySelectorAll('.menge-punkt').length === 1, `Stufe 1 Start: ${zuletzt()}`);
  karte(1).click();
  await bis(() => wv.schritt === 1 && !wv.gesperrt);
  pruefe(gesagt.includes('zaehlen-1') && zuletzt() === 'wieviele-2', `Stufe 1 nach Tipp: ${gesagt.slice(-3)}`);
  pruefe(karte(2).querySelectorAll('.menge-punkt').length === 2, 'Zwei Punkte fehlen');
  // Punkte gleich groß
  const radien = new Set(wuerfelSvg(3).match(/r="[\d.]+"/g));
  pruefe(radien.size === 1, 'Punkte verschieden groß');
  await bis(() => wv.stufe === 1, 3000);   // ohne Tipp: 2 → 3 → Stufe 2
  pruefe(wv.stufe === 1 && wv.punkte === 3, `Nicht in Stufe 2: ${wv.stufe}/${wv.punkte}`);
  pruefe(wv.auftraege.length === 6 && wv.auftraege.every((n, i) => n !== wv.auftraege[i - 1]) && wv.auftraege[0] !== 2,
    `Aufträge: ${wv.auftraege}`);

  // 3. Stufe 2: drei Karten im Bild, groß genug, nicht am Rand; Daneben → benennen; 2. Daneben → mitzählen; 3. → Lösung
  await bis(() => !wv.gesperrt && karten().length === 3);
  pruefe($('#wieviele-symbol').textContent === '👂', 'Symbol Stufe 2');
  karten().forEach((k) => {
    const r = k.getBoundingClientRect();
    pruefe(r.width >= 120 && r.left >= 30 && r.right <= innerWidth - 30 && r.bottom <= innerHeight - 30, `Karte ${k.dataset.menge}: ${Math.round(r.left)}–${Math.round(r.right)}, unten ${Math.round(r.bottom)}, breit ${Math.round(r.width)}`);
  });
  const ziel1 = wv.ziel;
  pruefe(zuletzt() === `wieviele-wo-${ziel1}`, `Frage: ${zuletzt()}`);
  const falsch = [1, 2, 3].find((n) => n !== ziel1);
  karte(falsch).click();
  await bis(() => !wv.gesperrt);
  pruefe(gesagt.slice(-2).join() === `wieviele-${falsch},wieviele-wo-${ziel1}`, `1. Daneben: ${gesagt.slice(-3)}`);
  pruefe(!document.querySelector('#wieviele .falsch') && wv.punkte === 3, 'Daneben zählt als Fehler/Schritt');
  karte(falsch).click();
  await bis(() => !wv.gesperrt);
  pruefe(gesagt.includes(`zaehlen-${ziel1}`) && zuletzt() === `wieviele-wo-${ziel1}`, `2. Daneben (Hilfe): ${gesagt.slice(-3)}`);
  pruefe(!karten().some((k) => k.classList.contains('blass')), 'Karten bleiben blass');
  karte(falsch).click();
  await bis(() => wv.schritt === 1);
  pruefe(wv.schritt === 1 && wv.unsicher.has(ziel1), '3. Daneben: nicht weiter');
  // Richtige Antworten für den Rest der Stufe; ohne Tipp wird nur wiederholt, nie weitergeschaltet
  await bis(() => !wv.gesperrt && karten().length === 3);
  const schrittVorher = wv.schritt;
  await warte(500);
  pruefe(wv.schritt === schrittVorher && gesagt.filter((g) => g === `wieviele-wo-${wv.ziel}`).length >= 2, 'Ohne Tipp: nicht wiederholt oder weitergeschaltet');
  pruefe(wvZielKarte().classList.contains('pulsiert'), 'Gesuchte Karte pulsiert nicht');
  while (wv.stufe === 1) {
    await bis(() => !wv.gesperrt && karten().length === 3);
    if (wv.stufe !== 1) break;
    const z = wv.ziel;
    karte(z).click();
    pruefe(karte(z).classList.contains('richtig'), 'Treffer ohne Ring');
    await bis(() => wv.gesperrt === false || wv.stufe !== 1, 2000);
  }
  pruefe(wv.stufe === 2 && wv.punkte === 9, `Nicht in Stufe 3: ${wv.stufe}/${wv.punkte}`);

  // 4. Stufe 3: „Sag es!“ (bzw. bei unsicherer Menge erst benennen); danach nennt die App die Menge
  await bis(() => karten().length === 1 && !wv.gesperrt);
  const n3 = Number(karten()[0].dataset.menge);
  pruefe(zuletzt() === (wv.unsicher.has(n3) ? `wieviele-${n3}` : 'wieviele-sag-es'), `Stufe 3 Frage: ${zuletzt()}`);
  pruefe(!karten()[0].classList.contains('pulsiert'), 'Stufe 3: Karte pulsiert (verleitet zum Tippen statt Sagen)');
  const vorStufe3 = gesagt.length;
  await bis(() => wv.schritt === 1);
  pruefe(gesagt.slice(vorStufe3).filter((g) => g === `wieviele-${n3}`).length <= 1, `Stufe 3 doppelt benannt: ${gesagt.slice(vorStufe3)}`);
  pruefe(gesagt.slice(-2).includes(`wieviele-${n3}`) && !gesagt.slice(-2).some((g) => g.startsWith('zaehlen')), `Stufe 3 Antwort: ${gesagt.slice(-2)}`);
  await bis(() => wv.stufe === 3, 3000);

  // 5. Echte Welt: erst vormachen (großes Fingerbild, „Zeig mir … Finger!“, die gezeichneten Finger werden gezählt),
  //    dann „Jetzt in echt!“: ruhiger Bildschirm, kleine Karte, 👐, nichts Greifbares; 👍 klein und erst nach kurzer
  //    Zeit; Tippen aufs Bild lenkt einmal sanft um; nach 👍 „Zeig mal!“ und die App zählt mit
  await bis(() => wv.inEcht && !wv.gesperrt);
  const m = wv.auftragMenge;
  const vorm = gesagt.lastIndexOf(`finger-${m}`) - 1;
  pruefe([1, 2, 3].includes(m) && vorm >= 0 && gesagt.slice(vorm).join() === `finger-zeig-${m},finger-${m},jetzt-in-echt,finger-zeig-${m}`,
    `Vormachen / in echt: ${gesagt.slice(-4)}`);
  pruefe($('#wieviele').classList.contains('ruhig') && !karten().length && $('#wieviele .in-echt-haende'), 'Kein ruhiger In-echt-Bildschirm');
  pruefe($('#btn-wieviele-daumen').hidden, '👍 sofort da (Kind tippt ihn weg, bevor es Finger zeigt)');
  const kleineKarte = $('#wieviele .in-echt-karte');
  pruefe(kleineKarte.querySelectorAll('.finger.zaehlt').length === m, 'Falsche Fingerzahl auf der Karte');
  // Daumen (zuerst gezählt) steht links sichtbar neben der Handfläche heraus
  const daumenR = kleineKarte.querySelector('.finger.zaehlt').getBoundingClientRect();
  const flaecheR = kleineKarte.querySelector('svg > g > .hand:last-child').getBoundingClientRect();
  const karteR = kleineKarte.getBoundingClientRect();
  pruefe(daumenR.left < flaecheR.left - 4 && daumenR.left > karteR.left && daumenR.width > 2, 'Daumen nicht sichtbar');
  [1, 2, 3].forEach((k) => pruefe(new DOMParser().parseFromString(fingerSvg(k), 'image/svg+xml').querySelectorAll('.zaehlt').length === k, `Fingerbild ${k}`));
  // Das Kind tippt aufs Bild: einmal sanft umlenken (kein Ende, kein zweites Mal)
  tippeInEcht();
  await bis(() => zuletzt() === 'echt-umlenken');
  pruefe(zuletzt() === 'echt-umlenken' && !wv.fertig, `Tippen aufs Bild lenkt nicht um: ${zuletzt()}`);
  await bis(() => !wv.gesperrt);
  tippeInEcht();
  await warte(60);
  pruefe(gesagt.filter((g) => g === 'echt-umlenken').length === 1, 'Umlenken mehr als einmal');
  await bis(() => !$('#btn-wieviele-daumen').hidden);
  const db = $('#btn-wieviele-daumen').getBoundingClientRect();
  pruefe(db.width >= 56 && db.bottom <= innerHeight - 16 && db.right <= innerWidth - 12, `👍 schlecht erreichbar: breit ${Math.round(db.width)}, unten ${Math.round(db.bottom)} von ${innerHeight}`);
  $('#btn-wieviele-daumen').click();
  await bis(() => $('#wieviele .spiel-ende') && !$('#wieviele .spiel-ende').hidden);
  const nach = gesagt.slice(gesagt.lastIndexOf('zeig-mal'));
  pruefe(nach[1] === `finger-${m}` && WIEVIELE_ENDE.includes(zuletzt()), `Ende: ${gesagt.slice(-3)}`);
  pruefe(kleineKarte.querySelectorAll('.finger.leuchtet').length === m, 'Finger auf der Karte leuchten beim Mitzählen nicht');
  pruefe($('#wieviele .spiel-ende') && !$('#wieviele .spiel-ende').hidden, 'Kein Spielende 🏠/🔁');
  pruefe(wv.punkte === 12, `Rundenpunkte: ${wv.punkte}`);

  // 6. 🔁 beginnt von vorn (nicht mehr ruhig); ohne 👍: Auftrag einmal nochmal, dann wartet die App (keine Zeitgrenze)
  $('#wieviele .ende-nochmal').click();
  pruefe(wv.stufe === 0 && wv.punkte === 0 && $('#wieviele .spiel-ende').hidden && !$('#wieviele').classList.contains('ruhig'), '🔁 beginnt nicht neu');
  await bis(() => !wv.gesperrt);
  wv.stufe = 3; wv.schritt = 0;
  const vorAuftrag = gesagt.length;
  wvSchritt();
  await warte(1500);
  pruefe(wv.inEcht && !wv.fertig && $('#wieviele .spiel-ende').hidden, 'Auftrag endet ohne 👍 von selbst');
  pruefe(gesagt.slice(vorAuftrag).filter((g) => g.startsWith('finger-zeig-')).length === 3, `Auftrag nicht einmal wiederholt: ${gesagt.slice(vorAuftrag)}`);
  $('#btn-wieviele-daumen').click();
  await bis(() => !$('#wieviele .spiel-ende').hidden, 3000);
  const ende1 = zuletzt();
  $('#wieviele .ende-nochmal').click();
  wv.stufe = 3; wv.schritt = 0; wv.auftragMenge = 0;
  wvSchritt();
  await bis(() => !$('#btn-wieviele-daumen').hidden, 3000);
  $('#btn-wieviele-daumen').click();
  await bis(() => !$('#wieviele .spiel-ende').hidden, 3000);
  pruefe(zuletzt() !== ende1 && WIEVIELE_ENDE.includes(zuletzt()), `Lob am Ende zweimal gleich: ${ende1}`);

  // 7. 🏠 mitten im Spiel: zurück, keine Ansage mehr danach
  $('#wieviele .ende-nochmal').click();
  await bis(() => !wv.gesperrt);
  $('#btn-wieviele-home').click();
  await warte(400);
  const anzahl = gesagt.length;
  await warte(500);
  pruefe(aktiv('home') && gesagt.length === anzahl, 'Nach 🏠 läuft das Spiel weiter');

  // 8. Was Kinder (und Eltern) wirklich tun
  const schnell = zaehlenMitLeuchten;
  const langsamZaehlen = async (name, el) => { gesagt.push(name); el.forEach((e) => e.classList.add('leuchtet')); await warte(600); };
  const stufe2 = async (folge = [1, 2, 3, 1, 2, 3]) => {
    wv.stufe = 1; wv.schritt = 0; wv.auftraege = folge; wv.punkte = 3; wv.unsicher = new Set();
    $('#wieviele-symbol').textContent = '👂';
    wvSchritt();
    await bis(() => !wv.gesperrt && karten().length === 3);
  };
  const reihenfolge = () => karten().map((k) => k.dataset.menge).join();
  const tippen = async (n) => { await bis(() => !wv.gesperrt); await warte(420); karte(n).click(); };

  // 8a. 🔊 während des Stufenwechsels (Glockenspiel, 0,7 s): Symbol muss zur neuen Stufe passen
  kachel.click();
  await bis(() => !wv.gesperrt);
  wv.schritt = 2;
  wvWeiter(wv.nummer);
  await warte(150);
  $('#btn-wieviele-laut').click();
  await warte(1200);
  pruefe(wv.stufe === 1 && $('#wieviele-symbol').textContent === '👂',
    `🔊 im Stufenwechsel: Stufe ${wv.stufe + 1}, Symbol ${$('#wieviele-symbol').textContent}`);

  // 8b. Mehrfachtippen auf die richtige Karte: nur ein Schritt weiter
  await stufe2();
  const p0 = wv.punkte;
  for (let i = 0; i < 5; i++) karte(wv.ziel).click();
  await bis(() => wv.schritt === 1 && !wv.gesperrt);
  await warte(300);
  pruefe(wv.punkte === p0 + 1 && wv.schritt === 1, `Mehrfachtippen: Punkte ${p0}→${wv.punkte}, Schritt ${wv.schritt}`);

  // 8c. 🔊 nach zweimal Daneben: Hilfe-Zähler bleibt (sonst nie Lösung), Karten bleiben an ihrem Platz
  await stufe2();
  const z = wv.ziel;
  const daneben = [1, 2, 3].find((n) => n !== z);
  await tippen(daneben);
  await tippen(daneben);
  await bis(() => !wv.gesperrt);
  const vorher = reihenfolge();
  let verschoben = false;
  for (let i = 0; i < 3; i++) {
    $('#btn-wieviele-laut').click();
    await bis(() => !wv.gesperrt && karten().length === 3);
    if (reihenfolge() !== vorher) verschoben = true;
  }
  pruefe(!verschoben, '🔊 in Stufe 2 mischt die Karten neu');
  pruefe(wv.versuche === 2, `🔊 setzt Versuche zurück: ${wv.versuche}`);
  await tippen(daneben);
  await bis(() => wv.schritt === 1, 2500);
  pruefe(wv.schritt === 1, '3. Daneben nach 🔊 zeigt keine Lösung');

  // 8d. 🔊 mitten im Mitzählen (Hilfe): kein Leuchten/Blass bleibt hängen, nichts läuft doppelt
  zaehlenMitLeuchten = langsamZaehlen;
  await stufe2();
  await tippen([1, 2, 3].find((n) => n !== wv.ziel));
  const d2 = [1, 2, 3].find((n) => n !== wv.ziel);
  await tippen(d2);
  await warte(150);
  pruefe(gesagt[gesagt.length - 1].startsWith('zaehlen-'), `Hilfe läuft nicht: ${gesagt.slice(-2)}`);
  $('#btn-wieviele-laut').click();
  await bis(() => !wv.gesperrt && karten().length === 3);
  await warte(900);
  pruefe(!document.querySelector('#wieviele .blass, #wieviele .leuchtet'), '🔊 im Mitzählen: Reste von Blass/Leuchten');
  pruefe(gesagt.slice(-1)[0] === `wieviele-wo-${wv.ziel}` && wv.schritt === 0, `🔊 im Mitzählen: ${gesagt.slice(-3)} Schritt ${wv.schritt}`);

  // 8e. 🏠 und Zurück-Taste mitten in der Zählfolge: sofort still, nichts läuft im Hintergrund weiter
  for (const weg of ['home', 'zurueck']) {
    kachel.click();
    await stufe2();
    const d3 = [1, 2, 3].find((n) => n !== wv.ziel);
    await tippen(d3);
    await tippen(d3);
    await warte(150);
    if (weg === 'home') $('#btn-wieviele-home').click(); else history.back();
    await warte(200);
    const n0 = gesagt.length;
    await warte(1500);
    pruefe(aktiv('home') && gesagt.length === n0, `${weg} in der Zählfolge: Startseite ${aktiv('home')}, danach ${gesagt.slice(n0)}`);
  }
  zaehlenMitLeuchten = schnell;

  // 8f. Doppeltipp auf 👍 und gleichzeitig aufs Fingerbild: Finger nur einmal gezählt
  kachel.click();
  await bis(() => !wv.gesperrt);
  wv.stufe = 3; wv.schritt = 0;
  wvSchritt();
  await bis(() => !$('#btn-wieviele-daumen').hidden && !wv.gesperrt);
  const n1 = gesagt.length;
  $('#btn-wieviele-daumen').click(); $('#btn-wieviele-daumen').click(); tippeInEcht();
  await bis(() => !$('#wieviele .spiel-ende').hidden, 3000);
  pruefe(gesagt.slice(n1).filter((g) => g.startsWith('finger-')).length === 1, `Doppeltipp 👍: ${gesagt.slice(n1)}`);
  history.back();
  await bis(() => aktiv('home'));

  // 8g. Pause fällig: am Spielende kommt das Pausenbild (kein 🔁), Zurück → Startseite, Spiel bleibt gesperrt
  const sz = localStorage.getItem('nest:spielzeit');
  localStorage.setItem('nest:pauseNach', '10');
  localStorage.setItem('nest:spielzeit', JSON.stringify({ ms: 11 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 0 }));
  kachel.click();
  await bis(() => !wv.gesperrt);
  wv.stufe = 3; wv.schritt = 0;
  wvSchritt();
  await bis(() => !$('#btn-wieviele-daumen').hidden && !wv.gesperrt);
  $('#btn-wieviele-daumen').click();
  await bis(() => aktiv('pause'), 3000);
  pruefe(aktiv('pause') && !aktiv('wieviele'), 'Pause fällig: kein Pausenbild am Spielende');
  pruefe(zuletzt() === 'pause', `Pause: Ansage ${zuletzt()}`);
  history.back();
  await bis(() => aktiv('home'));
  pruefe(aktiv('home'), 'Zurück aus der Pause: nicht auf der Startseite');
  kachel.click();
  pruefe(aktiv('pause'), 'Während der Pause startet das Spiel');
  $('#btn-pause-home').click();
  await bis(() => aktiv('home'));
  localStorage.setItem('nest:pauseAm', '0');
  localStorage.setItem('nest:pauseNach', '0');
  if (sz) localStorage.setItem('nest:spielzeit', sz); else localStorage.removeItem('nest:spielzeit');
  await warte(300);

  // Ansicht: Stufe 2 mit drei Karten, eine leuchtet (Hilfe)
  kachel.click();
  wv.stufe = 1; wv.schritt = 0; wv.auftraege = [3, 1, 2, 3, 1, 2]; wv.punkte = 3;
  wvRundenZeichnen();
  $('#wieviele-symbol').textContent = '👂';
  wvSchritt();
  await bis(() => !wv.gesperrt);
  wievieleStoppen();
  karte(3).querySelectorAll('.menge-punkt').forEach((p, i) => i < 2 && p.classList.add('leuchtet'));
  karte(2).classList.add('blass'); karte(1).classList.add('blass');

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = (fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'WIE-VIELE-TESTS OK') + ` (${Math.round(performance.now() / 1000)} s)`;
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
