// Testet den 👍 für Erwachsene: kurz antippen löst nichts aus, etwa eine Sekunde gedrückt halten schon (ein Ring füllt
// sich dabei); Klicks aus Tests und per Tastatur gehen durch. Frisches Profil.
(async function () {
  const fehler = [];
  const pruefe = (b, t) => { if (!b) fehler.push(t); };
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  await startFertig;

  const btn = $('#btn-mehr-daumen');
  btn.hidden = false;
  let ausgeloest = 0;
  btn.addEventListener('click', () => { ausgeloest++; });
  const ev = (typ) => btn.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1, isPrimary: true }));

  // 1. Regel: ein echter kurzer Tipp (vom Gerät, nicht gehalten) ist nicht erlaubt; gehalten, Tastatur, Test schon
  pruefe(!daumenKlickErlaubt({ isTrusted: true, detail: 1 }, btn), 'Kurzer Tipp löst 👍 aus');
  pruefe(daumenKlickErlaubt({ isTrusted: true, detail: 0 }, btn), 'Tastatur geht nicht');
  btn.dataset.gehalten = '1';
  pruefe(daumenKlickErlaubt({ isTrusted: true, detail: 1 }, btn), 'Gehalten geht nicht');
  delete btn.dataset.gehalten;

  // 2. Kurz drücken und loslassen: nichts
  ev('pointerdown'); await warte(250); ev('pointerup');
  await warte(DAUMEN_HALTEN + 200);
  pruefe(ausgeloest === 0 && !btn.classList.contains('haelt'), `Kurz gedrückt löst aus: ${ausgeloest}`);

  // 3. Halten: Ring füllt sich, nach DAUMEN_HALTEN ausgelöst – genau einmal
  ev('pointerdown');
  await warte(200);
  pruefe(btn.classList.contains('haelt'), 'Kein Ring beim Halten');
  await warte(DAUMEN_HALTEN);
  ev('pointerup');
  await warte(100);
  pruefe(ausgeloest === 1 && !btn.classList.contains('haelt'), `Halten löst nicht genau einmal aus: ${ausgeloest}`);

  // 4. Hinweis für Eltern: Begrüßung, Info, Elternbereich
  const html = document.documentElement.innerHTML;
  pruefe((html.match(/👍[^<]*kurz gedrückt|halten Sie[^.]*👍/g) || []).length >= 2 && /Der Daumen 👍/.test(html), 'Erklärung für Eltern fehlt');
  btn.hidden = true;

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;color:#fff;font:12px monospace;padding:6px;z-index:9;background:'
    + (fehler.length ? '#c62828' : '#1b7f3a');
  d.textContent = fehler.length ? 'FEHLER: ' + fehler.join(' | ') : 'DAUMEN OK';
  document.body.appendChild(d);
})().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;bottom:0;background:#c62828;color:#fff;padding:6px;z-index:9">ABSTURZ: ${e}</div>`);
});
