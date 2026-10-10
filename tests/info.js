// Testet „Über die App & Datenschutz“. Frisches Browserprofil (ohne Begrüßung).
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;

  // 1. Aus dem Elternbereich öffnen und zurück
  elternOeffnen();
  $('#btn-info').click();
  pruefe(aktiv('info'), 'Infoseite nicht offen');
  const text = $('#info').textContent;
  ['Datenschutz', 'Alles bleibt auf diesem Gerät', 'GitHub Pages', 'AGPL', 'CC BY-NC-ND', 'Open Font License', 'Lauschling',
    'Wortnest', 'getrennt'].forEach((w) => pruefe(text.includes(w), `Text fehlt: ${w}`));
  pruefe($('#info-version').textContent === `Version ${APP_VERSION}`, 'Version fehlt');
  // Alle Links öffnen ein neues Fenster und gehen nur zu bekannten Seiten
  [...$('#info').querySelectorAll('a')].forEach((a) => pruefe(a.target === '_blank' && a.rel.includes('noopener')
    && /^https:\/\/(github\.com|pages\.github\.com|docs\.github\.com|www\.gnu\.org|creativecommons\.org|doganbedran\.github\.io)\//.test(a.href), `Link: ${a.href}`));
  history.back(); await warte(400);
  pruefe(aktiv('eltern'), 'Zurück nicht im Elternbereich');

  // 2. Von der Begrüßung aus: zurück zur Begrüßung
  history.back(); await warte(400);
  zeigen('willkommen', false);
  $('#btn-willkommen-info').click();
  pruefe(aktiv('info'), 'Info von der Begrüßung nicht offen');
  $('#btn-info-zurueck').click(); await warte(400);
  pruefe(aktiv('willkommen'), 'Nicht zurück zur Begrüßung');

  // 3. Lizenzdateien im Repo
  pruefe((await (await fetch('LICENSE')).text()).includes('GNU AFFERO GENERAL PUBLIC LICENSE'), 'LICENSE fehlt');
  pruefe((await fetch('audio/LIZENZ.md')).ok, 'audio/LIZENZ.md fehlt');
  pruefe((await (await fetch('fonts/OFL.txt')).text()).includes('SIL OPEN FONT LICENSE'), 'fonts/OFL.txt fehlt');

  // Ansicht: Infoseite
  zeigen('info', false);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'INFO-TESTS OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
