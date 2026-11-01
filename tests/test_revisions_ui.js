// Revisions and locked pages, UI: Production menu dialog, roles, marks on screen, status bar, undo/drafts, A-pages, PDF and FDX
const { chromium } = require('playwright');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
let fails = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const nm = path.resolve(__dirname, '../node_modules') + '/';
  await p.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(600);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const role = (r, name) => ev(([r, name]) => { const d = window.__draft; d.S.me = { name, role: r }; d.applyRole(); d.recompute(); }, [r, name]);
  const menu = async (id) => { await p.locator(id).dispatchEvent('click'); await p.waitForTimeout(250); };
  const today = await ev(() => new Date().toLocaleDateString('ru-RU'));

  // enough text for five pages, so there are later pages to keep when the pages are locked
  await ev(() => {
    const d = window.__draft, bl = d.readBlocks();
    for (let j = 0; j < 70; j++) bl.push({ id: 'L' + j, t: 'action', x: 'Строка для объёма номер ' + j + '.' });
    d.S.ep.blocks = bl; document.querySelector('#editor').innerHTML = bl.map((x) => '<div class="b t-' + x.t + '" data-t="' + x.t + '" data-id="' + x.id + '"></div>').join('');
    [...document.querySelectorAll('#editor > .b')].forEach((e, i) => { e.textContent = bl[i].x; });
    d.recompute();
  });
  // 1. a writer sees the dialog but cannot start a revision or lock pages
  await menu('#mRevisions');
  ok(/Ревизии/.test(await p.locator('#modal h2').innerText()), 'Production → Ревизии… opens the dialog');
  ok(await p.locator('#rvStart').count() === 0 && await p.locator('#rvLock').count() === 0, 'writer: no start / lock buttons');
  await p.click('#rvClose');
  // a named draft of the white text, to check that revisions travel with the text
  await menu('#btnDraft'); await p.fill('#drName', 'Белый драфт'); await p.click('#drOk'); await p.waitForTimeout(200);

  // 2. editor starts the blue revision
  await role('editor', 'Редактор Иванова');
  await menu('#mRevisions');
  ok(/Голубая/.test(await p.locator('#rvStart').innerText()), 'start button names the next set: ' + await p.locator('#rvStart').innerText());
  await p.click('#rvStart'); await p.waitForTimeout(300);
  let st = await ev(() => { const e = window.__draft.S.ep; return { lv: e.revLevel, n: (e.revisions || []).length, name: e.revisions && e.revisions[0].name, by: e.revisions && e.revisions[0].by, base: e.revisions && e.revisions[0].base.length, blocks: e.blocks.length }; });
  ok(st.lv === 1 && st.n === 1 && st.name === 'Голубая' && st.base === st.blocks && /Иванова/.test(st.by), 'revision stored: ' + JSON.stringify(st));
  ok(/Голубая/.test(await p.locator('#modal').innerText()) && /текущая/.test(await p.locator('#modal').innerText()), 'dialog lists the revision as current');
  ok(/Розовая/.test(await p.locator('#rvStart').innerText()), 'next one would be pink');
  await p.click('#rvClose');
  ok(/Голубая ревизия/.test(await p.locator('#revInfo').innerText()), 'status bar shows the revision: ' + await p.locator('#revInfo').innerText());
  ok(await p.locator('.revmark').count() === 0, 'no marks before any change');

  // 3. typing marks the block, in the revision colour; block.rev is set
  const k = await ev(() => window.__draft.S.ep.blocks.findIndex((x) => x.t === 'action'));
  const el = p.locator('#editor > .b').nth(k);
  await el.click(); await p.keyboard.press('End'); await p.keyboard.type(' Добавлено в ревизии.'); await p.waitForTimeout(600);
  st = await ev((k) => { const d = window.__draft; d.recompute(); const m = document.querySelector('.revmark'); return { rev: d.S.ep.blocks[k].rev, marks: document.querySelectorAll('.revmark').length, color: m && m.style.color, txt: m && m.textContent, lines: d.S.st.lay.info[k].L, x: m && (m.getBoundingClientRect().left - document.querySelector('#page').getBoundingClientRect().left) / d.S.zoom / 96 }; }, k);
  ok(st.rev === 1 && st.marks === 1, 'typed block is marked: ' + JSON.stringify(st));
  ok(st.color === 'rgb(47, 127, 216)' && st.txt === Array(st.lines).fill('*').join('\n'), 'asterisk per line in blue');
  ok(Math.abs(st.x - 7.6) < 0.05, 'mark at 7.6in: ' + st.x);
  // 4. the toggle hides and shows the marks (per viewer)
  await menu('#mRevisions'); await p.uncheck('#rvMarks'); await p.waitForTimeout(100);
  ok(await p.locator('.revmark').count() === 0, 'marks hidden');
  await p.check('#rvMarks'); await p.waitForTimeout(100);
  ok(await p.locator('.revmark').count() === 1, 'marks shown again');
  await p.click('#rvClose');

  // 5. undo / redo carry the revision state; restoring a white draft drops it
  await ev(() => { const d = window.__draft; d.undo(); d.undo(); });
  ok(await ev(() => !window.__draft.S.ep.revLevel && !window.__draft.S.ep.revisions), 'undo removes the revision start');
  await ev(() => { const d = window.__draft; d.redo(); d.redo(); });
  ok(await ev(() => window.__draft.S.ep.revLevel === 1 && window.__draft.S.ep.blocks.some((x) => x.rev === 1)), 'redo brings revision and mark back');
  await menu('#mDrafts'); await p.locator('[data-rest]').first().click(); await p.waitForTimeout(300);
  ok(await ev(() => !window.__draft.S.ep.revLevel && !document.querySelector('.revmark')), 'white draft restored without revision');
  await ev(() => window.__draft.undo());
  ok(await ev(() => window.__draft.S.ep.revLevel === 1), 'undo of the restore brings the revision back');

  // 6. lock pages, then add a lot of text on page 1: it flows into 1A and page 2 keeps its first block
  const big = await ev(() => window.__draft.S.st.lay.labels.length);
  await menu('#mRevisions'); await p.click('#rvLock'); await p.waitForTimeout(300);
  st = await ev(() => { const e = window.__draft.S.ep; return { pl: !!e.pageLock, pages: e.pageLock && e.pageLock.pages.length, by: e.pageLock && e.pageLock.by }; });
  ok(st.pl && st.pages === big && /Иванова/.test(st.by), 'pages locked: ' + JSON.stringify(st));
  ok(/Страницы залочены/.test(await p.locator('#modal').innerText()), 'dialog shows the page lock');
  await p.click('#rvClose');
  ok(/страницы залочены/.test(await p.locator('#revInfo').innerText()), 'status bar shows the page lock');
  ok(await p.locator('#mPageLock').innerText() !== '' && /Снять лок страниц/.test(await ev(() => { document.querySelector('[data-menu=prod] .mb-btn').click(); return document.querySelector('#mPageLock').textContent; })), 'menu offers unlock');
  await p.keyboard.press('Escape');
  const p2 = await ev(() => { const d = window.__draft; const pg = d.S.ep.pageLock.pages[1]; return pg.id; });
  await ev(() => {
    const d = window.__draft, bl = d.readBlocks();
    const extra = []; for (let j = 0; j < 14; j++) extra.push({ id: 'X' + j, t: 'action', x: 'Новый абзац ревизии номер ' + j + '.' });
    bl.splice(3, 0, ...extra);
    d.S.ep.blocks = bl; document.querySelector('#editor').innerHTML = bl.map((x) => '<div class="b t-' + x.t + '" data-t="' + x.t + '" data-id="' + x.id + '"></div>').join('');
    [...document.querySelectorAll('#editor > .b')].forEach((e, i) => { e.textContent = bl[i].x; });
    d.recompute();
  });
  st = await ev((p2) => { const d = window.__draft; return { labels: d.S.st.lay.labels.join(','), pb: (document.querySelector('#editor > .b[data-id="' + p2 + '"]') || {}).dataset, marks: document.querySelectorAll('.revmark').length }; }, p2);
  ok(/^1,1A,2,3/.test(st.labels), 'A-page after page 1: ' + st.labels);
  ok(st.pb && st.pb.pb === '2', 'page 2 starts with the same block: ' + JSON.stringify(st.pb));
  ok(await ev(() => [...document.querySelectorAll('#editor > .b[data-pb]')].some((e) => e.dataset.pb === '1A') || [...document.querySelectorAll('#page > .pbin')].some((e) => e.textContent === 'стр. 1A')), 'screen shows the 1A page marker');
  ok(st.marks === 15, 'new blocks are marked too: ' + st.marks);

  // 7. FDX: revision sets and RevisionID; scene pages are labels
  const fdx = await ev(() => { const d = window.__draft; return d.C.exportFDX(d.S.ep, d.S.project, d.S.st, {}); });
  ok(/<Revisions ActiveSet="1" Location="7.75" RevisionMode="Active"/.test(fdx) && /<Revision Color="#[0-9A-F]{12}" FullRevision="No" ID="1" Mark="\*" Name="Голубая" Style=""\/>/.test(fdx), 'FDX revision set');
  ok((fdx.match(/<Text RevisionID="1">/g) || []).length === 15, 'FDX RevisionID on revised runs');

  // 8. PDF: marks, header on revised pages, title page, page labels; only the changed pages
  await ev(() => { window.__pdfs = []; const orig = URL.createObjectURL; URL.createObjectURL = (bl) => { window.__pdfs.push(bl); return orig(bl); }; });
  const pdf = async (o) => {
    await ev((o) => window.__draft.exportPDF(o), o); await p.waitForTimeout(500);
    const b64 = await ev(async () => { const buf = await window.__pdfs[window.__pdfs.length - 1].arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(b64, 'base64')), useSystemFonts: true }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 });
      const items = (await pg.getTextContent()).items;
      pages.push({ text: items.map((it) => it.str).join(' '), stars: items.filter((it) => it.str === '*').map((it) => it.transform[4] / 72), w: vp.width / 72 });
    }
    return pages;
  };
  const full = await pdf({ to: 'Группа', label: 'Драфт', wm: false });
  ok(/Голубая ревизия — /.test(full[0].text), 'title page shows the revision');
  const revised = full.slice(1).filter((pg) => pg.stars.length);
  ok(revised.length >= 1 && revised.every((pg) => pg.text.includes('Голубая ревизия — ' + today)), 'header with name and date on every revised page: ' + revised.map((pg) => pg.text.slice(0, 60)).join(' | '));
  ok(full.slice(1).filter((pg) => !pg.stars.length).every((pg) => !/ревизия/.test(pg.text)), 'no header on unrevised pages');
  ok(revised.every((pg) => pg.stars.every((x) => Math.abs(x - 7.6) < 0.02)), 'asterisks at 7.6in');
  ok(full.some((pg) => /\b1A\./.test(pg.text)) && full.some((pg) => /(^|\s)2\.(\s|$)/.test(pg.text)), 'PDF prints the 1A and 2 labels');
  const only = await pdf({ to: 'Группа', label: 'Драфт', wm: false, changedOnly: true });
  ok(full.length === 7 && only.length === 1 + revised.length && only.slice(1).every((pg) => pg.stars.length), 'only changed pages (+ title): ' + only.length + ' of ' + full.length);
  ok(/1A\./.test(full[2].text) && !/ревизия/.test(full[2].text), 'pushed-down text on 1A is not marked');
  // A4: the mark stays inside the sheet
  await ev(() => { const d = window.__draft; d.S.project.rules.paper = 'a4ru'; d.applyPaper(); d.recompute(); });
  const a4 = await pdf({ to: 'Группа', label: 'Драфт', wm: false });
  ok(a4.slice(1).filter((pg) => pg.stars.length).every((pg) => pg.stars.every((x) => x < pg.w - 0.2 && x > 7.78)), 'A4 marks inside the sheet');
  await ev(() => { const d = window.__draft; d.S.project.rules.paper = 'letter'; d.applyPaper(); d.recompute(); });
  // the PDF dialog offers the option only while a revision is active
  await menu('#exportMenu [data-exp=pdf]');
  ok(await p.locator('#pdfChanged').count() === 1, 'PDF dialog: «Только изменённые страницы»');
  await p.click('#pdfC');

  // 9. second revision: earlier marks stay with their level
  await menu('#mRevisions'); await p.click('#rvStart'); await p.waitForTimeout(200); await p.click('#rvClose');
  await ev(() => { const d = window.__draft, e = document.querySelector('#editor > .b[data-id="L5"]'); e.textContent += ' Розовая правка.'; d.recompute(); });
  st = await ev(() => { const d = window.__draft; return { lv: d.S.ep.revLevel, pink: d.S.ep.blocks.filter((x) => x.rev === 2).length, blue: d.S.ep.blocks.filter((x) => x.rev === 1).length, info: document.querySelector('#revInfo').textContent }; });
  ok(st.lv === 2 && st.pink === 1 && st.blue === 15 && /Розовая ревизия/.test(st.info), 'pink revision on top of blue: ' + JSON.stringify(st));

  // 10. reader: nothing to start or lock, menu item hidden
  await role('reader', 'Актёр');
  await menu('#mRevisions');
  ok(await p.locator('#rvStart').count() === 0 && await p.locator('#rvUnlock').count() === 0, 'reader: read-only dialog');
  await p.click('#rvClose');
  ok(await ev(() => document.querySelector('#mPageLock').hidden), 'reader: page lock menu item hidden');
  await ev(() => window.__draft.startRevision()); await p.waitForTimeout(100);
  ok(await ev(() => window.__draft.S.ep.revLevel === 2), 'reader cannot start a revision');

  // 11. unlock asks for a reason and is logged; the history keeps a snapshot
  await role('producer', 'Продюсер Петров');
  await menu('#mPageLock'); await p.fill('#upReason', 'новый драфт'); await p.click('#upOk'); await p.waitForTimeout(300);
  st = await ev(async () => { const d = window.__draft, e = d.S.ep; const h = await d.histLoad(e); return { pl: !!e.pageLock, log: e.pageLockLog && e.pageLockLog[0].reason, hist: h.some((x) => /снят лок страниц: новый драфт/.test(x.reason) && x.pageLock), reasons: h.map((x) => x.reason), labels: d.S.st.lay.labels.join(',') }; });
  ok(!st.pl && st.log === 'новый драфт' && st.hist && !/A/.test(st.labels), 'unlock logged with reason: ' + JSON.stringify(st));

  // 12. persisted in the project JSON and back after a reload
  await ev(() => document.dispatchEvent(new Event('visibilitychange'))); await ev(() => window.dispatchEvent(new Event('pagehide'))); await p.waitForTimeout(800);
  await p.reload(); await p.waitForTimeout(800);
  st = await ev(() => { const e = window.__draft.S.ep; return { lv: e.revLevel, n: (e.revisions || []).length, marks: document.querySelectorAll('.revmark').length, log: (e.pageLockLog || []).length }; });
  ok(st.lv === 2 && st.n === 2 && st.marks === 16 && st.log === 1, 'survives a reload: ' + JSON.stringify(st));

  // 13. FDX round trip: Final Draft's revision marks come back as this episode's revisions
  const fdx2 = await ev(() => { const d = window.__draft; return d.C.exportFDX(d.S.ep, d.S.project, d.S.st, {}); });
  const tmp = path.join(require('os').tmpdir(), 'draft-rev-' + Date.now() + '.fdx'); require('fs').writeFileSync(tmp, fdx2);
  await role('editor', 'Редактор Иванова');
  await p.locator('#btnImport').dispatchEvent('click'); await p.waitForTimeout(200);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles(tmp);
  await p.waitForSelector('#impDone', { timeout: 15000 }); await p.click('#impDone'); await p.waitForTimeout(300);
  st = await ev(() => { const e = window.__draft.S.ep; return { lv: e.revLevel, n: (e.revisions || []).length, pink: e.blocks.filter((x) => x.rev === 2).length, blue: e.blocks.filter((x) => x.rev === 1).length, marks: document.querySelectorAll('.revmark').length }; });
  ok(st.lv === 2 && st.n === 2 && st.pink === 1 && st.blue === 15 && st.marks === 16, 'FDX import restores revisions: ' + JSON.stringify(st));
  require('fs').unlinkSync(tmp);

  ok(!errs.length, 'no page errors: ' + errs.join('; '));
  console.log(fails ? fails + ' of ' + n + ' revision UI checks FAILED' : 'all ' + n + ' revision UI checks passed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });
