// Testet eigene Stimmen: Mensch anlegen, im Studio einen Satz „aufnehmen“ (künstlicher Ton statt Mikrofon), speichern,
// als Stimme wählen (ohne Kinder app-weit, mit Kind beim Kind) – Ansagen kommen dann aus der Aufnahme, fehlende Sätze
// weiter von der Computerstimme. Löschen entfernt alle Aufnahmen. Frisches Browserprofil. Ansicht am Ende: Studio.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const bis = async (fn, ms = 4000) => {
    const ende = Date.now() + ms;
    while (!fn() && Date.now() < ende) await warte(30);
    return fn();
  };
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;
  window.confirm = () => true;
  const gespielt = [];
  folgeAbspielen = (folge) => { gespielt.push(...folge.map((q) => q.url)); return Promise.resolve(); };

  // Künstliche Aufnahme: Stille – Ton – Stille (das Studio schneidet die Stille ab)
  const ton = (lautstaerke) => {
    const t = new Float32Array(STUDIO_RATE * 1.2);
    for (let i = Math.round(STUDIO_RATE * 0.3); i < STUDIO_RATE * 0.9; i++) t[i] = lautstaerke * Math.sin(i / 8);
    return studioWav(t);
  };

  // 1. Ohne Menschen: Computerstimme, keine Stimmwahl
  elternOeffnen();
  await warte(200);
  pruefe(ansageUrl('pause') === 'audio/ansage-pause.wav', 'Ohne Menschen keine Computerstimme');
  pruefe($('#stimme-app').hidden, 'Stimmwahl ohne Menschen sichtbar');

  // 2. Mensch anlegen: eigener Bildschirm, noch nichts eingesprochen
  window.prompt = () => 'Papa';
  const papa = await menschNeu();
  await warte(200);
  pruefe(aktiv('mensch') && $('#mensch-titel').textContent === 'Papa', 'Mensch-Bildschirm nicht offen');
  pruefe(/^0 von \d+/.test($('#mensch-stand').textContent), `Stand: ${$('#mensch-stand').textContent}`);

  // 3. Studio: beginnt beim ersten Satz; leise Aufnahme wird abgelehnt, richtige gespeichert
  await studioOeffnen(papa.id);
  pruefe(aktiv('studio') && !$('#studio-hinweis').hidden, 'Studio/Hinweis nicht offen');
  pruefe($('#studio-text').textContent === ANSAGEN.pause[0], `Erster Satz: ${$('#studio-text').textContent}`);
  pruefe($('#studio-reiter').children.length >= 6, 'Reiter je Spiel fehlen');
  await studioVerarbeiten(ton(0.001));
  pruefe(!studio.aufnahme && /Nichts gehört/.test($('#studio-meldung').textContent), 'Stille Aufnahme angenommen');
  await studioVerarbeiten(ton(0.5));
  pruefe(studio.aufnahme instanceof Blob && !$('#btn-studio-gut').disabled, 'Aufnahme nicht aufbereitet');
  pruefe(gespielt.length && gespielt[gespielt.length - 1].startsWith('blob:'), 'Aufnahme wird nicht vorgespielt');
  await studioSpeichern();
  pruefe($('#studio-text').textContent === ANSAGEN['zaehlen-1'][0], `Nach dem Speichern nicht beim nächsten Satz: ${$('#studio-text').textContent}`);
  pruefe(/Eins!.*Sekunde/.test($('#studio-text').textContent + $('#studio-tipp').textContent), 'Tipp für Zählfolgen fehlt');
  const medien = await datenbank.medienVon(papa.id);
  pruefe(medien.length === 1 && medien[0].platz === 'datei:ansage-pause.wav' && medien[0].art === 'stimme', `Gespeichert: ${JSON.stringify(medien.map((m) => m.platz))}`);
  pruefe($('#studio-reiter').children[0].textContent.includes('1/'), 'Reiter zählt die Aufnahme nicht');

  // 4. Zurück zum Menschen, dann Elternbereich: Stand und Stimmwahl (ohne Kinder app-weit)
  history.back();
  await bis(() => aktiv('mensch'));
  await warte(200);
  pruefe(/^1 von/.test($('#mensch-stand').textContent), `Stand nach Aufnahme: ${$('#mensch-stand').textContent}`);
  history.back();
  await bis(() => aktiv('eltern'));
  await warte(300);
  pruefe(!$('#stimme-app').hidden && $('#stimme-app-wahl').querySelectorAll('input').length === 2, 'App-weite Stimmwahl fehlt');
  pruefe(ansageUrl('pause') === 'audio/ansage-pause.wav', 'Neuer Mensch spricht ungefragt');
  $('#stimme-app-wahl').querySelectorAll('input')[1].click();
  await bis(() => ansageUrl('pause').startsWith('blob:'));
  pruefe(ansageUrl('pause').startsWith('blob:'), 'Eigene Aufnahme wird nicht benutzt');
  pruefe(ansageUrl('zaehlen-1') === 'audio/ansage-zaehlen-1.wav', 'Fehlender Satz nicht von der Computerstimme');

  // 5. Mit Kind: Stimme gilt je Kind (neues Kind: Computerstimme), Auswahl im Kind-Formular
  window.prompt = () => 'Lina';
  await kindNeu();
  await warte(200);
  pruefe(!$('#karte-kind-stimme').hidden && $('#kind-stimme').querySelectorAll('input').length === 2, 'Stimmwahl beim Kind fehlt');
  await bis(() => ansageUrl('pause') === 'audio/ansage-pause.wav');
  pruefe(ansageUrl('pause') === 'audio/ansage-pause.wav', 'Kind ohne Stimmwahl hört die App-Stimme');
  $('#kind-stimme').querySelectorAll('input')[1].click();
  await bis(() => kinder[0].stimme === papa.id && ansageUrl('pause').startsWith('blob:'));
  pruefe(ansageUrl('pause').startsWith('blob:'), 'Stimme beim Kind wirkt nicht');
  history.back();
  await bis(() => aktiv('eltern'));
  await warte(200);
  pruefe($('#stimme-app').hidden, 'App-weite Stimmwahl trotz Kind sichtbar');

  // 6. Im Spiel: ansage() nutzt die Aufnahme
  gespielt.length = 0;
  await ansage('pause');
  pruefe(gespielt[0] && gespielt[0].startsWith('blob:'), `Ansage im Spiel: ${gespielt}`);

  // 7. Löschen: Aufnahmen und Foto weg, Kind hört wieder die Computerstimme
  await datenbank.medienSetzen(papa.id, 'ich', 'bild', new Blob(['x'], { type: 'image/jpeg' }));
  menschBearbeiten(papa.id);
  await warte(200);
  $('#btn-mensch-loeschen').click();
  await bis(() => aktiv('eltern') && !menschen.length);
  await warte(300);
  pruefe(!menschen.length && !(await datenbank.medienVon(papa.id)).length, 'Aufnahmen nach dem Löschen noch da');
  pruefe(!kinder[0].stimme && ansageUrl('pause') === 'audio/ansage-pause.wav', 'Kind hängt noch an gelöschter Stimme');

  // Ansicht: Studio mit einem neuen Menschen
  window.prompt = () => 'Oma';
  const oma = await menschNeu();
  await studioOeffnen(oma.id);
  await studioVerarbeiten(ton(0.5));

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'STIMME OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
