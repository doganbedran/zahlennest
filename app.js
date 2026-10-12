'use strict';

// Bei jeder Änderung zusammen mit CACHE in sw.js erhöhen (wird im Elternbereich angezeigt)
const APP_VERSION = 14;

// Nie in fremden Seiten laufen (Schutz vor „Klick-Fallen“, bei denen eine fremde Seite die App unsichtbar einbettet):
// eingebettet → nur ein Hinweis mit Link, die App startet nicht
if (window.top !== window.self) {
  document.body.className = '';
  document.body.textContent = '';
  const a = document.createElement('a');
  a.href = location.href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Zahlennest in einem eigenen Fenster öffnen';
  document.body.append(a);
  throw new Error('Zahlennest läuft nicht eingebettet');
}

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
  mehr: 'Zwei Teller: Wo sind mehr? (auf Wunsch auch: Wo sind weniger?)',
  korb: 'Dinge in den Korb schieben und dabei zählen (1–3, auf Wunsch bis 5)',
  trommel: 'So oft trommeln, wie gesagt wird (1–3, auf Wunsch bis 5)',
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
  SPIEL_OPTIONEN.forEach((o) => { zustand[o] = k ? !!(k[o] ?? optionStandard(o)) : !!speicher.lesen(o, optionStandard(o)); });
}

// Schalter einzelner Spiele (je Kind, ohne Kinder app-weit): Name = Feld beim Kind, Schlüssel zn:<Name>, data-option
const SPIEL_OPTIONEN = ['weniger', 'korbBis5', 'korbTippen', 'trommelBis5', 'holBis5',
  'holLoeffel', 'holBecher', 'holBaustein', 'holKuscheltier'];
// Standard „an“ (sonst aus): die Dinge bei „Hol mir …“
const SPIEL_STANDARD = { holLoeffel: true, holBecher: true, holBaustein: true, holKuscheltier: true };
const optionStandard = (o) => !!SPIEL_STANDARD[o];
const HOL_DINGE_OPTIONEN = ['holLoeffel', 'holBecher', 'holBaustein', 'holKuscheltier'];

