'use strict';

// Bei jeder Änderung zusammen mit CACHE in sw.js erhöhen (wird im Elternbereich angezeigt)
const APP_VERSION = 27;

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
    // Menschen (Profile) und ihre Fotos/Aufnahmen; Medien-Schlüssel <profil>|<platz>|<art> wie in Wortnest
    profile: async () => ((await aktion('profile', 'readonly', (s) => s.getAll())) || [])
      .sort((a, b) => a.erstellt - b.erstellt),
    profilSpeichern: (p) => aktion('profile', 'readwrite', (s) => s.put(p)),
    async profilLoeschen(id) {
      await aktion('medien', 'readwrite', (s) => s.delete(medienBereich(id)));
      return aktion('profile', 'readwrite', (s) => s.delete(id));
    },
    medium: (profil, platz, art) => aktion('medien', 'readonly', (s) => s.get(`${profil}|${platz}|${art}`)),
    // Alle Medien eines Profils als [{ platz, art, blob }] (Schlüssel und Inhalte aus derselben Transaktion)
    medienVon: async (profil) => (await aktion('medien', 'readonly', (s) => {
      const schluessel = s.getAllKeys(medienBereich(profil));
      const inhalte = s.getAll(medienBereich(profil));
      return { get result() {
        return schluessel.result.map((k, i) => {
          const teile = k.split('|');
          return { platz: teile.slice(1, -1).join('|'), art: teile[teile.length - 1], blob: inhalte.result[i] };
        });
      } };
    })) || [],
    // true, wenn gespeichert (sonst z. B. Speicher voll)
    medienSetzen: async (profil, platz, art, blob) =>
      (await aktion('medien', 'readwrite', (s) => s.put(blob, `${profil}|${platz}|${art}`))) !== undefined,
    medienEntfernen: (profil, platz, art) => aktion('medien', 'readwrite', (s) => s.delete(`${profil}|${platz}|${art}`)),
  };
})();

function medienBereich(profil) {
  return IDBKeyRange.bound(`${profil}|`, `${profil}|\uffff`);
}

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
const ALLE_SPIELE = ['wieviele', 'mehr', 'korb', 'trommel', 'holmir', 'ziffern', 'welche', 'faecher', 'jedem', 'huepfen', 'weg', 'nester', 'treppe'];
const START_REGAL = ['wieviele'];
const START_AUS = ALLE_SPIELE.filter((id) => !START_REGAL.includes(id));
// Für Eltern: was jedes Spiel tut (die Kacheln zeigen den Kindern nur ein Bild)
const SPIEL_INFO = {
  wieviele: 'Mengen 1 bis 3 auf einen Blick erkennen',
  mehr: 'Zwei Teller: Wo sind mehr? (auf Wunsch auch: Wo sind weniger?)',
  korb: 'Dinge in den Korb schieben und dabei zählen (1–3, auf Wunsch bis 5)',
  trommel: 'So oft trommeln, wie gesagt wird (1–3, auf Wunsch bis 5)',
  holmir: 'Echte Dinge holen und zusammen zählen (mit Erwachsenem)',
  ziffern: 'Ziffern mit dem Finger nachfahren, dann die Menge sehen (eher ab 4)',
  welche: 'Ziffern wiedererkennen: „Wo ist die Drei?“ (nach dem Nachspuren, eher ab 4)',
  faecher: 'Zur Ziffer selbst die Menge legen, die Null bleibt leer (nach „Welche Zahl?“, eher ab 4)',
  jedem: 'Jedem Tier einen Teller hinschieben: eins zu eins, „gleich viele“ (ab 3)',
  huepfen: 'Abzählvers: den Frosch von Stein zu Stein schieben, die Zahlen der Reihe nach (bis 5, auf Wunsch bis 10)',
  weg: 'Zahlenweg 1–10: mit dem Teddy abwechselnd würfeln, gemeinsam ins Ziel (eher ab 4)',
  nester: 'Eier auf zwei Nester verteilen: „zwei hier und eins da – zusammen drei“ (eher ab 4½)',
  treppe: 'Punktstangen 1–5 zu einer Treppe ordnen: jede Stufe hat einen mehr (eher ab 4½)',
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
  return stimmeLaden();
}

// Schalter einzelner Spiele (je Kind, ohne Kinder app-weit): Name = Feld beim Kind, Schlüssel zn:<Name>, data-option
const SPIEL_OPTIONEN = ['weniger', 'korbBis5', 'korbTippen', 'trommelBis5', 'holBis5',
  'holLoeffel', 'holBecher', 'holBaustein', 'holKuscheltier', 'ziffern456', 'ziffern789', 'ziffern0', 'huepfenBis10'];
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
  // Hochkant 2 Spalten (ab 7 Kacheln 3), quer höchstens 2 Reihen (4 bis 7 Spalten) – so passt alles ohne Blättern
  const quer = innerWidth > innerHeight;
  const spalten = Math.max(1, Math.min(sichtbar, quer ? Math.min(7, Math.max(4, Math.ceil(sichtbar / 2))) : (sichtbar > 6 ? 3 : 2)));
  const raster = $('#home .spiele-raster');
  raster.style.setProperty('--spalten', spalten);
  raster.style.setProperty('--reihen', Math.max(1, Math.ceil(sichtbar / spalten)));
  const k = aktivesKind();
  $('#btn-kind').hidden = !k;
  $('#btn-kind').innerHTML = k ? kindBildHtml(k) : '';
}

document.querySelectorAll('#home .spiel-btn').forEach((btn) => {
  btn.addEventListener('click', () => spielStarten(btn.dataset.spiel));
});
window.addEventListener('resize', () => { if ($('#home').classList.contains('active')) spieleZeigen(); });

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

// Ein einziges Tonelement für alles: Safari auf dem iPhone spielt Töne nur direkt nach einem Tipp – außer über ein
// Element, das schon einmal bei einem Tipp gespielt hat. Darum wird es beim ersten Tipp mit einem stillen Ton
// „entsperrt“; danach dürfen auch Ansagen nach Pausen, Zeitgebern und Schieben erklingen.
const tonEl = new Audio();
tonEl.preload = 'auto';
let tonEntsperrt = false;
const STILLE = (() => {
  const v = new DataView(new ArrayBuffer(44 + 200));
  const text = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + 200, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, 200, true);
  return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
})();
function tonEntsperren() {
  if (tonEntsperrt || !tonEl.paused) return;   // spielt gerade etwas: nicht unterbrechen
  tonEl.onended = tonEl.onerror = tonEl.onplaying = null;
  tonEl.src = STILLE;
  const p = tonEl.play();
  if (p) p.then(() => { tonEntsperrt = true; }).catch(() => {});
}
['touchend', 'pointerup', 'click', 'keydown'].forEach((art) => document.addEventListener(art, tonEntsperren, { capture: true, passive: true }));

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
    const a = tonEl;
    a.onplaying = null;
    a.src = quelle;
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

const ansage = (name) => folgeAbspielen([{ url: ansageUrl(name) }], ANSAGEN[name][0]);
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
      const a = tonEl;
      a.src = ansageUrl(name);
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
  ziffernStoppen();
  welcheStoppen();
  faecherStoppen();
  jedemStoppen();
  huepfenStoppen();
  wegStoppen();
  nesterStoppen();
  treppeStoppen();
  studioAbbrechen();
  studioMikrofonZu();
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
  if (ziel === 'mensch' && menschInArbeit) {
    menschZeichnen();
    zeigen('mensch', false);
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
      ? folgeAbspielen([{ url: ansageUrl(name) }], ANSAGEN[name][0]).then(() => aktuell(nr)) : Promise.resolve(false)),
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
// Andere Anordnungen (ab Stufe 2): sonst lernt das Kind womöglich das Bild „Drei“ statt der Anzahl drei.
// Punkte bleiben gleich groß und im gleichen Abstand.
const ANORDNUNGEN = {
  1: [[[50, 50]], [[30, 70]], [[70, 32]]],
  2: [[[24, 24], [76, 76]], [[26, 50], [74, 50]], [[50, 24], [50, 76]], [[76, 24], [24, 76]]],
  3: [[[24, 24], [50, 50], [76, 76]], [[20, 50], [50, 50], [80, 50]], [[50, 24], [24, 72], [76, 72]], [[26, 28], [74, 28], [50, 74]]],
};
const wuerfelSvg = (n, stellen = WUERFEL[n]) => `<svg viewBox="0 0 100 100" aria-hidden="true">${
  stellen.map(([x, y]) => `<circle class="menge-punkt" cx="${x}" cy="${y}" r="11"/>`).join('')}</svg>`;
const gemischtSvg = (n) => wuerfelSvg(n, zufall(ANORDNUNGEN[n]));

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
  el.classList.remove('huepft', 'wackelt', 'kommt', 'springt', klasse);
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
  box.replaceChildren(...mischen([1, 2, 3]).map((n) => wvKarte(n, gemischtSvg(n))));
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
  const karte = wvEinzeln(n, gemischtSvg(n));
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
// Eigene Dinge (Foto, gelten für alle Kinder): Liste zn:eigeneDinge [{ id 'd-…', name }], Foto in medien
// „dinge|<id>|bild“. Die Stimme kennt den Namen nicht: „Hol mir zwei davon!“ – die Karte zeigt das Foto.
const EIGENE_DINGE_MAX = 6;
let eigeneDinge = [];   // [{ id, name, url }]
async function eigeneDingeLaden() {
  eigeneDinge.forEach((d) => URL.revokeObjectURL(d.url));
  const liste = speicher.lesen('eigeneDinge', []);
  const neu = [];
  for (const d of Array.isArray(liste) ? liste : []) {
    if (!d || typeof d.id !== 'string') continue;
    const foto = await datenbank.medium('dinge', d.id, 'bild');
    if (foto instanceof Blob) neu.push({ id: d.id, name: String(d.name || '').slice(0, 30), url: URL.createObjectURL(foto) });
  }
  eigeneDinge = neu;
}
const eigenesDing = (ding) => eigeneDinge.find((d) => `eigen:${d.id}` === ding) || null;
function holDingBild(ding) {
  const e = eigenesDing(ding);
  return `<span class="karte-ding${e ? ' eigen' : ''}">${e ? `<img src="${e.url}" alt="">` : HOL_DINGE[ding].svg}</span>`;
}

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
  const auswahl = [...(dinge.length ? dinge : Object.keys(HOL_DINGE)), ...eigeneDinge.map((d) => `eigen:${d.id}`)];
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
  const auftrag = (nr2) => hlAnsage(nr2, eigenesDing(ding) ? `hol-eigen-${n}` : `hol-${n}-${ding}`);
  const bild = holDingBild(ding);
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
  const eigen = !!eigenesDing(ding);
  const fw = eigen ? 'es' : HOL_DINGE[ding].fw;   // eigenes Ding: „Hol mir eins davon!“ – „Leg es hin!“
  karte.querySelectorAll('.leuchtet').forEach((p) => p.classList.remove('leuchtet'));
  if (!(await hlAnsage(nr, n === 1 ? `hol-leg-hin-1-${fw}` : 'hol-leg-hin'))) return;
  await warten(n > 3 ? HOL_ZEIT.hinlegenViele : HOL_ZEIT.hinlegen);
  const zeig = eigen ? (n === 1 ? 'hol-zeig-1-eigen' : 'hol-zeig-jedes') : (n === 1 ? `hol-zeig-1-${ding}` : `hol-zeig-jeden-${ding}`);
  if (!(await hlAnsage(nr, zeig))) return;
  await warten(HOL_ZEIT.selbstZaehlen);
  const takte = Array.from({ length: n }, () => document.createElement('span'));
  if (!(await hlZaehlen(nr, eigen ? `zaehlen-${n}` : `hol-fertig-${n}-${ding}`, takte))) return;
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

// ---------- Ziffern nachspuren (ab 4): Ziffer Strich für Strich nachfahren, dann die Menge dazu ----------
// Wie die Sandpapier-Ziffern: „Das ist die Drei.“ – ein Lichtpunkt macht die Schreibrichtung vor – das Kind fährt
// nach (geführt wie in Wortnest: blauer Startpunkt, orange Pfeile, kein Petrol) – danach die Menge als Punkte:
// „Eins, zwei, drei. Drei!“ (bei der Null: „Null. Da ist nichts!“). Daneben fahren ist kein Fehler: die Spur bleibt
// einfach nicht stehen; nach dreimal Abrutschen macht der Lichtpunkt es nochmal vor. Drei Ziffern je Besuch, dann
// in echt: „Mal eine Drei mit dem Finger in die Luft!“ Gruppen (1 2 3 → 4 5 6 → 7 8 9 → 0) stellen die Eltern ein.

const ZIFFERN_RUNDEN = 3;
const ZIFFER_ZEIT = { daumen: 6000, auftragNochmal: 14000, mengePause: 1400, vormachenPause: 600, luftMalen: 2600 };
const ZIFFER_FARBE = { umriss: '#c7b08a', offen: '#f4eee5', aktuell: '#e0c79c', fertig: '#ffffff', pfeil: '#b8470b', start: '#1d5fbf' };
const ZIFFER_SPUR = ['#9b59b6', '#e0567c', '#e6a700'];   // Fingerspur, je Ziffer eine Farbe (kein Petrol, kein Blau)
const ZIFFER_BREITE = 13;            // Strichbreite der Vorlage in Ziffer-Einheiten
const ZIFFER_LICHT_PAUSE = 0.9;      // s Pause zwischen zwei Durchläufen des Lauflichts
const ZIFFER_NACHGLUEHEN = 0.55;     // s, die ein Pfeil nachglüht
const ZIFFER_ERINNERUNG = 6000;      // ms ohne Berührung bis zur Erinnerung
const ZIFFER_OPTIONEN = { 1: 'ziffern456', 2: 'ziffern789', 3: 'ziffern0' };   // Gruppe -> Eltern-Schalter (1 2 3 immer)

const zf = { runde: 0, runden: [], gesperrt: true, timer: null, nummer: 0, fertig: false, inEcht: false, auftrag: false,
  // Tafel: Pfade in Bildschirm-Pixeln, aktueller Strich, Fortschritt darauf, Fingerstrich, gültige Spuren
  breite: 0, hoehe: 0, pfade: [], strichNr: 0, fortschritt: 0, versuch: null, spuren: [], pointerId: null, letzter: null,
  linienbreite: 22, strichBreite: 20, geschafft: true, abrutscher: 0,
  // Lauflicht: Vormachen (Lichtpunkt fährt alle Striche ab), danach Pfeile auf dem aktuellen Strich
  vormachen: null, zyklusStart: 0, letzteAktivitaet: 0, erinnert: false, erinnerungBis: 0, laeuft: false };
const zfBausteine = spielBausteine('ziffern', zf);
const { aktuell: zfAktuell, ansage: zfAnsage, zaehlen: zfZaehlen } = zfBausteine;
const zfZiffer = () => zf.runden[zf.runde];
const zfEl = (sel) => $(`#ziffern-feld ${sel}`);

function ziffernStoppen() {
  zfBausteine.stoppen();
  zf.pointerId = null;
  zf.versuch = null;
  zf.geschafft = true;
}

// Drei Ziffern aus den freigeschalteten Gruppen: ohne Wiederholung, nie ein verwechselbares Paar, aufsteigend.
// Mit mehreren Gruppen kommen mindestens zwei aus der neuesten (sie ist gerade dran).
function ziffernRundenPlanen() {
  const gruppen = ZIFFER_GRUPPEN.filter((_, i) => !i || zustand[ZIFFER_OPTIONEN[i]]);
  const neueste = gruppen[gruppen.length - 1];
  const alle = gruppen.flat();
  if (gruppen.length === 1) return [...neueste].sort((a, b) => a - b).slice(0, ZIFFERN_RUNDEN);
  const passt = (wahl, z) => !wahl.includes(z) && !ZIFFER_VERWECHSLUNG.some(([a, b]) => (z === a && wahl.includes(b)) || (z === b && wahl.includes(a)));
  for (let versuch = 0; versuch < 50; versuch++) {
    const wahl = [];
    mischen(neueste).forEach((z) => { if (wahl.length < 2 && passt(wahl, z)) wahl.push(z); });
    mischen(alle).forEach((z) => { if (wahl.length < ZIFFERN_RUNDEN && passt(wahl, z)) wahl.push(z); });
    if (wahl.length === ZIFFERN_RUNDEN) return wahl.sort((a, b) => a - b);
  }
  return [1, 2, 3];
}

function zfRundenZeichnen() {
  $('#ziffern-runden').innerHTML = `<span class="gruppe">${
    Array.from({ length: ZIFFERN_RUNDEN }, (_, i) => `<span class="${i < zf.runde ? 'voll' : ''}"></span>`).join('')}</span>`;
}

