// io group: import/export regressions and round trips (node tests/test_io.js)
const assert = require('assert');
require('../app/core.js'); const C = globalThis.Core;
const { DOMParser } = require('@xmldom/xmldom');
let n = 0;
const ok = (name, f) => { try { f(); n++; } catch (e) { console.log('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
const tx = (blocks) => blocks.map((b) => b.t + '|' + b.x);
const fin = (blocks) => C.finalizeImport(blocks, { chars: {}, locs: {} });
const metaList = (r) => r.blocks.filter((b) => b.t === 'scene').map((b) => r.sceneMeta[b.id] || {});
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body) => '<?xml version="1.0"?><w:document ' + W + '><w:body>' + body + '</w:body></w:document>';
const wp = (t, left) => '<w:p>' + (left != null ? '<w:pPr><w:ind w:left="' + left + '"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
const fdx = (paras) => '<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content>' + paras + '</Content></FinalDraft>';

// 1. a cue that opens a scene is not a cast list
ok('cue after heading (text)', () => {
  const r = fin(C.importText('ИНТ. КУХНЯ - ДЕНЬ 2\n\nПЕТЯ\n(Маше)\nПривет.\n'));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'character|ПЕТЯ', 'paren|(Маше)', 'dialogue|Привет.']);
  assert.strictEqual(metaList(r)[0].day, '2');
});
ok('cue after heading, no paren (text)', () => {
  assert.deepStrictEqual(tx(fin(C.importText('ИНТ. КУХНЯ - ДЕНЬ\n\nПЕТЯ\nПривет.\n')).blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'character|ПЕТЯ', 'dialogue|Привет.']);
});
ok('cue after heading (indented)', () => {
  const b = C.classifyLines([{ text: 'ИНТ. КВАРТИРА - ДЕНЬ', indent: 1.5 }, { text: '', indent: null }, { text: 'ПЕТЯ', indent: 3.7 }, { text: 'Привет, как дела?', indent: 2.5 }, { text: 'Петя уходит.', indent: 1.5, gapBefore: true }]);
  assert.deepStrictEqual(tx(b), ['scene|ИНТ. КВАРТИРА - ДЕНЬ', 'character|ПЕТЯ', 'dialogue|Привет, как дела?', 'action|Петя уходит.']);
});
ok('real cast lists stay cast', () => {
  const r = fin(C.importText('ИНТ. КУХНЯ - ДЕНЬ\nПЕТЯ, МАША\nОни едят.\n\nНАТ. ДВОР - НОЧЬ\nВАСЯ\n\nВася курит.\n'));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Они едят.', 'scene|НАТ. ДВОР - НОЧЬ', 'action|Вася курит.']);
  assert.deepStrictEqual(metaList(r).map((m) => m.extras), [['ПЕТЯ', 'МАША'], ['ВАСЯ']]);
});
ok('lone lower-case word after heading stays text', () => {
  assert.deepStrictEqual(tx(fin(C.importText('ИНТ. КУХНЯ - ДЕНЬ\nТишина\n\nМаша входит.\n')).blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Тишина', 'action|Маша входит.']);
});

// 2. parentheticals with capitals are not cues
ok('paren with capitals (text)', () => {
  const b = C.importText('ИНТ. КВАРТИРА - ДЕНЬ\n\nМаша входит.\n\nПЕТЯ\n(Маше)\nПривет.\n\nМАША\n(шепотом, ВАСЕ)\nТише.\n\nВАСЯ (З.К.)\nДа.\n\nГРИША (орет)\nНет!\n');
  assert.deepStrictEqual(tx(b).slice(2), ['character|ПЕТЯ', 'paren|(Маше)', 'dialogue|Привет.', 'character|МАША', 'paren|(шепотом, ВАСЕ)', 'dialogue|Тише.', 'character|ВАСЯ (З.К.)', 'dialogue|Да.', 'character|ГРИША (орет)', 'dialogue|Нет!']);
});
ok('paren with capitals (indented)', () => {
  const b = C.classifyLines([{ text: 'ИНТ. КВАРТИРА - ДЕНЬ', indent: 1.5 }, { text: 'Маша входит.', indent: 1.5, gapBefore: true }, { text: 'ПЕТЯ', indent: 3.7, gapBefore: true }, { text: '(Пете)', indent: 3.1 }, { text: 'Привет.', indent: 2.5 }]);
  assert.deepStrictEqual(tx(b).slice(2), ['character|ПЕТЯ', 'paren|(Пете)', 'dialogue|Привет.']);
});

// 3. script days survive every import and reach FDX/Fountain
ok('day: FDX import', () => {
  const r = fin(C.importFDX(fdx('<Paragraph Number="12А" Type="Scene Heading"><Text>ИНТ. КВАРТИРА МАШИ. КУХНЯ - ДЕНЬ 2</Text></Paragraph><Paragraph Type="Action"><Text>Тихо.</Text></Paragraph>'), DOMParser));
  assert.strictEqual(r.blocks[0].x, 'ИНТ. КВАРТИРА МАШИ. КУХНЯ - ДЕНЬ');
  assert.deepStrictEqual([metaList(r)[0].day, metaList(r)[0].num], ['2', '12А']);
});
ok('day: text and FilmToolz heading', () => {
  const r = fin(C.importText('12А. ИНТ. КВАРТИРА МАШИ - ДЕНЬ 2\n\nТихо.\n\n1-12. ИНТ. КУХНЯ ДЕНЬ 3.\n\nТихо.\n'));
  assert.deepStrictEqual(metaList(r).map((m) => [m.num, m.day]), [['12А', '2'], ['1-12', '3']]);
  assert.strictEqual(r.blocks[2].x, 'ИНТ. КУХНЯ - ДЕНЬ');
});

// helpers for project round trips
function project(blocks, meta) {
  const p = C.demoProject(); const ep = p.episodes[0];
  ep.blocks = blocks.map(([t, x], i) => ({ id: 'b' + i, t, x }));
  ep.sceneMeta = meta || {};
  return { p, ep, st: C.analyzeEpisode(ep, p) };
}
const SRC = [['scene', 'ИНТ. КВАРТИРА - ДЕНЬ'], ['action', 'Маша входит.'], ['character', 'ПЕТЯ'], ['dialogue', 'Привет.'], ['paren', '(Маше)'], ['dialogue', 'Как дела?'],
  ['scene', 'УДАЛЕНА'], ['scene', 'НАТ. ДВОР - НОЧЬ'], ['action', '...Ну да.'], ['character', 'МАША'], ['dialogue', '...Ну да.'], ['transition', 'СМЕНА КАДРА:'], ['scene', 'ИНТ. КУХНЯ - УТРО'], ['action', 'Пусто.']];
const META = { b0: { num: '12А', day: '2' }, b6: { num: '13', omitted: true }, b7: { num: '51-12', day: '3' }, b12: { num: 'A1' } };
const expectBlocks = SRC.map(([t, x]) => t + '|' + x);
const expectMeta = [['12А', '2', false], ['13', '', true], ['51-12', '3', false], ['A1', '', false]];
const metaOf = (r) => metaList(r).map((m) => [m.num || '', m.day || '', !!m.omitted]);

ok('FDX round trip keeps text, types, numbers, days', () => {
  const { p, ep, st } = project(SRC, META);
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(x.includes('<Text>ИНТ. КВАРТИРА - ДЕНЬ 2</Text>') && x.includes('<Text>НАТ. ДВОР - НОЧЬ 3</Text>'), 'card day written into FDX heading');
  const r = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(tx(r.blocks), expectBlocks);
  assert.deepStrictEqual(metaOf(r), expectMeta);
  // a day typed in the heading is not written twice
  const t = project([['scene', 'ИНТ. КУХНЯ - ДЕНЬ 4'], ['action', 'Тихо.']], {});
  assert.ok(C.exportFDX(t.ep, t.p, t.st, {}).includes('<Text>ИНТ. КУХНЯ - ДЕНЬ 4</Text>'));
});
ok('Fountain round trip keeps text, types, numbers, days', () => {
  const { p, ep, st } = project(SRC, META);
  const f = C.exportFountain(ep, p, st);
  assert.ok(/^\.ИНТ\. КВАРТИРА - ДЕНЬ 2 #12А#$/m.test(f) && /^\.УДАЛЕНА #13#$/m.test(f) && /^Привет\.\n\(Маше\)\nКак дела\?$/m.test(f), f);
  const r = fin(C.importText(f));
  assert.deepStrictEqual(tx(r.blocks), expectBlocks);
  assert.deepStrictEqual(metaOf(r), expectMeta);
});
ok('Fountain #num# on import', () => {
  const r = fin(C.importText('ИНТ. КВАРТИРА - ДЕНЬ #12А#\n\nТихо.\n'));
  assert.strictEqual(r.blocks[0].x, 'ИНТ. КВАРТИРА - ДЕНЬ');
  assert.strictEqual(metaList(r)[0].num, '12А');
});
ok('docx (FilmToolz) round trip keeps text, types, numbers, days', () => {
  const { p, ep, st } = project(SRC, META);
  const xml = C.docxDocumentXML(ep, p, st);
  assert.ok(xml.includes('1-12А. ИНТ. КВАРТИРА ДЕНЬ 2.') && xml.includes('1-A1. ИНТ. КУХНЯ УТРО'), 'FilmToolz headings');
  const r = fin(C.classifyLines(C.docxParagraphs(xml, DOMParser)));
  // omitted scenes are not exported to FilmToolz
  assert.deepStrictEqual(tx(r.blocks), expectBlocks.filter((x) => x !== 'scene|УДАЛЕНА'));
  assert.deepStrictEqual(metaOf(r), [['1-12А', '2', false], ['51-12', '3', false], ['1-A1', '', false]]);
});

// 4/5. PDF margin numbers and letter-first numbers
ok('PDF margin numbers', () => {
  for (const nm of ['12А', '12A', '51-12', 'A1', '1', '1-12А']) {
    const it = (str, x, y) => ({ str, x, y, w: str.length * 7.2, h: 12 });
    const page = [it(nm, 54, 700), it('ИНТ. КВАРТИРА - ДЕНЬ 2', 108, 700), it(nm, 560, 700), it('Маша входит.', 108, 676), it('НАТ. ДВОР - НОЧЬ', 108, 640), it('Пусто.', 108, 616)];
    const r = fin(C.classifyLines(C.pdfLines([page])));
    assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. КВАРТИРА - ДЕНЬ', 'action|Маша входит.', 'scene|НАТ. ДВОР - НОЧЬ', 'action|Пусто.'], nm);
    assert.deepStrictEqual(metaOf(r), [[nm, '2', false], ['', '', false]], nm);
  }
});
ok('letter-first numbers in headings', () => {
  assert.ok(C.HEADING_START.test('A1. ИНТ. КУХНЯ - ДЕНЬ') && C.HEADING_START.test('1-A13. НАТ. ДВОР НОЧЬ'));
  const h = C.parseHeading('1-A13. НАТ. ДВОР НОЧЬ');
  assert.deepStrictEqual([h.num, h.type, h.object], ['1-A13', 'ext', 'ДВОР']);
  for (const [s, num] of [['12А. ИНТ. ДОМ - ДЕНЬ', '12А'], ['3-12. ИНТ. ДОМ - ДЕНЬ', '3-12'], ['12A. ИНТ. ДОМ - ДЕНЬ', '12A'], ['B1. ИНТ. ДОМ - ДЕНЬ', 'B1']]) assert.strictEqual(C.parseHeading(s).num, num);
});

// 6. hand-formatted Word script
ok('docx without w:ind on action', () => {
  const xml = docx(wp('СЧАСТЛИВЫЕ ВМЕСТЕ') + wp('ИНТ. КВАРТИРА - ДЕНЬ') + wp('Маша входит.') + wp('МАША', 2880) + wp('(Пете)', 2160) + wp('Привет.', 1440) + wp('ПЕТЯ', 2880) + wp('Ну.', 1440) + wp('НАТ. ДВОР - НОЧЬ') + wp('Пусто.'));
  assert.deepStrictEqual(tx(C.classifyLines(C.docxParagraphs(xml, DOMParser))), ['action|СЧАСТЛИВЫЕ ВМЕСТЕ', 'scene|ИНТ. КВАРТИРА - ДЕНЬ', 'action|Маша входит.', 'character|МАША', 'paren|(Пете)', 'dialogue|Привет.', 'character|ПЕТЯ', 'dialogue|Ну.', 'scene|НАТ. ДВОР - НОЧЬ', 'action|Пусто.']);
  // one stray indent keeps the plain-text rules ("ИМЯ: реплика")
  const one = docx(wp('ИНТ. КВАРТИРА - ДЕНЬ') + wp('Цитата', 720) + wp('МАША: Привет.'));
  assert.deepStrictEqual(C.docxParagraphs(one, DOMParser).map((l) => l.indent), [null, 2, null]);
});

// 7. pasted text keeps leading punctuation
ok('leading . ! > ~ are text', () => {
  const b = C.importText('ИНТ. КУХНЯ - ДЕНЬ\n\nМАША\n...Ну да.\n\n> Стрелка в тексте\n\n~ тильда\n\n!Стоп!\n');
  assert.deepStrictEqual(tx(b), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'character|МАША', 'dialogue|...Ну да.', 'action|> Стрелка в тексте', 'action|~ тильда', 'action|!Стоп!']);
  const f = C.importText('Title: Х\n\n.ИНТ. ДОМ - ДЕНЬ\n\n!КРИК\n\n@МАША\nДа.\n\n> СМЕНА КАДРА:\n\n>КОНЕЦ<\n');
  assert.deepStrictEqual(tx(f), ['scene|ИНТ. ДОМ - ДЕНЬ', 'action|КРИК', 'character|МАША', 'dialogue|Да.', 'transition|СМЕНА КАДРА:', 'action|КОНЕЦ']);
});

// 8. KIT Сценарист cast style
ok('Scene Characters style is cast', () => {
  for (const st of ['Scene Characters', 'scene_characters', 'Персонажи сцены', 'Персонажи в сцене']) {
    const r = fin(C.classifyLines([{ text: 'ИНТ. КВАРТИРА - ДЕНЬ', style: 'Scene Heading' }, { text: 'МАША, ПЕТЯ', style: st }, { text: 'Они едят.', style: 'Action' }, { text: 'НАТ. ДВОР - НОЧЬ', style: 'Scene Heading' }, { text: 'ВАСЯ', style: st }]));
    assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. КВАРТИРА - ДЕНЬ', 'action|Они едят.', 'scene|НАТ. ДВОР - НОЧЬ'], st);
    assert.deepStrictEqual(r.report.untyped, []);
  }
  for (const st of ['Scene Heading', 'Заголовок сцены']) assert.strictEqual(C.classifyLines([{ text: 'ДОМ', style: st }])[0].t, 'scene');
  assert.strictEqual(C.classifyLines([{ text: 'МАША', style: 'Character' }])[0].t, 'character');
});

// 9. non-breaking hyphen
ok('noBreakHyphen', () => {
  const xml = docx('<w:p><w:r><w:t>ИНТ. САНКТ</w:t></w:r><w:r><w:noBreakHyphen/><w:t>ПЕТЕРБУРГ - ДЕНЬ</w:t></w:r></w:p><w:p><w:r><w:t>Звонок кто</w:t></w:r><w:r><w:noBreakHyphen/><w:t>то.</w:t></w:r></w:p>');
  assert.deepStrictEqual(C.docxParagraphs(xml, DOMParser).map((l) => l.text), ['ИНТ. САНКТ-ПЕТЕРБУРГ - ДЕНЬ', 'Звонок кто-то.']);
});

// review: a Fountain heading left empty or starting with a non-letter survives the round trip without "#n#" garbage
ok('fountain: empty and «quoted» headings', () => {
  const ep = { number: 1, blocks: [{ id: 'a', t: 'scene', x: '' }, { id: 'b', t: 'action', x: 'Текст.' }, { id: 'c', t: 'scene', x: '«СОН» ВОКЗАЛ' }, { id: 'd', t: 'action', x: 'Пусто.' }], sceneMeta: {} };
  const r = fin(C.importText(C.exportFountain(ep, { name: 'X', rules: {}, chars: {}, locs: {}, episodes: [] })));
  assert.deepStrictEqual(tx(r.blocks), ['action|Текст.', 'scene|«СОН» ВОКЗАЛ', 'action|Пусто.']);
  assert.deepStrictEqual(tx(C.importText('...Ну да.\nИНТ. ДОМ - ДЕНЬ')), ['action|...Ну да.', 'scene|ИНТ. ДОМ - ДЕНЬ']);
});

console.log(process.exitCode ? 'test_io: FAILED' : 'test_io: ' + n + ' checks passed');
