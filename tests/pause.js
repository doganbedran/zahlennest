// Testet die gemeinsame Pause mit Wortnest (Schlüssel nest:…): Spielzeit zählen, Pause am Spielende, Pause gilt
// eine halbe Stunde lang auch beim nächsten Spiel (auch wenn Wortnest sie ausgelöst hat), Eltern können sie beenden.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const aktiv = (id) => $(`#${id}`).classList.contains('active');
  await startFertig;
  folgeAbspielen = () => Promise.resolve();
  const gestartet = [];
  SPIELE.wieviele = SPIELE.wieviele || (() => {});
  const echtesSpiel = SPIELE.wieviele;
  SPIELE.wieviele = () => gestartet.push('wieviele');
  spieleZeigen();
  // Ein Spiel-Bildschirm zum Testen des Spielendes
  document.body.insertAdjacentHTML('beforeend', '<section id="testspiel" class="screen"><header class="topbar"></header></section>');

  // 1. Standard: aus; Spielzeit zählt nur sichtbar und nicht im Elternbereich
  pruefe(pauseNach() === 0 && !pauseFaellig() && !pauseLaeuft(), 'Pause nicht standardmäßig aus');
  spielzeitZaehlen();
  let z = JSON.parse(localStorage.getItem('nest:spielzeit'));
  pruefe(z && z.ms > 0 && z.heute === z.ms && z.tag === heuteTag(), `Spielzeit nicht gezählt: ${JSON.stringify(z)}`);
  elternOeffnen();
  const vorher = JSON.parse(localStorage.getItem('nest:spielzeit')).ms;
  spielzeitZaehlen();
  pruefe(JSON.parse(localStorage.getItem('nest:spielzeit')).ms === vorher, 'Im Elternbereich wird gezählt');

  // 2. Einstellung im Elternbereich → gemeinsamer Schlüssel; Text für Eltern mit Minuten, gilt für beide Apps
  [...$('#pause-wahl').children][1].click();
  pruefe(localStorage.getItem('nest:pauseNach') === '10' && !localStorage.getItem('zn:pauseNach'), 'Pause nicht unter nest:pauseNach');
  pruefe($('#eltern').textContent.includes('Gilt für Wortnest, Zahlennest und Formennest'), 'Hinweis „beide Apps“ fehlt');
  pruefe($('#spielzeit-heute').textContent.startsWith('Heute gespielt') && $('#spielzeit-heute').textContent.includes('Wortnest, Zahlennest und Formennest zusammen'), 'Spielzeit heute fehlt');
  pruefe($('#btn-pause-aus').hidden, '„Pause beenden“ ohne Pause');
  zurStartseite(); await warte(300);

  // 3. Genug gespielt → am Spielende das Pausen-Bild statt 🏠/🔁; Zähler zurück, Zeitpunkt gemerkt
  speicher.schreiben('nest:spielzeit', { ms: 11 * 60000, letzte: Date.now(), tag: heuteTag(), heute: 11 * 60000 });
  zeigen('testspiel');
  spielEnde('testspiel', () => {});
  pruefe(aktiv('pause') && !$('#testspiel .spiel-ende'), 'Kein Pausen-Bild am Spielende');
  pruefe(spielzeitLesen().ms === 0 && spielzeitLesen().heute === 11 * 60000, 'Spielzeit nach der Pause falsch');
  pruefe(Date.now() - Number(localStorage.getItem('nest:pauseAm')) < 5000, 'Pausen-Zeitpunkt nicht gemerkt');
  $('#btn-pause-home').click(); await warte(300);
  pruefe(aktiv('home'), '🏠 führt nicht zur Startseite');

  // 4. Während der Pause: Spiel antippen → wieder das Pausen-Bild, kein Spiel
  $('#home .spiel-btn[data-spiel="wieviele"]').click();
  pruefe(aktiv('pause') && !gestartet.length, 'Spiel startet während der Pause');
  $('#btn-pause-home').click(); await warte(300);
  pruefe(aktiv('home'), 'Zurück aus dem Pausen-Bild');

  // 5. Eltern beenden die Pause → Spiel startet wieder
  elternOeffnen();
  pruefe(!$('#btn-pause-aus').hidden, '„Pause beenden“ fehlt');
  $('#btn-pause-aus').click();
  pruefe(!pauseLaeuft() && $('#btn-pause-aus').hidden, 'Pause nicht beendet');
  zurStartseite(); await warte(300);
  $('#home .spiel-btn[data-spiel="wieviele"]').click();
  pruefe(gestartet.length === 1, 'Spiel startet nach der Pause nicht');

  // 6. Pause aus Wortnest (gleicher Schlüssel) gilt auch hier; nach einer halben Stunde nicht mehr
  zeigen('home', false);
  localStorage.setItem('nest:pauseAm', String(Date.now() - 60000));
  pruefe(pauseLaeuft(), 'Pause aus Wortnest gilt nicht');
  localStorage.setItem('nest:pauseAm', String(Date.now() - 31 * 60000));
  pruefe(!pauseLaeuft(), 'Pause gilt länger als eine halbe Stunde');
  // Pause „aus“ beendet auch eine laufende Pause
  localStorage.setItem('nest:pauseAm', String(Date.now()));
  speicher.schreiben('nest:pauseNach', 0);
  pruefe(!pauseLaeuft() && !pauseFaellig(), 'Mit „aus“ läuft noch eine Pause');

  // 7. Nach 30 Minuten ohne Spiel beginnt die Zählung neu; ein neuer Tag beginnt bei null
  speicher.schreiben('nest:spielzeit', { ms: 9 * 60000, letzte: Date.now() - 31 * 60000, tag: heuteTag(), heute: 9 * 60000 });
  pruefe(spielzeitLesen().ms === 0 && spielzeitLesen().heute === 9 * 60000, 'Zählung beginnt nicht neu');
  speicher.schreiben('nest:spielzeit', { ms: 60000, letzte: Date.now(), tag: '2000-01-01', heute: 60000 });
  pruefe(spielzeitLesen().heute === 0 && spielzeitLesen().ms === 60000, 'Neuer Tag beginnt nicht bei null');
  // Kaputte Werte (z. B. von einer anderen Version) führen nicht zum Absturz
  localStorage.setItem('nest:spielzeit', '"quatsch"');
  pruefe(spielzeitLesen().ms === 0, 'Kaputte Spielzeit');

  // Ansicht: Pausen-Bild
  SPIELE.wieviele = echtesSpiel;
  speicher.schreiben('nest:pauseNach', 10);
  localStorage.setItem('nest:pauseAm', String(Date.now()));
  pauseBildZeigen();
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'PAUSE-TESTS OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