// Einstellungen einzelner Spiele nur zeigen, wenn es das Spiel schon gibt
function spielOptionenZeigen() {
  document.querySelectorAll('.spiel-option').forEach((el) => { el.hidden = !SPIELE[el.dataset.spiel]; });
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
const wiedergabe = { audio: null, nummer: 0, beenden: null };

// Anhalten meldet die laufende Aufnahme als beendet: wer auf sie wartet, läuft weiter und prüft dann selbst, ob er
// noch dran ist (ein angehaltenes Audio meldet sonst nie „zu Ende“ – der Ablauf dahinter bliebe für immer stehen)
function wiedergabeStoppen() {
  wiedergabe.nummer++;
  if (wiedergabe.audio) { wiedergabe.audio.pause(); wiedergabe.audio = null; }
  if (wiedergabe.beenden) { const fertig = wiedergabe.beenden; wiedergabe.beenden = null; fertig(); }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function abspielen(quelle) {
  return new Promise((resolve, reject) => {
    const a = new Audio(quelle);
    wiedergabe.audio = a;
    wiedergabe.beenden = resolve;
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
const warten = (ms) => new Promise((r) => setTimeout(r, ms));
const zufall = (liste) => liste[Math.floor(Math.random() * liste.length)];
function mischen(liste) {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Zählfolge mit Leuchten: „Eins, zwei. Zwei!“ – die Dinge leuchten nacheinander im Takt der ganzen Aufnahme
// (gleichmäßig über die Dauer verteilt: n Zählwörter + die betonte letzte Zahl). Ohne Datei: Sprachausgabe.
async function zaehlenMitLeuchten(name, elemente, beiJedem = null) {
  wiedergabeStoppen();
  const nummer = wiedergabe.nummer;
  let gestartet = false;
  const leuchten = (dauer) => {
    if (gestartet) return;
    gestartet = true;
    elemente.forEach((el, i) => setTimeout(() => {
      if (nummer !== wiedergabe.nummer) return;
      el.classList.add('leuchtet');
      if (beiJedem) beiJedem(i);
    }, (dauer * 1000 * i) / (elemente.length + 1)));
  };
  try {
    await new Promise((resolve, reject) => {
      const a = new Audio(`audio/ansage-${name}.wav`);
      wiedergabe.audio = a;
      wiedergabe.beenden = resolve;
      a.onended = resolve;
      a.onerror = reject;
      a.onplaying = () => leuchten(Number.isFinite(a.duration) ? a.duration : (elemente.length + 1) * 0.7);
      a.play().catch(reject);
    });
  } catch {
    if (nummer !== wiedergabe.nummer) return;
    leuchten((elemente.length + 1) * 0.8);
    sprechen(ANSAGEN[name][0]);
    await warten((elemente.length + 1) * 800);
  }
}

// Kleines Glockenspiel für Treffer und Stufenwechsel (kein Ton bei Daneben)
function glockenspiel() {
  const ctx = audio();
  if (!ctx) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.12;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  });
}

// ---------- Bildschirme & Navigation ----------

function zeigen(id, verlauf = true) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  // Android-Zurück-Taste soll zur Startseite führen, nicht die App schließen
  if (verlauf && id !== 'home') history.pushState({ screen: id }, '');
}

// Zurück-Taste: zum Bildschirm aus dem Verlauf (z. B. vom Kind zurück in den Elternbereich), sonst Startseite
window.addEventListener('popstate', () => {
  wiedergabeStoppen();
  wievieleStoppen();
  mehrStoppen();
  korbStoppen();
  trommelStoppen();
  holStoppen();
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
  $(`#${id}`).classList.remove('ruhig');
  const ende = $(`#${id}`).querySelector('.spiel-ende');
  if (ende) ende.hidden = true;
}

// ---------- Pause (gemeinsam mit Wortnest, je Gerät) ----------

// Nach X Minuten Spielzeit kommt am nächsten Spielende ein ruhiges Pausen-Bild – nie mitten im Spiel, kein Countdown.
// Danach zeigt jede der beiden Apps beim Öffnen eines Spiels eine halbe Stunde lang wieder das Pausen-Bild
// (wer von Zahlennest zu Wortnest wechselt, landet nicht im nächsten Spiel); Eltern können die Pause beenden.
// Gemeinsame Schlüssel (Wortnest nutzt dasselbe Format; Änderungen nur in beiden Apps zugleich):
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
  // Nur für Eltern, gerundet; beide Apps zählen in denselben Schlüssel
  const min = Math.round(spielzeitLesen().heute / 60000);
  $('#spielzeit-heute').textContent = `Heute gespielt: ${min < 1 ? 'noch keine Minute' : `ca. ${min} Min.`} `
    + '(Wortnest und Zahlennest zusammen).';
  $('#btn-pause-aus').hidden = !pauseLaeuft();
}

$('#btn-pause-aus').addEventListener('click', () => {
  speicher.schreiben('nest:pauseAm', 0);
  pauseWahlZeichnen();
});

// ---------- Gemeinsame Bausteine der Spiele ----------

// Jedes Spiel hat einen Zustand mit nummer (jeder Neustart/Abbruch zählt hoch; alte Abläufe erkennen daran, dass sie
// überholt sind), gesperrt (Tipps zählen gerade nicht) und timer. Ansagen prüfen VOR dem Sprechen, ob das Spiel noch
// offen ist (z. B. 🏠 während einer kurzen Wartepause), und melden danach, ob es weitergehen darf.
function spielBausteine(id, z) {
  const aktuell = (nr) => nr === z.nummer && $(`#${id}`).classList.contains('active');
  return {
    aktuell,
    stoppen() { clearTimeout(z.timer); z.nummer++; z.gesperrt = true; },
    ansage: (nr, name) => (aktuell(nr)
      ? folgeAbspielen([{ url: `audio/ansage-${name}.wav` }], ANSAGEN[name][0]).then(() => aktuell(nr)) : Promise.resolve(false)),
    zaehlen: (nr, name, elemente, beiJedem) => (aktuell(nr)
      ? zaehlenMitLeuchten(name, elemente, beiJedem).then(() => aktuell(nr)) : Promise.resolve(false)),
  };
}

// ---------- Auftrag in der echten Welt (alle Spiele) ----------
// Ablauf (Team + User): 1. das Spiel macht es einmal vor; 2. „Jetzt in echt!“ – das Spielfeld leert sich, groß 👐,
// darüber nur eine kleine, flache Erinnerungskarte (nichts sieht greifbar aus; Tippen darauf lenkt einmal sanft um:
// „Mach es in echt, mit deinen Händen!“); 3. der Erwachsene tippt 👍 (klein, unten rechts), dann zeigt das Kind auf
// die echten Dinge, und die App zählt mit (die Karte leuchtet). Keine Zeitgrenze: nach einer Weile kommt der Auftrag
// einmal nochmal, dann wartet die App einfach. z.inEcht = in dieser Phase; z.echtSagen = Auftrag nochmal (🔊).
async function inEcht({ z, nr, aktuell, ansage, buehne, knopf, karteHtml, sagen, zeit, einleitung = true, karteKlasse = '' }) {
  z.inEcht = true;
  z.echtSagen = sagen;
  z.umgelenkt = false;
  buehne.closest('.screen').classList.add('ruhig');
  buehne.innerHTML = `<div class="in-echt"><div class="in-echt-karte ${karteKlasse}">${karteHtml}</div>`
    + '<div class="in-echt-haende" aria-hidden="true">👐</div></div>';
  const karte = buehne.querySelector('.in-echt-karte');
  buehne.querySelector('.in-echt').addEventListener('pointerdown', async () => {
    if (!aktuell(nr) || z.gesperrt || z.fertig || z.umgelenkt) return;
    z.umgelenkt = true;
    z.gesperrt = true;
    animieren(karte, 'wackelt');
    if ((await ansage(nr, 'echt-umlenken')) && !z.fertig) z.gesperrt = false;
  });
  if (einleitung && !(await ansage(nr, 'jetzt-in-echt'))) return;
  if (!(await sagen(nr))) return;   // „Jetzt in echt! … Leg drei Bausteine in einen Becher!“
  if (z.fertig) return;
  z.gesperrt = false;
  z.timer = setTimeout(() => {
    if (!aktuell(nr) || z.fertig) return;
    knopf.hidden = false;
    const nochmal = async () => {
      if (!aktuell(nr) || z.fertig) return;
      if (z.gesperrt) { z.timer = setTimeout(nochmal, 1000); return; }   // spricht gerade
      z.gesperrt = true;
      if ((await sagen(nr)) && !z.fertig) z.gesperrt = false;
    };
    z.timer = setTimeout(nochmal, zeit.auftragNochmal - zeit.daumen);
  }, zeit.daumen);
}

// Nach 👍 (auch während einer Ansage): fertig, Knopf weg; gibt die Karte zurück (zum Mitzählen)
function inEchtBestaetigt(z, knopf) {
  if (z.fertig || !z.inEcht) return null;
  z.fertig = true;
  z.gesperrt = true;
  clearTimeout(z.timer);
  knopf.hidden = true;
  return $(`#${knopf.closest('.screen').id} .in-echt-karte`);
}

// 🔊 in der Phase „in echt“: nur den Auftrag nochmal sagen (👍 bleibt, die Zeiten laufen weiter)
function inEchtNochmal(z) {
  if (z.fertig || z.gesperrt) return;
  const nr = z.nummer;
  z.gesperrt = true;
  z.echtSagen(nr).then((ok) => { if (ok && !z.fertig) z.gesperrt = false; });
}

// ---------- Wie viele? Drei-Stufen-Lektion mit den Mengen 1–3 ----------

// 👀 Stufe 1 „Das sind zwei.“ (benennen) · 👂 Stufe 2 „Wo sind drei?“ (wiedererkennen) · 🗣️ Stufe 3 „Sag es!“ (ohne Prüfung).
// Nur Würfelbilder (ein Lernziel); das Fingerbild kommt im Auftrag am Ende („Zeig mir zwei Finger!“).
// Kein „falsch“: 1. Daneben = benennen, 2. = die App zählt mit (Punkte leuchten), 3. = Lösung zeigen und weiter.
const WIEVIELE_STUFEN = [3, 6, 3];
const WIEVIELE_SYMBOL = ['👀', '👂', '🗣️'];
// Wartezeiten in ms (Tests verkürzen sie)
const WIEVIELE_ZEIT = { nochmalFragen: 8000, weiterOhneTipp: 8000, antwort: 5000, unsicherWeiter: 2000, daumen: 2500,
  auftragNochmal: 12000, vormachenPause: 900, pause: 900 };
const WIEVIELE_ENDE = ['ende-hingeschaut', 'ende-angeschaut', 'ende-finger'];
// wv.stufe zählt ab 0: 0 = Stufe 1 (benennen), 1 = Stufe 2 (wiedererkennen), 2 = Stufe 3 (sag es), 3 = Auftrag echte Welt
const wv = { stufe: 0, schritt: 0, punkte: 0, auftraege: [], ziel: 0, versuche: 0, unsicher: new Set(), gesperrt: true,
  timer: null, nummer: 0, letzterTipp: 0, auftragMenge: 0, fertig: false, letztesEnde: null };

const wvBausteine = spielBausteine('wieviele', wv);
const { aktuell: wvAktuell, ansage: wvAnsage, zaehlen: wvZaehlen } = wvBausteine;
const benennen = (n) => `wieviele-${n}`;

// Würfelbild: 3×3-Raster, gleich große Punkte in gleichem Abstand (1 = Mitte, 2 = Diagonale, 3 = Diagonale ganz)
const WUERFEL = { 1: [[50, 50]], 2: [[24, 24], [76, 76]], 3: [[24, 24], [50, 50], [76, 76]] };
const wuerfelSvg = (n) => `<svg viewBox="0 0 100 100" aria-hidden="true">${
  WUERFEL[n].map(([x, y]) => `<circle class="menge-punkt" cx="${x}" cy="${y}" r="11"/>`).join('')}</svg>`;

// Fingerbild (Hand von vorn, Daumen links; Daumen zuerst wie in Deutschland üblich): 1 = Daumen, 2 = + Zeigefinger, 3 = + Mittelfinger.
// Gestreckte Finger haben die Klasse „zaehlt“ (in Zählreihenfolge), eingeklappte sind kurze Stummel.
function fingerSvg(n) {
  const finger = [[34, 18], [46, 12], [58, 16], [70, 26]];   // x, Höhe oben (Zeige-, Mittel-, Ring-, kleiner Finger)
  // Daumen (bei 1–3 immer gestreckt); Drehung auf einer eigenen Gruppe: die Stilregel fürs Leuchten (transform-box)
  // verschöbe sie sonst
  const teile = ['<g transform="rotate(-35 32 80)"><rect class="hand finger zaehlt" x="26" y="40" width="12" height="42" rx="6"/></g>'];
  finger.forEach(([x, oben], i) => {
    const gestreckt = i + 2 <= n;
    teile.push(gestreckt
      ? `<rect class="hand finger zaehlt" x="${x - 5.5}" y="${oben}" width="11" height="${60 - oben}" rx="5.5"/>`
      : `<rect class="hand finger" x="${x - 5.5}" y="44" width="11" height="16" rx="5.5"/>`);
  });
  teile.push('<rect class="hand" x="26" y="50" width="52" height="44" rx="16"/>');
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(9 -2)">${teile.join('')}</g></svg>`;
}

function wvRundenZeichnen() {
  let n = 0;
  $('#wieviele-runden').innerHTML = WIEVIELE_STUFEN.map((anzahl) => `<span class="gruppe">${
    Array.from({ length: anzahl }, () => `<span class="${n++ < wv.punkte ? 'voll' : ''}"></span>`).join('')}</span>`).join('');
}

function wvKarte(n, bild = wuerfelSvg(n), extra = ' kommt') {
  const btn = document.createElement('button');
  btn.className = `mengen-karte${extra}`;
  btn.dataset.menge = n;
  btn.innerHTML = bild;
  btn.setAttribute('aria-label', String(n));
  btn.addEventListener('click', () => wvGetippt(n, btn));
  return btn;
}

function wvEinzeln(n, bild) {
  const box = $('#wieviele-karten');
  box.className = 'mengen-karten einzeln';
  box.replaceChildren(wvKarte(n, bild));
  return box.firstChild;
}

function animieren(el, klasse) {
  el.classList.remove('huepft', 'wackelt', 'kommt', klasse);
  void el.offsetWidth;
  el.classList.add(klasse);
}

function wievieleStoppen() {
  wvBausteine.stoppen();
}

// Reihenfolge in Stufe 2: jede Menge zweimal, nie zweimal dieselbe hintereinander, nicht mit der mittleren beginnen
function wvAuftraege() {
  for (;;) {
    const folge = mischen([1, 2, 3, 1, 2, 3]);
    if (folge[0] !== 2 && folge.every((n, i) => n !== folge[i - 1])) return folge;
  }
}

// Stufe 1: eine Karte, „Das sind zwei.“; Tipp = die App zählt mit (Punkte leuchten), dann weiter
async function wvStufe1() {
  wievieleStoppen();
  const nr = wv.nummer;
  const n = wv.schritt + 1;
  const karte = wvEinzeln(n);
  if (!(await wvAnsage(nr, benennen(n)))) return;
  wv.gesperrt = false;
  karte.classList.add('pulsiert');
  wv.timer = setTimeout(() => wvAktuell(nr) && !wv.gesperrt && wvWeiter(nr), WIEVIELE_ZEIT.weiterOhneTipp);
}

// Stufe 2: drei Karten (Plätze jedes Mal neu), „Wo sind drei?“
async function wvStufe2() {
  wievieleStoppen();
  const nr = wv.nummer;
  wv.ziel = wv.auftraege[wv.schritt];
  wv.versuche = 0;
  const box = $('#wieviele-karten');
  box.className = 'mengen-karten drei';
  box.replaceChildren(...mischen([1, 2, 3]).map((n) => wvKarte(n)));
  await warten(400);
  if (!wvAktuell(nr)) return;
  wvFragen(nr);
}

async function wvFragen(nr) {
  if (!wvAktuell(nr)) return;   // z. B. 🏠 während der kurzen Wartezeit davor
  wv.gesperrt = true;
  if (!(await wvAnsage(nr, `wieviele-wo-${wv.ziel}`))) return;
  wv.gesperrt = false;
  // Nichts getippt: nochmal fragen, danach pulsiert die gesuchte Karte sanft (nie selbst weiter, kein Zeitdruck)
  clearTimeout(wv.timer);
  wv.timer = setTimeout(async () => {
    if (!wvAktuell(nr) || wv.gesperrt) return;
    wv.gesperrt = true;
    if (!(await wvAnsage(nr, `wieviele-wo-${wv.ziel}`))) return;
    wv.gesperrt = false;
    wv.timer = setTimeout(() => wvAktuell(nr) && wvZielKarte().classList.add('pulsiert'), WIEVIELE_ZEIT.nochmalFragen);
  }, WIEVIELE_ZEIT.nochmalFragen);
}

const wvZielKarte = () => $(`#wieviele-karten .mengen-karte[data-menge="${wv.ziel}"]`);

// Stufe 3: eine Karte, „Wie viele sind das? Sag es!“ – Ruhe zum Selbersagen (Karte pulsiert nicht: sagen, nicht tippen);
// ein Tipp heißt „hören, ob es stimmt“, ohne Tipp nennt die App die Menge nach einer Weile
async function wvStufe3() {
  wievieleStoppen();
  const nr = wv.nummer;
  const n = wv.auftraege[wv.schritt];
  const karte = wvEinzeln(n);
  // War die Menge in Stufe 2 noch unsicher: wie in der Montessori-Lektion zurück zum Benennen (einmal, dann weiter)
  if (wv.unsicher.has(n)) {
    if (!(await wvAnsage(nr, benennen(n)))) return;
    wv.gesperrt = false;
    wv.timer = setTimeout(() => wvAktuell(nr) && !wv.gesperrt && wvWeiter(nr), WIEVIELE_ZEIT.unsicherWeiter);
    return;
  }
  if (!(await wvAnsage(nr, 'wieviele-sag-es'))) return;
  wv.gesperrt = false;
  wv.timer = setTimeout(() => wvAktuell(nr) && !wv.gesperrt && wvAntwort(nr, n, karte), WIEVIELE_ZEIT.antwort);
}

async function wvAntwort(nr, n, karte) {
  wv.gesperrt = true;
  clearTimeout(wv.timer);
  karte.classList.remove('pulsiert');
  animieren(karte, 'huepft');
  if (!(await wvAnsage(nr, benennen(n)))) return;
  await warten(WIEVIELE_ZEIT.pause);
  wvWeiter(nr);
}

async function wvGetippt(n, btn) {
  const jetzt = performance.now();
  // Beim Auftrag bestätigt nur der Erwachsene mit 👍 (das Kind soll die Finger zeigen, nicht das Bild antippen)
  if (wv.gesperrt || wv.stufe === 3 || jetzt - wv.letzterTipp < 400) return;
  wv.letzterTipp = jetzt;
  audio();
  clearTimeout(wv.timer);
  const nr = wv.nummer;
  wv.gesperrt = true;
  btn.classList.remove('pulsiert');
  if (wv.stufe === 2 && wv.unsicher.has(n)) {
    // nach dem Benennen getippt: mitzählen statt dasselbe nochmal zu sagen
    if (!(await wvZaehlen(nr, `zaehlen-${n}`, [...btn.querySelectorAll('.menge-punkt')]))) return;
    await warten(WIEVIELE_ZEIT.pause);
    wvWeiter(nr);
    return;
  }
  if (wv.stufe === 2) { wvAntwort(nr, n, btn); return; }
  if (wv.stufe === 0) {
    // Stufe 1: mitzählen, die Punkte leuchten, dann weiter
    animieren(btn, 'huepft');
    if (!(await wvZaehlen(nr, `zaehlen-${n}`, [...btn.querySelectorAll('.menge-punkt')]))) return;
    await warten(WIEVIELE_ZEIT.pause);
    wvWeiter(nr);
    return;
  }
  // Stufe 2
  if (n === wv.ziel) {
    btn.classList.add('richtig');
    animieren(btn, 'huepft');
    glockenspiel();
    await warten(400);   // erst der Glockenton, dann klar hörbar die Zahl
    if (!(await wvAnsage(nr, benennen(n)))) return;
    await warten(WIEVIELE_ZEIT.pause);
    wvWeiter(nr);
    return;
  }
  wv.versuche++;
  wv.unsicher.add(wv.ziel);
  const ziel = wvZielKarte();
  if (wv.versuche === 1) {
    // Daneben: sanft wackeln und benennen, was getippt wurde – dann die Frage nochmal
    animieren(btn, 'wackelt');
    if (!(await wvAnsage(nr, benennen(n)))) return;
    await warten(400);
    wvFragen(nr);
  } else if (wv.versuche === 2) {
    // Hilfe: die anderen treten zurück, die App zählt die gesuchte Menge langsam mit
    document.querySelectorAll('#wieviele-karten .mengen-karte').forEach((k) => k.classList.toggle('blass', k !== ziel));
    animieren(btn, 'wackelt');
    if (!(await wvZaehlen(nr, `zaehlen-${wv.ziel}`, [...ziel.querySelectorAll('.menge-punkt')]))) return;
    ziel.querySelectorAll('.menge-punkt').forEach((p) => p.classList.remove('leuchtet'));
    document.querySelectorAll('#wieviele-karten .mengen-karte').forEach((k) => k.classList.remove('blass'));
    await warten(400);
    wvFragen(nr);
  } else {
    // Lösung zeigen und weiter
    ziel.classList.add('richtig');
    animieren(ziel, 'huepft');
    if (!(await wvAnsage(nr, benennen(wv.ziel)))) return;
    await warten(WIEVIELE_ZEIT.pause);
    wvWeiter(nr);
  }
}

function wvWeiter(nr) {
  if (!wvAktuell(nr)) return;
  wv.punkte++;
  wv.schritt++;
  wvRundenZeichnen();
  if (wv.schritt < WIEVIELE_STUFEN[wv.stufe]) { wvSchritt(); return; }
  wvNaechsteStufe();
}

function wvSchritt() {
  $('#wieviele-symbol').textContent = WIEVIELE_SYMBOL[wv.stufe] || '';   // in echt: kein Zeichen (dort steht 👐)
  [wvStufe1, wvStufe2, wvStufe3, wvAuftrag][wv.stufe]();
}

async function wvNaechsteStufe() {
  wievieleStoppen();
  const nr = wv.nummer;
  glockenspiel();
  wv.stufe++;
  wv.schritt = 0;
  wv.auftraege = wv.stufe === 1 ? wvAuftraege() : mischen([1, 2, 3]);
  await warten(700);
  if (!wvAktuell(nr)) return;
  wvSchritt();
  animieren($('#wieviele-symbol'), 'huepft');
}

// Echte Welt: erst vormachen (großes Fingerbild, „Zeig mir zwei Finger!“, die gezeichneten Finger werden gezählt),
// dann „Jetzt in echt!“ – das Kind zeigt die Finger an der eigenen Hand; nach 👍 „Zeig mal!“ und die App zählt mit
async function wvAuftrag() {
  wievieleStoppen();
  const nr = wv.nummer;
  wv.fertig = false;
  $('#btn-wieviele-daumen').hidden = true;
  const n = wv.auftragMenge || (wv.auftragMenge = zufall([2, 3, 2, 3, 1]));
  const karte = wvEinzeln(n, fingerSvg(n));
  if (!(await wvAnsage(nr, `finger-zeig-${n}`))) return;
  if (!(await wvZaehlen(nr, `finger-${n}`, [...karte.querySelectorAll('.finger.zaehlt')]))) return;
  await warten(WIEVIELE_ZEIT.vormachenPause);
  const box = $('#wieviele-karten');
  box.className = 'mengen-karten';
  inEcht({ z: wv, nr, aktuell: wvAktuell, ansage: wvAnsage, buehne: box, knopf: $('#btn-wieviele-daumen'),
    karteHtml: fingerSvg(n), sagen: (nr2) => wvAnsage(nr2, `finger-zeig-${n}`), zeit: WIEVIELE_ZEIT });
}

async function wvAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(wv, $('#btn-wieviele-daumen'));
  if (!karte) return;
  if (!(await wvAnsage(nr, 'zeig-mal'))) return;
  if (!(await wvZaehlen(nr, `finger-${wv.auftragMenge}`, [...karte.querySelectorAll('.finger.zaehlt')]))) return;
  glockenspiel();
  await warten(400);
  // Beschreiben statt bewerten, abwechselnd (nie zweimal dasselbe hintereinander)
  wv.letztesEnde = zufall(WIEVIELE_ENDE.filter((e) => e !== wv.letztesEnde));
  if (!(await wvAnsage(nr, wv.letztesEnde))) return;
  spielEnde('wieviele', wievieleNeu);
}

$('#btn-wieviele-daumen').addEventListener('click', () => { audio(); if (wv.inEcht) wvAuftragErledigt(wv.nummer); });

function wievieleNeu() {
  wievieleStoppen();
  Object.assign(wv, { stufe: 0, schritt: 0, punkte: 0, auftraege: [], unsicher: new Set(), auftragMenge: 0, fertig: false, inEcht: false });
  $('#btn-wieviele-daumen').hidden = true;
  wvRundenZeichnen();
  wvSchritt();
}

function wievieleStarten() {
  spielEndeWeg('wieviele');
  zeigen('wieviele');
  wievieleNeu();
}
SPIELE.wieviele = wievieleStarten;

$('#btn-wieviele-home').addEventListener('click', () => { wievieleStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: Ansage nochmal. In Stufe 2 nur die Frage (Karten bleiben liegen, die Hilfe nach 2 Versuchen bleibt erhalten);
// während die App spricht, zählt oder die Stufe wechselt, passiert nichts
$('#btn-wieviele-laut').addEventListener('click', () => {
  const ende = $('#wieviele .spiel-ende');
  if ((ende && !ende.hidden) || wv.fertig || wv.gesperrt) return;
  audio();
  if (wv.inEcht) { inEchtNochmal(wv); return; }
  if (wv.stufe === 1) {
    clearTimeout(wv.timer);
    wv.nummer++;
    wvFragen(wv.nummer);
    return;
  }
  wvSchritt();
});

// ---------- Mehr oder weniger? Zwei Teller vergleichen ----------

// 8 Runden: erst große Unterschiede (1:4 …), dann kleinere (1:2 …) – nie knapp (3:4, 4:5) und nie gleich viele.
// Mit „weniger“ (Eltern-Schalter je Kind): 4× „Wo sind mehr?“, angesagter Wechsel, 4× „Wo sind weniger?“ (nie gemischt,
// dann wieder die großen Unterschiede). Kein „falsch“: 1. Daneben = die Dinge stellen sich paarweise auf (Eins-zu-eins),
// 2. = die App zählt beide Teller, 3. = Lösung zeigen und weiter. Der Teller mit weniger wird nie blass oder traurig.
const MEHR_PAARE = { gross: [[1, 4], [1, 5], [2, 5], [1, 3]], klein: [[1, 2], [2, 4], [3, 5], [2, 5]] };
const MEHR_ZEIT = { nochmalFragen: 8000, pause: 900, paarSchritt: 450, zeigen: 3000, daumen: 2500, auftragNochmal: 12000 };
const MEHR_ENDE = ['ende-verglichen', 'ende-hingeschaut'];
// Auftrag in zwei Teilen mit Zeit zum Zeigen dazwischen: [Bild, Ansage] – das gerade gemeinte Bild leuchtet
const MEHR_WELT = { augen: [['👀', 'welt-augen'], ['👃', 'welt-nase']], haende: [['🙌', 'welt-haende'], ['👄', 'welt-mund']] };
// Dinge: gleich groß (Kreis mit Radius 18), schlicht, dunkler Rand – heben sich auch über die Helligkeit vom Teller ab
const DINGE = {
  apfel: '<circle r="17" cy="2" fill="#d23c2c" stroke="#4a3f35" stroke-width="2.5"/>'
    + '<path d="M0 -14 q1 -6 5 -8" fill="none" stroke="#4a3f35" stroke-width="3" stroke-linecap="round"/>'
    + '<ellipse cx="8" cy="-14" rx="6" ry="3" fill="#4c9a3a" transform="rotate(-25 8 -14)"/>',
  ei: '<ellipse rx="14" ry="18" fill="#fff3d6" stroke="#4a3f35" stroke-width="3"/>',
  ball: '<circle r="17" fill="#1d5fbf" stroke="#4a3f35" stroke-width="2.5"/>'
    + '<path d="M-16 -3 Q0 -12 16 -3" fill="none" stroke="#fff" stroke-width="3"/>',
};
// Würfelbild im festen Raster (gleicher Abstand in beiden Richtungen); 1–3 wie in „Wie viele?“
const MEHR_STELLEN = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]] };
const MEHR_ABSTAND = 46;
const mw = { runde: 0, runden: [], versuche: 0, mitHilfe: 0, gepaart: false, gesperrt: true, timer: null, nummer: 0, letzterTipp: 0,
  fertig: false, welt: null, letztesEnde: null, auftrag: false };

const mwBausteine = spielBausteine('mehr', mw);
const { aktuell: mwAktuell, ansage: mwAnsage, zaehlen: mwZaehlen } = mwBausteine;
const mwRunde = () => mw.runden[mw.runde];
const mwTeller = () => [...document.querySelectorAll('#mehr-teller .teller')];
const mwDinge = (teller) => [...teller.querySelectorAll('.ding')];

function mehrStoppen() {
  mwBausteine.stoppen();
}

// Rundenplan: Mengen, welcher Teller voller ist (höchstens zweimal hintereinander dieselbe Seite), Ding, Frage
function mehrRundenPlanen() {
  const paare = zustand.weniger
    ? [...mischen(MEHR_PAARE.gross), ...mischen(MEHR_PAARE.gross)]
    : [...mischen(MEHR_PAARE.gross), ...mischen(MEHR_PAARE.klein)];
  // Der gesuchte Teller liegt höchstens zweimal hintereinander auf derselben Seite (auch beim Wechsel zu „weniger“)
  const ziele = [];
  let ding = null;
  return paare.map(([wenig, viel], i) => {
    ding = zufall(Object.keys(DINGE).filter((d) => d !== ding));
    const zweiGleich = ziele.length >= 2 && ziele[ziele.length - 1] === ziele[ziele.length - 2];
    const ziel = zweiGleich ? 1 - ziele[ziele.length - 1] : zufall([0, 1]);
    ziele.push(ziel);
    const frage = zustand.weniger && i >= 4 ? 'weniger' : 'mehr';
    const gesucht = frage === 'mehr' ? viel : wenig;
    const mengen = ziel === 0 ? [gesucht, gesucht === viel ? wenig : viel] : [gesucht === viel ? wenig : viel, gesucht];
    return { mengen, ding, frage, ziel };
  });
}

// Stiller Rückschritt: Hat das Kind in den ersten vier Runden zweimal Hilfe beim Zählen gebraucht, bleiben auch die
// Runden 5–8 bei großen Unterschieden (keine Meldung, keine Zahl über das Kind)
function mehrLeichterWeiter() {
  if (mw.mitHilfe < 2 || zustand.weniger) return;
  mischen(MEHR_PAARE.gross).forEach(([wenig, viel], k) => {
    const r = mw.runden[4 + k];
    r.mengen = r.ziel === 0 ? [viel, wenig] : [wenig, viel];
  });
}

function tellerSvg(n, ding) {
  const dinge = MEHR_STELLEN[n].map(([dx, dy]) => `<g class="ding" style="transform: translate(${150 + dx * MEHR_ABSTAND}px, ${
    90 + dy * MEHR_ABSTAND}px)"><g class="ding-innen"><circle class="halo" r="23"/>${DINGE[ding]}</g></g>`).join('');
  return `<svg viewBox="0 0 300 180" aria-hidden="true"><ellipse class="rand" cx="150" cy="90" rx="146" ry="86"/>`
    + `<ellipse class="mitte" cx="150" cy="90" rx="124" ry="68"/>${dinge}</svg>`;
}

function mwRundenZeichnen() {
  let n = 0;
  $('#mehr-runden').innerHTML = [4, 4].map((anzahl) => `<span class="gruppe">${
    Array.from({ length: anzahl }, () => `<span class="${n++ < mw.runde ? 'voll' : ''}"></span>`).join('')}</span>`).join('');
}

async function mehrNeueRunde() {
  mehrStoppen();
  const nr = mw.nummer;
  const r = mwRunde();
  mw.versuche = 0;
  mw.gepaart = false;
  const box = $('#mehr-teller');
  box.replaceChildren(...r.mengen.map((n, i) => {
    const btn = document.createElement('button');
    btn.className = 'teller kommt';
    btn.innerHTML = tellerSvg(n, r.ding);
    btn.setAttribute('aria-label', `Teller ${i + 1}`);
    btn.addEventListener('click', () => mehrGetippt(i, btn));
    return btn;
  }));
  await warten(450);
  if (!mwAktuell(nr)) return;
  // Erste Runde bzw. Wechsel zu „weniger“: mit Einleitung
  const wechsel = mw.runde === 0 || (r.frage === 'weniger' && mw.runden[mw.runde - 1].frage !== 'weniger');
  mehrFragen(nr, wechsel ? `${r.frage}-start` : `${r.frage}-wo`);
}

async function mehrFragen(nr, ansageName = `${mwRunde().frage}-wo`) {
  if (!mwAktuell(nr)) return;
  mw.gesperrt = true;
  if (!(await mwAnsage(nr, ansageName))) return;
  mw.gesperrt = false;
  // Nichts getippt: nochmal fragen; danach stellen sich die Dinge still paarweise auf (zählt nicht als Versuch)
  clearTimeout(mw.timer);
  mw.timer = setTimeout(async () => {
    if (!mwAktuell(nr) || mw.gesperrt) return;
    mw.gesperrt = true;
    if (!(await mwAnsage(nr, `${mwRunde().frage}-wo`))) return;
    mw.gesperrt = false;
    mw.timer = setTimeout(async () => {
      if (!mwAktuell(nr) || mw.gesperrt) return;
      mw.gesperrt = true;
      if (!mw.gepaart && !(await mehrPaaren(nr))) return;
      if (!(await mwAnsage(nr, `${mwRunde().frage}-wo`))) return;
      mw.gesperrt = false;
      mwTeller()[mwRunde().ziel].classList.add('pulsiert');
    }, MEHR_ZEIT.nochmalFragen);
  }, MEHR_ZEIT.nochmalFragen);
}

// Eins-zu-eins: die Dinge beider Teller rutschen in je eine Reihe, gleiche Spalten untereinander; dann hüpfen die
// Paare nacheinander, zuletzt die übrigen (die zeigen, wo mehr sind)
async function mehrPaaren(nr) {
  const reihen = mwTeller().map(mwDinge);
  const breit = Math.max(...reihen.map((r) => r.length));
  const schmal = Math.min(...reihen.map((r) => r.length));
  // Oberer Teller: Reihe unten, unterer Teller: Reihe oben – so stehen sich die Paare nah gegenüber
  reihen.forEach((dinge, t) => dinge.forEach((d, i) => {
    d.style.transform = `translate(${150 + (i - (breit - 1) / 2) * 50}px, ${t === 0 ? 128 : 52}px)`;
  }));
  mw.gepaart = true;
  await warten(600);
  // Bei „mehr“ hüpfen zum Schluss die Übrigen (dort sind mehr); bei „weniger“ nur die Paare, dann die kurze Reihe
  const weniger = mwRunde().frage === 'weniger';
  for (let i = 0; i < (weniger ? schmal : breit); i++) {
    if (!mwAktuell(nr)) return false;
    reihen.forEach((dinge) => dinge[i] && animieren(dinge[i].firstChild, 'huepft'));
    await warten(MEHR_ZEIT.paarSchritt);
  }
  if (weniger && mwAktuell(nr)) {
    reihen.find((r) => r.length === schmal).forEach((d) => animieren(d.firstChild, 'huepft'));
    await warten(MEHR_ZEIT.paarSchritt);
  }
  return mwAktuell(nr);
}

async function mehrGetippt(i, btn) {
  const jetzt = performance.now();
  if (mw.gesperrt || mw.auftrag || jetzt - mw.letzterTipp < 400) return;
  mw.letzterTipp = jetzt;
  audio();
  clearTimeout(mw.timer);
  const nr = mw.nummer;
  const r = mwRunde();
  mw.gesperrt = true;
  mwTeller().forEach((t) => t.classList.remove('pulsiert'));
  if (i === r.ziel) {
    btn.classList.add('richtig');
    animieren(btn, 'huepft');
    glockenspiel();
    await warten(400);
    if (!(await mwAnsage(nr, `${r.frage}-hier`))) return;
    await warten(MEHR_ZEIT.pause);
    mehrWeiter(nr);
    return;
  }
  mw.versuche++;
  const ziel = mwTeller()[r.ziel];
  if (mw.versuche === 1) {
    // Daneben: „Schau mal!“, Paare bilden – dann die Frage nochmal (kein Wackeln: wirkte wie ein Kopfschütteln)
    if (!(await mwAnsage(nr, 'schau-mal'))) return;
    if (!(await mehrPaaren(nr))) return;
    await warten(300);
    mehrFragen(nr);
  } else if (mw.versuche === 2) {
    // Hilfe: beide Teller zählen, erst den mit weniger, dann den mit mehr
    if (mw.runde < 4) mw.mitHilfe++;
    const nachMenge = mwTeller().map((t, k) => [r.mengen[k], mwDinge(t)]).sort((a, b) => a[0] - b[0]);
    for (const [n, dinge] of nachMenge) {
      if (!(await mwZaehlen(nr, `zaehlen-${n}`, dinge))) return;
      await warten(500);
    }
    mwTeller().forEach((t) => mwDinge(t).forEach((d) => d.classList.remove('leuchtet')));
    mehrFragen(nr);
  } else {
    ziel.classList.add('richtig');
    animieren(ziel, 'huepft');
    if (!(await mwAnsage(nr, `${r.frage}-hier`))) return;
    await warten(MEHR_ZEIT.pause);
    mehrWeiter(nr);
  }
}

function mehrWeiter(nr) {
  if (!mwAktuell(nr)) return;
  mw.runde++;
  mwRundenZeichnen();
  if (mw.runde === 4) mehrLeichterWeiter();
  if (mw.runde < mw.runden.length) { mehrNeueRunde(); return; }
  glockenspiel();
  mehrAuftrag();
}

// Echte Welt am eigenen Körper: „Jetzt in echt!“ – „Zeig mir deine Augen!“ … „Und jetzt deine Nase!“ (das gemeinte
// Bild der kleinen Karte leuchtet); nach 👍 „Zeig mal!“ – „Zwei Augen und eine Nase. Da sind mehr Augen!“
async function mehrAuftrag() {
  mehrStoppen();
  const nr = mw.nummer;
  mw.auftrag = true;
  mw.fertig = false;
  $('#btn-mehr-daumen').hidden = true;
  mw.welt = mw.welt || zufall(Object.keys(MEHR_WELT));
  inEcht({ z: mw, nr, aktuell: mwAktuell, ansage: mwAnsage, buehne: $('#mehr-teller'), knopf: $('#btn-mehr-daumen'),
    karteHtml: MEHR_WELT[mw.welt].map(([bild]) => `<span class="karte-bild">${bild}</span>`).join(''),
    sagen: mehrAuftragSagen, zeit: MEHR_ZEIT });
}

// „Zeig mir deine Augen!“ – Zeit zum Zeigen – „Und jetzt deine Nase!“; das gemeinte Bild leuchtet
async function mehrAuftragSagen(nr) {
  const bilder = [...document.querySelectorAll('#mehr-teller .karte-bild')];
  for (const [i, [, ansageName]] of MEHR_WELT[mw.welt].entries()) {
    bilder.forEach((b, k) => b.classList.toggle('leuchtet', k === i));
    if (!(await mwAnsage(nr, ansageName))) return false;
    await warten(i === 0 ? MEHR_ZEIT.zeigen : 0);
  }
  bilder.forEach((b) => b.classList.remove('leuchtet'));
  return mwAktuell(nr);
}

async function mehrAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(mw, $('#btn-mehr-daumen'));
  if (!karte) return;
  if (!(await mwAnsage(nr, 'zeig-mal'))) return;
  const erstes = karte.querySelector('.karte-bild');
  if (erstes) erstes.classList.add('leuchtet');
  if (!(await mwAnsage(nr, `welt-${mw.welt}-fertig`))) return;
  glockenspiel();
  await warten(400);
  if (!mwAktuell(nr)) return;
  mw.letztesEnde = zufall(MEHR_ENDE.filter((e) => e !== mw.letztesEnde));
  if (!(await mwAnsage(nr, mw.letztesEnde))) return;
  spielEnde('mehr', mehrNeu);
}

