// Testet Kinder: anlegen, Bild/Foto, Name, eigenes Regal je Kind, „Wer spielt?“, Löschen – und dass nirgends Zahlen
// über ein Kind stehen. Frisches Browserprofil. Ansicht am Ende per #wer, #home, #kind, #eltern.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const bis = async (fn, ms = 4000) => {
    const ende = Date.now() + ms;
    while (!fn() && Date.now() < ende) await new Promise((r) => setTimeout(r, 30));
    return fn();
  };
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;
  window.confirm = () => true;
  // Zwei Spiele vortäuschen, damit es im Regal etwas zu wählen gibt
  ['wieviele', 'mehr'].forEach((id) => { if (!SPIELE[id]) SPIELE[id] = () => {}; });

  pruefe(aktiv('home') && $('#btn-kind').hidden, 'Ohne Kinder: Startseite ohne Kind-Knopf');

  // 1. App-weites Regal ändern, dann erstes Kind: übernimmt es
  speicher.schreiben('spieleAus', ausVon(['wieviele', 'mehr']));
  einstellungenLaden();
  elternOeffnen();
  window.prompt = () => 'Lina';
  $('#btn-kind-neu').click();
  await bis(() => kinder.length === 1 && aktiv('kind'));
  const lina = kinder[0];
  pruefe(regalVon(lina.spieleAus).includes('mehr'), 'Erstes Kind übernimmt das Regal nicht');
  pruefe(zustand.kind === lina.id, 'Erstes Kind nicht aktiv');
  pruefe(localStorage.getItem('zn:kind') === JSON.stringify(lina.id), 'Aktives Kind nicht unter zn:kind');

  // 2. Bild: Tier wählen, Foto setzen und wieder weg; Name ändern
  [...document.querySelectorAll('#kind-tiere .tier')][3].click();
  const gewaehltesTier = () => ($('#kind-tiere .tier.gewaehlt') || {}).textContent;
  await bis(() => gewaehltesTier() === TIERE[3]);
  pruefe(kinder[0].tier === TIERE[3], 'Tier nicht gespeichert');
  const foto = await fotoVerkleinern(await new Promise((r) => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 40;
    const g = c.getContext('2d'); g.fillStyle = '#00796b'; g.fillRect(0, 0, 80, 40); c.toBlob(r);
  }));
  await kindAendern((k) => { k.foto = foto; });
  pruefe(kindBildHtml(kinder[0]).includes('blob:') && !$('#btn-kind-foto-weg').hidden, 'Foto nicht gesetzt');
  $('#btn-kind-foto-weg').click();
  await bis(() => gewaehltesTier() === TIERE[3]);
  pruefe(!kinder[0].foto && kindBildHtml(kinder[0]) === TIERE[3], `Foto nicht entfernt: ${kinder[0].foto} ${kindBildHtml(kinder[0])}`);
  $('#kind-name').value = 'Lina M.';
  $('#kind-name').dispatchEvent(new Event('change'));
  await bis(() => $('#kind-titel').textContent === 'Lina M.');
  pruefe($('#kind-titel').textContent === 'Lina M.', `Name nicht geändert: ${$('#kind-titel').textContent} / ${kinder[0].name}`);

  // 3. Zweites Kind: anderes Tier, Start-Regal
  history.back();
  await bis(() => aktiv('eltern'));
  pruefe($('#karte-regal').hidden, 'Mit Kindern: app-weites Regal sollte verborgen sein');
  window.prompt = () => 'Emil';
  $('#btn-kind-neu').click();
  await bis(() => kinder.length === 2);
  const emil = kinder.find((k) => k.name === 'Emil');
  pruefe(emil.tier !== kinder[0].tier, 'Emil hat dasselbe Tier');
  pruefe(JSON.stringify(regalVon(emil.spieleAus)) === JSON.stringify(START_REGAL), 'Emil nicht mit Start-Regal');
  // Regal je Kind: bei Emil „mehr“ dazu
  [...document.querySelectorAll('#kind-spiele .regal-spiel')].find((b) => !b.classList.contains('gewaehlt')).click();
  await bis(() => regalVon(kinder.find((k) => k.name === 'Emil').spieleAus).includes('mehr'));
  pruefe(regalVon(kinder.find((k) => k.name === 'Emil').spieleAus).includes('mehr'), 'Regal je Kind nicht gespeichert');
  history.back();
  await bis(() => aktiv('eltern'));

  // 4. Keine Zahlen über Kinder im Elternbereich (keine Zähler, nichts zum Vergleichen)
  pruefe(!/\d/.test($('#kinder-liste').textContent), `Zahl in der Kinderliste: ${$('#kinder-liste').textContent}`);

  // 5. „Wer spielt?“: Kind wählen → Startseite mit seinem Bild und seinem Regal
  zurStartseite(); await bis(() => aktiv('home'));
  $('#btn-kind').click();
  pruefe(aktiv('wer') && document.querySelectorAll('#wer .wer-kachel').length === 2, 'Wer spielt? zeigt nicht beide');
  [...document.querySelectorAll('#wer .wer-kachel')].find((b) => b.textContent.includes('Emil')).click();
  pruefe(aktiv('home') && zustand.kind === emil.id && $('#btn-kind').textContent === emil.tier, 'Emil nicht gewählt');
  pruefe(zustand.spiele.includes('mehr') && !$('#home .spiel-btn[data-spiel="mehr"]').hidden, 'Emils Regal nicht aktiv');

  // 6. Kind löschen → andere bleiben; aktives Kind fällt auf ein vorhandenes zurück
  elternOeffnen();
  kindBearbeiten(emil.id);
  $('#btn-kind-loeschen').click();
  await bis(() => kinder.length === 1 && aktiv('eltern'));
  pruefe(kinder.length === 1 && kinder[0].id === lina.id, 'Kind löschen fehlgeschlagen');
  pruefe(zustand.kind === lina.id, 'Aktives Kind nach dem Löschen falsch');

  // Ansicht für den Screenshot
  window.prompt = () => 'Emil';
  await kindNeu();
  const ansicht = location.hash.slice(1) || 'wer';
  zeigen('home', false);
  if (ansicht === 'wer') { werZeichnen(); zeigen('wer', false); }
  if (ansicht === 'home') spieleZeigen();
  if (ansicht === 'kind') kindBearbeiten(lina.id);
  if (ansicht === 'eltern') elternOeffnen();

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'KINDER-TESTS OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
