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
  await ev(() => { const d = window.__draft; d.S.me = { name: 'Редактор', role: 'producer' }; d.applyRole(); d.renderScenes(); });
  await p.click('#lockNum'); await p.waitForTimeout(200);
  const a = await nums();
  await p.click('#editor .b.t-action'); await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  const u = await nums();
  check(!u.lock && u.nums === '1,2,3,4,5,6', 'undo after lock removes the lock and keeps numbers: ' + JSON.stringify(u));
  await p.keyboard.press('Control+y'); await p.waitForTimeout(200);
  const r = await nums();
  check(r.lock && r.nums === a.nums, 'redo brings the lock back: ' + JSON.stringify(r));
  // no reader mode: both modes edit, the on-screen watermark is gone; a reader's copy is the PDF watermark checkbox
  await ev(() => { const d = window.__draft; d.S.me = { name: 'Сценарист Петров', role: 'writer' }; d.applyRole(); d.S.curScene = d.S.st.scenes[1].id; d.renderScenes(); });
  check(await p.locator('#scOmit, #scSyn').count() === 2, 'writer inspector has edit controls');
  check(await ev(() => !document.getElementById('page').style.getPropertyValue('--wm-img') && !document.getElementById('page').dataset.wm), 'no on-screen watermark');
  check(await ev(() => !document.getElementById('btnImport').hidden && !document.getElementById('mNewEp').hidden && !document.getElementById('tbPdf').hidden), 'writer menu keeps import, new episode and the PDF button');
  await p.locator('[data-exp=pdf]').first().dispatchEvent('click'); await p.waitForTimeout(300);
  check(await p.locator('#pdfWm').isChecked() && await p.inputValue('#pdfTo') === 'Сценарист Петров', 'PDF dialog: the watermark is on while «Для кого» is filled');
  await p.fill('#pdfTo', ''); await p.waitForTimeout(100);
  check(!(await p.locator('#pdfWm').isChecked()), 'clearing «Для кого» turns the watermark off');
  await p.fill('#pdfTo', 'Актёр'); await p.waitForTimeout(100);
  check(await p.locator('#pdfWm').isChecked(), 'and a name turns it on again');
  await p.click('#pdfC');
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  if (fails.length) process.exit(1);
})();
