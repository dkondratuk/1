// Review fixes, UI: a typed * or _ is a character (no hidden markup), styles never on headings / cues / transitions /
// shots (Ctrl+B skips them, a type change strips them), cut / copy / paste inside the editor keep the styles, the
// context menu offers each role what Правка offers, the reader sees no dead items, an old project is migrated once
const { chromium } = require('playwright');
const path = require('path');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
let fails = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' -> ' + JSON.stringify(a)));
async function open(b, me) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((me) => { try { localStorage.setItem('draft.started', 'true'); if (me) localStorage.setItem('draft.me', JSON.stringify(me)); } catch (e) {} }, me);
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PE', e.message); fails++; });
  await p.goto(URL); await p.waitForTimeout(800);
  await p.evaluate(() => {
    const d = window.__draft;
    window.__load = (bl) => { d.S.ep.blocks = bl.map((x, k) => d.C.blockFromMarkup(x.t, x.x, Object.assign({}, x, { id: 'f' + k }))); d.S.ep.comments = []; d.S.ep.tags = []; d.renderEditor(); d.recompute(); };
    window.__clip = ''; navigator.clipboard.writeText = async (t) => { window.__clip = t; }; navigator.clipboard.readText = async () => window.__clip; navigator.clipboard.read = undefined;
  });
  return { ctx, p };
}
const blocks = (p) => p.evaluate(() => window.__draft.readBlocks().map((b) => [b.t, b.x, b.st || null]));
const sel = (p, i1, o1, i2, o2) => p.evaluate(([i1, o1, i2, o2]) => {
  const els = document.querySelectorAll('#editor > .b');
  const at = (el, o) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { if (o <= t.length) return [t, o]; o -= t.length; } return [el, el.childNodes.length]; };
  const r = document.createRange(); r.setStart(...at(els[i1], o1)); r.setEnd(...at(els[i2 == null ? i1 : i2], o2 == null ? o1 : o2));
  document.getElementById('editor').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [i1, o1, i2, o2]);
const menu = (p, id) => p.locator(id).dispatchEvent('click');
const toast = (p) => p.evaluate(() => document.querySelector('#toast').textContent);

