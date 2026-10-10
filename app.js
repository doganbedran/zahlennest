'use strict';

// Bei jeder Änderung zusammen mit CACHE in sw.js erhöhen (wird im Elternbereich angezeigt)
const APP_VERSION = 1;

const $ = (sel) => document.querySelector(sel);

// ---------- Speicher (lokal auf dem Gerät) ----------

// Wortnest liegt unter derselben Adresse und nutzt Schlüssel ohne Präfix („sterne“, „kind“, „spielzeit“ …) – die
// dürfen wir nie schreiben. Darum bekommt hier jeder Schlüssel „zn:“; nur die gemeinsame Pause steht unter „nest:“.
const speicher = {
  schluessel: (key) => (key.startsWith('nest:') ? key : `zn:${key}`),
  lesen(key, standard) {
    try {
      const wert = localStorage.getItem(this.schluessel(key));
      return wert === null ? standard : JSON.parse(wert);
    } catch { return standard; }
  },
  schreiben(key, wert) {
    try { localStorage.setItem(this.schluessel(key), JSON.stringify(wert)); } catch { /* privat/voll: ignorieren */ }
  },
};

// Browser bitten, Fotos und Einstellungen nicht bei Speicherknappheit zu löschen – erst wenn es etwas zu schützen gibt
function speicherSchuetzen() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch { /* egal */ }
}

const zustand = {
  kind: speicher.lesen('kind', null),
  spiele: [],
};

// ---------- Datenbank (IndexedDB „zahlennest“, nur auf diesem Gerät) ----------

// Eigene Datenbank: Wortnests „lernapp“ wird hier nie geöffnet (später nur lesend für „Aus Wortnest übernehmen“).
// „profile“ und „medien“ sind für Menschen/Stimmen schon angelegt, damit dafür keine neue Version nötig ist.
const datenbank = (() => {
  let dbPromise = null;
  function oeffnen() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('zahlennest', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kinder')) db.createObjectStore('kinder', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('medien')) db.createObjectStore('medien');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function aktion(store, modus, fn) {
    try {
      const db = await oeffnen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, modus);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);   // z. B. Speicher voll: kommt oft nur als abort
      });
    } catch { return undefined; }
  }
  return {
    kinder: async () => ((await aktion('kinder', 'readonly', (s) => s.getAll())) || [])
      .sort((a, b) => a.erstellt - b.erstellt),
    kindSpeichern: (k) => aktion('kinder', 'readwrite', (s) => s.put(k)),
    kindLoeschen: (id) => aktion('kinder', 'readwrite', (s) => s.delete(id)),
  };
})();

