// Data safety: unload flush, project-file merge, snapshots, failed saves, two tabs, comment deletion
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-safety-'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
async function setup(ctx) {
  await ctx.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
}
const typeEnd = async (p, s) => { await p.evaluate(() => { const els = [...document.querySelectorAll('#editor .b')]; const el = els[els.length - 1]; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('editor').focus(); }); await p.keyboard.type(s, { delay: 5 }); };
const has = (p, w) => p.evaluate((w) => document.getElementById('editor').innerText.includes(w), w);
const dump = (p, f) => p.evaluate(() => JSON.stringify({ app: 'draft', version: 1, project: JSON.parse(JSON.stringify(window.__draft.S.project, (k, v) => (k === '_st' ? undefined : v))) })).then((j) => fs.writeFileSync(f, j));
const openFile = async (p, f) => { await p.evaluate(() => { document.getElementById('fileInput').dataset.mode = 'project'; }); await p.setInputFiles('#fileInput', f); await p.waitForTimeout(800); };
const bar = (p) => p.evaluate(() => { const b = document.getElementById('saveBar'); return b && !b.hidden ? b.textContent : ''; });
async function fresh(b) { const ctx = await b.newContext(); await setup(ctx); const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PE', e.message); fails++; }); await p.goto(URL); await p.waitForTimeout(1200); return { ctx, p }; }

(async () => {
  const b = await chromium.launch();
  try {
    // 1. typing right before a reload or a hidden tab survives
    { const { ctx, p } = await fresh(b);
      await typeEnd(p, ' СЛОВОРЕЛОАД'); await p.waitForTimeout(100); await p.reload(); await p.waitForTimeout(1200);
      ok(await has(p, 'СЛОВОРЕЛОАД'), 'text typed 100 ms before a reload is kept');
      await typeEnd(p, ' СЛОВОСКРЫТ'); await p.waitForTimeout(100);
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.waitForTimeout(150);
      ok(await p.evaluate(async () => { const d = await new Promise((res) => { const r = indexedDB.open('draft-app'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('db'); q.onsuccess = () => res(q.result); }; }); return JSON.stringify(d).includes('СЛОВОСКРЫТ'); }), 'hiding the tab writes the project at once');
      // a copy left in localStorage by an unload whose database write was lost is put back at boot
      await p.evaluate(() => { const S = window.__draft.S; const pend = { tab: 'zz', at: Date.now(), epId: S.ep.id, blocks: S.ep.blocks.concat([{ id: 'pz', t: 'action', x: 'ХВОСТ_ИЗ_ДРУГОЙ' }]), sceneMeta: S.ep.sceneMeta, lock: null, textAt: Date.now(), updated: Date.now() }; localStorage.setItem('draft.pending', JSON.stringify(pend)); });
      await p.evaluate(() => { localStorage.setItem = () => {}; }); // keep the injected copy through this page's own unload
      await p.close(); const p2 = await ctx.newPage(); await p2.goto(URL); await p2.waitForTimeout(2500);
      ok(await p2.evaluate(() => window.__draft.S.ep.drafts.some((d) => JSON.stringify(d.blocks).includes('ХВОСТ_ИЗ_ДРУГОЙ'))), 'unsaved copy from another tab becomes a draft');
      await ctx.close(); }

    // 2. project file round trip: an opened-only copy does not replace newer local text; a really newer text keeps the local one as a draft
    { const { p: wp } = await fresh(b);
      const w0 = path.join(tmp, 'w0.json'); await dump(wp, w0);
      await typeEnd(wp, ' НОВАЯ_РАБОТА'); await wp.waitForTimeout(1200);
      const { p: pp } = await fresh(b); await openFile(pp, w0);
      await pp.evaluate(() => { const d = window.__draft; d.S.ep.comments.push({ id: 'cX', author: 'Продюсер', role: 'producer', text: 'ок', quote: '', date: Date.now(), replies: [], blockId: d.S.ep.blocks[0].id }); d.recompute(); });
      const p1 = path.join(tmp, 'p1.json'); await dump(pp, p1);
      await openFile(wp, p1);
      ok(await has(wp, 'НОВАЯ_РАБОТА'), 'opening a copy that was only commented keeps the newer local text');
      ok(await wp.evaluate(() => window.__draft.S.ep.comments.some((c) => c.id === 'cX')), 'comment from the file is added');
      await typeEnd(pp, ' ПРАВКА_ПРОДЮСЕРА'); await pp.waitForTimeout(400);
      const p2 = path.join(tmp, 'p2.json'); await dump(pp, p2);
      await openFile(wp, p2);
      ok(await has(wp, 'ПРАВКА_ПРОДЮСЕРА'), 'text edited later in the file replaces the local one');
      ok(await wp.evaluate(() => window.__draft.S.ep.drafts.some((d) => JSON.stringify(d.blocks).includes('НОВАЯ_РАБОТА'))), 'replaced local text is kept as a draft');
      ok(/заменён/.test(await wp.textContent('#toast')), 'toast says the text was replaced');
      await wp.context().close(); await pp.context().close(); }

    // 3. "before ..." snapshots hold the state before the change
    { const { ctx, p } = await fresh(b);
      const r = await p.evaluate(async () => { const d = window.__draft, ep = d.S.ep; const first = ep.blocks[0].x; const pr = d.histAdd(ep, 'перед тестом', true); ep.blocks = [{ id: 'q', t: 'scene', x: 'ИНТ. ДРУГОЕ - НОЧЬ' }]; const h = await pr; return h.blocks[0].x === first; });
      ok(r, 'histAdd copies the episode before its first await');
      await ctx.close(); }

    // 4. failed saves are reported; an episode is not deleted without its trash copy
    { const { ctx, p } = await fresh(b);
      await p.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
      await typeEnd(p, ' ПОСЛЕ_КВОТЫ'); await p.waitForTimeout(1300);
      ok(/Не удалось сохранить/.test(await bar(p)), 'a failed save shows a lasting warning');
      await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
      ok(/Не удалось/.test(await p.textContent('#toast')), 'Ctrl+S does not claim success');
      const n0 = await p.evaluate(() => window.__draft.S.project.episodes.length);
      await p.evaluate(() => { const d = window.__draft; d.S.me = Object.assign({}, d.S.me, { role: 'producer' }); d.applyRole(); });
      await p.locator('#delEp').dispatchEvent('click');
      await p.locator('#deOk').dispatchEvent('click'); await p.waitForTimeout(500);
      ok(await p.evaluate(() => window.__draft.S.project.episodes.length) === n0, 'episode stays when the trash cannot be written');
      await p.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
      await typeEnd(p, ' СНОВА'); await p.waitForTimeout(1300);
      ok(!(await bar(p)), 'warning goes away after a good save');
      await ctx.close(); }

    // 5. two tabs: the older one stops writing; its unsaved text comes back as a draft
    { const ctx = await b.newContext(); await setup(ctx);
      const a = await ctx.newPage(); await a.goto(URL); await a.waitForTimeout(1200);
      await typeEnd(a, ' ТЕКСТ_А'); await a.waitForTimeout(1200);
      await typeEnd(a, ' НЕСОХР_А');                 // not saved yet when tab B takes over
      const bb = await ctx.newPage(); await bb.goto(URL); await bb.waitForTimeout(1500);
      ok(/другой вкладке/.test(await bar(a)), 'older tab shows the other-tab warning');
      ok(await a.evaluate(() => document.getElementById('editor').getAttribute('contenteditable')) === 'false', 'older tab is read-only');
      await typeEnd(bb, ' ТЕКСТ_Б'); await bb.waitForTimeout(1300);
      await a.evaluate(() => window.__draft.recompute()); await a.waitForTimeout(1200); await a.close();
      const c = await ctx.newPage(); await c.goto(URL); await c.waitForTimeout(1500);
      ok(await has(c, 'ТЕКСТ_А') && await has(c, 'ТЕКСТ_Б'), 'saved text of both tabs is in the database');
      ok(await c.evaluate(() => window.__draft.S.ep.drafts.some((d) => JSON.stringify(d.blocks).includes('НЕСОХР_А'))), 'unsaved text of the older tab is a draft after reload');
      ok(await c.evaluate(() => !window.__draft.S.ep.drafts.some((d) => /^Несохранённое/.test(d.name))), 'closing the stale tab adds no stale copy');
      // a write that lost the race (no channel message) is refused too
      await c.evaluate(() => new Promise((res) => { const r = indexedDB.open('draft-app'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ n: 9999, tab: 'other' }, 'rev'); tx.oncomplete = res; }; }));
      await typeEnd(c, ' ПОЗДНО_С'); await c.waitForTimeout(1500);
      ok(/другой вкладке/.test(await bar(c)), 'refused write turns the tab stale');
      const d = await ctx.newPage(); await d.goto(URL); await d.waitForTimeout(1500);
      ok(await d.evaluate(() => window.__draft.S.ep.drafts.some((x) => JSON.stringify(x.blocks).includes('ПОЗДНО_С'))), 'text of the refused write is a draft after reload');
      await ctx.close(); }

    // 6. comments: only the author or a producer deletes; deletion can be undone; a reader neither replies nor adds
    { const { ctx, p } = await fresh(b);
      await p.evaluate(() => { const d = window.__draft; d.S.ep.comments.push({ id: 'cP', author: 'Продюсер', role: 'producer', text: 'прод', quote: '', date: Date.now(), replies: [], blockId: d.S.ep.blocks[0].id }, { id: 'cW', author: d.S.me.name, role: 'writer', text: 'моё', quote: '', date: Date.now(), replies: [], blockId: d.S.ep.blocks[0].id }); d.S.rtab = 'comments'; d.recompute(); });
      await p.evaluate(() => { document.querySelector('[data-rtab="comments"]') && document.querySelector('[data-rtab="comments"]').click(); });
      await p.waitForTimeout(200);
      const pane = '#pane-comments';
      await p.locator(pane + ' [data-del="cP"]').dispatchEvent('click');
      ok(await p.evaluate(() => window.__draft.S.ep.comments.some((c) => c.id === 'cP')), 'writer cannot delete a producer comment');
      await p.evaluate(() => { const x = document.getElementById('npC'); if (x) x.click(); });
      await p.locator(pane + ' [data-del="cW"]').dispatchEvent('click');
      ok(await p.evaluate(() => !window.__draft.S.ep.comments.some((c) => c.id === 'cW') && window.__draft.S.ep.deletedComments.some((c) => c.id === 'cW')), 'author deletes own comment into the deleted list');
      await p.locator(pane + ' #cmDeleted').dispatchEvent('click');
      await p.locator(pane + ' [data-undel="cW"]').dispatchEvent('click');
      ok(await p.evaluate(() => window.__draft.S.ep.comments.some((c) => c.id === 'cW')), 'deleted comment can be put back');
      await p.evaluate(() => { const d = window.__draft; d.S.me = Object.assign({}, d.S.me, { role: 'reader' }); d.applyRole(); d.recompute(); });
      await p.fill(pane + ' [data-reply="cP"]', 'ответ читателя'); await p.press(pane + ' [data-reply="cP"]', 'Enter');
      ok(await p.evaluate(() => !window.__draft.S.ep.comments.find((c) => c.id === 'cP').replies.length), 'reader cannot reply');
      await p.evaluate(() => { const el = document.querySelector('#editor .b'); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
      await p.locator(pane + ' #cmNew').dispatchEvent('click');
      ok(await p.evaluate(() => !document.getElementById('cmText')), 'reader cannot add a comment');
      await p.evaluate(() => { const d = window.__draft; d.S.me = Object.assign({}, d.S.me, { role: 'producer' }); d.applyRole(); d.recompute(); });
      await p.locator(pane + ' [data-del="cP"]').dispatchEvent('click');
      ok(await p.evaluate(() => !window.__draft.S.ep.comments.some((c) => c.id === 'cP')), 'producer deletes a producer comment');
      await ctx.close(); }
  } catch (e) { console.log('ERROR', e); fails++; }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all safety checks passed');
  process.exit(fails ? 1 : 0);
})();