(async () => {
  const b = await chromium.launch();
  try {
    const { p } = await open(b);
    // 1. typed asterisks and underscores stay on the page, in the layout and after a re-render
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: '' }]));
    await sel(p, 1, 0); await p.keyboard.type('Итог: 2*3*4 и foo* и _подпись_ **а'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    eq((await blocks(p))[1], ['action', 'Итог: 2*3*4 и foo* и _подпись_ **а', null], 'typed markers are text, no styles');
    eq(await p.evaluate(() => document.querySelectorAll('#editor > .b')[1].textContent), 'Итог: 2*3*4 и foo* и _подпись_ **а', 'the DOM shows every character');
    ok(await p.evaluate(() => window.__draft.S.st.lay.info[1].lines.join(' ').includes('2*3*4 и foo* и _подпись_ **а')), 'the layout (what the PDF prints) keeps them');
    await p.evaluate(() => { const d = window.__draft; d.S.ep.blocks = d.readBlocks(); d.renderEditor(); d.recompute(); });
    eq(await p.evaluate(() => document.querySelectorAll('#editor > .b')[1].innerHTML), 'Итог: 2*3*4 и foo* и _подпись_ **а', 'a re-render shows them as text, no <i>/<b>');
    // Ctrl+I over «foo*» styles it and loses nothing
    await sel(p, 1, 14, 1, 18); await p.keyboard.press('Control+i'); await p.waitForTimeout(200);
    eq((await blocks(p))[1], ['action', 'Итог: 2*3*4 и foo* и _подпись_ **а', [[14, 18, 2]]], 'Ctrl+I on a word with an asterisk: italic, text unchanged');
    // Backspace join of «сноска **а» and «б** конец»
    await p.evaluate(() => window.__load([{ t: 'action', x: 'сноска **а' }, { t: 'action', x: 'б** конец' }]));
    await sel(p, 1, 0); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
    eq((await blocks(p))[0], ['action', 'сноска **аб** конец', null], 'a join keeps the four asterisks as text');
    // find sees them
    eq(await p.evaluate(() => window.__draft.C.findMatches(window.__draft.readBlocks(), '**аб**').length), 1, 'find matches the literal asterisks');

    // 2. Ctrl+B skips headings, cues, transitions, shots; a cross-element selection styles only the rest
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: 'x' }, { t: 'character', x: 'ИВАН' }, { t: 'dialogue', x: 'Привет.' }, { t: 'transition', x: 'СМЕНА КАДРА:' }]));
    await sel(p, 0, 5, 0, 8); await p.keyboard.press('Control+b'); await p.waitForTimeout(200);
    eq((await blocks(p))[0], ['scene', 'ИНТ. ДОМ - ДЕНЬ', null], 'Ctrl+B on a heading does nothing');
    ok(/без стилей/.test(await toast(p)), 'and says so: ' + await toast(p));
    eq(await p.evaluate(() => [window.__draft.S.st.scenes[0].h.object, document.querySelector('#mBold').classList.contains('on')]), ['ДОМ', false], 'heading analysis untouched, Формат → Жирный not ticked');
    await sel(p, 0, 0, 3, 7); await p.keyboard.press('Control+b'); await p.waitForTimeout(200);
    eq(await blocks(p), [['scene', 'ИНТ. ДОМ - ДЕНЬ', null], ['action', 'x', [[0, 1, 1]]], ['character', 'ИВАН', null], ['dialogue', 'Привет.', [[0, 7, 1]]], ['transition', 'СМЕНА КАДРА:', null]], 'across elements: action and dialogue bold, heading and cue plain');
    eq(await p.evaluate(() => [window.__draft.S.st.characters.map((c) => c.name), window.__draft.S.st.scenes[0].cast]), [['ИВАН'], ['ИВАН']], 'characters and cast stay clean');
    await sel(p, 2, 0, 2, 4); await p.keyboard.press('Control+b'); await p.waitForTimeout(200);
    eq((await blocks(p))[2], ['character', 'ИВАН', null], 'Ctrl+B on a cue does nothing');

    // 3. a styled action turned into a cue (Ctrl+3) drops its styles: one character, (ПРОД.) on the repeat, SmartType knows it
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: 'Иван' }, { t: 'dialogue', x: 'Раз.' }, { t: 'action', x: 'Пауза.' }, { t: 'character', x: 'ИВАН' }, { t: 'dialogue', x: 'Два.' }]));
    await sel(p, 1, 2); await p.keyboard.press('Control+b'); await p.waitForTimeout(150);
    eq((await blocks(p))[1], ['action', 'Иван', [[0, 4, 1]]], 'the word is bold first');
    await p.keyboard.press('Control+3'); await p.waitForTimeout(300);
    eq((await blocks(p))[1], ['character', 'Иван', null], 'Ctrl+3 strips the styles');
    eq(await p.evaluate(() => [document.querySelectorAll('#editor > .b')[1].innerHTML, window.__draft.S.st.characters.map((c) => c.name), window.__draft.S.st.scenes[0].cast, [...window.__draft.S.st.lay.contd]]), ['Иван', ['ИВАН'], ['ИВАН'], [4]], 'DOM plain, one character, (ПРОД.) on the second cue');
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: 'Маша **смотрит** в окно.' }]));
    await sel(p, 1, 2); await p.evaluate(() => { window.__draft.showContextMenu(300, 300); document.querySelector('#ctxType [data-ctxtype=shot]').click(); });
    await p.waitForTimeout(200);
    eq((await blocks(p))[1], ['shot', 'Маша смотрит в окно.', null], 'the context-menu element submenu strips styles too (shot)');
    await p.evaluate(() => { document.querySelector('#elemSelect').value = 'action'; document.querySelector('#elemSelect').dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(200);
    eq((await blocks(p))[1][0], 'action', 'element select changes the type');

    // 4. cut / copy / paste inside the editor keep the styles (menu with the clipboard stubbed, keys with the events)
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: 'Маша **смотрит** в окно.' }, { t: 'action', x: 'Конец.' }]));
    await sel(p, 1, 5, 1, 19); await p.evaluate(() => window.__draft.editCut()); await p.waitForTimeout(300);
    eq([await p.evaluate(() => window.__clip), (await blocks(p))[1]], ['смотрит в окно', ['action', 'Маша .', null]], 'Правка → Вырезать: text to the clipboard, the element loses the run');
    await sel(p, 2, 6); await p.evaluate(() => window.__draft.editPaste()); await p.waitForTimeout(300);
    eq((await blocks(p))[2], ['action', 'Конец.смотрит в окно', [[6, 13, 1]]], 'Правка → Вставить brings the bold back');
    eq(await p.evaluate(() => document.querySelectorAll('#editor > .b')[2].innerHTML), 'Конец.<b>смотрит</b> в окно', 'and the page shows it bold');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq((await blocks(p))[2], ['action', 'Конец.', null], 'undo takes the paste back');
    // keys: the copy event carries text/html with our marker, the paste event reads it
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: 'Маша **смотрит** в окно.' }, { t: 'action', x: 'Конец.' }]));
    await sel(p, 1, 5, 1, 19);
    const flav = await p.evaluate(() => { const dt = new DataTransfer(); const e = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }); document.getElementById('editor').dispatchEvent(e); return { text: dt.getData('text/plain'), html: dt.getData('text/html'), prevented: e.defaultPrevented }; });
    ok(flav.prevented && flav.text === 'смотрит в окно' && /data-draft-clip/.test(flav.html) && /<b>смотрит<\/b>/.test(flav.html), 'Ctrl+C writes text and our HTML flavour: ' + flav.html);
    await sel(p, 2, 6);
    await p.evaluate((flav) => { const dt = new DataTransfer(); dt.setData('text/plain', flav.text); dt.setData('text/html', flav.html); document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, flav);
    await p.waitForTimeout(300);
    eq((await blocks(p))[2], ['action', 'Конец.смотрит в окно', [[6, 13, 1]]], 'Ctrl+V from our HTML flavour keeps the bold');
    // foreign HTML (another program) pastes as plain text; the cut event deletes the selection itself
    await sel(p, 2, 0, 2, 6);
    await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Жирно'); dt.setData('text/html', '<b>Жирно</b>'); document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await p.waitForTimeout(300);
    eq((await blocks(p))[2], ['action', 'Жирносмотрит в окно', [[5, 12, 1]]], 'HTML from elsewhere comes in as plain text, the rest keeps its style');
    await sel(p, 1, 0, 1, 4);
    const cut = await p.evaluate(() => { const dt = new DataTransfer(); const e = new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }); document.getElementById('editor').dispatchEvent(e); return [dt.getData('text/plain'), e.defaultPrevented]; });
    await p.waitForTimeout(300);
    eq([cut, (await blocks(p))[1]], [['Маша', true], ['action', ' смотрит в окно.', [[1, 8, 1]]]], 'Ctrl+X writes the clipboard and deletes the selection, styles kept');
    // a multi-element copy keeps the element types and styles
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'character', x: 'ИВАН' }, { t: 'dialogue', x: 'Ну *и где* он?' }, { t: 'action', x: 'Конец.' }]));
    await sel(p, 1, 0, 2, 14);
    const f2 = await p.evaluate(() => { const dt = new DataTransfer(); document.getElementById('editor').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); return { text: dt.getData('text/plain'), html: dt.getData('text/html') }; });
    await sel(p, 3, 6);
    await p.evaluate((f) => { const dt = new DataTransfer(); dt.setData('text/plain', f.text); dt.setData('text/html', f.html); document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, f2);
    await p.waitForTimeout(400);
    eq((await blocks(p)).slice(3), [['action', 'Конец.', null], ['character', 'ИВАН', null], ['dialogue', 'Ну и где он?', [[3, 8, 2]]]], 'pasted elements keep their types and the italic run');

    // 5. the context menu offers what Правка offers: the producer edits too, so the full set and the element submenu
    const { p: pp } = await open(b, { name: 'Прод', role: 'producer' });
    await pp.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ' }, { t: 'action', x: 'Текст.' }]));
    await sel(pp, 1, 0, 1, 5); await pp.locator('[data-id=f1]').dispatchEvent('contextmenu', { clientX: 400, clientY: 300 }); await pp.waitForTimeout(200);
    eq(await pp.evaluate(() => [...document.querySelectorAll('#ctx > button')].map((x) => x.firstChild.textContent + (x.disabled ? '-' : ''))), ['Вырезать', 'Копировать', 'Вставить', 'Выделить всё', 'Комментарий…'], 'producer context menu: cut, copy, paste, select all, comment');
    eq(await pp.evaluate(() => [document.querySelectorAll('#ctxType').length, document.querySelector('#elemSelect').hidden]), [1, false], 'the element submenu and the toolbar select stay for the producer');
    await pp.keyboard.press('Escape');

    // 7. an old project (scene marks «Животные», line rules) is migrated once when opened
    const { p: po } = await open(b);
    const mig = await po.evaluate(() => {
      const d = window.__draft, P = d.S.project, ep = d.S.ep;
      ep.blocks = [{ id: 'b1', t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { id: 'b2', t: 'character', x: 'МАША' }, { id: 'b3', t: 'dialogue', x: 'Привет.' }, { id: 'b4', t: 'scene', x: 'НАТ. ФЛЭШФОРВАРД. ДВОР - НОЧЬ' }, { id: 'b5', t: 'action', x: 'Тихо.' }];
      ep.sceneMeta = { b1: { tags: ['clip', 'animals', 'crowd'], day: '1' }, b4: { tags: ['stunts'] } }; ep.tags = [];
      P.lines = [{ name: 'Группа А', target: 50, objects: 'КУХНЯ', owners: '', chars: 'МАША', color: '#2346c8' }]; P.lineRules = { special: { name: 'ИИ', keywords: ['ФЛЭШФОРВАРД'] }, priority: 'Группа А' };
      d.openEpisode(ep.id); d.recompute();
      const before = d.S.st.scenes.map((s) => [s.special, s.line || '']);
      document.querySelector('#toast').hidden = true;
      d.S.db.currentEpId = ep.id; window.__draft.S.project.episodes.forEach((e) => { delete e._st; });
      // open the project again: the migration runs
      const id = P.id; d.S.db.currentEpId = ep.id; window.__draft.S.project = null; d.S.db.projects.forEach((x) => { if (x.id === id) {} });
      return { before };
    });
    await po.evaluate(() => { const d = window.__draft; const P = d.S.db.projects.find((x) => x.lineRules); d.S.db.currentEpId = P.episodes[0].id; window.__draft.S.project = P; });
    await po.evaluate(() => { const d = window.__draft; const P = d.S.db.projects.find((x) => x.lineRules); d.S.db.currentProjectId = P.id; });
    const after = await po.evaluate(() => { const d = window.__draft; const P = d.S.db.projects.find((x) => x.lineRules); d.S.me = { name: 'Р', role: 'producer' }; const notes = d.C.migrateProject(P); P.episodes.forEach((e) => { delete e._st; }); d.openEpisode(P.episodes[0].id); d.recompute(); return { notes, scenes: d.S.st.scenes.map((s) => [s.special, s.line || '', (s.bdTags || []).slice()]), tags: d.S.ep.tags.map((t) => [t.cat, t.blockId, t.quote]), meta: d.S.ep.sceneMeta, rules: P.lineRules || null, line: P.lines[0] }; });
    eq(mig.before, [[false, ''], [false, '']], 'before the migration the old marks and rules count for nothing');
    eq(after.scenes, [[true, 'Группа А', ['animals']], [true, 'ИИ', ['stunts']]], 'after it: both scenes special by breakdown items, the lines as the old rules gave them');
    eq(after.tags, [['animals', 'b1', 'ИНТ. КУХНЯ - ДЕНЬ'], ['stunts', 'b4', 'НАТ. ФЛЭШФОРВАРД. ДВОР - НОЧЬ']], 'the marks became breakdown items on the headings');
    eq([after.meta.b1.tags, after.meta.b4.tags, after.meta.b1.line, after.meta.b4.line, after.rules, after.line], [['clip', 'crowd'], [], 'Группа А', 'ИИ', null, { name: 'Группа А', target: 50, color: '#2346c8' }], 'old marks dropped, lines baked into the cards, rules removed');
    ok(after.notes.length === 2 && /Животные/.test(after.notes[0]) && /линий/.test(after.notes[1]), 'the notes say what was migrated: ' + after.notes.join('; '));
    eq(await po.evaluate(() => { const d = window.__draft; const P = d.S.db.projects.find((x) => x.episodes.some((e) => e.sceneMeta && e.sceneMeta.b4)); return d.C.migrateProject(P); }), [], 'a second run changes nothing');
    // through openProject the user gets a toast
    await po.evaluate(() => { const d = window.__draft, P = d.S.project, ep = d.S.ep; ep.sceneMeta.b1.tags.push('animals'); ep.tags = []; document.querySelector('#toast').hidden = true; d.S.db.currentEpId = ep.id; });
    await po.evaluate(() => { const d = window.__draft; const id = d.S.project.id; d.S.project = null; window.__openP = id; });
    await po.evaluate(() => { const d = window.__draft; d.S.db.currentProjectId = window.__openP; });
    const t7 = await po.evaluate(() => { const d = window.__draft; const P = d.S.db.projects.find((x) => x.id === window.__openP); d.S.project = P; const sel = document.querySelector('#projectSelect'); sel.value = P.id; sel.dispatchEvent(new Event('change', { bubbles: true })); return [document.querySelector('#toast').textContent, d.S.ep.tags.length]; });
    ok(/прежней версии/.test(t7[0]) && t7[1] === 1, 'opening the project migrates and says so: ' + t7[0]);
  } catch (e) { console.log('FAIL exception', e); fails++; }
  await b.close();
  console.log(fails ? 'test_markers_ui: ' + fails + ' FAILED of ' + n : 'test_markers_ui: ' + n + ' ok');
  process.exit(fails ? 1 : 0);
})();
