// Testet die Tonwiedergabe nach der Regel von Safari auf dem iPhone (nachgestellt): ein Tonelement darf nur spielen,
// wenn es schon einmal während eines Tipps gespielt hat. Ansagen kommen oft später (nach Pausen, Zeitgebern, Schieben)
// – darum gibt es ein einziges Tonelement, das beim ersten Tipp still „entsperrt“ wird. Frisches Profil.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  await startFertig;

  // iPhone-Regel nachstellen
  let imTipp = false;
  const gesegnet = new WeakSet();
  const blockiert = [];
  const gespielt = [];
  HTMLMediaElement.prototype.play = function () {
    if (imTipp) gesegnet.add(this);
    if (!gesegnet.has(this)) { blockiert.push(this.src); return Promise.reject(new DOMException('nicht erlaubt', 'NotAllowedError')); }
    gespielt.push(this.src);
    // Abspielen nur vortäuschen (im Test-Browser endet echter Ton nicht immer): kurz „spielt“, dann „zu Ende“
    const el = this, quelle = this.src;
    setTimeout(() => el.src === quelle && el.dispatchEvent(new Event('playing')), 5);
    setTimeout(() => el.src === quelle && el.dispatchEvent(new Event('ended')), 40);
    return Promise.resolve();
  };
  const tippen = (el) => { imTipp = true; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); imTipp = false; };

  // 1. Im Code gibt es nur ein Tonelement
  const code = await (await fetch('app.js')).text();
  pruefe((code.match(/new Audio\(/g) || []).length === 1, 'Mehr als ein Tonelement im Code');

  // 2. Vor dem ersten Tipp: eine Ansage aus einem Zeitgeber wird (wie am iPhone) blockiert
  await new Promise((r) => setTimeout(async () => { await ansage('pause'); r(); }, 50));
  pruefe(blockiert.length === 1, `Nachstellung greift nicht: ${blockiert.length}`);

  // 3. Erster Tipp irgendwo: das Tonelement spielt still und ist danach frei
  tippen(document.body);
  await warte(300);
  pruefe(gesegnet.has(tonEl) && tonEntsperrt, 'Tonelement wird beim ersten Tipp nicht entsperrt');

  // 4. Danach: Ansagen und Zählfolgen aus Zeitgebern erklingen
  const vorher = blockiert.length;
  await new Promise((r) => setTimeout(async () => { await ansage('pause'); r(); }, 50));
  const els = [document.createElement('span'), document.createElement('span')];
  await new Promise((r) => setTimeout(async () => { await zaehlenMitLeuchten('zaehlen-2', els); r(); }, 50));
  pruefe(blockiert.length === vorher && gespielt.some((s) => s.includes('ansage-pause')) && gespielt.some((s) => s.includes('ansage-zaehlen-2')),
    `Nach dem Entsperren blockiert: ${blockiert.slice(vorher)}`);

  // 5. Ein Spiel starten (Tipp auf die Kachel): seine späteren Ansagen kommen durch
  tippen($('#home .spiel-btn[data-spiel="wieviele"]'));
  await warte(1500);
  pruefe(blockiert.length === vorher && gespielt.some((s) => s.includes('ansage-wieviele-1')), `Im Spiel blockiert: ${blockiert.slice(vorher)}`);
  wievieleStoppen();
  wiedergabeStoppen();

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'TON OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