$('#btn-mehr-daumen').addEventListener('click', () => { audio(); if (mw.inEcht) mehrAuftragErledigt(mw.nummer); });

function mehrNeu() {
  mehrStoppen();
  Object.assign(mw, { runde: 0, runden: mehrRundenPlanen(), fertig: false, auftrag: false, welt: null, mitHilfe: 0, inEcht: false });
  $('#btn-mehr-daumen').hidden = true;
  mwRundenZeichnen();
  mehrNeueRunde();
}

function mehrStarten() {
  spielEndeWeg('mehr');
  zeigen('mehr');
  mehrNeu();
}
SPIELE.mehr = mehrStarten;

$('#btn-mehr-home').addEventListener('click', () => { mehrStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: Frage (bzw. Auftrag) nochmal; die Teller bleiben, wie sie sind; während die App spricht oder zählt: nichts
$('#btn-mehr-laut').addEventListener('click', () => {
  const ende = $('#mehr .spiel-ende');
  if ((ende && !ende.hidden) || mw.fertig || mw.gesperrt) return;
  audio();
  if (mw.inEcht) { inEchtNochmal(mw); return; }
  clearTimeout(mw.timer);
  mw.nummer++;
  mehrFragen(mw.nummer);
});

// ---------- In den Korb zählen: Dinge in den Korb schieben, jedes Ankommen zählt ----------

// „Leg drei Äpfel in den Korb.“ – Auftrag als Punktkarte (keine Ziffer), Vorrat immer 2 mehr als gesucht. Beim Ankommen
// sagt die App die neue Zahl („eins“ … „zwei“ – einzelne Wörter, das Kind bestimmt das Tempo); sind es genug, ist die
// Runde von selbst fertig: alle leuchten, „Drei Äpfel!“. Mehr als gesucht passt nicht hinein. Herausnehmen geht.
// Daneben losgelassen bleibt liegen (kein Zurückspringen). Kein „falsch“: Ein „Versuch“ ist eine Weile ohne Ankommen –
// 1 = Auftrag nochmal (Karte pulsiert), 2 = mitzählen + eine Hand zeigt den Weg, 3 = die App legt den Rest hinein.
// Eltern-Schalter je Kind: Mengen bis 5 (sonst 1–3), Antippen statt Schieben.
const KORB_RUNDEN = 4;
const KORB_ZEIT = { versuch: 12000, fertigPause: 600, rundenPause: 900, loesungSchritt: 700, daumen: 2500,
  auftragNochmal: 12000, vormachenPause: 900 };
// Echte Welt: eigene Zeichnungen (Emoji 🧱 wäre ein Ziegelstein, 🥤 ein Becher mit Strohhalm): [Baustein, Becher]
const KORB_WELT = [
  '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="14" y="40" width="72" height="42" rx="6" fill="#d23c2c" stroke="#4a3f35" stroke-width="4"/>'
    + '<rect x="22" y="26" width="20" height="16" rx="4" fill="#d23c2c" stroke="#4a3f35" stroke-width="4"/>'
    + '<rect x="58" y="26" width="20" height="16" rx="4" fill="#d23c2c" stroke="#4a3f35" stroke-width="4"/></svg>',
  // Becher in zwei Ebenen: hinten die Öffnung, vorn Körper mit vorderem Rand – die Bausteine liegen dazwischen
  { hinten: '<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="22" rx="26" ry="7" fill="#3f6f93" stroke="#4a3f35" stroke-width="4"/></svg>',
    vorn: '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M24 22 A26 7 0 0 0 76 22 L68 86 Q50 92 32 86 Z" fill="#7fb3d5" stroke="#4a3f35" stroke-width="4" stroke-linejoin="round"/></svg>' },
];
const kb = { runde: 0, runden: [], dinge: [], imKorb: [], versuche: 0, gesperrt: true, timer: null, nummer: 0,
  ziehen: null, mass: null, auftrag: false, fertig: false, weltMenge: 0,
  letztesAnkommen: 0, sprech: { kette: Promise.resolve(), offen: 0 }, tipps: 0, hilfeLaeuft: false };
const kbBausteine = spielBausteine('korb', kb);
const { aktuell: kbAktuell, ansage: kbAnsage, zaehlen: kbZaehlen } = kbBausteine;
const kbRunde = () => kb.runden[kb.runde];

function korbStoppen() {
  kbBausteine.stoppen();
  if (kb.ziehen) { kb.ziehen.d.el.classList.remove('greift'); kb.ziehen = null; }
}

// 4 Runden, nie zweimal dieselbe Menge hintereinander; Ding wechselt
function korbRundenPlanen() {
  const mengen = zustand.korbBis5 ? [3, 4, 5] : [1, 2, 3];
  const plan = [];
  let ding = null;
  for (let i = 0; i < KORB_RUNDEN; i++) {
    const n = zufall(mengen.filter((m) => !plan.length || m !== plan[plan.length - 1].n));
    ding = zufall(Object.keys(DINGE).filter((d) => d !== ding));
    plan.push({ n, ding });
  }
  return plan;
}

// Maße aus der Größe der Spielfläche: hochkant Vorrat oben, Karte, Korb unten; quer Vorrat links, Karte + Korb rechts.
// Dinge 84 px (kleiner, wenn es nicht passt), Abstand 0,29 × Größe (24 px) – auch im Korb; Korb 4,0 × 2,9 Dinge.
function korbMasse(vorrat) {
  const feld = $('#korb-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const quer = W > H * 1.25;
  const reihen = Math.ceil(vorrat / 3);
  const S = Math.floor(quer
    ? Math.min(84, (H - 32) / (reihen * 1.29), (H - 56) / 4.1, W / 2 / 4.3)
    : Math.min(84, W / 4.5, (H - 56) / (reihen * 1.29 + 4.7)));
  const g = Math.round(S * 0.29);
  const kw = Math.round(S * 4.0), kh = Math.round(S * 2.9);
  const unten = Math.max(40, H * 0.05);
  const m = { W, H, quer, S, g, kw, kh };
  const vorratBreit = 3 * S + 2 * g;
  if (quer) {
    m.vorratX = W / 4 - vorratBreit / 2;
    m.vorratY = (H - (reihen * S + (reihen - 1) * g)) / 2;
    m.kx = W * 0.75 - kw / 2;
    m.ky = H - kh - Math.min(unten, H * 0.08);
    m.karte = { x: W * 0.75 - S * 0.55, y: Math.max(8, m.ky - S * 1.3), s: Math.round(S * 1.1) };
    m.fang = { l: Math.max(W / 2, m.kx - kw * 0.25), r: Math.min(W, m.kx + kw * 1.25), o: m.ky - kh * 0.25, u: H };
  } else {
    m.vorratX = (W - vorratBreit) / 2;
    m.vorratY = 16;
    m.kx = (W - kw) / 2;
    m.ky = H - kh - unten;
    const vorratUnten = m.vorratY + reihen * S + (reihen - 1) * g;
    m.karte = { x: W / 2 - S * 0.55, y: (vorratUnten + m.ky) / 2 - S * 0.55, s: Math.round(S * 1.1) };
    m.fang = { l: m.kx - kw * 0.25, r: m.kx + kw * 1.25, o: Math.max(vorratUnten + 4, m.ky - kh * 0.25), u: H };
  }
  return m;
}

// Plätze im Korb: oben drei, unten zwei (Mitte), in Reihenfolge des Hineinlegens
function korbPlatz(i) {
  const { kx, ky, kw, kh } = kb.mass;
  const { S, g } = kb.mass;
  const schritt = S + g;   // gleicher Abstand wie im Vorrat
  const [sx, reihe] = [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1]][i];
  return [kx + kw / 2 + sx * schritt, ky + kh * (reihe ? 0.39 : 0.27)];
}
function vorratPlatz(i) {
  const { vorratX, vorratY, S, g } = kb.mass;
  return [vorratX + (i % 3) * (S + g) + S / 2, vorratY + Math.floor(i / 3) * (S + g) + S / 2];
}

function dingSetzen(d, x, y) {
  const { W, H, S } = kb.mass;
  d.x = Math.max(S / 2, Math.min(W - S / 2, x));
  d.y = Math.max(S / 2, Math.min(H - S / 2, y));
  d.el.style.transform = `translate(${d.x - S / 2}px, ${d.y - S / 2}px)`;
}

// Korb wie 🧺 (oben breiter, geflochten, großer Henkel – ein kleiner Griff sah aus wie ein Koffer), in zwei Ebenen
// wie der Becher: hinten Henkel und Öffnung (dunkles Inneres), vorn die geflochtene Seite mit vorderem Rand – die
// Dinge liegen dazwischen, ihr unterer Teil steckt im Korb
const KORB_SVG = {
  hinten: '<svg viewBox="0 0 300 200" aria-hidden="true">'
    + '<path d="M30 68 Q150 -70 270 68" fill="none" stroke="#9a6430" stroke-width="12" stroke-linecap="round"/>'
    + '<ellipse cx="150" cy="70" rx="136" ry="34" fill="#6e421e" stroke="#a8743a" stroke-width="12"/></svg>',
  vorn: '<svg viewBox="0 0 300 200" aria-hidden="true">'
    + '<path d="M14 70 A136 34 0 0 0 286 70 L256 190 Q150 202 44 190 Z" fill="#c98f4e" stroke="#7a4b20" stroke-width="5" stroke-linejoin="round"/>'
    + [130, 160].map((y) => `<path d="M${14 + (y - 70) * 0.25} ${y} Q150 ${y + 10} ${286 - (y - 70) * 0.25} ${y}" fill="none" stroke="#e8bd84" stroke-width="12"/>`).join('')
    + [70, 110, 150, 190, 230].map((x) => `<path d="M${x} ${70 + 34 * Math.sqrt(1 - ((x - 150) / 136) ** 2) + 4} L${150 + (x - 150) * 0.8} 194" stroke="#8a5526" stroke-width="4"/>`).join('')
    + '<path d="M14 70 A136 34 0 0 0 286 70" fill="none" stroke="#a8743a" stroke-width="12" stroke-linecap="round"/></svg>',
};

function korbKarteSvg(n) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${MEHR_STELLEN[n].map(([dx, dy]) => `<circle class="karte-punkt" cx="${
    50 + dx * 26}" cy="${50 + dy * 26}" r="10"/>`).join('')}</svg>`;
}

function korbKarteFuellen() {
  document.querySelectorAll('#korb-feld .karte-punkt').forEach((p, i) => p.classList.toggle('voll', i < kb.imKorb.length));
}

function kbRundenZeichnen() {
  $('#korb-runden').innerHTML = `<span class="gruppe">${
    Array.from({ length: KORB_RUNDEN }, (_, i) => `<span class="${i < kb.runde ? 'voll' : ''}"></span>`).join('')}</span>`;
}

// Alles neu anordnen (Rundenbeginn, Drehen des Geräts): Dinge im Korb auf ihre Plätze, die übrigen in den Vorrat
function korbAnordnen() {
  const feld = $('#korb-feld');
  if (!kb.dinge.length || !feld.clientWidth) return;
  kb.mass = korbMasse(kb.dinge.length);
  const { S, kx, ky, kw, kh, karte } = kb.mass;
  feld.querySelectorAll('.korb-korb').forEach((korbEl) => {
    Object.assign(korbEl.style, { left: `${kx}px`, top: `${ky}px`, width: `${kw}px`, height: `${kh}px` });
  });
  const karteEl = feld.querySelector('.korb-karte');
  Object.assign(karteEl.style, { left: `${karte.x}px`, top: `${karte.y}px`, width: `${karte.s}px`, height: `${karte.s}px` });
  const gegriffen = kb.ziehen && kb.ziehen.d;
  kb.dinge.forEach((d, i) => {
    d.el.style.width = `${S}px`;
    d.el.style.height = `${S}px`;
    if (!d.imKorb && d !== gegriffen) dingSetzen(d, ...vorratPlatz(i));
  });
  if (gegriffen) dingSetzen(gegriffen, gegriffen.x, gegriffen.y);   // in die neue Fläche holen
  korbPlaetzeSetzen();
  if (kb.ziehen) kb.ziehen.feld = feld.getBoundingClientRect();
}

// Nur die Dinge im Korb auf ihre Plätze (danebengelegte bleiben, wo sie sind)
function korbPlaetzeSetzen() {
  kb.imKorb.forEach((d, i) => { if (!(kb.ziehen && kb.ziehen.d === d)) dingSetzen(d, ...korbPlatz(i)); });
}
window.addEventListener('resize', () => { if ($('#korb').classList.contains('active') && !kb.auftrag) korbAnordnen(); });

async function korbNeueRunde() {
  korbStoppen();
  const nr = kb.nummer;
  const { n, ding } = kbRunde();
  kb.versuche = 0;
  kb.tipps = 0;
  kb.imKorb = [];
  kb.sprech = { kette: Promise.resolve(), offen: 0 };   // eigene Reihe je Runde (alte Wörter zählen nicht hinein)
  const feld = $('#korb-feld');
  feld.innerHTML = `<div class="korb-korb">${KORB_SVG.hinten}</div><div class="korb-korb korb-vorn">${KORB_SVG.vorn}</div>`
    + `<div class="korb-karte">${korbKarteSvg(n)}</div>`;
  kb.dinge = Array.from({ length: n + 2 }, () => {
    const el = document.createElement('div');
    el.className = 'korb-ding';
    el.innerHTML = `<svg viewBox="-25 -25 50 50" aria-hidden="true"><circle class="halo" r="23"/>${DINGE[ding]}</svg>`;
    el.style.transition = 'none';   // erscheinen gleich an ihrem Platz (nicht aus der Ecke heranfliegen)
    feld.appendChild(el);
    const d = { el, imKorb: false, x: 0, y: 0 };
    el.dinglein = d;
    return d;
  });
  korbAnordnen();
  void feld.offsetWidth;
  kb.dinge.forEach((d) => { d.el.style.transition = ''; });
  kb.gesperrt = false;   // greifen darf das Kind schon, während der Auftrag noch klingt
  kb.letztesAnkommen = Date.now();
  korbHilfeAbwarten(nr);
  kbAnsage(nr, `korb-leg-${n}-${ding}`);
}

// ----- Schieben mit dem Finger (nur der erste Finger zählt) -----

$('#korb-feld').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.korb-ding');
  if (!el || !el.dinglein) return;
  e.preventDefault();
  if (kb.ziehen || kb.gesperrt || kb.auftrag) return;
  audio();
  const d = el.dinglein;
  const feld = $('#korb-feld').getBoundingClientRect();
  kb.ziehen = { d, id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld, nr: kb.nummer };
  el.classList.add('greift');
  try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = kb.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  // Das Ding sitzt ~30 px über dem Finger, damit das Kind es sieht
  if (z.bewegt) dingSetzen(z.d, e.clientX - z.feld.left, e.clientY - z.feld.top - 30);
});

const imFang = (d) => {
  const { fang, kx, ky, kw, kh, karte } = kb.mass;
  // Auf der Punktkarte losgelassen: nicht in den Korb (die Karte liegt nah am Korb, besonders quer)
  if (d.x > karte.x && d.x < karte.x + karte.s && d.y > karte.y && d.y < karte.y + karte.s) return false;
  const drin = d.x >= fang.l && d.x <= fang.r && d.y >= fang.o && d.y <= fang.u;
  // Magnet: auch knapp neben dem Korb (bis 60 px) zählt
  const abstand = Math.hypot(Math.max(kx - d.x, 0, d.x - kx - kw), Math.max(ky - d.y, 0, d.y - ky - kh));
  return drin || abstand <= 60;
};

function korbLoslassen(e, abgebrochen) {
  const z = kb.ziehen;
  if (!z || e.pointerId !== z.id) return;
  kb.ziehen = null;
  const { d } = z;
  d.el.classList.remove('greift');
  if (z.nr !== kb.nummer || !kbAktuell(z.nr)) return;
  if (!z.bewegt) {
    // Antippen: mit Eltern-Schalter fliegt das Ding hinein; sonst hüpft es, und beim zweiten Tipp zeigt die Hand
    // einmal, dass man schieben muss (zählt nicht als Versuch)
    if (!abgebrochen && zustand.korbTippen && !d.imKorb && kb.imKorb.length < kbRunde().n) { korbEinlegen(d); return; }
    animieren(d.el, 'huepft');
    if (!abgebrochen && !d.imKorb && ++kb.tipps === 2 && !kb.hilfeLaeuft) korbHandZeigen(z.nr, d);
    return;
  }
  if (imFang(d) && !abgebrochen) {
    if (d.imKorb) { korbPlaetzeSetzen(); return; }
    if (kb.imKorb.length < kbRunde().n) { korbEinlegen(d); return; }
  }
  // Daneben (oder abgebrochen): bleibt liegen, wo es ist (nur nicht auf der Punktkarte); aus dem Korb genommen →
  // die übrigen rücken auf (kein Rückwärtszählen)
  if (d.imKorb && !imFang(d)) {
    d.imKorb = false;
    kb.imKorb = kb.imKorb.filter((x) => x !== d);
    korbKarteFuellen();
  }
  if (d.imKorb) korbPlaetzeSetzen(); else nichtAufDieKarte(d);
  korbPlaetzeSetzen();
}

// Ein abgelegtes Ding verdeckt nie die Punktkarte (sie zeigt, wie viele noch fehlen): sanft daneben rutschen
function nichtAufDieKarte(d) {
  const { karte, S } = kb.mass;
  const ueber = d.x + S / 2 > karte.x && d.x - S / 2 < karte.x + karte.s && d.y + S / 2 > karte.y && d.y - S / 2 < karte.y + karte.s;
  if (!ueber) return;
  const links = d.x < karte.x + karte.s / 2;
  const x = links ? karte.x - S / 2 - 6 : karte.x + karte.s + S / 2 + 6;
  dingSetzen(d, x, d.y);
  if (d.x + S / 2 > karte.x && d.x - S / 2 < karte.x + karte.s) dingSetzen(d, links ? karte.x + karte.s + S / 2 + 6 : karte.x - S / 2 - 6, d.y);
}
document.addEventListener('pointerup', (e) => korbLoslassen(e, false));
// Abbruch (Anruf, Wisch vom Rand) wie Loslassen: nichts soll ungezählt im Korb liegen bleiben
document.addEventListener('pointercancel', (e) => korbLoslassen(e, false));

// Ankommen: auf den nächsten freien Platz gleiten, Ring auf der Karte füllen, neue Zahl sagen; genug → Runde fertig
async function korbEinlegen(d) {
  const nr = kb.nummer;
  d.imKorb = true;
  kb.imKorb.push(d);
  dingSetzen(d, ...korbPlatz(kb.imKorb.length - 1));
  korbKarteFuellen();
  const k = kb.imKorb.length;
  kb.versuche = 0;   // es geht voran: die Hilfe beginnt von vorn
  kb.letztesAnkommen = Date.now();
  const fertig = k >= kbRunde().n;
  if (fertig) { kb.gesperrt = true; clearTimeout(kb.timer); }
  if (!fertig) korbHilfeAbwarten(nr);
  if (!(await korbZahlSagen(nr, k))) return;
  if (!fertig) return;
  await warten(KORB_ZEIT.fertigPause);
  korbRundeFertig(nr);
}

// Zahlwörter in einer Reihe: jedes Ankommen hört sein ganzes Wort, auch wenn das Kind schnell nachlegt
// (ist das Ding inzwischen wieder herausgenommen, wird die überholte Zahl nicht mehr gesagt)
function korbZahlSagen(nr, k) {
  const sp = kb.sprech;
  sp.offen++;
  sp.kette = sp.kette.then(() => (k <= kb.imKorb.length ? kbAnsage(nr, `korb-zahl-${k}`) : null))
    .finally(() => { sp.offen--; });
  return sp.kette.then(() => kbAktuell(nr));
}

async function korbRundeFertig(nr) {
  if (!kbAktuell(nr)) return;
  const { n, ding } = kbRunde();
  kb.imKorb.forEach((d) => d.el.classList.add('leuchtet'));
  kb.dinge.filter((d) => !d.imKorb).forEach((d) => d.el.classList.add('blass'));
  glockenspiel();
  await warten(300);
  if (!(await kbAnsage(nr, `korb-fertig-${n}-${ding}`))) return;
  kb.runde++;
  kbRundenZeichnen();
  await warten(KORB_ZEIT.rundenPause);
  if (!kbAktuell(nr)) return;
  if (kb.runde < KORB_RUNDEN) korbNeueRunde(); else korbAuftrag();
}

// ----- Hilfe ohne „falsch“: eine Weile kein Ankommen = ein Versuch -----

function korbHilfeAbwarten(nr) {
  clearTimeout(kb.timer);
  if (kb.versuche >= 3) return;
  const rest = KORB_ZEIT.versuch - (Date.now() - kb.letztesAnkommen);
  kb.timer = setTimeout(() => korbVersuch(nr), Math.max(50, rest));
}

async function korbVersuch(nr) {
  if (!kbAktuell(nr) || kb.gesperrt) return;
  // Das Kind schiebt gerade, die App spricht eine Zahl oder hilft schon: später nochmal schauen
  if (kb.ziehen || kb.sprech.offen || kb.hilfeLaeuft) { kb.timer = setTimeout(() => korbVersuch(nr), 1000); return; }
  // Inzwischen ist etwas angekommen: die Uhr läuft ab da
  if (Date.now() - kb.letztesAnkommen < KORB_ZEIT.versuch) { korbHilfeAbwarten(nr); return; }
  kb.versuche++;
  const { n, ding } = kbRunde();
  if (kb.versuche === 3) { korbLoesung(nr); return; }
  kb.hilfeLaeuft = true;
  if (kb.versuche === 1) {
    animieren($('#korb-feld .korb-karte'), 'pulsiert');
    await kbAnsage(nr, `korb-leg-${n}-${ding}`);
  } else {
    // Mitzählen, was schon drin ist, dann zeigt eine Hand den Weg vom Vorrat zum Korb
    if (kb.imKorb.length) await kbZaehlen(nr, `zaehlen-${kb.imKorb.length}`, kb.imKorb.map((d) => d.el));
    kb.imKorb.forEach((d) => d.el.classList.remove('leuchtet'));
    await korbHandZeigen(nr);
  }
  kb.hilfeLaeuft = false;
  if (!kbAktuell(nr) || kb.gesperrt) return;
  kb.letztesAnkommen = Date.now();   // nach der Hilfe wieder eine Weile Zeit
  korbHilfeAbwarten(nr);
}

// Eine helle Hand nimmt ein halb durchsichtiges Ding mit vom Vorrat in den Korb – zweimal (zeigt „festhalten und
// mitnehmen“); das echte Ding bleibt liegen, das Kind macht es dann selbst
async function korbHandZeigen(nr, d = kb.dinge.find((x) => !x.imKorb)) {
  if (!d) return kbAktuell(nr);
  const { S, kx, ky, kw, kh } = kb.mass;
  const geist = document.createElement('div');
  geist.className = 'geist-hand';
  geist.innerHTML = `<div class="geist-ding" style="width:${S}px;height:${S}px">${d.el.innerHTML}</div><span>👆</span>`;
  $('#korb-feld').appendChild(geist);
  for (let i = 0; i < 2 && kbAktuell(nr); i++) {
    geist.style.transition = 'none';
    geist.style.opacity = '0';
    geist.style.transform = `translate(${d.x - S / 2}px, ${d.y - S / 2}px)`;
    void geist.offsetWidth;
    geist.style.transition = '';
    geist.style.opacity = '0.8';
    geist.style.transform = `translate(${kx + kw / 2 - S / 2}px, ${ky + kh * 0.4 - S / 2}px)`;
    await warten(1500);
    geist.style.opacity = '0';
    await warten(350);
  }
  geist.remove();
  return kbAktuell(nr);
}

// Lösung: die fehlenden Dinge fliegen ruhig nacheinander hinein, jedes mit seiner Zahl – dann wie sonst fertig
async function korbLoesung(nr) {
  kb.gesperrt = true;
  clearTimeout(kb.timer);
  while (kbAktuell(nr) && kb.imKorb.length < kbRunde().n) {
    const d = kb.dinge.find((x) => !x.imKorb);
    d.imKorb = true;
    kb.imKorb.push(d);
    dingSetzen(d, ...korbPlatz(kb.imKorb.length - 1));
    korbKarteFuellen();
    if (!(await korbZahlSagen(nr, kb.imKorb.length))) return;
    await warten(KORB_ZEIT.loesungSchritt);
  }
  korbRundeFertig(nr);
}

// ----- Echte Welt: „Leg zwei Bausteine in einen Becher!“ – 👍 für Erwachsene, dann zählt die App mit -----

// Echte Welt: erst vormachen („Leg drei Bausteine in einen Becher!“, die gezeichneten fliegen beim Zählen hinein),
// dann „Jetzt in echt!“ + Auftrag mit kleiner Karte (Punkte + Becher); nach 👍 „Zeig auf jeden Baustein!“ und die App zählt mit
async function korbAuftrag() {
  korbStoppen();
  const nr = kb.nummer;
  kb.auftrag = true;
  kb.fertig = false;
  $('#btn-korb-daumen').hidden = true;
  const n = kb.weltMenge || (kb.weltMenge = zufall([2, 3]));
  const feld = $('#korb-feld');
  feld.innerHTML = `<div class="korb-welt"><div class="welt-kloetze">${
    Array.from({ length: n }, () => `<div class="welt-klotz kommt">${KORB_WELT[0]}</div>`).join('')}</div>`
    + `<div class="welt-becher kommt"><div class="becher-hinten">${KORB_WELT[1].hinten}</div><div class="becher-vorn">${KORB_WELT[1].vorn}</div></div></div>`;
  if (!(await kbAnsage(nr, `korb-welt-${n}`))) return;
  // Ziel jedes Bausteins: in die Öffnung des Bechers, übereinander gestapelt – die obere Hälfte schaut heraus
  // (der Becher liegt davor), so sieht das Kind, dass sie drin sind
  const becher = $('#korb-feld .welt-becher').getBoundingClientRect();
  const kloetze = [...document.querySelectorAll('#korb-feld .welt-klotz')];
  kloetze.forEach((k, i) => {
    const r = k.getBoundingClientRect();
    k.classList.remove('kommt');   // Einblenden ist vorbei: sonst kann die alte Animation den Flug verhindern
    k.style.setProperty('--zx', `${becher.left + becher.width / 2 - (r.left + r.width / 2)}px`);
    k.style.setProperty('--zy', `${becher.top + becher.height * 0.27 - r.height * 0.3 * i - (r.top + r.height / 2)}px`);
  });
  if (!(await kbZaehlen(nr, `korb-welt-${n}-fertig`, kloetze))) return;
  await warten(KORB_ZEIT.vormachenPause);
  const becherKlein = `<span class="karte-becher">${KORB_WELT[1].hinten.replace('<svg', '<svg class="becher-h"')}${KORB_WELT[1].vorn}</span>`;
  inEcht({ z: kb, nr, aktuell: kbAktuell, ansage: kbAnsage, buehne: feld, knopf: $('#btn-korb-daumen'),
    karteHtml: korbKarteSvg(n) + becherKlein, sagen: (nr2) => kbAnsage(nr2, `korb-welt-${n}`), zeit: KORB_ZEIT });
}

async function korbAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(kb, $('#btn-korb-daumen'));
  if (!karte) return;
  if (!(await kbAnsage(nr, 'korb-zeig-jeden'))) return;
  if (!(await kbZaehlen(nr, `korb-welt-${kb.weltMenge}-fertig`, [...karte.querySelectorAll('.karte-punkt')]))) return;
  glockenspiel();
  await warten(400);
  if (!(await kbAnsage(nr, 'ende-korb'))) return;
  spielEnde('korb', korbNeu);
}

$('#btn-korb-daumen').addEventListener('click', () => { audio(); if (kb.inEcht) korbAuftragErledigt(kb.nummer); });

function korbNeu() {
  korbStoppen();
  Object.assign(kb, { runde: 0, runden: korbRundenPlanen(), auftrag: false, fertig: false, weltMenge: 0, dinge: [], imKorb: [], inEcht: false });
  $('#btn-korb-daumen').hidden = true;
  kbRundenZeichnen();
  korbNeueRunde();
}

function korbStarten() {
  spielEndeWeg('korb');
  zeigen('korb');
  korbNeu();
}
SPIELE.korb = korbStarten;

$('#btn-korb-home').addEventListener('click', () => { korbStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: Auftrag nochmal (nicht während das Kind schiebt oder die App spricht); laufende Zeiten bleiben
$('#btn-korb-laut').addEventListener('click', () => {
  const ende = $('#korb .spiel-ende');
  if ((ende && !ende.hidden) || kb.fertig || kb.gesperrt || kb.ziehen || kb.sprech.offen) return;
  audio();
  const nr = kb.nummer;
  if (kb.inEcht) { inEchtNochmal(kb); return; }
  const name = `korb-leg-${kbRunde().n}-${kbRunde().ding}`;
  // In der Runde: Auftrag nochmal, Schieben bleibt möglich, die Hilfe-Uhr läuft weiter
  animieren($('#korb-feld .korb-karte'), 'pulsiert');
  kbAnsage(nr, name);
});

// ---------- Zahlen-Trommel: so oft trommeln, wie gesagt wird ----------

// „Trommel dreimal!“ (nicht „hau“ – in Kita und Familie heißt es „Wir hauen nicht!“), Auftrag als Punktkarte. In der
// ersten Runde (und in der zweiten, wenn es Hilfe brauchte) trommelt die App vor: Schlegel, ganze Zählfolge „Eins, zwei,
// drei. Dreimal!“; solange die App trommelt oder spricht, bleibt die Trommel stumm (ein Schlag = ein Zahlwort).
// Ab „Jetzt du!“ zählt jeder Schlag (auch schon während des Satzes): „Bumm“ sofort, der Ring füllt sich, sobald seine
// Zahl gesagt wird (Wörter nacheinander, keins abgeschnitten). Nach dem letzten ruht die Trommel (weitertrommeln klingt
// leise, kein Fehler), dann „Dreimal!“. Schläge kurz hintereinander (< 0,3 s, auch zweiter Finger) zählen als einer.
// Kein Takt. Pause: gefüllte Punkte bleiben; 1 = „Trommel weiter!“ (nächster Ring pulsiert), 2 = „Wir trommeln
// zusammen!“ – die App gibt langsam den Takt, Schläge des Kindes zählen mit, sonst schlägt die App (= Lösung).
// Gar kein Schlag: „Trommel mal!“, dann einmal vortrommeln, dann wartet die Trommel sichtbar wach.
const TROMMEL_RUNDEN = 4;
const TROMMEL_ZEIT = { zittern: 300, pause: 5500, erinnern: 6000, nochmalVor: 8000, zusammenTakt: 1300, fertig: 400,
  rundenPause: 900, daumen: 2500, auftragNochmal: 12000, vormachenPause: 900 };
const TROMMEL_ENDE = ['ende-trommel'];
const tr = { runde: 0, runden: [], n: 0, schlaege: 0, phase: 'aus', letzter: 0, versuche: 0, gesperrt: true, timer: null,
  nummer: 0, sprech: { kette: Promise.resolve(), offen: 0 }, fertig: false, inEcht: false, weltMenge: 0, auftrag: false,
  letzterSchlag: 0, leiseLetzter: 0, hilfeGebraucht: false };
const trBausteine = spielBausteine('trommel', tr);
const { aktuell: trAktuell, ansage: trAnsage, zaehlen: trZaehlen } = trBausteine;

function trommelStoppen() {
  trBausteine.stoppen();
  tr.phase = 'aus';
}

// Tiefes „Bumm“ ohne Datei (weich ansetzen, sonst klickt es); Lautstärke fest begrenzt (leiser als die Stimme)
function bumm(laut = 0.4) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.25);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(Math.min(laut, 0.4), t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}

// Kurzes Klatschen ohne Datei (gefiltertes Rauschen)
function klatsch() {
  const ctx = audio();
  if (!ctx) return;
  const laenge = Math.floor(ctx.sampleRate * 0.08);
  const puffer = ctx.createBuffer(1, laenge, ctx.sampleRate);
  const daten = puffer.getChannelData(0);
  for (let i = 0; i < laenge; i++) daten[i] = (Math.random() * 2 - 1) * (1 - i / laenge) ** 3;
  const quelle = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = 'bandpass';
  filter.frequency.value = 1400;
  gain.gain.value = 0.4;
  quelle.buffer = puffer;
  quelle.connect(filter).connect(gain).connect(ctx.destination);
  quelle.start();
}

// 4 Runden, nie zweimal dieselbe Menge hintereinander; mit „bis 5“ beginnt es mit der kleinsten (3)
function trommelRundenPlanen() {
  const mengen = zustand.trommelBis5 ? [3, 4, 5] : [1, 2, 3];
  const plan = zustand.trommelBis5 ? [3] : [];
  while (plan.length < TROMMEL_RUNDEN) plan.push(zufall(mengen.filter((m) => !plan.length || m !== plan[plan.length - 1])));
  return plan;
}

const trRinge = () => [...document.querySelectorAll('#trommel-feld .trommel-karte .karte-punkt')];
const trTrommel = () => $('#trommel-feld .trommel-btn');
const SCHLEGEL_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M92 8 L30 70" stroke="#9a6430" stroke-width="9" stroke-linecap="round"/>'
  + '<circle cx="24" cy="76" r="15" fill="#d23c2c" stroke="#4a3f35" stroke-width="4"/></svg>';
// Eigene Trommel ohne Stöcke (beim Emoji 🥁 wollten Kinder die gemalten Stöcke greifen)
const TROMMEL_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true">'
  + '<path d="M14 40 L14 72 Q50 90 86 72 L86 40 Z" fill="#d23c2c" stroke="#4a3f35" stroke-width="3.5" stroke-linejoin="round"/>'
  + '<path d="M14 44 L32 76 L50 46 L68 78 L86 44" fill="none" stroke="#fde26c" stroke-width="3" stroke-linejoin="round"/>'
  + '<path d="M14 72 Q50 90 86 72" fill="none" stroke="#7fb3d5" stroke-width="5"/>'
  + '<ellipse cx="50" cy="40" rx="36" ry="12" fill="#fff6e0" stroke="#7fb3d5" stroke-width="5"/></svg>';

function trRundenZeichnen() {
  $('#trommel-runden').innerHTML = `<span class="gruppe">${
    Array.from({ length: TROMMEL_RUNDEN }, (_, i) => `<span class="${i < tr.runde ? 'voll' : ''}"></span>`).join('')}</span>`;
}

function trTrommelZustand(zustandName) {
  const t = trTrommel();
  if (!t) return;
  t.classList.toggle('wach', zustandName === 'wach');
  t.classList.toggle('ruht', zustandName === 'ruht');
  t.classList.remove('wartet');
}

function trAnimation(el, klasse) {
  if (!el) return;
  el.classList.remove('schlag', 'aufwachen', 'wackelt', 'schlaegt', 'klatscht', 'zuckt');
  void el.offsetWidth;
  el.classList.add(klasse);
}

// Die App trommelt vor: ganze Zählfolge „Eins, zwei, drei. Dreimal!“, bei jeder Zahl schlägt der Schlegel
async function trVortrommeln(nr) {
  tr.phase = 'vor';
  const schlegel = $('#trommel-feld .schlegel');
  schlegel.classList.add('da');
  const ok = await trZaehlen(nr, `trommel-vor-${tr.n}`, trRinge(), () => {
    bumm(0.35);
    trAnimation(schlegel, 'schlaegt');
    trAnimation(trTrommel(), 'schlag');
  });
  schlegel.classList.remove('da');
  await warten(500);
  trRinge().forEach((r) => r.classList.remove('leuchtet'));
  return ok && trAktuell(nr);
}

async function trommelNeueRunde() {
  trommelStoppen();
  const nr = tr.nummer;
  tr.n = tr.runden[tr.runde];
  tr.schlaege = 0;
  tr.versuche = 0;
  tr.sprech = { kette: Promise.resolve(), offen: 0 };
  const feld = $('#trommel-feld');
  feld.innerHTML = `<div class="trommel-karte">${korbKarteSvg(tr.n)}</div>`
    + `<div class="trommel-wrap"><button class="trommel-btn" aria-label="Trommel">${TROMMEL_SVG}</button><div class="schlegel">${SCHLEGEL_SVG}</div></div>`;
  trTrommel().addEventListener('pointerdown', trommelGeschlagen);
  // Der pulsierende Ring lädt zum Antippen ein: ein Tipp auf die Karte zählt wie ein Schlag
  $('#trommel-feld .trommel-karte').addEventListener('pointerdown', trommelGeschlagen);
  tr.phase = 'aus';
  if (!(await trAnsage(nr, `trommel-hau-${tr.n}`))) return;
  if (tr.runde === 0 || (tr.runde === 1 && tr.hilfeGebraucht)) {
    if (!(await trAnsage(nr, 'trommel-hoerzu'))) return;
    if (!(await trVortrommeln(nr))) return;
  }
  trKindIstDran(nr, 'trommel-jetzt-du');
}

// Ab jetzt zählt jeder Schlag – schon während des Satzes (viele Kinder legen sofort los; ein Schlag bricht ihn ab)
function trKindIstDran(nr, satz = null) {
  tr.phase = 'kind';
  tr.gesperrt = false;
  tr.letzter = Date.now();
  trTrommelZustand('wach');
  trAnimation(trTrommel(), 'aufwachen');
  trHilfeAbwarten(nr);
  if (satz) trAnsage(nr, satz);
}

// Ein Schlag (Finger auf Trommel oder Karte); kurz hintereinander zählt als einer
function trommelGeschlagen(e) {
  e.preventDefault();
  audio();
  const jetzt = performance.now();
  if (tr.phase === 'kind' || tr.phase === 'zusammen') {
    if (jetzt - tr.letzterSchlag < TROMMEL_ZEIT.zittern) return;
    tr.letzterSchlag = jetzt;
    trSchlagZaehlen(tr.nummer, false);
    return;
  }
  if (tr.phase === 'ruht') {
    // Nach der Zahl: leise, nichts wird gezählt (kein Fehler)
    if (jetzt - tr.leiseLetzter > TROMMEL_ZEIT.zittern) { tr.leiseLetzter = jetzt; bumm(0.1); trAnimation(trTrommel(), 'schlag'); }
    return;
  }
  // Die App trommelt vor oder spricht: stumm, die Trommel zuckt nur (sonst hört das Kind mehr Schläge als Zahlen)
  trAnimation(trTrommel(), 'zuckt');
}

// Ein gezählter Schlag (vom Kind oder beim gemeinsamen Trommeln von der App)
function trSchlagZaehlen(nr, vonApp) {
  if (tr.schlaege >= tr.n) return;
  tr.schlaege++;
  if (tr.schlaege === 1) tr.versuche = 0;   // es geht los: Hilfe beginnt von vorn
  tr.letzter = Date.now();
  bumm(vonApp ? 0.35 : 0.4);
  trAnimation(trTrommel(), 'schlag');
  if (vonApp) trAnimation($('#trommel-feld .schlegel'), 'schlaegt');
  const k = tr.schlaege;
  trRinge().forEach((r) => r.classList.remove('pulsiert'));
  const fertig = k >= tr.n;
  if (fertig) { tr.phase = 'ruht'; trTrommelZustand('ruht'); clearTimeout(tr.timer); }
  trZahlSagen(nr, k).then(async (ok) => {
    if (!ok || !fertig) return;
    await warten(TROMMEL_ZEIT.fertig);
    trRundeFertig(nr);
  });
  if (!fertig && tr.phase === 'kind') trHilfeAbwarten(nr);
}

// Zahlwörter nacheinander (keins wird abgeschnitten); der Ring füllt sich, wenn seine Zahl gesagt wird
function trZahlSagen(nr, k) {
  const sp = tr.sprech;
  sp.offen++;
  sp.kette = sp.kette.then(() => {
    const ring = trRinge()[k - 1];
    if (ring && trAktuell(nr)) ring.classList.add('voll');
    return trAnsage(nr, `korb-zahl-${k}`);
  }).finally(() => { sp.offen--; });
  return sp.kette.then(() => trAktuell(nr));
}

async function trRundeFertig(nr) {
  if (!trAktuell(nr) || tr.rundeFertig === nr) return;
  tr.rundeFertig = nr;
  tr.gesperrt = true;
  trRinge().forEach((r) => r.classList.add('leuchtet'));
  glockenspiel();
  await warten(300);
  if (!(await trAnsage(nr, `trommel-fertig-${tr.n}`))) return;
  tr.runde++;
  trRundenZeichnen();
  await warten(TROMMEL_ZEIT.rundenPause);
  if (!trAktuell(nr)) return;
  if (tr.runde < TROMMEL_RUNDEN) { trommelNeueRunde(); return; }
  // Ruhiger Ausklang, bevor es in die echte Welt geht: die Trommel wird blass, ein letztes leises Bumm
  trTrommelZustand('ruht');
  trTrommel().classList.add('schlaeft');
  bumm(0.15);
  if (!(await trAnsage(nr, 'trommel-schlaeft'))) return;
  await warten(600);
  if (trAktuell(nr)) trommelAuftrag();
}

// Hilfe: eine Pause ist ein „Versuch“ (gefüllte Punkte bleiben stehen)
const trWartezeit = () => (tr.schlaege === 0 ? (tr.versuche ? TROMMEL_ZEIT.nochmalVor : TROMMEL_ZEIT.erinnern) : TROMMEL_ZEIT.pause);

function trHilfeAbwarten(nr) {
  clearTimeout(tr.timer);
  if (tr.schlaege === 0 && tr.versuche >= 2) {
    // nach Erinnern und einmal Vortrommeln: still warten, die Trommel bleibt sichtbar wach
    trTrommel().classList.add('wartet');
    return;
  }
  tr.timer = setTimeout(() => trVersuch(nr), Math.max(50, trWartezeit() - (Date.now() - tr.letzter)));
}

async function trVersuch(nr) {
  if (!trAktuell(nr) || tr.phase !== 'kind') return;
  if (tr.sprech.offen) { tr.timer = setTimeout(() => trVersuch(nr), 500); return; }
  if (Date.now() - tr.letzter < trWartezeit()) { trHilfeAbwarten(nr); return; }
  tr.versuche++;
  tr.hilfeGebraucht = true;
  if (tr.schlaege === 0) {
    if (tr.versuche === 1) {
      trAnimation(trTrommel(), 'wackelt');
      trKindIstDran(nr, 'trommel-erinnerung');   // Schläge zählen schon während „Trommel mal!“
      return;
    }
    tr.phase = 'app';
    trTrommelZustand('');
    if (!(await trAnsage(nr, 'trommel-hoerzu'))) return;
    if (!(await trVortrommeln(nr))) return;
    trKindIstDran(nr, 'trommel-jetzt-du');
    return;
  }
  if (tr.versuche === 1) {
    // „Trommel weiter!“ – der nächste leere Ring pulsiert; Schläge zählen schon während des Satzes
    trAnimation(trTrommel(), 'wackelt');
    trRinge()[tr.schlaege].classList.add('pulsiert');
    trKindIstDran(nr, 'trommel-weiter');
    return;
  }
  // „Wir trommeln zusammen!“ – die App gibt langsam den Takt; schlägt das Kind, zählt sein Schlag, sonst schlägt die App
  tr.phase = 'app';
  trRinge().forEach((r) => r.classList.remove('pulsiert'));
  if (!(await trAnsage(nr, 'trommel-zusammen'))) return;
  const schlegel = $('#trommel-feld .schlegel');
  schlegel.classList.add('da');
  tr.phase = 'zusammen';
  trTrommelZustand('wach');
  while (tr.schlaege < tr.n && trAktuell(nr)) {
    const vorher = tr.schlaege;
    await warten(TROMMEL_ZEIT.zusammenTakt);
    if (!trAktuell(nr)) return;
    if (tr.schlaege === vorher) trSchlagZaehlen(nr, true);
  }
  if (!trAktuell(nr)) return;
  schlegel.classList.remove('da');
}

// ----- Echte Welt: „Klatsch dreimal in die Hände!“ – vormachen (Hände klatschen), dann in echt, nach 👍 mitklatschen -----

async function trommelAuftrag() {
  trommelStoppen();
  const nr = tr.nummer;
  tr.auftrag = true;
  tr.fertig = false;
  $('#btn-trommel-daumen').hidden = true;
  const n = tr.weltMenge || (tr.weltMenge = zufall([2, 3]));
  const feld = $('#trommel-feld');
  feld.innerHTML = '<div class="klatsch-haende" aria-hidden="true">👏</div>';
  if (!(await trAnsage(nr, `trommel-welt-${n}`))) return;
  const haende = $('#trommel-feld .klatsch-haende');
  const takte = Array.from({ length: n }, () => document.createElement('span'));
  if (!(await trZaehlen(nr, `trommel-welt-${n}-fertig`, takte, () => { klatsch(); trAnimation(haende, 'klatscht'); }))) return;
  await warten(TROMMEL_ZEIT.vormachenPause);
  inEcht({ z: tr, nr, aktuell: trAktuell, ansage: trAnsage, buehne: feld, knopf: $('#btn-trommel-daumen'),
    karteHtml: `${korbKarteSvg(n)}<span class="karte-bild">👏</span>`, sagen: (nr2) => trAnsage(nr2, `trommel-welt-${n}`),
    zeit: TROMMEL_ZEIT });
}

async function trommelAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(tr, $('#btn-trommel-daumen'));
  if (!karte) return;
  if (!(await trAnsage(nr, 'trommel-klatsch-mit'))) return;
  if (!(await trZaehlen(nr, `trommel-welt-${tr.weltMenge}-fertig`, [...karte.querySelectorAll('.karte-punkt')], () => klatsch()))) return;
  glockenspiel();
  await warten(400);
  if (!(await trAnsage(nr, zufall(TROMMEL_ENDE)))) return;
  spielEnde('trommel', trommelNeu);
}

$('#btn-trommel-daumen').addEventListener('click', () => { audio(); if (tr.inEcht) trommelAuftragErledigt(tr.nummer); });

function trommelNeu() {
  trommelStoppen();
  Object.assign(tr, { runde: 0, runden: trommelRundenPlanen(), fertig: false, auftrag: false, weltMenge: 0, inEcht: false,
    hilfeGebraucht: false });
  $('#btn-trommel-daumen').hidden = true;
  trRundenZeichnen();
  trommelNeueRunde();
}

function trommelStarten() {
  spielEndeWeg('trommel');
  zeigen('trommel');
  trommelNeu();
}
SPIELE.trommel = trommelStarten;

$('#btn-trommel-home').addEventListener('click', () => { trommelStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: Auftrag nochmal (nur wenn das Kind dran ist und keine Zahl läuft; Punkte bleiben, die Hilfe-Uhr beginnt neu)
$('#btn-trommel-laut').addEventListener('click', () => {
  const ende = $('#trommel .spiel-ende');
  if ((ende && !ende.hidden) || tr.fertig) return;
  audio();
  if (tr.inEcht) { inEchtNochmal(tr); return; }
  if (tr.phase !== 'kind' || tr.sprech.offen) return;
  tr.letzter = Date.now();
  trHilfeAbwarten(tr.nummer);
  trAnsage(tr.nummer, `trommel-hau-${tr.n}`);
});

// ---------- Hol mir …: echte Dinge holen und zusammen zählen ----------

// Ganz echte Welt: „Hol mir zwei Löffel!“ – der Bildschirm ist sofort ruhig (Karte: Punkte + Ding, 👐; die Punkte
// leuchten einmal still nacheinander). Das Kind holt die Dinge, ein Erwachsener tippt 👍: „Leg sie hin!“ – „Zeig auf
// jeden Löffel!“ – die App zählt langsam mit (Karte leuchtet) – „Danke! Bring sie wieder zurück.“ 2 Runden. Keine
// Zeitgrenze; falsche Anzahl ist kein Fehler (das gemeinsame Zählen zeigt es). Je Kind: welche Dinge, Mengen 3 bis 5.
const HOL_RUNDEN = 2;
// 👍 erst nach 8 s (holen dauert ohnehin; sonst tippt ein Kind ihn, bevor es etwas geholt hat)
const HOL_ZEIT = { daumen: 8000, auftragNochmal: 14000, hinlegen: 3000, hinlegenViele: 4000, selbstZaehlen: 1200, rundenPause: 800 };
// Dinge: deutliche Zeichnungen (ein gerader Löffel sah aus wie ein Lutscher, ein Becher ohne Henkel wie ein Eimer);
// fw = Fürwort für „Leg ihn/es hin!“
const HOL_DINGE = {
  loeffel: { option: 'holLoeffel', fw: 'ihn', svg: '<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(35 50 50)">'
    + '<path d="M45 52 L43 90 Q50 96 57 90 L55 52 Z" fill="#d9dde3" stroke="#4a3f35" stroke-width="4" stroke-linejoin="round"/>'
    + '<ellipse cx="50" cy="30" rx="16" ry="22" fill="#d9dde3" stroke="#4a3f35" stroke-width="4"/>'
    + '<ellipse cx="50" cy="31" rx="9" ry="14" fill="#b7bdc6"/><ellipse cx="45" cy="24" rx="3" ry="6" fill="#fff"/></g></svg>' },
  becher: { option: 'holBecher', fw: 'ihn', svg: '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + '<path d="M70 38 Q90 38 88 56 Q86 72 66 70" fill="none" stroke="#4a3f35" stroke-width="10" stroke-linecap="round"/>'
    + '<path d="M70 38 Q90 38 88 56 Q86 72 66 70" fill="none" stroke="#7fb3d5" stroke-width="4" stroke-linecap="round"/>'
    + '<path d="M20 24 L26 84 Q46 92 66 84 L72 24 Z" fill="#7fb3d5" stroke="#4a3f35" stroke-width="4" stroke-linejoin="round"/>'
    + '<ellipse cx="46" cy="24" rx="26" ry="7" fill="#3f6f93" stroke="#4a3f35" stroke-width="4"/></svg>' },
  baustein: { option: 'holBaustein', fw: 'ihn', svg: KORB_WELT[0] },
  kuscheltier: { option: 'holKuscheltier', fw: 'es', svg: '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="#c98f4e" stroke="#4a3f35" stroke-width="4">'
    + '<circle cx="30" cy="22" r="10"/><circle cx="70" cy="22" r="10"/><ellipse cx="50" cy="74" rx="24" ry="20"/><circle cx="50" cy="40" r="22"/></g>'
    + '<ellipse cx="50" cy="47" rx="9" ry="7" fill="#f0d2a8"/><circle cx="42" cy="35" r="3" fill="#4a3f35"/><circle cx="58" cy="35" r="3" fill="#4a3f35"/>'
    + '<circle cx="50" cy="45" r="3" fill="#4a3f35"/></svg>' },
};
const hl = { runde: 0, runden: [], gesperrt: true, timer: null, nummer: 0, fertig: false, inEcht: false, wartetZurueck: false };
const hlBausteine = spielBausteine('hol', hl);
const { aktuell: hlAktuell, ansage: hlAnsage, zaehlen: hlZaehlen } = hlBausteine;

function holStoppen() {
  hlBausteine.stoppen();
  hl.wartetZurueck = false;
  bildschirmWachFrei();
}

// Bildschirm wach halten, solange das Kind unterwegs ist (sonst wird er dunkel, bevor es zurück ist)
let bildschirmWach = null;
async function bildschirmWachHalten() {
  try { if (!bildschirmWach && navigator.wakeLock) bildschirmWach = await navigator.wakeLock.request('screen'); } catch { /* egal */ }
}
function bildschirmWachFrei() {
  try { if (bildschirmWach) bildschirmWach.release(); } catch { /* egal */ }
  bildschirmWach = null;
}

// 2 Runden: verschiedene Dinge (wenn mehrere an sind), nie zweimal dieselbe Menge; mit „bis 5“: 3–5
function holRundenPlanen() {
  const dinge = Object.keys(HOL_DINGE).filter((d) => zustand[HOL_DINGE[d].option]);
  const auswahl = dinge.length ? dinge : Object.keys(HOL_DINGE);
  const mengen = zustand.holBis5 ? [3, 4, 5] : [1, 2, 3];
  const plan = [];
  const erste = zustand.holBis5 ? 3 : 2;   // leicht beginnen
  const ersteDinge = mischen(auswahl);
  for (let i = 0; i < HOL_RUNDEN; i++) {
    const n = i === 0 ? erste : zufall(mengen.filter((m) => m !== plan[i - 1].n));
    plan.push({ n, ding: ersteDinge[i % ersteDinge.length] });
  }
  return plan;
}

function hlRundenZeichnen() {
  $('#hol-runden').innerHTML = `<span class="gruppe">${
    Array.from({ length: HOL_RUNDEN }, (_, i) => `<span class="${i < hl.runde ? 'voll' : ''}"></span>`).join('')}</span>`;
}

async function holNeueRunde() {
  holStoppen();
  const nr = hl.nummer;
  hl.fertig = false;
  $('#btn-hol-daumen').hidden = true;
  const { n, ding } = hl.runden[hl.runde];
  const auftrag = (nr2) => hlAnsage(nr2, `hol-${n}-${ding}`);
  const bild = `<span class="karte-ding">${HOL_DINGE[ding].svg}</span>`;
  // Bei 1–3: die Dinge selbst, so viele wie gesucht (konkret vor abstrakt); bei 4–5: Punkte + ein Ding
  const karteHtml = n <= 3 ? `<span class="karte-dinge">${bild.repeat(n)}</span>` : korbKarteSvg(n) + bild;
  bildschirmWachHalten();
  inEcht({ z: hl, nr, aktuell: hlAktuell, ansage: hlAnsage, buehne: $('#hol-feld'), knopf: $('#btn-hol-daumen'),
    karteHtml, sagen: auftrag, zeit: HOL_ZEIT, einleitung: false, karteKlasse: 'gross' });
  // Die Dinge (bzw. Punkte) leuchten einmal still nacheinander – zeigt „so viele“, ohne vorzuzählen
  const teile = [...document.querySelectorAll(n <= 3 ? '#hol-feld .karte-dinge .karte-ding' : '#hol-feld .karte-punkt')];
  teile.forEach((p, i) => setTimeout(() => hlAktuell(nr) && !hl.fertig && p.classList.add('leuchtet'), 400 + i * 450));
  setTimeout(() => hlAktuell(nr) && !hl.fertig && teile.forEach((p) => p.classList.remove('leuchtet')), 400 + n * 450 + 900);
}

// Nach 👍: „Leg sie hin!“ – „Zeig auf jeden Löffel!“ – kurz Zeit zum Selbstzählen – die App zählt langsam mit (auf dem
// Bildschirm leuchtet dabei nichts: der Blick soll bei den echten Dingen bleiben) – „Danke! Bring sie wieder zurück.“
// Dann wartet die App auf ein zweites 👍 (zurückgebracht), erst dann kommt der nächste Auftrag bzw. das Ende –
// so ist das Aufräumen ein eigener Schritt, und das Kind verpasst unterwegs nichts.
async function holErledigt(nr) {
  const karte = inEchtBestaetigt(hl, $('#btn-hol-daumen'));
  if (!karte) return;
  const { n, ding } = hl.runden[hl.runde];
  const fw = HOL_DINGE[ding].fw;
  karte.querySelectorAll('.leuchtet').forEach((p) => p.classList.remove('leuchtet'));
  if (!(await hlAnsage(nr, n === 1 ? `hol-leg-hin-1-${fw}` : 'hol-leg-hin'))) return;
  await warten(n > 3 ? HOL_ZEIT.hinlegenViele : HOL_ZEIT.hinlegen);
  if (!(await hlAnsage(nr, n === 1 ? `hol-zeig-1-${ding}` : `hol-zeig-jeden-${ding}`))) return;
  await warten(HOL_ZEIT.selbstZaehlen);
  const takte = Array.from({ length: n }, () => document.createElement('span'));
  if (!(await hlZaehlen(nr, `hol-fertig-${n}-${ding}`, takte))) return;
  glockenspiel();
  await warten(400);
  if (!(await hlAnsage(nr, n === 1 ? `hol-zurueck-1-${fw}` : 'hol-zurueck'))) return;
  hl.wartetZurueck = true;
  $('#btn-hol-daumen').hidden = false;
}

// Zweites 👍: zurückgebracht → nächste Runde bzw. Ende
async function holZurueckGebracht(nr) {
  if (!hl.wartetZurueck) return;
  hl.wartetZurueck = false;
  $('#btn-hol-daumen').hidden = true;
  hl.runde++;
  hlRundenZeichnen();
  await warten(HOL_ZEIT.rundenPause);
  if (!hlAktuell(nr)) return;
  if (hl.runde < HOL_RUNDEN) { holNeueRunde(); return; }
  bildschirmWachFrei();
  if (!(await hlAnsage(nr, 'ende-hol'))) return;
  spielEnde('hol', holNeu);
}

$('#btn-hol-daumen').addEventListener('click', () => {
  audio();
  if (hl.wartetZurueck) holZurueckGebracht(hl.nummer);
  else if (hl.inEcht) holErledigt(hl.nummer);
});

function holNeu() {
  holStoppen();
  Object.assign(hl, { runde: 0, runden: holRundenPlanen(), fertig: false, inEcht: false });
  hlRundenZeichnen();
  holNeueRunde();
}

function holStarten() {
  spielEndeWeg('hol');
  zeigen('hol');
  holNeu();
}
SPIELE.holmir = holStarten;

$('#btn-hol-home').addEventListener('click', () => { holStoppen(); wiedergabeStoppen(); zurStartseite(); });
$('#btn-hol-laut').addEventListener('click', () => {
  const ende = $('#hol .spiel-ende');
  if ((ende && !ende.hidden) || !hl.inEcht || hl.wartetZurueck) return;
  audio();
  inEchtNochmal(hl);
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
  wortnestKnopfZeigen();
  // Mit Kindern stellt man das Regal beim Kind ein
  $('#karte-regal').hidden = kinder.length > 0;
  regalWahlZeichnen($('#spiele-wahl'), regalVon(appWeitAus()), (neu) => {
    speicher.schreiben('spieleAus', ausVon(neu));
    einstellungenLaden();
    elternZeichnen();
  });
  pauseWahlZeichnen();
  spielOptionenZeigen();
  document.querySelectorAll('#karte-regal [data-option]').forEach((box) => {
    box.checked = !!speicher.lesen(box.dataset.option, optionStandard(box.dataset.option));
  });
}

// Bei „Hol mir …“ bleibt mindestens ein Ding an (sonst gäbe es nichts zu holen)
const letztesDingAus = (box) => HOL_DINGE_OPTIONEN.includes(box.dataset.option) && !box.checked
  && ![...box.closest('.hol-dinge').querySelectorAll('input')].some((b) => b.checked);
document.querySelectorAll('#karte-regal [data-option]').forEach((box) => box.addEventListener('change', () => {
  if (letztesDingAus(box)) { box.checked = true; return; }
  speicher.schreiben(box.dataset.option, box.checked);
  einstellungenLaden();
}));
document.querySelectorAll('#kind [data-option]').forEach((box) => box.addEventListener('change', () => {
  if (letztesDingAus(box)) { box.checked = true; return; }
  kindAendern((k) => { k[box.dataset.option] = box.checked; });
}));

$('#btn-eltern-zurueck').addEventListener('click', zurStartseite);

// --- Kinder ---

function kinderListeZeichnen() {
  const box = $('#kinder-liste');
  box.innerHTML = '';
  kinder.forEach((k) => {
    // Beschreiben statt zählen: welche Spiele das Kind sieht (keine Punkte, nichts zum Vergleichen)
    const spiele = regalVon(k.spieleAus || START_AUS).filter((id) => SPIELE[id])
      .map((id) => $(`#home .spiel-btn[data-spiel="${id}"]`).innerHTML).join(' ');
    const zeile = document.createElement('button');
    zeile.className = 'kind-zeile';
    zeile.innerHTML = `<span class="kind-bild">${kindBildHtml(k)}</span>`
      + `<span class="w">${htmlText(k.name)}<br><small>${spiele ? `Spiele: ${spiele}` : 'Spiele kommen mit den nächsten Updates'}</small></span>`
      + '<span class="pfeil">✏️</span>';
    zeile.addEventListener('click', () => kindBearbeiten(k.id));
    box.appendChild(zeile);
  });
}

