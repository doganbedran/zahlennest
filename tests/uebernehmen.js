// Testet „Kinder aus Wortnest übernehmen“: legt eine Wortnest-Datenbank „lernapp“ (Version 3, wie im Datenvertrag) mit
// Kindern an – auch kaputte/fremde Einträge –, übernimmt sie und prüft: nur Name/Tier/Foto, geprüft, keine Doppelten,
// Wortnests Datenbank unverändert. Frisches Browserprofil. Ansicht am Ende: Elternbereich mit den Kindern.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  await startFertig;

  // Ein kleines echtes Foto (JPEG), wie Wortnest es speichert
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const g = c.getContext('2d');
  g.fillStyle = '#e9a23b'; g.fillRect(0, 0, 40, 40);
  g.fillStyle = '#4a3f35'; g.beginPath(); g.arc(20, 20, 10, 0, 7); g.fill();
  const foto = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  const stimme = new Blob(['RIFF'], { type: 'audio/wav' });

  // 1. Wortnest-Datenbank wie auf dem Gerät anlegen (nur der Test schreibt hinein)
  const WORTNEST_KINDER = [
    { id: 'k-1', name: 'Lina', tier: '🐰', foto, nameStimme: stimme, profil: 'standard', sterne: { a: 3 }, erstellt: 1 },
    { id: 'k-2', name: '  Benjamin-Maximilian-Alexander  ', tier: '💣', foto: null, erstellt: 2 },
    { id: 'k-3', name: { boese: 1 }, tier: '🐻', erstellt: 3 },
    { id: 'k-4', name: 'Mia', tier: '🐼', foto: new Blob(['<script>'], { type: 'text/html' }), erstellt: 4 },
    { id: 'k-5', name: '   ', tier: '🐼', erstellt: 5 },
  ];
  const lernapp = (version) => new Promise((ok, nein) => {
    const req = version ? indexedDB.open('lernapp', version) : indexedDB.open('lernapp');
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kinder', { keyPath: 'id' });
      req.result.createObjectStore('profile', { keyPath: 'id' });
      req.result.createObjectStore('medien');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => nein(req.error);
  });
  const db = await lernapp(3);
  await new Promise((ok) => {
    const tx = db.transaction('kinder', 'readwrite');
    WORTNEST_KINDER.forEach((k) => tx.objectStore('kinder').put(k));
    tx.oncomplete = ok;
  });
  db.close();

  // 2. Elternbereich: Knopf sichtbar, weil es Wortnest gibt
  elternOeffnen();
  await warte(300);
  pruefe(!$('#btn-aus-wortnest').hidden, 'Knopf „Aus Wortnest übernehmen“ fehlt');

  // 3. Übernehmen: drei gültige Kinder (Lina, Benjamin gekürzt, Mia ohne Foto); kaputte Einträge nicht
  let gefragt = '';
  window.confirm = (t) => { gefragt = t; return true; };
  let gemeldet = '';
  window.alert = (t) => { gemeldet = t; };
  await ausWortnestUebernehmen();
  pruefe(/Lina/.test(gefragt) && /Mia/.test(gefragt), `Frage vor dem Übernehmen: ${gefragt}`);
  pruefe(kinder.length === 3, `Kinder nach dem Übernehmen: ${kinder.map((k) => k.name)}`);
  const lina = kinder.find((k) => k.name === 'Lina');
  const ben = kinder.find((k) => k.name.startsWith('Benjamin'));
  const mia = kinder.find((k) => k.name === 'Mia');
  pruefe(lina && lina.tier === '🐰' && lina.foto instanceof Blob && lina.foto.type === 'image/jpeg', 'Lina: Tier/Foto nicht übernommen');
  pruefe(lina && !('sterne' in lina) && !('nameStimme' in lina) && !('profil' in lina), `Lina: Wortnest-interne Felder übernommen: ${lina && Object.keys(lina)}`);
  pruefe(lina && lina.id !== 'k-1' && lina.wortnestId === 'k-1', 'Lina: eigene ID / Herkunft fehlt');
  pruefe(ben && ben.name.length <= 20 && TIERE.includes(ben.tier), `Ben: ${ben && ben.name} ${ben && ben.tier}`);
  pruefe(mia && !mia.foto, 'Mia: fremde Datei als Foto übernommen');
  pruefe(new Set(kinder.map((k) => k.id)).size === 3, 'Doppelte Kinder-IDs');
  pruefe(kinder.every((k) => Array.isArray(k.spieleAus) && 'holBis5' in k), 'Übernommene Kinder ohne Einstellungen');
  pruefe(zustand.kind === lina?.id, 'Erstes übernommenes Kind ist nicht ausgewählt');
  pruefe($('#kinder-liste img.foto'), 'Foto erscheint nicht in der Liste');

  // 4. Nochmal: nichts Doppeltes, nur ein Hinweis
  gefragt = '';
  await ausWortnestUebernehmen();
  pruefe(kinder.length === 3 && !gefragt && /keine Kinder/.test(gemeldet), 'Zweites Übernehmen legt doppelt an');

  // 5. Wortnest unverändert: Version 3, alle Einträge samt Sternen
  const db2 = await lernapp();
  pruefe(db2.version === 3, `Wortnest-Datenbank hat jetzt Version ${db2.version}`);
  const danach = await new Promise((ok) => {
    const r = db2.transaction('kinder').objectStore('kinder').getAll();
    r.onsuccess = () => ok(r.result);
  });
  db2.close();
  pruefe(danach.length === 5 && danach[0].sterne?.a === 3, 'Wortnests Kinder verändert');

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'UEBERNEHMEN OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