// Punkte zur Menge: bis 5 wie in den anderen Spielen (Würfelbild), 6–9 als Fünferreihe + Rest darunter
function zifferMengeSvg(n) {
  if (n <= 5) return korbKarteSvg(n);
  const punkte = Array.from({ length: n }, (_, i) => `<circle class="karte-punkt" cx="${14 + (i % 5) * 18}" cy="${i < 5 ? 38 : 62}" r="7.5"/>`);
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${punkte.join('')}</svg>`;
}

// --- Tafel ---

function zifferFeldAufbauen() {
  const feld = $('#ziffern-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = '<div class="ziffer-tafel"><canvas class="ziffer-vorlage"></canvas><canvas class="ziffer-lichter"></canvas>'
    + '<canvas class="ziffer-spur"></canvas><div class="ziffer-start" hidden></div></div>'
    + '<div class="ziffer-menge in-echt-karte" aria-hidden="true"></div>';
  const spur = zfEl('.ziffer-spur');
  spur.addEventListener('pointerdown', zifferDown);
  spur.addEventListener('pointermove', zifferMove);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => spur.addEventListener(ev, zifferStrichEnde));
}

// Tafel für die aktuelle Ziffer (neu nach dem Drehen des Geräts: dann beginnt die Ziffer von vorn)
function zifferTafelAufbauen() {
  const tafel = zfEl('.ziffer-tafel');
  if (!tafel) return false;
  const rect = tafel.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const dpr = window.devicePixelRatio || 1;
  zf.breite = rect.width;
  zf.hoehe = rect.height;
  tafel.querySelectorAll('canvas').forEach((c) => { c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr); });
  const daten = ZIFFER_STRICHE[zfZiffer()];
  const alle = daten.flat();
  const xs = alle.map((p) => p[0]), ys = alle.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // Ziffern sind höher als breit: im Hochformat die Höhe nutzen (höchstens 1,4 × Breite, sonst wird es ein Strich)
  const f = Math.min(rect.width * 0.84 / (maxX - minX + 2 * ZIFFER_BREITE),
    Math.min(rect.height, rect.width * 1.4) * 0.84 / (maxY - minY + 2 * ZIFFER_BREITE));
  const ox = rect.width / 2 - ((minX + maxX) / 2) * f;
  const oy = rect.height / 2 - ((minY + maxY) / 2) * f;
  zf.strichBreite = ZIFFER_BREITE * f;
  zf.linienbreite = Math.max(22, zf.strichBreite * 1.15);
  zf.pfade = daten.map((punkte) => {
    const p = punkte.map(([x, y]) => ({ x: ox + x * f, y: oy + y * f }));
    const l = [0];
    for (let i = 1; i < p.length; i++) l.push(l[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
    return { p, l, L: l[l.length - 1] };
  });
  Object.assign(zf, { strichNr: 0, fortschritt: 0, versuch: null, spuren: [], pointerId: null, letzter: null, geschafft: false, abrutscher: 0, hilfen: 0 });
  zifferSpurenZeichnen();
  zifferVorlageZeichnen();
  return true;
}

function zifferPunktBei(pfad, s) {
  s = Math.max(0, Math.min(pfad.L, s));
  let i = 1;
  while (i < pfad.p.length - 1 && pfad.l[i] < s) i++;
  const a = pfad.p[i - 1], b = pfad.p[i];
  const t = (s - pfad.l[i - 1]) / ((pfad.l[i] - pfad.l[i - 1]) || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Nächster Punkt auf dem Strich, nur im Bereich [von, bis] (damit z. B. bei der Null nicht zum Ende gesprungen wird)
function zifferProjizieren(pfad, q, von, bis) {
  let best = { s: von, d: Infinity };
  for (let i = 1; i < pfad.p.length; i++) {
    if (pfad.l[i] < von || pfad.l[i - 1] > bis) continue;
    const a = pfad.p[i - 1], b = pfad.p[i];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y);
    const s = Math.max(von, Math.min(bis, pfad.l[i - 1] + t * (pfad.l[i] - pfad.l[i - 1])));
    if (d < best.d) best = { s, d };
  }
  return best;
}

// Toleranzen in Pixeln, großzügig für Kinderfinger (wie Wortnest)
const zfFangRadius = () => Math.max(34, zf.strichBreite * 1.6);
const zfSpurToleranz = () => Math.max(26, zf.strichBreite * 1.3);
const zfAbrutschGrenze = () => Math.max(48, zf.strichBreite * 2.4);

// „Sandpapier-Gefühl“: leichtes Vibrieren, solange der Finger auf dem Strich vorankommt (Android; iPhone kann es nicht)
let zfVibriertAm = 0;
function zfVibrieren(muster, nurAlleMs = 0) {
  if (typeof navigator.vibrate !== 'function') return;
  const jetzt = performance.now();
  if (nurAlleMs && jetzt - zfVibriertAm < nurAlleMs) return;
  zfVibriertAm = jetzt;
  try { navigator.vibrate(muster); } catch { /* manche Geräte erlauben es nicht */ }
}

function zifferPfadZeichnen(c, pfad) {
  c.beginPath();
  c.moveTo(pfad.p[0].x, pfad.p[0].y);
  for (let i = 1; i < pfad.p.length; i++) c.lineTo(pfad.p[i].x, pfad.p[i].y);
  c.stroke();
}

function zifferVorlageZeichnen() {
  const el = zfEl('.ziffer-vorlage');
  if (!el) return;
  const c = el.getContext('2d');
  const dpr = el.width / zf.breite;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, el.width, el.height);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = zf.strichBreite + 4;
  c.strokeStyle = ZIFFER_FARBE.umriss;
  zf.pfade.forEach((pfad) => zifferPfadZeichnen(c, pfad));
  c.lineWidth = zf.strichBreite;
  zf.pfade.forEach((pfad, i) => { c.strokeStyle = i < zf.strichNr ? ZIFFER_FARBE.fertig : ZIFFER_FARBE.offen; zifferPfadZeichnen(c, pfad); });
  const pfad = zf.pfade[zf.strichNr];
  if (!pfad) { zifferStartZeigen(null); return; }
  c.strokeStyle = ZIFFER_FARBE.aktuell;
  zifferPfadZeichnen(c, pfad);
  zifferStartZeigen(zf.vormachen ? null : zifferPunktBei(pfad, zf.fortschritt));
}

// Blauer Punkt: hier geht es los (bzw. weiter), mit der Nummer des Strichs
function zifferStartZeigen(p) {
  const el = zfEl('.ziffer-start');
  if (!el) return;
  if (!p) { el.hidden = true; return; }
  const g = Math.min(56, Math.max(40, zf.strichBreite * 0.9));
  el.hidden = false;
  Object.assign(el.style, { width: `${g}px`, height: `${g}px`, left: `${p.x - g / 2}px`, top: `${p.y - g / 2}px` });
  el.textContent = zf.strichNr + 1;
}

function zifferHinweis() {
  const el = zfEl('.ziffer-start');
  if (!el) return;
  el.classList.remove('hinweis-puls');
  void el.offsetWidth;
  el.classList.add('hinweis-puls');
}

function zifferSpurStueck(c, von, bis) {
  const farbe = ZIFFER_SPUR[zf.runde % ZIFFER_SPUR.length];
  if (Math.hypot(bis.x - von.x, bis.y - von.y) < 0.5) {
    c.fillStyle = farbe;
    c.beginPath(); c.arc(bis.x, bis.y, zf.linienbreite / 2, 0, Math.PI * 2); c.fill();
    return;
  }
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = zf.linienbreite; c.strokeStyle = farbe;
  c.beginPath(); c.moveTo(von.x, von.y); c.lineTo(bis.x, bis.y); c.stroke();
}

function zifferLinie(von, bis) {
  const el = zfEl('.ziffer-spur');
  const c = el.getContext('2d');
  const dpr = el.width / zf.breite;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  zifferSpurStueck(c, von, bis);
}

function zifferSpurenZeichnen() {
  const el = zfEl('.ziffer-spur');
  if (!el) return;
  const c = el.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, el.width, el.height);
  for (const punkte of zf.spuren) for (let i = 0; i < punkte.length; i++) zifferLinie(punkte[Math.max(0, i - 1)], punkte[i]);
}

function zifferPunkt(e) {
  const r = zfEl('.ziffer-spur').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function zifferDown(e) {
  // Ein neuer erster Finger heißt: der vorige Kontakt ist vorbei, auch wenn sein „pointerup“ nie ankam
  if (zf.pointerId !== null && e.isPrimary && e.pointerId !== zf.pointerId) zifferStrichEnde({ pointerId: zf.pointerId });
  if (zf.pointerId !== null || zf.geschafft || !zfAktuell(zf.nummer)) return;
  e.preventDefault();
  audio();
  zf.pointerId = e.pointerId;
  try { e.target.setPointerCapture(e.pointerId); } catch { /* ältere Browser */ }
  const p = zifferPunkt(e);
  zf.letzter = p;
  zifferLinie(p, p);
  // Kind legt los: Vormachen sofort beenden
  zf.vormachen = null;
  zf.letzteAktivitaet = performance.now();
  zf.erinnert = false;
  const pfad = zf.pfade[zf.strichNr];
  const start = zifferPunktBei(pfad, zf.fortschritt);
  zf.versuch = { punkte: [p], folgt: Math.hypot(p.x - start.x, p.y - start.y) <= zfFangRadius(), startFortschritt: zf.fortschritt };
  zifferVorlageZeichnen();
}

function zifferMove(e) {
  if (e.pointerId !== zf.pointerId) return;
  const gesammelt = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of gesammelt.length ? gesammelt : [e]) {
    const p = zifferPunkt(ev);
    // Auf dem Weg zum nächsten Strich (Finger nicht abgesetzt) keine Spur malen
    if (!(zf.versuch && zf.versuch.unterwegs)) zifferLinie(zf.letzter, p);
    zf.letzter = p;
    zifferBewegung(p);
    if (zf.geschafft) return;
  }
}

function zifferBewegung(p) {
  const v = zf.versuch;
  if (!v) return;
  zf.letzteAktivitaet = performance.now();
  if (v.unterwegs) { zifferUnterwegs(p); return; }
  v.punkte.push(p);
  if (!v.folgt) return;
  const pfad = zf.pfade[zf.strichNr];
  const b = zf.strichBreite;
  const treffer = zifferProjizieren(pfad, p, zf.fortschritt - b, zf.fortschritt + 2.5 * b);
  if (treffer.d > zfAbrutschGrenze()) { zifferAbgerutscht(); return; }
  if (treffer.d <= zfSpurToleranz() && treffer.s > zf.fortschritt) {
    zf.fortschritt = treffer.s;
    zfVibrieren(10, 70);
    zifferStartZeigen(zifferPunktBei(pfad, zf.fortschritt));
  }
  if (zf.fortschritt >= pfad.L - b * 0.2) zifferStrichFertig();
}

// Finger ist nach einem fertigen Strich liegen geblieben: am Startpunkt des nächsten Strichs geht es weiter
function zifferUnterwegs(p) {
  const start = zifferPunktBei(zf.pfade[zf.strichNr], zf.fortschritt);
  if (Math.hypot(p.x - start.x, p.y - start.y) > zfFangRadius()) return;
  zf.versuch = { punkte: [p], folgt: true, startFortschritt: zf.fortschritt };
}

function zifferStrichEnde(e) {
  if (e.pointerId !== zf.pointerId) return;
  zf.pointerId = null;
  zf.letzter = null;
  zf.letzteAktivitaet = zf.zyklusStart = performance.now();
  const v = zf.versuch;
  zf.versuch = null;
  if (!v || zf.geschafft) return;
  // Gültige Spur bleibt stehen (absetzen und weitermachen ist erlaubt), alles andere verschwindet still
  if (v.folgt) zf.spuren.push(v.punkte);
  else if (!v.unterwegs && !v.fertig) { zifferSpurenZeichnen(); zifferHinweis(); }
}

function zifferAbgerutscht() {
  const v = zf.versuch;
  v.folgt = false;
  v.punkte = [];
  zf.fortschritt = v.startFortschritt;
  zifferSpurenZeichnen();
  zifferVorlageZeichnen();
  zifferHinweis();
  // Nach dreimal Abrutschen: erst macht der Lichtpunkt die Ziffer nochmal vor, beim nächsten Mal führt er den Strich
  // selbst zu Ende (kein „falsch“, kein Steckenbleiben – „nach 3 Versuchen Lösung zeigen und weiter“)
  if (++zf.abrutscher < 3) return;
  zf.abrutscher = 0;
  if (zf.hilfen++ === 0) zifferVormachen();
  else zifferStrichZeigen();
}

// Lösung zeigen: der aktuelle Strich wird in der Spurfarbe gemalt und gilt als geschafft
function zifferStrichZeigen() {
  const pfad = zf.pfade[zf.strichNr];
  const ab = pfad.p.findIndex((_, i) => pfad.l[i] > zf.fortschritt);
  const punkte = [zifferPunktBei(pfad, zf.fortschritt), ...pfad.p.slice(ab < 0 ? pfad.p.length : ab)];
  zf.versuch = { punkte, folgt: true, startFortschritt: zf.fortschritt };
  zf.pointerId = null;
  zifferSpurenZeichnen();
  for (let i = 1; i < punkte.length; i++) zifferLinie(punkte[i - 1], punkte[i]);
  zifferStrichFertig();
}

function zifferStrichFertig() {
  const v = zf.versuch;
  if (v) { zf.spuren.push(v.punkte); v.punkte = []; v.folgt = false; v.fertig = true; }
  zfVibrieren(35);
  zf.strichNr++;
  zf.fortschritt = 0;
  zf.abrutscher = 0;
  zf.zyklusStart = performance.now();
  zifferKlick();
  if (zf.strichNr >= zf.pfade.length) { zifferVorlageZeichnen(); zifferGeschafft(zf.nummer); return; }
  zifferVorlageZeichnen();
  // Finger bleibt liegen (wie beim Schreiben): weiter zum nächsten Strich, ohne Spur auf dem Weg
  if (v && zf.pointerId !== null && zf.letzter) {
    zf.versuch = { punkte: [], folgt: false, unterwegs: true };
    zifferUnterwegs(zf.letzter);
  }
}

// Kurzer heller Ton, wenn ein Strich geschafft ist
function zifferKlick() {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator(), gain = c.createGain(), t = c.currentTime;
  osc.frequency.value = 880 + zf.strichNr * 110;
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

// --- Lauflicht: erst fährt ein Lichtpunkt alle Striche vor, dann zeigen Pfeile auf dem aktuellen Strich den Weg ---

const zfLichtTempo = () => Math.max(260, zf.strichBreite * 6);   // Pixel pro Sekunde
const zfPfeilAbstand = () => Math.max(32, zf.strichBreite * 1.8);

function zifferPfeilStellen(pfad, ab = 0) {
  const abstand = zfPfeilAbstand(), stellen = [];
  for (let s = abstand * 0.6; s < pfad.L - abstand * 0.3; s += abstand) if (s > ab) stellen.push(s);
  return stellen;
}

function zifferVormachen() {
  zf.vormachen = { start: performance.now() };
  zf.letzteAktivitaet = performance.now();
  zf.erinnert = false;
  zifferStartZeigen(null);
  zifferLichtStarten();
}

function zifferLichtStarten() {
  if (zf.laeuft) return;
  zf.laeuft = true;
  requestAnimationFrame(zifferLichtSchritt);
}

function zifferLichterLeeren() {
  const el = zfEl('.ziffer-lichter');
  if (!el) return null;
  const c = el.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, el.width, el.height);
  c.setTransform(el.width / zf.breite, 0, 0, el.width / zf.breite, 0, 0);
  return c;
}

function zifferLichtSchritt(jetzt) {
  if (zf.geschafft || !$('#ziffern').classList.contains('active') || !zfEl('.ziffer-lichter')) {
    zf.laeuft = false;
    zifferLichterLeeren();
    return;
  }
  zifferLichterZeichnen(jetzt);
  requestAnimationFrame(zifferLichtSchritt);
}

// Vormachen: wo ist der Lichtpunkt nach t Sekunden? Striche nacheinander, mit kurzer Pause dazwischen
function zifferVormachenStand(t) {
  const v = zfLichtTempo();
  for (let nr = 0; nr < zf.pfade.length; nr++) {
    const dauer = zf.pfade[nr].L / v;
    if (t <= dauer) return { nr, kopf: t * v };
    t -= dauer + 0.25;
    if (t < 0) return { nr, kopf: zf.pfade[nr].L };
  }
  return null;
}

function zifferLichterZeichnen(jetzt) {
  const c = zifferLichterLeeren();
  if (!c) return;
  const v = zfLichtTempo();
  if (zf.vormachen) {
    const z = zifferVormachenStand((jetzt - zf.vormachen.start) / 1000);
    if (!z) {
      zf.vormachen = null;
      zf.zyklusStart = zf.letzteAktivitaet = jetzt;
      zifferVorlageZeichnen();   // jetzt den Startpunkt zeigen
      return;
    }
    for (let nr = 0; nr <= z.nr; nr++) {
      const pfad = zf.pfade[nr];
      const kopf = nr < z.nr ? pfad.L : z.kopf;
      for (const s of zifferPfeilStellen(pfad)) {
        if (s > kopf) continue;
        const glut = nr < z.nr ? 0.5 : Math.exp(-((kopf - s) / v) / ZIFFER_NACHGLUEHEN);
        zifferPfeil(c, pfad, s, Math.max(0.5, glut), 1);
      }
    }
    zifferGeisterpunkt(c, zifferPunktBei(zf.pfade[z.nr], z.kopf));
    return;
  }
  const pfad = zf.pfade[zf.strichNr];
  if (!pfad) return;
  if (!zf.erinnert && jetzt - zf.letzteAktivitaet > ZIFFER_ERINNERUNG && zf.pointerId === null) {
    zf.erinnert = true;
    zf.erinnerungBis = jetzt + 2500;
    zf.zyklusStart = jetzt;
    zifferHinweis();
  }
  const kraeftig = jetzt < zf.erinnerungBis;
  const ab = zf.fortschritt;
  const dauer = (pfad.L - ab) / v;
  const t = ((jetzt - zf.zyklusStart) / 1000) % (dauer + ZIFFER_LICHT_PAUSE);
  const kopf = ab + t * v;
  for (const s of zifferPfeilStellen(pfad, ab)) {
    const glut = s > kopf ? 0 : Math.exp(-((kopf - s) / v) / ZIFFER_NACHGLUEHEN);
    zifferPfeil(c, pfad, s, 0.28 + 0.72 * glut, kraeftig ? 1.35 : 1);
  }
}

function zifferPfeil(c, pfad, s, staerke, groesse) {
  const p = zifferPunktBei(pfad, s), q = zifferPunktBei(pfad, s + 1);
  const w = Math.atan2(q.y - p.y, q.x - p.x);
  const g = zf.strichBreite * 0.42 * groesse * (0.85 + 0.25 * staerke);
  c.save();
  c.globalAlpha = Math.min(1, staerke);
  c.strokeStyle = ZIFFER_FARBE.pfeil;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(3.5, zf.strichBreite * 0.16) * groesse;
  if (staerke > 0.6) { c.shadowColor = 'rgba(242, 140, 56, 0.95)'; c.shadowBlur = 12 * staerke; }
  c.beginPath();
  c.moveTo(p.x - g * Math.cos(w - 0.6), p.y - g * Math.sin(w - 0.6));
  c.lineTo(p.x, p.y);
  c.lineTo(p.x - g * Math.cos(w + 0.6), p.y - g * Math.sin(w + 0.6));
  c.stroke();
  c.restore();
}

function zifferGeisterpunkt(c, p) {
  const r = Math.max(12, zf.strichBreite * 0.38);
  c.save();
  c.shadowColor = 'rgba(29, 95, 191, 0.8)';
  c.shadowBlur = 18;
  c.fillStyle = '#ffffff';
  c.strokeStyle = ZIFFER_FARBE.start;
  c.lineWidth = 4;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.restore();
}

// --- Ablauf ---

async function ziffernNeueRunde() {
  ziffernStoppen();
  const nr = zf.nummer;
  zf.fertig = false;
  zifferFeldAufbauen();
  if (!zifferTafelAufbauen()) return;
  zifferVormachen();
  // „Das ist die Drei.“ – das Kind darf schon während der Ansage loslegen
  await zfAnsage(nr, `ziffer-ist-${zfZiffer()}`);
}

// Ziffer geschafft: kurzer Klang, daneben erscheint die Menge, die Stimme zählt (Punkte leuchten)
async function zifferGeschafft(nr) {
  zf.geschafft = true;
  zf.pointerId = null;
  zifferLichterLeeren();
  glockenspiel();
  const n = zfZiffer();
  const menge = zfEl('.ziffer-menge');
  menge.innerHTML = n ? zifferMengeSvg(n) : '';
  menge.classList.toggle('leer', !n);
  menge.classList.add('da');
  await warten(500);
  if (n) { if (!(await zfZaehlen(nr, `zaehlen-${n}`, [...menge.querySelectorAll('.karte-punkt')]))) return; }
  else if (!(await zfAnsage(nr, 'ziffer-null-nichts'))) return;
  await warten(ZIFFER_ZEIT.mengePause);
  if (!zfAktuell(nr)) return;
  zf.runde++;
  zfRundenZeichnen();
  if (zf.runde < ZIFFERN_RUNDEN) ziffernNeueRunde();
  else ziffernAuftrag();
}

// ----- Echte Welt: „Mal eine Drei mit dem Finger in die Luft!“ – vormachen (Ziffer malt sich), dann in echt -----

async function ziffernAuftrag() {
  ziffernStoppen();
  const nr = zf.nummer;
  zf.auftrag = true;
  zf.fertig = false;
  $('#btn-ziffern-daumen').hidden = true;
  const n = zf.runden[ZIFFERN_RUNDEN - 1];
  const feld = $('#ziffern-feld');
  feld.innerHTML = `<div class="ziffer-luft malt">${zifferSvg(n, '#e0c79c')}<span class="ziffer-finger" aria-hidden="true">☝️</span></div>`;
  if (!(await zfAnsage(nr, 'ziffer-luft-vor'))) return;
  await warten(ZIFFER_ZEIT.vormachenPause);
  if (!zfAktuell(nr)) return;
  inEcht({ z: zf, nr, aktuell: zfAktuell, ansage: zfAnsage, buehne: feld, knopf: $('#btn-ziffern-daumen'),
    karteHtml: `${zifferSvg(n)}<span class="karte-bild">☝️</span>`, sagen: (nr2) => zfAnsage(nr2, `ziffer-luft-${n}`),
    zeit: ZIFFER_ZEIT });
}

async function ziffernAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(zf, $('#btn-ziffern-daumen'));
  if (!karte) return;
  karte.classList.add('malt');
  glockenspiel();
  await warten(400);
  if (!(await zfAnsage(nr, 'ziffer-luft-fertig'))) return;
  spielEnde('ziffern', ziffernNeu);
}

$('#btn-ziffern-daumen').addEventListener('click', () => { audio(); if (zf.inEcht) ziffernAuftragErledigt(zf.nummer); });

function ziffernNeu() {
  ziffernStoppen();
  Object.assign(zf, { runde: 0, runden: ziffernRundenPlanen(), fertig: false, auftrag: false, inEcht: false });
  $('#btn-ziffern-daumen').hidden = true;
  zfRundenZeichnen();
  ziffernNeueRunde();
}

function ziffernStarten() {
  spielEndeWeg('ziffern');
  zeigen('ziffern');
  ziffernNeu();
}
SPIELE.ziffern = ziffernStarten;
// Kachel: eine Drei mit blauem Startpunkt (wie beim Spuren)
$('#home .spiel-btn[data-spiel="ziffern"]').innerHTML = zifferSvg(3, '#e0c79c').replace('class="ziffer-svg"', 'class="kachel-bild ziffer-svg"')
  .replace('</svg>', '<circle cx="8.3" cy="12" r="9" fill="#1d5fbf"/></svg>');

$('#btn-ziffern-home').addEventListener('click', () => { ziffernStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: beim Spuren Name nochmal und Lichtpunkt nochmal; in echt den Auftrag
$('#btn-ziffern-laut').addEventListener('click', () => {
  const ende = $('#ziffern .spiel-ende');
  if (ende && !ende.hidden) return;
  audio();
  if (zf.inEcht) { inEchtNochmal(zf); return; }
  if (zf.auftrag || zf.geschafft) return;
  zifferVormachen();
  zfAnsage(zf.nummer, `ziffer-ist-${zfZiffer()}`);
});
// Gerät gedreht: Tafel neu einpassen (die Ziffer beginnt von vorn)
window.addEventListener('resize', () => {
  if (!$('#ziffern').classList.contains('active') || zf.geschafft || zf.auftrag || !zfEl('.ziffer-tafel')) return;
  if (Math.abs(zfEl('.ziffer-tafel').getBoundingClientRect().width - zf.breite) < 1
    && Math.abs(zfEl('.ziffer-tafel').getBoundingClientRect().height - zf.hoehe) < 1) return;
  if (zifferTafelAufbauen()) zifferVormachen();
});

// ---------- Welche Zahl? Drei-Stufen-Lektion mit Ziffern (ab 4) ----------

// 👀 „Das ist die Drei.“ (benennen) · 👂 „Wo ist die Drei?“ (wiedererkennen) · 🗣️ „Welche Zahl ist das? Sag es!“ (ohne
// Prüfung). Ziffern aus denselben Gruppen wie „Ziffern nachspuren“ (verwechselbare Paare nie zusammen). In Stufe 2
// erst zwei Karten, nach zwei sicheren Treffern hintereinander drei. Kein „falsch“: 1. Daneben = benennen, was getippt
// wurde, 2. = die gesuchte Ziffer zeigt ihre Menge und die App zählt, 3. = Lösung zeigen und weiter.
// Zum Schluss in echt: „Such eine Drei bei dir zu Hause!“
const WELCHE_STUFEN_LANG = [3, 6, 3];
const WELCHE_STUFEN_KURZ = [3, 3, 2];   // solange nur 1 2 3 an ist (eher das jüngere Kind): kürzer
let WELCHE_STUFEN = WELCHE_STUFEN_LANG;
const WELCHE_ZEIT = { nochmalFragen: 8000, weiterOhneTipp: 8000, antwort: 5000, unsicherWeiter: 2000, daumen: 4000,
  auftragNochmal: 16000, vormachenPause: 900, pause: 900 };
const wl = { stufe: 0, schritt: 0, punkte: 0, ziffern: [], auftraege: [], ziel: 0, versuche: 0, unsicher: new Set(),
  serie: 0, drei: false, gesperrt: true, timer: null, nummer: 0, letzterTipp: -Infinity, fertig: false };
const wlBausteine = spielBausteine('welche', wl);
const { aktuell: wlAktuell, ansage: wlAnsage, zaehlen: wlZaehlen } = wlBausteine;
const wlBenennen = (n) => `ziffer-ist-${n}`;

function welcheStoppen() {
  wlBausteine.stoppen();
}

function wlRundenZeichnen() {
  let n = 0;
  $('#welche-runden').innerHTML = WELCHE_STUFEN.map((anzahl) => `<span class="gruppe">${
    Array.from({ length: anzahl }, () => `<span class="${n++ < wl.punkte ? 'voll' : ''}"></span>`).join('')}</span>`).join('');
}

// Karte: die Ziffer groß; darunter (erst bei der Hilfe sichtbar) ihre Menge als Punkte
function wlKarte(n) {
  const btn = document.createElement('button');
  btn.className = 'mengen-karte ziffer-karte kommt';
  btn.dataset.ziffer = n;
  // Punkte eng zugeschnitten, damit sie auf der Karte groß genug sind
  const menge = n ? zifferMengeSvg(n).replace('viewBox="0 0 100 100"', `viewBox="${n <= 5 ? '14 14 72 72' : '2 26 96 48'}"`) : '';
  btn.innerHTML = `${zifferSvg(n)}<span class="ziffer-karte-menge">${menge}</span>`;
  btn.setAttribute('aria-label', String(n));
  btn.addEventListener('click', () => wlGetippt(n, btn));
  return btn;
}

function wlKarten(liste, art) {
  const box = $('#welche-karten');
  box.className = `mengen-karten ${art}`;
  box.replaceChildren(...liste.map(wlKarte));
  return [...box.children];
}

const wlZielKarte = () => $(`#welche-karten .ziffer-karte[data-ziffer="${wl.ziel}"]`);

// Stufe 2: jede Ziffer zweimal, nie zweimal dieselbe hintereinander
function wlAuftraege() {
  for (;;) {
    const folge = mischen([...wl.ziffern, ...wl.ziffern]);
    if (folge.every((n, i) => n !== folge[i - 1])) return folge;
  }
}

// Stufe 1: eine Karte, „Das ist die Drei.“; Tippen = nochmal hören, dann weiter
async function wlStufe1() {
  welcheStoppen();
  const nr = wl.nummer;
  const n = wl.ziffern[wl.schritt];
  const [karte] = wlKarten([n], 'einzeln');
  if (!(await wlAnsage(nr, wlBenennen(n)))) return;
  wl.gesperrt = false;
  karte.classList.add('pulsiert');
  wl.timer = setTimeout(() => wlAktuell(nr) && !wl.gesperrt && wlWeiter(nr), WELCHE_ZEIT.weiterOhneTipp);
}

// Stufe 2: zwei (später drei) Karten, Plätze jedes Mal neu, „Wo ist die Drei?“
async function wlStufe2() {
  welcheStoppen();
  const nr = wl.nummer;
  wl.ziel = wl.auftraege[wl.schritt];
  wl.versuche = 0;
  const andere = mischen(wl.ziffern.filter((z) => z !== wl.ziel)).slice(0, wl.drei ? 2 : 1);
  wlKarten(mischen([wl.ziel, ...andere]), wl.drei ? 'drei' : 'zwei');
  await warten(400);
  if (!wlAktuell(nr)) return;
  wlFragen(nr);
}

async function wlFragen(nr) {
  if (!wlAktuell(nr)) return;
  wl.gesperrt = true;
  if (!(await wlAnsage(nr, `welche-wo-${wl.ziel}`))) return;
  wl.gesperrt = false;
  // Nichts getippt: nochmal fragen, danach pulsiert die gesuchte Karte sanft (nie selbst weiter, kein Zeitdruck)
  clearTimeout(wl.timer);
  wl.timer = setTimeout(async () => {
    if (!wlAktuell(nr) || wl.gesperrt) return;
    wl.gesperrt = true;
    if (!(await wlAnsage(nr, `welche-wo-${wl.ziel}`))) return;
    wl.gesperrt = false;
    wl.timer = setTimeout(() => wlAktuell(nr) && wlZielKarte() && wlZielKarte().classList.add('pulsiert'), WELCHE_ZEIT.nochmalFragen);
  }, WELCHE_ZEIT.nochmalFragen);
}

// Stufe 3: eine Karte, „Welche Zahl ist das? Sag es!“ – Ruhe zum Selbersagen; ohne Tipp nennt die App die Ziffer
async function wlStufe3() {
  welcheStoppen();
  const nr = wl.nummer;
  const n = wl.auftraege[wl.schritt];
  const [karte] = wlKarten([n], 'einzeln');
  // War die Ziffer in Stufe 2 noch unsicher: zurück zum Benennen (einmal, dann weiter)
  if (wl.unsicher.has(n)) {
    if (!(await wlAnsage(nr, wlBenennen(n)))) return;
    wl.gesperrt = false;
    wl.timer = setTimeout(() => wlAktuell(nr) && !wl.gesperrt && wlWeiter(nr), WELCHE_ZEIT.unsicherWeiter);
    return;
  }
  if (!(await wlAnsage(nr, 'welche-sag-es'))) return;
  wl.gesperrt = false;
  wl.timer = setTimeout(() => wlAktuell(nr) && !wl.gesperrt && wlAntwort(nr, n, karte), WELCHE_ZEIT.antwort);
}

async function wlAntwort(nr, n, karte) {
  wl.gesperrt = true;
  clearTimeout(wl.timer);
  karte.classList.remove('pulsiert');
  animieren(karte, 'huepft');
  if (!(await wlAnsage(nr, wlBenennen(n)))) return;
  await warten(WELCHE_ZEIT.pause);
  wlWeiter(nr);
}

// Hilfe: die Ziffer zeigt ihre Menge, die App zählt (bei der Null: „da ist nichts“)
async function wlMengeZeigen(nr, karte, n) {
  karte.classList.add('mit-menge');
  if (n) return wlZaehlen(nr, `zaehlen-${n}`, [...karte.querySelectorAll('.karte-punkt')]);
  return wlAnsage(nr, 'ziffer-null-nichts');
}

async function wlGetippt(n, btn) {
  const jetzt = performance.now();
  if (wl.gesperrt || wl.stufe === 3 || jetzt - wl.letzterTipp < 400) return;
  wl.letzterTipp = jetzt;
  audio();
  clearTimeout(wl.timer);
  const nr = wl.nummer;
  wl.gesperrt = true;
  btn.classList.remove('pulsiert');
  if (wl.stufe !== 1) { wlAntwort(nr, n, btn); return; }   // Stufe 1 und 3: Tippen = die Ziffer hören
  if (n === wl.ziel) {
    btn.classList.add('richtig');
    animieren(btn, 'huepft');
    glockenspiel();
    // Zwei sichere Treffer hintereinander: ab jetzt drei Karten
    if (wl.versuche === 0 && ++wl.serie >= 2) wl.drei = true;
    await warten(400);
    if (!(await wlAnsage(nr, wlBenennen(n)))) return;
    await warten(WELCHE_ZEIT.pause);
    wlWeiter(nr);
    return;
  }
  wl.versuche++;
  wl.serie = 0;
  wl.drei = false;   // unsicher: wieder mit zwei Karten
  wl.unsicher.add(wl.ziel);
  const ziel = wlZielKarte();
  if (wl.versuche === 1) {
    // Daneben: sanft wackeln und benennen, was getippt wurde – dann die Frage nochmal
    animieren(btn, 'wackelt');
    if (!(await wlAnsage(nr, wlBenennen(n)))) return;
    await warten(400);
    wlFragen(nr);
  } else if (wl.versuche === 2) {
    // Hilfe: die anderen treten zurück, die gesuchte Ziffer zeigt ihre Menge
    document.querySelectorAll('#welche-karten .ziffer-karte').forEach((k) => k.classList.toggle('blass', k !== ziel));
    animieren(btn, 'wackelt');
    if (!(await wlMengeZeigen(nr, ziel, wl.ziel))) return;
    document.querySelectorAll('#welche-karten .ziffer-karte').forEach((k) => k.classList.remove('blass'));
    await warten(400);
    wlFragen(nr);
  } else {
    // Lösung zeigen und weiter
    ziel.classList.add('richtig');
    animieren(ziel, 'huepft');
    if (!(await wlAnsage(nr, wlBenennen(wl.ziel)))) return;
    await warten(WELCHE_ZEIT.pause);
    wlWeiter(nr);
  }
}

function wlWeiter(nr) {
  if (!wlAktuell(nr)) return;
  wl.punkte++;
  wl.schritt++;
  wlRundenZeichnen();
  if (wl.schritt < WELCHE_STUFEN[wl.stufe]) { wlSchritt(); return; }
  wlNaechsteStufe();
}

function wlSchritt() {
  $('#welche-symbol').textContent = WIEVIELE_SYMBOL[wl.stufe] || '';
  [wlStufe1, wlStufe2, wlStufe3, wlAuftrag][wl.stufe]();
}

async function wlNaechsteStufe() {
  welcheStoppen();
  const nr = wl.nummer;
  glockenspiel();
  wl.stufe++;
  wl.schritt = 0;
  wl.auftraege = (wl.stufe === 1 ? wlAuftraege() : mischen(wl.ziffern)).slice(0, WELCHE_STUFEN[wl.stufe] || 1);
  await warten(700);
  if (!wlAktuell(nr)) return;
  wlSchritt();
  animieren($('#welche-symbol'), 'huepft');
}

// Haus mit Hausnummer (Vormachen: „Zahlen gibt es überall …“)
function wlHausSvg(n) {
  const ziffer = zifferSvg(n).replace('class="ziffer-svg"', 'x="49" y="34" width="22" height="30"');
  return '<svg class="welche-haus" viewBox="0 0 120 120" aria-hidden="true">'
    + '<path d="M14 58 L60 18 L106 58 Z" fill="#d23c2c" stroke="#4a3f35" stroke-width="4" stroke-linejoin="round"/>'
    + '<rect x="22" y="56" width="76" height="56" fill="#f6efe3" stroke="#4a3f35" stroke-width="4"/>'
    + '<rect x="48" y="76" width="24" height="36" rx="3" fill="#8a5a3c" stroke="#4a3f35" stroke-width="3"/>'
    + '<rect x="46" y="31" width="28" height="36" rx="5" fill="#1d5fbf" stroke="#4a3f35" stroke-width="3"/>'
    + ziffer.replace('stroke="#4a3f35"', 'stroke="#ffffff"') + '</svg>';
}

// Echte Welt: vormachen (Haus mit Hausnummer, „Zahlen gibt es überall“), dann „Jetzt in echt!“ – „Such eine Drei bei
// dir zu Hause!“; nach 👍 „Du hast eine Zahl gefunden!“
async function wlAuftrag() {
  welcheStoppen();
  const nr = wl.nummer;
  wl.fertig = false;
  $('#btn-welche-daumen').hidden = true;
  const n = wl.ziffern[wl.ziffern.length - 1];
  const box = $('#welche-karten');
  box.className = 'mengen-karten';
  box.innerHTML = `<div class="welche-vormachen">${wlHausSvg(n)}</div>`;
  if (!(await wlAnsage(nr, 'welche-such-vor'))) return;
  await warten(WELCHE_ZEIT.vormachenPause);
  if (!wlAktuell(nr)) return;
  inEcht({ z: wl, nr, aktuell: wlAktuell, ansage: wlAnsage, buehne: box, knopf: $('#btn-welche-daumen'),
    karteHtml: `${zifferSvg(n)}<span class="karte-bild">🔎</span>`, sagen: (nr2) => wlAnsage(nr2, `welche-such-${n}`),
    zeit: WELCHE_ZEIT });
}

async function wlAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(wl, $('#btn-welche-daumen'));
  if (!karte) return;
  animieren(karte, 'huepft');
  glockenspiel();
  await warten(400);
  if (!(await wlAnsage(nr, 'welche-such-fertig'))) return;
  spielEnde('welche', welcheNeu);
}