function htmlText(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ---------- Kinder: jedes Kind hat eigene Einstellungen (keine Zähler, keine Sterne) ----------

const TIERE = ['🦊', '🐻', '🐰', '🐼', '🦁', '🐸', '🐯', '🐨', '🦄', '🐶', '🐱', '🐵', '🐧', '🐢', '🦋', '🐞'];
let kinder = [];
let kindFotos = {};   // Kind-ID -> Objekt-URL des Fotos

function aktivesKind() {
  return kinder.find((k) => k.id === zustand.kind) || null;
}

async function kinderLaden() {
  Object.values(kindFotos).forEach((url) => URL.revokeObjectURL(url));
  kindFotos = {};
  kinder = await datenbank.kinder();
  kinder.forEach((k) => { if (k.foto) kindFotos[k.id] = URL.createObjectURL(k.foto); });
}

function kindBildHtml(k) {
  return kindFotos[k.id]
    ? `<img class="bild-datei foto" src="${kindFotos[k.id]}" alt="${htmlText(k.name)}">`
    : htmlText(k.tier || '');
}

// ---------- Spiele-Regal ----------

// Reihenfolge = Reihenfolge im Konzept (so werden sie nach und nach gebaut und freigeschaltet).
// Montessori: ein Material kommt erst ins Regal, wenn es gezeigt wurde. Gespeichert wird, was AUSGEBLENDET ist.
const ALLE_SPIELE = ['wieviele', 'mehr', 'korb', 'trommel', 'holmir'];
const START_REGAL = ['wieviele'];
const START_AUS = ALLE_SPIELE.filter((id) => !START_REGAL.includes(id));
// Für Eltern: was jedes Spiel tut (die Kacheln zeigen den Kindern nur ein Bild)
const SPIEL_INFO = {
  wieviele: 'Mengen 1 bis 3 auf einen Blick erkennen',
  mehr: 'Zwei Körbe: Wo sind mehr? Wo sind weniger?',
  korb: 'Dinge in den Korb schieben und dabei zählen',
  trommel: 'So oft trommeln, wie gesagt wird',
  holmir: 'Echte Dinge holen und zusammen zählen (mit Erwachsenem)',
};
// Fertige Spiele: id -> Startfunktion. Was hier fehlt, erscheint weder auf der Startseite noch im Regal.
const SPIELE = {};
const fertigeSpiele = () => ALLE_SPIELE.filter((id) => SPIELE[id]);

const regalVon = (aus) => ALLE_SPIELE.filter((id) => !aus.includes(id));
const ausVon = (sichtbar) => ALLE_SPIELE.filter((id) => !sichtbar.includes(id));
const appWeitAus = () => speicher.lesen('spieleAus', START_AUS);

function einstellungenLaden() {
  const k = aktivesKind();
  zustand.spiele = regalVon(k ? (k.spieleAus || START_AUS) : appWeitAus());
}

function regalWahlZeichnen(box, gewaehlt, aendern) {
  box.innerHTML = '';
  const fertig = fertigeSpiele();
  if (!fertig.length) {
    box.innerHTML = '<p class="hinweis">Die ersten Spiele kommen mit den nächsten Updates.</p>';
    return;
  }
  fertig.forEach((id) => {
    const vorlage = document.querySelector(`#home .spiel-btn[data-spiel="${id}"]`);
    const btn = document.createElement('button');
    const an = gewaehlt.includes(id);
    btn.className = `regal-spiel${an ? ' gewaehlt' : ''}`;
    btn.innerHTML = `<span>${vorlage.innerHTML}</span><b>${vorlage.getAttribute('aria-label')}</b><small>${SPIEL_INFO[id]}</small>`;
    btn.setAttribute('aria-pressed', an);
    btn.addEventListener('click', () => {
      const neu = an ? gewaehlt.filter((x) => x !== id) : ALLE_SPIELE.filter((x) => x === id || gewaehlt.includes(x));
      // Das letzte fertige Spiel lässt sich nicht abwählen (sonst stünde das Kind vor einer leeren Startseite)
      if (neu.some((x) => SPIELE[x])) aendern(neu);
    });
    box.appendChild(btn);
  });
}

function spieleZeigen() {
  let sichtbar = 0;
  document.querySelectorAll('#home .spiel-btn').forEach((btn) => {
    const zeigen = !!SPIELE[btn.dataset.spiel] && zustand.spiele.includes(btn.dataset.spiel);
    btn.hidden = !zeigen;
    if (zeigen) sichtbar++;
  });
  $('#home-leer').hidden = sichtbar > 0;
  const k = aktivesKind();
  $('#btn-kind').hidden = !k;
  $('#btn-kind').innerHTML = k ? kindBildHtml(k) : '';
}

document.querySelectorAll('#home .spiel-btn').forEach((btn) => {
  btn.addEventListener('click', () => spielStarten(btn.dataset.spiel));
});

function spielStarten(id) {
  audio();
  if (pauseLaeuft()) { pauseBildZeigen(); return; }
  if (SPIELE[id]) SPIELE[id]();
}

// ---------- Ton & Sprache ----------

let audioCtx = null;
// Ton-Baustein starten; darf nie werfen – sonst bräche jeder Tipp ab (z. B. ohne Soundgerät oder wenn der Browser ablehnt)
function audio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch { return null; }
  return audioCtx;
}

let deutscheStimme = null;
function stimmeWaehlen() {
  if (!('speechSynthesis' in window)) return;
  const stimmen = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('de'));
  // Nur Stimmen, die auf dem Gerät laufen: Online-Stimmen schicken den Text an einen Dienst
  deutscheStimme = stimmen.find((v) => v.localService) || null;
}
if ('speechSynthesis' in window) {
  stimmeWaehlen();
  speechSynthesis.onvoiceschanged = stimmeWaehlen;
}

function sprechen(text) {
  if (!('speechSynthesis' in window) || !deutscheStimme) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.voice = deutscheStimme;
  u.rate = 0.8;
  u.pitch = 1.1;
  speechSynthesis.speak(u);
}

// Abspielen von Audiodateien nacheinander; ein neuer Aufruf bricht den laufenden ab
const wiedergabe = { audio: null, nummer: 0 };

