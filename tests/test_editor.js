// Editor group: core checks (charName and an unbracketed ПРОД)
const assert = require('assert');
require('../app/core.js');
const C = globalThis.Core;
assert.strictEqual(C.charName('ИВАН ПРОД.'), 'ИВАН');
assert.strictEqual(C.charName('ЛЕНА ПРОД'), 'ЛЕНА');
assert.strictEqual(C.charName('лена прод.'), 'ЛЕНА');
assert.strictEqual(C.charName("IVAN CONT'D"), 'IVAN');
assert.strictEqual(C.charName('ИВАН (ПРОД.)'), 'ИВАН');
assert.strictEqual(C.charName('ИВАН (ЗК) (ПРОД.)'), 'ИВАН');
assert.strictEqual(C.charName('ДЕД ПРОДАВЕЦ'), 'ДЕД ПРОДАВЕЦ');
assert.strictEqual(C.charName('ПРОДЮСЕР'), 'ПРОДЮСЕР');
assert.strictEqual(C.charName('ИВАН ПЕТРОВИЧ'), 'ИВАН ПЕТРОВИЧ');
// find and replace (Правка → «Найти и заменить…»)
{
  const bl = [{ id: 'a', t: 'scene', x: 'инт. кухня ивана - день' }, { id: 'b', t: 'character', x: 'Иван' }, { id: 'c', t: 'dialogue', x: 'Иван, Иванович и ИВАН. Ёлка, ёлка.' }, { id: 'd', t: 'scene', x: 'УДАЛЕНА' }, { id: 'e', t: 'action', x: 'Сын иван-царевич.' }];
  const at = (q, o) => C.findMatches(bl, q, o).map((m) => m.id + m.start);
  assert.deepStrictEqual(at('иван'), ['a11', 'b0', 'c0', 'c6', 'c17', 'e4'], 'any case, headings and cues as printed');
  assert.deepStrictEqual(at('иван', { word: true }), ['b0', 'c0', 'c17', 'e4'], 'whole word: Cyrillic letters are word characters, a hyphen is not');
  assert.deepStrictEqual(at('Иван', { matchCase: true }), ['c0', 'c6'], 'match case: a cue typed «Иван» is printed «ИВАН»');
  assert.deepStrictEqual(at('ИВАН', { matchCase: true, types: ['character'] }), ['b0'], 'element filter');
  assert.deepStrictEqual(at('ёлка'), ['c23', 'c29']);
  assert.deepStrictEqual(at('удалена'), [], 'an omitted scene placeholder is not text');
  assert.deepStrictEqual(at('a.b'), [], 'the query is literal text');
  const r = C.replaceMatches(bl, 'иван', 'Пётр', { word: true });
  assert.strictEqual(r.count, 4);
  assert.deepStrictEqual(r.blocks.map((b) => b.x), ['инт. кухня ивана - день', 'Пётр', 'Пётр, Иванович и Пётр. Ёлка, ёлка.', 'УДАЛЕНА', 'Сын Пётр-царевич.']);
  assert.ok(r.blocks[0] === bl[0] && bl[1].x === 'Иван', 'unchanged blocks are shared, the source is not touched');
  const one = C.replaceMatches(bl, 'иван', 'X', {}, { i: 2, start: 17 });
  assert.deepStrictEqual([one.count, one.blocks[2].x], [1, 'Иван, Иванович и X. Ёлка, ёлка.']);
  assert.strictEqual(C.replaceMatches(bl, '', 'X', {}).count, 0);
}

