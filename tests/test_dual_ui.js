// Dual dialogue and the Shot element in the UI: Format → «Двойной диалог» / Ctrl+D, side-by-side columns on screen at the
// Final Draft indents, undo, reader limits, the PDF columns; Кадр by Ctrl+7, the menu and the element list, Ctrl+1…6 unchanged
const { chromium } = require('playwright');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const nm = path.resolve(__dirname, '../node_modules') + '/';
let fails = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
async function open(b, me) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((me) => { try { localStorage.setItem('draft.started', 'true'); if (me) localStorage.setItem('draft.me', JSON.stringify(me)); } catch (e) {} }, me);
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PE', e.message); fails++; });
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(800);
  await p.evaluate(() => {
    window.__load = (bl) => {
      const d = window.__draft; d.S.ep.comments = []; d.S.ep.tags = [];
      document.querySelector('#editor').innerHTML = bl.map((x, k) => '<div class="b t-' + x.t + '" data-t="' + x.t + '" data-id="u' + k + '"' + (x.dual ? ' data-dual="1"' : '') + '></div>').join('');
      [...document.querySelectorAll('#editor > .b')].forEach((el, k) => { if (bl[k].x) el.textContent = bl[k].x; else el.innerHTML = '<br>'; });
      d.recompute();
    };
    window.__caret = (i, off) => { const el = document.querySelectorAll('#editor > .b')[i], r = document.createRange();
      if (el.firstChild && el.firstChild.nodeType === 3) r.setStart(el.firstChild, Math.min(off || 0, el.firstChild.length)); else r.setStart(el, 0);
      r.collapse(true); document.getElementById('editor').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  });
  return { ctx, p };
}
const SPEECH = [
  { t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' },
  { t: 'character', x: 'Петя' },
  { t: 'dialogue', x: 'Я первый! Ну давай уже, сколько можно ждать тебя здесь, на этой кухне.' },
  { t: 'character', x: 'Маша' },
  { t: 'paren', x: '(одновременно)' },
  { t: 'dialogue', x: 'Нет, я!' },
  { t: 'action', x: 'Тишина.' },
];
const geo = (p) => p.evaluate(() => {
  const d = window.__draft, z = d.S.zoom, pg = document.querySelector('#page').getBoundingClientRect();
  return [...document.querySelectorAll('#editor > .b')].map((el, k) => {
    const r = el.getBoundingClientRect();
    return { cls: el.className, dual: el.dataset.dual || '', x: (r.left - pg.left) / z / 96, top: (r.top - pg.top) / z, bottom: (r.bottom - pg.top) / z,
      scr: Math.round(r.height / z / 16), mod: d.S.st.lay.info[k].L };
  });
});
const flags = (p) => p.evaluate(() => window.__draft.S.ep.blocks.map((b) => (b.dual ? 1 : 0)).join(''));

(async () => {
  const b = await chromium.launch();
  try {
    const { ctx, p } = await open(b);
    await p.evaluate(() => { const d = window.__draft; d.S.project.rules.paper = 'letter'; d.applyPaper(); d.S.me = { name: 'Автор', role: 'writer' }; d.applyRole(); });
    // 1. Format → «Двойной диалог» on the second speech: the flag goes on its cue and both speeches stand side by side
    await p.evaluate((bl) => window.__load(bl), SPEECH);
    await p.evaluate(() => window.__caret(5, 2));
    ok(await p.evaluate(() => !!document.querySelector('[data-menu=format] #mDual') && /Двойной диалог/.test(document.querySelector('#mDual').textContent)), 'Format menu has «Двойной диалог»');
    await p.evaluate(() => document.querySelector('#mDual').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await p.waitForTimeout(150);
    ok(await flags(p) === '0001000', 'the second cue carries dual: ' + await flags(p));
    let g = await geo(p);
    ok(/\bdl\b/.test(g[1].cls) && /\bdl\b/.test(g[2].cls) && /\bdr\b/.test(g[3].cls) && /\bdr\b/.test(g[4].cls) && /\bdr\b/.test(g[5].cls) && !/\bd[lr]\b/.test(g[6].cls), 'columns: ' + g.map((x) => x.cls).join(' | '));
    ok(Math.abs(g[3].top - g[1].top) < 1, 'right cue on the line of the left cue: ' + g[1].top + ' / ' + g[3].top);
    ok(Math.abs(g[1].x - 2.5) < 0.01 && Math.abs(g[2].x - 1.5) < 0.01 && Math.abs(g[3].x - 5.5) < 0.01 && Math.abs(g[4].x - 5.0) < 0.01 && Math.abs(g[5].x - 4.5) < 0.01, 'Final Draft dual indents on screen: ' + g.slice(1, 6).map((x) => x.x.toFixed(2)).join(' '));
    ok(g.every((x) => x.scr === x.mod), 'screen lines = model lines: ' + g.map((x) => x.scr + '/' + x.mod).join(' '));
    ok(g[6].top - Math.max(g[2].bottom, g[5].bottom) > 15 && g[6].top - Math.max(g[2].bottom, g[5].bottom) < 17, 'action after the pair: one blank line under the longer column');
    ok(await p.evaluate(() => window.__draft.S.st.lay.duals.length === 1 && window.__draft.S.st.lay.total * 54 === 1 + 1 + window.__draft.S.st.lay.duals[0].h + 2), 'page fill counts the pair once');
    // typing in the left column keeps the right one level with it at once
    await p.evaluate(() => window.__caret(2, 3)); await p.keyboard.type(' очень-очень длинное добавление в реплику'); await p.waitForTimeout(30);
    g = await geo(p);
    ok(Math.abs(g[3].top - g[1].top) < 1 && g[6].top > g[2].bottom + 15, 'columns stay level while typing');
    await p.waitForTimeout(400);
    // a pair that starts a page: the right cue is level with the left cue's text, under the «стр. 2» label
    await p.evaluate((bl) => { const pre = [{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }]; for (let k = 0; k < 25; k++) pre.push({ t: 'action', x: 'Строка ' + k + '.' });
      window.__load(pre.concat(bl.slice(1).map((x, k) => (k === 2 ? Object.assign({ dual: true }, x) : x)))); }, SPEECH);
    const pb = await p.evaluate(() => { const els = document.querySelectorAll('#editor > .b'), l = els[26], rr = els[28], z = window.__draft.S.zoom;
      const r = document.createRange(); r.selectNodeContents(l); const t1 = r.getBoundingClientRect().top, t2 = document.createRange(); t2.selectNodeContents(rr);
      return { pb: l.dataset.pb || '', dy: (t2.getBoundingClientRect().top - t1) / z, pairs: window.__draft.S.st.lay.duals.length }; });
    ok(pb.pb === '2' && pb.pairs === 1 && Math.abs(pb.dy) < 1, 'pair at the top of page 2 stays level under the page label: ' + JSON.stringify(pb));
    // 2. Ctrl+Z takes the pair apart again, Ctrl+D puts it back; on a speech in a pair Ctrl+D takes it apart
    await p.evaluate((bl) => window.__load(bl), SPEECH); await p.evaluate(() => window.__caret(4, 1));
    await p.keyboard.press('Control+d'); await p.waitForTimeout(100);
    ok(await flags(p) === '0001000', 'Ctrl+D on the second speech');
    await p.evaluate(() => window.__caret(2, 1)); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    ok(await flags(p) === '0000000' && await p.evaluate(() => !document.querySelector('#editor .dr')), 'Ctrl+Z: one after the other again');
    await p.evaluate(() => window.__caret(2, 1)); await p.keyboard.press('Control+d'); await p.waitForTimeout(100);
    ok(await flags(p) === '0001000', 'Ctrl+D on the first speech pairs it with the next one');
    await p.evaluate(() => window.__caret(5, 1)); await p.keyboard.press('Control+d'); await p.waitForTimeout(100);
    ok(await flags(p) === '0000000', 'Ctrl+D on a speech in a pair takes it apart');
    // a lone speech cannot be dual
    await p.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { t: 'character', x: 'Петя' }, { t: 'dialogue', x: 'Один.' }, { t: 'action', x: 'Тишина.' }]));
    await p.evaluate(() => window.__caret(2, 1)); await p.keyboard.press('Control+d'); await p.waitForTimeout(100);
    ok(await flags(p) === '0000' && /Двойной диалог/.test(await p.evaluate(() => document.querySelector('#toast').textContent)), 'lone speech: nothing changes, a hint instead');
    // the cue turned into another element ends the pair
    await p.evaluate((bl) => window.__load(bl.map((x, k) => (k === 3 ? Object.assign({ dual: true }, x) : x))), SPEECH);
    ok(await flags(p) === '0001000', 'dual flag read from the editor');
    await p.evaluate(() => window.__caret(3, 1)); await p.keyboard.press('Control+2'); await p.waitForTimeout(350);
    ok(await flags(p) === '0000000' && await p.evaluate(() => !document.querySelector('#editor [data-dual]')), 'cue changed to action loses the flag');
    // 3. PDF: two columns at the Final Draft indents, the two cues on one line
    await p.evaluate((bl) => window.__load(bl.map((x, k) => (k === 3 ? Object.assign({ dual: true }, x) : x))), SPEECH);
    await p.evaluate(() => { window.__pdf = null; const orig = URL.createObjectURL; URL.createObjectURL = (x) => { window.__pdf = x; return orig(x); }; });
    await p.evaluate(() => window.__draft.exportPDF({ to: 'Тест', label: '', wm: false }));
    await p.waitForTimeout(800);
    const b64 = await p.evaluate(async () => { const u = new Uint8Array(await window.__pdf.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(b64, 'base64')), useSystemFonts: true }).promise;
    const items = (await (await doc.getPage(2)).getTextContent()).items.filter((it) => it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4] / 72, y: it.transform[5] }));
    const at = (s) => items.find((it) => it.s === s);
    const c1 = at('ПЕТЯ'), c2 = at('МАША'), pr = at('(одновременно)'), d2 = at('Нет, я!'), d1 = c1 && items.filter((it) => Math.abs(it.y - (c1.y - 12)) < 0.5 && it.x < 4).sort((u, v) => u.x - v.x)[0], act = at('Тишина.');
    ok(c1 && c2 && Math.abs(c1.y - c2.y) < 0.5, 'PDF: both cues on one line');
    ok(c1 && c2 && Math.abs(c1.x - 2.5) < 0.01 && Math.abs(c2.x - 5.5) < 0.01, 'PDF cues at 2.50 / 5.50 in');
    ok(d1 && d2 && pr && Math.abs(d1.x - 1.5) < 0.01 && Math.abs(d2.x - 4.5) < 0.01 && Math.abs(pr.x - 5.0) < 0.01, 'PDF dialogue at 1.50 / 4.50 in, parenthetical 5.00 in');
    ok(d1 && Math.abs(d1.y - (c1.y - 12)) < 0.5 && pr && Math.abs(pr.y - (c2.y - 12)) < 0.5 && Math.abs(d2.y - (c2.y - 24)) < 0.5, 'PDF rows inside the columns');
    const leftLines = items.filter((it) => Math.abs(it.x - 1.5) < 0.01 && it.y < c1.y && it.y > act.y).length;
    ok(act && Math.abs(act.y - (c1.y - 12 * (1 + Math.max(leftLines, 2) + 1))) < 0.5, 'PDF action under the longer column: ' + (act && act.y) + ' cue ' + c1.y + ' left lines ' + leftLines);
    await ctx.close();

    // 4. Shot: Ctrl+7, Format menu and the element list; Ctrl+1…6 as before; Enter after a shot is action
    const o = await open(b), q = o.p;
    await q.evaluate(() => { const d = window.__draft; d.S.project.rules.paper = 'letter'; d.applyPaper(); });
    await q.evaluate(() => window.__load([{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { t: 'action', x: 'крупно — чайник' }, { t: 'action', x: 'Кипит.' }]));
    await q.evaluate(() => window.__caret(1, 3)); await q.keyboard.press('Control+7'); await q.waitForTimeout(350);
    const sh = await q.evaluate(() => { const el = document.querySelectorAll('#editor > .b')[1], pg = document.querySelector('#page').getBoundingClientRect(), z = window.__draft.S.zoom;
      return { t: el.dataset.t, cls: el.className, tt: getComputedStyle(el).textTransform, mt: getComputedStyle(el).marginTop, x: (el.getBoundingClientRect().left - pg.left) / z / 96, sel: document.querySelector('#elemSelect').value, m: window.__draft.S.ep.blocks[1].t }; });
    ok(sh.t === 'shot' && sh.m === 'shot' && /t-shot/.test(sh.cls), 'Ctrl+7 makes a shot');
    ok(sh.tt === 'uppercase' && sh.mt === '16px' && Math.abs(sh.x - 1.5) < 0.01, 'shot on screen: capitals, one blank line, 1.50 in: ' + JSON.stringify(sh));
    ok(sh.sel === 'shot' && await q.evaluate(() => [...document.querySelectorAll('#elemSelect option')].map((x) => x.value).join()) === 'scene,action,character,paren,dialogue,transition,shot', 'element list has Кадр last');
    for (const [k, t] of [[1, 'scene'], [2, 'action'], [3, 'character'], [4, 'paren'], [5, 'dialogue'], [6, 'transition'], [7, 'shot']]) {
      await q.evaluate(() => window.__caret(2, 1)); await q.keyboard.press('Control+' + k); await q.waitForTimeout(40);
      ok(await q.evaluate(() => document.querySelectorAll('#editor > .b')[2].dataset.t) === t, 'Ctrl+' + k + ' → ' + t);
    }
    await q.evaluate(() => window.__caret(2, 0)); await q.keyboard.press('Control+2'); await q.waitForTimeout(40);
    await q.evaluate(() => window.__caret(2, 1));
    await q.evaluate(() => document.querySelector('[data-menu=format] [data-type=shot]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    ok(await q.evaluate(() => document.querySelectorAll('#editor > .b')[2].dataset.t) === 'shot', 'Format → Кадр');
    await q.evaluate(() => { const el = document.querySelectorAll('#editor > .b')[2], r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await q.keyboard.press('Enter'); await q.waitForTimeout(40);
    ok(await q.evaluate(() => document.querySelectorAll('#editor > .b')[3].dataset.t) === 'action', 'Enter after a shot → action');
    ok(await q.evaluate(() => /Ctrl\+7/.test(document.querySelector('[data-type=shot]').textContent)), 'menu shows Ctrl+7');
    await o.ctx.close();

    // 5. a reader cannot switch dual dialogue
    const rd = await open(b, { name: 'Читатель', role: 'reader' }), r = rd.p;
    await r.evaluate((bl) => window.__load(bl), SPEECH);
    await r.evaluate(() => window.__draft.toggleDual()); await r.waitForTimeout(100);
    ok(await r.evaluate(() => window.__draft.S.ep.blocks.every((x) => !x.dual)) && /только чтение/i.test(await r.evaluate(() => document.querySelector('#toast').textContent)), 'reader: read-only');
    ok(await r.evaluate(() => document.querySelector('#mDual').disabled), 'menu item disabled for a reader');
    await rd.ctx.close();
  } catch (e) { console.log('FAIL', e); fails++; }
  await b.close();
  console.log('test_dual_ui: ' + (n - fails) + '/' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})();
