// Für alle Testseiten: sobald unten die Ergebnisleiste (OK/FEHLER/ABSTURZ) erscheint, dem Testserver „fertig“ melden –
// dann kommt das Bildschirmfoto gleich und nicht erst nach der Höchstzeit (/_warten). Eigene Datei, weil die
// Sicherheitsregel der App eingebettete Skripte verbietet.
(() => {
  const name = location.pathname.split('/').pop().replace('.html', '');
  new MutationObserver((_, b) => {
    const leiste = [...document.body.children].find((e) => e.style && e.style.bottom === '0px' && /OK|FEHLER|ABSTURZ/.test(e.textContent));
    if (leiste) { b.disconnect(); setTimeout(() => fetch(`/_fertig?id=${name}`), 400); }
  }).observe(document.body, { childList: true });
})();
