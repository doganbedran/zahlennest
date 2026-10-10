// Testet den Offline-Speicher (sw.js): er installiert sich, App, Ansagen, Bilder und Schrift liegen danach im Cache;
// Wortnests Cache (gleiche Adresse) bleibt stehen; wird unser Cache gelöscht (wie es Wortnest bei Updates tut),
// füllt ihn der nächste Start wieder auf.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const NAME = `zahlennest-v${APP_VERSION}`;
  await caches.open('buchstaben-v70');   // so heißt Wortnests Cache
  await startFertig;
  const reg = await navigator.serviceWorker.getRegistration();
  pruefe(reg, 'Offline-Speicher nicht angemeldet');
  const ergebnis = await Promise.race([
    navigator.serviceWorker.ready.then(() => 'aktiv'),
    new Promise((r) => {
      const w = reg && (reg.installing || reg.waiting);
      if (w) w.addEventListener('statechange', () => w.state === 'redundant' && r('gescheitert'));
    }),
    new Promise((r) => setTimeout(() => r('zu langsam'), 15000)),
  ]);
  pruefe(ergebnis === 'aktiv', `Offline-Speicher: ${ergebnis}`);
  const DATEIEN = ['index.html', 'app.js', 'ansagen.js', 'style.css', 'audio/ansage-pause.wav', 'bilder/nest.svg', 'icons/icon-192.png'];
  let cache = await caches.open(NAME);
  for (const datei of DATEIEN) pruefe(await cache.match(datei), `Nicht im Cache: ${datei}`);
  pruefe((await caches.keys()).includes('buchstaben-v70'), 'Wortnests Cache wurde gelöscht');

  // Schrift Andika: mitgeliefert, offline im Cache und wirklich geladen
  for (const w of ['400', '700']) pruefe(await cache.match(`fonts/andika-latin-${w}.woff2`), `Schrift ${w} nicht im Cache`);
  await document.fonts.load('700 20px Andika', 'Zahlennest');
  await document.fonts.load('400 20px Andika', 'Zahlennest');
  const geladen = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Andika' && f.status === 'loaded').map((f) => f.weight);
  pruefe(geladen.includes('400') && geladen.includes('700'), `Andika nicht geladen: ${geladen}`);
  pruefe(/^"?Andika/.test(getComputedStyle(document.body).fontFamily), 'Body nicht in Andika');

  // Wortnest löscht unseren Cache → „cache-pruefen“ (beim Start) füllt ihn wieder auf
  await caches.delete(NAME);
  (await navigator.serviceWorker.ready).active.postMessage('cache-pruefen');
  for (let i = 0; i < 50 && !(await (await caches.open(NAME)).match('app.js')); i++) await warte(200);
  cache = await caches.open(NAME);
  for (const datei of DATEIEN) pruefe(await cache.match(datei), `Nach dem Löschen nicht wieder im Cache: ${datei}`);

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'OFFLINE OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
