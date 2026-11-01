// Format group: Final Draft geometry and pagination rules (keep-with-next, MORE/CONT'D, sentence breaks, 2-line splits)
const assert = require('assert');
require('../app/core.js'); const C = globalThis.Core;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const A = (k, end) => ({ t: 'action', x: Array.from({ length: k }, (_, j) => 'Стр' + j + ' ' + 'ж'.repeat(50) + (end || '')).join(' ') });
const D = (k, end) => ({ t: 'dialogue', x: Array.from({ length: k }, (_, j) => 'слово' + j + ' ' + 'д'.repeat(25) + (end || '')).join(' ') });
const sc = (x) => ({ t: 'scene', x }), ch = (x) => ({ t: 'character', x }), pa = (x) => ({ t: 'paren', x });
const P = (bl, lines) => C.paginate(bl, { lines: lines || 54 });
const used = (pg) => pg.items.reduce((a, it) => a + it.sb + it.lines.length + (it.more ? 1 : 0), 0);
const SENT = /[.!?…]['"»”)]*$/;
// rules every layout must keep
function check(r, blocks, tag) {
  r.pages.forEach((pg, k) => {
    ok(used(pg) <= r.lpp, tag + ': page ' + (k + 1) + ' overflows');
    const last = pg.items[pg.items.length - 1], nx = r.pages[k + 1];
    if (!nx || !last) return;
    ok(!['scene', 'character', 'paren'].includes(last.t), tag + ': page ' + (k + 1) + ' ends on ' + last.t);
    const first = nx.items[0];
    ok(first.t !== 'dialogue' && first.t !== 'paren', tag + ': page ' + (k + 2) + ' starts with ' + first.t + ' and no cue');
    if (first.contd) ok(last.t === 'dialogue' && last.more, tag + ': (ПРОД.) on page ' + (k + 2) + ' without (ДАЛЬШЕ)');
    if (last.more) ok(first.contd, tag + ': (ДАЛЬШЕ) without (ПРОД.)');
    // a block broken over the page: at least 2 lines each side, at a sentence end
    const cont = nx.items.find((it) => !it.contd);
    if (cont && cont.i === last.i && (last.t === 'action' || last.t === 'dialogue') && r.info[last.i].L <= r.lpp - 2) {
      ok(last.lines.length >= 2 && cont.lines.length >= 2, tag + ': split leaves fewer than 2 lines');
      ok(SENT.test(last.lines[last.lines.length - 1]), tag + ': split not at a sentence end: ' + last.lines[last.lines.length - 1]);
    }
  });
}

// 1. scene heading never alone at the bottom of a page
let r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(47), sc('НАТ. ДВОР - НОЧЬ'), A(2)]);
ok(r.pages.length === 2 && r.pages[1].items[0].t === 'scene' && r.pages[1].items[0].i === 2 && r.breaks[2].page === 2, 'heading moves with its action');
check(r, null, 'scene+action');
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(47), sc('НАТ. ДВОР - НОЧЬ'), ch('Иван'), { t: 'dialogue', x: 'Привет.' }]);
ok(r.pages[1].items.map((it) => it.t).join() === 'scene,character,dialogue', 'heading moves with the cue');
check(r, null, 'scene+cue');

