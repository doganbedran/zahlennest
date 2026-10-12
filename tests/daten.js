// Testet die Trennung von Wortnest (gleiche Adresse doganbedran.github.io): Wortnests Schlüssel bleiben unberührt,
// eigene Schlüssel nur mit „zn:“ (bzw. „nest:“ für die Pause), eigene Datenbank „zahlennest“, nie „lernapp“.
// Die Testseite legt vorher Wortnest-Schlüssel an (werkzeuge/testseiten_erzeugen.sh).
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const WORTNEST = { sterne: '{"a":2}', kind: '"k-wortnest"', spielzeit: '{"ms":5000,"letzte":1}', pauseNach: '15' };
  await startFertig;
  window.confirm = () => true;
  folgeAbspielen = () => Promise.resolve();

  // 1. Wortnest-Daten führen nicht zu „neues Gerät“-Verwirrung: Zahlennest startet ohne Kind, mit eigenem Stand
  pruefe(zustand.kind === null, `Wortnests Kind übernommen: ${zustand.kind}`);
  pruefe(pauseNach() === 0, 'Wortnests alte Pause-Einstellung (ohne Präfix) übernommen');

  // 2. Möglichst viel tun, was speichert
  SPIELE.wieviele = SPIELE.wieviele || (() => {});
  window.prompt = () => 'Lina';
  elternOeffnen();
  await kindNeu();
  await kindAendern((k) => { k.spieleAus = []; });
  history.back(); await warte(300);
  [...$('#pause-wahl').children][2].click();
  zurStartseite(); await warte(300);
  kindWaehlen(kinder[0].id);
  spielzeitZaehlen();
  speicher.schreiben('willkommen', true);
  zeigen('home', false);
  document.body.insertAdjacentHTML('beforeend', '<section id="testspiel" class="screen"><header class="topbar"></header></section>');
  speicher.schreiben('nest:spielzeit', { ms: 20 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 20 * 60000 });
  spielEnde('testspiel', () => {});

  // 3. Wortnests Schlüssel unverändert, alle anderen mit Präfix
  Object.entries(WORTNEST).forEach(([k, v]) => pruefe(localStorage.getItem(k) === v, `Wortnest-Schlüssel verändert: ${k}`));
  const fremd = Object.keys(localStorage).filter((k) => !(k in WORTNEST) && !/^(zn|nest):/.test(k));
  pruefe(!fremd.length, `Schlüssel ohne Präfix: ${fremd}`);
  const nest = Object.keys(localStorage).filter((k) => k.startsWith('nest:'));
  pruefe(nest.every((k) => ['nest:spielzeit', 'nest:pauseNach', 'nest:pauseAm'].includes(k)), `Unbekannte gemeinsame Schlüssel: ${nest}`);

  // 4. Ohne Wortnest auf dem Gerät: kein Knopf „Aus Wortnest übernehmen“, Lesen legt nichts an
  pruefe((await wortnestLesen()).kinder.length === 0, 'Wortnest-Kinder ohne Wortnest');
  await wortnestKnopfZeigen();
  pruefe($('#btn-aus-wortnest').hidden, 'Knopf „Aus Wortnest übernehmen“ ohne Wortnest');
  // Datenbanken: „zahlennest“ ja, „lernapp“ nie
  const dbs = (await indexedDB.databases()).map((d) => d.name);
  pruefe(dbs.includes('zahlennest') && !dbs.includes('lernapp'), `Datenbanken: ${dbs}`);

  // 5. Im Programmcode: localStorage nur über „speicher“, keine Wortnest-Datenbank
  const code = await (await fetch('app.js')).text();
  pruefe((code.match(/localStorage\.(setItem|removeItem|clear)/g) || []).length === 1, 'localStorage wird außerhalb von „speicher“ geschrieben');
  // „lernapp“ nur an einer Stelle und ohne Versionsnummer öffnen (Datenvertrag), nie löschen
  pruefe((code.match(/indexedDB\.open\(\s*['"]lernapp/g) || []).length === 1 && code.includes("indexedDB.open('lernapp')")
    && !/deleteDatabase/.test(code), 'Code öffnet „lernapp“ anders als im Datenvertrag');
  const sw = await (await fetch('sw.js')).text();
  pruefe(sw.includes("k.startsWith('zahlennest-')"), 'sw.js räumt fremde Caches mit ab');

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'DATEN-TRENNUNG OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