function wiedergabeStoppen() {
  wiedergabe.nummer++;
  if (wiedergabe.audio) { wiedergabe.audio.pause(); wiedergabe.audio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function abspielen(quelle) {
  return new Promise((resolve, reject) => {
    const a = new Audio(quelle);
    wiedergabe.audio = a;
    a.onended = resolve;
    a.onerror = reject;
    a.play().catch(reject);
  });
}

async function folgeAbspielen(folge, ersatzText) {
  wiedergabeStoppen();
  const nummer = wiedergabe.nummer;
  try {
    for (const q of folge) {
      if (nummer !== wiedergabe.nummer) return;
      await abspielen(q.url);
    }
  } catch {
    // Datei fehlt (z. B. offline ohne Cache): Notlösung Sprachausgabe des Geräts
    if (nummer === wiedergabe.nummer && ersatzText) sprechen(ersatzText);
  }
}

const ansage = (name) => folgeAbspielen([{ url: `audio/ansage-${name}.wav` }], ANSAGEN[name][0]);

// ---------- Bildschirme & Navigation ----------

function zeigen(id, verlauf = true) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  // Android-Zurück-Taste soll zur Startseite führen, nicht die App schließen
  if (verlauf && id !== 'home') history.pushState({ screen: id }, '');
}

// Zurück-Taste: zum Bildschirm aus dem Verlauf (z. B. vom Kind zurück in den Elternbereich), sonst Startseite
window.addEventListener('popstate', () => {
  wiedergabeStoppen();
  const ziel = (history.state && history.state.screen) || 'home';
  // Infoseite von der Begrüßung aus geöffnet: dorthin zurück
  if (ziel === 'home' && $('#info').classList.contains('active') && infoVonBegruessung) {
    infoVonBegruessung = false;
    zeigen('willkommen', false);
    return;
  }
  if (ziel === 'eltern') {
    elternZeichnen();
    zeigen('eltern', false);
    return;
  }
  spieleZeigen();
  zeigen('home', false);
});

function zurStartseite() {
  if (history.state && history.state.screen) history.back();
  else { spieleZeigen(); zeigen('home', false); }
}

// Spiel-Ende: großes Haus und kleineres Nochmal. Kein automatisches Weiterspielen – Kinder sollen ein natürliches Ende erleben.
function spielEnde(id, nochmal) {
  const screen = $(`#${id}`);
  if (pauseFaellig()) pauseBeginnen();
  if (pauseLaeuft()) { pauseBildZeigen(); return; }
  let ende = screen.querySelector('.spiel-ende');
  if (!ende) {
    ende = document.createElement('div');
    ende.className = 'spiel-ende';
    ende.innerHTML = '<button class="ende-home" aria-label="Fertig">🏠</button><button class="ende-nochmal" aria-label="Nochmal">🔁</button>';
    ende.querySelector('.ende-home').addEventListener('click', zurStartseite);
    ende.querySelector('.ende-nochmal').addEventListener('click', () => { audio(); spielEndeWeg(id); ende.nochmal(); });
    screen.appendChild(ende);
  }
  ende.nochmal = nochmal;
  ende.hidden = false;
}

function spielEndeWeg(id) {
  const ende = $(`#${id}`).querySelector('.spiel-ende');
  if (ende) ende.hidden = true;
}

// ---------- Pause (gemeinsam mit Wortnest, je Gerät) ----------

// Nach X Minuten Spielzeit kommt am nächsten Spielende ein ruhiges Pausen-Bild – nie mitten im Spiel, kein Countdown.
// Danach zeigt jede der beiden Apps beim Öffnen eines Spiels eine halbe Stunde lang wieder das Pausen-Bild
// (wer von Zahlennest zu Wortnest wechselt, landet nicht im nächsten Spiel); Eltern können die Pause beenden.
// Gemeinsame Schlüssel (Wortnest muss beim Umstellen genau dieses Format nutzen):
//   nest:spielzeit = { ms: Spielzeit seit der letzten Pause, letzte: Zeitpunkt, tag: 'JJJJ-MM-TT', heute: ms an diesem Tag }
//   nest:pauseNach = Minuten (0 = aus) · nest:pauseAm = Zeitpunkt der letzten Pause (ms)
const PAUSE_NEUSTART = 30 * 60000;   // so lange nicht gespielt = Zählung beginnt neu
const PAUSE_DAUER = 30 * 60000;      // so lange gilt eine Pause (in beiden Apps)
const PAUSE_WAHL = [0, 10, 15, 20, 30];
const heuteTag = () => new Date().toLocaleDateString('sv');   // „2026-10-11“ in Ortszeit

function spielzeitLesen() {
  const s = speicher.lesen('nest:spielzeit', null) || {};
  const z = { ms: Number(s.ms) || 0, letzte: Number(s.letzte) || 0, tag: s.tag, heute: Number(s.heute) || 0 };
  if (z.letzte && Date.now() - z.letzte > PAUSE_NEUSTART) z.ms = 0;
  if (z.tag !== heuteTag()) { z.tag = heuteTag(); z.heute = 0; }
  return z;
}

// Nur sichtbare Spielzeit zählt (nicht im Elternbereich, nicht im Hintergrund)
function spielzeitZaehlen() {
  if (document.hidden || document.querySelector('.screen.eltern.active')) return;
  const z = spielzeitLesen();
  const jetzt = Date.now();
  const dazu = Math.max(0, Math.min(10000, z.letzte ? jetzt - z.letzte : 10000));
  z.ms += dazu;
  z.heute += dazu;
  z.letzte = jetzt;
  speicher.schreiben('nest:spielzeit', z);
}
setInterval(spielzeitZaehlen, 10000);

const pauseNach = () => Number(speicher.lesen('nest:pauseNach', 0)) || 0;
const pauseFaellig = () => pauseNach() > 0 && spielzeitLesen().ms >= pauseNach() * 60000;
const pauseLaeuft = () => {
  const seit = Date.now() - (Number(speicher.lesen('nest:pauseAm', 0)) || 0);
  return pauseNach() > 0 && seit >= 0 && seit < PAUSE_DAUER;
};

function pauseBeginnen() {
  speicher.schreiben('nest:pauseAm', Date.now());
  const z = spielzeitLesen();
  z.ms = 0;   // nach der Pause darf wieder gespielt werden
  speicher.schreiben('nest:spielzeit', z);
}

function pauseBildZeigen() {
  zeigen('pause', !(history.state && history.state.screen));
  ansage('pause');
}
$('#btn-pause-home').addEventListener('click', zurStartseite);

function pauseWahlZeichnen() {
  const box = $('#pause-wahl');
  const aktuell = pauseNach();
  box.innerHTML = '';
  PAUSE_WAHL.forEach((min) => {
    const btn = document.createElement('button');
    btn.className = `regal-spiel${min === aktuell ? ' gewaehlt' : ''}`;
    btn.textContent = min ? `nach ${min} Minuten` : 'aus';
    btn.setAttribute('aria-pressed', min === aktuell);
    btn.addEventListener('click', () => { speicher.schreiben('nest:pauseNach', min); pauseWahlZeichnen(); });
    box.appendChild(btn);
  });
  // Nur für Eltern, gerundet; Wortnest zählt erst nach seinem Update mit
  const min = Math.round(spielzeitLesen().heute / 60000);
  $('#spielzeit-heute').textContent = `Heute gespielt: ${min < 1 ? 'noch keine Minute' : `ca. ${min} Min.`} `
    + '(Zahlennest; Wortnest zählt mit, sobald es ein Update bekommen hat).';
  $('#btn-pause-aus').hidden = !pauseLaeuft();
}

$('#btn-pause-aus').addEventListener('click', () => {
  speicher.schreiben('nest:pauseAm', 0);
  pauseWahlZeichnen();
});

// ---------- Elternbereich (2 Sekunden gedrückt halten) ----------

(() => {
  const btn = $('#btn-eltern');
  let timer = null;
  const abbrechen = () => { clearTimeout(timer); btn.classList.remove('halten'); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.classList.add('halten');
    timer = setTimeout(() => { abbrechen(); elternOeffnen(); }, 2000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, abbrechen));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
})();

function elternOeffnen() {
  wiedergabeStoppen();
  elternZeichnen();
  zeigen('eltern');
}

function elternZeichnen() {
  kinderListeZeichnen();
  // Mit Kindern stellt man das Regal beim Kind ein
  $('#karte-regal').hidden = kinder.length > 0;
  regalWahlZeichnen($('#spiele-wahl'), regalVon(appWeitAus()), (neu) => {
    speicher.schreiben('spieleAus', ausVon(neu));
    einstellungenLaden();
    elternZeichnen();
  });
  pauseWahlZeichnen();
}

$('#btn-eltern-zurueck').addEventListener('click', zurStartseite);

// --- Kinder ---

function kinderListeZeichnen() {
  const box = $('#kinder-liste');
  box.innerHTML = '';
  kinder.forEach((k) => {
    // Beschreiben statt zählen: welche Spiele das Kind sieht (keine Punkte, nichts zum Vergleichen)
    const spiele = regalVon(k.spieleAus || START_AUS).filter((id) => SPIELE[id])
      .map((id) => $(`#home .spiel-btn[data-spiel="${id}"]`).textContent).join(' ');
    const zeile = document.createElement('button');
    zeile.className = 'kind-zeile';
    zeile.innerHTML = `<span class="kind-bild">${kindBildHtml(k)}</span>`
      + `<span class="w">${htmlText(k.name)}<br><small>${spiele ? `Spiele: ${spiele}` : 'Spiele kommen mit den nächsten Updates'}</small></span>`
      + '<span class="pfeil">✏️</span>';
    zeile.addEventListener('click', () => kindBearbeiten(k.id));
    box.appendChild(zeile);
  });
}

// Neues Kind: Name abfragen, anlegen, Formular öffnen; gibt das Kind zurück (oder null bei Abbruch)
async function kindNeu() {
  const name = (prompt('Wie heißt das Kind?') || '').trim();
  if (!name) return null;
  const erstesKind = kinder.length === 0;
  const kind = {
    id: `k-${Date.now().toString(36)}`,
    name: name.slice(0, 20),
    tier: TIERE.find((t) => !kinder.some((k) => k.tier === t)) || TIERE[0],
    // Das erste Kind übernimmt das bisherige Regal
    spieleAus: erstesKind ? appWeitAus() : START_AUS,
    erstellt: Date.now(),
  };
  await datenbank.kindSpeichern(kind);
  speicherSchuetzen();
  await kinderLaden();
  if (!aktivesKind()) { zustand.kind = kind.id; speicher.schreiben('kind', kind.id); einstellungenLaden(); }
  kindBearbeiten(kind.id);
  return kind;
}
$('#btn-kind-neu').addEventListener('click', kindNeu);

let kindInArbeit = null;

function kindBearbeiten(id) {
  kindInArbeit = kinder.find((k) => k.id === id);
  if (!kindInArbeit) return;
  kindFormularZeichnen();
  zeigen('kind');
}

async function kindAendern(fn) {
  fn(kindInArbeit);
  await datenbank.kindSpeichern(kindInArbeit);
  // Neu laden, damit Liste, Fotos und aktives Kind denselben Stand haben
  await kinderLaden();
  kindInArbeit = kinder.find((k) => k.id === kindInArbeit.id);
  einstellungenLaden();
  kindFormularZeichnen();
}

function kindFormularZeichnen() {
  const k = kindInArbeit;
  $('#kind-titel').textContent = k.name;
  const name = $('#kind-name');
  if (document.activeElement !== name) name.value = k.name;

  const tiere = $('#kind-tiere');
  tiere.innerHTML = '';
  TIERE.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = `tier${!k.foto && k.tier === t ? ' gewaehlt' : ''}`;
    btn.textContent = t;
    btn.addEventListener('click', () => kindAendern((kk) => { kk.tier = t; kk.foto = null; }));
    tiere.appendChild(btn);
  });
  $('#btn-kind-foto-weg').hidden = !k.foto;
  regalWahlZeichnen($('#kind-spiele'), regalVon(k.spieleAus || START_AUS), (neu) => kindAendern((kk) => { kk.spieleAus = ausVon(neu); }));
}

