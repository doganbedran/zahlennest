'use strict';

// Bei jeder Änderung zusammen mit CACHE in sw.js erhöhen (wird im Elternbereich angezeigt)
const APP_VERSION = 17;

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
const ALLE_SPIELE = ['wieviele', 'mehr', 'korb', 'trommel', 'holmir', 'ziffern'];
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
  'holLoeffel', 'holBecher', 'holBaustein', 'holKuscheltier', 'ziffern456', 'ziffern789', 'ziffern0'];
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
      const a = new Audio(ansageUrl(name));
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
  Object.assign(zf, { strichNr: 0, fortschritt: 0, versuch: null, spuren: [], pointerId: null, letzter: null, geschafft: false, abrutscher: 0 });
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
  zfVibrieren([30, 60, 30]);
  const v = zf.versuch;
  v.folgt = false;
  v.punkte = [];
  zf.fortschritt = v.startFortschritt;
  zifferSpurenZeichnen();
  zifferVorlageZeichnen();
  zifferHinweis();
  // Nach dreimal Abrutschen: der Lichtpunkt macht die Ziffer nochmal vor (kein „falsch“)
  if (++zf.abrutscher >= 3) { zf.abrutscher = 0; zifferVormachen(); }
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