$('#btn-welche-daumen').addEventListener('click', () => { audio(); if (wl.inEcht) wlAuftragErledigt(wl.nummer); });

function welcheNeu() {
  welcheStoppen();
  WELCHE_STUFEN = Object.values(ZIFFER_OPTIONEN).some((o) => zustand[o]) ? WELCHE_STUFEN_LANG : WELCHE_STUFEN_KURZ;
  Object.assign(wl, { stufe: 0, schritt: 0, punkte: 0, ziffern: ziffernRundenPlanen(), auftraege: [], unsicher: new Set(),
    serie: 0, drei: false, fertig: false, inEcht: false });
  wl.auftraege = [...wl.ziffern];
  $('#btn-welche-daumen').hidden = true;
  wlRundenZeichnen();
  wlSchritt();
}

function welcheStarten() {
  spielEndeWeg('welche');
  zeigen('welche');
  welcheNeu();
}
SPIELE.welche = welcheStarten;
// Kachel: zwei Ziffernkarten
$('#home .spiel-btn[data-spiel="welche"]').innerHTML = `<span class="kachel-ziffern">${zifferSvg(1)}${zifferSvg(3)}</span>`;

$('#btn-welche-home').addEventListener('click', () => { welcheStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: Ansage nochmal; in Stufe 2 nur die Frage (Karten bleiben liegen)
$('#btn-welche-laut').addEventListener('click', () => {
  const ende = $('#welche .spiel-ende');
  if ((ende && !ende.hidden) || wl.fertig || wl.gesperrt) return;
  audio();
  if (wl.inEcht) { inEchtNochmal(wl); return; }
  if (wl.stufe === 1) {
    clearTimeout(wl.timer);
    wl.nummer++;
    wlFragen(wl.nummer);
    return;
  }
  wlSchritt();
});

// ---------- Fächer füllen (ab 4): zur Ziffer selbst die Menge legen – der Spindelkasten-Gedanke ----------
// Fächer mit Ziffern (dieselben Gruppen wie beim Nachspuren, aufsteigend). Ein Fach nach dem anderen ist dran:
// „Das ist die Zwei. Leg zwei Stäbchen hinein.“ Das Kind schiebt Stäbchen hinein, jedes Ankommen hat sein Zahlwort;
// ist das Fach voll, nimmt es keins mehr (das Stäbchen bleibt einfach liegen – kein „falsch“), alle Stäbchen darin
// leuchten: „Eins, zwei. Zwei!“ Die Null ist ein Fach, in das nichts kommt. Im Vorrat liegen genau so viele
// Stäbchen wie nötig – am Ende sind alle verteilt (Selbstkontrolle wie beim echten Spindelkasten).
// Zum Schluss in echt: „Hol drei Bausteine und leg sie neben die Drei!“ (die Drei steht groß auf dem Bildschirm).
const FAECHER_ZEIT = { hilfe: 12000, nullPause: 1600, fachPause: 700, daumen: 6000, auftragNochmal: 16000 };
const fa = { ziffern: [], fachNr: 0, staebe: [], faecher: [], ziehen: null, gesperrt: true, timer: null, nummer: 0,
  sprech: { kette: Promise.resolve(), offen: 0 }, fertig: false, inEcht: false, auftrag: false, mass: null };
const faBausteine = spielBausteine('faecher', fa);
const { aktuell: faAktuell, ansage: faAnsage, zaehlen: faZaehlen } = faBausteine;
const STAB_SVG = '<svg viewBox="0 0 20 100" aria-hidden="true" preserveAspectRatio="none"><rect x="3" y="2" width="14" height="96" rx="7" '
  + 'fill="#c98f4e" stroke="#4a3f35" stroke-width="3"/><rect x="7" y="10" width="3" height="70" rx="1.5" fill="#e6b47a"/></svg>';

function faecherStoppen() {
  faBausteine.stoppen();
  fa.ziehen = null;
}

// Maße: Fächer unten in einer Reihe, Vorrat darüber (gleich große Stäbchen in gleichem Abstand). Stäbchen sind schmal
// wie echte Spindeln, ihr Greifbereich ist aber mindestens 40 px breit.
function faMasse() {
  const feld = $('#faecher-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const quer = W > H;
  const n = fa.ziffern.length;
  const rand = 16, luecke = 12;
  const fachW = Math.min(220, (W - 2 * rand - (n - 1) * luecke) / n);
  const zifferH = Math.min(64, H * 0.12);
  const raumH = Math.min(170, H * 0.3);
  const fachY = H - raumH - (quer ? 16 : 96);   // hochkant unten Platz für 👍 (quer sitzt er rechts daneben)
  const x0 = (W - (n * fachW + (n - 1) * luecke)) / 2;
  const faecher = fa.ziffern.map((z, i) => ({ x: x0 + i * (fachW + luecke), y: fachY, w: fachW, h: raumH }));
  const vorratH = fachY - zifferH - 24;
  const meiste = Math.max(1, ...fa.ziffern);
  const summe = fa.ziffern.reduce((a, b) => a + b, 0);
  let stabH = Math.min(raumH * 0.78, 96);
  const stabW = Math.max(6, Math.min(stabH * 0.2, (fachW - 16) / (meiste * 1.35)));
  const greifW = Math.max(40, stabW + 12);
  const abstand = greifW + 6;
  const proReihe = Math.max(1, Math.floor((W - 40) / abstand));
  const reihen = Math.ceil(summe / proReihe);
  stabH = Math.max(40, Math.min(stabH, (vorratH - 12) / reihen - 12));
  return { W, H, faecher, zifferH, stabW, stabH, greifW, abstand, proReihe, vorratH };
}

function faStabSetzen(s, x, y) {
  const { W, H, greifW, stabH } = fa.mass;
  s.x = Math.max(greifW / 2, Math.min(W - greifW / 2, x));
  s.y = Math.max(stabH / 2, Math.min(H - stabH / 2, y));
  s.el.style.transform = `translate(${s.x - greifW / 2}px, ${s.y - stabH / 2}px)`;
}

// Platz i im Fach: nebeneinander, mittig
function faFachPlatz(f, i, anzahl) {
  const { stabW } = fa.mass;
  const abstand = Math.min(stabW * 1.6, (f.w - 16 - stabW) / Math.max(1, anzahl - 1));
  const breite = (anzahl - 1) * abstand;
  return [f.x + f.w / 2 - breite / 2 + i * abstand, f.y + f.h / 2];
}

function faAnordnen() {
  const feld = $('#faecher-feld');
  if (!feld.clientWidth || !fa.ziffern.length) return;
  fa.mass = faMasse();
  const { faecher, zifferH, stabW, stabH, W } = fa.mass;
  feld.querySelectorAll('.fach').forEach((el, i) => {
    const f = faecher[i];
    Object.assign(el.style, { left: `${f.x}px`, top: `${f.y - zifferH - 6}px`, width: `${f.w}px`, height: `${f.h + zifferH + 6}px` });
    el.querySelector('.fach-ziffer').style.height = `${zifferH}px`;
  });
  const { greifW, abstand, proReihe } = fa.mass;
  feld.querySelectorAll('.stab').forEach((el) => {
    Object.assign(el.style, { width: `${greifW}px`, height: `${stabH}px` });
    el.firstChild.style.width = `${stabW}px`;
  });
  // Vorrat: Reihen mit festem Abstand
  const frei = fa.staebe.filter((s) => s.fach === null);
  const reiheH = stabH + 12;
  frei.forEach((s, i) => {
    const reihe = Math.floor(i / proReihe), inReihe = Math.min(proReihe, frei.length - reihe * proReihe);
    const x = W / 2 - ((inReihe - 1) * abstand) / 2 + (i % proReihe) * abstand;
    faStabSetzen(s, x, 12 + stabH / 2 + reihe * reiheH);
  });
  fa.faecher.forEach((f, i) => f.staebe.forEach((s, k) => faStabSetzen(s, ...faFachPlatz(faecher[i], k, Math.max(1, fa.ziffern[i])))));
}

function faFeldAufbauen() {
  const feld = $('#faecher-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = '';
  fa.faecher = fa.ziffern.map((z) => {
    const el = document.createElement('div');
    el.className = `fach${z === 0 ? ' null' : ''}`;
    el.innerHTML = `<div class="fach-ziffer">${zifferSvg(z)}</div><div class="fach-raum"></div>`;
    feld.appendChild(el);
    return { el, ziffer: z, staebe: [] };
  });
  const summe = fa.ziffern.reduce((a, b) => a + b, 0);
  fa.staebe = Array.from({ length: summe }, () => {
    const el = document.createElement('div');
    el.className = 'stab';
    el.style.transition = 'none';   // erst an den Platz, dann erst gleiten (sonst fliegen alle aus der Ecke herein)
    el.innerHTML = STAB_SVG;
    feld.appendChild(el);
    const s = { el, x: 0, y: 0, fach: null };
    el.stab = s;
    return s;
  });
  faAnordnen();
  void feld.offsetWidth;
  fa.staebe.forEach((st) => { st.el.style.transition = ''; });
}

const faFach = () => fa.faecher[fa.fachNr];

async function faFachStarten() {
  clearTimeout(fa.timer);
  const nr = fa.nummer;
  fa.faecher.forEach((f, i) => f.el.classList.toggle('dran', i === fa.fachNr));
  const z = faFach().ziffer;
  fa.gesperrt = true;
  if (z === 0) {
    // Null: das Fach bleibt leer
    animieren(faFach().el, 'huepft');
    if (!(await faAnsage(nr, 'faecher-null'))) return;
    await warten(FAECHER_ZEIT.nullPause);
    if (faAktuell(nr)) faNaechstesFach(nr);
    return;
  }
  if (!(await faAnsage(nr, `faecher-leg-${z}`))) return;
  fa.gesperrt = false;
  faHilfeAbwarten(nr);
}

// Lange nichts angekommen: Auftrag nochmal, ein freies Stäbchen hüpft (kein Zeitdruck, nie selbst weiter)
function faHilfeAbwarten(nr) {
  clearTimeout(fa.timer);
  fa.timer = setTimeout(async () => {
    if (!faAktuell(nr) || fa.gesperrt || fa.ziehen || fa.sprech.offen) { faHilfeAbwarten(nr); return; }
    fa.gesperrt = true;
    const ok = await faAnsage(nr, `faecher-leg-${faFach().ziffer}`);
    if (!ok) return;
    fa.gesperrt = false;
    const frei = fa.staebe.find((s) => s.fach === null);
    if (frei) animieren(frei.el, 'huepft');
    faHilfeAbwarten(nr);
  }, FAECHER_ZEIT.hilfe);
}

$('#faecher-feld').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.stab');
  if (!el || !el.stab || el.stab.fach !== null) return;
  e.preventDefault();
  if (fa.ziehen || fa.gesperrt || fa.auftrag) return;
  audio();
  fa.ziehen = { s: el.stab, id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld: $('#faecher-feld').getBoundingClientRect(), nr: fa.nummer };
  el.classList.add('greift');
  try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = fa.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  // Das Stäbchen sitzt ~30 px über dem Finger, damit das Kind es sieht
  if (z.bewegt) faStabSetzen(z.s, e.clientX - z.feld.left, e.clientY - z.feld.top - 30);
});

// Im aktiven Fach? (großzügig: bis 40 px daneben zählt)
function faImFach(s) {
  const f = fa.mass.faecher[fa.fachNr];
  const dx = Math.max(f.x - s.x, 0, s.x - f.x - f.w), dy = Math.max(f.y - fa.mass.zifferH - s.y, 0, s.y - f.y - f.h);
  return Math.hypot(dx, dy) <= 40;
}

function faLoslassen(e) {
  const z = fa.ziehen;
  if (!z || e.pointerId !== z.id) return;
  fa.ziehen = null;
  z.s.el.classList.remove('greift');
  if (z.nr !== fa.nummer || !faAktuell(z.nr)) return;
  if (!z.bewegt) { animieren(z.s.el, 'huepft'); return; }
  const f = faFach();
  if (!fa.gesperrt && f.ziffer > 0 && f.staebe.length < f.ziffer && faImFach(z.s)) { faEinlegen(z.s); return; }
  // Daneben, anderes oder volles Fach: bleibt liegen – aber oberhalb der Fächer (nichts liegt ungezählt in einem Fach)
  const { faecher, zifferH, stabH } = fa.mass;
  const oben = faecher[0].y - zifferH - 12 - stabH / 2;
  if (z.s.y > oben) faStabSetzen(z.s, z.s.x, oben);
}
document.addEventListener('pointerup', faLoslassen);
document.addEventListener('pointercancel', faLoslassen);

async function faEinlegen(s) {
  const nr = fa.nummer;
  const f = faFach();
  s.fach = fa.fachNr;
  f.staebe.push(s);
  faStabSetzen(s, ...faFachPlatz(fa.mass.faecher[fa.fachNr], f.staebe.length - 1, f.ziffer));
  const k = f.staebe.length;
  const voll = k >= f.ziffer;
  if (voll) { fa.gesperrt = true; clearTimeout(fa.timer); } else faHilfeAbwarten(nr);
  // Zahlwörter in einer Reihe (jedes Ankommen hört sein ganzes Wort, auch wenn schnell nachgelegt wird)
  const sp = fa.sprech;
  sp.offen++;
  sp.kette = sp.kette.then(() => faAnsage(nr, `korb-zahl-${k}`)).finally(() => { sp.offen--; });
  if (!(await sp.kette) || !voll) return;
  await warten(300);
  // Voll: alle Stäbchen im Fach leuchten, die ganze Zählfolge
  if (!(await faZaehlen(nr, `zaehlen-${f.ziffer}`, f.staebe.map((x) => x.el)))) return;
  glockenspiel();
  await warten(FAECHER_ZEIT.fachPause);
  if (faAktuell(nr)) faNaechstesFach(nr);
}

async function faNaechstesFach(nr) {
  faFach().el.classList.add('fertig');
  fa.fachNr++;
  if (fa.fachNr < fa.faecher.length) { faFachStarten(); return; }
  fa.faecher.forEach((f) => f.el.classList.remove('dran'));
  if (!(await faAnsage(nr, 'faecher-fertig'))) return;
  await warten(600);
  if (faAktuell(nr)) faecherAuftrag();
}

// ----- Echte Welt: „Hol drei Bausteine und leg sie neben die Drei!“ – nach 👍 zählt die App mit -----

function faecherAuftrag() {
  faecherStoppen();
  const nr = fa.nummer;
  fa.auftrag = true;
  fa.fertig = false;
  $('#btn-faecher-daumen').hidden = true;
  // Eine Menge, die man gut holen kann: die größte Ziffer bis 5 (sonst die kleinste über 0)
  const ohneNull = fa.ziffern.filter((z) => z > 0);
  fa.weltMenge = Math.max(...ohneNull.filter((z) => z <= 5), 0) || Math.min(...ohneNull);
  const n = fa.weltMenge;
  inEcht({ z: fa, nr, aktuell: faAktuell, ansage: faAnsage, buehne: $('#faecher-feld'), knopf: $('#btn-faecher-daumen'),
    karteHtml: `${zifferSvg(n)}${korbKarteSvg(Math.min(n, 5)).replace('<svg', n > 5 ? '<svg hidden' : '<svg')}`,
    sagen: (nr2) => faAnsage(nr2, `faecher-welt-${n}`), zeit: FAECHER_ZEIT, karteKlasse: 'gross' });
}

async function faecherAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(fa, $('#btn-faecher-daumen'));
  if (!karte) return;
  if (!(await faAnsage(nr, 'zeig-mal'))) return;
  const punkte = [...karte.querySelectorAll('svg:not([hidden]) .karte-punkt')];
  if (!(await faZaehlen(nr, `zaehlen-${fa.weltMenge}`, punkte))) return;
  glockenspiel();
  await warten(400);
  if (!(await faAnsage(nr, 'faecher-welt-fertig'))) return;
  spielEnde('faecher', faecherNeu);
}

$('#btn-faecher-daumen').addEventListener('click', () => { audio(); if (fa.inEcht) faecherAuftragErledigt(fa.nummer); });

function faecherNeu() {
  faecherStoppen();
  Object.assign(fa, { ziffern: ziffernRundenPlanen(), fachNr: 0, fertig: false, inEcht: false, auftrag: false,
    sprech: { kette: Promise.resolve(), offen: 0 } });
  $('#btn-faecher-daumen').hidden = true;
  faFeldAufbauen();
  faFachStarten();
}

function faecherStarten() {
  spielEndeWeg('faecher');
  zeigen('faecher');
  faecherNeu();
}
SPIELE.faecher = faecherStarten;
// Kachel: drei Fächer mit 1 2 3, zwei Stäbchen liegen schon im zweiten
$('#home .spiel-btn[data-spiel="faecher"]').innerHTML = '<svg class="kachel-bild" viewBox="0 0 100 100" aria-hidden="true">'
  + '<rect x="6" y="40" width="88" height="44" rx="6" fill="#f6efe3" stroke="#4a3f35" stroke-width="3"/>'
  + '<line x1="35" y1="40" x2="35" y2="84" stroke="#4a3f35" stroke-width="3"/><line x1="65" y1="40" x2="65" y2="84" stroke="#4a3f35" stroke-width="3"/>'
  + [1, 2, 3].map((z, i) => zifferSvg(z).replace('class="ziffer-svg"', `x="${10 + i * 30}" y="8" width="22" height="28"`)).join('')
  + '<rect x="45" y="48" width="5" height="30" rx="2.5" fill="#c98f4e" stroke="#4a3f35" stroke-width="1.5"/>'
  + '<rect x="53" y="48" width="5" height="30" rx="2.5" fill="#c98f4e" stroke="#4a3f35" stroke-width="1.5"/></svg>';

$('#btn-faecher-home').addEventListener('click', () => { faecherStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: Auftrag des aktuellen Fachs nochmal (nicht während gezählt wird)
$('#btn-faecher-laut').addEventListener('click', () => {
  const ende = $('#faecher .spiel-ende');
  if ((ende && !ende.hidden) || fa.fertig || fa.gesperrt || fa.ziehen || fa.sprech.offen) return;
  audio();
  if (fa.inEcht) { inEchtNochmal(fa); return; }
  fa.gesperrt = true;
  faAnsage(fa.nummer, `faecher-leg-${faFach().ziffer}`).then((ok) => { if (ok) { fa.gesperrt = false; faHilfeAbwarten(fa.nummer); } });
});
window.addEventListener('resize', () => { if ($('#faecher').classList.contains('active') && !fa.auftrag) faAnordnen(); });

// ---------- Jedem eins (ab 3): eins zu eins zuordnen, ganz ohne Zählen ----------
// Kuscheltiere sitzen am Tisch, das Kind schiebt jedem einen Teller hin (dann Becher, dann Löffel – Wörter mit gleichem
// Plural). Ein Teller bleibt nur auf einem freien Platz; wer etwas bekommt, hüpft vor Freude (Selbstkontrolle ohne
// „falsch“). Im Vorrat liegen genau so viele Dinge wie Tiere: am Ende hat jeder eins, keins bleibt übrig.
// Erst ganz am Ende fällt eine Zahl: „Jeder hat einen Teller. Drei Tiere, drei Teller – gleich viele!“
// Zum Schluss in echt: „Deck den Tisch: Leg für jeden einen Löffel hin!“
const JEDEM_RUNDEN = [{ n: 2, ding: 'teller' }, { n: 3, ding: 'becher' }, { n: 4, ding: 'loeffel' }];
const JEDEM_TIERE = ['🐻', '🐰', '🐸', '🦊'];
const JEDEM_ZEIT = { hilfe: 12000, rundenPause: 900, daumen: 6000, auftragNochmal: 16000 };
const JEDEM_DINGE = {
  teller: '<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="54" rx="46" ry="30" fill="#ffffff" stroke="#c7b08a" stroke-width="5"/>'
    + '<ellipse cx="50" cy="54" rx="30" ry="18" fill="#f6efe3" stroke="#e3d8c6" stroke-width="3"/></svg>',
  becher: HOL_DINGE.becher.svg,
  loeffel: HOL_DINGE.loeffel.svg,
};
const je = { runde: 0, plaetze: [], dinge: [], ziehen: null, gesperrt: true, timer: null, nummer: 0, fertig: false,
  inEcht: false, auftrag: false, mass: null };
const jeBausteine = spielBausteine('jedem', je);
const { aktuell: jeAktuell, ansage: jeAnsage } = jeBausteine;
const jeRunde = () => JEDEM_RUNDEN[je.runde];

function jedemStoppen() {
  jeBausteine.stoppen();
  je.ziehen = null;
}

function jeRundenZeichnen() {
  $('#jedem-runden').innerHTML = `<span class="gruppe">${
    JEDEM_RUNDEN.map((_, i) => `<span class="${i < je.runde ? 'voll' : ''}"></span>`).join('')}</span>`;
}

// Maße: Tiere oben am Tisch (je ein Platz davor), Vorrat unten; alles gleich groß, gleicher Abstand
function jeMasse() {
  const feld = $('#jedem-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const n = je.plaetze.length;
  const S = Math.min(96, (W - 40) / (n + 1), H * 0.16);
  const abstand = Math.min(S * 1.5, (W - 32 - S) / Math.max(1, n - 1));
  const x0 = W / 2 - ((n - 1) * abstand) / 2;
  const tierY = Math.max(S * 0.7, H * 0.14);
  const platzY = tierY + S * 1.15;
  const vorratY = Math.min(H - S - (W > H ? 20 : 96), platzY + S * 2.4);
  return { W, H, S, abstand, x0, tierY, platzY, vorratY, tischOben: tierY + S * 0.55, tischUnten: platzY + S * 0.7 };
}

function jeDingSetzen(d, x, y) {
  const { W, H, S } = je.mass;
  d.x = Math.max(S / 2, Math.min(W - S / 2, x));
  d.y = Math.max(S / 2, Math.min(H - S / 2, y));
  d.el.style.transform = `translate(${d.x - S / 2}px, ${d.y - S / 2}px)`;
}

function jeAnordnen() {
  const feld = $('#jedem-feld');
  if (!feld.clientWidth || !je.plaetze.length) return;
  je.mass = jeMasse();
  const { S, abstand, x0, tierY, platzY, vorratY, tischOben, tischUnten, W } = je.mass;
  Object.assign(feld.querySelector('.jedem-tisch').style, { top: `${tischOben}px`, height: `${tischUnten - tischOben}px` });
  je.plaetze.forEach((p, i) => {
    p.x = x0 + i * abstand;
    p.y = platzY;
    Object.assign(p.tierEl.style, { left: `${p.x - S / 2}px`, top: `${tierY - S / 2}px`, width: `${S}px`, height: `${S}px`, fontSize: `${S * 0.8}px` });
    Object.assign(p.el.style, { left: `${p.x - S * 0.52}px`, top: `${p.y - S * 0.42}px`, width: `${S * 1.04}px`, height: `${S * 0.84}px` });
  });
  feld.querySelectorAll('.jedem-ding').forEach((el) => Object.assign(el.style, { width: `${S}px`, height: `${S}px` }));
  const frei = je.dinge.filter((d) => !d.platz);
  const vAbstand = Math.min(S * 1.5, (W - 32 - S) / Math.max(1, frei.length - 1));
  frei.forEach((d, i) => jeDingSetzen(d, W / 2 - ((frei.length - 1) * vAbstand) / 2 + i * vAbstand, vorratY));
  je.plaetze.forEach((p) => { if (p.ding) jeDingSetzen(p.ding, p.x, p.y); });
}

async function jedemNeueRunde() {
  jedemStoppen();
  const nr = je.nummer;
  const { n, ding } = jeRunde();
  const feld = $('#jedem-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = '<div class="jedem-tisch"></div>';
  je.plaetze = mischen(JEDEM_TIERE).slice(0, n).map((tier) => {
    const tierEl = document.createElement('div');
    tierEl.className = 'jedem-tier';
    tierEl.textContent = tier;
    const el = document.createElement('div');
    el.className = 'jedem-platz';
    feld.append(tierEl, el);
    return { tierEl, el, ding: null, x: 0, y: 0 };
  });
  je.dinge = Array.from({ length: n }, () => {
    const el = document.createElement('div');
    el.className = 'jedem-ding';
    el.style.transition = 'none';
    el.innerHTML = JEDEM_DINGE[ding];
    feld.appendChild(el);
    const d = { el, x: 0, y: 0, platz: null };
    el.ding = d;
    return d;
  });
  jeAnordnen();
  void feld.offsetWidth;
  je.dinge.forEach((d) => { d.el.style.transition = ''; });
  if (!(await jeAnsage(nr, `jedem-start-${ding}`))) return;
  je.gesperrt = false;
  jeHilfeAbwarten(nr);
}

// Lange nichts hingelegt: Auftrag nochmal, ein freier Platz pulsiert sanft (kein Zeitdruck)
function jeHilfeAbwarten(nr) {
  clearTimeout(je.timer);
  je.timer = setTimeout(async () => {
    if (!jeAktuell(nr) || je.gesperrt || je.ziehen) { jeHilfeAbwarten(nr); return; }
    je.gesperrt = true;
    if (!(await jeAnsage(nr, `jedem-start-${jeRunde().ding}`))) return;
    je.gesperrt = false;
    const frei = je.plaetze.find((p) => !p.ding);
    if (frei) animieren(frei.el, 'pulsiert');
    jeHilfeAbwarten(nr);
  }, JEDEM_ZEIT.hilfe);
}

$('#jedem-feld').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.jedem-ding');
  if (!el || !el.ding || el.ding.platz) return;
  e.preventDefault();
  if (je.ziehen || je.gesperrt || je.auftrag) return;
  audio();
  je.ziehen = { d: el.ding, id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld: $('#jedem-feld').getBoundingClientRect(), nr: je.nummer };
  el.classList.add('greift');
  try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = je.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  if (z.bewegt) jeDingSetzen(z.d, e.clientX - z.feld.left, e.clientY - z.feld.top - 30);
});

function jeLoslassen(e) {
  const z = je.ziehen;
  if (!z || e.pointerId !== z.id) return;
  je.ziehen = null;
  z.d.el.classList.remove('greift');
  if (z.nr !== je.nummer || !jeAktuell(z.nr)) return;
  if (!z.bewegt) { animieren(z.d.el, 'huepft'); return; }
  // Nächster freier Platz in Reichweite (großzügig: bis eine Ding-Breite daneben)
  const { S, tischUnten } = je.mass;
  const frei = je.plaetze.filter((p) => !p.ding).map((p) => ({ p, a: Math.hypot(p.x - z.d.x, p.y - z.d.y) }))
    .sort((a, b) => a.a - b.a)[0];
  if (frei && frei.a <= S * 1.1) { jeHinlegen(z.d, frei.p); return; }
  // Daneben oder auf einem belegten Platz: bleibt liegen, aber unterhalb des Tisches (nichts liegt halb auf einem Platz)
  if (z.d.y < tischUnten + S / 2) jeDingSetzen(z.d, z.d.x, tischUnten + S / 2 + 8);
}
document.addEventListener('pointerup', jeLoslassen);
document.addEventListener('pointercancel', jeLoslassen);

async function jeHinlegen(d, p) {
  const nr = je.nummer;
  d.platz = p;
  p.ding = d;
  jeDingSetzen(d, p.x, p.y);
  animieren(p.tierEl, 'huepft');   // Freude: das Tier hat seins
  jeKlang(je.plaetze.filter((x) => x.ding).length);
  if (je.plaetze.some((x) => !x.ding)) { jeHilfeAbwarten(nr); return; }
  // Jeder hat eins: erst jetzt die Zahl – „Drei Tiere, drei Teller – gleich viele!“
  je.gesperrt = true;
  clearTimeout(je.timer);
  await warten(500);
  if (!jeAktuell(nr)) return;
  glockenspiel();
  je.plaetze.forEach((x) => x.ding.el.classList.add('leuchtet'));
  const { n, ding } = jeRunde();
  if (!(await jeAnsage(nr, `jedem-fertig-${n}-${ding}`))) return;
  je.runde++;
  jeRundenZeichnen();
  await warten(JEDEM_ZEIT.rundenPause);
  if (!jeAktuell(nr)) return;
  if (je.runde < JEDEM_RUNDEN.length) jedemNeueRunde(); else jedemAuftrag();
}

// Kleiner heller Ton beim Hinlegen (kein Zahlwort: hier geht es ums Zuordnen, nicht ums Zählen)
function jeKlang(k) {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator(), gain = c.createGain(), t = c.currentTime;
  osc.frequency.value = 660 + k * 90;
  gain.gain.setValueAtTime(0.16, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.24);
}

// ----- Echte Welt: „Deck den Tisch: Leg für jeden einen Löffel hin!“ -----

function jedemAuftrag() {
  jedemStoppen();
  const nr = je.nummer;
  je.auftrag = true;
  je.fertig = false;
  $('#btn-jedem-daumen').hidden = true;
  inEcht({ z: je, nr, aktuell: jeAktuell, ansage: jeAnsage, buehne: $('#jedem-feld'), knopf: $('#btn-jedem-daumen'),
    karteHtml: `<span class="karte-ding">${JEDEM_DINGE.teller}</span><span class="karte-ding">${JEDEM_DINGE.loeffel}</span>`,
    sagen: (nr2) => jeAnsage(nr2, 'jedem-welt'), zeit: JEDEM_ZEIT, karteKlasse: 'gross' });
}

async function jedemAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(je, $('#btn-jedem-daumen'));
  if (!karte) return;
  animieren(karte, 'huepft');
  glockenspiel();
  await warten(400);
  if (!(await jeAnsage(nr, 'jedem-welt-fertig'))) return;
  spielEnde('jedem', jedemNeu);
}

$('#btn-jedem-daumen').addEventListener('click', () => { audio(); if (je.inEcht) jedemAuftragErledigt(je.nummer); });

function jedemNeu() {
  jedemStoppen();
  Object.assign(je, { runde: 0, fertig: false, inEcht: false, auftrag: false });
  $('#btn-jedem-daumen').hidden = true;
  jeRundenZeichnen();
  jedemNeueRunde();
}

function jedemStarten() {
  spielEndeWeg('jedem');
  zeigen('jedem');
  jedemNeu();
}
SPIELE.jedem = jedemStarten;
// Kachel: zwei Tiere, jedes mit seinem Teller
$('#home .spiel-btn[data-spiel="jedem"]').innerHTML = '<span class="kachel-jedem"><span>🐻</span><span>🐰</span>'
  + `<span class="k-ding">${JEDEM_DINGE.teller}</span><span class="k-ding">${JEDEM_DINGE.teller}</span></span>`;

$('#btn-jedem-home').addEventListener('click', () => { jedemStoppen(); wiedergabeStoppen(); zurStartseite(); });
$('#btn-jedem-laut').addEventListener('click', () => {
  const ende = $('#jedem .spiel-ende');
  if ((ende && !ende.hidden) || je.fertig || je.gesperrt || je.ziehen) return;
  audio();
  if (je.inEcht) { inEchtNochmal(je); return; }
  je.gesperrt = true;
  jeAnsage(je.nummer, `jedem-start-${jeRunde().ding}`).then((ok) => { if (ok) { je.gesperrt = false; jeHilfeAbwarten(je.nummer); } });
});
window.addEventListener('resize', () => { if ($('#jedem').classList.contains('active') && !je.auftrag) jeAnordnen(); });

// ---------- Zahlen-Hüpfen (ab 3): die Zahlwortreihe als Abzählvers ----------
// Ein Frosch hüpft über Steine im Teich. Erst macht die App es vor: der ganze Vers in einem Zug („Eins, zwei, drei,
// vier, fünf. Der Frosch ist da!“), bei jeder Zahl ein Hüpfer. Dann schiebt das Kind den Frosch von Stein zu Stein,
// jeder Stein hat sein Zahlwort; am Ende die letzte Zahl betont: „Fünf Steine!“ Daneben losgelassen hüpft der Frosch
// auf seinen Stein zurück (ins Wasser fällt er nicht – kein „falsch“). Mit Eltern-Schalter bis zehn.
// Zum Schluss in echt: „Jetzt hüpfst du! Fünfmal – wir zählen zusammen.“ Nach 👍 zählt die App langsam mit.
// Hinweis für Eltern: Aufsagen ist noch kein Mengenverständnis – dafür sind die anderen Spiele da.
const HUEPFEN_ZEIT = { hilfe: 10000, vormachenPause: 700, daumen: 5000, auftragNochmal: 16000 };
const hp = { n: 5, stein: 0, fehlgriffe: 0, steine: [], ziehen: null, gesperrt: true, timer: null, nummer: 0, fertig: false, inEcht: false,
  auftrag: false, mass: null, sprech: { kette: Promise.resolve(), offen: 0 } };
const hpBausteine = spielBausteine('huepfen', hp);
const { aktuell: hpAktuell, ansage: hpAnsage, zaehlen: hpZaehlen } = hpBausteine;

function huepfenStoppen() {
  hpBausteine.stoppen();
  hp.ziehen = null;
}

// Start am Ufer (grüner Grasstreifen, sieht nicht aus wie ein Stein), dann die Steine auf einem Schlangenweg.
// Vom Ufer zum ersten Stein ist es genau so weit wie von Stein zu Stein: „eins“ ist ein ganzer, sichtbarer Hüpfer
// (sonst sieht es aus, als säße der Frosch schon auf Stein 1 – und das Kind zählt Steine statt Hüpfer).
// Hochkant: Ufer unten, Steine im Zickzack nach oben (die Hand verdeckt beim Schieben nicht den nächsten Stein);
// quer: Ufer links, Steine nach rechts (bei zehn in zwei Reihen hin und zurück).
function hpMasse() {
  const feld = $('#huepfen-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const quer = W > H;
  const n = hp.n;
  const rand = 12;   // Teich-Rand (wie .teich)
  let S, stellen, start, ufer;
  if (quer) {
    const reihen = n > 5 ? 2 : 1;
    const proReihe = Math.ceil(n / reihen);
    S = Math.min(84, (W - 80) / ((proReihe + 1) * 1.5), (H - 40) / (reihen * 2.2));
    const U = S * 1.6;
    ufer = { x: rand, y: 8, w: U, h: H - 8 - rand };
    const zeile = (r) => (H / (reihen + 1)) * (r + 1);
    start = [rand + U / 2, zeile(0)];
    const schritt = (W - 40 - S / 2 - start[0]) / proReihe;
    stellen = Array.from({ length: n }, (_, i) => {
      const r = Math.floor(i / proReihe), k = i % proReihe;
      const spalte = r % 2 ? proReihe - 1 - k : k;   // zweite Reihe läuft zurück (Schlangenweg)
      return [start[0] + (spalte + 1) * schritt, zeile(r) + (k % 2 ? -1 : 1) * S * 0.28];
    });
  } else {
    S = Math.min(84, W * 0.22, (H - 60) / (n * 0.95 + 2.2));
    const U = S * 1.5;
    ufer = { x: rand, y: H - rand - U, w: W - 2 * rand, h: U };
    const x = (k) => W / 2 + (k % 2 ? -1 : 1) * W * 0.18;   // Platz 0 (Ufer) rechts, Stein 1 links, …
    start = [x(0), H - rand - U / 2];
    const schritt = (start[1] - (24 + S / 2)) / n;
    stellen = Array.from({ length: n }, (_, i) => [x(i + 1), start[1] - (i + 1) * schritt]);
  }
  return { W, H, S, stellen, start, ufer, greif: S * 1.3 };
}

// Greifbereich des Frosches größer als das Bild (kleine Finger treffen leichter)
function hpFroschSetzen(x, y) {
  const { greif } = hp.mass;
  hp.frosch.style.transform = `translate(${x - greif / 2}px, ${y - greif * 0.62}px)`;
  hp.frosch.dataset.x = x;
  hp.frosch.dataset.y = y;
}

function hpAnordnen() {
  const feld = $('#huepfen-feld');
  if (!feld.clientWidth || !hp.steine.length) return;
  hp.mass = hpMasse();
  const { S, stellen, ufer, greif } = hp.mass;
  Object.assign(feld.querySelector('.ufer').style, { left: `${ufer.x}px`, top: `${ufer.y}px`, width: `${ufer.w}px`, height: `${ufer.h}px` });
  hp.steine.forEach((el, i) => Object.assign(el.style, { left: `${stellen[i][0] - S / 2}px`, top: `${stellen[i][1] - S * 0.32}px`, width: `${S}px`, height: `${S * 0.64}px` }));
  Object.assign(hp.frosch.style, { width: `${greif}px`, height: `${greif}px`, fontSize: `${S * 0.8}px` });
  hpFroschAufStein();
}

// Frosch auf seinen Platz (hp.stein = wie viele schon gehüpft; 0 = am Ufer)
function hpFroschAufStein() {
  hpFroschSetzen(...(hp.stein === 0 ? hp.mass.start : hp.mass.stellen[hp.stein - 1]));
}

function hpFeldAufbauen() {
  const feld = $('#huepfen-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = '<div class="teich"></div><div class="ufer"></div>';
  hp.steine = Array.from({ length: hp.n }, () => {
    const el = document.createElement('div');
    el.className = 'stein';
    feld.appendChild(el);
    return el;
  });
  hp.frosch = document.createElement('div');
  hp.frosch.className = 'frosch';
  hp.frosch.innerHTML = '<span class="figur-bild">🐸</span>';   // Bewegung außen (Platz), Hüpfen innen
  hp.frosch.style.transition = 'none';
  feld.appendChild(hp.frosch);
  hp.stein = 0;
  hpAnordnen();
  void feld.offsetWidth;
  hp.frosch.style.transition = '';
}

// 1. Vormachen: der ganze Vers als eine Aufnahme, der Frosch hüpft im Takt (gleichmäßig über die Aufnahme verteilt)
async function huepfenVormachen() {
  huepfenStoppen();
  const nr = hp.nummer;
  hpFeldAufbauen();
  hp.gesperrt = true;
  await warten(500);
  if (!hpAktuell(nr)) return;
  // Jeder Hüpfer ein Bogen: ein Wort, ein Sprung
  const ok = await hpZaehlen(nr, `huepfen-vers-${hp.n}`, hp.steine, (i) => { hp.stein = i + 1; hpFroschAufStein(); animieren(hp.frosch, 'springt'); });
  if (!ok) return;
  await warten(HUEPFEN_ZEIT.vormachenPause);
  if (!hpAktuell(nr)) return;
  // 2. Jetzt das Kind: der Frosch freut sich kurz, verschwindet auf dem letzten Stein und taucht am Ufer wieder auf
  // (kein Gleiten quer über den Teich, kein Zurückhüpfen – das wäre Rückwärtszählen ohne Worte)
  animieren(hp.frosch, 'huepft');
  await warten(450);
  hp.frosch.classList.add('weg');
  hp.steine.forEach((s) => s.classList.remove('leuchtet'));
  await warten(550);
  if (!hpAktuell(nr)) return;
  hp.stein = 0;
  hp.fehlgriffe = 0;
  hp.frosch.style.transition = 'none';
  hpFroschAufStein();
  void hp.frosch.offsetWidth;
  hp.frosch.style.transition = '';
  hp.frosch.classList.remove('weg');
  animieren(hp.frosch, 'kommt');
  if (!(await hpAnsage(nr, 'huepfen-du'))) return;
  hp.gesperrt = false;
  // Gleich zeigen, wohin es geht: der erste Stein pulsiert, der Frosch hüpft einmal („mich kannst du nehmen“)
  animieren(hp.steine[0], 'pulsiert');
  animieren(hp.frosch, 'huepft');
  hpHilfeAbwarten(nr);
}

function hpHilfeAbwarten(nr) {
  clearTimeout(hp.timer);
  hp.timer = setTimeout(async () => {
    if (!hpAktuell(nr) || hp.gesperrt || hp.ziehen || hp.sprech.offen) { hpHilfeAbwarten(nr); return; }
    hp.gesperrt = true;
    animieren(hp.frosch, 'huepft');
    animieren(hp.steine[hp.stein], 'pulsiert');
    if (!(await hpAnsage(nr, hp.stein ? 'huepfen-weiter' : 'huepfen-du'))) return;
    hp.gesperrt = false;
    hpHilfeAbwarten(nr);
  }, HUEPFEN_ZEIT.hilfe);
}

$('#huepfen-feld').addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.frosch')) return;
  e.preventDefault();
  if (hp.ziehen || hp.gesperrt || hp.auftrag || hp.stein >= hp.n) return;
  audio();
  hp.ziehen = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld: $('#huepfen-feld').getBoundingClientRect(), nr: hp.nummer };
  hp.frosch.classList.add('greift');
  try { hp.frosch.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = hp.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  if (z.bewegt) hpFroschSetzen(e.clientX - z.feld.left, e.clientY - z.feld.top - 30);
});

function hpLoslassen(e) {
  const z = hp.ziehen;
  if (!z || e.pointerId !== z.id) return;
  hp.ziehen = null;
  hp.frosch.classList.remove('greift');
  if (z.nr !== hp.nummer || !hpAktuell(z.nr)) return;
  const [nx, ny] = hp.mass.stellen[hp.stein];
  const [hx, hy] = hp.stein === 0 ? hp.mass.start : hp.mass.stellen[hp.stein - 1];
  const x = Number(hp.frosch.dataset.x), y = Number(hp.frosch.dataset.y);
  // Nur der nächste Stein zählt (die Reihe bleibt fest) – und nur, wenn der Frosch dort näher ist als an seinem Platz
  // (ein kleines Wackeln ist kein Hüpfer); sonst hüpft er auf seinen Platz zurück
  const amZiel = Math.hypot(x - nx, y - ny);
  if (z.bewegt && amZiel <= hp.mass.S * 1.1 && amZiel < Math.hypot(x - hx, y - hy)) { hp.fehlgriffe = 0; hpAngekommen(); return; }
  hpFroschAufStein();
  if (!z.bewegt) { animieren(hp.frosch, 'huepft'); return; }
  setTimeout(() => animieren(hp.frosch, 'wackelt'), 330);   // „ich bin wieder da“, nachdem er zurückgeglitten ist
  // Daneben: sofort zeigen, welcher Stein dran ist; beim zweiten Mal auch sagen (kein „falsch“)
  animieren(hp.steine[hp.stein], 'pulsiert');
  if (++hp.fehlgriffe === 2 && !hp.gesperrt && !hp.sprech.offen) {
    hp.gesperrt = true;
    hpAnsage(z.nr, 'huepfen-naechster').then((ok) => { if (ok) { hp.gesperrt = false; hpHilfeAbwarten(z.nr); } });
  }
}
document.addEventListener('pointerup', hpLoslassen);
document.addEventListener('pointercancel', hpLoslassen);

async function hpAngekommen() {
  const nr = hp.nummer;
  hp.stein++;
  const k = hp.stein;
  hpFroschAufStein();
  animieren(hp.frosch, 'huepft');
  hp.steine[k - 1].classList.add('leuchtet');
  const fertig = k >= hp.n;
  if (fertig) { hp.gesperrt = true; clearTimeout(hp.timer); } else hpHilfeAbwarten(nr);
  const sp = hp.sprech;
  sp.offen++;
  sp.kette = sp.kette.then(() => hpAnsage(nr, `korb-zahl-${k}`)).finally(() => { sp.offen--; });
  if (!(await sp.kette) || !fertig) return;
  glockenspiel();
  animieren(hp.frosch, 'huepft');
  await warten(300);
  if (!(await hpAnsage(nr, `huepfen-ende-${hp.n}`))) return;
  await warten(600);
  if (hpAktuell(nr)) huepfenAuftrag();
}

// ----- Echte Welt: „Jetzt hüpfst du! Fünfmal – wir zählen zusammen.“ – nach 👍 zählt die App langsam mit -----

function huepfenAuftrag() {
  huepfenStoppen();
  const nr = hp.nummer;
  hp.auftrag = true;
  hp.fertig = false;
  $('#btn-huepfen-daumen').hidden = true;
  const punkte = Array.from({ length: hp.n }, (_, i) => `<circle class="karte-punkt" cx="${10 + (i % 5) * 20}" cy="${hp.n > 5 ? (i < 5 ? 30 : 70) : 50}" r="7"/>`).join('');
  inEcht({ z: hp, nr, aktuell: hpAktuell, ansage: hpAnsage, buehne: $('#huepfen-feld'), knopf: $('#btn-huepfen-daumen'),
    karteHtml: `<svg viewBox="0 0 100 100" aria-hidden="true">${punkte}</svg><span class="karte-bild">🐸</span>`,
    sagen: (nr2) => hpAnsage(nr2, `huepfen-welt-${hp.n}`), zeit: HUEPFEN_ZEIT });
}

async function huepfenAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(hp, $('#btn-huepfen-daumen'));
  if (!karte) return;
  if (!(await hpZaehlen(nr, `zaehlen-${hp.n}`, [...karte.querySelectorAll('.karte-punkt')]))) return;
  glockenspiel();
  await warten(400);
  if (!(await hpAnsage(nr, 'huepfen-fertig'))) return;
  spielEnde('huepfen', huepfenNeu);
}

$('#btn-huepfen-daumen').addEventListener('click', () => { audio(); if (hp.inEcht) huepfenAuftragErledigt(hp.nummer); });

function huepfenNeu() {
  huepfenStoppen();
  Object.assign(hp, { n: zustand.huepfenBis10 ? 10 : 5, stein: 0, fertig: false, inEcht: false, auftrag: false,
    sprech: { kette: Promise.resolve(), offen: 0 } });
  $('#btn-huepfen-daumen').hidden = true;
  huepfenVormachen();
}

function huepfenStarten() {
  spielEndeWeg('huepfen');
  zeigen('huepfen');
  huepfenNeu();
}
SPIELE.huepfen = huepfenStarten;
$('#home .spiel-btn[data-spiel="huepfen"]').innerHTML = '<span class="kachel-huepfen">🐸<span class="k-stein"></span><span class="k-stein"></span></span>';

$('#btn-huepfen-home').addEventListener('click', () => { huepfenStoppen(); wiedergabeStoppen(); zurStartseite(); });
// 🔊: nochmal vormachen (solange das Kind noch nicht losgehüpft ist), sonst „Jetzt du!“
$('#btn-huepfen-laut').addEventListener('click', () => {
  const ende = $('#huepfen .spiel-ende');
  if ((ende && !ende.hidden) || hp.fertig || hp.gesperrt || hp.ziehen || hp.sprech.offen) return;
  audio();
  if (hp.inEcht) { inEchtNochmal(hp); return; }
  if (hp.stein === 0) { huepfenVormachen(); return; }
  hp.gesperrt = true;
  hpAnsage(hp.nummer, 'huepfen-du').then((ok) => { if (ok) { hp.gesperrt = false; hpHilfeAbwarten(hp.nummer); } });
});
window.addEventListener('resize', () => { if ($('#huepfen').classList.contains('active') && !hp.auftrag && hp.steine.length) hpAnordnen(); });

// ---------- Zahlenweg (ab 4): gemeinsam auf einem geraden Weg von 1 bis 10 ----------
// Nach Ramani & Siegler (2008): ein gerades, durchnummeriertes Brett stärkt Zählen, Ziffern und Größenvorstellung.
// Ein Käfer, zwei Mitspieler, die abwechselnd würfeln: das Kind und der Teddy – sie bringen den Käfer gemeinsam ins
// Ziel (kein Gewinner, kein Vergleich). Der Würfel hat nur 1 oder 2 Punkte. Beim Ziehen sagt die Stimme die Zahl jedes
// Feldes („vier, fünf“). Das Kind schiebt den Käfer Feld für Feld (nur das nächste Feld zählt), der Teddy zieht selbst.
// Zum Schluss in echt: „Zählt zusammen die Treppenstufen, wenn ihr hochgeht!“
const WEG_FELDER = 10;
const WEG_ZEIT = { wurf: 700, teddySchritt: 900, wechsel: 900, hilfe: 12000, daumen: 6000, auftragNochmal: 18000 };
const wg = { feld: 0, wurf: 0, rest: 0, dran: 'kind', ziehen: null, gesperrt: true, timer: null, nummer: 0, fertig: false,
  inEcht: false, auftrag: false, mass: null, sprech: { kette: Promise.resolve(), offen: 0 } };
const wgBausteine = spielBausteine('weg', wg);
const { aktuell: wgAktuell, ansage: wgAnsage } = wgBausteine;
const WUERFEL_SEITE = { 1: [[50, 50]], 2: [[30, 30], [70, 70]] };

function wegStoppen() {
  wgBausteine.stoppen();
  wg.ziehen = null;
}

// Gerader Weg von links nach rechts (auch hochkant), Felder gleich groß; Würfel und Teddy darunter.
// Davor ein eigener Startplatz ohne Zahl (ein Blatt): der Käfer steht dort, nicht schon auf Feld 1 – sonst zählt
// man das Startfeld mit (bekannter Brettspiel-Fehler). 11 Plätze: Start + 10 Felder.
function wgMasse() {
  const feld = $('#weg-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const F = Math.min(84, (W - 24) / (WEG_FELDER + 1) - 4);
  const x0 = (W - (WEG_FELDER + 1) * (F + 4) + 4) / 2;
  const y = Math.min(H * 0.38, H / 2 - F);
  return { W, H, F, x0, y, start: [x0 + F / 2, y + F / 2], mitte: (i) => [x0 + (i + 1) * (F + 4) + F / 2, y + F / 2] };
}

function wgKaeferSetzen(x, y) {
  const { F } = wg.mass;
  const g = Math.max(40, Math.min(F * 0.8, 56));
  // Käfer sitzt über dem Feld (die Zahl bleibt sichtbar)
  wg.kaefer.style.transform = `translate(${x - g / 2}px, ${y - F / 2 - g * 0.9}px)`;
  wg.kaefer.dataset.x = x;
  wg.kaefer.dataset.y = y;
}

// Käfer auf sein Feld (0 = vor dem ersten Feld, am Start)
function wgKaeferAufFeld() {
  const { F, mitte } = wg.mass;
  wgKaeferSetzen(...(wg.feld === 0 ? wg.mass.start : mitte(wg.feld - 1)));
}

function wgAnordnen() {
  const feld = $('#weg-feld');
  if (!feld.clientWidth || !wg.kaefer) return;
  wg.mass = wgMasse();
  const { F, x0, y } = wg.mass;
  Object.assign(feld.querySelector('.weg-start').style, { left: `${x0}px`, top: `${y}px`, width: `${F}px`, height: `${F}px`, fontSize: `${F * 0.7}px` });
  feld.querySelectorAll('.weg-feld').forEach((el, i) => Object.assign(el.style, { left: `${x0 + (i + 1) * (F + 4)}px`, top: `${y}px`, width: `${F}px`, height: `${F}px` }));
  const g = Math.max(40, Math.min(F * 0.8, 56));
  Object.assign(wg.kaefer.style, { width: `${g}px`, height: `${g}px`, fontSize: `${g * 0.8}px` });
  wgKaeferAufFeld();
}

function wgFeldAufbauen() {
  const feld = $('#weg-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = '<div class="weg-start" aria-hidden="true">🍃</div>' + Array.from({ length: WEG_FELDER }, (_, i) => `<div class="weg-feld${i === WEG_FELDER - 1 ? ' ziel' : ''}">`
    + `${i === WEG_FELDER - 1 ? zifferSvg(1) + zifferSvg(0) : zifferSvg(i + 1)}</div>`).join('')
    + '<div class="weg-unten"><button class="weg-wuerfel" aria-label="Würfeln"></button><div class="weg-teddy" aria-hidden="true">🧸</div></div>';
  wg.kaefer = document.createElement('div');
  wg.kaefer.className = 'kaefer';
  wg.kaefer.innerHTML = '<span class="figur-bild">🐞</span>';
  wg.kaefer.style.transition = 'none';
  feld.appendChild(wg.kaefer);
  wgAnordnen();
  void feld.offsetWidth;
  wg.kaefer.style.transition = '';
  wgWuerfelZeigen(0);
  feld.querySelector('.weg-wuerfel').addEventListener('click', () => wgGewuerfelt());
}

const wgFelder = () => [...document.querySelectorAll('#weg-feld .weg-feld')];

// Würfelbild: 0 = leer; übrige Schritte = volle Punkte, gegangene = hohl
function wgWuerfelZeigen(n, rest = n) {
  const w = $('#weg-feld .weg-wuerfel');
  if (!w) return;
  w.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">${(WUERFEL_SEITE[n] || []).map(([x, y], i) =>
    `<circle class="menge-punkt${i >= rest ? ' weg' : ''}" cx="${x}" cy="${y}" r="13"/>`).join('')}</svg>`;
}

function wgDranZeigen() {
  const feld = $('#weg-feld');
  feld.querySelector('.weg-wuerfel').classList.toggle('dran', wg.dran === 'kind' && !wg.rest);
  feld.querySelector('.weg-teddy').classList.toggle('dran', wg.dran === 'teddy');
}

async function wegKindDran(nr) {
  wg.dran = 'kind';
  wg.rest = 0;
  wgWuerfelZeigen(0);
  wgDranZeigen();
  if (!(await wgAnsage(nr, 'weg-du'))) return;
  wg.gesperrt = false;
  wgHilfeAbwarten(nr);
}

function wgHilfeAbwarten(nr) {
  clearTimeout(wg.timer);
  wg.timer = setTimeout(async () => {
    if (!wgAktuell(nr) || wg.gesperrt || wg.ziehen || wg.sprech.offen || wg.dran !== 'kind') { if (wgAktuell(nr)) wgHilfeAbwarten(nr); return; }
    wg.gesperrt = true;
    const ok = await wgAnsage(nr, wg.rest ? `weg-schieb-${wg.rest}` : 'weg-du');
    if (!ok) return;
    if (wg.rest) animieren(wg.kaefer, 'huepft'); else animieren($('#weg-feld .weg-wuerfel'), 'huepft');
    wg.gesperrt = false;
    wgHilfeAbwarten(nr);
  }, WEG_ZEIT.hilfe);
}

// Würfeln: 1 oder 2 – nie über das Ziel hinaus
const wgWurf = () => Math.min(zufall([1, 2]), WEG_FELDER - wg.feld);

async function wgGewuerfelt() {
  if (wg.gesperrt || wg.dran !== 'kind' || wg.rest || wg.auftrag) return;
  audio();
  const nr = wg.nummer;
  wg.gesperrt = true;
  clearTimeout(wg.timer);
  const w = $('#weg-feld .weg-wuerfel');
  animieren(w, 'rollt');
  await warten(WEG_ZEIT.wurf);
  if (!wgAktuell(nr)) return;
  wg.wurf = wg.rest = wgWurf();
  wgWuerfelZeigen(wg.wurf);
  wgDranZeigen();
  if (!(await wgAnsage(nr, `weg-wurf-${wg.wurf}`))) return;
  if (!(await wgAnsage(nr, `weg-schieb-${wg.wurf}`))) return;
  wg.gesperrt = false;
  wgHilfeAbwarten(nr);
}

$('#weg-feld').addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.kaefer')) return;
  e.preventDefault();
  if (wg.ziehen || wg.gesperrt || wg.auftrag || wg.dran !== 'kind' || !wg.rest) return;
  audio();
  wg.ziehen = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld: $('#weg-feld').getBoundingClientRect(), nr: wg.nummer };
  wg.kaefer.classList.add('greift');
  try { wg.kaefer.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = wg.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  if (z.bewegt) wgKaeferSetzen(e.clientX - z.feld.left, e.clientY - z.feld.top + wg.mass.F * 0.5);
});

function wgLoslassen(e) {
  const z = wg.ziehen;
  if (!z || e.pointerId !== z.id) return;
  wg.ziehen = null;
  wg.kaefer.classList.remove('greift');
  if (z.nr !== wg.nummer || !wgAktuell(z.nr)) return;
  const [nx, ny] = wg.mass.mitte(wg.feld);
  const x = Number(wg.kaefer.dataset.x), y = Number(wg.kaefer.dataset.y);
  // Nur das nächste Feld zählt; sonst krabbelt der Käfer auf sein Feld zurück
  if (z.bewegt && Math.abs(x - nx) <= wg.mass.F * 0.75 && Math.abs(y - ny) <= wg.mass.F * 1.6) { wgSchritt(z.nr); return; }
  wgKaeferAufFeld();
}
document.addEventListener('pointerup', wgLoslassen);
document.addEventListener('pointercancel', wgLoslassen);

// Ein Feld weiter: die Zahl des Feldes; Würfel zeigt, wie viele noch fehlen; danach ist der Teddy dran (oder Ziel)
async function wgSchritt(nr) {
  wg.feld++;
  wg.rest--;
  wgKaeferAufFeld();
  wgFelder()[wg.feld - 1].classList.add('besucht');
  wgWuerfelZeigen(wg.wurf, wg.rest);
  const k = wg.feld;
  const sp = wg.sprech;
  sp.offen++;
  sp.kette = sp.kette.then(() => wgAnsage(nr, `korb-zahl-${k}`)).finally(() => { sp.offen--; });
  if (wg.rest > 0 && wg.feld < WEG_FELDER) { wgHilfeAbwarten(nr); return; }
  wg.gesperrt = true;
  clearTimeout(wg.timer);
  if (!(await sp.kette)) return;
  wgZugFertig(nr);
}

async function wgZugFertig(nr) {
  if (wg.feld >= WEG_FELDER) { wgZiel(nr); return; }
  await warten(WEG_ZEIT.wechsel);
  if (!wgAktuell(nr)) return;
  if (wg.dran === 'kind') wgTeddyDran(nr); else wegKindDran(nr);
}

// Der Teddy würfelt und zieht selbst – die Stimme sagt die Zahl jedes Feldes
async function wgTeddyDran(nr) {
  wg.dran = 'teddy';
  wg.rest = 0;
  wgWuerfelZeigen(0);
  wgDranZeigen();
  if (!(await wgAnsage(nr, 'weg-teddy'))) return;
  animieren($('#weg-feld .weg-wuerfel'), 'rollt');
  await warten(WEG_ZEIT.wurf);
  if (!wgAktuell(nr)) return;
  wg.wurf = wg.rest = wgWurf();
  wgWuerfelZeigen(wg.wurf);
  if (!(await wgAnsage(nr, `weg-wurf-${wg.wurf}`))) return;
  for (let i = 0; i < wg.wurf; i++) {
    await warten(WEG_ZEIT.teddySchritt / 2);
    if (!wgAktuell(nr)) return;
    wg.feld++;
    wg.rest--;
    wgKaeferAufFeld();
    wgFelder()[wg.feld - 1].classList.add('besucht');
    wgWuerfelZeigen(wg.wurf, wg.rest);
    if (!(await wgAnsage(nr, `korb-zahl-${wg.feld}`))) return;
  }
  wgZugFertig(nr);
}

async function wgZiel(nr) {
  glockenspiel();
  animieren(wg.kaefer, 'huepft');
  wgFelder().forEach((f) => f.classList.add('leuchtet'));
  if (!(await wgAnsage(nr, 'weg-ziel'))) return;
  await warten(700);
  if (wgAktuell(nr)) wegAuftrag();
}

// ----- Echte Welt: „Zählt zusammen die Treppenstufen, wenn ihr hochgeht!“ -----

function wegAuftrag() {
  wegStoppen();
  const nr = wg.nummer;
  wg.auftrag = true;
  wg.fertig = false;
  $('#btn-weg-daumen').hidden = true;
  const treppe = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M8 90 H30 V70 H50 V50 H70 V30 H92 V90 Z" fill="#e9d2b0" stroke="#4a3f35" stroke-width="4" stroke-linejoin="round"/></svg>';
  inEcht({ z: wg, nr, aktuell: wgAktuell, ansage: wgAnsage, buehne: $('#weg-feld'), knopf: $('#btn-weg-daumen'),
    karteHtml: `${treppe}<span class="karte-bild">👣</span>`, sagen: (nr2) => wgAnsage(nr2, 'weg-welt'), zeit: WEG_ZEIT });
}

async function wegAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(wg, $('#btn-weg-daumen'));
  if (!karte) return;
  animieren(karte, 'huepft');
  glockenspiel();
  await warten(400);
  if (!(await wgAnsage(nr, 'weg-welt-fertig'))) return;
  spielEnde('weg', wegNeu);
}

$('#btn-weg-daumen').addEventListener('click', () => { audio(); if (wg.inEcht) wegAuftragErledigt(wg.nummer); });

async function wegNeu() {
  wegStoppen();
  Object.assign(wg, { feld: 0, wurf: 0, rest: 0, dran: 'kind', fertig: false, inEcht: false, auftrag: false,
    sprech: { kette: Promise.resolve(), offen: 0 } });
  $('#btn-weg-daumen').hidden = true;
  wgFeldAufbauen();
  const nr = wg.nummer;
  wg.gesperrt = true;
  animieren($('#weg-feld .weg-start'), 'pulsiert');   // „Der Käfer wartet hier am Start“
  if (!(await wgAnsage(nr, 'weg-start'))) return;
  wegKindDran(nr);
}

function wegStarten() {
  spielEndeWeg('weg');
  zeigen('weg');
  wegNeu();
}
SPIELE.weg = wegStarten;
$('#home .spiel-btn[data-spiel="weg"]').innerHTML = '<span class="kachel-weg"><span class="k-kaefer">🐞</span><span class="k-felder">'
  + [1, 2, 3].map((z) => `<span>${zifferSvg(z)}</span>`).join('') + '</span></span>';

$('#btn-weg-home').addEventListener('click', () => { wegStoppen(); wiedergabeStoppen(); zurStartseite(); });
$('#btn-weg-laut').addEventListener('click', () => {
  const ende = $('#weg .spiel-ende');
  if ((ende && !ende.hidden) || wg.fertig || wg.gesperrt || wg.ziehen || wg.sprech.offen) return;
  audio();
  if (wg.inEcht) { inEchtNochmal(wg); return; }
  if (wg.dran !== 'kind') return;
  wg.gesperrt = true;
  wgAnsage(wg.nummer, wg.rest ? `weg-schieb-${wg.rest}` : 'weg-du').then((ok) => { if (ok) { wg.gesperrt = false; wgHilfeAbwarten(wg.nummer); } });
});
window.addEventListener('resize', () => { if ($('#weg').classList.contains('active') && !wg.auftrag && wg.kaefer) wgAnordnen(); });

// ---------- Zwei Nester (eher ab 4½): eine Menge zerlegen – „zwei hier und eins da, zusammen drei“ ----------
// Im großen Nest liegen Eier (3, dann 4, dann 5). Das Kind verteilt sie, wie es mag, auf zwei kleine Nester. Liegen
// alle, zählt die App jedes Nest und sagt: „Zwei hier und eins da. Zusammen sind es drei!“ Jede Aufteilung ist richtig
// (kein „falsch“) – erlebt wird: die Menge bleibt gleich, egal wie man sie teilt. Bewusst ohne Plus, ohne Ziffern.
// Zum Schluss in echt: „Nimm drei Bausteine und verteil sie auf deine zwei Hände!“
const NESTER_RUNDEN = [3, 4, 5];
const NESTER_ZEIT = { hilfe: 12000, rundenPause: 900, zaehlPause: 400, daumen: 6000, auftragNochmal: 16000 };
const EI_SVG = '<svg viewBox="0 0 80 100" aria-hidden="true"><ellipse cx="40" cy="54" rx="30" ry="40" fill="#fffaf0" stroke="#c7b08a" stroke-width="5"/>'
  + '<ellipse cx="30" cy="36" rx="7" ry="11" fill="#ffffff"/></svg>';
const ns = { runde: 0, eier: [], ziehen: null, gesperrt: true, timer: null, nummer: 0, fertig: false, inEcht: false,
  auftrag: false, mass: null };
const nsBausteine = spielBausteine('nester', ns);
const { aktuell: nsAktuell, ansage: nsAnsage, zaehlen: nsZaehlen } = nsBausteine;
const nsN = () => NESTER_RUNDEN[ns.runde];

function nesterStoppen() {
  nsBausteine.stoppen();
  ns.ziehen = null;
}

function nsRundenZeichnen() {
  $('#nester-runden').innerHTML = `<span class="gruppe">${
    NESTER_RUNDEN.map((_, i) => `<span class="${i < ns.runde ? 'voll' : ''}"></span>`).join('')}</span>`;
}

// Großes Nest oben in der Mitte, zwei kleine Nester unten links und rechts
function nsMasse() {
  const feld = $('#nester-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const quer = W > H;
  const S = Math.min(64, W * 0.13, H * 0.12);   // Ei
  const gross = { x: W / 2, y: quer ? H * 0.26 : H * 0.2, w: Math.min(W * 0.8, S * 6.5), h: S * 1.8 };
  const nestW = Math.min(W * 0.42, S * 4.2), nestH = S * 2.6;
  const untenY = quer ? H * 0.68 : H * 0.6;
  const links = { x: W / 2 - nestW / 2 - Math.min(24, W * 0.04), y: untenY, w: nestW, h: nestH };
  const rechts = { x: W / 2 + nestW / 2 + Math.min(24, W * 0.04), y: untenY, w: nestW, h: nestH };
  return { W, H, S, gross, nester: [links, rechts] };
}

// Plätze in einem Nest: nebeneinander, bei vielen in zwei Reihen (gleicher Abstand)
function nsPlatz(nest, i, anzahl) {
  const { S } = ns.mass;
  const proReihe = Math.max(1, Math.floor((nest.w - 12) / (S * 0.95)));
  const reihen = Math.ceil(anzahl / proReihe);
  const r = Math.floor(i / proReihe), inReihe = Math.min(proReihe, anzahl - r * proReihe);
  const k = i % proReihe;
  return [nest.x - ((inReihe - 1) * S * 0.95) / 2 + k * S * 0.95, nest.y - ((reihen - 1) * S * 1.1) / 2 + r * S * 1.1];
}

function nsEiSetzen(e, x, y) {
  const { W, H, S } = ns.mass;
  e.x = Math.max(S / 2, Math.min(W - S / 2, x));
  e.y = Math.max(S / 2, Math.min(H - S / 2, y));
  e.el.style.transform = `translate(${e.x - S / 2}px, ${e.y - S * 0.62}px)`;
}

function nsNestZeichnen(el, n) {
  Object.assign(el.style, { left: `${n.x - n.w / 2}px`, top: `${n.y - n.h / 2}px`, width: `${n.w}px`, height: `${n.h}px` });
}

function nsAnordnen() {
  const feld = $('#nester-feld');
  if (!feld.clientWidth || !ns.eier.length) return;
  ns.mass = nsMasse();
  const { S, gross, nester } = ns.mass;
  nsNestZeichnen(feld.querySelector('.nest.gross'), gross);
  feld.querySelectorAll('.nest.klein').forEach((el, i) => nsNestZeichnen(el, nester[i]));
  ns.eier.forEach((e) => Object.assign(e.el.style, { width: `${S}px`, height: `${S * 1.25}px` }));
  const imGrossen = ns.eier.filter((e) => e.nest === null);
  imGrossen.forEach((e, i) => nsEiSetzen(e, ...nsPlatz(gross, i, imGrossen.length)));
  [0, 1].forEach((k) => { const drin = ns.eier.filter((e) => e.nest === k); drin.forEach((e, i) => nsEiSetzen(e, ...nsPlatz(nester[k], i, drin.length))); });
}

async function nesterNeueRunde() {
  nesterStoppen();
  const nr = ns.nummer;
  const feld = $('#nester-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = '<div class="nest gross"></div><div class="nest klein"></div><div class="nest klein"></div>';
  ns.eier = Array.from({ length: nsN() }, () => {
    const el = document.createElement('div');
    el.className = 'ei';
    el.style.transition = 'none';
    el.innerHTML = EI_SVG;
    feld.appendChild(el);
    const e = { el, x: 0, y: 0, nest: null };
    el.ei = e;
    return e;
  });
  nsAnordnen();
  void feld.offsetWidth;
  ns.eier.forEach((e) => { e.el.style.transition = ''; });
  if (!(await nsAnsage(nr, `nester-start-${nsN()}`))) return;
  ns.gesperrt = false;
  nsHilfeAbwarten(nr);
}

function nsHilfeAbwarten(nr) {
  clearTimeout(ns.timer);
  ns.timer = setTimeout(async () => {
    if (!nsAktuell(nr) || ns.gesperrt || ns.ziehen) { nsHilfeAbwarten(nr); return; }
    ns.gesperrt = true;
    if (!(await nsAnsage(nr, 'nester-verteil'))) return;
    ns.gesperrt = false;
    const e = ns.eier.find((x) => x.nest === null);
    if (e) animieren(e.el, 'huepft');
    nsHilfeAbwarten(nr);
  }, NESTER_ZEIT.hilfe);
}

$('#nester-feld').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.ei');
  if (!el || !el.ei) return;
  e.preventDefault();
  if (ns.ziehen || ns.gesperrt || ns.auftrag) return;
  audio();
  ns.ziehen = { e: el.ei, id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld: $('#nester-feld').getBoundingClientRect(), nr: ns.nummer };
  el.classList.add('greift');
  try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = ns.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  if (z.bewegt) nsEiSetzen(z.e, e.clientX - z.feld.left, e.clientY - z.feld.top - 30);
});

// In welchem Nest liegt das Ei? (0 = links, 1 = rechts, null = großes Nest bzw. daneben); großzügig 30 px
function nsNestBei(x, y) {
  const drin = (n) => Math.abs(x - n.x) <= n.w / 2 + 30 && Math.abs(y - n.y) <= n.h / 2 + 30;
  const [l, r] = ns.mass.nester;
  if (drin(l)) return 0;
  if (drin(r)) return 1;
  return null;
}

function nsLoslassen(e) {
  const z = ns.ziehen;
  if (!z || e.pointerId !== z.id) return;
  ns.ziehen = null;
  z.e.el.classList.remove('greift');
  if (z.nr !== ns.nummer || !nsAktuell(z.nr)) return;
  if (!z.bewegt) { animieren(z.e.el, 'huepft'); return; }
  // Umlegen ist erlaubt (auch zurück ins große Nest): jedes Ei liegt immer in genau einem Nest
  z.e.nest = nsNestBei(z.e.x, z.e.y);
  nsAnordnen();
  if (z.e.nest !== null) nsKlang();
  if (ns.eier.some((x) => x.nest === null)) { nsHilfeAbwarten(z.nr); return; }
  nsAlleVerteilt(z.nr);
}
document.addEventListener('pointerup', nsLoslassen);
document.addEventListener('pointercancel', nsLoslassen);

function nsKlang() {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator(), gain = c.createGain(), t = c.currentTime;
  osc.frequency.value = 740;
  gain.gain.setValueAtTime(0.14, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.22);
}

// Alle Eier verteilt: links zählen, rechts zählen, dann „Zwei hier und eins da. Zusammen sind es drei!“
async function nsAlleVerteilt(nr) {
  ns.gesperrt = true;
  clearTimeout(ns.timer);
  await warten(NESTER_ZEIT.zaehlPause);
  if (!nsAktuell(nr)) return;
  const links = ns.eier.filter((e) => e.nest === 0), rechts = ns.eier.filter((e) => e.nest === 1);
  for (const teil of [links, rechts]) {
    if (teil.length && !(await nsZaehlen(nr, `zaehlen-${teil.length}`, teil.map((e) => e.el)))) return;
    await warten(NESTER_ZEIT.zaehlPause);
    if (!nsAktuell(nr)) return;
  }
  glockenspiel();
  ns.eier.forEach((e) => e.el.classList.add('leuchtet'));
  if (!(await nsAnsage(nr, `nester-${links.length}-${rechts.length}`))) return;
  ns.runde++;
  nsRundenZeichnen();
  await warten(NESTER_ZEIT.rundenPause);
  if (!nsAktuell(nr)) return;
  if (ns.runde < NESTER_RUNDEN.length) nesterNeueRunde(); else nesterAuftrag();
}

// ----- Echte Welt: „Nimm drei Bausteine und verteil sie auf deine zwei Hände!“ -----

function nesterAuftrag() {
  nesterStoppen();
  const nr = ns.nummer;
  ns.auftrag = true;
  ns.fertig = false;
  $('#btn-nester-daumen').hidden = true;
  inEcht({ z: ns, nr, aktuell: nsAktuell, ansage: nsAnsage, buehne: $('#nester-feld'), knopf: $('#btn-nester-daumen'),
    karteHtml: `${korbKarteSvg(3)}<span class="karte-bild">🤲</span>`, sagen: (nr2) => nsAnsage(nr2, 'nester-welt'), zeit: NESTER_ZEIT });
}

async function nesterAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(ns, $('#btn-nester-daumen'));
  if (!karte) return;
  if (!(await nsAnsage(nr, 'nester-welt-zeig'))) return;
  if (!(await nsZaehlen(nr, 'zaehlen-3', [...karte.querySelectorAll('.karte-punkt')]))) return;
  glockenspiel();
  await warten(400);
  if (!(await nsAnsage(nr, 'nester-welt-fertig'))) return;
  spielEnde('nester', nesterNeu);
}

$('#btn-nester-daumen').addEventListener('click', () => { audio(); if (ns.inEcht) nesterAuftragErledigt(ns.nummer); });

function nesterNeu() {
  nesterStoppen();
  Object.assign(ns, { runde: 0, fertig: false, inEcht: false, auftrag: false });
  $('#btn-nester-daumen').hidden = true;
  nsRundenZeichnen();
  nesterNeueRunde();
}

function nesterStarten() {
  spielEndeWeg('nester');
  zeigen('nester');
  nesterNeu();
}
SPIELE.nester = nesterStarten;
$('#home .spiel-btn[data-spiel="nester"]').innerHTML = '<svg class="kachel-bild" viewBox="0 0 100 100" aria-hidden="true">'
  + '<ellipse cx="27" cy="72" rx="22" ry="11" fill="#b98a5a" stroke="#4a3f35" stroke-width="3"/><ellipse cx="73" cy="72" rx="22" ry="11" fill="#b98a5a" stroke="#4a3f35" stroke-width="3"/>'
  + [[20, 58], [34, 58], [73, 58]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="9" fill="#fffaf0" stroke="#c7b08a" stroke-width="2.5"/>`).join('')
  + '<path d="M18 26 L34 40 M82 26 L66 40" stroke="#c7b08a" stroke-width="4" stroke-linecap="round"/>'
  + '<ellipse cx="50" cy="20" rx="7" ry="9" fill="#fffaf0" stroke="#c7b08a" stroke-width="2.5"/></svg>';

