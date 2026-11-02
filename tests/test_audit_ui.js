// Safety, UI: every history version kept (deltas, budget warning, old snapshots), one page back from history,
// the project audit log («Журнал действий»)
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-audit-'));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800);
  const ev = (f, a) => p.evaluate(f, a);
  const role = (r, name) => ev(([r, name]) => { const d = window.__draft; d.S.me = { name, role: r }; d.applyRole(); d.recompute(); d.renderEpisodes(); }, [r, name]);
  const menu = async (id) => { await p.locator(id).dispatchEvent('click'); await p.waitForTimeout(250); };
  const typeEnd = async (id, s) => {
    await ev((id) => { const el = document.querySelector('#editor .b[data-id="' + id + '"]'); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); document.getElementById('editor').focus(); }, id);
    await p.keyboard.type(s); await p.waitForTimeout(400); await ev(() => window.__draft.recompute());
  };
  const blockBy = (id) => ev((id) => { const b = window.__draft.S.ep.blocks.find((x) => x.id === id); return b ? { x: b.x } : null; }, id);

  // enough text for several pages
  await ev(() => {
    const d = window.__draft, bl = d.readBlocks();
    for (let j = 0; j < 90; j++) bl.push({ id: 'L' + j, t: 'action', x: 'Строка для объёма номер ' + j + '.' });
    d.S.ep.blocks = bl; document.querySelector('#editor').innerHTML = bl.map((x) => '<div class="b t-' + x.t + '" data-t="' + x.t + '" data-id="' + x.id + '"></div>').join('');
    [...document.querySelectorAll('#editor > .b')].forEach((e, i) => { e.textContent = bl[i].x; });
    d.recompute();
  });
  const firstAct = await ev(() => window.__draft.S.ep.blocks.find((x) => x.t === 'action').id);

  // 1. edits by two users, with a snapshot in between (the text typed here is looked for later)
  await role('writer', 'Анна');
  await typeEnd(firstAct, ' ПРАВКА_АННЫ');
  ok((await blockBy(firstAct)).x.endsWith('ПРАВКА_АННЫ'), 'typing at the end of an element lands in the model', await blockBy(firstAct));
  await ev(() => window.__draft.histAdd(window.__draft.S.ep, 'снимок Анны'));
  await role('writer', 'Борис');
  await typeEnd('L2', ' ПРАВКА_БОРИСА');
  await ev(() => window.__draft.undo()); await p.waitForTimeout(150);
  ok(!(await blockBy('L2')).x.includes('БОРИСА'), 'Ctrl+Z takes the typed text back');
  await ev(() => window.__draft.redo()); await p.waitForTimeout(150);
  ok((await blockBy('L2')).x.includes('БОРИСА'), 'Ctrl+Y gives it again');

  // 2. history: every snapshot kept as a delta, the newest whole; one page goes back
  await ev(() => window.__draft.histAdd(window.__draft.S.ep, 'база', true));
  const orig = await ev(() => ({ l5: window.__draft.S.ep.blocks.find((x) => x.id === 'L5').x, l80: window.__draft.S.ep.blocks.find((x) => x.id === 'L80').x }));
  await ev(() => { for (const id of ['L5', 'L80']) document.querySelector('#editor .b[data-id="' + id + '"]').textContent += ' ИЗМЕНЕНО'; window.__draft.recompute(); });
  await ev(() => window.__draft.histAdd(window.__draft.S.ep, 'после правок'));
  const st = await ev(async () => { const d = window.__draft, l = await d.histLoad(d.S.ep); return { n: l.length, prevDelta: d.C.histIsDelta(l[l.length - 2]), lastWhole: !d.C.histIsDelta(l[l.length - 1]) && !!l[l.length - 1].blocks, sigShort: l.every((h) => !h.sig || h.sig.length < 64) }; });
  ok(st.prevDelta && st.lastWhole, 'older snapshots are stored as deltas, the newest whole', st);
  ok(st.sigShort, 'snapshots keep a short fingerprint, not a second copy of the text');
  await ev(() => window.__draft.showHistory()); await p.waitForTimeout(300);
  ok(/Хранятся все снимки/.test(await p.textContent('#modal .note')), 'History says every snapshot is kept');
  await p.locator('.hist-row', { hasText: 'база' }).first().click(); await p.waitForTimeout(200);
  const pages = await ev(() => [...document.querySelectorAll('#hsPage option')].map((o) => o.textContent));
  ok(pages.length >= 3 && /^стр\. 1 — /.test(pages[0]), 'a page list from the snapshot layout', pages.slice(0, 3));
  const pgIdx = await ev(() => { const d = window.__draft, C = d.C; const sel = document.querySelector('#hsPage'); const opts = [...sel.options];
    // the page of the snapshot that holds L80 (snapshot = the current text with L80 as it was)
    const paper = C.paperOf(d.S.project.rules), bl = d.S.ep.blocks.map((b) => b); const lay = C.paginate(bl, { lines: paper.lines, fmt: paper.fmt }); const pr = C.pageRanges(lay); const i = bl.findIndex((b) => b.id === 'L80');
    return pr.findIndex((r) => r.from <= i && i <= r.to) < opts.length ? pr.findIndex((r) => r.from <= i && i <= r.to) : -1; });
  ok(pgIdx > 0, 'L80 is on a later page', pgIdx);
  await p.selectOption('#hsPage', String(pgIdx)); await p.click('#hsPg'); await p.waitForTimeout(500);
  const after = await ev(() => ({ l5: window.__draft.S.ep.blocks.find((x) => x.id === 'L5').x, l80: window.__draft.S.ep.blocks.find((x) => x.id === 'L80').x, modal: !document.getElementById('modalBack').hidden }));
  ok(after.l80 === orig.l80 && after.l5 === orig.l5 + ' ИЗМЕНЕНО' && !after.modal, 'only that page went back: L80 restored, L5 on another page keeps the edit', after);
  ok(/Страница .* заменена версией/.test(await p.textContent('#toast')), 'toast names the page');
  ok(await ev(async () => { const d = window.__draft, l = await d.histLoad(d.S.ep); return /перед откатом страницы/.test(l[l.length - 1].reason) && l[l.length - 1].keep; }), 'the text before the page rollback is kept in History');
  ok(await ev(() => (window.__draft.S.project.auditLog || []).some((x) => x.type === 'rollback' && /Страница/.test(x.text))), 'the page rollback is in the audit log');
  await ev(() => window.__draft.undo()); await p.waitForTimeout(150);
  ok(await ev(() => window.__draft.S.ep.blocks.find((x) => x.id === 'L80').x.endsWith('ИЗМЕНЕНО')), 'Ctrl+Z undoes the page rollback');

  // 3. an old snapshot written whole (long sig, no tags/titlePage keys) still restores
  await ev(async () => {
    const d = window.__draft, l = await d.histLoad(d.S.ep);
    const blocks = [{ id: 'old1', t: 'scene', x: 'ИНТ. СТАРЫЙ СНИМОК - ДЕНЬ' }, { id: 'old2', t: 'action', x: 'Старый текст.' }];
    l.unshift({ id: 'oldh', date: l[0].date - 3600e3, author: 'Прежний', reason: 'старый формат', keep: false, pages: 0.1, scenes: 1, sig: JSON.stringify({ blocks, sceneMeta: {} }), blocks, sceneMeta: {}, lock: null });
  });
  await ev(() => window.__draft.showHistory()); await p.waitForTimeout(300);
  await p.locator('.hist-row', { hasText: 'старый формат' }).first().click(); await p.waitForTimeout(200);
  await p.click('#hsAll'); await p.waitForTimeout(500);
  ok(await ev(() => document.getElementById('editor').innerText.includes('Старый текст.')), 'an old-format snapshot restores the whole episode');
  await ev(() => window.__draft.undo()); await p.waitForTimeout(150);
  ok(await ev(() => !document.getElementById('editor').innerText.includes('Старый текст.') && document.getElementById('editor').innerText.includes('ПРАВКА_АННЫ')), 'and Ctrl+Z takes it back');

  // 4. over the budget: old automatic snapshots go, keep ones stay, and the user is told
  const thin = await ev(async () => {
    const d = window.__draft, ep = d.S.ep, l0 = await d.histLoad(ep), keeps = l0.filter((h) => h.keep).length;
    d.S.histBudget = d.C.histSize(l0) + 4000;
    for (let i = 0; i < 25; i++) { const el = document.querySelector('#editor .b[data-id="L3"]'); el.textContent = 'Автоснимок номер ' + i + '.'; d.recompute(); await d.histAdd(ep, 'автоснимок'); }
    const l = await d.histLoad(ep); d.S.histBudget = null;
    return { thinned: ep.histThinned, keeps, keepsAfter: l.filter((h) => h.keep).length, size: d.C.histSize(l), n: l.length };
  });
  ok(thin.thinned && thin.thinned.n > 0, 'over the budget old automatic snapshots are dropped', thin);
  ok(thin.keepsAfter === thin.keeps, 'snapshots «перед …» are never dropped', thin);
  ok(/не хватает места/.test(await p.textContent('#toast')), 'a toast says so');
  await ev(() => window.__draft.showHistory()); await p.waitForTimeout(300);
  ok(await p.locator('#hsThin').isVisible() && /удалено старых автоснимков/.test(await p.textContent('#hsThin')), 'History shows the warning');
  await p.click('#hsClose');

  // 5. audit log: unlock needs a reason; locks, drafts, deletions, restores and sides are written; producer and editor see it
  await role('producer', 'Продюсер Петров');
  await ev(() => window.__draft.lockNumbers()); await p.waitForTimeout(200);
  await ev(() => window.__draft.unlockNumbers()); await p.waitForTimeout(200);
  await p.click('#ulOk'); await p.waitForTimeout(150);
  ok(await p.locator('#ulErr').isVisible() && await ev(() => !!window.__draft.S.ep.lock), 'unlocking without a reason is refused');
  await p.fill('#ulReason', 'новый график'); await p.click('#ulOk'); await p.waitForTimeout(250);
  ok(await ev(() => !window.__draft.S.ep.lock && window.__draft.S.project.auditLog.some((x) => x.type === 'unlock' && x.reason === 'новый график' && x.by === 'Продюсер Петров')), 'the unlock is logged with its reason');
  await ev(() => window.__draft.startRevision()); await p.waitForTimeout(200);
  await ev(() => window.__draft.lockPages()); await p.waitForTimeout(200);
  await ev(() => window.__draft.unlockPages()); await p.waitForTimeout(200);
  await p.click('#upOk'); await p.waitForTimeout(150);
  ok(await p.locator('#upErr').isVisible() && await ev(() => !!window.__draft.S.ep.pageLock), 'unlocking pages without a reason is refused');
  await p.fill('#upReason', 'полная перепечатка'); await p.click('#upOk'); await p.waitForTimeout(250);
  const today = await ev(() => window.__draft.C.isoDay(Date.now()));
  ok(await ev((t) => window.__draft.issueSides({ ids: [window.__draft.S.st.scenes[0].id], to: ['Актёр Иванов'], expires: t }), today), 'sides issued');
  await p.waitForTimeout(300);
  // the second episode: deleted and brought back
  const ep2 = await ev(() => window.__draft.S.project.episodes[1].id);
  await ev((id) => { window.__draft.recompute(); window.__draft.openEpisode(id); }, ep2); await p.waitForTimeout(300);
  await p.locator('#renEp').dispatchEvent('click'); await p.locator('#reDel').dispatchEvent('click'); await p.locator('#deOk').dispatchEvent('click'); await p.waitForTimeout(700);
  await ev(() => window.__draft.showTrash()); await p.waitForTimeout(300);
  await p.locator('[data-restore]').first().dispatchEvent('click'); await p.waitForTimeout(700);
  // an unlock recorded only in an episode (from before the project log)
  await ev(() => { const e = window.__draft.S.project.episodes[1]; e.lockLog = (e.lockLog || []).concat([{ at: 1700000000000, by: 'Редактор Старый', role: 'editor', reason: 'старая причина' }]); });
  const types = await ev(() => window.__draft.S.project.auditLog.map((x) => x.type));
  ok(['unlock', 'draft', 'pageunlock', 'sides', 'delete', 'restore', 'rollback'].every((t) => types.includes(t)), 'every kind of action is in P().auditLog', types);
  await menu('#mAudit');
  ok(/Журнал действий/.test(await p.textContent('#modal h2')), 'Производство → «Журнал действий» opens the log');
  const all = await ev(() => [...document.querySelectorAll('.au-row')].map((r) => r.textContent));
  ok(all.some((r) => /новый график/.test(r)) && all.some((r) => /полная перепечатка/.test(r)) && all.some((r) => /старая причина/.test(r)) && all.some((r) => /Актёр Иванов/.test(r)) && all.some((r) => /возвращена из корзины/.test(r)), 'the log lists reasons, sides, the trash and old episode unlock records', all.length);
  await p.selectOption('#auType', 'unlock'); await p.waitForTimeout(100);
  const un = await ev(() => [...document.querySelectorAll('.au-row')].map((r) => r.dataset.type));
  ok(un.length === 2 && un.every((t) => t === 'unlock'), 'filter by type', un);
  await p.selectOption('#auType', ''); await p.selectOption('#auEp', ep2); await p.waitForTimeout(100);
  const e2 = await ev(() => [...document.querySelectorAll('.au-row')].map((r) => r.textContent));
  ok(e2.length >= 3 && e2.every((r) => !/новый график/.test(r)), 'filter by episode', e2.length);
  await p.click('#auClose');
  await role('writer', 'Анна');
  ok(await ev(() => document.getElementById('mAudit').hidden), 'a writer has no «Журнал действий» in the menu');
  await ev(() => window.__draft.showAudit()); await p.waitForTimeout(150);
  ok(/Нужна роль продюсера/.test(await p.textContent('#modal h2')), 'and cannot open it');
  await ev(() => document.getElementById('npC').click());
  await role('editor', 'Редактор Р');
  ok(await ev(() => !document.getElementById('mAudit').hidden), 'an editor sees it');

  // 6. the log merges on opening a project file: entries from both copies, each once
  const fileP = path.join(tmp, 'p.json');
  const local = await ev(() => window.__draft.S.project.auditLog.length);
  await ev(() => JSON.stringify({ app: 'draft', version: 1, project: window.__draft.projectFileData(window.__draft.S.project) })).then((j) => {
    const d = JSON.parse(j); d.project.auditLog = d.project.auditLog.slice(0, 2).concat([{ id: 'ext1', at: Date.now(), by: 'Другая машина', role: 'producer', type: 'sides', text: 'ИЗ ФАЙЛА' }]); fs.writeFileSync(fileP, JSON.stringify(d)); });
  await ev(() => { document.getElementById('fileInput').dataset.mode = 'project'; });
  await p.setInputFiles('#fileInput', fileP); await p.waitForTimeout(800);
  const merged = await ev(() => window.__draft.S.project.auditLog);
  ok(merged.length === local + 1 && merged.some((x) => x.id === 'ext1') && new Set(merged.map((x) => x.id)).size === merged.length, 'audit logs merge on file open', [merged.length, local]);

  // 7. reload: everything persists (history deltas restore after a reload)
  await p.waitForTimeout(1200); await p.reload(); await p.waitForTimeout(1500);
  ok(await ev(async () => { const d = window.__draft, ep = d.S.project.episodes[0], l = await d.histLoad(ep); return l.length > 5 && d.C.histStates(l).every((s) => s && Array.isArray(s.blocks)); }), 'after a reload every stored snapshot still resolves');
  ok(await ev(() => (window.__draft.S.project.auditLog || []).some((x) => x.id === 'ext1')), 'the audit log persists');
  ok(errs.length === 0, 'no page errors', errs);
  await b.close();
  console.log(fails ? fails + ' FAILED of ' + n : 'all ' + n + ' audit checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
