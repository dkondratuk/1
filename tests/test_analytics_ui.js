// UI regression checks for the analytics fixes: stale episode cache, season violations, bible scene number
const { chromium } = require('playwright');
const path = require('path');
const nm = path.resolve(__dirname, '../node_modules') + '/';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('PE', e.message); failed++; });
  await p.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    if (u.includes('pdf.worker.min.js')) return r.fulfill({ path: nm + 'pdfjs-dist/build/pdf.worker.min.js', contentType: 'text/javascript' });
    if (u.includes('pdf.min.js')) return r.fulfill({ path: nm + 'pdfjs-dist/build/pdf.min.js', contentType: 'text/javascript' });
    if (u.startsWith('file:')) return r.continue(); return r.abort(); });
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html'));
  await p.waitForFunction(() => window.__draft && window.__draft.S.ep);
  await p.waitForTimeout(400);
  const meta = (i) => p.evaluate((i) => { const e = __draft.S.project.episodes[i]; return document.querySelector('[data-meta="' + e.id + '"]').textContent; }, i);
  const fresh = (i) => p.evaluate((i) => { const e = __draft.S.project.episodes[i]; return __draft.C.analyzeEpisode(e, __draft.S.project).pages.toFixed(1) + ' стр'; }, i);

  // 1. bible «Впервые … сц. N» uses the displayed scene number, not the position
  await p.evaluate(() => { const { S, recompute } = __draft; const sc = S.st.scenes[0]; S.ep.sceneMeta = S.ep.sceneMeta || {}; S.ep.sceneMeta[sc.id] = Object.assign(S.ep.sceneMeta[sc.id] || {}, { num: '51' }); recompute(); });
  await p.locator('[data-rtab="bible"]').dispatchEvent('click');
  await p.waitForTimeout(200);
  const bible = await p.evaluate(() => document.querySelector('#pane-bible, [data-pane="bible"]') ? document.querySelector('#pane-bible, [data-pane="bible"]').textContent : document.body.textContent);
  check(/Впервые: серия 1, сц\. 51/.test(bible) && !/Впервые: серия 1, сц\. 1 /.test(bible), 'bible shows scene number 51 for the first scene');
  await p.evaluate(() => { const { S, recompute } = __draft; delete S.ep.sceneMeta[S.st.scenes[0].id].num; recompute(); });

  // 2. the episode list does not fall back to an episode's analysis from before its edits
  const before = await meta(1);
  await p.locator('#pane-episodes .ep').nth(1).click(); await p.waitForTimeout(300);
  await p.locator('#editor .b').last().click(); await p.keyboard.press('End');
  for (let i = 0; i < 6; i++) { await p.keyboard.press('Enter'); await p.keyboard.type('Длинное описание действия, чтобы прибавить строк. '.repeat(8)); }
  await p.waitForTimeout(600);
  await p.locator('#pane-episodes .ep').nth(0).click(); await p.waitForTimeout(400);
  const after = await meta(1), want = await fresh(1);
  check(after.startsWith(want) && after !== before, 'episode list shows edited episode after switching away (' + before + ' -> ' + after + ', want ' + want + ')');
  await p.waitForTimeout(1200);
  const stored = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('draft-app', 1); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('db'); q.onsuccess = () => res(JSON.stringify(q.result).includes('"_st"')); }; }));
  check(!stored, 'stored db has no _st cache');
  await p.reload(); await p.waitForFunction(() => window.__draft && window.__draft.S.ep); await p.waitForTimeout(400);
  check((await meta(1)).startsWith(await fresh(1)), 'episode list correct after reload');

  // 3. season summary «Нарушений» uses the season context like the Rules tab
  await p.evaluate(() => {
    const { S } = __draft; const P = S.project; let n = 0;
    const blocks = (k) => { const b = [{ id: 'q' + k + n++, t: 'scene', x: 'ИНТ. КВАРТИРА - ДЕНЬ' }];
      for (let i = 0; i < 120; i++) b.push({ id: 'q' + k + n++, t: 'action', x: 'Петя ходит по квартире и думает о жизни долго и подробно, строка номер ' + i + '.' });
      b.push({ id: 'q' + k + n++, t: 'scene', x: 'ИНТ. ДАЧА - ДЕНЬ' });
      for (let i = 0; i < 120; i++) b.push({ id: 'q' + k + n++, t: 'action', x: 'Маша сидит на даче и смотрит в окно задумчиво, строка ' + i + '.' });
      return b; };
    const e1 = P.episodes[1], season = P.episodes[0].season;
    e1.season = season; e1.blocks = blocks(1); e1.sceneMeta = {}; delete e1._st;
    const e2 = JSON.parse(JSON.stringify(e1)); e2.id = 'qep2'; e2.number = Math.max(...P.episodes.map((e) => e.number)) + 1; e2.blocks = blocks(2);
    P.episodes.push(e2);
  });
  await p.locator('#pane-episodes .ep').nth(0).click(); await p.waitForTimeout(300);
  await p.locator('#pane-episodes .ep[data-id="qep2"]').click(); await p.waitForTimeout(400);
  const r = await p.evaluate(() => { const { S } = __draft; const d = S.rulesRes.find((x) => x.id === 'newobj'); return { fails: S.rulesRes.filter((x) => x.status === 'fail').length, newobj: d && d.status, idx: S.project.episodes.filter((e) => e.season === S.ep.season).indexOf(S.ep) }; });
  check(r.newobj !== 'fail', 'rules tab: new object short in the episode but long over the season is not a failure (' + r.newobj + ')');
  await p.locator('#btnSeason').dispatchEvent('click'); await p.waitForTimeout(300);
  const cell = await p.evaluate((i) => { const rows = document.querySelectorAll('.modal table.t tbody tr, dialog table.t tbody tr'); const row = rows[i]; return row ? row.lastElementChild.textContent.trim() : null; }, r.idx);
  check(cell === String(r.fails), 'season summary «Нарушений» matches the Rules tab (' + cell + ' vs ' + r.fails + ')');

  // 5. bible cards: scene chips per episode (click opens the episode and the scene) and a relationship control on every card
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await p.locator('#pane-episodes .ep').nth(0).click(); await p.waitForTimeout(300);
  await p.locator('[data-rtab="bible"]').dispatchEvent('click'); await p.waitForTimeout(250);
  const card = (n) => p.locator('#pane-bible .chr').filter({ has: p.locator('.nm', { hasText: new RegExp('^' + n + '$') }) });
  const lw = await p.evaluate(() => { const { S, C } = __draft; const out = {};
    for (const e of S.project.episodes) { const st = e === S.ep ? S.st : C.analyzeEpisode(e, S.project); const nums = st.scenes.filter((s) => s.cast.includes('ЛЕНА')).map((s) => s.num); if (nums.length) out[e.id] = nums; } return out; });
  const chips = await card('ЛЕНА').locator('[data-chjump]').evaluateAll((bs) => bs.map((b) => [b.dataset.chjump.split('|')[0], b.textContent]));
  const lg = {}; chips.forEach(([e, n]) => { (lg[e] = lg[e] || []).push(n); });
  check(JSON.stringify(lg) === JSON.stringify(lw) && chips.length > 0, 'bible: scene chips per episode for ЛЕНА ' + JSON.stringify(lg));
  check(/Серия 1:/.test(await card('ЛЕНА').locator('.chr-scenes').innerText()), 'bible: chips grouped under «Серия N»');
  const lother = Object.keys(lw)[0];
  // switch to another episode first: the chip must bring its own episode back
  await p.locator('#pane-episodes .ep:not([data-id="' + lother + '"])').first().click(); await p.waitForTimeout(300);
  await p.locator('[data-rtab="bible"]').dispatchEvent('click'); await p.waitForTimeout(250);
  const lchip = card('ЛЕНА').locator('[data-chjump^="' + lother + '|"]').last();
  const lsid = (await lchip.getAttribute('data-chjump')).split('|')[1];
  await lchip.click(); await p.waitForTimeout(400);
  check(await p.evaluate(([e, s]) => __draft.S.ep.id === e && __draft.S.curScene === s && !!document.querySelector('#editor [data-id="' + s + '"]'), [lother, lsid]), 'bible: a scene chip opens its episode and scene');
  await p.locator('[data-rtab="bible"]').dispatchEvent('click'); await p.waitForTimeout(250);
  const last = await p.locator('#pane-bible .chr .nm').last().innerText();
  const c2 = card(last);
  const rel0 = await p.evaluate(() => JSON.stringify(__draft.S.project.relations || []));
  const relNow = () => p.evaluate(() => __draft.S.project.relations || []);
  check(await c2.locator('[data-relwith]').count() === 1, 'bible: every card has a relationship control (' + last + ')');
  await c2.locator('[data-reladd]').click(); await p.waitForTimeout(100);
  check(JSON.stringify(await relNow()) === rel0 && /Выберите/.test(await p.locator('#toast').innerText()), 'bible: no partner chosen, nothing saved');
  await c2.locator('[data-relwith]').selectOption('ЛЕНА'); await c2.locator('[data-rellabel]').fill('соседи'); await c2.locator('[data-reladd]').click(); await p.waitForTimeout(200);
  check(JSON.stringify(await relNow()) === JSON.stringify(JSON.parse(rel0).concat([{ a: last, b: 'ЛЕНА', label: 'соседи' }])), 'bible: relation saved from the card');
  check(/ЛЕНА — соседи/.test(await card(last).innerText()) && /соседи/.test(await card('ЛЕНА').innerText()), 'bible: relation shown on both cards');
  await card('ЛЕНА').locator('[data-relwith]').selectOption(last); await card('ЛЕНА').locator('[data-rellabel]').fill('бывшие'); await card('ЛЕНА').locator('[data-reladd]').click(); await p.waitForTimeout(200);
  check((await relNow()).length === JSON.parse(rel0).length + 1 && (await relNow()).filter((r) => r.label === 'бывшие').length === 1, 'bible: the same pair is relabelled, not duplicated');
  await card(last).locator('[data-reldel]').click(); await p.waitForTimeout(200);
  check(JSON.stringify(await relNow()) === rel0, 'bible: × removes the relation');
  await p.evaluate(() => { const d = __draft; d.S.me = { name: 'Читатель', role: 'reader' }; d.applyRole(); d.recompute(); });
  await p.locator('[data-rtab="bible"]').dispatchEvent('click'); await p.waitForTimeout(250);
  check(await p.locator('#pane-bible [data-relwith]').count() === 0 && await p.locator('#pane-bible [data-chjump]').count() > 0, 'bible: reader sees scene chips but no relationship editor');

  await b.close();
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('test_analytics_ui: ok');
})().catch((e) => { console.log(e); process.exit(1); });
