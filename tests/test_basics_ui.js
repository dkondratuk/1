// Basics batch, UI: inline styles on screen and in block.st (written here as Fountain markup for brevity), Ctrl+B/I/U and the Формат menu, splits/joins/undo keep styles,
// automatic (ПРОД.), forced page breaks, Ctrl+G, the context menu, Правка cut/copy/paste/select all, SmartType maintenance,
// scene colours, the page-setup checkbox, PDF rendering of styles and (ПРОД.), reader / read-only states
const { chromium } = require('playwright');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
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
    window.__load = (bl) => { d.S.ep.blocks = bl.map((x, k) => d.C.blockFromMarkup(x.t, x.x, Object.assign({}, x, { id: 'f' + k }))); d.S.ep.comments = []; d.renderEditor(); d.recompute(); };
    window.__clip = ''; navigator.clipboard.writeText = async (t) => { window.__clip = t; }; navigator.clipboard.readText = async () => window.__clip;
  });
  return { ctx, p };
}
const blocks = (p) => p.evaluate(() => window.__draft.readBlocks().map((b) => [b.t, window.__draft.C.blockMarkup(b)]));
// caret / selection by plain offsets inside a block (walks text nodes, so styled blocks work)
const sel = (p, i1, o1, i2, o2) => p.evaluate(([i1, o1, i2, o2]) => {
  const els = document.querySelectorAll('#editor > .b');
  const at = (el, o) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { if (o <= t.length) return [t, o]; o -= t.length; } return [el, el.childNodes.length]; };
  const r = document.createRange(); r.setStart(...at(els[i1], o1)); r.setEnd(...at(els[i2 == null ? i1 : i2], o2 == null ? o1 : o2));
  document.getElementById('editor').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [i1, o1, i2, o2]);