$('#btn-nester-home').addEventListener('click', () => { nesterStoppen(); wiedergabeStoppen(); zurStartseite(); });
$('#btn-nester-laut').addEventListener('click', () => {
  const ende = $('#nester .spiel-ende');
  if ((ende && !ende.hidden) || ns.fertig || ns.gesperrt || ns.ziehen) return;
  audio();
  if (ns.inEcht) { inEchtNochmal(ns); return; }
  ns.gesperrt = true;
  nsAnsage(ns.nummer, 'nester-verteil').then((ok) => { if (ok) { ns.gesperrt = false; nsHilfeAbwarten(ns.nummer); } });
});
window.addEventListener('resize', () => { if ($('#nester').classList.contains('active') && !ns.auftrag) nsAnordnen(); });

// ---------- Zahlentreppe (eher ab 4½): Mengen der Größe nach ordnen – jede Stufe hat einen mehr ----------
// Punktstangen 1 bis 5 (wie Perlenstäbchen, ohne Ziffern) liegen durcheinander. Unten ist die Treppe vorgezeichnet:
// jede Stufe hat den Umriss ihrer Stange – eine Stange rastet nur dort ein, wo sie passt (Selbstkontrolle des
// Materials, kein „falsch“: sonst bleibt sie einfach liegen). Rastet sie ein, zählt die App ihre Punkte.
// Ist die Treppe fertig, läuft ein Käfer hinauf: „Eins, zwei, drei, vier, fünf. Jede Stufe hat einen mehr!“
// Zum Schluss in echt: „Bau eine Treppe aus Bausteinen: einer, dann zwei, dann drei!“
const TREPPE_N = 5;
const TREPPE_ZEIT = { hilfe: 12000, fertigPause: 500, daumen: 6000, auftragNochmal: 16000 };
const tp = { stangen: [], ziehen: null, gesperrt: true, timer: null, nummer: 0, fertig: false, inEcht: false, auftrag: false,
  mass: null };
