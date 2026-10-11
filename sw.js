// Offline-Cache: Mit Internet immer die neueste Version laden, ohne Internet aus dem Cache.
importScripts('ansagen.js');

const CACHE = 'zahlennest-v3';   // gleiche Nummer wie APP_VERSION in app.js
const DATEIEN = [
  './', 'index.html', 'style.css', 'app.js', 'ansagen.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png', 'bilder/nest.svg',
  ...['latin', 'latin-ext'].flatMap((t) => ['400', '700'].map((w) => `fonts/andika-${t}-${w}.woff2`)),
  ...Object.keys(ANSAGEN).map((a) => `audio/ansage-${a}.wav`),
];

const cacheFuellen = () => caches.open(CACHE).then((c) => c.addAll(DATEIEN));

self.addEventListener('install', (e) => {
  e.waitUntil(cacheFuellen().then(() => self.skipWaiting()));
});

// Nur eigene alte Caches löschen: Wortnest (buchstaben-…) liegt unter derselben Adresse und teilt den Cache-Speicher
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zahlennest-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Wortnest löscht bei seinen Updates alle fremden Caches mit. Die App fragt darum bei jedem Start nach:
// fehlt etwas, wird alles neu geladen (geht nur online; offline bleibt es beim alten Stand).
self.addEventListener('message', (e) => {
  if (e.data !== 'cache-pruefen') return;
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(DATEIEN.map((d) => c.match(d))))
    .then((treffer) => (treffer.every(Boolean) ? null : cacheFuellen()))
    .catch(() => {}));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const eigeneSeite = new URL(e.request.url).origin === location.origin;
  // cache: 'no-cache' umgeht den 10-Minuten-Browsercache von GitHub Pages (fragt per ETag nach, meist nur "304")
  const anfrage = eigeneSeite ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(
    anfrage
      .then((antwort) => {
        if (antwort.ok && eigeneSeite) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      })
      .catch(() => caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true })))
  );
});