$('#kind-name').addEventListener('change', (e) => {
  const name = e.target.value.trim().slice(0, 20);
  if (name) kindAendern((k) => { k.name = name; });
  else e.target.value = kindInArbeit.name;
});

$('#btn-kind-foto').addEventListener('click', () => fotoWaehlen((blob) => kindAendern((k) => { k.foto = blob; })));
$('#btn-kind-foto-weg').addEventListener('click', () => kindAendern((k) => { k.foto = null; }));

$('#btn-kind-loeschen').addEventListener('click', async () => {
  if (!confirm(`${kindInArbeit.name} löschen?`)) return;
  await datenbank.kindLoeschen(kindInArbeit.id);
  await kinderLaden();
  if (!aktivesKind()) {
    zustand.kind = kinder.length ? kinder[0].id : null;
    speicher.schreiben('kind', zustand.kind);
  }
  einstellungenLaden();
  history.back();
});

$('#btn-kind-zurueck').addEventListener('click', () => history.back());

// --- Wer spielt? ---

function werZeichnen() {
  const box = $('#wer-liste');
  box.innerHTML = '';
  kinder.forEach((k) => {
    const btn = document.createElement('button');
    btn.className = 'wer-kachel';
    btn.innerHTML = `<span class="wer-bild">${kindBildHtml(k)}</span><span class="wer-name">${htmlText(k.name)}</span>`;
    btn.addEventListener('click', () => {
      audio();
      kindWaehlen(k.id);
      spieleZeigen();
      zeigen('home', false);
    });
    box.appendChild(btn);
  });
}

