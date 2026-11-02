// Suggestion mode (Правка → «Режим предложений»): edits recorded as suggestions, inline marks, side list with
// accept/reject, roles, undo, drafts, history, pending copy, project-file merge; exports see the accepted text only
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
let fails = 0, n = 0; const ok = (c, m, extra) => { n++; if (!c) { fails++; console.log('FAIL', m, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); localStorage.setItem('draft.team', 'true'); } catch (e) {} });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const nm = path.resolve(__dirname, '../node_modules') + '/';
  await p.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(700);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const role = (r, name) => ev(([r, name]) => { const d = window.__draft; d.S.me = { name, role: r }; d.applyRole(); d.recompute(); }, [r, name]);
  const menu = async (id) => { await p.locator(id).dispatchEvent('click'); await p.waitForTimeout(200); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  // a short episode, so offsets are easy to reason about
  await ev(() => {
    const d = window.__draft, S = d.S;
    S.ep.blocks = [
      { id: 'h1', t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' },
      { id: 'a1', t: 'action', x: 'Лена жарит сырники.' },
      { id: 'c1', t: 'character', x: 'ЛЕНА' },
      { id: 'd1', t: 'dialogue', x: 'Иди завтракать.' },
      { id: 'a2', t: 'action', x: 'Игорь не идёт.' },
    ];
    delete S.ep.sugs; delete S.ep.sugGone; S.undo = []; S.redo = [];
    d.renderEditor(); d.recompute();
  });
  const st = () => ev(() => { const d = window.__draft, S = d.S; d.recompute(); return { x: S.ep.blocks.map((b) => b.x), n: S.ep.blocks.length, sugs: (S.ep.sugs || []).map((s) => s.k + ':' + (s.x || '') + ':' + s.by), gone: (S.ep.sugGone || []).length }; });
  const caret = (id, off) => ev(([id, off]) => { const el = document.querySelector('#editor [data-id="' + id + '"]'); el.focus(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let left = off, node; while ((node = w.nextNode())) { if (left <= node.length) break; left -= node.length; } const r = document.createRange(); if (node) r.setStart(node, left); else { r.selectNodeContents(el); r.collapse(false); } r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [id, off]);
  const select = (id, a, z) => ev(([id, a, z]) => { const el = document.querySelector('#editor [data-id="' + id + '"]'); el.focus(); const pos = (off) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let left = off, node; while ((node = w.nextNode())) { if (left <= node.length) return [node, left]; left -= node.length; } return [el, el.childNodes.length]; }; const r = document.createRange(); r.setStart(...pos(a)); r.setEnd(...pos(z)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [id, a, z]);
  const html = (id) => ev((id) => document.querySelector('#editor [data-id="' + id + '"]').innerHTML, id);
  const x0 = (await st()).x;

  // 1. the toggle: Правка menu, status bar, Ctrl+Shift+E
  ok(await ev(() => !document.getElementById('mSuggest').classList.contains('on')) && await p.locator('#sgInfo').isHidden(), 'mode off at start, no indicator');
  await menu('#mSuggest');
  ok(await ev(() => document.getElementById('mSuggest').classList.contains('on')), 'Правка → «Режим предложений» is checked');
  ok(/Режим предложений/.test(await p.locator('#sgInfo').innerText()) && await p.locator('#sgInfo').isVisible(), 'status bar shows the mode: ' + await p.locator('#sgInfo').innerText());

  // 2. typing inserts a suggestion, the text model does not change
  await caret('a1', 4); await p.keyboard.type(' быстро'); await p.waitForTimeout(350);
  let s = await st();
  ok(JSON.stringify(s.x) === JSON.stringify(x0), 'typed text is not in ep.blocks', s.x);
  ok(s.sugs.length === 1 && s.sugs[0] === 'ins: быстро:Сценарист', 'one insertion by the writer', s.sugs);
  ok(/<ins class="sg"[^>]*> быстро<\/ins>/.test(await html('a1')), 'shown underlined inline (<ins>)');
  ok(await ev(() => { const i = document.querySelector('#editor ins.sg'); const cs = getComputedStyle(i); return /underline/.test(cs.textDecorationLine) && cs.color !== getComputedStyle(i.parentNode).color; }), 'ins is underlined and coloured');
  // Backspace inside one's own insertion just shortens it
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
  s = await st(); ok(s.sugs[0] === 'ins: быст:Сценарист', 'Backspace edits the own insertion', s.sugs);

  // 3. deleting accepted text strikes it; typing over a selection = replacement
  await select('a1', 16, 23); // «сырники» after « быст» (view offsets)
  ok(await ev(() => getSelection().toString()) === 'сырники', 'selected «сырники»');
  await p.keyboard.type('блины'); await p.waitForTimeout(350);
  s = await st();
  ok(JSON.stringify(s.x) === JSON.stringify(x0), 'replacement leaves the text model alone');
  ok(s.sugs.includes('del:сырники:Сценарист') && s.sugs.includes('ins:блины:Сценарист'), 'struck + inserted', s.sugs);
  ok(/<del class="sg"[^>]*>сырники<\/del><ins class="sg"[^>]*>блины<\/ins>/.test(await html('a1')), 'struck text crossed out before the new text', await html('a1'));
  ok(await ev(() => /line-through/.test(getComputedStyle(document.querySelector('#editor del.sg')).textDecorationLine)), 'del is struck through');
  // Backspace on accepted text: struck, caret moves before it
  await caret('d1', 15); await p.keyboard.press('Backspace'); await p.waitForTimeout(250);
  ok(/<del class="sg"[^>]*>\.<\/del>/.test(await html('d1')), 'Backspace strikes one character', await html('d1'));
  await p.keyboard.press('Backspace'); await p.waitForTimeout(250);
  ok(/<del class="sg"[^>]*>ь\.<\/del>/.test(await html('d1')), 'the next Backspace extends the same deletion', await html('d1'));

  // 4. Enter: a proposed new element; Enter in the middle strikes the tail and proposes it as a new element
  await caret('a2', 14); await p.keyboard.press('Enter'); await p.keyboard.type('Он спит.'); await p.waitForTimeout(400);
  s = await st();
  ok(s.n === 5 && s.sugs.includes('add:Он спит.:Сценарист'), 'Enter at the end: proposed element, not in ep.blocks', s);
  const add = await ev(() => { const el = document.querySelector('#editor [data-sga]'); return el && { t: el.dataset.t, txt: el.textContent, ul: /underline/.test(getComputedStyle(el).textDecorationLine) }; });
  ok(add && add.t === 'action' && add.txt === 'Он спит.' && add.ul, 'shown as a whole underlined element', add);
  await caret('a2', 6); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  s = await st();
  ok(s.sugs.includes('del:не идёт.:Сценарист') && s.sugs.includes('add:не идёт.:Сценарист'), 'split: tail struck and proposed as a new element', s.sugs);
  ok(await ev(() => document.activeElement && getSelection().anchorNode && (getSelection().anchorNode.nodeType === 3 ? getSelection().anchorNode.parentNode : getSelection().anchorNode).closest('[data-sga]') != null), 'caret in the new element');

  // 5. what the model and exports see: accepted text only
  const exp = await ev(() => { const d = window.__draft, S = d.S, C = d.C; const fdx = C.exportFDX(S.ep, S.project, S.st); return { fdx, fountain: C.exportFountain(S.ep, S.project, S.st), revs: S.ep.blocks.some((b) => b.rev), lay: S.st.lay.info.length, els: document.querySelectorAll('#editor > .b').length, find: C.findMatches(d.readBlocks(), 'блины', {}).length }; });
  ok(!/блины|спит|быст/.test(exp.fdx) && /сырники/.test(exp.fdx) && /Иди завтракать\./.test(exp.fdx), 'FDX has the accepted text only');
  ok(!/блины|спит/.test(exp.fountain) && /сырники/.test(exp.fountain), 'Fountain has the accepted text only');
  ok(exp.lay === 5 && exp.els === 7, 'layout counts accepted elements only (proposed ones are extra on screen)', exp);
  ok(exp.find === 0, 'find searches the accepted text');

  // 6. undo / redo bring suggestions back and forth
  const before = (await st()).sugs.length;
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
  let after = await st();
  ok(after.sugs.length < before && !after.sugs.includes('add:не идёт.:Сценарист'), 'Ctrl+Z takes the last suggestion back', after.sugs);
  await p.keyboard.press('Control+y'); await p.waitForTimeout(300);
  after = await st(); ok(after.sugs.length === before, 'Ctrl+Y redoes it', after.sugs);

  // 7. side list: the writer can reject her own suggestions, not accept
  await ev(() => { document.querySelector('[data-rtab="suggest"]').click(); }); await p.waitForTimeout(200);
  const list = await ev(() => ({ items: document.querySelectorAll('#pane-suggest .sgi').length, ok: document.querySelectorAll('#pane-suggest [data-sgok]').length, no: document.querySelectorAll('#pane-suggest [data-sgno]').length, all: !!document.getElementById('sgAcceptAll'), txt: document.getElementById('pane-suggest').innerText }));
  ok(list.items === 6 && list.ok === 0 && list.no === 6 && !list.all, 'writer: 6 entries (insertion, replacement, two deletions, two new elements), only «Отклонить»', list);
  ok(/Замена/.test(list.txt) && /Новый элемент/.test(list.txt) && /Сценарист/.test(list.txt), 'kinds and author shown');
  // reject own insertion «быст»
  const idx = await ev(() => [...document.querySelectorAll('#pane-suggest .sgi')].findIndex((x) => /быст/.test(x.innerText)));
  await p.locator('#pane-suggest .sgi').nth(idx).locator('[data-sgno]').click(); await p.waitForTimeout(300);
  s = await st();
  ok(!s.sugs.some((x) => /быст/.test(x)) && s.gone >= 1 && JSON.stringify(s.x) === JSON.stringify(x0), 'rejected: gone from the screen and remembered in sugGone', s);
  ok(!/быст/.test(await html('a1')), 'mark removed inline');

  // 8. another author's suggestion cannot be rejected by the writer
  await role('writer', 'Другой автор');
  ok(await ev(() => document.querySelectorAll('#pane-suggest [data-sgno]').length) === 0, 'other writer: no buttons on someone else\'s suggestions');
  ok(await ev(() => window.__draft.sgDecide(null, false)) === false && (await st()).sugs.length === 6, 'and «reject all» is refused for a writer');

  // 9. the editor accepts one, then all
  await role('editor', 'Редактор');
  ok(await ev(() => !!document.getElementById('sgAcceptAll') && document.querySelectorAll('#pane-suggest [data-sgok]').length === 5), 'editor: Принять / Принять все');
  const ri = await ev(() => [...document.querySelectorAll('#pane-suggest .sgi')].findIndex((x) => /Замена/.test(x.innerText)));
  await p.locator('#pane-suggest .sgi').nth(ri).locator('[data-sgok]').click(); await p.waitForTimeout(300);
  s = await st();
  ok(s.x[1] === 'Лена жарит блины.' && !s.sugs.some((x) => /сырники|блины/.test(x)), 'replacement accepted into the text', s);
  ok(await ev(() => window.__draft.S.ep.blocks[1].lastBy) === 'Редактор', 'accepted element stamped by who accepted it');
  // undo restores the suggestion and the text
  await ev(() => window.__draft.undo()); await p.waitForTimeout(200);
  s = await st(); ok(s.x[1] === 'Лена жарит сырники.' && s.sugs.includes('del:сырники:Сценарист') && s.gone >= 1, 'Ctrl+Z after accept: suggestion back, text back', s);
  // history snapshot before «Принять все», then accept all
  const hBefore = await ev(async () => (await window.__draft.histLoad(window.__draft.S.ep)).length);
  await p.locator('#sgAcceptAll').click(); await p.waitForTimeout(500);
  s = await st();
  ok(s.sugs.length === 0 && s.x.join('|') === 'ИНТ. КУХНЯ - ДЕНЬ|Лена жарит блины.|ЛЕНА|Иди завтракат|Игорь |не идёт.|Он спит.', 'accept all: text as proposed', s.x);
  ok(await p.locator('#sgInfo').isVisible() && /Режим предложений$/.test(await p.locator('#sgInfo').innerText()), 'status bar: no pending count');
  const hist = await ev(async () => { const d = window.__draft, l = await d.histLoad(d.S.ep); const i = l.findIndex((h) => /Принять все/.test(h.reason || '')); return { n: l.length, i, sugs: i >= 0 ? (d.C.histState(l, i).sugs || []).length : -1 }; });
  ok(hist.n >= hBefore && hist.i >= 0 && hist.sugs === 6, 'history keeps the state before «Принять все» with its suggestions', hist);
  await ev(() => window.__draft.undo()); await p.waitForTimeout(200);
  s = await st(); ok(s.sugs.length === 6 && s.x[1] === 'Лена жарит сырники.', 'and Ctrl+Z brings all six back', s);
  await p.locator('#sgRejectAll').click(); await p.waitForTimeout(400);
  s = await st(); ok(s.sugs.length === 0 && JSON.stringify(s.x) === JSON.stringify(x0), 'reject all: text unchanged', s);

  // 10. a whole element proposed for deletion: Backspace in an empty element, a selection over whole elements
  await ev(() => window.__draft.undo()); await p.waitForTimeout(200);
  await ev(() => { const d = window.__draft; d.sgDecide(null, false); });
  await select('c1', 0, 4);
  await ev(() => { const sel = getSelection(), r = sel.getRangeAt(0), el = document.querySelector('#editor [data-id="d1"]'); const t = el.firstChild; r.setEnd(t, t.length); sel.removeAllRanges(); sel.addRange(r); });
  await p.keyboard.press('Delete'); await p.waitForTimeout(300);
  s = await st();
  ok(s.n === 5 && JSON.stringify(s.x) === JSON.stringify(x0) && s.sugs.includes('del:ЛЕНА:Редактор') && s.sugs.includes('rm::Редактор'), 'selection across elements: first struck, the fully covered one proposed for deletion', s.sugs);
  ok(await ev(() => /line-through/.test(getComputedStyle(document.querySelector('#editor [data-sgr]')).textDecorationLine)), 'element proposed for deletion is struck through');
  await ev(() => window.__draft.sgDecide(null, true)); await p.waitForTimeout(200);
  s = await st(); ok(s.n === 4 && s.x.join('|') === 'ИНТ. КУХНЯ - ДЕНЬ|Лена жарит сырники.||Игорь не идёт.', 'accepted: the element is gone, the struck cue emptied', s.x);
  await ev(() => window.__draft.undo()); await p.waitForTimeout(200);
  await ev(() => window.__draft.sgDecide(null, false)); await p.waitForTimeout(200);

  // 11. outside the mode an edit next to suggestions changes the text and keeps the marks in place
  await caret('a2', 0); await p.keyboard.type('Х'); await p.waitForTimeout(300);
  await select('a2', 1, 6); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
  s = await st(); ok(s.sugs.length === 2, 'two suggestions in a2', s.sugs);
  await menu('#mSuggest');
  ok(await ev(() => !document.getElementById('mSuggest').classList.contains('on')) && /^Предложения: 2$/.test(await p.locator('#sgInfo').innerText()), 'mode off: indicator shows the pending count');
  await caret('a2', 0); await p.keyboard.type('Ну, '); await p.waitForTimeout(300);
  s = await st();
  ok(s.x[4] === 'Ну, Игорь не идёт.' && s.sugs.includes('ins:Х:Редактор') && s.sugs.includes('del:Игорь:Редактор'), 'direct typing goes into the text, suggestions keep their place', s);
  ok(/^Ну, <ins[^>]*>Х<\/ins><del[^>]*>Игорь<\/del> не идёт\.$/.test(await html('a2')), 'marks still around the right words', await html('a2'));
  // Enter outside the mode splits an element with marks without flattening them
  await caret('a2', 11); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  s = await st(); ok(s.x[4] === 'Ну, Игорь ' && s.x[5] === 'не идёт.' && s.sugs.length === 2, 'split outside the mode keeps the suggestions', s);
  await ev(() => window.__draft.undo()); await p.waitForTimeout(200);

  // 12. drafts and the pending copy carry suggestions
  await menu('#btnDraft'); await p.fill('#drName', 'С предложениями'); await p.click('#drOk'); await p.waitForTimeout(250);
  const dr = await ev(() => { const d = window.__draft.S.ep.drafts.find((x) => x.name === 'С предложениями'); return d && (d.sugs || []).length; });
  ok(dr === 2, 'a saved draft keeps the suggestions', dr);
  await ev(() => window.dispatchEvent(new Event('pagehide')));
  const pend = await ev(() => JSON.parse(localStorage.getItem('draft.pending') || 'null'));
  ok(!pend || (pend.sugs || []).length === 2, 'the unload copy carries them', pend && pend.sugs);
  await ev(() => window.__draft.sgDecide(null, false)); await p.waitForTimeout(200);
  ok((await st()).sugs.length === 0, 'rejected before restoring the draft');
  await ev(() => window.__draft.showDrafts()); await p.waitForTimeout(250);
  await ev(() => { const btn = [...document.querySelectorAll('#modal [data-rest]')].find((x) => x.closest('tr').innerText.includes('С предложениями')); btn.click(); }); await p.waitForTimeout(400);
  s = await st(); ok(s.sugs.length === 2 && /Х/.test(await html('a2')), 'restoring the draft brings them back', s.sugs);

  // 13. project-file merge: union by id, rejected ones stay rejected
  const fileP = path.join(tmp, 'p.json');
  await ev(() => JSON.stringify({ app: 'draft', version: 1, project: window.__draft.projectFileData(window.__draft.S.project) })).then((j) => {
    const d = JSON.parse(j), e = d.project.episodes.find((x) => x.sugs && x.sugs.length);
    e.sugs.push({ id: 'ext-ins', k: 'ins', bid: 'd1', off: 4, x: ' скорее', ctx: 'Иди', by: 'Анна', at: Date.now() });
    e.sugs.push({ id: 'ext-add', k: 'add', bid: 'newB', after: 'c1', t: 'paren', x: '(зло)', by: 'Анна', at: Date.now() });
    e.sugs.push({ id: 'old-gone', k: 'del', bid: 'a1', off: 0, x: 'Лена', by: 'Анна', at: 1 });
    fs.writeFileSync(fileP, JSON.stringify(d)); });
  await ev(() => { const S = window.__draft.S; S.ep.sugGone = (S.ep.sugGone || []).concat(['old-gone']); });
  await ev(() => { document.getElementById('fileInput').dataset.mode = 'project'; });
  await p.setInputFiles('#fileInput', fileP); await p.waitForTimeout(800);
  s = await st();
  ok(s.sugs.length === 4 && s.sugs.includes('ins: скорее:Анна') && s.sugs.includes('add:(зло):Анна') && !s.sugs.some((x) => /Лена:Анна/.test(x)), 'merged: both copies\' suggestions, a rejected one stays out', s.sugs);
  ok(/<ins[^>]*> скорее<\/ins>/.test(await html('d1')) && await ev(() => { const el = document.querySelector('#editor [data-id="newB"]'); return el && el.dataset.sga && el.previousElementSibling.dataset.id === 'c1'; }), 'and they show in place');
  ok(await ev(() => window.__draft.S.ep.blocks.length) === 5, 'the text model is untouched by the merge');

  // 14. reader: read-only, no toggle, no buttons; the editor is not editable even if the mode was on
  await menu('#mSuggest');
  await role('reader', 'Читатель');
  ok(await ev(() => document.getElementById('mSuggest').hidden && document.getElementById('editor').getAttribute('contenteditable') === 'false'), 'reader: toggle hidden, editor read-only');
  ok(await ev(() => document.querySelectorAll('#pane-suggest [data-sgok], #pane-suggest [data-sgno], #sgToggle').length) === 0 && await ev(() => document.querySelectorAll('#pane-suggest .sgi').length) === 4, 'reader sees the list without buttons');
  ok(await ev(() => window.__draft.sgDecide(null, true)) === false && (await st()).sugs.length === 4, 'reader cannot accept');

  // 15. producer: cannot edit the text, but in the mode can suggest
  await role('producer', 'Продюсер П');
  ok(await ev(() => document.getElementById('editor').getAttribute('contenteditable')) === 'true', 'producer in the mode: editor editable (for suggestions)');
  await caret('a1', 0); await p.keyboard.type('Утро. '); await p.waitForTimeout(300);
  s = await st(); ok(s.sugs.includes('ins:Утро. :Продюсер П') && s.x[1] === 'Лена жарит сырники.', 'producer\'s typing is a suggestion', s.sugs);
  await menu('#mSuggest');
  ok(await ev(() => document.getElementById('editor').getAttribute('contenteditable')) === 'false', 'producer outside the mode: read-only as before');
  await ev(() => window.__draft.sgDecide(null, true)); await p.waitForTimeout(300);
  s = await st();
  ok(s.sugs.length === 0 && s.x[1] === 'Утро. Лена жарит сырники.' && s.x.join('|') === 'ИНТ. КУХНЯ - ДЕНЬ|Утро. Лена жарит сырники.|ЛЕНА|(зло)|Иди скорее завтракать.|Ну, Х не идёт.', 'producer accepts all', s.x);

  // 16. an old project without the new fields loads and renders
  await ev(() => { const d = window.__draft, S = d.S; delete S.ep.sugs; delete S.ep.sugGone; d.renderEditor(); d.recompute(); });
  ok(await ev(() => document.querySelectorAll('#editor .sg, #editor [data-sga]').length) === 0 && await p.locator('#sgInfo').isHidden(), 'no suggestions: plain editor, no indicator');
  ok(errs.length === 0, 'no page errors', errs);
  console.log(fails ? fails + ' FAILED of ' + n : 'all ' + n + ' passed');
  await b.close(); process.exit(fails ? 1 : 0);
})();