const tpBausteine = spielBausteine('treppe', tp);
const { aktuell: tpAktuell, ansage: tpAnsage, zaehlen: tpZaehlen } = tpBausteine;

function treppeStoppen() {
  tpBausteine.stoppen();
  tp.ziehen = null;
}

function tpStangeSvg(n) {
  return `<svg viewBox="0 0 30 ${n * 30}" aria-hidden="true"><rect x="2" y="2" width="26" height="${n * 30 - 4}" rx="8" fill="#e6b47a" stroke="#4a3f35" stroke-width="3"/>`
    + Array.from({ length: n }, (_, i) => `<circle class="menge-punkt" cx="15" cy="${15 + i * 30}" r="8"/>`).join('') + '</svg>';
}

// Treppe unten (Stufe k steht bei x = k, ist k Punkte hoch), Vorrat oben – gleicher Abstand, gleiche Punktgröße
function tpMasse() {
  const feld = $('#treppe-feld');
  const W = feld.clientWidth, H = feld.clientHeight;
  const quer = W > H;
  const E = Math.min(56, (H - (quer ? 40 : 140)) / (TREPPE_N * 2 + 1.5), (W - 40) / (TREPPE_N * 2.2));   // Punkt-Einheit
  const B = E;   // Breite einer Stange
  const lueckeT = 6;
  const treppeW = TREPPE_N * B + (TREPPE_N - 1) * lueckeT;
  const tx0 = (W - treppeW) / 2;
  const boden = H - (quer ? 16 : 96);
  const stufen = Array.from({ length: TREPPE_N }, (_, i) => ({ n: i + 1, x: tx0 + i * (B + lueckeT) + B / 2, unten: boden }));
  const vAbstand = Math.min(B * 2, (W - 40 - B) / (TREPPE_N - 1));
  const vorratUnten = boden - TREPPE_N * E - 24;
  return { W, H, E, B, stufen, vAbstand, vorratUnten };
}

