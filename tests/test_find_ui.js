// Editor group, UI: Find and Replace (Правка → «Найти и заменить…», Ctrl+F / Ctrl+H) and the (ДАЛЬШЕ) / «ИМЯ (ПРОД.)» marks
// a speech broken by a page break shows on screen
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c || extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, a);
async function open(b, me) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((me) => { try { localStorage.setItem('draft.started', 'true'); if (me) localStorage.setItem('draft.me', JSON.stringify(me)); } catch (e) {} }, me);
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PE', e.message); fails++; });
  await p.goto(URL); await p.waitForTimeout(1000); return { ctx, p };
}
const setDoc = (p, bl) => p.evaluate((bl) => { const ed = document.getElementById('editor'); window.__draft.S.ep.comments = [];
  ed.innerHTML = bl.map(([t, x], i) => '<div class="b t-' + t + '" data-t="' + t + '" data-id="z' + i + '">' + (x || '<br>') + '</div>').join(''); window.__draft.recompute(); }, bl);
const blocks = (p) => p.evaluate(() => window.__draft.readBlocks().map((b) => b.x));
const caret = (p, i, o) => p.evaluate(([i, o]) => { const el = document.querySelectorAll('#editor .b')[i]; const r = document.createRange(); r.setStart(el.firstChild, o); r.collapse(true); document.getElementById('editor').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [i, o]);
const status = (p) => p.locator('#fbStatus').innerText();
const hl = (p) => p.evaluate(() => [CSS.highlights.get('find') ? CSS.highlights.get('find').size : 0, CSS.highlights.get('find-cur') ? [...CSS.highlights.get('find-cur')].map((r) => r.startContainer.parentNode.dataset.id + ':' + r.startOffset).join() : '']);
const fill = async (p, sel, v) => { await p.locator(sel).fill(v); await p.waitForTimeout(80); };
const click = async (p, sel) => { await p.locator(sel).dispatchEvent('click'); await p.waitForTimeout(120); };

(async () => {
  const b = await chromium.launch();
  try {
    const { ctx, p } = await open(b);
    const DOC = [['scene', 'ИНТ. КУХНЯ ИВАНА - ДЕНЬ'], ['action', 'Иван входит. Иванович спит.'], ['character', 'ИВАН'], ['dialogue', 'Привет, иван! Где ИВАН?'], ['action', 'Тишина.']];
    await setDoc(p, DOC);

    // 1. the menu item opens the panel (the old toast-only item is gone); matches are highlighted and counted
    await click(p, '#mFind');
    ok(await p.locator('#findBox').isVisible(), 'Правка → «Найти и заменить…» opens the panel');
    ok(await p.evaluate(() => document.activeElement.id) === 'fbFind', 'the search field has the focus');
    await fill(p, '#fbFind', 'иван');
    eq(await status(p), 'Найдено: 6', 'all matches counted, any case, headings and cues as printed');
    eq((await hl(p))[0], 6, 'every match is highlighted in the text');
    await p.locator('#fbWord').check(); await p.waitForTimeout(80);
    eq(await status(p), 'Найдено: 4', 'whole word leaves out «Иванович» and «ИВАНА»');
    await p.locator('#fbCase').check(); await p.waitForTimeout(80);
    eq(await status(p), 'Найдено: 1', 'match case: only «иван»');
    await p.locator('#fbCase').uncheck(); await p.locator('#fbType').selectOption('character'); await p.waitForTimeout(80);
    eq(await status(p), 'Найдено: 1', 'element filter: the cue only');
    await p.locator('#fbType').selectOption(''); await p.waitForTimeout(80);

    // 2. Next / Previous from the caret, with the current match marked; past the end the search starts over
    await caret(p, 3, 0); await click(p, '#mFind');
    await click(p, '#fbNext');
    eq([await status(p), (await hl(p))[1]], ['3 из 4', 'z3:8'], 'Далее: the first match after the caret');
    await click(p, '#fbNext');
    eq([await status(p), (await hl(p))[1]], ['4 из 4', 'z3:18'], 'Далее moves on');
    await click(p, '#fbNext');
    eq([await status(p), (await hl(p))[1]], ['1 из 4 · поиск с начала', 'z1:0'], 'past the last match it starts over');
    await click(p, '#fbPrev');
    eq(await status(p), '4 из 4 · поиск с начала', 'Назад before the first wraps to the last');
    await p.locator('#fbFind').press('Shift+Enter'); await p.waitForTimeout(100);
    eq(await status(p), '3 из 4', 'Shift+Enter is Назад');
    await p.locator('#fbFind').press('Enter'); await p.locator('#fbFind').press('Shift+Enter'); await p.waitForTimeout(100);
    eq(await status(p), '3 из 4', 'Enter is Далее');

    // 3. Replace replaces the current match and goes on; Replace all is one Ctrl+Z step
    await fill(p, '#fbRepl', 'Пётр');
    await click(p, '#fbRep');
    eq((await blocks(p))[3], 'Привет, Пётр! Где ИВАН?', 'Заменить: the current match only');
    eq([await status(p), (await hl(p))[1]], ['3 из 3', 'z3:18'], 'and the next match becomes current');
    await click(p, '#fbAll');
    eq(await blocks(p), ['ИНТ. КУХНЯ ИВАНА - ДЕНЬ', 'Пётр входит. Иванович спит.', 'Пётр', 'Привет, Пётр! Где Пётр?', 'Тишина.'], 'Заменить все: every whole-word match');
    eq(await status(p), 'Заменено: 3', 'the panel reports the count');
    await p.evaluate(() => window.__draft.undo()); await p.waitForTimeout(100);
    eq((await blocks(p))[3], 'Привет, Пётр! Где ИВАН?', 'one Ctrl+Z undoes the whole Replace all');
    await p.evaluate(() => window.__draft.undo()); await p.waitForTimeout(100);
    eq(await blocks(p), DOC.map((d) => d[1]), 'and one more the single Replace');

    // 4. Esc closes the panel, clears the highlights and selects the found text in the script
    await fill(p, '#fbFind', 'Тишина'); await click(p, '#fbNext');
    await p.locator('#fbFind').press('Escape'); await p.waitForTimeout(100);
    ok(await p.locator('#findBox').isHidden(), 'Esc closes the panel');
    eq(await hl(p), [0, ''], 'highlights cleared');
    eq(await p.evaluate(() => getSelection().toString()), 'Тишина', 'the found text is selected in the script');

    // 5. Ctrl+F in the script opens the panel with the selected text; Ctrl+H goes to the replace field
    await p.evaluate(() => { const el = document.querySelectorAll('#editor .b')[1]; const r = document.createRange(); r.setStart(el.firstChild, 13); r.setEnd(el.firstChild, 21); document.getElementById('editor').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press('Control+f'); await p.waitForTimeout(150);
    eq([await p.locator('#findBox').isVisible(), await p.locator('#fbFind').inputValue(), await p.evaluate(() => document.activeElement.id)], [true, 'Иванович', 'fbFind'], 'Ctrl+F: the selection becomes the search');
    await p.locator('#fbFind').press('Escape'); await caret(p, 1, 0);
    await p.keyboard.press('Control+h'); await p.waitForTimeout(150);
    eq([await p.locator('#findBox').isVisible(), await p.evaluate(() => document.activeElement.id)], [true, 'fbRepl'], 'Ctrl+H: the replace field');
    await p.locator('#fbRepl').press('Escape');

    // 6. the whole project: matches in another episode, Далее opens it; Replace all changes it with a history snapshot first
    const ids = await p.evaluate(() => window.__draft.S.project.episodes.map((e) => e.id));
    eq(await p.evaluate(() => window.__draft.S.ep.id), ids[0], 'the first episode is open');
    await setDoc(p, [['scene', 'ИНТ. КУХНЯ - ДЕНЬ'], ['action', 'Кот спит.'], ['character', 'ИВАН'], ['dialogue', 'Тихо.']]);
    await p.evaluate(() => { const S = window.__draft.S, other = S.project.episodes.find((e) => e !== S.ep);
      other.blocks = [{ id: 'o1', t: 'scene', x: 'НАТ. ДВОР - НОЧЬ' }, { id: 'o2', t: 'action', x: 'Двор пуст. Только кот.' }, { id: 'o3', t: 'character', x: 'ИВАН' }, { id: 'o4', t: 'dialogue', x: 'Кот!' }]; delete other._st; });
    await caret(p, 0, 0); await click(p, '#mFind');
    await p.locator('#fbWord').uncheck(); await fill(p, '#fbFind', 'кот');
    eq(await status(p), 'Найдено: 1', 'this episode only by default');
    await p.locator('#fbScope').selectOption('project'); await p.waitForTimeout(100);
    eq(await status(p), 'Найдено: 3 · серий: 2', 'the whole project');
    await click(p, '#fbNext'); await click(p, '#fbNext');
    eq([await p.evaluate(() => window.__draft.S.ep.id), (await hl(p))[1]], [ids[1], 'o2:18'], 'Далее opens the other episode at the match');
    await click(p, '#fbPrev');
    eq(await p.evaluate(() => window.__draft.S.ep.id), ids[0], 'Назад goes back to the first episode');
    await fill(p, '#fbRepl', 'пёс');
    const hBefore = await p.evaluate(async () => (await window.__draft.histLoad(window.__draft.S.project.episodes[1])).length);
    await click(p, '#fbAll'); await p.waitForTimeout(300);
    const res = await p.evaluate(async () => { const S = window.__draft.S, other = S.project.episodes[1], h = await window.__draft.histLoad(other);
      return { cur: S.ep.blocks.map((b) => b.x), other: other.blocks.map((b) => b.x), hist: h.length, last: h[h.length - 1] && h[h.length - 1].reason, was: h[h.length - 1] && h[h.length - 1].blocks.map((b) => b.x) }; });
    eq([res.cur[1], res.other[1], res.other[3]], ['пёс спит.', 'Двор пуст. Только пёс.', 'пёс!'], 'Replace all over the project changes both episodes');
    // (the snapshot taken when Далее left that episode already holds the same text, so no second copy is added)
    ok(res.hist >= Math.max(1, hBefore) && res.was[1] === 'Двор пуст. Только кот.' && res.was[3] === 'Кот!', 'the other episode keeps its old text in History', res);
    eq(await status(p), 'Заменено: 3 (серий: 2)', 'count over the project');
    await p.evaluate(() => window.__draft.undo()); await p.waitForTimeout(100);
    eq((await blocks(p))[1], 'Кот спит.', 'Ctrl+Z undoes it in the open episode');
    await fill(p, '#fbFind', 'пёс'); await fill(p, '#fbRepl', 'кот'); await click(p, '#fbAll'); await p.waitForTimeout(300);
    const r2 = await p.evaluate(async () => { const other = window.__draft.S.project.episodes[1], h = await window.__draft.histLoad(other); const l = h[h.length - 1]; return [other.blocks[1].x, l.reason, l.blocks[1].x]; });
    eq(r2, ['Двор пуст. Только кот.', 'перед заменой «пёс»', 'Двор пуст. Только пёс.'], 'an episode changed without being opened gets a history snapshot first');
    eq(await status(p), 'Заменено: 2 (серий: 1)', 'count when only another episode matches');

    // 7. rename a character across the project: the cues in every episode and the character card move together
    await p.evaluate(() => { window.__draft.S.project.chars['ИВАН'] = { age: '40', desc: 'отец', minor: false, guest: false }; });
    await fill(p, '#fbFind', 'Иван'); await p.locator('#fbType').selectOption('character'); await fill(p, '#fbRepl', 'Тимофей');
    ok(/персонаж проекта/.test(await p.locator('#fbNote').innerText()), 'the panel says Replace all renames the character', await p.locator('#fbNote').innerText());
    await click(p, '#fbAll'); await p.waitForTimeout(300);
    const ren = await p.evaluate(() => { const P = window.__draft.S.project; return { cues: P.episodes.slice(0, 2).map((e) => e.blocks.filter((b) => b.t === 'character').map((b) => b.x).join()), card: P.chars['ТИМОФЕЙ'], old: P.chars['ИВАН'] }; });
    ok(ren.cues[0] === 'ТИМОФЕЙ' && ren.cues[1] === 'ТИМОФЕЙ' && ren.card && ren.card.desc === 'отец' && !ren.old, 'cues renamed in every episode, the card moved', ren);
    await p.locator('#fbRepl').press('Escape');
    await ctx.close();


    // 9. (ДАЛЬШЕ) and «ИМЯ (ПРОД.)» on screen where a page breaks a speech, as the PDF prints them, outside the text
    const w = await open(b);
    const mk = (n, extra) => { const bl = [['scene', 'ИНТ. КУХНЯ - ДЕНЬ']]; for (let i = 0; i < n; i++) bl.push(['action', 'Строка ' + i + '.']); return bl.concat(extra); };
    const LONG = Array.from({ length: 12 }, (_, i) => 'Это предложение номер ' + i + ' в длинной реплике.').join(' ');
    await setDoc(w.p, mk(46, [['character', 'ИВАН (ЗК)'], ['dialogue', LONG], ['action', 'Конец.']]));
    const inner = await w.p.evaluate(() => {
      const D = window.__draft, lay = D.S.st.lay, ed = document.getElementById('editor'), el = ed.children[48];
      const lh = parseFloat(getComputedStyle(el).lineHeight); const r = document.createRange(); r.selectNodeContents(el);
      const rows = [...new Set([...r.getClientRects()].map((x) => Math.round(x.top)))];
      const pc = [...document.querySelectorAll('#page > .pcont')].map((m) => ({ t: m.textContent, y: m.getBoundingClientRect().top, cls: m.className }));
      const pb = document.querySelector('#page > .pbin').getBoundingClientRect().top;
      const z = el.getBoundingClientRect().height / el.offsetHeight;
      return { split: lay.inner[48], gap: el.dataset.cgap, text: el.textContent.length, rows, pc, pb, lh: lh * z, more: lay.pages.some((pg) => pg.items.some((it) => it.more === 'ИВАН')) };
    });
    ok(inner.split && inner.more, 'layout: the long speech breaks inside with (ДАЛЬШЕ)', inner.split);
    ok(inner.gap === String(inner.split[0].line), 'the dialogue opens a gap at the break line', inner.gap);
    eq(inner.pc.map((m) => m.t), ['(ДАЛЬШЕ)', 'ИВАН (ЗК) (ПРОД.)'], 'the marks: (ДАЛЬШЕ) and the cue with its extension and (ПРОД.)');
    const L = inner.split[0].line, gapTop = inner.rows[L - 1] + inner.lh, nextRow = inner.rows[L];
    ok(Math.abs(nextRow - gapTop - 4 * inner.lh) < 2, 'the text after the break starts four lines lower', [inner.rows.slice(L - 1, L + 1), inner.lh]);
    ok(inner.pc[0].y >= inner.rows[L - 1] + inner.lh - 2 && inner.pc[0].y < inner.pb && inner.pb < inner.pc[1].y && inner.pc[1].y + inner.lh <= nextRow + 2, '(ДАЛЬШЕ) under the last line, the page line, the cue above the next text', inner);
    eq(await blocks(w.p).then((x) => x[48]), LONG, 'the marks are not text');
    // draft marks skip the gap: the asterisks stay on the text lines
    const rm = await w.p.evaluate(() => { const D = window.__draft, S = D.S; S.ep.revisions = [D.C.newRevision(0, [], 'т')]; S.ep.revLevel = 1; D.recompute();
      const el = document.getElementById('editor').children[48], marks = [...document.querySelectorAll('#page > .revmark')];
      const m = marks.find((x) => Math.abs(x.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom) < 3);
      const r = document.createRange(); r.selectNodeContents(el); const rows = [...new Set([...r.getClientRects()].map((x) => Math.round(x.top)))];
      const res = m ? { lines: m.textContent.split('\n'), top: m.getBoundingClientRect().top, row0: rows[0], gap: +el.dataset.cgap } : null;
      delete S.ep.revisions; delete S.ep.revLevel; D.recompute(); return res; });
    ok(rm && rm.lines.slice(rm.gap, rm.gap + 4).join('') === '' && rm.lines.filter((l) => l === '*').length === inner.rows.length && Math.abs(rm.top - rm.row0) < 3, 'draft marks: one per text line, none in the gap', rm);
    // the break between two elements of a speech: room around the page label, marks above and below it
    await setDoc(w.p, mk(51, [['character', 'ИВАН'], ['dialogue', 'Первая часть реплики, довольно длинная, на две строки точно.'], ['paren', '(пауза)'], ['dialogue', 'Вторая часть реплики тоже длинная и на две строки.'], ['action', 'Конец.']]));
    const btw = await w.p.evaluate(() => {
      const ed = document.getElementById('editor'), el = ed.querySelector('[data-contd]');
      if (!el) return null;
      const r = document.createRange(); r.selectNodeContents(el); const tt = r.getClientRects()[0].top;
      const prev = el.previousElementSibling, pr = document.createRange(); pr.selectNodeContents(prev); const pl = [...pr.getClientRects()].pop().bottom;
      const pc = [...document.querySelectorAll('#page > .pcont')].map((m) => ({ t: m.textContent, top: m.getBoundingClientRect().top, bottom: m.getBoundingClientRect().bottom }));
      return { t: el.dataset.t, contd: el.dataset.contd, pb: el.dataset.pb, tt, pl, pc, cg: ed.querySelectorAll('[data-cgap]').length };
    });
    ok(btw && btw.t === 'paren' && btw.contd === 'ИВАН (ПРОД.)' && btw.cg === 0, 'a break before the parenthetical carries the cue', btw);
    if (btw) ok(btw.pc.length === 2 && Math.abs(btw.pc[0].top - btw.pl) < 2 && btw.pc[1].bottom <= btw.tt + 2 && btw.pc[1].bottom > btw.tt - 6 && btw.pc[0].bottom < btw.pc[1].top, '(ДАЛЬШЕ) right under the dialogue, the cue right above the parenthetical', btw);
    // no speech broken: no marks; typing that removes the break removes them
    await setDoc(w.p, mk(10, [['character', 'ИВАН'], ['dialogue', 'Коротко.']]));
    eq(await w.p.evaluate(() => [document.querySelectorAll('#page > .pcont').length, document.querySelectorAll('#editor [data-cgap], #editor [data-contd]').length]), [0, 0], 'nothing when no speech is broken');
    await w.ctx.close();
  } catch (e) { console.log('ERROR', e); fails++; }
  await b.close();
  console.log(fails ? 'test_find_ui: ' + fails + ' FAILED' : 'test_find_ui: all passed');
  process.exit(fails ? 1 : 0);
})();
