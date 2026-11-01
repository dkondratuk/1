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
console.log('test_format: ' + n + ' checks passed');
