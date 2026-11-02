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

console.log('test_editor: ok');