function kindWaehlen(id) {
  zustand.kind = id;
  speicher.schreiben('kind', id);
  einstellungenLaden();
}

$('#btn-kind').addEventListener('click', () => {
  wiedergabeStoppen();
  werZeichnen();
  zeigen('wer', false);
});

// --- Fotos ---

let fotoFertig = null;
function fotoWaehlen(fertig) {
  fotoFertig = fertig;
  const input = $('#foto-input');
  input.value = '';
  input.click();
}

$('#foto-input').addEventListener('change', async (e) => {
  const datei = e.target.files && e.target.files[0];
  if (!datei || !fotoFertig) return;
  let blob;
  try {
    blob = await fotoVerkleinern(datei);
  } catch {
    alert('Das Foto konnte nicht geladen werden.');
    return;
  }
  await fotoFertig(blob);
});

// Quadratisch zuschneiden (Mitte) und auf 512 px verkleinern: spart Speicher, passt in jede Kachel
async function fotoVerkleinern(datei) {
  let bild;
  try {
    bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
  } catch {
    bild = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(datei);
    });
  }
  const kante = Math.min(bild.width, bild.height);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  c.getContext('2d').drawImage(bild, (bild.width - kante) / 2, (bild.height - kante) / 2, kante, kante, 0, 0, 512, 512);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject()), 'image/jpeg', 0.85));
}

