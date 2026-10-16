// Testet „Welche Zahl?“: Drei-Stufen-Lektion mit Ziffern (Das ist … / Wo ist …? / Sag es!), erst zwei Karten, nach zwei
// sicheren Treffern drei, kein „falsch“ (1. benennen, 2. Menge zeigen + zählen, 3. Lösung), Gruppen wie beim
// Nachspuren, Auftrag „Such eine Drei bei dir zu Hause!“, kein Text. Frisches Profil. Ansicht am Ende: Stufe 2.
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
  Object.assign(WELCHE_ZEIT, { nochmalFragen: 5000, weiterOhneTipp: 150, antwort: 150, unsicherWeiter: 100, daumen: 100,
    auftragNochmal: 3000, vormachenPause: 10, pause: 20 });
  const zuletzt = () => gesagt[gesagt.length - 1];
  const karte = (n) => $(`#welche-karten .ziffer-karte[data-ziffer="${n}"]`);
  const bereit = (stufe) => bis(() => wl.stufe === stufe && !wl.gesperrt);

  // 1. Ansagen
  pruefe(ANSAGEN['welche-wo-3'][0] === 'Wo ist die Drei?' && ANSAGEN['welche-such-0'][0] === 'Such eine Null bei dir zu Hause!', 'Ansagen');
  pruefe((await fetch('audio/ansage-welche-wo-7.wav')).ok && (await fetch('audio/ansage-welche-sag-es.wav')).ok, 'Ansage-Dateien fehlen');

  // 2. Start (nur 1 2 3): Stufe 1 benennt der Reihe nach, eine Karte; Tippen = nochmal hören
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  spieleZeigen();
  const kachel = $('#home .spiel-btn[data-spiel="welche"]');
  pruefe(!kachel.hidden && kachel.querySelectorAll('svg').length === 2, 'Kachel fehlt');
  WELCHE_ZEIT.weiterOhneTipp = 2000;
  kachel.click();
  pruefe(aktiv('welche'), 'Spiel nicht geöffnet');
  await bereit(0);
  pruefe(JSON.stringify(wl.ziffern) === '[1,2,3]' && zuletzt() === 'ziffer-ist-1' && $('#welche-karten').children.length === 1, `Stufe 1: ${gesagt}`);
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#welche').innerText), `Text auf dem Kinder-Bildschirm: ${$('#welche').innerText}`);
  karte(1).click();
  await bis(() => zuletzt() === 'ziffer-ist-2');
  pruefe(gesagt.filter((g) => g === 'ziffer-ist-1').length === 2, `Tippen in Stufe 1 benennt nicht nochmal: ${gesagt}`);
  WELCHE_ZEIT.weiterOhneTipp = 150;
  await bereit(1);

  // 3. Stufe 2: zwei Karten, „Wo ist …?“; zwei Treffer hintereinander → ab dann drei Karten
  pruefe($('#welche-karten').children.length === 2 && zuletzt() === `welche-wo-${wl.ziel}`, `Stufe 2 Start: ${zuletzt()}, ${$('#welche-karten').children.length} Karten`);
  for (let i = 0; i < 2; i++) {
    const s = wl.schritt;
    karte(wl.ziel).click();
    await bis(() => wl.schritt === s + 1 && !wl.gesperrt);
  }
  pruefe(wl.drei && $('#welche-karten').children.length === 3, 'Nach zwei Treffern keine drei Karten');

  // 4. Daneben: 1. benennen, was getippt wurde; 2. gesuchte Ziffer zeigt ihre Menge, die App zählt; 3. Lösung, weiter
  const ziel = wl.ziel;
  const falsch = wl.ziffern.find((z) => z !== ziel);
  const schritt = wl.schritt;
  karte(falsch).click();
  await bis(() => zuletzt() === `welche-wo-${ziel}` && !wl.gesperrt);
  pruefe(gesagt.slice(-2).join() === `ziffer-ist-${falsch},welche-wo-${ziel}`, `1. Daneben: ${gesagt.slice(-2)}`);
  await warte(450);
  karte(falsch).click();
  await bis(() => karte(ziel).classList.contains('mit-menge') && gesagt.includes(`zaehlen-${ziel}`));
  pruefe(karte(ziel).classList.contains('mit-menge') && karte(ziel).querySelectorAll('.karte-punkt.leuchtet').length === ziel, '2. Daneben: keine Menge');
  await bis(() => zuletzt() === `welche-wo-${ziel}` && !wl.gesperrt);
  await warte(450);
  karte(falsch).click();
  await bis(() => wl.schritt === schritt + 1);
  pruefe(wl.schritt === schritt + 1 && !wl.drei && wl.unsicher.has(ziel), '3. Daneben: nicht weiter oder Serie nicht zurückgesetzt');
  pruefe(!gesagt.some((g) => /falsch|nein/.test(g)), 'Etwas wie „falsch“ gesagt');

  // 5. Rest von Stufe 2 richtig, Stufe 3: „Sag es!“ bzw. bei unsicheren Ziffern benennen
  while (wl.stufe === 1) {
    await bis(() => !wl.gesperrt || wl.stufe !== 1);
    if (wl.stufe !== 1) break;
    const s = wl.schritt;
    karte(wl.ziel).click();
    await bis(() => wl.schritt !== s || wl.stufe !== 1);
  }
  await bis(() => wl.stufe === 2);
  await bis(() => gesagt.includes('welche-sag-es') || gesagt.slice(-1)[0].startsWith('ziffer-ist'));
  await bis(() => wl.stufe === 3, 6000);

  // 6. Auftrag: vormachen (Haus mit Hausnummer) – „Jetzt in echt!“ – „Such eine Drei …“ – 👍 – Ende
  await bis(() => wl.inEcht && !$('#btn-welche-daumen').hidden);
  const welt = gesagt.slice(gesagt.lastIndexOf('welche-such-vor'));
  pruefe(welt.join() === 'welche-such-vor,jetzt-in-echt,welche-such-3', `Auftrag: ${welt}`);
  pruefe($('#welche .in-echt-karte .ziffer-svg'), 'Karte ohne Ziffer');
  $('#btn-welche-daumen').click();
  await bis(() => $('#welche .spiel-ende') && !$('#welche .spiel-ende').hidden);
  pruefe(zuletzt() === 'welche-such-fertig', `Schluss: ${zuletzt()}`);
  pruefe(gesagt.includes('welche-sag-es'), 'Stufe 3 ohne „Sag es!“');

  // 7. Gruppen wie beim Nachspuren: mit 4 5 6 mindestens zwei daraus, nie ein verwechselbares Paar
  zustand.ziffern456 = true;
  for (let k = 0; k < 20; k++) {
    $('#welche .ende-nochmal').click();
    pruefe(wl.ziffern.filter((z) => z >= 4).length >= 2 && !ZIFFER_VERWECHSLUNG.some(([a, b]) => wl.ziffern.includes(a) && wl.ziffern.includes(b)),
      `Ziffern: ${wl.ziffern}`);
    welcheStoppen();
    spielEnde('welche', welcheNeu);
  }
  zustand.ziffern456 = false;

  // Ansicht: Stufe 2 mit drei Karten, eine zeigt die Menge
  $('#welche .ende-nochmal').click();
  welcheStoppen();
  Object.assign(wl, { stufe: 1, schritt: 0, drei: true, auftraege: [2, 1, 3, 2, 1, 3] });
  $('#welche-symbol').textContent = WIEVIELE_SYMBOL[1];
  wlStufe2();
  await bereit(1);
  karte(3).classList.add('mit-menge');

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'WELCHE OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
