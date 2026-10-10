// Testet die Begrüßung beim allerersten Start (für Eltern). Frisches Browserprofil.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;

  // 1. Neues Gerät: Begrüßung statt Startseite
  pruefe(aktiv('willkommen') && !aktiv('home'), 'Begrüßung erscheint nicht');
  pruefe($('#willkommen').textContent.includes('2 Sekunden'), 'Hinweis auf den Elternbereich fehlt');

  // 2. „Gleich spielen“ → Startseite, gemerkt (mit Präfix); danach nicht mehr nötig
  $('#btn-willkommen-los').click();
  pruefe(aktiv('home') && localStorage.getItem('zn:willkommen') === 'true', 'Gleich spielen');
  pruefe(!willkommenNoetig(), 'Begrüßung käme nochmal');

  // 3. „Kind anlegen“: Abbrechen lässt die Begrüßung stehen, mit Namen → Kind-Formular
  localStorage.removeItem('zn:willkommen');
  zeigen('willkommen', false);
  window.prompt = () => '';
  $('#btn-willkommen-kind').click(); await warte(300);
  pruefe(aktiv('willkommen') && !kinder.length && !speicher.lesen('willkommen', false), 'Abbrechen beim Namen');
  window.prompt = () => 'Lina';
  $('#btn-willkommen-kind').click(); await warte(500);
  pruefe(kinder.length === 1 && aktiv('kind') && speicher.lesen('willkommen') === true, 'Kind anlegen');
  $('#btn-kind-zurueck').click(); await warte(500);
  pruefe(!aktiv('kind') && !aktiv('willkommen'), 'Zurück aus dem Kind-Formular');
  pruefe(!willkommenNoetig(), 'Mit Kind käme die Begrüßung nochmal');

  // Ansicht: Begrüßung
  zeigen('willkommen', false);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'WILLKOMMEN-TESTS OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