const menu = (p, id) => p.locator(id).dispatchEvent('click');
const SAMPLE = [{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { t: 'action', x: 'Маша **смотрит** в окно и _ждёт_ *чуда*.' }, { t: 'character', x: 'Маша' }, { t: 'dialogue', x: 'Ну и где он?' },
  { t: 'action', x: 'Пауза.' }, { t: 'character', x: 'Маша' }, { t: 'dialogue', x: 'Вот.' }, { t: 'character', x: 'Петя' }, { t: 'dialogue', x: 'Привет.' }, { t: 'character', x: 'Маша' }, { t: 'dialogue', x: 'И тебе.' }];

(async () => {
  const b = await chromium.launch();
  try {
    const { p } = await open(b);
    // 1. styles on screen: plain text in the DOM + nested elements, markup read back unchanged
    await p.evaluate((bl) => window.__load(bl), SAMPLE);
    const r1 = await p.evaluate(() => { const el = document.querySelector('[data-id=f1]'); const b = window.__draft.readBlocks()[1]; return { html: el.innerHTML, text: el.textContent, back: window.__draft.C.blockMarkup(b), x: b.x, st: b.st }; });
    eq(r1.text, 'Маша смотрит в окно и ждёт чуда.', 'DOM text is plain');
    ok(/<b>смотрит<\/b>/.test(r1.html) && /<u>ждёт<\/u>/.test(r1.html) && /<i>чуда<\/i>/.test(r1.html), 'DOM holds b/u/i elements: ' + r1.html);
    eq(r1.back, 'Маша **смотрит** в окно и _ждёт_ *чуда*.', 'readBlocks gives the styles back');
    eq([r1.x, r1.st], ['Маша смотрит в окно и ждёт чуда.', [[5, 12, 1], [22, 26, 4], [27, 31, 2]]], 'block.x is plain, block.st holds the runs');
    // 2. Ctrl+B / Ctrl+I over a selection, Ctrl+U on the word at the caret, typing inside a styled run
    await sel(p, 3, 3, 3, 8); await p.keyboard.press('Control+b'); await p.waitForTimeout(150);
    eq((await blocks(p))[3][1], 'Ну **и где** он?', 'Ctrl+B wraps the selection');
    eq(await p.evaluate(() => getSelection().toString()), 'и где', 'selection survives Ctrl+B');
    await p.keyboard.press('Control+i'); await p.waitForTimeout(150);
    eq((await blocks(p))[3][1], 'Ну ***и где*** он?', 'Ctrl+I adds italic to the bold run');
    await p.keyboard.press('Control+b'); await p.waitForTimeout(150);
    eq((await blocks(p))[3][1], 'Ну *и где* он?', 'Ctrl+B again removes bold only');
    ok(await p.evaluate(() => document.querySelector('#mItalic').classList.contains('on') && !document.querySelector('#mBold').classList.contains('on')), 'Формат menu ticks the style under the selection');
    await sel(p, 4, 2); await p.keyboard.press('Control+u'); await p.waitForTimeout(100);
    eq((await blocks(p))[4][1], '_Пауза_.', 'Ctrl+U with a collapsed caret styles the word');
    ok(await p.evaluate(() => getSelection().isCollapsed), 'the caret stays collapsed');
    await p.keyboard.type('XY'); await p.waitForTimeout(300);
    eq((await blocks(p))[4][1], '_ПаXYуза_.', 'typing inside an underlined word stays underlined');
    await p.keyboard.press('Control+u'); await p.waitForTimeout(100);
    eq((await blocks(p))[4][1], 'ПаXYуза.', 'Ctrl+U on the word removes the underline');
    await p.evaluate(() => { const d = window.__draft; d.S.ep.blocks = d.readBlocks(); d.S.ep.blocks[4].x = 'Пауза.'; d.renderEditor(); d.recompute(); });
    // Формат menu items work like the keys; a heading stays plain
    await sel(p, 3, 0, 3, 2); await menu(p, '#mBold'); await p.waitForTimeout(100);
    eq((await blocks(p))[3][1], '**Ну** *и где* он?', 'Формат → Жирный');
    await menu(p, '#mUnderline'); await p.waitForTimeout(100);
    eq((await blocks(p))[3][1], '_**Ну**_ *и где* он?', 'Формат → Подчёркнутый');
    await menu(p, '#mUnderline'); await menu(p, '#mBold'); await p.waitForTimeout(100);
    eq((await blocks(p))[3][1], 'Ну *и где* он?', 'both removed again');
    // 3. Enter inside a styled run, Backspace join, undo
    await sel(p, 3, 5); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq((await blocks(p)).slice(3, 5), [['dialogue', 'Ну *и* '], ['dialogue', '*где* он?']], 'Enter splits a styled run on both sides');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    eq((await blocks(p))[3], ['dialogue', 'Ну *и где* он?'], 'undo restores the styled block');
    await sel(p, 4, 0); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
    eq((await blocks(p))[3], ['dialogue', 'Ну *и где* он?Пауза.'], 'Backspace join keeps styles');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    // 4. automatic (ПРОД.) on screen and in the layout
    const auto = await p.evaluate(() => ({ f5: document.querySelector('[data-id=f5]').dataset.auto, f2: document.querySelector('[data-id=f2]').dataset.auto, f9: document.querySelector('[data-id=f9]').dataset.auto, set: [...window.__draft.S.st.lay.contd].sort() }));
    eq([auto.f5, auto.f2, auto.f9], ['1', undefined, undefined], '(ПРОД.) only for the cue that returns after action');
    eq(auto.set, [5], 'layout exposes the set (block indexes)');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('[data-id=f5]'), '::after').content.includes('ПРОД')), 'suffix drawn by CSS, not text');
    eq(await p.evaluate(() => document.querySelector('[data-id=f5]').textContent), 'Маша', 'the cue text stays editable and plain');
    // page setup checkbox turns it off
    await p.evaluate(() => window.__draft.pageSetupDialog()); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.querySelector('#psContd').checked), 'Параметры страницы: (ПРОД.) on by default');
    await p.evaluate(() => { document.querySelector('#psContd').checked = false; document.querySelector('#psOk').click(); }); await p.waitForTimeout(300);
    eq(await p.evaluate(() => [window.__draft.S.project.rules.autoContd, document.querySelector('[data-id=f5]').dataset.auto, window.__draft.S.st.lay.contd.size]), [false, undefined, 0], 'unchecked: no suffix anywhere');
    await p.evaluate(() => { window.__draft.S.project.rules.autoContd = true; window.__draft.S.project.episodes.forEach((e) => delete e._st); window.__draft.recompute(); });
    // 5. forced page break: key, menu tick, label, pagination, undo
    await sel(p, 4, 0); await p.keyboard.press('Control+Shift+Enter'); await p.waitForTimeout(300);
    const pb = await p.evaluate(() => { const d = window.__draft; const el = document.querySelector('[data-id=f4]'); return { flag: d.readBlocks().map((b) => !!b.pageBreak), breaks: d.S.st.lay.breaks, brk: el.dataset.brk, pb: el.dataset.pb, pages: d.S.st.lay.pages.length, tick: document.querySelector('#mPageBreak').classList.contains('on') }; });
    eq(pb.flag, [false, false, false, false, true, false, false, false, false, false, false], 'Ctrl+Shift+Enter sets pageBreak on the block');
    ok(pb.breaks[4] && pb.pages === 2 && pb.brk === '1' && pb.pb === '2' && pb.tick, 'paginate starts page 2 there; label and tick shown ' + JSON.stringify(pb));
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('[data-id=f4]'), '::before').content.includes('разрыв')), 'the break label is drawn before the element');
    await menu(p, '#mPageBreak'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => [!!window.__draft.readBlocks()[4].pageBreak, window.__draft.S.st.lay.pages.length]), [false, 1], 'Формат menu toggles it off');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => [!!window.__draft.readBlocks()[4].pageBreak, window.__draft.S.st.lay.pages.length]), [true, 2], 'undo brings the break back');
    // page break on the first block does nothing
    await sel(p, 0, 0); await p.keyboard.press('Control+Shift+Enter'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__draft.S.st.lay.pages.length), 2, 'a break before the first element adds no page');
    await p.evaluate(() => { const d = window.__draft; d.S.ep.blocks = d.readBlocks(); d.S.ep.blocks.forEach((b) => delete b.pageBreak); d.renderEditor(); d.recompute(); });
    // 6. Ctrl+G: page and scene
    await p.evaluate((bl) => { const s = bl.slice(); for (let k = 0; k < 60; k++) s.push({ t: 'action', x: 'Строка ' + k + '.' }); s.push({ t: 'scene', x: 'НАТ. ДВОР - НОЧЬ' }, { t: 'action', x: 'Двор.' }); window.__load(s); }, SAMPLE);
    await sel(p, 0, 0); await p.keyboard.press('Control+g'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => !!document.querySelector('#gtNum') && /Перейти/.test(document.querySelector('.modal, #modal, dialog').textContent)), 'Ctrl+G opens the goto dialog');
    await p.fill('#gtNum', '2'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const g1 = await p.evaluate(() => { const d = window.__draft; const cur = document.querySelector('#editor .b.cur'); const i = [...document.querySelectorAll('#editor > .b')].indexOf(cur); return { i, first: d.S.st.lay.pages[1] && d.S.st.lay.pages[1].start, modal: !!document.querySelector('#gtNum') }; });
    ok(g1.i >= 0 && !g1.modal && (g1.first == null || g1.i === g1.first), 'goto page 2 lands on the first block of page 2 ' + JSON.stringify(g1));
    await menu(p, '#mGoto'); await p.waitForTimeout(200);
    await p.evaluate(() => { const r = document.querySelector('input[name=gtKind][value=scene], #gtScene'); if (r) r.click(); });
    await p.fill('#gtNum', '2'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => document.querySelector('#editor .b.cur').textContent), 'НАТ. ДВОР - НОЧЬ', 'goto scene 2 lands on its heading');
    await p.evaluate((bl) => window.__load(bl), SAMPLE);
    // 7. context menu: items, element submenu, type change
    await p.click('[data-id=f1]', { button: 'right' }); await p.waitForTimeout(200);
    const cx = await p.evaluate(() => ({ hidden: document.querySelector('#ctx').hidden, items: [...document.querySelectorAll('#ctx > button')].map((x) => x.firstChild.textContent), dis: [...document.querySelectorAll('#ctx > button')].map((x) => x.disabled), types: document.querySelectorAll('#ctxType [data-ctxtype]').length }));
    eq(cx.items, ['Вырезать', 'Копировать', 'Вставить', 'Выделить всё', 'Комментарий…'], 'context menu items');
    eq(cx.dis, [true, true, false, false, true], 'cut/copy/comment disabled without a selection');
    ok(!cx.hidden && cx.types === 7, 'element submenu with the 7 types');
    await p.evaluate(() => document.querySelector('#ctxType [data-ctxtype=paren]').click()); await p.waitForTimeout(200);
    eq(await p.evaluate(() => [document.querySelector('#ctx').hidden, window.__draft.readBlocks()[1].t]), [true, 'paren'], 'submenu changes the element type and closes');
    await p.evaluate(() => window.__draft.readBlocks() && document.querySelector('[data-id=f1]') && window.__draft.S.ep.blocks[1]);
    await sel(p, 3, 0, 3, 5); await p.locator('[data-id=f3]').dispatchEvent('contextmenu', { clientX: 400, clientY: 300 }); await p.waitForTimeout(200);
    eq(await p.evaluate(() => [...document.querySelectorAll('#ctx > button')].map((x) => x.disabled)), [false, false, false, false, false], 'with a selection everything is enabled');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(await p.evaluate(() => document.querySelector('#ctx').hidden), 'Escape closes the context menu');
    // 8. Правка: copy / cut / paste / select all through the menu (clipboard stubbed)
    await p.evaluate((bl) => window.__load(bl), SAMPLE);
    await sel(p, 3, 0, 3, 5); await menu(p, '#mCopy'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => window.__clip), 'Ну и ', 'Копировать writes the clipboard');
    await menu(p, '#mCut'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => [window.__clip, window.__draft.readBlocks()[3].x]), ['Ну и ', 'где он?'], 'Вырезать writes and deletes');
    await sel(p, 4, 6); await menu(p, '#mPaste'); await p.waitForTimeout(300);
    eq((await blocks(p))[4][1], 'Пауза.Ну и ', 'Вставить reads the clipboard into the caret');
    await menu(p, '#mSelectAll'); await p.waitForTimeout(100);
    ok(await p.evaluate(() => { const s = getSelection(); return s.rangeCount && s.toString().includes('ИНТ. КУХНЯ') && s.toString().includes('И тебе.'); }), 'Выделить всё covers the whole script');
    // 9. SmartType maintenance in Персонажи / Объекты
    await p.evaluate(() => { const P = window.__draft.S.project; P.chars = { 'ПРИЗРАК': { about: 'нет в тексте' }, 'МАША': {} }; P.locs = { 'ЧЕРДАК': {}, 'КУХНЯ': {} }; P.episodes.forEach((e) => delete e._st); window.__draft.recompute(); });
    await p.locator('[data-rtab="bible"]').dispatchEvent('click'); await p.waitForTimeout(300);
    const bib = await p.evaluate(() => ({ del: [...document.querySelectorAll('#pane-bible [data-chdel]')].map((x) => x.dataset.chdel), rebuild: !!document.querySelector('#chRebuild') }));
    eq(bib.del, ['ПРИЗРАК'], 'only the name absent from the text gets «Убрать из подсказок»');
    ok(bib.rebuild, 'Персонажи: «Перестроить по тексту» button');
    await p.evaluate(() => document.querySelector('#pane-bible [data-chdel="ПРИЗРАК"]').click()); await p.waitForTimeout(200);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.modal button, dialog button, #modal button')].find((x) => /Убрать/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(300);
    eq(await p.evaluate(() => ['ПРИЗРАК' in window.__draft.S.project.chars, 'МАША' in window.__draft.S.project.chars]), [false, true], 'removed from the dictionary, the used name stays');
    await p.evaluate(() => { window.__draft.S.project.chars['ТЕНЬ'] = {}; window.__draft.S.project.chars['ДЫМ'] = {}; });
    await p.evaluate(() => window.__draft.rebuildDictsDialog('chars')); await p.waitForTimeout(200);
    ok(await p.evaluate(() => /ТЕНЬ/.test(document.querySelector('#rdOk').closest('.modal, dialog, #modal, body').textContent)), 'rebuild dialog lists the names to drop');
    await p.evaluate(() => document.querySelector('#rdOk').click()); await p.waitForTimeout(300);
    eq(await p.evaluate(() => Object.keys(window.__draft.S.project.chars).sort()), ['МАША'], 'rebuild keeps only names from the text');
    await p.locator('[data-rtab="objects"]').dispatchEvent('click'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => [...document.querySelectorAll('#pane-objects [data-objdel]')].map((x) => x.dataset.objdel)), ['ЧЕРДАК'], 'Объекты: only the unused object can be removed');
    await p.evaluate(() => document.querySelector('#pane-objects [data-objdel="ЧЕРДАК"]').click()); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !('ЧЕРДАК' in window.__draft.S.project.locs) && 'КУХНЯ' in window.__draft.S.project.locs), 'object removed from the dictionary, the used one stays');
    await p.evaluate(() => { window.__draft.S.project.locs['ПОДВАЛ'] = {}; window.__draft.rebuildDictsDialog('locs'); }); await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('#rdOk').click()); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !('ПОДВАЛ' in window.__draft.S.project.locs) && 'КУХНЯ' in window.__draft.S.project.locs), 'objects rebuilt by the text');
    // 10. scene colour: inspector select, stripe in the list and in the editor, undo
    await p.locator('[data-ltab="scenes"]').dispatchEvent('click'); await p.waitForTimeout(200);
    await p.evaluate(() => { const d = window.__draft; d.S.curScene = d.S.st.scenes[0].id; d.renderScenes(); }); await p.waitForTimeout(200);
    ok(await p.evaluate(() => !!document.querySelector('#scColor') && document.querySelectorAll('#scColor option').length === 9), 'inspector: colour select with 8 colours + none');
    await p.selectOption('#scColor', 'red'); await p.waitForTimeout(300);
    const col = await p.evaluate(() => { const d = window.__draft; const sc = document.querySelector('#pane-scenes .sc'); const h = document.querySelector('[data-id=f0]'); return { meta: d.S.ep.sceneMeta[d.S.st.scenes[0].id].color, st: d.S.st.scenes[0].color, list: sc.classList.contains('colored') && sc.dataset.color, ed: h.dataset.color, stripe: getComputedStyle(h).borderLeftWidth }; });
    eq([col.meta, col.st, col.list, col.ed], ['red', 'red', 'red', 'red'], 'colour stored in sceneMeta and shown in the list and the editor');
    ok(col.stripe === '4px', 'editor stripe drawn: ' + col.stripe);
    await p.evaluate(() => window.__draft.undo()); await p.waitForTimeout(200);
    eq(await p.evaluate(() => [window.__draft.S.st.scenes[0].color, document.querySelector('[data-id=f0]').dataset.color]), ['', undefined], 'undo removes the colour');
    await p.evaluate(() => { const d = window.__draft; d.S.curScene = d.S.st.scenes[0].id; d.renderScenes(); }); await p.selectOption('#scColor', 'green'); await p.waitForTimeout(200);
    ok(/Color="#4300A0004700"/.test(await p.evaluate(() => { const d = window.__draft; return d.C.exportFDX(d.S.ep, d.S.project, d.S.st, {}); })), '.fdx carries the colour');
    // 11. PDF: bold font, italic skew, underline, (ПРОД.)
    await p.evaluate(() => { window.__load([{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { t: 'action', x: 'Маша **смотрит** в окно и _ждёт_ *чуда*.' }, { t: 'character', x: 'Маша' }, { t: 'dialogue', x: 'Ну и где он?' }, { t: 'action', x: 'Пауза.' }, { t: 'character', x: 'Маша' }, { t: 'dialogue', x: 'Вот.' }]);
      window.__pdf = null; const orig = URL.createObjectURL; URL.createObjectURL = (x) => { window.__pdf = x; return orig(x); }; });
    await p.evaluate(() => window.__draft.exportPDF({ to: 'Тест', label: '', wm: false })); await p.waitForTimeout(800);
    const b64 = await p.evaluate(async () => { const u = new Uint8Array(await window.__pdf.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(b64, 'base64')), useSystemFonts: true }).promise;
    const pg = await doc.getPage(2); const ops = await pg.getOperatorList();
    const tc = await pg.getTextContent();
    const items = tc.items.filter((it) => it.str.trim());
    const fontOf = (it) => { const f = pg.commonObjs.has(it.fontName) ? pg.commonObjs.get(it.fontName) : null; return f ? f.name : it.fontName; };
    const bold = items.find((it) => it.str.trim() === 'смотрит'), plain = items.find((it) => /окно/.test(it.str)), ital = items.find((it) => /чуда/.test(it.str));
    ok(bold && plain && bold.fontName !== plain.fontName && fontOf(bold) === 'FreeMono' && fontOf(plain) === 'FreeMono', 'PDF: bold run uses the second (bold) FreeMono font: ' + (bold && bold.fontName) + ' vs ' + (plain && plain.fontName));
    ok(items.filter((it) => it.transform[5] === plain.transform[5] && it.fontName === plain.fontName).length >= 3, 'PDF: the rest of the line uses the regular font');
    ok(ital && Math.abs(ital.transform[2] / ital.transform[3] - 0.21) < 0.03, 'PDF: italic run is skewed: ' + (ital && ital.transform.join(',')));
    ok(items.some((it) => it.str.includes('(ПРОД.)') && it.str.includes('МАША')), 'PDF: automatic (ПРОД.) printed');
    ok(items.filter((it) => /МАША/.test(it.str)).length === 2, 'PDF: both cues printed');
    const lines = []; for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === pdfjs.OPS.constructPath || ops.fnArray[i] === pdfjs.OPS.stroke) lines.push(ops.fnArray[i]);
    ok(lines.length >= 2, 'PDF: a line is drawn for the underline');
    const und = items.find((it) => it.str.trim() === 'ждёт');
    ok(und && Math.abs(und.transform[4] / 72 - plain.transform[4] / 72 - (plain.width / 72)) < 0.3, 'PDF: underlined run follows the plain run on the same line');
    // 12. producer mode edits too: cut/paste, styles and breaks, the full context menu; a reader's copy is the PDF watermark
    const { p: pr } = await open(b, { name: 'Продюсер', role: 'producer' });
    await pr.evaluate((bl) => window.__load(bl), SAMPLE);
    const rd = await pr.evaluate(() => ({ cut: document.querySelector('#mCut').hidden, paste: document.querySelector('#mPaste').hidden, copy: document.querySelector('#mCopy').hidden, bold: document.querySelector('#mBold').disabled, pb: document.querySelector('#mPageBreak').disabled, auto: document.querySelector('[data-id=f5]').dataset.auto, ce: document.querySelector('#editor').getAttribute('contenteditable'), status: document.querySelector('#roleInfo').textContent }));
    eq([rd.cut, rd.paste, rd.copy, rd.bold, rd.pb, rd.auto, rd.ce], [false, false, false, false, false, '1', 'true'], 'producer: cut/paste shown, styles and break enabled, (ПРОД.) shown, text editable');
    ok(/^Режим: Продюсер · Продюсер/.test(rd.status), 'status bar shows the mode: ' + rd.status);
    await sel(pr, 3, 0, 3, 5); await pr.keyboard.press('Control+b'); await pr.waitForTimeout(150);
    eq((await blocks(pr))[3][1], '**Ну и** где он?', 'producer: Ctrl+B sets bold');
    await sel(pr, 3, 0, 3, 5); await pr.locator('[data-id=f3]').dispatchEvent('contextmenu', { clientX: 400, clientY: 300 }); await pr.waitForTimeout(200);
    eq(await pr.evaluate(() => [...document.querySelectorAll('#ctx > button')].map((x) => x.firstChild.textContent + (x.disabled ? '-' : ''))), ['Вырезать', 'Копировать', 'Вставить', 'Выделить всё', 'Комментарий…'], 'producer context menu: the full set');
    await pr.keyboard.press('Escape');
    ok(await pr.evaluate(() => !document.getElementById('page').dataset.wm && !document.getElementById('page').style.getPropertyValue('--wm-img')), 'no on-screen watermark in producer mode');
    await pr.evaluate(() => { window.__pdf = null; const orig = URL.createObjectURL; URL.createObjectURL = (x) => { window.__pdf = x; return orig(x); }; });
    await pr.evaluate(() => window.__draft.exportPDF({ to: 'Чтец Иванов', label: '', wm: true })); await pr.waitForTimeout(800);
    const wb64 = await pr.evaluate(async () => { const u = new Uint8Array(await window.__pdf.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
    const wdoc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(wb64, 'base64')), useSystemFonts: true }).promise;
    const wpg = await wdoc.getPage(2); const wtxt = (await wpg.getTextContent()).items.map((it) => it.str).join('').replace(/\s+/g, '');
    ok(wtxt.split('ЧтецИванов').length - 1 >= 2, 'PDF watermark: the recipient is tiled over the page, not only in the footer');
  } catch (e) { console.log('FAIL exception', e); fails++; }
  await b.close();
  console.log(fails ? 'test_basics_ui: ' + fails + ' FAILED of ' + n : 'test_basics_ui: ' + n + ' ok');
  process.exit(fails ? 1 : 0);
})();