// ---------- Über die App & Datenschutz (für Eltern; erreichbar aus dem Elternbereich und der Begrüßung) ----------

let infoVonBegruessung = false;
function infoOeffnen() {
  infoVonBegruessung = $('#willkommen').classList.contains('active');
  $('#info-version').textContent = `Version ${APP_VERSION}`;
  zeigen('info');
}
$('#btn-info').addEventListener('click', infoOeffnen);
$('#btn-willkommen-info').addEventListener('click', infoOeffnen);
$('#btn-info-zurueck').addEventListener('click', () => history.back());

// ---------- Willkommen (erster Start) ----------

const willkommenNoetig = () => !kinder.length && !speicher.lesen('willkommen', false);

$('#btn-willkommen-los').addEventListener('click', () => {
  speicher.schreiben('willkommen', true);
  audio();
  spieleZeigen();
  zeigen('home', false);
});
// Kind anlegen: derselbe Weg wie im Elternbereich (Name, dann Bild/Einstellungen); zurück führt zur Startseite
$('#btn-willkommen-kind').addEventListener('click', async () => {
  if (await kindNeu()) speicher.schreiben('willkommen', true);
});

// ---------- Start ----------

// Promise, damit Tests auf das Ende des Starts warten können
const startFertig = (async () => {
  await kinderLaden();
  if (zustand.kind && !aktivesKind()) zustand.kind = kinder.length ? kinder[0].id : null;
  einstellungenLaden();
  if (kinder.length) speicherSchuetzen();
  spieleZeigen();
  document.body.classList.remove('laedt');
  // Mit Kindern beginnt die App mit „Wer spielt?“, auf einem neuen Gerät mit der Begrüßung (einmalig)
  if (!$('#home').classList.contains('active')) return;
  if (kinder.length) { werZeichnen(); zeigen('wer', false); }
  else if (willkommenNoetig()) zeigen('willkommen', false);
})();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Neue Version übernommen: einmal neu laden, damit sie sofort sichtbar ist (nicht beim allerersten Start)
  const hatteVersion = !!navigator.serviceWorker.controller;
  let neuGeladen = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteVersion || neuGeladen) return;
    neuGeladen = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  // Wortnest löscht bei seinen Updates fremde Offline-Speicher derselben Adresse mit: bei jedem Start nachfüllen lassen
  navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage('cache-pruefen')).catch(() => {});
  // Auch beim Zurückholen aus dem Hintergrund nach Updates suchen (dabei wird die Seite nicht neu geladen)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
  });
}

$('#app-version').textContent = `Version ${APP_VERSION}`;

// Von Hand: Update holen und neu laden (falls ein Gerät hängen geblieben ist)
$('#btn-update').addEventListener('click', async () => {
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch { /* offline: einfach neu laden */ }
  location.reload();
});