// suggestions (Правка → «Режим предложений»): records beside the text; the text model holds accepted text only
{
  const bl = [{ id: 'a', t: 'action', x: 'Иван входит в комнату.' }, { id: 'b', t: 'character', x: 'ИВАН' }, { id: 'c', t: 'dialogue', x: 'Привет.' }];
  let k = 0; const o = (by, mode) => ({ mode: mode || 'sug', by, at: 100 + k, uid: () => 's' + (++k) });
  const view = (sugs) => C.sgView(bl, sugs).items;
  // typing over «входит » = strike + insert, caret after the insertion
  let r = C.sgEdit(view([])[0].segs, 5, 12, 'вбегает ', o('Лена'));
  assert.deepStrictEqual(r.segs.map((g) => g.k + g.x), ['=Иван ', '-входит ', '+вбегает ', '=в комнату.']);
  assert.strictEqual(r.caret, 20);
  let ser = C.sgSerialize([{ b: bl[0], segs: r.segs }, { b: bl[1], segs: null }, { b: bl[2], segs: null }]);
  assert.deepStrictEqual(ser.blocks.map((b) => b.x), bl.map((b) => b.x), 'serialized text model = accepted text');
  assert.ok(ser.blocks[0] === bl[0], 'unchanged blocks are shared');
  assert.deepStrictEqual(ser.sugs.map((s) => [s.k, s.off, s.x, s.by]), [['del', 5, 'входит ', 'Лена'], ['ins', 12, 'вбегает ', 'Лена']]);
  assert.strictEqual(ser.sugs[1].ctx, 'Иван входит ', 'ctx: the accepted text before the insertion');
  // the list shows a replacement as one entry; accept / reject
  const list = C.sgList(bl, ser.sugs);
  assert.deepStrictEqual(list.map((e) => [e.k, e.old, e.x, e.ids.length, e.bi]), [['rep', 'входит ', 'вбегает ', 2, 0]]);
  let res = C.sgResolve(bl, ser.sugs, null, true);
  assert.deepStrictEqual([res.blocks[0].x, res.sugs.length, res.n], ['Иван вбегает в комнату.', 0, 2]);
  res = C.sgResolve(bl, ser.sugs, null, false);
  assert.deepStrictEqual([res.blocks[0].x, res.sugs.length], ['Иван входит в комнату.', 0]);
  res = C.sgResolve(bl, ser.sugs, [ser.sugs[0].id], true);
  assert.deepStrictEqual([res.blocks[0].x, res.sugs.map((s) => s.k + s.off)], ['Иван в комнату.', ['ins5']], 'accept only the deletion: the insertion moves with the text');
  // Backspace in the mode: struck, caret before it; the next one extends the same deletion; own insertion just shrinks
  const segs0 = view([])[2].segs;
  let b1 = C.sgEdit(segs0, 6, 7, '', Object.assign(o('Лена'), { back: true }));
  assert.deepStrictEqual([b1.segs.map((g) => g.k + g.x), b1.caret], [['=Привет', '-.'], 6]);
  let b2 = C.sgEdit(b1.segs, 5, 6, '', Object.assign(o('Лена'), { back: true }));
  assert.deepStrictEqual(b2.segs.map((g) => g.k + g.x + (g.id ? '#' + g.id : '')), ['=Приве', '-т.#' + b1.segs[1].id], 'adjacent own deletion is one record');
  let t1 = C.sgEdit(segs0, 7, 7, ' Как дела?', o('Лена'));
  let t2 = C.sgEdit(t1.segs, 14, 16, '', o('Лена'));
  assert.deepStrictEqual(t2.segs.map((g) => g.k + g.x), ['=Привет.', '+ Как де?'], 'deleting inserted text removes it');
  // typing inside a struck run goes after it; another author's insertion is a separate record
  let t3 = C.sgEdit(b2.segs, 6, 6, '!', o('Лена'));
  assert.deepStrictEqual(t3.segs.map((g) => g.k + g.x), ['=Приве', '-т.', '+!']);
  let t4 = C.sgEdit(t1.segs, 17, 17, ' Ну?', o('Анна'));
  assert.deepStrictEqual(t4.segs.map((g) => g.k + g.x + ':' + g.by), ['=Привет.:undefined', '+ Как дела?:Лена', '+ Ну?:Анна']);
  // outside the mode: an edit changes the text; typing right after an insertion extends it
  let d1 = C.sgEdit(t1.segs, 0, 0, 'Ну, ', o('Ред', 'direct'));
  assert.deepStrictEqual(d1.segs.map((g) => g.k + g.x), ['=Ну, Привет.', '+ Как дела?']);
  let d2 = C.sgEdit(b2.segs, 4, 7, '', o('Ред', 'direct'));
  assert.deepStrictEqual(d2.segs.map((g) => g.k + g.x), ['=Прив'], 'direct delete removes struck text too');
  // Enter inside an accepted element in the mode: tail struck + proposed; outside: a plain split
  const sp = C.sgSplitSug(view([])[0].segs, 5, o('Лена'));
  assert.deepStrictEqual([sp.segs.map((g) => g.k + g.x), sp.tail], [['=Иван ', '-входит в комнату.'], 'входит в комнату.']);
  assert.deepStrictEqual(C.sgSplit(r.segs, 9).map((x) => x.map((g) => g.k + g.x)), [['=Иван ', '-вход'], ['-ит ', '+вбегает ', '=в комнату.']]);
  // whole elements: added after another (chained), proposed for deletion
  const sugs = [
    { id: 'n1', k: 'add', bid: 'N1', after: 'b', t: 'paren', x: '(тихо)', by: 'Лена', at: 1 },
    { id: 'n2', k: 'add', bid: 'N2', after: 'N1', t: 'dialogue', x: 'Эй.', by: 'Лена', at: 2 },
    { id: 'n0', k: 'add', bid: 'N0', after: null, t: 'scene', x: 'НАТ. ДВОР - ДЕНЬ', by: 'Анна', at: 3 },
    { id: 'r1', k: 'rm', bid: 'c', by: 'Анна', at: 4 },
  ];
  const v = C.sgView(bl, sugs);
  assert.deepStrictEqual(v.items.map((it) => it.b.id + (it.add ? '+' : '') + (it.rm ? '-' : '')), ['N0+', 'a', 'b', 'N1+', 'N2+', 'c-']);
  assert.deepStrictEqual(C.sgSerialize(v.items).sugs.map((s) => s.k + ':' + s.bid + ':' + (s.after === undefined ? '' : s.after)), ['add:N0:null', 'add:N1:b', 'add:N2:N1', 'rm:c:']);
  assert.deepStrictEqual(C.sgList(bl, sugs).map((e) => e.k + e.bi), ['add-1', 'add1', 'add1', 'rm2']);
  let acc = C.sgResolve(bl, sugs, ['n1', 'r1'], true);
  assert.deepStrictEqual(acc.blocks.map((b) => b.id), ['a', 'b', 'N1'], 'accepted element joins the text, deleted one goes');
  assert.deepStrictEqual(acc.sugs.map((s) => s.id + ':' + s.after), ['n0:null', 'n2:N1']);
  let rej = C.sgResolve(bl, sugs, ['n1'], false);
  assert.deepStrictEqual(rej.sugs.find((s) => s.id === 'n2').after, 'b', 'rejecting an element re-anchors the one proposed after it');
  // the place is found again when the text changed under a suggestion; what no longer fits is dropped
  const moved = [{ id: 'a', t: 'action', x: 'Утром Иван входит в комнату.' }];
  const sv = C.sgView(moved, ser.sugs);
  assert.deepStrictEqual(sv.items[0].segs.map((g) => g.k + g.x), ['=Утром Иван ', '-входит ', '+вбегает ', '=в комнату.'], 'struck words and ctx relocate');
  const gone = C.sgView([{ id: 'a', t: 'action', x: 'Совсем другое.' }], ser.sugs.concat([{ id: 'zz', k: 'ins', bid: 'nope', off: 0, x: 'x' }]));
  assert.deepStrictEqual(gone.dropped.sort(), [ser.sugs[0].id, 'zz'].sort());
  // merge of two copies: union by id, minus ids gone on either side
  const e1 = { sugs: [{ id: 'p', k: 'ins', bid: 'a', off: 0, x: 'А', at: 1 }, { id: 'q', k: 'ins', bid: 'a', off: 0, x: 'Б', at: 1 }], sugGone: ['r'] };
  const e2 = { sugs: [{ id: 'p', k: 'ins', bid: 'a', off: 0, x: 'АА', at: 2 }, { id: 'r', k: 'del', bid: 'a', off: 0, x: 'И', at: 1 }, { id: 's', k: 'rm', bid: 'b', at: 1 }], sugGone: ['q'] };
  const m = C.mergeSugs(e1, e2);
  assert.deepStrictEqual(m.sugs.map((s) => s.id + s.x), ['pАА', 'sundefined']);
  assert.deepStrictEqual(m.gone.sort(), ['q', 'r']);
  // gone tracking: ids that disappear are remembered, ids that come back (undo) leave the list
  const ep = {};
  C.sgTrackGone(ep, [{ id: 'x' }, { id: 'y' }], [{ id: 'y' }]);
  assert.deepStrictEqual(ep.sugGone, ['x']);
  C.sgTrackGone(ep, [{ id: 'y' }], [{ id: 'x' }, { id: 'y' }]);
  assert.ok(!ep.sugGone, 'restored id leaves sugGone');
  // the text model ignores suggestions: exports and layout are the same with or without them; history keeps them
  const proj = C.demoProject(), dep = proj.episodes[0];
  const plain = C.exportFDX(dep, proj, C.analyzeEpisode(dep, proj));
  const withSg = Object.assign({}, dep, { sugs: [{ id: 'w', k: 'add', bid: 'W', after: dep.blocks[0].id, t: 'action', x: 'ПРЕДЛОЖЕНО', by: 'Лена', at: 1 }, { id: 'w2', k: 'ins', bid: dep.blocks[0].id, off: 0, x: 'ВСТАВКА', by: 'Лена', at: 1 }] });
  assert.strictEqual(C.exportFDX(withSg, proj, C.analyzeEpisode(withSg, proj)).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, ''), plain.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, ''));
  assert.ok(!/ПРЕДЛОЖЕНО|ВСТАВКА/.test(C.exportFountain(withSg, proj, C.analyzeEpisode(withSg, proj))));
  assert.strictEqual(C.analyzeEpisode(withSg, proj).pages, C.analyzeEpisode(dep, proj).pages);
  const hl = [];
  C.histPush(hl, { id: 'h1', date: 1, blocks: dep.blocks, sugs: withSg.sugs, sig: 'a' });
  C.histPush(hl, { id: 'h2', date: 2, blocks: dep.blocks, sugs: [], sig: 'b' });
  assert.deepStrictEqual(C.histState(hl, 0).sugs.map((s) => s.id), ['w', 'w2'], 'history snapshots keep suggestions');
  assert.strictEqual(C.sgSig([]), '', 'no suggestions: same signature as before');
}
console.log('test_editor: ok');
