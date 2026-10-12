// Testet die Startseite (Spiel-Kacheln, leeres Regal = Nest), den Elternbereich per 2 s Halten und das Regal.
// Frisches Browserprofil (ohne Begrüßung). Noch nicht gebaute Spiele werden hier zum Testen nur vorgetäuscht.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  const sichtbare = () => [...document.querySelectorAll('#home .spiel-btn')].filter((b) => !b.hidden);
  await startFertig;

  // 1. Startseite ohne fertige Spiele: keine Kachel, stattdessen das Nest; kein Kind-Knopf
  pruefe(aktiv('home'), 'Startseite nicht aktiv');
  pruefe(!document.body.classList.contains('laedt'), 'Startseite bleibt verborgen');
  // Gestaltung geladen: nur ein Bildschirm sichtbar (ein Fehler im Stylesheet zeigte einmal alle untereinander)
  pruefe([...document.querySelectorAll('.screen')].filter((s) => getComputedStyle(s).display !== 'none').length === 1, 'Stylesheet nicht wirksam');
  const echteSpiele = fertigeSpiele();
  if (!echteSpiele.length) pruefe(!sichtbare().length && !$('#home-leer').hidden, 'Leeres Regal zeigt kein Nest');
  pruefe($('#btn-kind').hidden, 'Kind-Knopf ohne Kinder');

  // 2. Neues Gerät: nur „Wie viele?“ im Regal
  pruefe(JSON.stringify(zustand.spiele) === JSON.stringify(START_REGAL), `Start-Regal: ${zustand.spiele}`);

  // 3. Alle Spiele vorgetäuscht und im Regal: alles sichtbar, nichts ragt heraus, groß genug, kein Nest
  const gestartet = [];
  ALLE_SPIELE.forEach((id) => { if (!SPIELE[id]) SPIELE[id] = () => gestartet.push(id); });
  zustand.spiele = ALLE_SPIELE;
  spieleZeigen();
  pruefe(sichtbare().length === ALLE_SPIELE.length && $('#home-leer').hidden, `Sichtbar: ${sichtbare().length}`);
  sichtbare().forEach((b) => {
    const r = b.getBoundingClientRect();
    pruefe(r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, `${b.dataset.spiel} ragt heraus`);
    pruefe(r.width >= 100 || (innerWidth > innerHeight && r.width >= 90), `${b.dataset.spiel} zu klein: ${Math.round(r.width)}`);
  });
  // Antippen startet das Spiel (vorgetäuscht, falls noch nicht gebaut)
  $('#home .spiel-btn[data-spiel="holmir"]').click();
  pruefe(echteSpiele.includes('holmir') ? aktiv('hol') : gestartet.includes('holmir'), 'Kachel startet kein Spiel');
  if (echteSpiele.includes('holmir')) { holStoppen(); zeigen('home', false); }

  // 4. Elternbereich: kurz tippen öffnet nicht, 2 Sekunden halten schon
  const knopf = $('#btn-eltern');
  knopf.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await warte(400);
  knopf.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await warte(2000);
  pruefe(aktiv('home'), 'Kurzes Tippen öffnet den Elternbereich');
  knopf.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await warte(2300);
  pruefe(aktiv('eltern'), 'Halten öffnet den Elternbereich nicht');

  // 5. Regal (ohne Kinder app-weit): nur fertige Spiele; abwählen, das letzte bleibt
  const regal = () => [...document.querySelectorAll('#spiele-wahl .regal-spiel')];
  pruefe(regal().length === ALLE_SPIELE.length, `Regal-Einträge: ${regal().length}`);
  pruefe(!$('#karte-regal').hidden, 'Regal-Karte ohne Kinder verborgen');
  // erst alle ins Regal, dann alle abwählen
  // (jeder Klick zeichnet das Regal neu: immer frisch suchen)
  const alleRein = () => { for (let i = 0; i < ALLE_SPIELE.length; i++) { const b = regal().find((x) => !x.classList.contains('gewaehlt')); if (b) b.click(); } };
  alleRein();
  pruefe(regal().every((b) => b.classList.contains('gewaehlt')), 'Nicht alle ins Regal gestellt');
  for (let i = 0; i < ALLE_SPIELE.length; i++) regal().find((b) => b.classList.contains('gewaehlt')).click();
  pruefe(regal().filter((b) => b.classList.contains('gewaehlt')).length === 1, 'Letztes Spiel ließ sich abwählen');
  pruefe(speicher.lesen('spieleAus').length === ALLE_SPIELE.length - 1, 'Regal nicht gespeichert');
  alleRein();
  pruefe(zustand.spiele.length === ALLE_SPIELE.length, 'Wieder alle im Regal');

  // 6. Zurück zur Startseite
  $('#btn-eltern-zurueck').click(); await warte(400);
  pruefe(aktiv('home') && sichtbare().length === ALLE_SPIELE.length, 'Zurück zur Startseite');

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'STARTSEITE OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
