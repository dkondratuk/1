// Final Draft basics, core: text styles (bold / italic / underline in block.st beside the plain block.x), forced page breaks,
// automatic (ПРОД.), scene colours, SmartType upkeep; their .fdx / Fountain / Word round trips (node tests/test_basics.js)
const assert = require('assert');
require('../app/core.js'); const C = globalThis.Core;
const { DOMParser } = require('@xmldom/xmldom');
let n = 0;
const ok = (name, f) => { try { f(); n++; } catch (e) { console.log('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
// blocks are written and compared as Fountain markup for brevity (B parses it, tx writes it; a literal * comes out as \*)
const tx = (blocks) => blocks.map((b) => b.t + '|' + C.blockMarkup(b));
const proj = () => ({ name: 'X', rules: Object.assign({}, C.DEFAULT_RULES), chars: {}, locs: {}, episodes: [] });
const fin = (blocks, p) => C.finalizeImport(blocks, p || proj());
const fdx = (paras) => '<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content>' + paras + '</Content></FinalDraft>';
const B = (t, m, more) => C.blockFromMarkup(t, m, more);
const M = (m) => C.fromMarkup(m);
const W = (d) => C.toMarkup(d.text, d.st);

// 1. the model: plain x + st runs; Fountain markup only at the border (parse, write, round trips); the edits that keep styles
ok('styles beside the text, Fountain markup at the border', () => {
  const b = B('action', 'Маша **смотрит** в _окно_ и *ждёт* ***чуда***.');
  assert.strictEqual(b.x, 'Маша смотрит в окно и ждёт чуда.', 'block.x is the plain text');
  assert.deepStrictEqual(b.st, [[5, 12, C.ST_B], [15, 19, C.ST_U], [22, 26, C.ST_I], [27, 31, C.ST_B | C.ST_I]], 'block.st holds the runs');
  assert.strictEqual(C.blockMarkup(b), 'Маша **смотрит** в _окно_ и *ждёт* ***чуда***.');
  assert.strictEqual(C.fromMarkup('_**x**_').text, 'x');
  assert.strictEqual(C.toMarkup('x', [C.ST_B | C.ST_U]), '_**x**_', 'underline outermost');
  assert.strictEqual(C.blockFromMarkup('action', 'plain').st, undefined, 'no st on a plain block');
  assert.strictEqual(C.stOf({ x: 'abc' }), null); assert.strictEqual(C.stOf({ x: 'abc', st: [[5, 9, 1]] }), null, 'a run outside the text is ignored');
  // markers next to a space, without a pair, in a run of four, in «5*3» are text in a Fountain file
  for (const s of ['a * b * c', '5*3=15', '**a', '****x****', 'a ** b']) { assert.strictEqual(C.fromMarkup(s).text, s); assert.strictEqual(C.fromMarkup(s).st, null); }
  // touching runs survive: [bold][bold italic], [italic][bold], [underline][underline bold]
  for (const s of ['**a*****b***', '*a***b**', '_a__**b**_', '***a****b*']) { const q = C.fromMarkup(s); assert.strictEqual(q.text, 'ab', s); assert.strictEqual(W(q), s, s); }
});
ok('a literal * or _ is a character, never a style', () => {
  // Fountain's escape: a literal marker is written escaped and read back as itself
  for (const x of ['2*3*4', 'foo*', 'a**b', 'x_y', 'сноска **а', '*', '**', '_подпись_', 'C:\\dir', 'a\\*b', 'Он шепчет *тихо* и всё']) {
    assert.strictEqual(C.fromMarkup(C.toMarkup(x, null)).text, x, 'plain ' + x);
    const st = C.stOf({ x, st: [[0, x.length, C.ST_B]] }), m = C.toMarkup(x, st), q = C.fromMarkup(m);
    assert.deepStrictEqual([q.text, q.st], [x, st], 'bold ' + x + ' as ' + m);
    const st2 = C.stOf({ x, st: [[1, x.length, C.ST_I]] }), q2 = C.fromMarkup(C.toMarkup(x, st2));
    assert.deepStrictEqual([q2.text, q2.st], [x, st2], 'italic from 1 ' + x);
    const st3 = C.stOf({ x, st: [[0, x.length, C.ST_U]] }), q3 = C.fromMarkup(C.toMarkup(x, st3));
    assert.deepStrictEqual([q3.text, q3.st], [x, st3], 'underline ' + x);
  }
  assert.strictEqual(C.toMarkup('x_y', [0, 4, 4]), 'x\\_y', 'an underline inside a word has no Fountain markup (whole words only)');
  assert.strictEqual(C.toMarkup('2*3*4', null), '2\\*3\\*4');
  assert.strictEqual(C.fromMarkup('Звонок \\*телефона\\*').text, 'Звонок *телефона*');
  // a block saved before styles existed (an old project file, IndexedDB): its text shows as it was typed
  const old = { id: 'o', t: 'action', x: 'Звонок *телефона*. Оценка 2*3*4. _подпись_' };
  assert.strictEqual(C.displayText(old), old.x);
  assert.deepStrictEqual(C.displayStyled(old), { text: old.x, st: null });
  assert.deepStrictEqual(C.findMatches([old], '2*3*4').map((m) => [m.start, m.end]), [[26, 31]]);
  assert.ok(C.paginate([old], { lines: 54 }).info[0].lines.join(' ').includes('2*3*4'));
  const x = C.exportFDX({ blocks: [old], sceneMeta: {} }, proj(), C.analyzeEpisode({ blocks: [old], sceneMeta: {} }, proj()), {});
  assert.ok(x.includes('<Text>Звонок *телефона*. Оценка 2*3*4. _подпись_</Text>'), x);
  const f = C.exportFountain({ blocks: [old], sceneMeta: {} }, proj());
  assert.ok(f.includes('Звонок \\*телефона\\*. Оценка 2\\*3\\*4. \\_подпись\\_'), f);
  assert.strictEqual(fin(C.importText(f)).blocks[0].x, old.x, 'and comes back from Fountain as it was');
  // typed or imported as plain text (.txt, PDF), a marker is a character
  assert.deepStrictEqual(fin(C.importText('ИНТ. ДОМ - ДЕНЬ\n\nОн шепчет *тихо* и пишет _подпись_ внизу. 2*3*4.\n')).blocks.map((b) => [b.x, b.st]), [['ИНТ. ДОМ - ДЕНЬ', undefined], ['Он шепчет *тихо* и пишет _подпись_ внизу. 2*3*4.', undefined]]);
  // .fdx: a plain run keeps its asterisks, a styled run keeps its text in order
  const r = fin(C.importFDX(fdx('<Paragraph Type="Action"><Text>Звонок *телефона*. Оценка 2*3*4 … _подпись_</Text></Paragraph><Paragraph Type="Action"><Text Style="Bold">Жирно a**b</Text><Text> и *так*</Text></Paragraph>'), DOMParser));
  assert.deepStrictEqual(r.blocks.map((b) => [b.x, b.st]), [['Звонок *телефона*. Оценка 2*3*4 … _подпись_', undefined], ['Жирно a**b и *так*', [[0, 10, C.ST_B]]]]);
  const x2 = C.exportFDX({ blocks: r.blocks, sceneMeta: {} }, proj(), C.analyzeEpisode({ blocks: r.blocks, sceneMeta: {} }, proj()), {});
  assert.ok(x2.includes('<Text>Звонок *телефона*. Оценка 2*3*4 … _подпись_</Text>') && x2.includes('<Text Style="Bold">Жирно a**b</Text><Text> и *так*</Text>'), x2);
  // Word: the same through runs
  const WN = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = '<?xml version="1.0"?><w:document ' + WN + '><w:body><w:p><w:r><w:t>ИНТ. ДОМ - ДЕНЬ</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Оценка 2*3*4 и </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>a**b</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p><w:p><w:r><w:t>Просто *так* и _так_.</w:t></w:r></w:p></w:body></w:document>';
  const wb = fin(C.classifyLines(C.docxParagraphs(docx, DOMParser, {}))).blocks;
  assert.deepStrictEqual(wb.map((b) => [b.x, b.st]), [['ИНТ. ДОМ - ДЕНЬ', undefined], ['Оценка 2*3*4 и a**b.', [[15, 19, C.ST_B]]], ['Просто *так* и _так_.', undefined]]);
});
ok('toggle, splice, split, join', () => {
  assert.deepStrictEqual(M('ТЕКСТ_ВКЛАДКИ_Б и снейк_кейс_'), { text: 'ТЕКСТ_ВКЛАДКИ_Б и снейк_кейс_', st: null }, 'an underscore inside a word is text');
  assert.deepStrictEqual(M('_это_ и это_нет_ и _то_.'), { text: 'это и это_нет_ и то.', st: [4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0] }, 'underline only around whole words');
  assert.strictEqual(W(C.stToggle(M('Привет мир'), 0, 6, C.ST_B)), '**Привет** мир');
  assert.strictEqual(W(C.stToggle(M('**Привет** мир'), 0, 6, C.ST_B)), 'Привет мир', 'off when all of it has the style');
  assert.strictEqual(W(C.stToggle(M('**Привет** мир'), 0, 10, C.ST_B)), '**Привет мир**', 'on when part of it lacks it');
  assert.strictEqual(W(C.stToggle(M('Ну **и где** он?'), 3, 9, C.ST_I)), 'Ну ***и где*** он?', 'a selected trailing space stays one space');
  assert.strictEqual(W(C.stToggle(M('a b c'), 1, 4, C.ST_U)), 'a _b_ c', 'spaces at the ends go outside the markers');
  assert.strictEqual(W(C.stSplice(M('**bo**ld'), 1, 3, 'XY')), '**bXY**d', 'a replacement takes the style of what it replaces');
  assert.strictEqual(W(C.stSplice(M('**bold** x'), 8, 8, 'Z')), '**bold** xZ');
  assert.strictEqual(W(C.stSplice(M('ab'), 1, 1, M('*i*'))), 'a*i*b', 'a styled insertion keeps its own styles');
  assert.deepStrictEqual(C.stSplit(M('**bold** text'), 2).map(W), ['**bo**', '**ld** text']);
  assert.strictEqual(W(C.stJoin(M('*a*'), M('*b*'))), '*ab*');
  assert.strictEqual(W(C.stJoin(M('**a**'), M('b'))), '**a**b');
  assert.deepStrictEqual(C.wordAt('Привет, мир', 9), [8, 11]);
  assert.strictEqual(C.stStyleAt(M('**ab** c'), 1), C.ST_B);
  assert.deepStrictEqual(C.inlineRuns('x y', [0, 0, C.ST_B | C.ST_I]), [{ x: 'x ', b: false, i: false, u: false }, { x: 'y', b: true, i: true, u: false }]);
  assert.strictEqual(W(C.inlineFromRuns([{ x: 'Hello  ', b: true }, { x: ' world', i: true }, { x: '!' }])), '**Hello** *world*!');
  assert.deepStrictEqual(C.withSt({ x: 'ab' }, [1, 0]), { x: 'ab', st: [[0, 1, 1]] });
  assert.deepStrictEqual(C.withSt({ x: 'ab', st: [[0, 1, 1]] }, null), { x: 'ab' });
});
// 2. the page counts visible characters only; the printed text has no markup
ok('wrap width ignores markup', () => {
  const w = 'слово'.repeat(1), line = Array.from({ length: 12 }, () => w).join(' ');
  const a = C.paginate([B('action', line)], { lines: 54 }), b = C.paginate([B('action', line.replace(/слово слово/, '**слово** _слово_'))], { lines: 54 });
  assert.deepStrictEqual(b.info[0].lines, a.info[0].lines);
  assert.strictEqual(C.displayText(B('action', 'a **b** c')), 'a b c');
  assert.strictEqual(C.displayText({ t: 'character', x: 'маша (зк)', st: [[5, 9, 1]] }), 'МАША (ЗК)');
  assert.deepStrictEqual(C.displayStyled({ t: 'character', x: 'маша (зк)', st: [[5, 9, 1]] }), { text: 'МАША (ЗК)', st: null }, 'a cue is never styled');
  const d = C.displayStyled(B('dialogue', 'a **б** c')); assert.deepStrictEqual([d.text, d.st], ['a б c', [0, 0, C.ST_B, 0, 0]]);
  assert.deepStrictEqual(C.lineRuns('aaa bbb ccc', M('aaa **bbb** ccc').st, C.wrap('aaa bbb ccc', 7)).map((l) => l.map((r) => (r.b ? '<' + r.x + '>' : r.x)).join('')), ['aaa <bbb>', 'ccc']);
  // a heading or a cue parsed from a block with stray st: the analysis sees the plain text only
  const st = C.analyzeEpisode({ blocks: [{ id: 's', t: 'scene', x: 'ИНТ. ДОМ - ДЕНЬ', st: [[5, 8, 1]] }, { id: 'c', t: 'character', x: 'Иван', st: [[0, 4, 1]] }, B('dialogue', 'Да.')], sceneMeta: {} }, proj());
  assert.deepStrictEqual([st.scenes[0].h.object, st.characters.map((c) => c.name)], ['ДОМ', ['ИВАН']]);
});
// 2b. the continued part of a split speech keeps its styles where earlier lines repeat the same words
ok('styles on the continued part of a split speech', () => {
  const filler = Array.from({ length: 50 }, () => B('action', 'Пауза.'));
  const line = 'Нет, нет, нет, нет, нет, нет, нет, нет. ';
  const d = B('dialogue', line.repeat(6) + '**Нет**, нет, нет, нет, нет, нет, нет, нет.');
  const bl = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), ...filler, B('character', 'ИВАН'), d];
  const lay = C.paginate(bl, { lines: 54 });
  const parts = []; lay.pages.forEach((pg) => pg.items.forEach((it) => { if (!it.contd && bl[it.i] === d) parts.push(it); }));
  assert.ok(parts.length === 2, 'split in two: ' + parts.length);
  const ds = C.displayStyled(d), seen = [];
  const runs = parts.map((it) => { const r = C.lineRuns(ds.text, ds.st, seen.concat(it.lines)).slice(seen.length); seen.push(...it.lines); return r; });
  assert.ok(runs[1].some((l) => l.some((r) => r.b && r.x === 'Нет')), 'bold Нет on the second page: ' + JSON.stringify(runs[1]));
  assert.ok(!runs[0].some((l) => l.some((r) => r.b)), 'nothing bold on the first page');
});
// 2c. a forced page break inside a speech: (ДАЛЬШЕ) and NAME (ПРОД.), as a natural split gives
ok('forced page break inside a speech', () => {
  const bl = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('character', 'ИВАН'), B('dialogue', 'Первая реплика.'), B('dialogue', 'Вторая часть.', { pageBreak: true })];
  const lay = C.paginate(bl, { lines: 54 });
  assert.strictEqual(lay.pages.length, 2);
  const p1 = lay.pages[0].items, p2 = lay.pages[1].items;
  assert.strictEqual(p1[p1.length - 1].more, 'ИВАН', '(ДАЛЬШЕ) under the last line of page 1');
  assert.ok(p2[0].contd && p2[0].lines[0] === 'ИВАН (ПРОД.)' && p2[1].i === 3, 'page 2 opens with the cue (ПРОД.)');
  assert.deepStrictEqual(C.pdfLines ? [] : [], []);
  // a break right after the cue: the cue goes along, no (ПРОД.)
  const bl2 = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('action', 'Раз.'), B('character', 'ИВАН'), B('dialogue', 'Реплика.', { pageBreak: true })];
  const l2 = C.paginate(bl2, { lines: 54 });
  assert.deepStrictEqual(l2.pages.map((pg) => pg.items.map((it) => (it.contd ? 'contd' : it.i))), [[0, 1], [2, 3]]);
  // a break on the action right after a heading: the heading goes along too
  const bl3 = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('action', 'Раз.'), B('scene', 'НАТ. ДВОР - ДЕНЬ'), B('action', 'Два.', { pageBreak: true })];
  assert.deepStrictEqual(C.paginate(bl3, { lines: 54 }).pages.map((pg) => pg.items.map((it) => it.i)), [[0, 1], [2, 3]]);
});
// 2d. Fountain: «===» followed by a synopsis or a section still breaks the page before the next element
ok('fountain page break past a synopsis', () => {
  const r = C.importText('.ИНТ. ДОМ - ДЕНЬ\n\nТекст.\n\n===\n\n= синопсис\n\n# Акт 2\n\n.ИНТ. САД - ДЕНЬ\n\nЕщё.\n', { fountain: true });
  assert.deepStrictEqual(r.map((b) => [b.t, !!b.pageBreak]), [['scene', false], ['action', false], ['scene', true], ['action', false]]);
  assert.strictEqual(r[0].synopsis, 'синопсис', 'the synopsis still goes to the scene above');
});
// 3. find, replace, tags, comments anchor to the plain text
ok('find and replace on the plain text', () => {
  const bl = [B('dialogue', 'Иван **видит** Ивана.')];
  assert.deepStrictEqual(C.findMatches(bl, 'видит').map((m) => [m.start, m.end]), [[5, 10]]);
  assert.deepStrictEqual(C.findMatches(bl, 'Иван видит').map((m) => [m.start, m.end]), [[0, 10]], 'a match may cross a style boundary');
  const r = C.replaceMatches(bl, 'видит', 'слышит', {});
  assert.strictEqual(C.blockMarkup(r.blocks[0]), 'Иван **слышит** Ивана.');
  assert.strictEqual(C.replaceMatches(bl, 'видит', '2*2', {}).blocks[0].x, 'Иван 2*2 Ивана.', 'a replacement is text as typed');
  const tags = [{ id: 't', blockId: bl[0].id, quote: 'видит Ивана', cat: 'props', at: 5 }];
  C.anchorTags(bl, tags, null);
  assert.ok(!tags[0].lost && tags[0].at === 5, 'a tag over styled text is found');
});
// 4. automatic (ПРОД.)
ok('automatic continued', () => {
  const bl = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('character', 'МАША'), B('dialogue', 'Раз.'), B('action', 'Пауза.'), B('character', 'Маша'), B('dialogue', 'Два.'),
    B('character', 'ПЕТЯ'), B('dialogue', 'Три.'), B('character', 'МАША'), B('dialogue', 'Четыре.'), B('scene', 'НАТ. ДВОР - ДЕНЬ'), B('character', 'МАША'), B('dialogue', 'Пять.'),
    B('action', 'Тишина.'), B('character', 'МАША (ПРОД.)'), B('dialogue', 'Шесть.'), B('action', 'Ещё.'), B('character', 'МАША', { dual: true }), B('dialogue', 'Семь.')];
  assert.deepStrictEqual([...C.autoContd(bl)], [4], 'again after action: yes; after another speaker, in a new scene, with (ПРОД.) typed, the dual cue: no');
  const lay = C.paginate(bl, { lines: 54 });
  assert.deepStrictEqual(lay.info[4].lines, ['МАША (ПРОД.)']);
  assert.deepStrictEqual(lay.info[1].lines, ['МАША']);
  assert.deepStrictEqual([...lay.contd], [4]);
  assert.deepStrictEqual(C.paginate(bl, { lines: 54, autoContd: false }).info[4].lines, ['МАША'], 'the setting turns it off');
  const p = proj(); p.rules.autoContd = false;
  const st = C.analyzeEpisode({ blocks: bl, sceneMeta: {} }, p); assert.strictEqual(st.lay.contd.size, 0);
  const x = C.exportFDX({ blocks: bl, sceneMeta: {} }, proj(), C.analyzeEpisode({ blocks: bl, sceneMeta: {} }, proj()), {});
  assert.ok(/<Paragraph Type="Character"><Text>МАША \(ПРОД\.\)<\/Text>/.test(x) && (x.match(/МАША \(ПРОД\.\)/g) || []).length === 2, 'written to .fdx as plain extension text (the typed one too)');
  // an imported textual (CONT'D) where ours would print it comes off; one ours would not print stays
  const r = fin(C.importFDX(fdx('<Paragraph Type="Scene Heading"><Text>ИНТ. ДОМ - ДЕНЬ</Text></Paragraph><Paragraph Type="Character"><Text>МАША (CONT\'D)</Text></Paragraph><Paragraph Type="Dialogue"><Text>Раз.</Text></Paragraph><Paragraph Type="Action"><Text>Пауза.</Text></Paragraph><Paragraph Type="Character"><Text>МАША (ПРОД.)</Text></Paragraph><Paragraph Type="Dialogue"><Text>Два.</Text></Paragraph>'), DOMParser));
  assert.deepStrictEqual(tx(r.blocks).filter((t) => /^character/.test(t)), ['character|МАША (ПРОД.)', 'character|МАША']);
});
// 5. forced page breaks
ok('page break before an element', () => {
  const bl = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('action', 'Раз.'), B('action', 'Два.', { pageBreak: true }), B('action', 'Три.')];
  const lay = C.paginate(bl, { lines: 54 });
  assert.strictEqual(lay.pages.length, 2); assert.deepStrictEqual(lay.breaks, { 2: { page: 2 } });
  assert.deepStrictEqual(lay.pages[1].items.map((it) => it.i), [2, 3]);
  assert.strictEqual(C.paginate([B('action', 'Раз.', { pageBreak: true })], { lines: 54 }).pages.length, 1, 'the first element never opens an empty page');
  const ep = { blocks: bl, sceneMeta: {} }, p = proj(), st = C.analyzeEpisode(ep, p);
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(/<Paragraph StartsNewPage="Yes" Type="Action"><Text>Два\./.test(x), 'StartsNewPage="Yes" in .fdx');
  assert.ok(!/StartsNewPage="Yes" Type="Scene/.test(x));
  const back = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(back.blocks.map((b) => !!b.pageBreak), [false, false, true, false], 'read back from .fdx');
  const f = C.exportFountain(ep, p, st);
  assert.ok(/\n===\n\nДва\./.test(f), 'Fountain «===»: ' + f);
  const fb = fin(C.importText(f));
  assert.deepStrictEqual(fb.blocks.map((b) => !!b.pageBreak), [false, false, true, false], 'read back from Fountain');
});
// 6. styles in .fdx, Fountain and Word
ok('styles round trip', () => {
  const bl = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('action', 'Маша **смотрит** в _окно_.'), B('character', 'МАША'), B('paren', '(*тихо*)'), B('dialogue', 'Ну ***и где*** он?')];
  const ep = { blocks: bl, sceneMeta: {} }, p = proj(), st = C.analyzeEpisode(ep, p);
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(x.includes('<Text>Маша </Text><Text Style="Bold">смотрит</Text><Text> в </Text><Text Style="Underline">окно</Text><Text>.</Text>'), x);
  assert.ok(x.includes('<Text Style="Bold+Italic">и где</Text>'));
  const back = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(tx(back.blocks), tx(bl));
  // a heading or a cue styled in Final Draft comes in plain
  const r = fin(C.importFDX(fdx('<Paragraph Type="Scene Heading"><Text Style="Bold">ИНТ. ДОМ - ДЕНЬ</Text></Paragraph><Paragraph Type="Character"><Text Style="Underline">МАША</Text></Paragraph><Paragraph Type="Dialogue"><Text>Да, </Text><Text Style="Italic">нет</Text><Text>.</Text></Paragraph>'), DOMParser));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. ДОМ - ДЕНЬ', 'character|МАША', 'dialogue|Да, *нет*.']);
  // Fountain: the markup as it stands, both ways
  const f = C.exportFountain(ep, p, st);
  assert.ok(f.includes('Маша **смотрит** в _окно_.') && f.includes('Ну ***и где*** он?'), f);
  assert.deepStrictEqual(tx(fin(C.importText(f)).blocks), tx(bl));
  // Word for FilmToolz: runs with <w:b/>, <w:i/>, <w:u/>
  const d = C.docxDocumentXML(ep, p, st);
  assert.ok(d.includes('<w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">смотрит</w:t>') && d.includes('<w:u w:val="single"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">окно</w:t>') && d.includes('<w:b/><w:i/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">и где</w:t>'), d);
  // Word import: a mixed paragraph keeps its runs as markup, a paragraph bold throughout is formatting and comes in plain
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = '<?xml version="1.0"?><w:document ' + W + '><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ИНТ. ДОМ - ДЕНЬ</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Маша </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>смотрит</w:t></w:r><w:r><w:t xml:space="preserve"> в </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>окно</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p></w:body></w:document>';
  const lines = C.docxParagraphs(docx, DOMParser, {});
  assert.deepStrictEqual(lines.map((l) => C.toMarkup(l.text, l.st || null)), ['ИНТ. ДОМ - ДЕНЬ', 'Маша **смотрит** в _окно_.']);
  assert.deepStrictEqual(tx(fin(C.classifyLines(lines)).blocks), ['scene|ИНТ. ДОМ - ДЕНЬ', 'action|Маша **смотрит** в _окно_.']);
});
// 7. scene colours
ok('scene colour', () => {
  assert.strictEqual(C.colorToFDX('red'), '#E50039003500');
  assert.strictEqual(C.colorFromFDX('#E50039003500'), 'red');
  assert.strictEqual(C.colorFromFDX('#FF0000000000'), 'red', 'the nearest of ours');
  assert.strictEqual(C.colorFromFDX('#0000FF'), 'blue');
  assert.strictEqual(C.colorFromFDX('#FFFFFFFFFFFF'), '', 'white is none');
  assert.strictEqual(C.colorFromFDX(''), '');
  const bl = [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('action', 'Раз.'), B('scene', 'НАТ. ДВОР - ДЕНЬ'), B('action', 'Два.')];
  const ep = { blocks: bl, sceneMeta: { [bl[0].id]: { color: 'green' }, [bl[2].id]: { color: 'nope' } } }, p = proj(), st = C.analyzeEpisode(ep, p);
  assert.deepStrictEqual(st.scenes.map((s) => s.color), ['green', ''], 'an unknown colour is none');
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(x.includes('<SceneProperties Color="#4300A0004700" Length='), x);
  assert.ok(!/НАТ\. ДВОР[\s\S]*?Color=/.test(x.split('<Paragraph Number="2"')[1].split('</Paragraph>')[0]));
  const back = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(back.blocks.filter((b) => b.t === 'scene').map((b) => (back.sceneMeta[b.id] || {}).color || ''), ['green', '']);
});
// 8. SmartType upkeep
ok('dictionary usage and rebuild', () => {
  const p = proj();
  p.chars = { 'МАША': {}, 'ПЕТЯ': {}, 'ДЕД': {}, 'ГОСТЬ': {} }; p.locs = { 'ДОМ': {}, 'ДВОР': {}, 'ОФИС': {} };
  p.episodes = [{ blocks: [B('scene', 'ИНТ. ДОМ - ДЕНЬ'), B('character', 'маша (зк)'), B('dialogue', 'Да.')], sceneMeta: { s: { extras: ['Дед'] } } }, { blocks: [B('scene', 'НАТ. ДВОР. САД - ДЕНЬ')], sceneMeta: {} }];
  const u = C.dictUsage(p);
  assert.deepStrictEqual([[...u.chars].sort(), [...u.locs].sort()], [['ДЕД', 'МАША'], ['ДВОР', 'ДОМ']]);
  const gone = C.rebuildDicts(p);
  assert.deepStrictEqual(gone, { chars: ['ПЕТЯ', 'ГОСТЬ'], locs: ['ОФИС'] });
  assert.deepStrictEqual([Object.keys(p.chars), Object.keys(p.locs)], [['МАША', 'ДЕД'], ['ДОМ', 'ДВОР']]);
});
// 9. the flags travel: undo-style snapshots are plain data, history deltas keep them
ok('page break and styles survive history deltas', () => {
  const cur = { blocks: [B('action', '**a**', { pageBreak: true }), B('action', 'b')], sceneMeta: {} };
  const ref = { blocks: [Object.assign({}, cur.blocks[0], { pageBreak: undefined, x: 'a' }), cur.blocks[1]], sceneMeta: {} };
  delete ref.blocks[0].pageBreak; delete ref.blocks[0].st;
  const d = C.histEncode(cur, ref), back = C.histDecode(d, ref);
  assert.deepStrictEqual(back.blocks, cur.blocks);
});

console.log('test_basics: ' + n + ' groups ok');
