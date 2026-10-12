// Testet eigene Dinge bei „Hol mir …“: Foto anlegen (Elternbereich), kommt in den Rundenplan, Karte zeigt das Foto,
// Ansagen ohne Namen („Hol mir zwei davon!“ – „Leg sie hin!“ – „Zeig auf jedes!“ – „Eins, zwei. Zwei!“), löschen,
// höchstens sechs. Frisches Browserprofil. Ansicht am Ende: Auftrag mit drei Fotos.
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
  window.confirm = () => true;

  const gesagt = [];
  folgeAbspielen = async (folge) => { gesagt.push(...folge.map((q) => q.url.replace('audio/ansage-', '').replace('.wav', ''))); await warte(5); };
  zaehlenMitLeuchten = async (name) => { gesagt.push(name); await warte(5); };
  Object.assign(HOL_ZEIT, { daumen: 120, auftragNochmal: 3000, hinlegen: 10, hinlegenViele: 10, selbstZaehlen: 10, rundenPause: 30 });

  // Foto einer „Ente“ (gelber Kreis) statt Kamera
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  const g = c.getContext('2d');
  g.fillStyle = '#fff4d6'; g.fillRect(0, 0, 120, 120);
  g.fillStyle = '#f5c518'; g.beginPath(); g.arc(60, 66, 34, 0, 7); g.fill();
  g.fillStyle = '#e07b00'; g.fillRect(84, 52, 22, 10);
  const foto = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  fotoWaehlen = (fertig) => fertig(foto);

  // 1. Ansagen da und richtig
  pruefe(ANSAGEN['hol-eigen-2'][0] === 'Hol mir zwei davon!' && ANSAGEN['hol-zeig-jedes'][0] === 'Zeig auf jedes!', 'Ansagen eigener Dinge');
  pruefe((await fetch('audio/ansage-hol-eigen-3.wav')).ok && (await fetch('audio/ansage-hol-zeig-1-eigen.wav')).ok, 'Ansage-Dateien fehlen');

  // 2. Elternbereich (Spiel im Regal): Karte da, Ding anlegen
  speicher.schreiben('spieleAus', []);
  einstellungenLaden();
  elternOeffnen();
  await warte(200);
  pruefe(!$('#eigene-dinge').closest('.karte').hidden, 'Karte „Eigene Dinge“ fehlt');
  window.prompt = () => 'Ente';
  $('#btn-ding-neu').click();
  await bis(() => eigeneDinge.length === 1 && $('#eigene-dinge img'));
  const ente = eigeneDinge[0];
  pruefe(ente && ente.name === 'Ente' && $('#eigene-dinge').textContent.includes('Ente'), 'Eigenes Ding nicht angelegt');
  pruefe(JSON.stringify(speicher.lesen('eigeneDinge', [])) === JSON.stringify([{ id: ente.id, name: 'Ente' }]), 'Liste falsch gespeichert');
  pruefe(await datenbank.medium('dinge', ente.id, 'bild'), 'Foto nicht gespeichert');

  // 3. Rundenplan nimmt es mit
  const geplant = new Set();
  for (let k = 0; k < 60; k++) holRundenPlanen().forEach((r) => geplant.add(r.ding));
  pruefe(geplant.has(`eigen:${ente.id}`), `Eigenes Ding nie im Plan: ${[...geplant]}`);

  // 4. Runde mit zwei Enten: Karte mit Fotos, Ansagen ohne Namen; dann eine Ente; dann Ende
  zurStartseite(); await warte(300);
  $('#home .spiel-btn[data-spiel="holmir"]').click();
  holStoppen();
  hl.runden = [{ n: 2, ding: `eigen:${ente.id}` }, { n: 1, ding: `eigen:${ente.id}` }];
  hl.runde = 0;
  holNeueRunde();
  await bis(() => hl.inEcht && !$('#btn-hol-daumen').hidden);
  pruefe(document.querySelectorAll('#hol .karte-ding.eigen img').length === 2, 'Karte zeigt keine zwei Fotos');
  pruefe(gesagt.includes('hol-eigen-2'), `Auftrag: ${gesagt}`);
  pruefe(!/[A-Za-zÄÖÜäöüß]/.test($('#hol').innerText), 'Name des Dings auf dem Kinder-Bildschirm');
  $('#btn-hol-daumen').click();
  await bis(() => hl.wartetZurueck);
  const r1 = gesagt.slice(gesagt.lastIndexOf('hol-leg-hin'));
  pruefe(r1.join() === 'hol-leg-hin,hol-zeig-jedes,zaehlen-2,hol-zurueck', `Runde 1: ${r1}`);
  $('#btn-hol-daumen').click();
  await bis(() => hl.runde === 1 && hl.inEcht && !$('#btn-hol-daumen').hidden);
  pruefe(gesagt[gesagt.length - 1] === 'hol-eigen-1', `Auftrag 2: ${gesagt.slice(-2)}`);
  $('#btn-hol-daumen').click();
  await bis(() => hl.wartetZurueck);
  $('#btn-hol-daumen').click();
  await bis(() => $('#hol .spiel-ende') && !$('#hol .spiel-ende').hidden);
  const r2 = gesagt.slice(gesagt.lastIndexOf('hol-leg-hin-1-es'));
  pruefe(r2.join() === 'hol-leg-hin-1-es,hol-zeig-1-eigen,zaehlen-1,hol-zurueck-1-es,ende-hol', `Runde 2: ${r2}`);

  // 5. Löschen; höchstens sechs
  holStoppen();
  zurStartseite(); await warte(300);
  elternOeffnen();
  await warte(200);
  $('#eigene-dinge .ding-zeile button').click();
  await bis(() => !eigeneDinge.length);
  pruefe(!eigeneDinge.length && !speicher.lesen('eigeneDinge', []).length && !(await datenbank.medium('dinge', ente.id, 'bild')), 'Löschen unvollständig');
  for (let i = 0; i < 6; i++) {
    $('#btn-ding-neu').click();
    await bis(() => eigeneDinge.length === i + 1);
  }
  pruefe(eigeneDinge.length === 6 && $('#btn-ding-neu').hidden, 'Mehr als sechs eigene Dinge möglich');

  // Ansicht: Auftrag mit drei Enten
  zurStartseite(); await warte(300);
  $('#home .spiel-btn[data-spiel="holmir"]').click();
  holStoppen();
  hl.runden = [{ n: 3, ding: `eigen:${eigeneDinge[0].id}` }, { n: 1, ding: 'loeffel' }];
  hl.runde = 0;
  holNeueRunde();
  await bis(() => hl.inEcht);
  pruefe(aktiv('hol'), 'Spiel nicht offen');

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'HOL-EIGEN OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
