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
console.log('test_editor: ok');
