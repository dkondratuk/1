// self-check fixes: undo after lock, reader is read-only, tiled watermark (exits 1 on failure)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(600);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const fails = []; const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const nums = () => ev(() => ({ lock: !!window.__draft.S.ep.lock, nums: window.__draft.S.st.scenes.map((s) => s.num).join(',') }));
  await p.click('[data-ltab=scenes]');
  await ev(() => { const d = window.__draft; d.S.me = { name: 'Редактор', role: 'editor' }; d.applyRole(); d.renderScenes(); });
  await p.click('#lockNum'); await p.waitForTimeout(200);
  const a = await nums();
  await p.click('#editor .b.t-action'); await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  const u = await nums();
  check(!u.lock && u.nums === '1,2,3,4,5,6', 'undo after lock removes the lock and keeps numbers: ' + JSON.stringify(u));
  await p.keyboard.press('Control+y'); await p.waitForTimeout(200);
  const r = await nums();
  check(r.lock && r.nums === a.nums, 'redo brings the lock back: ' + JSON.stringify(r));
  // reader
  await ev(() => { const d = window.__draft; d.S.me = { name: 'Актёр Петров', role: 'reader' }; d.applyRole(); d.S.curScene = d.S.st.scenes[1].id; d.renderScenes(); });
  check(await p.locator('#scOmit, #scUp, #scSyn, #renum').count() === 0, 'reader inspector has no edit controls');
  const before = await ev(() => JSON.stringify(window.__draft.S.ep.blocks));
  await ev(() => { const d = window.__draft; d.omitScene(d.S.st.scenes[1]); });
  check(before === await ev(() => JSON.stringify(window.__draft.S.ep.blocks)), 'omitScene is blocked for a reader');
  await p.click('#editor .b.t-action'); await p.keyboard.press('Control+z'); await p.keyboard.press('Control+1'); await p.waitForTimeout(200);
  check(before === await ev(() => JSON.stringify(window.__draft.S.ep.blocks)), 'Ctrl+Z and Ctrl+1 do nothing for a reader');
  check(await ev(() => !!document.getElementById('page').style.getPropertyValue('--wm-img')), 'tiled watermark image is set');
  check(await ev(() => document.getElementById('tbImport').hidden && document.getElementById('mNewEp').hidden), 'reader menu hides import and new episode');
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  if (fails.length) process.exit(1);
})();