function tpStangeSetzen(s, x, unten) {
  const { W, B, E } = tp.mass;
  const h = s.n * E;
  s.x = Math.max(B / 2, Math.min(W - B / 2, x));
  s.unten = Math.max(h, unten);
  s.el.style.transform = `translate(${s.x - B / 2}px, ${s.unten - h}px)`;
}

function tpAnordnen() {
  const feld = $('#treppe-feld');
  if (!feld.clientWidth || !tp.stangen.length) return;
  tp.mass = tpMasse();
  const { W, B, E, stufen, vAbstand, vorratUnten } = tp.mass;
  feld.querySelectorAll('.stufe').forEach((el, i) => {
    const st = stufen[i];
    Object.assign(el.style, { left: `${st.x - B / 2}px`, top: `${st.unten - st.n * E}px`, width: `${B}px`, height: `${st.n * E}px` });
  });
  tp.stangen.forEach((s) => Object.assign(s.el.style, { width: `${B}px`, height: `${s.n * E}px` }));
  const lose = tp.stangen.filter((s) => !s.drin);
  lose.forEach((s, i) => tpStangeSetzen(s, W / 2 - ((lose.length - 1) * vAbstand) / 2 + i * vAbstand, vorratUnten));
  tp.stangen.filter((s) => s.drin).forEach((s) => tpStangeSetzen(s, stufen[s.n - 1].x, stufen[s.n - 1].unten));
}