// Kind anlegen und speichern (Name schon geprüft); extra = z. B. Tier und Foto aus Wortnest
async function kindAnlegen(name, extra = {}) {
  const erstesKind = kinder.length === 0;
  const kind = {
    id: `k-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 20),
    tier: extra.tier || TIERE.find((t) => !kinder.some((k) => k.tier === t)) || TIERE[0],
    // Das erste Kind übernimmt das bisherige Regal
    spieleAus: erstesKind ? appWeitAus() : START_AUS,
    // Spiel-Schalter: das erste Kind übernimmt die app-weiten
    ...Object.fromEntries(SPIEL_OPTIONEN.map((o) => [o, erstesKind ? !!speicher.lesen(o, optionStandard(o)) : optionStandard(o)])),
    erstellt: Date.now(),
  };
  if (extra.foto) kind.foto = extra.foto;
  if (extra.wortnestId) kind.wortnestId = extra.wortnestId;
  await datenbank.kindSpeichern(kind);
  speicherSchuetzen();
  await kinderLaden();
  if (!aktivesKind()) { zustand.kind = kind.id; speicher.schreiben('kind', kind.id); einstellungenLaden(); }
  return kind;
}

// Neues Kind: Name abfragen, anlegen, Formular öffnen; gibt das Kind zurück (oder null bei Abbruch)
async function kindNeu() {
  const name = (prompt('Wie heißt das Kind?') || '').trim();
  if (!name) return null;
  const kind = await kindAnlegen(name);
  kindBearbeiten(kind.id);
  return kind;
}
$('#btn-kind-neu').addEventListener('click', kindNeu);

// --- Aus Wortnest übernehmen (Regeln: ../Kinder-Lernapp/docs/datenvertrag.md, Vertrag Version 1) ---
// Wortnests Datenbank „lernapp“ wird nur gelesen: ohne Versionsnummer geöffnet (löst nie ein Update aus); gibt es sie
// auf dem Gerät nicht, wird das Anlegen abgebrochen. Übernommen werden nur Name, Tier und Foto – geprüft wie beim
// Einspielen einer Sicherung (nur bekannte Felder, Name als Text, Foto nur als Bild).
function wortnestKinderLesen() {
  return new Promise((fertig) => {
    let req;
    try { req = indexedDB.open('lernapp'); } catch { fertig([]); return; }
    req.onupgradeneeded = () => req.transaction.abort();   // Wortnest gibt es hier nicht: nichts anlegen
    req.onerror = () => fertig([]);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();   // Wortnest will sich aktualisieren: sofort Platz machen
      try {
        const tx = db.transaction('kinder', 'readonly');
        const alle = tx.objectStore('kinder').getAll();
        tx.oncomplete = () => { db.close(); fertig(alle.result || []); };
        tx.onerror = () => { db.close(); fertig([]); };
      } catch { db.close(); fertig([]); }
    };
  });
}

function wortnestKindPruefen(k) {
  if (!k || typeof k.id !== 'string' || typeof k.name !== 'string') return null;
  const name = k.name.trim().slice(0, 20).replace(/[\s-]+$/, '');
  if (!name) return null;
  return {
    wortnestId: k.id.slice(0, 40),
    name,
    tier: TIERE.includes(k.tier) ? k.tier : null,
    foto: k.foto instanceof Blob && /^image\/(jpeg|png|webp)$/.test(k.foto.type) ? k.foto : null,
  };
}

// Knopf nur zeigen, wenn es auf dem Gerät Wortnest gibt (ältere Browser können das nicht prüfen: dann immer)
async function wortnestKnopfZeigen() {
  let da = true;
  try { if (indexedDB.databases) da = (await indexedDB.databases()).some((d) => d.name === 'lernapp'); } catch { /* unbekannt */ }
  $('#btn-aus-wortnest').hidden = !da;
}

async function ausWortnestUebernehmen() {
  const schonDa = (k) => kinder.some((x) => x.wortnestId === k.wortnestId || x.name.toLowerCase() === k.name.toLowerCase());
  const neu = (await wortnestKinderLesen()).map(wortnestKindPruefen).filter((k) => k && !schonDa(k));
  if (!neu.length) {
    alert('Aus Wortnest gibt es keine Kinder, die hier noch fehlen.');
    return;
  }
  if (!confirm(`Aus Wortnest übernehmen: ${neu.map((k) => k.name).join(', ')}?\n\n`
    + 'Übernommen werden Name, Tier und Foto. In Wortnest ändert sich nichts.')) return;
  for (const k of neu) await kindAnlegen(k.name, k);
  elternZeichnen();
}
$('#btn-aus-wortnest').addEventListener('click', ausWortnestUebernehmen);

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
  spielOptionenZeigen();
  document.querySelectorAll('#kind [data-option]').forEach((box) => { box.checked = !!(k[box.dataset.option] ?? optionStandard(box.dataset.option)); });
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