// 2. speech broken between its parts: (ДАЛЬШЕ) and ИВАН (ЗК) (ПРОД.), parenthetical stays with its dialogue
for (const k of [45, 46, 47]) {
  r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(k), ch('Иван (ЗК)'), D(2), pa('(пауза)'), D(3)]);
  const p1 = r.pages[0].items, p2 = r.pages[1].items;
  ok(p1[p1.length - 1].t === 'dialogue' && p1[p1.length - 1].more, 'action ' + k + ': (ДАЛЬШЕ) under the dialogue');
  ok(p2[0].contd && p2[0].lines[0] === 'ИВАН (ЗК) (ПРОД.)' && p2[1].t === 'paren', 'action ' + k + ': cue with extension and (ПРОД.), then the parenthetical');
  ok(r.breaks[4] && r.breaks[4].page === 2, 'action ' + k + ': screen marker before the parenthetical');
  check(r, null, 'speech ' + k);
}
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(48), ch('Иван'), D(2), pa('(пауза)'), D(3)]);
ok(r.pages[1].items[0].t === 'character' && !r.pages[1].items[0].contd, 'full page: the whole speech moves with its cue');
check(r, null, 'speech 48');
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(47), ch('Иван'), D(3, '.'), pa('(пауза)'), D(3)]);
check(r, null, 'paren at bottom');
// a cue typed with (ПРОД.) is not doubled
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(10), ch('Иван (ЗК) (ПРОД.)'), D(130, '.')]);
ok(r.pages.slice(1).every((pg) => pg.items[0].lines[0] === 'ИВАН (ЗК) (ПРОД.)'), 'extension kept, (ПРОД.) once');
check(r, null, 'long speech');

// 3. 2 lines on each side: one line over the page splits a line earlier
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(42, '.'), A(10, '.')]);
ok(r.pages.length === 2 && r.pages[0].items[2].lines.length === 8 && r.pages[1].items[0].lines.length === 2, '8/2 split, not a whole move');
ok(Math.abs(r.total - (1 + 2 / 54)) < 1e-9, 'page count');

// 4. dialogue and action break at sentence ends
const long = 'Это первая короткая фраза. А вот вторая, она длиннее и уходит на следующую строку страницы и дальше вниз. Третье короткое. ';
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), ...Array.from({ length: 22 }, () => ({ t: 'action', x: 'Одна строка.' })), ch('Иван'), { t: 'dialogue', x: long.repeat(4) }]);
check(r, null, 'sentences');
const head = r.pages[0].items[r.pages[0].items.length - 1];
ok(head.t === 'dialogue' && head.more && SENT.test(head.lines[head.lines.length - 1]), 'dialogue head ends a sentence');
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(40), A(20)]);
ok(r.pages[1].items[0].i === 2 && r.pages[1].items[0].lines.length === 20, 'no sentence end: the action moves whole');

// 5. page breaks inside a block are recorded at their line, also for pages inside a block taller than a page
r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(10, '.'), A(130, '.'), { t: 'action', x: 'Конец.' }]);
ok(r.pages.length === 3 && !r.breaks[2] && r.inner[2].map((b) => b.page).join() === '2,3', 'inner breaks for pages 2 and 3');
ok(r.inner[2][0].line === r.pages[0].items[2].lines.length, 'first inner break after the lines on page 1');
check(r, null, 'tall action');

// fuzz: random scripts keep every rule
let seed = 7; const rnd = (m) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % m; };
const words = ['дом', 'окно', 'сказал', 'медленно', 'по-доброму', 'что-то', 'Мария-Антуанетта', 'идёт', 'смотрит', 'вдаль', 'и', 'кофе'];
const sent = () => { const w = []; for (let k = 3 + rnd(12); k; k--) w.push(words[rnd(words.length)]); return w.join(' ') + ['.', '!', '?', '…'][rnd(4)]; };
const para = (k) => Array.from({ length: k }, sent).join(' ');
for (let s = 0; s < 150; s++) {
  const bl = [];
  for (let q = 0; q < 40; q++) {
    const kind = rnd(10);
    if (kind < 2) bl.push(sc('ИНТ. ДОМ ' + q + ' - ДЕНЬ'));
    else if (kind < 5) bl.push({ t: 'action', x: para(1 + rnd(8)) });
    else if (kind < 9) { bl.push(ch(['Иван', 'Мария (ЗК)', 'Пётр (ПО ТЕЛЕФОНУ)'][rnd(3)])); for (let z = rnd(3); z >= 0; z--) { if (rnd(3) === 0) bl.push(pa('(' + sent().slice(0, -1) + ')')); bl.push({ t: 'dialogue', x: para(1 + rnd(6)) }); } }
    else bl.push({ t: 'transition', x: 'СМЕНА КАДРА:' });
  }
  check(P(bl, [54, 58, 30][s % 3]), bl, 'fuzz ' + s);
}