async function treppeNeu() {
  treppeStoppen();
  const nr = tp.nummer;
  Object.assign(tp, { fertig: false, inEcht: false, auftrag: false });
  $('#btn-treppe-daumen').hidden = true;
  const feld = $('#treppe-feld');
  feld.closest('.screen').classList.remove('ruhig');
  feld.innerHTML = Array.from({ length: TREPPE_N }, () => '<div class="stufe"></div>').join('');
  // Durcheinander, aber nie schon fertig sortiert
  let folge;
  do folge = mischen(Array.from({ length: TREPPE_N }, (_, i) => i + 1)); while (folge.every((n, i) => n === i + 1));
  tp.stangen = folge.map((n) => {
    const el = document.createElement('div');
    el.className = 'stange';
    el.style.transition = 'none';
    el.innerHTML = tpStangeSvg(n);
    feld.appendChild(el);
    const s = { el, n, x: 0, unten: 0, drin: false };
    el.stange = s;
    return s;
  });
  tpAnordnen();
  void feld.offsetWidth;
  tp.stangen.forEach((s) => { s.el.style.transition = ''; });
  tp.gesperrt = true;
  if (!(await tpAnsage(nr, 'treppe-start'))) return;
  tp.gesperrt = false;
  tpHilfeAbwarten(nr);
}

// Lange nichts eingerastet: die Stufe für die kleinste lose Stange pulsiert (sie passt dort genau)
function tpHilfeAbwarten(nr) {
  clearTimeout(tp.timer);
  tp.timer = setTimeout(async () => {
    if (!tpAktuell(nr) || tp.gesperrt || tp.ziehen) { tpHilfeAbwarten(nr); return; }
    tp.gesperrt = true;
    if (!(await tpAnsage(nr, 'treppe-hilfe'))) return;
    tp.gesperrt = false;
    const kleinste = tp.stangen.filter((s) => !s.drin).sort((a, b) => a.n - b.n)[0];
    if (kleinste) {
      animieren($('#treppe-feld').querySelectorAll('.stufe')[kleinste.n - 1], 'pulsiert');
      animieren(kleinste.el, 'huepft');
    }
    tpHilfeAbwarten(nr);
  }, TREPPE_ZEIT.hilfe);
}

$('#treppe-feld').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.stange');
  if (!el || !el.stange || el.stange.drin) return;
  e.preventDefault();
  if (tp.ziehen || tp.gesperrt || tp.auftrag) return;
  audio();
  const s = el.stange;
  const feldR = $('#treppe-feld').getBoundingClientRect();
  // Greifpunkt merken: die Stange hängt dort am Finger, wo sie gegriffen wurde
  tp.ziehen = { s, id: e.pointerId, sx: e.clientX, sy: e.clientY, bewegt: false, feld: feldR, nr: tp.nummer,
    dx: s.x - (e.clientX - feldR.left), dy: s.unten - (e.clientY - feldR.top) };
  el.classList.add('greift');
  try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse (Tests) */ }
});

document.addEventListener('pointermove', (e) => {
  const z = tp.ziehen;
  if (!z || e.pointerId !== z.id) return;
  if (Math.hypot(e.clientX - z.sx, e.clientY - z.sy) > 8) z.bewegt = true;
  if (z.bewegt) tpStangeSetzen(z.s, e.clientX - z.feld.left + z.dx, e.clientY - z.feld.top + z.dy - 20);
});

function tpLoslassen(e) {
  const z = tp.ziehen;
  if (!z || e.pointerId !== z.id) return;
  tp.ziehen = null;
  z.s.el.classList.remove('greift');
  if (z.nr !== tp.nummer || !tpAktuell(z.nr)) return;
  if (!z.bewegt) { animieren(z.s.el, 'huepft'); return; }
  const { stufen, B, E, vorratUnten } = tp.mass;
  const st = stufen[z.s.n - 1];
  // Nur auf ihrer eigenen Stufe rastet die Stange ein (großzügig: eine Stangenbreite daneben)
  if (Math.abs(z.s.x - st.x) <= B * 1.1 && Math.abs(z.s.unten - st.unten) <= E * 2) { tpEinrasten(z.s); return; }
  // Sonst bleibt sie liegen – über der Treppe, damit nichts halb in einer Stufe steckt
  if (z.s.unten > vorratUnten) tpStangeSetzen(z.s, z.s.x, vorratUnten);
}
document.addEventListener('pointerup', tpLoslassen);
document.addEventListener('pointercancel', tpLoslassen);

async function tpEinrasten(s) {
  const nr = tp.nummer;
  s.drin = true;
  const st = tp.mass.stufen[s.n - 1];
  tpStangeSetzen(s, st.x, st.unten);
  const fertig = tp.stangen.every((x) => x.drin);
  tp.gesperrt = true;
  clearTimeout(tp.timer);
  if (!(await tpZaehlen(nr, `zaehlen-${s.n}`, [...s.el.querySelectorAll('.menge-punkt')]))) return;
  s.el.querySelectorAll('.menge-punkt').forEach((p) => p.classList.remove('leuchtet'));
  if (!fertig) { tp.gesperrt = false; tpHilfeAbwarten(nr); return; }
  await warten(TREPPE_ZEIT.fertigPause);
  if (!tpAktuell(nr)) return;
  // Fertig: der Käfer läuft die Treppe hinauf – eine Stufe je Zahl
  const kaefer = document.createElement('div');
  kaefer.className = 'treppe-kaefer';
  kaefer.innerHTML = '<span class="figur-bild">🐞</span>';
  $('#treppe-feld').appendChild(kaefer);
  const { E, B } = tp.mass;
  const stangen = [...tp.stangen].sort((a, b) => a.n - b.n);
  const aufStufe = (i) => { const t = tp.mass.stufen[i]; kaefer.style.transform = `translate(${t.x - B / 2}px, ${t.unten - t.n * E - B}px)`; };
  Object.assign(kaefer.style, { width: `${B}px`, height: `${B}px`, fontSize: `${B * 0.8}px` });
  aufStufe(0);
  glockenspiel();
  if (!(await tpZaehlen(nr, `zaehlen-${TREPPE_N}`, stangen.map((x) => x.el), (i) => aufStufe(i)))) return;
  if (!(await tpAnsage(nr, 'treppe-fertig'))) return;
  await warten(600);
  if (tpAktuell(nr)) treppeAuftrag();
}

// ----- Echte Welt: „Bau eine Treppe aus Bausteinen: einer, dann zwei, dann drei!“ -----

function treppeAuftrag() {
  treppeStoppen();
  const nr = tp.nummer;
  tp.auftrag = true;
  tp.fertig = false;
  $('#btn-treppe-daumen').hidden = true;
  const klotz = (x, y) => `<rect x="${x}" y="${y}" width="22" height="22" rx="3" fill="#d23c2c" stroke="#4a3f35" stroke-width="3"/>`;
  const bild = `<svg viewBox="0 0 100 100" aria-hidden="true">${klotz(12, 70)}${klotz(39, 70)}${klotz(39, 46)}${klotz(66, 70)}${klotz(66, 46)}${klotz(66, 22)}</svg>`;
  inEcht({ z: tp, nr, aktuell: tpAktuell, ansage: tpAnsage, buehne: $('#treppe-feld'), knopf: $('#btn-treppe-daumen'),
    karteHtml: bild, sagen: (nr2) => tpAnsage(nr2, 'treppe-welt'), zeit: TREPPE_ZEIT, karteKlasse: 'gross' });
}

async function treppeAuftragErledigt(nr) {
  const karte = inEchtBestaetigt(tp, $('#btn-treppe-daumen'));
  if (!karte) return;
  animieren(karte, 'huepft');
  glockenspiel();
  await warten(400);
  if (!(await tpAnsage(nr, 'treppe-welt-fertig'))) return;
  spielEnde('treppe', treppeNeu);
}

$('#btn-treppe-daumen').addEventListener('click', () => { audio(); if (tp.inEcht) treppeAuftragErledigt(tp.nummer); });

function treppeStarten() {
  spielEndeWeg('treppe');
  zeigen('treppe');
  treppeNeu();
}
SPIELE.treppe = treppeStarten;
$('#home .spiel-btn[data-spiel="treppe"]').innerHTML = '<svg class="kachel-bild" viewBox="0 0 100 100" aria-hidden="true">'
  + [1, 2, 3, 4].map((n, i) => `<rect x="${14 + i * 19}" y="${86 - n * 18}" width="15" height="${n * 18}" rx="5" fill="#e6b47a" stroke="#4a3f35" stroke-width="2.5"/>`
    + Array.from({ length: n }, (_, k) => `<circle cx="${21.5 + i * 19}" cy="${77 - k * 18}" r="4.5" fill="#4a3f35"/>`).join('')).join('') + '</svg>';

$('#btn-treppe-home').addEventListener('click', () => { treppeStoppen(); wiedergabeStoppen(); zurStartseite(); });
$('#btn-treppe-laut').addEventListener('click', () => {
  const ende = $('#treppe .spiel-ende');
  if ((ende && !ende.hidden) || tp.fertig || tp.gesperrt || tp.ziehen) return;
  audio();
  if (tp.inEcht) { inEchtNochmal(tp); return; }
  tp.gesperrt = true;
  tpAnsage(tp.nummer, 'treppe-start').then((ok) => { if (ok) { tp.gesperrt = false; tpHilfeAbwarten(tp.nummer); } });
});
window.addEventListener('resize', () => { if ($('#treppe').classList.contains('active') && !tp.auftrag) tpAnordnen(); });

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
  eigeneDingeZeichnen();
  menschenListeZeichnen();
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

// --- Eigene Dinge für „Hol mir …“ ---

function eigeneDingeZeichnen() {
  const box = $('#eigene-dinge');
  box.innerHTML = '';
  eigeneDinge.forEach((d) => {
    const zeile = document.createElement('div');
    zeile.className = 'ding-zeile';
    zeile.innerHTML = `<img src="${d.url}" alt=""><span>${htmlText(d.name)}</span>`
      + '<button class="icon-btn" aria-label="Löschen">🗑️</button>';
    zeile.querySelector('button').addEventListener('click', () => eigenesDingLoeschen(d));
    box.appendChild(zeile);
  });
  $('#btn-ding-neu').hidden = eigeneDinge.length >= EIGENE_DINGE_MAX;
}

