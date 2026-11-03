// Editor group: paste at the caret, autocomplete vs exact names, Tab/Enter cycling, comment anchors, clean joins, Enter over a selection, redo and Ctrl+S keys, reader limits
const { chromium } = require('playwright');
const path = require('path');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' -> ' + JSON.stringify(a)));
async function open(b, me) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((me) => { try { localStorage.setItem('draft.started', 'true'); if (me) localStorage.setItem('draft.me', JSON.stringify(me)); } catch (e) {} }, me);
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PE', e.message); fails++; });
  await p.goto(URL); await p.waitForTimeout(1000); return { ctx, p };
}
const setDoc = (p, bl) => p.evaluate((bl) => { const ed = document.getElementById('editor'); window.__draft.S.ep.comments = [];
  ed.innerHTML = bl.map(([t, x], i) => '<div class="b t-' + t + '" data-t="' + t + '" data-id="z' + i + '">' + (x || '<br>') + '</div>').join(''); window.__draft.recompute(); }, bl);
const blocks = (p) => p.evaluate(() => window.__draft.readBlocks().map((b) => [b.t, b.x]));
const sel = (p, i1, o1, i2, o2) => p.evaluate(([i1, o1, i2, o2]) => { const els = document.querySelectorAll('#editor .b'); const r = document.createRange();
  const at = (el, o) => el.firstChild && el.firstChild.nodeType === 3 ? [el.firstChild, o] : [el, 0];
  r.setStart(...at(els[i1], o1)); r.setEnd(...at(els[i2 == null ? i1 : i2], o2 == null ? o1 : o2)); document.getElementById('editor').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [i1, o1, i2, o2]);
const paste = (p, text) => p.evaluate((text) => { const dt = new DataTransfer(); dt.setData('text/plain', text); document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);

(async () => {
  const b = await chromium.launch();
  try {
    const { ctx, p } = await open(b);
    // 1. multi-line paste splits the element at the caret and replaces a selection
    await setDoc(p, [['action', 'Он открывает дверь и видит её.']]); await sel(p, 0, 18); await paste(p, 'Пауза.\nОна молчит.');
    eq((await blocks(p)).map((x) => x[1]), ['Он открывает дверь', 'Пауза.', 'Она молчит.', 'и видит её.'], 'multi-line paste goes in at the caret');
    await setDoc(p, [['action', 'СТАРЫЙ ТЕКСТ остаётся'], ['action', 'вторая строка']]); await sel(p, 0, 0, 0, 12); await paste(p, 'Новый текст.\nЕщё строка.');
    eq((await blocks(p)).map((x) => x[1]), ['Новый текст.', 'Ещё строка.', 'остаётся', 'вторая строка'], 'multi-line paste replaces the selection');
    await setDoc(p, [['action', 'Конец.'], ['action', '']]); await sel(p, 1, 0); await paste(p, 'Раз.\nДва.');
    eq((await blocks(p)).map((x) => x[1]), ['Конец.', 'Раз.', 'Два.'], 'paste into an empty element replaces it');

    // 2. autocomplete keeps an exact name and an extension
    await p.evaluate(() => { const P = window.__draft.S.project; P.chars['ИВАН'] = {}; P.chars['ИВАН ПЕТРОВИЧ'] = {}; });
    for (const [typed, want] of [['ИВАН', 'ИВАН'], ['ИВАН (ЗК)', 'ИВАН (ЗК)'], ['ИВАН П', 'ИВАН ПЕТРОВИЧ']]) {
      await setDoc(p, [['scene', 'ИНТ. КУХНЯ - ДЕНЬ'], ['character', '']]); await sel(p, 1, 0);
      await p.keyboard.type(typed, { delay: 10 }); await p.waitForTimeout(100); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
      eq((await blocks(p)).slice(1, 3), [['character', want], ['dialogue', '']], 'cue «' + typed + '» + Enter');
    }
    await setDoc(p, [['scene', 'ИНТ. КУХНЯ - ДЕНЬ'], ['character', ' (ЗК)']]); await sel(p, 1, 0);
    await p.keyboard.type('ИВАН П', { delay: 10 }); await p.waitForTimeout(100); await p.keyboard.press('Tab'); await p.waitForTimeout(100);
    eq((await blocks(p))[1], ['character', 'ИВАН ПЕТРОВИЧ (ЗК)'], 'accepting a name keeps the extension after the caret');

    // 2b. location autocomplete: an object or sub-object typed in full is not replaced by a longer one
    await p.evaluate(() => { const P = window.__draft.S.project; P.locs['КУХНЯ'] = {}; P.locs['КУХНЯ ЛЕНЫ'] = {}; });
    for (const [typed, key, want] of [['ИНТ. КУХНЯ', 'Enter', 'ИНТ. КУХНЯ'], ['ИНТ. КУХНЯ', 'Tab', 'ИНТ. КУХНЯ'], ['ИНТ. КУХНЯ Л', 'Enter', 'ИНТ. КУХНЯ ЛЕНЫ'], ['ИНТ. КУХ', 'Tab', 'ИНТ. КУХНЯ']]) {
      await setDoc(p, [['scene', '']]); await sel(p, 0, 0);
      await p.keyboard.type(typed, { delay: 10 }); await p.waitForTimeout(100); await p.keyboard.press(key); await p.waitForTimeout(100);
      eq((await blocks(p))[0], ['scene', want], 'heading «' + typed + '» + ' + key);
    }
    await setDoc(p, [['scene', 'ИНТ. ДОМ. ЗАЛ - ДЕНЬ'], ['scene', 'ИНТ. ДОМ. ЗАЛ БОЛЬШОЙ - ДЕНЬ'], ['scene', 'ИНТ. ДОМ. ЗАЛ БОЛЬШОЙ - НОЧЬ'], ['scene', '']]); await sel(p, 3, 0);
    await p.keyboard.type('ИНТ. ДОМ. ЗАЛ', { delay: 10 }); await p.waitForTimeout(100); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    eq((await blocks(p))[3], ['scene', 'ИНТ. ДОМ. ЗАЛ'], 'sub-object typed in full + Enter stays');
    await p.evaluate(() => { const P = window.__draft.S.project; delete P.locs['КУХНЯ']; delete P.locs['КУХНЯ ЛЕНЫ']; });

    // 3. Tab / Shift+Tab / Enter on empty elements cycle types instead of inserting a suggestion
    await setDoc(p, [['scene', 'ИНТ. КУХНЯ - ДЕНЬ'], ['action', '']]); await sel(p, 1, 0);
    const seq = [];
    for (let i = 0; i < 3; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(60); seq.push((await blocks(p))[1]); }
    eq(seq, [['character', ''], ['transition', ''], ['action', '']], 'Tab cycles action → character → transition → action');
    await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(60); await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(60);
    eq((await blocks(p))[1], ['action', ''], 'Shift+Tab from an empty scene goes back to action, no «ИНТ.»');
    await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(60); await p.keyboard.press('Enter'); await p.waitForTimeout(60);
    eq((await blocks(p))[1], ['action', ''], 'Enter on an empty scene switches to action');
    await setDoc(p, [['scene', '']]); await sel(p, 0, 0); await p.keyboard.type('НА', { delay: 10 }); await p.keyboard.press('Tab'); await p.waitForTimeout(60);
    eq((await blocks(p))[0], ['scene', 'НАТ. '], 'Tab after typed text still accepts the suggestion');

    // 4. comments follow their text through joins and splits; a cross-element selection is clipped
    const comment = async () => { await p.keyboard.press('Control+Alt+KeyM'); await p.waitForTimeout(100); await p.fill('#cmText', 'замечание'); await p.click('#cmOk'); await p.waitForTimeout(100); };
    const cstate = () => p.evaluate(() => { const c = window.__draft.S.ep.comments[0]; return { lost: !!c.lost, changed: !!c.changed, quote: c.quote, hl: CSS.highlights.get('cmt-active') ? CSS.highlights.get('cmt-active').size : -1 }; });
    await setDoc(p, [['action', 'Он молчит долго.'], ['action', 'Потом уходит.']]); await sel(p, 1, 0, 1, 5); await comment();
    await sel(p, 1, 0); await p.keyboard.press('Backspace'); await p.waitForTimeout(500);
    eq(await cstate(), { lost: false, changed: false, quote: 'Потом', hl: 1 }, 'comment survives a Backspace join');
    await setDoc(p, [['action', 'Он молчит долго. Потом уходит.']]); await sel(p, 0, 17, 0, 22); await comment();
    await sel(p, 0, 17); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    eq(await cstate(), { lost: false, changed: false, quote: 'Потом', hl: 1 }, 'comment survives an Enter split');
    await setDoc(p, [['action', 'Он молчит долго.'], ['action', 'Потом уходит.']]); await sel(p, 0, 3, 1, 5); await comment(); await p.evaluate(() => window.__draft.recompute());
    eq(await cstate(), { lost: false, changed: false, quote: 'молчит долго.', hl: 1 }, 'cross-element selection is clipped to its first element');

    // 5. a Backspace join leaves no style spans
    await setDoc(p, [['action', 'Он молчит.'], ['character', 'иван']]); await sel(p, 1, 0); await p.keyboard.press('Backspace'); await p.waitForTimeout(100);
    const h = await p.evaluate(() => document.querySelector('#editor .b').innerHTML);
    eq(h, 'Он молчит.иван', 'joined element holds plain text');
    await p.keyboard.type('Х'); eq((await blocks(p))[0], ['action', 'Он молчит.Хиван'], 'caret stays at the join');

    // 6. Enter over a selection across elements joins and splits once
    for (const back of [false, true]) {
      await setDoc(p, [['action', 'Он молчит.'], ['character', 'ИВАН'], ['dialogue', 'Привет всем.']]);
      await sel(p, 0, 3, 2, 7);
      if (back) await p.evaluate(() => { const s = getSelection(), r = s.getRangeAt(0); s.setBaseAndExtent(r.endContainer, r.endOffset, r.startContainer, r.startOffset); });
      await p.keyboard.press('Enter'); await p.waitForTimeout(60);
      eq(await blocks(p), [['action', 'Он '], ['action', 'всем.']], 'Enter over a ' + (back ? 'backward' : 'forward') + ' cross-element selection');
    }

    // 7. Ctrl+Shift+Z (key «Z» with Shift, as a real keyboard sends it) and Ctrl+Y redo
    await setDoc(p, [['action', 'Первое']]); await sel(p, 0, 6); await p.waitForTimeout(1000);
    await p.keyboard.type(' второе', { delay: 10 }); await p.waitForTimeout(300);
    await p.keyboard.press('Control+KeyZ'); await p.waitForTimeout(100);
    const afterUndo = (await blocks(p))[0][1];
    await p.evaluate(() => document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    await p.waitForTimeout(100);
    eq([afterUndo, (await blocks(p))[0][1]], ['Первое', 'Первое второе'], 'Ctrl+Z then Ctrl+Shift+Z');
    await p.keyboard.press('Control+KeyZ'); await p.waitForTimeout(50);
    await p.evaluate(() => document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'н', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true })));
    await p.waitForTimeout(100);
    eq((await blocks(p))[0][1], 'Первое второе', 'Ctrl+Y on the Russian layout redoes');

    // 8. Ctrl+S saves wherever the focus is
    await p.evaluate(() => { document.getElementById('toast').hidden = true; });
    await p.focus('#elemSelect');
    const prevented = await p.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }); document.getElementById('elemSelect').dispatchEvent(ev); return ev.defaultPrevented; });
    await p.waitForTimeout(300);
    ok(prevented && await p.evaluate(() => !document.getElementById('toast').hidden && /Сохранено/.test(document.getElementById('toast').textContent)), 'Ctrl+S outside the editor saves');
    await sel(p, 0, 0);
    const n = await p.evaluate(async () => { let k = 0; const orig = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (a[1] === 'db') k++; return orig.apply(this, a); };
      document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300)); IDBObjectStore.prototype.put = orig; return k; });
    ok(n === 1, 'Ctrl+S in the editor saves once (' + n + ')');
    await ctx.close();

  } catch (e) { console.log('ERR', e); fails++; }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all ok'); process.exit(fails ? 1 : 0);
})();
