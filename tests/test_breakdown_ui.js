// Script breakdown, UI: tagging from the menu, Ctrl+Alt+T and the toolbar, colour marks, removal, undo/drafts, roles,
// scene inspector, the «Разбивка» tab, studio rules and the .xlsx export
const { chromium } = require('playwright');
const path = require('path');
const JSZip = require('jszip');
let fails = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
  const menu = async (id) => { await p.locator(id).dispatchEvent('click'); await p.waitForTimeout(200); };
  // select a word inside the element that holds it (the first match in the text)
  const select = (word) => ev((word) => {
    const ed = document.querySelector('#editor'), el = [...ed.children].find((x) => x.textContent.includes(word));
    const tn = el.firstChild, i = tn.textContent.indexOf(word);
    ed.focus(); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + word.length);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    return el.dataset.id;
  }, word);
  const tags = () => ev(() => (window.__draft.S.ep.tags || []).map((t) => ({ id: t.id, q: t.quote, cat: t.cat, note: t.note, blockId: t.blockId, lost: !!t.lost })));
  const hl = (cat) => ev((cat) => { const h = CSS.highlights.get('bd-' + cat); return h ? h.size : 0; }, cat);
  ok(await ev(() => !(window.__draft.S.ep.tags || []).length), 'demo episode starts without tags');
  ok(await ev(() => localStorage.getItem('draft.bdMarks') == null) && !(await p.locator('#mBdMarks').evaluate((x) => x.classList.contains('on'))), 'marks are off by default');

  // 1. Production → «Пометить для разбивки…»: popup, key 1 = Реквизит
  const sk = await select('сковородка');
  await menu('#mTag');
  ok(await p.locator('#bdPop').isVisible(), 'category popup opens');
  ok((await p.locator('#bdPop [data-bdcat]').count()) === 12 && /Реквизит/.test(await p.locator('#bdPop').innerText()), 'twelve categories listed');
  await p.keyboard.press('1'); await p.waitForTimeout(150);
  let t = await tags();
  ok(t.length === 1 && t[0].q === 'сковородка' && t[0].cat === 'props' && t[0].blockId === sk, 'key 1 tags as Реквизит: ' + JSON.stringify(t));
  ok(await p.locator('#bdPop').isHidden(), 'popup closes');
  ok(await hl('props') === 1, 'tag is highlighted in the category colour');
  ok(await p.locator('#mBdMarks').evaluate((x) => x.classList.contains('on')), 'view switched on with the first tag');

  // 2. Ctrl+Alt+T and key 6 = Трюки: the scene becomes special for the studio rules
  await select('телефоном у уха');
  await p.keyboard.press('Control+Alt+t'); await p.waitForTimeout(150);
  ok(await p.locator('#bdPop').isVisible(), 'Ctrl+Alt+T opens the popup');
  await p.keyboard.press('6'); await p.waitForTimeout(150);
  t = await tags();
  ok(t.length === 2 && t[1].cat === 'stunts', 'key 6 tags as Трюки');
  let sc = await ev(() => { const s = window.__draft.S.st.scenes[0]; return { special: s.special, bdTags: s.bdTags, tags: s.tags }; });
  ok(sc.special && sc.bdTags.join() === 'stunts', 'scene 1 special by the breakdown: ' + JSON.stringify(sc));
  await menu('#mRules');
  ok(/Трюки \(по разбивке\)/.test(await p.locator('#pane-rules').innerText()), 'studio rule names the breakdown');
  // the same scene tagged «Трюки» by hand counts once
  const sh1 = await ev(() => window.__draft.S.st.specialMin);
  await ev(() => { const d = window.__draft, s = d.S.st.scenes[0]; (d.S.ep.sceneMeta[s.id] = d.S.ep.sceneMeta[s.id] || {}).tags = ['stunts']; d.recompute(); });
  sc = await ev(() => { const d = window.__draft, s = d.S.st.scenes[0]; return { bdTags: s.bdTags, sp: d.S.st.specialMin }; });
  ok(sc.bdTags.length === 0 && Math.abs(sc.sp - sh1) < 1e-9, 'no double count with the scene tag: ' + JSON.stringify(sc));
  await ev(() => { const d = window.__draft, s = d.S.st.scenes[0]; d.S.ep.sceneMeta[s.id].tags = []; d.recompute(); });

  // 3. toolbar button, note, category by click
  await select('сырники');
  await p.locator('#tbTag').dispatchEvent('click'); await p.waitForTimeout(150);
  await p.fill('#bdNote', 'на 3 дубля');
  await p.click('#bdPop [data-bdcat=props]'); await p.waitForTimeout(150);
  t = await tags();
  ok(t.length === 3 && t[2].note === 'на 3 дубля', 'toolbar button + note');
  // Escape cancels
  await select('Борис Петрович');
  await menu('#mTag'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok((await tags()).length === 3 && await p.locator('#bdPop').isHidden(), 'Esc cancels without a tag');

  // 4. undo / redo
  await menu('#mUndo');
  ok((await tags()).length === 2, 'Ctrl+Z removes the last tag');
  await menu('#mRedo');
  ok((await tags()).length === 3, 'Ctrl+Y brings it back');

  // 5. scene inspector and the «Разбивка» tab
  await menu('#mScenes');
  await p.locator('#pane-scenes .sc').first().click(); await p.waitForTimeout(200);
  let insp = await p.locator('#pane-scenes .bdscene').innerText();
  ok(/Реквизит/.test(insp) && /Сковородка/.test(insp) && /Сырники/.test(insp) && /Трюки/.test(insp) && /на 3 дубля/.test(insp), 'inspector lists the scene breakdown: ' + insp.replace(/\n/g, ' | '));
  ok(/особая/.test(insp), 'inspector says the scene is special by the breakdown');
  ok(await p.locator('#pane-scenes .sc').first().locator('.chip.bdt').count() === 1, 'scene list shows the breakdown mark apart');
  await menu('#mBreakdown');
  let pane = await p.locator('#pane-breakdown').innerText();
  ok(await p.locator('#pane-breakdown').isVisible() && /Реквизит · 2/i.test(pane) && /Трюки · 1/i.test(pane) && /По объектам/i.test(pane) && /КВАРТИРА ВОРОНОВЫХ/.test(pane), 'tab lists by category and object: ' + pane.slice(0, 160).replace(/\n/g, ' | '));
  // a scene chip jumps: tag something in scene 3 first
  await select('стеклянной стеной'); await menu('#mTag'); await p.keyboard.press('Digit9'); await p.waitForTimeout(150);
  ok((await tags())[3] && (await tags())[3].cat === 'sound', 'key 9 = Звук/музыка');
  await p.locator('#pane-breakdown [data-jump]').last().click(); await p.waitForTimeout(400);
  ok(await ev(() => window.__draft.S.curScene === window.__draft.S.st.scenes[2].id), 'scene chip jumps to scene 3');

  // 6. tags follow the text: typing before the word, then splitting the element before it
  await ev(() => { const el = [...document.querySelectorAll('#editor > .b')].find((x) => x.textContent.includes('сковородка')); const r = document.createRange(); r.setStart(el.firstChild, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('#editor').focus(); });
  await p.keyboard.type('Утро. '); await p.waitForTimeout(500);
  ok((await tags())[0].blockId === sk && await hl('props') === 2, 'typing in the element keeps the tag');
  await ev(() => { const el = [...document.querySelectorAll('#editor > .b')].find((x) => x.textContent.includes('сковородка')); const i = el.textContent.indexOf('На плите'); const r = document.createRange(); r.setStart(el.firstChild, i); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  t = await tags();
  ok(t[0].blockId !== sk && !t[0].lost && await ev((id) => document.querySelector('[data-id="' + id + '"]').textContent.includes('сковородка'), t[0].blockId), 'split: the tag moved with its word');
  ok(await hl('props') === 2, 'still highlighted after the split');

  // 7. a named draft keeps the tags; click on a mark → «Убрать»
  await menu('#btnDraft'); await p.fill('#drName', 'С разбивкой'); await p.click('#drOk'); await p.waitForTimeout(200);
  const box = await ev(() => { const el = [...document.querySelectorAll('#editor > .b')].find((x) => x.textContent.includes('сковородка')); const i = el.textContent.indexOf('сковородка'); const r = document.createRange(); r.setStart(el.firstChild, i + 2); r.setEnd(el.firstChild, i + 3); const q = r.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
  await p.mouse.click(box.x, box.y); await p.waitForTimeout(200);
  ok(await p.locator('#bdPop').isVisible() && /Реквизит/.test(await p.locator('#bdPop').innerText()) && await p.locator('#bdDel').count() === 1, 'click on the mark shows the tag with «Убрать»');
  await p.click('#bdDel'); await p.waitForTimeout(200);
  t = await tags();
  ok(t.length === 3 && !t.some((x) => x.q === 'сковородка') && await ev(() => window.__draft.S.ep.untagged.length === 1), 'Убрать removes the tag and remembers it for merges');
  ok(await ev(() => window.__draft.S.ep.drafts.some((d) => d.name === 'С разбивкой' && d.tags.length === 4)), 'draft stored the tags');
  await menu('#mDrafts');
  await p.locator('[data-rest]').first().click(); await p.waitForTimeout(300);
  t = await tags();
  ok(t.length === 4 && t.some((x) => x.q === 'сковородка') && await ev(() => !window.__draft.S.ep.untagged.length), 'restoring the draft brings the tags back');

  // 8. View → «Разметка разбивки» hides the marks (per viewer)
  await menu('#mBdMarks');
  ok(await hl('props') === 0 && await hl('stunts') === 0 && !(await p.locator('#mBdMarks').evaluate((x) => x.classList.contains('on'))), 'view off: no marks');
  await menu('#mBdMarks');
  ok(await hl('props') === 2, 'view on again');

  // 9. export: File → «Разбивка в Excel (.xlsx)»
  // the name given to the link (blob downloads from file:// pages report 'download' to Playwright)
  await ev(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return c.call(this); }; });
  const dl = p.waitForEvent('download');
  await menu('#menubar [data-exp=xlsx]');
  const d = await dl;
  const dlName = await ev(() => window.__dlName);
  ok(/разбивка\.xlsx$/.test(dlName), 'file name: ' + dlName);
  const z = await JSZip.loadAsync(require('fs').readFileSync(await d.path()));
  const wb = await z.file('xl/workbook.xml').async('string');
  ok(/name="Сцены"/.test(wb) && /name="Объекты"/.test(wb) && /name="Персонажи"/.test(wb) && /name="Разбивка"/.test(wb), 'four sheets with Cyrillic names');
  const s1 = await z.file('xl/worksheets/sheet1.xml').async('string'), s4 = await z.file('xl/worksheets/sheet4.xml').async('string');
  ok(/КВАРТИРА ВОРОНОВЫХ/.test(s1) && /Сковородка, Сырники|Сырники, Сковородка/.test(s1), 'scenes sheet has the props');
  ok(/Реквизит/.test(s4) && /на 3 дубля/.test(s4) && /Звук\/музыка/.test(s4), 'breakdown sheet');
  ok(await p.locator('#pane-breakdown #bdXlsx').count() === 1, 'the tab has the export button');

  // 10. producer tags (cannot type) — reader cannot
  await role('producer', 'Продюсер Орлова');
  await select('Где второй носок'); await p.keyboard.press('Control+Alt+t'); await p.waitForTimeout(150); await p.keyboard.press('2'); await p.waitForTimeout(150);
  t = await tags();
  ok(t.length === 5 && t[4].cat === 'costume', 'producer can tag');
  await role('reader', 'Читатель');
  ok(await p.locator('#mTag').isHidden() && await p.locator('#tbTag').isHidden() && await p.locator('#menubar [data-exp=xlsx]').isHidden(), 'reader: no tag entries and no export');
  await select('Учительница'); await p.keyboard.press('Control+Alt+t'); await p.waitForTimeout(150);
  ok(await p.locator('#bdPop').isHidden() && (await tags()).length === 5, 'reader: Ctrl+Alt+T does nothing');
  await menu('#mBreakdown');
  ok(await p.locator('#pane-breakdown #bdNew').count() === 0, 'reader: no «+ Пометить» in the tab');
  await ev(() => getSelection().removeAllRanges());
  const box2 = await ev(() => { const el = [...document.querySelectorAll('#editor > .b')].find((x) => x.textContent.includes('Где второй носок')); const i = el.textContent.indexOf('второй'); const r = document.createRange(); r.setStart(el.firstChild, i + 1); r.setEnd(el.firstChild, i + 2); const q = r.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
  await p.mouse.click(box2.x, box2.y); await p.waitForTimeout(200);
  ok(await p.locator('#bdPop').isVisible() && await p.locator('#bdDel').count() === 0, 'reader sees the tag without «Убрать»');
  ok(await ev(() => { window.__draft.removeTag(window.__draft.S.ep.tags[0].id); return window.__draft.S.ep.tags.length; }) === 5, 'reader cannot remove a tag');

  // 11. saved in the project
  await role('writer', 'Сценарист');
  await p.keyboard.press('Control+s');
  // the save is written before the reload, and the reloaded page has booted before it is read
  await p.waitForFunction(() => /Сохранено/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 }).catch(() => {});
  await p.reload(); await p.waitForFunction(() => window.__draft && window.__draft.S.ep, null, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(500);
  ok((await tags()).length === 5 && await hl('costume') === 1, 'tags survive a reload, marks on');

  // 12. regressions: cut and paste, a double space, the occurrence of a repeated word, Enter in the note, Ctrl+Z for a producer
  const setBlocks = (bl) => ev((bl) => {
    const d = window.__draft; d.S.ep.blocks = bl; d.S.ep.tags = []; document.querySelector('#editor').innerHTML = bl.map((x) => '<div class="b t-' + x.t + '" data-t="' + x.t + '" data-id="' + x.id + '"></div>').join('');
    [...document.querySelectorAll('#editor > .b')].forEach((e, i) => { e.textContent = bl[i].x; }); d.recompute();
  }, bl);
  const sixScenes = [];
  ['Дима прячет револьвер в ящик.', 'Во дворе стоит машина.', 'Тихо.', 'Действие сцены 4.', 'Лена ставит чашку. Игорь берёт чашку и пьёт.', 'Финал.'].forEach((x, k) => { sixScenes.push({ id: 'h' + (k + 1), t: 'scene', x: 'ИНТ. КОМНАТА ' + (k + 1) + ' - ДЕНЬ' }, { id: 'a' + (k + 1), t: 'action', x }); });
  await setBlocks(sixScenes);
  // select [from, to) of an element's text
  const selectAt = (id, from, to) => ev(([id, from, to]) => {
    const ed = document.querySelector('#editor'), el = ed.querySelector('[data-id="' + id + '"]'), r = document.createRange();
    const tn = el.firstChild; r.setStart(tn, from); r.setEnd(tn, to == null ? tn.textContent.length : to);
    ed.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, [id, from, to]);
  const caretEnd = (id) => ev((id) => { const el = document.querySelector('#editor [data-id="' + id + '"]'); document.querySelector('#editor').focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }, id);
  const tagSel = async (key) => { await p.keyboard.press('Control+Alt+t'); await p.waitForTimeout(150); await p.keyboard.press(key); await p.waitForTimeout(200); };
  // cut the tagged sentence, paste it into scene 4: the tag goes with it
  await select('револьвер'); await tagSel('1');
  await selectAt('a1', 0);
  await ev(() => { document.querySelector('#editor').dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true })); document.execCommand('delete'); });
  await p.keyboard.type('Пусто.'); await p.waitForTimeout(500);
  t = await tags();
  ok(t.length === 1 && t[0].lost && t[0].blockId === 'a1', 'cut: the tag waits under «Текст удалён»');
  await caretEnd('a4');
  await ev(() => { const dt = new DataTransfer(); dt.setData('text/plain', ' Дима прячет револьвер в ящик.'); document.querySelector('#editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await p.waitForTimeout(500);
  t = await tags();
  ok(t[0].blockId === 'a4' && !t[0].lost && await hl('props') === 1 && await ev(() => window.__draft.S.st.scenes[3].bd.props[0].name === 'Револьвер'), 'paste: the tag is back on the pasted words in scene 4: ' + JSON.stringify(t[0]));
  // a selection with a double space is tagged as it stands
  await caretEnd('a3'); await p.keyboard.type(' Красный  зонт лежит.'); await p.waitForTimeout(400);
  const zi = await ev(() => document.querySelector('#editor [data-id="a3"]').textContent.indexOf('Красный'));
  await selectAt('a3', zi, zi + 'Красный  зонт'.length); await tagSel('1');
  t = await tags();
  ok(t.length === 2 && !t[1].lost && await hl('props') === 2 && await ev(() => window.__draft.S.st.scenes[2].bd.props[0].name === 'Красный зонт'), 'double space: the tag is found and counted: ' + JSON.stringify(t[1]));
  // the second «чашку» tagged; typing at the start of the element keeps the mark on it
  const ci = await ev(() => document.querySelector('#editor [data-id="a5"]').textContent.lastIndexOf('чашку'));
  await selectAt('a5', ci, ci + 5); await tagSel('1');
  await ev(() => { const el = document.querySelector('#editor [data-id="a5"]'), r = document.createRange(); r.setStart(el.firstChild, 0); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
  await p.keyboard.type('Утро. На столе стоит чашку-непроливайку. '); await p.waitForTimeout(500);
  const cup = await ev(() => { const el = document.querySelector('#editor [data-id="a5"]'), h = CSS.highlights.get('bd-props'); const r = [...h].find((x) => el.contains(x.startContainer)); return { at: r && r.startOffset, want: el.textContent.lastIndexOf('чашку') }; });
  ok(cup.at === cup.want, 'repeated word: the mark stays on the tagged occurrence: ' + JSON.stringify(cup));
  // Enter in the note tags with the category under focus (Транспорт), not the first one
  await select('машина'); await p.keyboard.press('Control+Alt+t'); await p.waitForTimeout(150);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight');
  ok(await ev(() => document.activeElement.dataset.bdcat) === 'vehicles', 'arrows reach Транспорт');
  await p.click('#bdNote'); await p.keyboard.type('машина Бориса'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  t = await tags();
  ok(t.length === 4 && t[3].cat === 'vehicles' && t[3].note === 'машина Бориса', 'Enter in the note keeps the focused category: ' + JSON.stringify(t[3]));
  // a producer cannot put the caret in the text, but Ctrl+Z / Ctrl+Y undo and redo the tag
  await role('producer', 'Продюсер Орлова');
  await select('Финал'); await tagSel('1');
  ok((await tags()).length === 5, 'producer tagged');
  await ev(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  ok((await tags()).length === 4, 'producer: Ctrl+Z removes the tag');
  await p.keyboard.press('Control+y'); await p.waitForTimeout(200);
  ok((await tags()).length === 5, 'producer: Ctrl+Y brings it back');

  ok(errs.length === 0, 'no page errors: ' + errs.join('; '));
  await b.close();
  console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