// 6. Final Draft geometry (FD 11/13 FDX ElementSettings); the «американка» keeps its own
const F = C.FMT, g = (f) => [f.indent, +(f.right ? f.edge : f.indent + f.width / 10).toFixed(2)].join('/');
ok(g(F.scene) === '1.5/7.5' && g(F.action) === '1.5/7.5' && g(F.character) === '3.5/7.25' && g(F.paren) === '3/5.5' && g(F.dialogue) === '2.5/6' && g(F.transition) === '5.5/7.1', 'FMT geometry');
ok(C.PAPER.a4.fmt === F && C.PAPER.a4ru.fmt === C.FMT_RU && Math.abs(C.FMT_RU.character.indent - 10.5 / 2.54) < 1e-9 && C.FMT_RU.transition.width === 23, 'A4 shares FMT, a4ru unchanged');
const p = C.demoProject(), ep = p.episodes[0], fdx = C.exportFDX(ep, p, C.analyzeEpisode(ep, p), {});
ok(/Type="Character">.*LeftIndent="3\.50" RightIndent="7\.25"/.test(fdx) && /Type="Parenthetical">.*LeftIndent="3\.00" RightIndent="5\.50"/.test(fdx) && /Type="Transition">.*Alignment="Right".*LeftIndent="5\.50" RightIndent="7\.10"/.test(fdx), 'FDX ElementSettings');

