// Review fixes, UI: a tab that adopts another tab's data does not write over its snapshots; «Заменить все» keeps other
// users' suggestions; a restore keeps (writer) or logs (producer) the numbering lock; the safety copy of replaced text is
// never only a private draft; «перед …» snapshots of other episodes are kept; a character rename reaches scene cards
// (extras) and relationships
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-review-'));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const fresh = async () => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); localStorage.setItem('draft.team', 'true'); } catch (e) {} });
    await ctx.route('**/*', (r) => { const u = r.request().url();
      if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
      if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
      if (u.includes('pdf.min.js') || u.includes('pdf.worker')) return r.abort();
      return u.startsWith('file:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(900);
    return { ctx, p };
  };
  const role = (p, r, name) => p.evaluate(([r, name]) => { const d = window.__draft; d.S.me = { name, role: r }; d.applyRole(); d.recompute(); d.renderEpisodes(); }, [r, name]);

  // 1. two tabs: A cached its history, adopts B's data, then snapshots again: B's snapshot stays
  {
    const { ctx, p: A } = await fresh();
    await A.evaluate(async () => { const d = window.__draft; await d.histAdd(d.S.ep, 'A-first', true); });
    await A.waitForTimeout(300);
    const B = await ctx.newPage(); B.on('pageerror', (e) => errs.push(e.message)); await B.goto(URL); await B.waitForTimeout(1200);
    await B.evaluate(async () => { const d = window.__draft; d.S.ep.blocks.push({ id: 'bb1', t: 'action', x: 'ТЕКСТ_ВКЛАДКИ_Б' }); d.renderEditor(); d.recompute(); await d.histAdd(d.S.ep, 'B-snap', true); });
    await B.waitForTimeout(1500);
    ok(await A.evaluate(() => document.getElementById('editor').innerText.includes('ТЕКСТ_ВКЛАДКИ_Б')), 'tab A adopted tab B\'s text');
    await B.close();
    await A.evaluate(async () => { const d = window.__draft; d.S.ep.blocks.push({ id: 'aa1', t: 'action', x: 'ТЕКСТ_А' }); d.renderEditor(); d.recompute(); await d.histAdd(d.S.ep, 'A-second', true); });
    await A.waitForTimeout(500);
    const hist = await A.evaluate(async () => { const id = window.__draft.S.ep.id; return await new Promise((res) => { const r = indexedDB.open('draft-app'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('hist:' + id); q.onsuccess = () => res((q.result || []).map((h) => h.reason)); }; }); });
    ok(['A-first', 'B-snap', 'A-second'].every((x) => hist.includes(x)) && hist.indexOf('B-snap') < hist.indexOf('A-second'), 'the other tab\'s keep snapshot survives the adopting tab\'s next snapshot', hist);
    await ctx.close();
  }

  // 2. «Заменить все» and «Заменить» in the open episode keep another user's pending suggestion
  {
    const { ctx, p } = await fresh();
    await role(p, 'editor', 'Редактор');
    const info = await p.evaluate(() => { const d = window.__draft; const b = d.S.ep.blocks.find((x) => x.t === 'action' && x.x.length > 20);
      const w = b.x.split(/\s+/).find((t) => /^[А-Яа-яЁё]{4,}$/.test(t));
      d.S.ep.sugs = [{ id: 'sgX', k: 'ins', bid: b.id, off: b.x.length, x: ' ПРЕДЛОЖЕНИЕ_ВАСИ', ctx: b.x.slice(-12), by: 'Вася', at: Date.now() }];
      d.renderEditor(); d.recompute(); return { bid: b.id, w }; });
    await p.keyboard.press('Control+f'); await p.waitForTimeout(150);
    await p.evaluate((w) => { const s = (q, v) => { const el = document.querySelector(q); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
      document.getElementById('findBox').hidden = false; s('#fbScope', 'ep'); s('#fbType', ''); s('#fbFind', w); s('#fbRepl', w + 'Ъ'); }, info.w);
    await p.locator('#fbAll').dispatchEvent('click'); await p.waitForTimeout(300);
    const r = await p.evaluate(([bid, w]) => { const d = window.__draft, status = document.getElementById('fbStatus').textContent; d.recompute(); const b = d.S.ep.blocks.find((x) => x.id === bid); return { status, sugs: (d.S.ep.sugs || []).map((s) => s.id), gone: d.S.ep.sugGone || [], text: b.x.includes(w + 'Ъ'), screen: document.querySelector('#editor [data-id="' + bid + '"]').textContent }; }, [info.bid, info.w]);
    ok(/Заменено: 1/.test(r.status) && r.text, '«Заменить все» replaced the accepted text', r);
    ok(r.sugs.includes('sgX') && !r.gone.includes('sgX') && /ПРЕДЛОЖЕНИЕ_ВАСИ/.test(r.screen), 'the suggestion survives «Заменить все» and stays on screen', r);
    // single «Заменить» on the same element
    await p.evaluate((w) => { const s = (q, v) => { const el = document.querySelector(q); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; s('#fbFind', w + 'Ъ'); s('#fbRepl', w + 'Ё'); }, info.w);
    await p.locator('#fbNext').dispatchEvent('click'); await p.waitForTimeout(150);
    await p.locator('#fbRep').dispatchEvent('click'); await p.waitForTimeout(300);
    const r2 = await p.evaluate(([bid, w]) => { const d = window.__draft; d.recompute(); const b = d.S.ep.blocks.find((x) => x.id === bid); return { sugs: (d.S.ep.sugs || []).map((s) => s.id), text: b.x.includes(w + 'Ё'), screen: document.querySelector('#editor [data-id="' + bid + '"]').textContent }; }, [info.bid, info.w]);
    ok(r2.text && r2.sugs.includes('sgX') && /ПРЕДЛОЖЕНИЕ_ВАСИ/.test(r2.screen), 'the suggestion survives a single «Заменить»', r2);
    await p.evaluate(() => window.__draft.undo()); await p.waitForTimeout(200);
    ok(await p.evaluate((w) => window.__draft.readBlocks().some((x) => x.x.includes(w + 'Ъ')), info.w), 'Ctrl+Z undoes the replace');
    await ctx.close();
  }

  // 3. restoring a draft or a snapshot from before the numbering lock
  for (const r of ['producer', 'writer']) {
    const { ctx, p } = await fresh();
    await role(p, 'producer', 'Продюсер');
    await p.evaluate(() => document.getElementById('btnDraft').click()); await p.waitForTimeout(150);
    await p.evaluate(() => { document.getElementById('drName').value = 'ДО_ЛОКА'; document.getElementById('drOk').click(); });
    const hid = await p.evaluate(async () => (await window.__draft.histAdd(window.__draft.S.ep, 'до лока', true)).id);
    await p.evaluate(() => window.__draft.lockNumbers()); await p.waitForTimeout(300);
    // a new scene at the top gets a letter number under the lock
    const nums0 = await p.evaluate(() => { const d = window.__draft; d.S.ep.sceneMeta[d.S.st.scenes[1].id].num = '2Б'; d.recompute(); return d.S.st.scenes.map((s) => s.num); });
    await role(p, r, r === 'writer' ? 'Сценарист' : 'Продюсер');
    await p.evaluate(() => window.__draft.showDrafts()); await p.waitForTimeout(200);
    await p.evaluate(() => { const d = window.__draft.S.ep.drafts.find((x) => x.name === 'ДО_ЛОКА'); document.querySelector('[data-rest="' + d.id + '"]').click(); });
    await p.waitForTimeout(400);
    const st = await p.evaluate(() => { const d = window.__draft; d.recompute(); return { lock: !!d.S.ep.lock, log: (d.S.ep.lockLog || []).length, audit: (d.S.project.auditLog || []).map((x) => x.type + ':' + x.text), nums: d.S.st.scenes.map((s) => s.num), toast: document.getElementById('toast').textContent }; });
    if (r === 'producer') ok(!st.lock && st.log === 1 && st.audit.some((x) => /^lockdrop:Лок номеров снят восстановлением/.test(x)), 'producer: the restore drops the numbering lock and logs it (lockLog + audit)', st);
    else ok(st.lock && st.log === 0 && JSON.stringify(st.nums) === JSON.stringify(nums0) && /остались прежними/.test(st.toast) && !st.audit.some((x) => /^lockdrop/.test(x)), 'writer: the numbering lock and its frozen numbers stay, the toast says so', { st, nums0 });
    if (r === 'writer') {
      // the history path («Вернуть всю серию») does the same
      await p.evaluate((id) => window.__draft.showHistory(id), hid); await p.waitForTimeout(400);
      await p.locator('#hsAll').dispatchEvent('click'); await p.waitForTimeout(400);
      const s2 = await p.evaluate(() => { const d = window.__draft; d.recompute(); return { lock: !!d.S.ep.lock, nums: d.S.st.scenes.map((s) => s.num) }; });
      ok(s2.lock && JSON.stringify(s2.nums) === JSON.stringify(nums0), 'writer: «Вернуть всю серию» keeps the numbering lock too', { s2, nums0 });
    } else {
      await p.evaluate(() => window.__draft.lockNumbers()); await p.waitForTimeout(200);
      await p.evaluate((id) => window.__draft.showHistory(id), hid); await p.waitForTimeout(400);
      await p.locator('#hsAll').dispatchEvent('click'); await p.waitForTimeout(400);
      const s2 = await p.evaluate(() => ({ lock: !!window.__draft.S.ep.lock, log: (window.__draft.S.ep.lockLog || []).length }));
      ok(!s2.lock && s2.log === 2, 'producer: «Вернуть всю серию» before the lock logs the dropped lock', s2);
    }
    await ctx.close();
  }

  // 4. the safety copy of text replaced by a newer project file is a draft everyone sees, even when a private draft
  //    of someone else holds the same text
  {
    const { ctx, p } = await fresh();
    const F = path.join(tmp, 'newer.json');
    await p.evaluate(() => window.__draft.recompute());
    fs.writeFileSync(F, await p.evaluate(() => { const d = window.__draft; const pr = JSON.parse(JSON.stringify(d.S.project, (k, v) => (k === '_st' ? undefined : v))); const e = pr.episodes.find((x) => x.id === d.S.ep.id); e.blocks = e.blocks.concat([{ id: 'zz9', t: 'action', x: 'ТЕКСТ_ИЗ_ФАЙЛА' }]); e.textAt = Date.now() + 60000; e.drafts = []; return JSON.stringify({ app: 'draft', version: 1, project: pr }); }));
    await role(p, 'writer', 'Аня');
    await p.evaluate(() => document.getElementById('btnDraft').click()); await p.waitForTimeout(150);
    await p.evaluate(() => { document.getElementById('drPrivate').checked = true; document.getElementById('drOk').click(); });
    await role(p, 'writer', 'Боря');
    await p.evaluate(() => document.getElementById('btnDraft').click()); await p.waitForTimeout(150);
    ok(/версия 1$/.test(await p.inputValue('#drName')), 'version numbering counts only drafts this user sees', await p.inputValue('#drName'));
    await p.evaluate(() => window.__draft.S && document.getElementById('drC').click());
    await p.evaluate(() => { document.getElementById('fileInput').dataset.mode = 'project'; });
    await p.setInputFiles('#fileInput', F); await p.waitForTimeout(1000);
    const r = await p.evaluate(() => { const d = window.__draft; return { vis: d.S.ep.drafts.filter((x) => !x.private || x.author === 'Боря').map((x) => x.name), file: d.projectFileData(d.S.project).episodes.find((e) => e.id === d.S.ep.id).drafts.map((x) => x.name), text: d.S.ep.blocks.some((x) => x.x === 'ТЕКСТ_ИЗ_ФАЙЛА') }; });
    ok(r.text && r.vis.some((x) => /^Авто: перед открытием файла проекта/.test(x)) && r.file.some((x) => /^Авто: перед открытием файла проекта/.test(x)), 'the replaced text is kept as a draft Боря sees and the file carries', r);
    await ctx.close();
  }

  // 5. a character rename across the project: «перед переименованием» snapshots of other episodes are keep (and survive
  //    thinning), the scene cards' silent cast and the relationships follow the new name
  {
    const { ctx, p } = await fresh();
    await role(p, 'writer', 'Автор');
    const setup = await p.evaluate(() => { const d = window.__draft, P = d.S.project;
      const name = d.C.charName(d.S.ep.blocks.find((x) => x.t === 'character').x);
      const other = P.episodes.find((e) => e !== d.S.ep), sc = other.blocks.find((x) => x.t === 'scene');
      other.sceneMeta = other.sceneMeta || {}; other.sceneMeta[sc.id] = Object.assign(other.sceneMeta[sc.id] || {}, { extras: [name, 'СОСЕД'] });
      const cur = d.S.st.scenes[0]; d.S.ep.sceneMeta[cur.id] = Object.assign(d.S.ep.sceneMeta[cur.id] || {}, { extras: ['ГРИША НОВЫЙ', name] });
      const partner = Object.keys(P.chars).find((x) => x !== name && !P.relations.some((r) => (r.a === name && r.b === x) || (r.b === name && r.a === x)));
      P.relations.push({ a: name, b: partner, label: 'брат' }, { a: 'ГРИША НОВЫЙ', b: partner, label: 'друг' });
      return { name, other: other.id, sc: sc.id, cur: cur.id, partner }; });
    await p.keyboard.press('Control+h'); await p.waitForTimeout(150);
    await p.evaluate((name) => { document.getElementById('findBox').hidden = false; const s = (q, v) => { const el = document.querySelector(q); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
      s('#fbScope', 'project'); s('#fbType', 'character'); s('#fbFind', name); s('#fbRepl', 'ГРИША НОВЫЙ'); }, setup.name);
    ok(/переименует/.test(await p.textContent('#fbNote')), 'the panel offers a rename');
    await p.locator('#fbAll').dispatchEvent('click'); await p.waitForTimeout(600);
    const r = await p.evaluate(async (s) => { const d = window.__draft, P = d.S.project, other = P.episodes.find((e) => e.id === s.other);
      const list = await d.histLoad(other), last = list[list.length - 1];
      const thin = d.C.thinHistory(list.concat([]).map((h) => h), 1, Date.now() + 400 * 86400e3);
      return { extras: other.sceneMeta[s.sc].extras, curExtras: d.S.ep.sceneMeta[s.cur].extras, cast: d.C.analyzeEpisode(other, P).scenes[0].cast,
        rel: P.relations.filter((x) => x.a === s.name || x.b === s.name).length, merged: P.relations.filter((x) => (x.a === 'ГРИША НОВЫЙ' && x.b === s.partner) || (x.b === 'ГРИША НОВЫЙ' && x.a === s.partner)).map((x) => x.label),
        last: last && { reason: last.reason, keep: last.keep }, survives: thin.some((h) => h.id === last.id && /перед переименованием/.test(h.reason)) }; }, setup);
    ok(r.last && /перед переименованием/.test(r.last.reason) && r.last.keep === true, 'the other episode\'s «перед переименованием» snapshot is a keep one', r.last);
    ok(r.survives, 'it survives thinning on a tiny budget');
    ok(JSON.stringify(r.extras) === JSON.stringify(['ГРИША НОВЫЙ', 'СОСЕД']) && !r.cast.includes(setup.name), 'the scene card\'s silent cast is renamed, the old name is not back in the cast', r);
    ok(JSON.stringify(r.curExtras) === JSON.stringify(['ГРИША НОВЫЙ']), 'the open episode\'s card is renamed without a duplicate', r.curExtras);
    ok(r.rel === 0 && r.merged.length === 1 && /брат/.test(r.merged[0]) && /друг/.test(r.merged[0]), 'relationships follow the rename, a duplicate pair is merged', r);
    // the open episode: one Ctrl+Z step brings the card back
    await p.evaluate(() => window.__draft.undo()); await p.waitForTimeout(200);
    ok(await p.evaluate((s) => window.__draft.S.ep.sceneMeta[s.cur].extras.includes(s.name), setup), 'Ctrl+Z brings the open episode\'s card back');
    await ctx.close();
  }

  // 6. «перед заменой» snapshots of other episodes are keep too
  {
    const { ctx, p } = await fresh();
    await role(p, 'writer', 'Автор');
    const w = await p.evaluate(() => { const d = window.__draft, other = d.S.project.episodes.find((e) => e !== d.S.ep); const b = other.blocks.find((x) => x.t === 'action' && /[А-Яа-я]{5,}/.test(x.x)); return { id: other.id, w: b.x.match(/[А-Яа-яЁё]{5,}/)[0] }; });
    await p.keyboard.press('Control+h'); await p.waitForTimeout(150);
    await p.evaluate((w) => { document.getElementById('findBox').hidden = false; const s = (q, v) => { const el = document.querySelector(q); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
      s('#fbScope', 'project'); s('#fbType', ''); s('#fbFind', w); s('#fbRepl', w + 'Ъ'); }, w.w);
    await p.locator('#fbAll').dispatchEvent('click'); await p.waitForTimeout(600);
    const last = await p.evaluate(async (id) => { const d = window.__draft, ep = d.S.project.episodes.find((e) => e.id === id), l = await d.histLoad(ep); const h = l[l.length - 1]; return h && { reason: h.reason, keep: h.keep }; }, w.id);
    ok(last && /перед заменой/.test(last.reason) && last.keep === true, '«перед заменой» snapshot of another episode is a keep one', last);
    await ctx.close();
  }

  ok(errs.length === 0, 'no page errors', errs);
  await b.close();
  console.log(fails ? fails + ' FAILED of ' + n : 'all ' + n + ' review checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