function eigenesDingNeu() {
  fotoWaehlen(async (blob) => {
    const name = (prompt('Wie heißt das Ding? (nur für Sie, z. B. „Ente“)') || '').trim().slice(0, 30) || 'Eigenes Ding';
    const id = `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!(await datenbank.medienSetzen('dinge', id, 'bild', blob))) { alert('Speichern ging nicht – vielleicht ist der Speicher voll.'); return; }
    speicher.schreiben('eigeneDinge', [...speicher.lesen('eigeneDinge', []), { id, name }]);
    speicherSchuetzen();
    await eigeneDingeLaden();
    eigeneDingeZeichnen();
  });
}
$('#btn-ding-neu').addEventListener('click', eigenesDingNeu);

async function eigenesDingLoeschen(d) {
  if (!confirm(`„${d.name}“ löschen?`)) return;
  await datenbank.medienEntfernen('dinge', d.id, 'bild');
  speicher.schreiben('eigeneDinge', speicher.lesen('eigeneDinge', []).filter((x) => x && x.id !== d.id));
  await eigeneDingeLaden();
  eigeneDingeZeichnen();
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
  if (extra.stimme) kind.stimme = extra.stimme;
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
// auf dem Gerät nicht, wird das Anlegen abgebrochen. Übernommen werden Kinder (Name, Tier, Foto, Hauptstimme) und
// Menschen (Name, Foto) – geprüft wie beim Einspielen einer Sicherung (nur bekannte Felder, Namen als Text, nur Bilder).
// Wortnests Sprachaufnahmen nicht: Zahlennest hat andere Sätze.
function wortnestLesen() {
  const leer = { kinder: [], profile: [], fotos: {} };
  return new Promise((fertig) => {
    let req;
    try { req = indexedDB.open('lernapp'); } catch { fertig(leer); return; }
    req.onupgradeneeded = () => req.transaction.abort();   // Wortnest gibt es hier nicht: nichts anlegen
    req.onerror = () => fertig(leer);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();   // Wortnest will sich aktualisieren: sofort Platz machen
      try {
        const tx = db.transaction(['kinder', 'profile', 'medien'], 'readonly');
        const kinderAnfrage = tx.objectStore('kinder').getAll();
        const profilAnfrage = tx.objectStore('profile').getAll();
        const fotos = {};
        profilAnfrage.onsuccess = () => (profilAnfrage.result || []).forEach((p) => {
          if (!p || typeof p.id !== 'string') return;
          const foto = tx.objectStore('medien').get(`${p.id}|ich|bild`);
          foto.onsuccess = () => { if (foto.result) fotos[p.id] = foto.result; };
        });
        tx.oncomplete = () => { db.close(); fertig({ kinder: kinderAnfrage.result || [], profile: profilAnfrage.result || [], fotos }); };
        tx.onerror = () => { db.close(); fertig(leer); };
      } catch { db.close(); fertig(leer); }
    };
  });
}

const wortnestBild = (b) => (b instanceof Blob && /^image\/(jpeg|png|webp)$/.test(b.type) ? b : null);
const wortnestName = (n, max) => (typeof n === 'string' ? n.trim().slice(0, max).replace(/[\s-]+$/, '') : '');

function wortnestKindPruefen(k) {
  if (!k || typeof k.id !== 'string') return null;
  const name = wortnestName(k.name, 20);
  if (!name) return null;
  return {
    wortnestId: k.id.slice(0, 40),
    name,
    tier: TIERE.includes(k.tier) ? k.tier : null,
    foto: wortnestBild(k.foto),
    profil: typeof k.profil === 'string' ? k.profil : null,
  };
}

function wortnestMenschPruefen(p, foto) {
  if (!p || typeof p.id !== 'string' || !p.id.startsWith('p-')) return null;
  const name = wortnestName(p.name, 30);
  return name ? { wortnestId: p.id.slice(0, 40), name, foto: wortnestBild(foto) } : null;
}

// Knopf nur zeigen, wenn es auf dem Gerät Wortnest gibt (ältere Browser können das nicht prüfen: dann immer)
async function wortnestKnopfZeigen() {
  let da = true;
  try { if (indexedDB.databases) da = (await indexedDB.databases()).some((d) => d.name === 'lernapp'); } catch { /* unbekannt */ }
  $('#btn-aus-wortnest').hidden = !da;
}

async function ausWortnestUebernehmen() {
  const w = await wortnestLesen();
  const gleich = (liste, x) => liste.some((y) => y.wortnestId === x.wortnestId || y.name.toLowerCase() === x.name.toLowerCase());
  const neueKinder = w.kinder.map(wortnestKindPruefen).filter((k) => k && !gleich(kinder, k));
  const neueMenschen = w.profile.map((p) => wortnestMenschPruefen(p, p && w.fotos[p.id])).filter((p) => p && !gleich(menschen, p));
  if (!neueKinder.length && !neueMenschen.length) {
    alert('Aus Wortnest gibt es nichts, was hier noch fehlt.');
    return;
  }
  const liste = [neueKinder.length ? `Kinder: ${neueKinder.map((k) => k.name).join(', ')}` : '',
    neueMenschen.length ? `Stimmen: ${neueMenschen.map((p) => p.name).join(', ')}` : ''].filter(Boolean).join('\n');
  if (!confirm(`Aus Wortnest übernehmen?\n\n${liste}\n\nÜbernommen werden Namen, Tiere und Fotos – Aufnahmen nicht, `
    + 'weil Zahlennest andere Sätze hat. In Wortnest ändert sich nichts.')) return;
  for (const p of neueMenschen) {
    const mensch = { id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: p.name, erstellt: Date.now(), wortnestId: p.wortnestId };
    await datenbank.profilSpeichern(mensch);
    if (p.foto) await datenbank.medienSetzen(mensch.id, 'ich', 'bild', p.foto);
  }
  await menschenLaden();
  // Hauptstimme aus Wortnest mitnehmen, wenn es den Menschen hier gibt
  for (const k of neueKinder) {
    const stimme = menschen.find((p) => p.wortnestId && p.wortnestId === k.profil);
    await kindAnlegen(k.name, { ...k, stimme: stimme ? stimme.id : null });
  }
  speicherSchuetzen();
  await einstellungenLaden();
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
  stimmeWahlZeichnen($('#kind-stimme'), k.stimme || null, (id) => kindAendern((kk) => { kk.stimme = id; }));
  $('#karte-kind-stimme').hidden = !menschen.length;
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

// ---------- Eigene Stimmen: Menschen sprechen die Sätze der Spiele selbst ein (alles bleibt auf dem Gerät) ----------
// Ein Mensch = Profil { id 'p-…', name (≤ 30), erstellt, wortnestId? }. Medien wie in Wortnest: Foto = ich|bild,
// Aufnahme eines Satzes = datei:ansage-<name>.wav|stimme (gleiche Form wie Wortnests Studio, für ein späteres Stimm-Paket).
// Wer spricht: beim Kind „stimme“ (ohne Kinder app-weit zn:stimme); null = Computerstimme. Was ein Mensch noch nicht
// eingesprochen hat, spricht die Computerstimme. Zählfolgen sind immer eine ganze Aufnahme – kein Wechsel mittendrin.

let menschen = [];
let menschFotos = {};      // Profil-ID -> Objekt-URL des Fotos
let eigeneAnsagen = {};    // Ansage-Name -> Objekt-URL der Aufnahme der aktiven Stimme
let stimmeLauf = 0;

const ansageUrl = (name) => eigeneAnsagen[name] || `audio/ansage-${name}.wav`;
const ansagePlatz = (name) => `datei:ansage-${name}.wav`;
const ansageVonPlatz = (platz) => { const t = /^datei:ansage-(.+)\.wav$/.exec(platz); return t && ANSAGEN[t[1]] ? t[1] : null; };

async function menschenLaden() {
  Object.values(menschFotos).forEach((url) => URL.revokeObjectURL(url));
  menschFotos = {};
  menschen = await datenbank.profile();
  for (const p of menschen) {
    const foto = await datenbank.medium(p.id, 'ich', 'bild');
    if (foto) menschFotos[p.id] = URL.createObjectURL(foto);
  }
}

function menschBildHtml(p) {
  if (!p) return '🤖';
  return menschFotos[p.id] ? `<img class="bild-datei foto" src="${menschFotos[p.id]}" alt="">` : '🙂';
}

function aktiveStimmeId() {
  const k = aktivesKind();
  const id = k ? k.stimme : speicher.lesen('stimme', null);
  return menschen.some((p) => p.id === id) ? id : null;
}

// Aufnahmen der aktiven Stimme bereitlegen (beim Start, Kindwechsel und nach dem Einsprechen)
async function stimmeLaden() {
  const lauf = ++stimmeLauf;
  const id = aktiveStimmeId();
  const neu = {};
  if (id) {
    (await datenbank.medienVon(id)).forEach((m) => {
      const name = ansageVonPlatz(m.platz);
      if (name && m.art === 'stimme' && m.blob instanceof Blob) neu[name] = URL.createObjectURL(m.blob);
    });
  }
  if (lauf !== stimmeLauf) { Object.values(neu).forEach((url) => URL.revokeObjectURL(url)); return; }
  Object.values(eigeneAnsagen).forEach((url) => URL.revokeObjectURL(url));
  eigeneAnsagen = neu;
}

// Auswahl „Wer spricht?“: Computerstimme oder ein Mensch
function stimmeWahlZeichnen(box, gewaehlt, aendern) {
  box.innerHTML = '';
  [null, ...menschen].forEach((p) => {
    const zeile = document.createElement('label');
    zeile.className = 'umschalter stimme-zeile';
    zeile.innerHTML = `<input type="radio" name="${box.id}" ${(p ? p.id : null) === gewaehlt ? 'checked' : ''}>`
      + `<span class="mensch-bild">${menschBildHtml(p)}</span><span>${p ? htmlText(p.name) : 'Computerstimme'}</span>`;
    zeile.querySelector('input').addEventListener('change', () => aendern(p ? p.id : null));
    box.appendChild(zeile);
  });
}

// --- Liste im Elternbereich ---

async function menschenListeZeichnen() {
  const box = $('#menschen-liste');
  box.innerHTML = '';
  for (const p of menschen) {
    const eigen = (await datenbank.medienVon(p.id)).filter((m) => m.art === 'stimme' && ansageVonPlatz(m.platz)).length;
    const zeile = document.createElement('button');
    zeile.className = 'kind-zeile';
    zeile.innerHTML = `<span class="kind-bild">${menschBildHtml(p)}</span>`
      + `<span class="w">${htmlText(p.name)}<br><small>${eigen} von ${Object.keys(ANSAGEN).length} Sätzen eingesprochen</small></span>`
      + '<span class="pfeil">✏️</span>';
    zeile.addEventListener('click', () => menschBearbeiten(p.id));
    box.appendChild(zeile);
  }
  // Ohne Kinder gilt die Wahl für die ganze App (mit Kindern beim Kind)
  $('#stimme-app').hidden = !!kinder.length || !menschen.length;
  if (!kinder.length) {
    stimmeWahlZeichnen($('#stimme-app-wahl'), aktiveStimmeId(), async (id) => {
      speicher.schreiben('stimme', id);
      await stimmeLaden();
    });
  }
}

async function menschNeu() {
  const name = (prompt('Wer spricht? Name, z. B. Mama, Papa, Oma:') || '').trim();
  if (!name) return null;
  const mensch = { id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.slice(0, 30), erstellt: Date.now() };
  await datenbank.profilSpeichern(mensch);
  speicherSchuetzen();
  await menschenLaden();
  menschBearbeiten(mensch.id);
  return mensch;
}
$('#btn-mensch-neu').addEventListener('click', menschNeu);

// --- Ein Mensch: Name, Foto, Sätze einsprechen, für wen ---

let menschInArbeit = null;

function menschBearbeiten(id) {
  menschInArbeit = menschen.find((p) => p.id === id) || null;
  if (!menschInArbeit) return;
  menschZeichnen();
  zeigen('mensch');
}

async function menschZeichnen() {
  const p = menschInArbeit;
  $('#mensch-titel').textContent = p.name;
  const name = $('#mensch-name');
  if (document.activeElement !== name) name.value = p.name;
  $('#mensch-foto').innerHTML = menschBildHtml(p);
  $('#btn-mensch-foto-weg').hidden = !menschFotos[p.id];
  const eigen = (await datenbank.medienVon(p.id)).filter((m) => m.art === 'stimme' && ansageVonPlatz(m.platz)).length;
  $('#mensch-stand').textContent = `${eigen} von ${Object.keys(ANSAGEN).length} Sätzen eingesprochen.`;
  const fuer = kinder.filter((k) => k.stimme === p.id).map((k) => k.name);
  $('#mensch-fuer').textContent = kinder.length
    ? (fuer.length ? `Spricht für: ${fuer.join(', ')}.` : 'Spricht noch für kein Kind – beim Kind unter „Stimme“ auswählen.')
    : (aktiveStimmeId() === p.id ? 'Spricht in der App.' : 'Spricht noch nicht – im Elternbereich unter „Stimmen“ auswählen.');
}

async function menschAendern(fn) {
  fn(menschInArbeit);
  await datenbank.profilSpeichern(menschInArbeit);
  await menschenLaden();
  menschInArbeit = menschen.find((p) => p.id === menschInArbeit.id);
  menschZeichnen();
}

$('#mensch-name').addEventListener('change', (e) => {
  const name = e.target.value.trim().slice(0, 30);
  if (name) menschAendern((p) => { p.name = name; });
  else e.target.value = menschInArbeit.name;
});
$('#btn-mensch-foto').addEventListener('click', () => fotoWaehlen(async (blob) => {
  if (!(await datenbank.medienSetzen(menschInArbeit.id, 'ich', 'bild', blob))) { alert('Speichern ging nicht – vielleicht ist der Speicher voll.'); return; }
  await menschAendern(() => {});
}));
$('#btn-mensch-foto-weg').addEventListener('click', async () => {
  await datenbank.medienEntfernen(menschInArbeit.id, 'ich', 'bild');
  await menschAendern(() => {});
});
$('#btn-mensch-studio').addEventListener('click', () => studioOeffnen(menschInArbeit.id));

$('#btn-mensch-loeschen').addEventListener('click', async () => {
  const p = menschInArbeit;
  if (!confirm(`„${p.name}“ mit allen Aufnahmen und dem Foto löschen? Dann spricht wieder die Computerstimme.`)) return;
  await datenbank.profilLoeschen(p.id);
  for (const k of kinder.filter((kk) => kk.stimme === p.id)) {
    k.stimme = null;
    await datenbank.kindSpeichern(k);
  }
  if (speicher.lesen('stimme', null) === p.id) speicher.schreiben('stimme', null);
  menschInArbeit = null;
  await kinderLaden();
  await menschenLaden();
  await einstellungenLaden();
  history.back();
});
$('#btn-mensch-zurueck').addEventListener('click', () => history.back());

// --- Studio: jeden Satz einmal einsprechen (gedrückt halten), anhören, speichern ---

const STUDIO_RATE = 22050;
const studio = { mensch: null, bereich: null, pos: 0, aufnahme: null, stream: null, rekorder: null, startet: false,
  gedrueckt: false, stoppTimer: null, lauf: 0, eigen: new Set() };
// lauf: zählt bei jedem Wechsel/Verlassen hoch – späte Ergebnisse (Mikrofon, Aufbereitung) gehören dann nicht mehr hierher
const studioAktuell = (lauf) => lauf === studio.lauf && $('#studio').classList.contains('active') && !document.hidden;
const studioBereiche = () => [...new Set(Object.values(ANSAGEN).map(([, spiel]) => spiel))];
const studioStuecke = (bereich) => Object.keys(ANSAGEN).filter((n) => ANSAGEN[n][1] === bereich);
const istZaehlfolge = (name) => /^Eins[,.!]/.test(ANSAGEN[name][0]);

function studioTipp(name) {
  if (istZaehlfolge(name)) return 'Zählen in einem Zug: langsam, etwa eine Sekunde pro Zahl mit kleiner Pause – die letzte Zahl betonen.';
  return `Ansage bei „${ANSAGEN[name][1]}“ – freundlich und ruhig, wie zu einem Kind neben Ihnen.`;
}

async function studioOeffnen(menschId) {
  const p = menschen.find((x) => x.id === menschId);
  if (!p) return;
  studio.mensch = p.id;
  studio.eigen = new Set((await datenbank.medienVon(p.id)).filter((m) => m.art === 'stimme').map((m) => ansageVonPlatz(m.platz)).filter(Boolean));
  $('#studio-titel').textContent = `Stimme: ${p.name}`;
  $('#studio-hinweis').hidden = !!speicher.lesen('studioHinweis', false);
  zeigen('studio');
  // Mit dem ersten Bereich beginnen, in dem noch etwas fehlt
  studio.bereich = studioBereiche().find((b) => studioStuecke(b).some((n) => !studio.eigen.has(n))) || studioBereiche()[0];
  studioErstesOffenes();
}

function studioZeichnen() {
  const stuecke = studioStuecke(studio.bereich);
  const name = stuecke[studio.pos];
  const reiter = $('#studio-reiter');
  reiter.innerHTML = '';
  studioBereiche().forEach((b) => {
    const btn = document.createElement('button');
    btn.className = b === studio.bereich ? 'aktiv' : '';
    btn.textContent = `${b} ${studioStuecke(b).filter((n) => studio.eigen.has(n)).length}/${studioStuecke(b).length}`;
    btn.addEventListener('click', () => { studioAbbrechen(); studio.bereich = b; studioErstesOffenes(); });
    reiter.appendChild(btn);
  });
  $('#studio-balken').style.width = `${(stuecke.filter((n) => studio.eigen.has(n)).length / stuecke.length) * 100}%`;
  $('#studio-text').textContent = ANSAGEN[name][0];
  $('#studio-text').classList.toggle('eigen', studio.eigen.has(name));
  $('#studio-tipp').textContent = studioTipp(name);
  $('#btn-studio-meins').disabled = !studio.eigen.has(name);
  $('#btn-studio-zuruecksetzen').hidden = !studio.eigen.has(name);
  $('#btn-studio-gut').disabled = !studio.aufnahme;
  $('#btn-studio-vor').disabled = studio.pos === 0;
  $('#btn-studio-weiter').disabled = studio.pos === stuecke.length - 1;
}

function studioMeldung(text, warnung = false) {
  const m = $('#studio-meldung');
  m.textContent = text;
  m.classList.toggle('warnung', warnung);
}

function studioGehe(pos) {
  studioAbbrechen();
  studio.pos = Math.max(0, Math.min(studioStuecke(studio.bereich).length - 1, pos));
  studioMeldung('Gedrückt halten und sprechen, dann loslassen.');
  studioZeichnen();
}

function studioErstesOffenes() {
  const i = studioStuecke(studio.bereich).findIndex((n) => !studio.eigen.has(n));
  studioGehe(i >= 0 ? i : 0);
}

// Mikrofon nur, solange das Studio offen ist; beim Verlassen oder im Hintergrund ganz schließen
function studioMikrofonZu() {
  clearTimeout(studio.stoppTimer);
  if (studio.rekorder && studio.rekorder.state === 'recording') { studio.rekorder.onstop = null; studio.rekorder.stop(); }
  studio.rekorder = null;
  if (studio.stream) studio.stream.getTracks().forEach((t) => t.stop());
  studio.stream = null;
  $('#btn-studio-mikro').classList.remove('aktiv');
}

function studioAbbrechen() {
  studio.lauf++;
  if (studio.rekorder) studioMikrofonZu();
  studio.aufnahme = null;
}

async function studioAufnahmeStart() {
  if (studio.rekorder || studio.startet) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { studioMeldung('Aufnehmen geht nur in der installierten App bzw. über https.', true); return; }
  studio.startet = true;
  wiedergabeStoppen();
  const lauf = studio.lauf;
  try {
    const stream = studio.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
    // Inzwischen verlassen (z. B. während der Berechtigungsfrage): Mikrofon sofort wieder schließen
    if (!studioAktuell(lauf)) { stream.getTracks().forEach((t) => t.stop()); studio.startet = false; return; }
    studio.stream = stream;
  } catch {
    studio.startet = false;
    studioMeldung('Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen des Handys/Browsers das Mikrofon für diese App erlauben.', true);
    return;
  }
  studio.startet = false;
  if (!studio.gedrueckt) return;   // schon wieder losgelassen, während das Mikrofon aufging
  const teile = [];
  const r = new MediaRecorder(studio.stream);
  studio.rekorder = r;
  r.ondataavailable = (e) => { if (e.data.size) teile.push(e.data); };
  const name = studioStuecke(studio.bereich)[studio.pos];   // gehört zu diesem Satz, auch wenn danach weitergeblättert wird
  r.onstop = () => { studio.rekorder = null; $('#btn-studio-mikro').classList.remove('aktiv'); studioVerarbeiten(new Blob(teile, { type: r.mimeType }), name, lauf); };
  r.start();
  $('#btn-studio-mikro').classList.add('aktiv');
  studioMeldung('Ich höre zu …');
  studioPegelStarten(studio.stream, r);
  // Sicherheitsstopp: Zählen „eins … fünf“ langsam braucht länger als ein Satz
  studio.stoppTimer = setTimeout(() => { if (r.state === 'recording') r.stop(); }, istZaehlfolge(name) ? 14000 : 8000);
}

function studioAufnahmeStopp() {
  studio.gedrueckt = false;
  clearTimeout(studio.stoppTimer);
  if (studio.rekorder && studio.rekorder.state === 'recording') studio.rekorder.stop();
}

// Pegel-Balken während der Aufnahme: zeigt, dass die App hört (und ob es zu leise ist)
function studioPegelStarten(stream, rekorder) {
  const ctx = audio();
  const balken = $('#studio-pegel');
  if (!ctx || !balken) return;
  let quelle;
  try { quelle = ctx.createMediaStreamSource(stream); } catch { return; }
  const analyse = ctx.createAnalyser();
  analyse.fftSize = 512;
  quelle.connect(analyse);
  const daten = new Uint8Array(analyse.fftSize);
  const schritt = () => {
    if (rekorder.state !== 'recording') { balken.style.width = '0'; quelle.disconnect(); return; }
    analyse.getByteTimeDomainData(daten);
    let spitze = 0;
    for (const x of daten) spitze = Math.max(spitze, Math.abs(x - 128));
    balken.style.width = `${Math.min(100, (spitze / 128) * 160)}%`;
    requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
}

// Auf 22050 Hz umrechnen, Stille am Anfang/Ende abschneiden, Lautstärke angleichen (wie in Wortnest)
async function studioAufbereiten(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let puffer;
  try { puffer = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close(); }
  const off = new OfflineAudioContext(1, Math.ceil(puffer.duration * STUDIO_RATE), STUDIO_RATE);
  const q = off.createBufferSource();
  q.buffer = puffer;
  q.connect(off.destination);
  q.start();
  const d = (await off.startRendering()).getChannelData(0);
  const fenster = Math.round(STUDIO_RATE * 0.01);
  const energie = [];
  for (let i = 0; i < d.length; i += fenster) {
    let summe = 0;
    for (let j = i; j < Math.min(d.length, i + fenster); j++) summe += d[j] * d[j];
    energie.push(Math.sqrt(summe / fenster));
  }
  const spitze = Math.max(0, ...energie);
  if (spitze < 0.01) return null;
  const schwelle = Math.max(0.006, spitze * 0.1);
  const erstes = energie.findIndex((e) => e >= schwelle);
  const letztes = energie.length - 1 - [...energie].reverse().findIndex((e) => e >= schwelle);
  if (letztes - erstes < 6) return null;   // nur ein Klick
  const t = d.slice(Math.max(0, erstes - 4) * fenster, Math.min(energie.length, letztes + 10) * fenster);
  const hoch = t.reduce((m, x) => Math.max(m, Math.abs(x)), 1e-6);
  const blende = Math.round(STUDIO_RATE * 0.008);
  return t.map((x, i) => x / hoch * 0.9 * Math.min(1, i / blende, (t.length - 1 - i) / blende));
}

function studioWav(t) {
  const buf = new ArrayBuffer(44 + t.length * 2);
  const v = new DataView(buf);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + t.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, STUDIO_RATE, true); v.setUint32(28, STUDIO_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, t.length * 2, true);
  t.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
  return new Blob([buf], { type: 'audio/wav' });
}

async function studioVerarbeiten(blob, name = studioStuecke(studio.bereich)[studio.pos], lauf = studio.lauf) {
  let t = null;
  try { t = await studioAufbereiten(blob); } catch { t = null; }
  if (lauf !== studio.lauf || !$('#studio').classList.contains('active')) return;   // inzwischen weitergeblättert/verlassen
  if (!t) { studio.aufnahme = null; studioZeichnen(); studioMeldung('Nichts gehört – bitte etwas lauter nochmal.', true); return; }
  studio.aufnahme = studioWav(t);
  studioZeichnen();
  studioMeldung('So klingt es im Spiel. Gut? Dann „Gut, weiter“ – sonst einfach nochmal halten.');
  studioAbspielen(studio.aufnahme);
}

function studioAbspielen(blob) {
  const url = URL.createObjectURL(blob);
  folgeAbspielen([{ url }]).finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
}

async function studioSpeichern() {
  if (!studio.aufnahme) return;
  const name = studioStuecke(studio.bereich)[studio.pos];
  speicherSchuetzen();
  if (!(await datenbank.medienSetzen(studio.mensch, ansagePlatz(name), 'stimme', studio.aufnahme))) {
    studioMeldung('Speichern ging nicht – vielleicht ist der Speicher voll.', true);
    return;
  }
  studio.eigen.add(name);
  studio.aufnahme = null;
  if (aktiveStimmeId() === studio.mensch) await stimmeLaden();
  const naechstes = studioStuecke(studio.bereich).findIndex((n, i) => i > studio.pos && !studio.eigen.has(n));
  studioGehe(naechstes >= 0 ? naechstes : studio.pos);
  studioMeldung(`„${ANSAGEN[name][0]}“ gespeichert.`);
}

async function studioZuruecksetzen() {
  const name = studioStuecke(studio.bereich)[studio.pos];
  if (!confirm(`Ihre Aufnahme für „${ANSAGEN[name][0]}“ löschen? Dann spricht hier wieder die Computerstimme.`)) return;
  await datenbank.medienEntfernen(studio.mensch, ansagePlatz(name), 'stimme');
  studio.eigen.delete(name);
  if (aktiveStimmeId() === studio.mensch) await stimmeLaden();
  studioZeichnen();
}

const mikro = $('#btn-studio-mikro');
mikro.addEventListener('pointerdown', (e) => { e.preventDefault(); mikro.setPointerCapture(e.pointerId); studio.gedrueckt = true; studioAufnahmeStart(); });
['pointerup', 'pointercancel'].forEach((ev) => mikro.addEventListener(ev, studioAufnahmeStopp));
mikro.addEventListener('contextmenu', (e) => e.preventDefault());
$('#btn-studio-gut').addEventListener('click', studioSpeichern);
$('#btn-studio-standard').addEventListener('click', () => folgeAbspielen([{ url: `audio/ansage-${studioStuecke(studio.bereich)[studio.pos]}.wav` }]));
$('#btn-studio-meins').addEventListener('click', async () => {
  const blob = await datenbank.medium(studio.mensch, ansagePlatz(studioStuecke(studio.bereich)[studio.pos]), 'stimme');
  if (blob) studioAbspielen(blob);
});
$('#btn-studio-vor').addEventListener('click', () => studioGehe(studio.pos - 1));
$('#btn-studio-weiter').addEventListener('click', () => studioGehe(studio.pos + 1));
$('#btn-studio-zuruecksetzen').addEventListener('click', studioZuruecksetzen);
$('#btn-studio-ok').addEventListener('click', () => { speicher.schreiben('studioHinweis', true); $('#studio-hinweis').hidden = true; });
$('#btn-studio-zurueck').addEventListener('click', () => history.back());
document.addEventListener('visibilitychange', () => { if (document.hidden) { studioAbbrechen(); studioMikrofonZu(); } });

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
  await menschenLaden();
  await eigeneDingeLaden();
  if (zustand.kind && !aktivesKind()) zustand.kind = kinder.length ? kinder[0].id : null;
  await einstellungenLaden();
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