// 7. wrap breaks after a hyphen inside a word, like the browser and Final Draft
assert.deepStrictEqual(C.wrap('(смотрит на Марию-Антуанетту, по-доброму)', 25), ['(смотрит на Марию-', 'Антуанетту, по-доброму)']); n++;
assert.deepStrictEqual(C.wrap('ааааа бббб-вввв', 12), ['ааааа бббб-', 'вввв']); n++;
assert.deepStrictEqual(C.wrap('ааааааа 1990-2000', 12), ['ааааааа', '1990-2000']); n++;
ok(C.wrap('Ж'.repeat(60), 60).length === 1 && C.wrap('Ж'.repeat(37) + ' Ж', 37.5).length === 2, 'width limits');
// 8. scene length in eighths: a live scene is never shorter than 1/8, an omitted scene has none
ok(C.fmtScenePages({ pages: 0.0556 }) === '1/8' && C.fmtScenePages({ pages: 0 }) === '1/8' && C.fmtScenePages({ pages: 1.5 }) === '1 4/8', 'scene length minimum 1/8');
ok(C.fmtScenePages({ pages: 0.04, omitted: true }) === '0' && C.sceneEighths({ pages: 0.3, omitted: true }) === 0, 'omitted scene has no length');
ok(C.fmtEighths([0.0556, 0.09, 0.0954].reduce((a, x) => a + C.sceneEighths({ pages: x }), 0)) === '3/8', 'sum of three short scenes is 3/8');
{
  const pe = { number: 1, blocks: [{ id: 'h1', t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { id: 'a1', t: 'action', x: 'Тишина.' }, { id: 'h2', t: 'scene', x: 'ИНТ. ДВОР - ДЕНЬ' }, { id: 'a2', t: 'action', x: 'Шум.' }], sceneMeta: {} };
  const pp = { name: 'X', rules: {}, chars: {}, locs: {}, episodes: [pe] }, pst = C.analyzeEpisode(pe, pp);
  ok(pst.scenes.every((x) => Math.round(x.pages * 8) <= 1) && C.fmtPages(pst.scenes[0].pages) === '0', 'tiny scenes round to 0 or 1');
  ok((C.exportFDX(pe, pp, pst, {}).match(/Length="1\/8"/g) || []).length === 2, 'FDX Length of a tiny scene is 1/8');
}

// 9. dual dialogue (Final Draft Format → Dual Dialogue): two columns on one page, never split, timing by the longer column
{
  const DF = C.dualFmt(C.FMT);
  ok(DF[0].dialogue.indent === 1.5 && DF[1].dialogue.indent === 4.5 && DF[0].dialogue.width === 27 && DF[0].character.indent === 2.5 && DF[1].character.indent === 5.5 && DF[1].paren.indent === 5.0, 'FD dual columns ' + JSON.stringify(DF));
  ok(DF[1].dialogue.indent + DF[1].dialogue.width / 10 <= 7.5, 'right column inside the right margin');
  const RU = C.dualFmt(C.FMT_RU);
  ok(Math.abs(RU[1].dialogue.indent - (C.FMT_RU.action.indent + 3.15)) < 1e-9 && RU[0].dialogue.width === 28.5, 'A4 «американка» columns split its own text width');
  const pair = () => [ch('Петя'), D(2), { t: 'character', x: 'Маша', dual: true }, pa('(одновременно)'), { t: 'dialogue', x: 'Нет, я!' }];
  ok(JSON.stringify(C.dualPairs([sc('ИНТ. А - ДЕНЬ')].concat(pair()))) === JSON.stringify([{ a: 1, b: 3, e: 5 }]), 'pair found: ' + JSON.stringify(C.dualPairs([sc('ИНТ. А - ДЕНЬ')].concat(pair()))));
  ok(C.dualPairs([sc('ИНТ. А - ДЕНЬ'), { t: 'character', x: 'Маша', dual: true }, { t: 'dialogue', x: 'Да.' }]).length === 0, 'a dual cue with no speech before it is an ordinary speech');
  ok(C.dualPairs([sc('ИНТ. А - ДЕНЬ'), { t: 'action', x: 'Шум.' }, { t: 'character', x: 'Маша', dual: true }, { t: 'dialogue', x: 'Да.' }]).length === 0, 'action between the speeches: no pair');
  ok(C.dualPairs([ch('А'), D(1), { t: 'character', x: 'Б', dual: true }, D(1), { t: 'character', x: 'В', dual: true }, D(1)]).length === 1, 'no third speech in a pair');
  r = P([sc('ИНТ. КУХНЯ - ДЕНЬ')].concat(pair(), [{ t: 'action', x: 'Тишина.' }]));
  const its = r.pages[0].items, L = its.filter((it) => it.dual && it.dual.col === 0), R = its.filter((it) => it.dual && it.dual.col === 1);
  ok(L.map((it) => it.t).join() === 'character,dialogue' && R.map((it) => it.t).join() === 'character,paren,dialogue', 'left and right columns');
  ok(R[0].dual.row === 0 && R[1].dual.row === 1 && L[1].dual.row === 1 && L[0].dualH === Math.max(1 + L[1].lines.length, 3), 'rows inside the columns, pair height on the first item');
  ok(L[1].lines.every((l) => l.length <= 27) && L[1].lines.length > C.wrap(D(2).x, 35).length, 'dialogue wraps at the column width, not 35');
  const usedD = (pg) => pg.items.reduce((a, it) => a + (it.dual ? (it.dualH != null ? it.sb + it.dualH : 0) : it.sb + it.lines.length) + (it.more ? 1 : 0), 0);
  ok(Math.abs(r.total * 54 - usedD(r.pages[0])) < 1e-9 && usedD(r.pages[0]) === 1 + 1 + L[0].dualH + 1 + 1, 'page fill counts the pair once: ' + r.total * 54);
  const seq = P([sc('ИНТ. КУХНЯ - ДЕНЬ')].concat(pair().map((b) => Object.assign({}, b, { dual: false })), [{ t: 'action', x: 'Тишина.' }]));
  ok(seq.total > r.total, 'side by side is shorter than one after the other');
  // at the bottom of a page the pair moves whole to the next page, its heading with it
  for (const k of [46, 47, 48, 49]) {
    r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(k), sc('НАТ. ДВОР - НОЧЬ')].concat(pair()));
    const pairPg = r.pages.findIndex((pg) => pg.items.some((it) => it.dual)), headPg = r.pages.findIndex((pg) => pg.items.some((it) => it.i === 2));
    ok(pairPg === headPg && (k < 48 || pairPg === 1), 'action ' + k + ': heading goes with the pair (page ' + headPg + ' / ' + pairPg + ')');
    ok(r.pages.every((pg) => usedD(pg) <= 54), 'action ' + k + ': no overflow');
    const where = new Set(r.pages.map((pg, q) => pg.items.some((it) => it.dual) ? q : -1).filter((q) => q >= 0));
    ok(where.size === 1, 'action ' + k + ': the pair is on one page');
    ok(!r.pages.some((pg) => pg.items.some((it) => it.more || it.contd)), 'action ' + k + ': no (ДАЛЬШЕ)/(ПРОД.) inside a pair');
  }
  // a pair taller than a page is laid out one speech after the other
  r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), ch('Петя'), D(30, '.'), { t: 'character', x: 'Маша', dual: true }, D(30, '.')]);
  ok(!r.duals.length && !r.pages.some((pg) => pg.items.some((it) => it.dual)), 'a pair taller than a page is not dual');
  // timing: the scene's share of the episode counts the pair once
  const ep = { number: 1, sceneMeta: {}, blocks: [sc('ИНТ. КУХНЯ - ДЕНЬ')].concat(pair(), [sc('ИНТ. ДВОР - ДЕНЬ'), { t: 'action', x: 'Шум.' }]).map((b, k) => Object.assign({ id: 'd' + k }, b)) };
  const st = C.analyzeEpisode(ep, { name: 'X', rules: {}, chars: {}, locs: {}, episodes: [ep] });
  ok(Math.abs(st.scenes[0].lines - (1 + 1 + C.paginate(ep.blocks, {}).duals[0].h)) < 1e-9, 'scene lines count the pair at its height: ' + st.scenes[0].lines);
  ok(Math.abs(st.scenes.reduce((a, x) => a + x.pages, 0) - st.pages) < 1e-9, 'scene pages add up to the episode');
  // a page lock taken with a pair keeps it whole
  const lay = C.paginate(ep.blocks, {}), lock = C.pageLockFrom(lay, ep.blocks);
  const r2 = C.paginate(ep.blocks, { pageLock: lock });
  ok(r2.pages.length === 1 && r2.duals.length === 1 && r2.labels[0] === '1', 'page lock with a pair');
  // drafts: switching dual dialogue on marks the cue as changed
  const rev = C.newRevision(0, ep.blocks.map((b) => Object.assign({}, b, { dual: false })), 'т');
  const marks = C.revMarks(ep.blocks, [rev]);
  ok(marks[3] === 1 && marks.filter(Boolean).length === 1, 'dual switched on is a revision of the cue: ' + marks.join());
  ok(C.revMarks(ep.blocks, [C.newRevision(0, ep.blocks, 'т')]).every((m) => !m), 'a base taken with the flag: no marks');
}
// 10. Final Draft Shot (Кадр): action column, capitals, one blank line before; never left alone at the bottom of a page
{
  ok(C.TYPES[6] === 'shot' && C.TYPES.slice(0, 6).join() === 'scene,action,character,paren,dialogue,transition' && C.TYPE_LABEL.shot === 'Кадр', 'shot is Ctrl+7, Ctrl+1…6 unchanged');
  ok(C.FMT.shot.indent === 1.5 && C.FMT.shot.width === 60 && C.FMT.shot.sb === 1 && C.FMT_RU.shot.width === 63, 'shot geometry');
  ok(C.displayText({ t: 'shot', x: 'крупно — лицо' }) === 'КРУПНО — ЛИЦО', 'shot in capitals');
  r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), A(49), { t: 'shot', x: 'Крупно — чашка' }, A(3)]);
  ok(r.pages[1].items[0].t === 'shot', 'a shot goes to the next page with its action');
  r = P([sc('ИНТ. КУХНЯ - ДЕНЬ'), { t: 'shot', x: 'Крупно' }, { t: 'action', x: 'Чашка.' }]);
  ok(r.pages[0].items[1].sb === 1 && r.pages[0].items[1].lines[0] === 'КРУПНО', 'shot: one blank line before');
}
console.log('test_format: ' + n + ' checks passed');
