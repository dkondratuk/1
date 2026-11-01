// two tabs: a tab with nothing unsaved takes the other tab's newer data instead of turning read-only (exits 1 on failure)
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  const typeEnd = async (p, s) => { await p.evaluate(() => { const els = [...document.querySelectorAll('#editor .b')]; const el = els[els.length - 1]; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('editor').focus(); }); await p.keyboard.type(s, { delay: 5 }); };
  const stale = (p) => p.evaluate(() => { const x = document.getElementById('saveBar'); return !!(x && !x.hidden && /другой вкладке/.test(x.textContent)); });
  const has = (p, w) => p.evaluate((w) => document.getElementById('editor').innerText.includes(w), w);
  const A = await ctx.newPage(); await A.goto(URL); await A.waitForTimeout(1500);
  const B = await ctx.newPage(); await B.goto(URL); await B.waitForTimeout(2000);
  ok(!(await stale(A)), 'opening a second tab does not lock the first one');
  await typeEnd(B, ' ИЗВКЛАДКИБ'); await B.waitForTimeout(2000);
  ok(await has(A, 'ИЗВКЛАДКИБ') && !(await stale(A)), 'the idle tab shows the text typed in the other tab');
  await typeEnd(A, ' ИЗВКЛАДКИА'); await A.waitForTimeout(2000);
  ok(await has(B, 'ИЗВКЛАДКИА') && await has(B, 'ИЗВКЛАДКИБ') && !(await stale(B)), 'and back: both edits are in both tabs');
  ok(await A.evaluate(() => window.__draft.S.ep.blocks.length) === await B.evaluate(() => window.__draft.S.ep.blocks.length), 'both tabs hold the same text');
  // reload right after typing: the page must come back editable with the text
  await typeEnd(A, ' ПЕРЕДРЕЛОАД'); await A.waitForTimeout(80); await A.reload(); await A.waitForTimeout(2000);
  ok(await has(A, 'ПЕРЕДРЕЛОАД') && !(await stale(A)), 'a quick reload keeps the text and stays editable');
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all tab checks passed'); if (fails) process.exit(1);
})();
