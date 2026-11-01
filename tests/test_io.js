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

// FDX: omitted scene bodies, scene synopsis (SceneProperties Title) and Cast List paragraphs survive both ways
ok('FDX omitted scene body kept both ways', () => {
  const { p, ep, st } = project([['scene', 'ИНТ. ОФИС - ДЕНЬ'], ['action', 'Текст.'], ['scene', 'УДАЛЕНА'], ['scene', 'ИНТ. ДОМ - ДЕНЬ'], ['action', 'Пусто.']],
    { b0: { num: '1' }, b2: { num: '2', omitted: true, omittedHeading: 'НАТ. ДВОР - НОЧЬ', omittedBlocks: [{ id: 'b2', t: 'scene', x: 'НАТ. ДВОР - НОЧЬ' }, { id: 'd1', t: 'action', x: 'Мёртвый текст.' }, { id: 'd2', t: 'character', x: 'ПЕТЯ' }, { id: 'd3', t: 'dialogue', x: 'Прощай.' }] }, b3: { num: '3' } });
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(/<OmittedScene><Paragraph Type="Scene Heading"><Text>НАТ\. ДВОР - НОЧЬ<\/Text><\/Paragraph><Paragraph Type="Action"><Text>Мёртвый текст\.<\/Text>.*<\/OmittedScene><Text>OMITTED<\/Text>/.test(x), 'OmittedScene body written');
  const r = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. ОФИС - ДЕНЬ', 'action|Текст.', 'scene|УДАЛЕНА', 'scene|ИНТ. ДОМ - ДЕНЬ', 'action|Пусто.']);
  const m = r.sceneMeta[r.blocks[2].id];
  assert.ok(m.omitted && m.omittedHeading === 'НАТ. ДВОР - НОЧЬ', 'omitted heading kept');
  assert.deepStrictEqual(m.omittedBlocks.map((b) => b.t + '|' + b.x), ['scene|НАТ. ДВОР - НОЧЬ', 'action|Мёртвый текст.', 'character|ПЕТЯ', 'dialogue|Прощай.']);
  assert.strictEqual(m.omittedBlocks[0].id, r.blocks[2].id, 'restored heading keeps the scene id (its card)');
  // a body without its own heading still restores under the scene's id
  const r2 = fin(C.importFDX(fdx('<Paragraph Type="Scene Heading" Number="4"><OmittedScene><Paragraph Type="Action"><Text>Только текст.</Text></Paragraph></OmittedScene><Text>OMITTED</Text></Paragraph>'), DOMParser));
  const m2 = r2.sceneMeta[r2.blocks[0].id];
  assert.deepStrictEqual(m2.omittedBlocks.map((b) => b.t + '|' + b.x), ['scene|', 'action|Только текст.']);
  assert.strictEqual(m2.omittedBlocks[0].id, r2.blocks[0].id);
});
ok('FDX scene synopsis both ways', () => {
  const { p, ep, st } = project([['scene', 'ИНТ. ОФИС - ДЕНЬ'], ['action', 'Текст.'], ['scene', 'ИНТ. ДОМ - ДЕНЬ'], ['action', 'Пусто.']], { b0: { num: '1', synopsis: 'Утро Вороновых & «кофе»' } });
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(x.includes('Title="Утро Вороновых &amp; «кофе»"'));
  const r = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(metaList(r).map((m) => m.synopsis || ''), ['Утро Вороновых & «кофе»', '']);
  assert.ok(!r.blocks.some((b) => 'synopsis' in b), 'synopsis lives in the scene card, not on the block');
  const st2 = C.analyzeEpisode({ blocks: r.blocks, sceneMeta: r.sceneMeta }, p);
  assert.strictEqual(st2.scenes[0].synopsis, 'Утро Вороновых & «кофе»');
});
ok('FDX scene properties with nested paragraphs (arc beats, Summary) keep the heading', () => {
  const head = (inner, title) => '<Paragraph Number="1" Type="Scene Heading"><SceneProperties Length="1/8" Page="1" Title="' + (title || '') + '">' + inner + '</SceneProperties><Text>ИНТ. КУХНЯ - ДЕНЬ</Text></Paragraph><Paragraph Type="Action"><Text>Маша пьёт чай.</Text></Paragraph>';
  const a = fin(C.importFDX(fdx(head('<SceneArcBeats><CharacterArcBeat Name="МАША"><Paragraph Alignment="Left"><Text>бит</Text></Paragraph></CharacterArcBeat></SceneArcBeats>')), DOMParser));
  assert.deepStrictEqual(tx(a.blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Маша пьёт чай.']);
  const b = fin(C.importFDX(fdx(head('<Summary><Paragraph><Text>Маша узнаёт</Text></Paragraph><Paragraph><Text>правду.</Text></Paragraph></Summary>', 'Встреча')), DOMParser));
  assert.deepStrictEqual(tx(b.blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Маша пьёт чай.']);
  assert.strictEqual(metaList(b)[0].synopsis, 'Маша узнаёт правду.', 'Summary is the synopsis (before the Title)');
  // export writes the synopsis as Final Draft's Summary too, and it reads back once
  const { p, ep, st } = project([['scene', 'ИНТ. ОФИС - ДЕНЬ'], ['action', 'Текст.']], { b0: { num: '1', synopsis: 'Утро & кофе' } });
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(x.includes('<Summary><Paragraph Alignment="Left"><Text>Утро &amp; кофе</Text></Paragraph></Summary></SceneProperties>'));
  const r = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. ОФИС - ДЕНЬ', 'action|Текст.']);
  assert.strictEqual(metaList(r)[0].synopsis, 'Утро & кофе');
});
ok('FDX omitted scene keeps its dual dialogue both ways', () => {
  const r = fin(C.importFDX(fdx('<Paragraph Number="1" Type="Scene Heading"><OmittedScene><Paragraph Type="Scene Heading"><Text>ИНТ. КУХНЯ - ДЕНЬ</Text></Paragraph><Paragraph Type="Action"><Text>Чай.</Text></Paragraph><Paragraph><DualDialogue><Paragraph Type="Character"><Text>БОРЯ</Text></Paragraph><Paragraph Type="Dialogue"><Text>Привет.</Text></Paragraph><Paragraph Type="Character"><Text>АНЯ</Text></Paragraph><Paragraph Type="Dialogue"><Text>Здравствуй.</Text></Paragraph></DualDialogue></Paragraph></OmittedScene><Text>OMITTED</Text></Paragraph>'), DOMParser));
  const m = r.sceneMeta[r.blocks[0].id];
  assert.deepStrictEqual(m.omittedBlocks.map((b) => b.t + '|' + b.x + (b.dual ? '^' : '')), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Чай.', 'character|БОРЯ', 'dialogue|Привет.', 'character|АНЯ^', 'dialogue|Здравствуй.']);
  const { p, ep, st } = project([['scene', 'УДАЛЕНА'], ['scene', 'ИНТ. ДОМ - ДЕНЬ'], ['action', 'Пусто.']], { b0: { num: '1', omitted: true, omittedHeading: m.omittedHeading, omittedBlocks: m.omittedBlocks } });
  const x = C.exportFDX(ep, p, st, {});
  assert.ok(/<OmittedScene>.*<Paragraph><DualDialogue><Paragraph Type="Character"><Text>БОРЯ<\/Text>.*<\/DualDialogue><\/Paragraph><\/OmittedScene>/.test(x), 'dual pair wrapped inside OmittedScene');
  const r2 = fin(C.importFDX(x, DOMParser));
  assert.deepStrictEqual(r2.sceneMeta[r2.blocks[0].id].omittedBlocks.map((b) => b.t + '|' + b.x + (b.dual ? '^' : '')).slice(2), ['character|БОРЯ', 'dialogue|Привет.', 'character|АНЯ^', 'dialogue|Здравствуй.']);
});
ok('Fountain export escapes speech lines and inline markup', () => {
  const rt = (rows) => { const { p, ep, st } = project(rows, {}); return tx(fin(C.importText(C.exportFountain(ep, p, st))).blocks); };
  const rows = [['scene', 'ИНТ. КУХНЯ - ДЕНЬ'], ['character', 'ВИКА'], ['dialogue', '#яжемать — вот мой хештег.'], ['character', 'ПЕТЯ'], ['dialogue', '==='],
    ['character', 'ОЛЯ'], ['dialogue', '= не синопсис'], ['character', 'ВИКА'], ['dialogue', '[[не заметка]] текст'], ['character', 'ПЕТЯ'], ['dialogue', '.Точка и !воскл'],
    ['character', 'ОЛЯ'], ['dialogue', 'ИНТ. КУХНЯ — это где?'], ['character', 'ВИКА'], ['dialogue', 'МАМА. Я дома.'], ['action', 'Он смотрит в [[заметку]] листа /* и */ дальше.']];
  assert.deepStrictEqual(rt(rows), rows.map(([t, x]) => t + '|' + x));
});
ok('Fountain shots the shot rule would miss come back as shots', () => {
  const { p, ep, st } = project([['scene', 'ИНТ. КУХНЯ - ДЕНЬ'], ['shot', 'Крупно — очень длинный план чайника, который кипит и свистит на всю кухню громко'], ['action', 'А.'], ['shot', '...и тишина'], ['action', 'Б.'],
    ['shot', '(деталь)'], ['action', 'В.'], ['shot', 'наезд в:'], ['action', 'Г.'], ['shot', 'смена кадра'], ['action', 'Д.'], ['shot', 'КРУПНО — ЛИЦО']], {});
  const f = C.exportFountain(ep, p, st);
  assert.ok(/\nКРУПНО — ЛИЦО\n/.test(f), 'an ordinary shot stays a bare capitals line');
  assert.deepStrictEqual(tx(fin(C.importText(f)).blocks).filter((x) => /^shot/.test(x)), ['shot|КРУПНО — ОЧЕНЬ ДЛИННЫЙ ПЛАН ЧАЙНИКА, КОТОРЫЙ КИПИТ И СВИСТИТ НА ВСЮ КУХНЮ ГРОМКО', 'shot|...И ТИШИНА', 'shot|(ДЕТАЛЬ)', 'shot|НАЕЗД В:', 'shot|СМЕНА КАДРА', 'shot|КРУПНО — ЛИЦО']);
});
ok('FDX Cast List and unknown element types', () => {
  const r = fin(C.importFDX(fdx('<Paragraph Type="Scene Heading"><Text>ИНТ. КУХНЯ - ДЕНЬ</Text></Paragraph><Paragraph Type="Cast List"><Text>ПЕТЯ, МАША</Text></Paragraph>' +
    '<Paragraph Type="Character"><Text>ПЕТЯ</Text></Paragraph><Paragraph Type="Dialogue"><Text>Привет.</Text></Paragraph><Paragraph Type="New Act"><Text>АКТ ВТОРОЙ</Text></Paragraph><Paragraph Type="Scene Summary"><Text>Кратко.</Text></Paragraph>'), DOMParser));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'character|ПЕТЯ', 'dialogue|Привет.', 'action|АКТ ВТОРОЙ', 'action|Кратко.']);
  assert.deepStrictEqual(r.sceneMeta[r.blocks[0].id].extras, ['МАША'], 'cast list goes to the scene card');
});

// FilmToolz heading: an unparsed heading keeps its text, and the line always ends with a period
ok('filmtoolz heading fallback and closing period', () => {
  const ep = { number: 3, blocks: [{ id: 'a', t: 'scene', x: 'СОН' }, { id: 'b', t: 'action', x: 'Текст.' }, { id: 'c', t: 'scene', x: '' }, { id: 'd', t: 'action', x: 'Пусто.' }, { id: 'e', t: 'scene', x: 'ИНТ./НАТ. МАШИНА - ВЕЧЕР' }, { id: 'f', t: 'action', x: 'Едут.' }, { id: 'g', t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { id: 'h', t: 'action', x: 'Едят.' }], sceneMeta: { g: { day: '3' } } };
  const st = C.analyzeEpisode(ep, { name: 'X', rules: {}, chars: {}, locs: {}, episodes: [ep] });
  assert.deepStrictEqual(st.scenes.map((s) => C.filmtoolzHeading(s, ep).line), ['3-1. СОН.', '3-2. БЕЗ ЗАГОЛОВКА.', '3-3. НАТ/ИНТ. МАШИНА ВЕЧЕР.', '3-4. ИНТ. КУХНЯ ДЕНЬ 3.']);
});


// dual dialogue and the Shot element through FDX, Fountain and Word
const dualEp = () => ({ id: 'e1', number: 2, sceneMeta: {}, blocks: [
  { id: 's', t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { id: 'h', t: 'shot', x: 'Крупно — чайник' }, { id: 'c1', t: 'character', x: 'ПЕТЯ' }, { id: 'd1', t: 'dialogue', x: 'Я первый!' },
  { id: 'c2', t: 'character', x: 'МАША', dual: true }, { id: 'p2', t: 'paren', x: '(одновременно)' }, { id: 'd2', t: 'dialogue', x: 'Нет, я!' },
  { id: 'a', t: 'action', x: 'БАХ!' }, { id: 'c3', t: 'character', x: 'ПЕТЯ' }, { id: 'd3', t: 'dialogue', x: 'Ой.' }] });
const dualP = () => ({ name: 'X', rules: {}, chars: {}, locs: {} });
const shape = (blocks) => blocks.map((b) => b.t + '|' + b.x + (b.dual ? '|^' : ''));
const WANT = ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'shot|КРУПНО — ЧАЙНИК', 'character|ПЕТЯ', 'dialogue|Я первый!', 'character|МАША|^', 'paren|(одновременно)', 'dialogue|Нет, я!', 'action|БАХ!', 'character|ПЕТЯ', 'dialogue|Ой.'];
ok('FDX DualDialogue and Shot: export', () => {
  const ep = dualEp(), x = C.exportFDX(ep, dualP(), C.analyzeEpisode(ep, dualP()));
  assert.ok(/<Paragraph><DualDialogue>\s*<Paragraph Type="Character"><Text>ПЕТЯ<\/Text><\/Paragraph>\s*<Paragraph Type="Dialogue"><Text>Я первый!<\/Text><\/Paragraph>\s*<Paragraph Type="Character"><Text>МАША<\/Text><\/Paragraph>\s*<Paragraph Type="Parenthetical">.*?<Paragraph Type="Dialogue"><Text>Нет, я!<\/Text><\/Paragraph>\s*<\/DualDialogue><\/Paragraph>/s.test(x), 'pair inside <DualDialogue>');
  assert.strictEqual((x.match(/<DualDialogue>/g) || []).length, 1, 'only the pair');
  assert.ok(/<Paragraph Type="Shot"><Text>КРУПНО — ЧАЙНИК<\/Text><\/Paragraph>/.test(x), 'Shot paragraph');
  assert.ok(/<ElementSettings Type="Shot">.*LeftIndent="1.50" RightIndent="7.50" SpaceBefore="12"/.test(x), 'Shot element settings');
  assert.ok(new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('DualDialogue').length === 1, 'well-formed');
});
ok('FDX DualDialogue and Shot: round trip', () => {
  const ep = dualEp(), x = C.exportFDX(ep, dualP(), C.analyzeEpisode(ep, dualP()));
  assert.deepStrictEqual(shape(fin(C.importFDX(x, DOMParser)).blocks), WANT);
});
ok('FDX DualDialogue written by Final Draft', () => {
  const r = fin(C.importFDX(fdx('<Paragraph Type="Scene Heading"><Text>INT. KITCHEN - DAY</Text></Paragraph><Paragraph Type="Shot"><Text>ANGLE ON</Text></Paragraph><Paragraph><DualDialogue><Paragraph Type="Character"><Text>BOB</Text></Paragraph><Paragraph Type="Dialogue"><Text>Hi.</Text></Paragraph><Paragraph Type="Character"><Text>ANN</Text></Paragraph><Paragraph Type="Dialogue"><Text RevisionID="2">Hey.</Text></Paragraph></DualDialogue></Paragraph><Paragraph Type="Character"><Text>BOB</Text></Paragraph><Paragraph Type="Dialogue"><Text>Bye.</Text></Paragraph>'), DOMParser));
  assert.deepStrictEqual(shape(r.blocks).slice(1), ['shot|ANGLE ON', 'character|BOB', 'dialogue|Hi.', 'character|ANN|^', 'dialogue|Hey.', 'character|BOB', 'dialogue|Bye.']);
  assert.strictEqual(r.blocks[5].rev, 2, 'revision marks inside the pair are kept');
});
ok('Fountain ^ and shots: export and round trip', () => {
  const ep = dualEp(), f = C.exportFountain(ep, dualP());
  assert.ok(/\n@МАША \^\n\(одновременно\)\nНет, я!\n/.test(f), 'second cue carries ^');
  assert.ok(/\n@ПЕТЯ\nЯ первый!\n/.test(f) && !/ПЕТЯ \^/.test(f), 'first cue has no ^');
  assert.ok(/\n\nКРУПНО — ЧАЙНИК\n\n/.test(f), 'shot on a line of its own');
  assert.ok(/\n!БАХ!\n/.test(f), 'action in capitals is forced with !');
  assert.deepStrictEqual(shape(fin(C.importText(f)).blocks), WANT);
});
ok('Fountain ^ written elsewhere', () => {
  const r = fin(C.importText('Title: X\n\nINT. HOUSE - DAY\n\nBRICK\nScrew retirement.\n\nSTEEL ^\nScrew retirement.\n\nCLOSE ON THE DOOR\n\nThey leave.\n'));
  assert.deepStrictEqual(shape(r.blocks), ['scene|ИНТ. HOUSE - DAY', 'character|BRICK', 'dialogue|Screw retirement.', 'character|STEEL|^', 'dialogue|Screw retirement.', 'shot|CLOSE ON THE DOOR', 'action|They leave.']);
  // a plain text file (no Fountain title page): a lone capitals line stays as it was read before
  assert.ok(!fin(C.importText('ИНТ. ДОМ - ДЕНЬ\n\nТИШИНА\n\nОни уходят.\n')).blocks.some((b) => b.t === 'shot'));
});
ok('Word: shot at the action margin in capitals, dual pair one speech after the other', () => {
  const ep = dualEp(), xml = C.docxDocumentXML(ep, dualP(), C.analyzeEpisode(ep, dualP()));
  assert.ok(/<w:ind w:left="0" w:right="0"\/><w:keepNext\/><\/w:pPr><w:r>.*?КРУПНО — ЧАЙНИК/.test(xml), 'shot paragraph');
  const i1 = xml.indexOf('>ПЕТЯ<'), i2 = xml.indexOf('>МАША<');
  assert.ok(i1 > 0 && i2 > i1 && xml.indexOf('Я первый!') < i2, 'both speeches, in order');
  const b = C.classifyLines([{ text: 'ИНТ. КУХНЯ - ДЕНЬ', style: 'Scene Heading' }, { text: 'КРУПНО — ЧАЙНИК', style: 'Shot' }, { text: 'Кипит.', style: 'Action' }, { text: 'ОБЩИЙ ПЛАН', style: 'Кадр' }]);
  assert.deepStrictEqual(tx(b), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'shot|КРУПНО — ЧАЙНИК', 'action|Кипит.', 'shot|ОБЩИЙ ПЛАН'], 'Word styles Shot / Кадр');
});

// Fountain: an action Fountain would read as something else is forced with «!» and comes back as action
ok('Fountain forces ambiguous actions', () => {
  const acts = ['Маша, Петя', 'Инт. это просто текст', 'ИНТ. ЭТО ПРОСТО ТЕКСТ', '.5 лет спустя', '@ собака', 'МАША: привет всем', '!!!', '> стрелка', '= равно', '# решётка', '~ тильда', 'Маша входит.', 'СМЕНА КАДРА:'];
  const { p, ep, st } = project([['scene', 'ИНТ. ДОМ - ДЕНЬ']].concat(acts.map((a) => ['action', a])), {});
  const f = C.exportFountain(ep, p, st);
  assert.ok(/^Маша входит\.$/m.test(f), 'plain action is not forced');
  assert.ok(/^!Инт\. это просто текст$/m.test(f) && /^!Маша, Петя$/m.test(f) && /^!МАША: привет всем$/m.test(f), f);
  const r = fin(C.importText(f));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. ДОМ - ДЕНЬ'].concat(acts.map((a) => 'action|' + a)));
});
// Fountain markup that is not script text, and '=' synopses
ok('Fountain notes, boneyard, sections, page breaks, synopsis', () => {
  const src = '# Акт первый\n\n.ИНТ. ДОМ - ДЕНЬ\n\n= Маша возвращается домой\n\nТекст [[заметка]] тут.\n\n/* старая\nсцена */\n\n===\n\nМАША\n[[заметка\nв две строки]]\nПривет.\n\n## Эпизод\n\nНАТ. ДВОР - НОЧЬ\n= Пусто\n\nКонец.\n';
  const r = fin(C.importText(src, { fountain: true }));
  assert.deepStrictEqual(tx(r.blocks), ['scene|ИНТ. ДОМ - ДЕНЬ', 'action|Текст тут.', 'character|МАША', 'dialogue|Привет.', 'scene|НАТ. ДВОР - НОЧЬ', 'action|Конец.']);
  assert.deepStrictEqual(metaList(r).map((m) => m.synopsis), ['Маша возвращается домой', 'Пусто']);
  // plain text (not Fountain) keeps such lines
  assert.deepStrictEqual(tx(C.importText('ИНТ. ДОМ - ДЕНЬ\n\n# не раздел\n')), ['scene|ИНТ. ДОМ - ДЕНЬ', 'action|# не раздел']);
  // export writes the synopsis back under its heading
  const { p, ep, st } = project([['scene', 'ИНТ. ДОМ - ДЕНЬ'], ['action', 'Тихо.']], { b0: { synopsis: 'Утро' } });
  const f = C.exportFountain(ep, p, st);
  assert.ok(/^\.ИНТ\. ДОМ - ДЕНЬ #1#\n\n= Утро$/m.test(f), f);
  assert.deepStrictEqual(metaList(fin(C.importText(f))).map((m) => m.synopsis), ['Утро']);
});
// Fountain title page both ways
ok('Fountain title page both ways', () => {
  const { p, ep, st } = project([['scene', 'ИНТ. ДОМ - ДЕНЬ'], ['action', 'Тихо.']], {});
  Object.assign(p, { name: 'Трёшка', author: 'Иван Петров', contact: 'Студия «Юг», +7 900 000-00-00' }); Object.assign(ep, { number: 4, title: 'Ремонт' });
  const f = C.exportFountain(ep, p, st, { today: new Date(2026, 2, 5).getTime() });
  assert.ok(f.startsWith('Title: Трёшка\nEpisode: 4 Ремонт\nAuthor: Иван Петров\nDraft: Драфт 1\nDraft date: 05.03.2026\nContact: Студия «Юг», +7 900 000-00-00\n\n'), f.slice(0, 200));
  const bl = C.importText(f);
  assert.deepStrictEqual(bl.titlePage.fields, { title: 'Трёшка', episode: { number: 4, title: 'Ремонт' }, author: 'Иван Петров', draft: 'Драфт 1', date: '05.03.2026', contact: 'Студия «Юг», +7 900 000-00-00' });
  // a Fountain title page with continuation lines, emphasis and keys we do not use: kept and written back
  const src = 'Title:\n    _**BRICK & STEEL**_\nCredit: Written by\nAuthor: Stu Maschwitz\nSource: Story by KTM\nDraft date: 1/20/2012\nContact:\n    Next Level Productions\n    1588 Mission Dr.\n\nИНТ. ДОМ - ДЕНЬ\n\nThey leave.\n';
  const b2 = C.importText(src);
  assert.deepStrictEqual(tx(b2), ['scene|ИНТ. ДОМ - ДЕНЬ', 'action|They leave.']);
  assert.deepStrictEqual(b2.titlePage.fields, { title: 'BRICK & STEEL', author: 'Stu Maschwitz', date: '1/20/2012', contact: 'Next Level Productions\n1588 Mission Dr.' });
  const p2 = { name: 'Сериал', rules: {}, chars: {}, locs: {}, episodes: [] }, ep2 = { id: 'e', season: 1, number: 1, title: 'brick', blocks: b2, sceneMeta: {} };
  p2.episodes.push(ep2);
  C.adoptTitlePage(b2.titlePage, ep2, p2, true);
  assert.deepStrictEqual([ep2.title, p2.author, p2.contact], ['BRICK & STEEL', 'Stu Maschwitz', 'Next Level Productions, 1588 Mission Dr.']);
  const back = C.exportFountain(ep2, p2, C.analyzeEpisode(ep2, p2));
  assert.ok(back.includes('Title: BRICK & STEEL\n') && back.includes('Draft date: 1/20/2012\n') && back.includes('Contact:\n    Next Level Productions\n    1588 Mission Dr.\n') && back.includes('Credit: Written by\n') && back.includes('Source: Story by KTM\n'), back.slice(0, 300));
  // a field changed in Драфт after the import replaces the imported text
  p2.author = 'Другой Автор';
  assert.ok(C.exportFountain(ep2, p2, C.analyzeEpisode(ep2, p2)).includes('Author: Другой Автор\n'));
});

// FDX title page: contact, draft label and date written; read back into the project and the episode; lossless both ways
const tpOf = (x) => x.slice(x.indexOf('<TitlePage>'), x.indexOf('</TitlePage>'));
const tpTexts = (x) => (tpOf(x).match(/<Paragraph[^>]*Alignment="(\w+)"[^>]*><Text[^>]*>[^<]+<\/Text>/g) || []).map((m) => m.match(/Alignment="(\w+)"/)[1][0] + ':' + m.replace(/^.*>([^<]+)<\/Text>$/, '$1'));
ok('FDX title page both ways', () => {
  const { p, ep, st } = project([['scene', 'ИНТ. ДОМ - ДЕНЬ'], ['action', 'Тихо.']], {});
  Object.assign(p, { name: 'Трёшка', author: 'Иван Петров', contact: 'Студия «Юг», +7 900' }); Object.assign(ep, { number: 4, title: 'Ремонт', season: 1 });
  const x = C.exportFDX(ep, p, st, { today: new Date(2026, 2, 5).getTime() });
  assert.deepStrictEqual(tpTexts(x), ['C:ТРЁШКА', 'C:Серия 4. Ремонт', 'C:Иван Петров', 'R:Драфт 1', 'R:05.03.2026', 'L:Студия «Юг», +7 900']);
  const bl = C.importFDX(x, DOMParser);
  assert.deepStrictEqual(tx(bl), ['scene|ИНТ. ДОМ - ДЕНЬ', 'action|Тихо.'], 'the title page is not script text');
  const p2 = { name: 'Трёшка', rules: {}, chars: {}, locs: {}, episodes: [{ id: 'o', season: 1, number: 1, blocks: [] }] };
  const ep2 = { id: 'n', season: 1, number: 2, title: 'файл', blocks: bl, sceneMeta: {} }; p2.episodes.push(ep2);
  C.adoptTitlePage(bl.titlePage, ep2, p2, true);
  assert.deepStrictEqual([ep2.number, ep2.title, p2.author, p2.contact], [4, 'Ремонт', 'Иван Петров', 'Студия «Юг», +7 900']);
  assert.strictEqual(tpOf(C.exportFDX(ep2, p2, C.analyzeEpisode(ep2, p2), {})), tpOf(x), 'Драфт → .fdx → Драфт → .fdx keeps the title page');
  // a changed field replaces the text of its paragraph; a new draft brings its label and today's date
  ep2.title = 'Потоп'; p2.contact = 'Новый контакт'; ep2.revLevel = 1; ep2.revisions = [{ level: 1, date: new Date(2026, 3, 1).getTime(), base: [] }];
  assert.deepStrictEqual(tpTexts(C.exportFDX(ep2, p2, C.analyzeEpisode(ep2, p2), {})), ['C:ТРЁШКА', 'C:Серия 4. Потоп', 'C:Иван Петров', 'R:Драфт 2', 'R:01.04.2026', 'L:Новый контакт']);
});
ok('FDX title page from Final Draft kept verbatim', () => {
  const P = (a, t, st) => '<Paragraph Alignment="' + a + '" FirstIndent="0.00" Leading="Regular" LeftIndent="1.00" RightIndent="7.50" SpaceBefore="0" Spacing="1" StartsNewPage="No">' + (t == null ? '' : '<Text AdornmentStyle="0" Font="Courier Final Draft" Size="12" Style="' + (st || '') + '">' + t + '</Text>') + '</Paragraph>';
  const tp = '<TitlePage><HeaderAndFooter FooterFirstPage="Yes"/><Content>' + P('Center', '') + P('Center', 'BRICK &amp; STEEL', 'Bold+Underline') + P('Center', '') + P('Center', 'Written by') + P('Center', 'Stu Maschwitz') + P('Center', 'Based on a story by KTM') +
    P('Left', 'Next Level Productions') + P('Left', '1588 Mission Dr.') + P('Right', 'Blue revision') + P('Right', 'January 20, 2012') + '</Content></TitlePage>';
  const xml = '<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content><Paragraph Type="Scene Heading"><Text>INT. HOUSE - DAY</Text></Paragraph><Paragraph Type="Action"><Text>They leave.</Text></Paragraph></Content>' + tp + '</FinalDraft>';
  const bl = C.importFDX(xml, DOMParser);
  assert.deepStrictEqual(bl.titlePage.fields, { title: 'BRICK & STEEL', author: 'Stu Maschwitz', draft: 'Blue revision', date: 'January 20, 2012', contact: 'Next Level Productions\n1588 Mission Dr.' });
  const p2 = { name: 'Сериал', author: 'Свой автор', rules: {}, chars: {}, locs: {}, episodes: [] }, ep2 = { id: 'n', season: 1, number: 1, title: '', blocks: bl, sceneMeta: {} }; p2.episodes.push(ep2);
  C.adoptTitlePage(bl.titlePage, ep2, p2, true);
  assert.deepStrictEqual([ep2.title, p2.author, p2.contact], ['BRICK & STEEL', 'Свой автор', 'Next Level Productions, 1588 Mission Dr.'], 'a project author already set is kept');
  const out = C.exportFDX(ep2, p2, C.analyzeEpisode(ep2, p2), {});
  const strip = (s) => s.replace(/\s+/g, '').replace(/<Paragraph([^>]*)><\/Paragraph>/g, '<Paragraph$1/>');
  const paras = (s) => (tpOf(s).match(/<Paragraph[\s\S]*?<\/Paragraph>|<Paragraph[^>]*\/>/g) || []).map(strip);
  assert.deepStrictEqual(paras(out), paras(tp.replace('<HeaderAndFooter FooterFirstPage="Yes"/>', '').replace('<TitlePage>', '<TitlePage>')), 'every paragraph, blank lines and styles included, written back');
  // a renamed project changes the title paragraph only, its style stays
  p2.name = 'Другое';
  assert.ok(/Style="Bold\+Underline">Другое<\/Text>/.test(C.exportFDX(ep2, p2, C.analyzeEpisode(ep2, p2), {})));
  // an older project file without a title page still exports one
  delete ep2.titlePage; assert.ok(tpTexts(C.exportFDX(ep2, p2, C.analyzeEpisode(ep2, p2), {}))[0] === 'C:ДРУГОЕ');
});

// КИТ Сценарист (.kitsp) and Story Architect (.starc): SQLite projects read with sql.js (synthetic files, tests/kitstarc_fixtures.js)
const kitStarc = async () => {
  const F = require('./kitstarc_fixtures.js');
  const fx = await F.build(), one = await F.build({ single: true });
  ok('kitsp: main text, mapping, scene card, title page', () => {
    const r = C.importSqliteProject(fx.SQL, fx.kitsp, DOMParser);
    assert.strictEqual(r.format, 'kitsp'); assert.strictEqual(r.scripts.length, 1);
    const raw = r.scripts[0].blocks;
    assert.deepStrictEqual(raw.titlePage.fields, { title: 'Квартирный вопрос', author: 'И. Петров', contact: 'petrov@example.ru' });
    const f = fin(raw);
    assert.deepStrictEqual(tx(f.blocks), ['scene|ИНТ. КВАРТИРА МАШИ - ДЕНЬ', 'action|Маша смотрит в окно. Петя & кот.', 'character|МАША', 'paren|(тихо)', 'dialogue|Ну и где он?', 'action|ТИТР: Москва, 1999',
      'character|МАША', 'dialogue|Да.', 'character|ПЕТЯ', 'dialogue|Нет.', 'transition|СМЕНА КАДРА:', 'scene|НАТ. ДВОР - НОЧЬ', 'action|Тишина.'], 'the draft row (is_draft = 1) is not read');
    assert.deepStrictEqual(f.blocks.filter((b) => b.dual).map((b) => b.x), ['ПЕТЯ'], 'the second column of splitter_start…splitter_end is the dual cue');
    const m = metaList(f)[0];
    assert.deepStrictEqual([m.num, m.synopsis, m.extras], ['5', 'Маша ждёт Петю.', ['СОСЕД']]);
    assert.deepStrictEqual(f.report.newChars.sort(), ['МАША', 'ПЕТЯ', 'СОСЕД']);
    assert.deepStrictEqual(f.report.newLocs.sort(), ['ДВОР', 'КВАРТИРА МАШИ']);
    // an export of the imported text is a normal .fdx
    const p = { name: 'Сериал', rules: {}, chars: {}, locs: {}, episodes: [] }, ep = { id: 'k', season: 1, number: 1, title: '', blocks: f.blocks, sceneMeta: f.sceneMeta };
    p.episodes.push(ep); C.adoptTitlePage(raw.titlePage, ep, p, true);
    assert.deepStrictEqual([ep.title, p.author, p.contact], ['Квартирный вопрос', 'И. Петров', 'petrov@example.ru']);
    const back = C.importFDX(C.exportFDX(ep, p, C.analyzeEpisode(ep, p), {}), DOMParser);
    assert.deepStrictEqual(tx(back).slice(0, 3), ['scene|ИНТ. КВАРТИРА МАШИ - ДЕНЬ', 'action|Маша смотрит в окно. Петя & кот.', 'character|МАША']);
  });
  ok('kitsp: only a draft, legacy time_and_place, old file without scenario_data', () => {
    const db = new fx.SQL.Database();
    db.run('CREATE TABLE scenario (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, is_draft INTEGER NOT NULL DEFAULT(0))');
    db.run("INSERT INTO scenario (text, is_draft) VALUES ('', 0)");
    db.run('INSERT INTO scenario (text, is_draft) VALUES (?, 1)', ['<scenario><time_and_place><v><![CDATA[ИНТ. ДАЧА - ВЕЧЕР]]></v></time_and_place><action><v><![CDATA[Тихо.]]></v></action><unknown_block><v>x</v></unknown_block></scenario>']);
    const r = C.importSqliteProject(fx.SQL, db.export(), DOMParser); db.close();
    assert.deepStrictEqual(tx(r.scripts[0].blocks), ['scene|ИНТ. ДАЧА - ВЕЧЕР', 'action|Тихо.']);
    assert.strictEqual(r.scripts[0].blocks.titlePage, undefined);
  });
  ok('starc: screenplays from the structure, drafts and the bin skipped, groups', () => {
    const r = C.importSqliteProject(fx.SQL, fx.starc, DOMParser);
    assert.strictEqual(r.format, 'starc');
    assert.deepStrictEqual(r.scripts.map((s) => s.name), ['Пилот', 'Серия 2 & финал']);
    const f = fin(r.scripts[0].blocks);
    assert.deepStrictEqual(tx(f.blocks), ['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Маша пьёт чай.', 'action|Вася молчит.', 'character|МАША', 'paren|(в сторону)', 'dialogue|<шёпотом> Тсс.', 'character|МАША', 'dialogue|Раз.', 'character|ВАСЯ', 'dialogue|Два.', 'shot|КРУПНО — ЧАШКА',
      'scene|УДАЛЕНА', 'scene|ИНТ. ПОДЪЕЗД - НОЧЬ', 'action|Темно.']);
    assert.deepStrictEqual(f.blocks.filter((b) => b.dual).map((b) => b.x), ['ВАСЯ'], 'params ifc="false" inside the splitter is the second column');
    const ms = metaList(f);
    assert.deepStrictEqual([ms[0].num, ms[0].day, ms[0].synopsis, ms[0].extras], ['7', '3', 'Завязка', ['ТЁТЯ']]);
    assert.ok(ms[1].omitted && ms[1].omittedHeading === 'НАТ. УЛИЦА - НОЧЬ' && ms[1].omittedBlocks.map((b) => b.t + '|' + b.x).join() === 'scene|НАТ. УЛИЦА - НОЧЬ,action|Дождь.');
    assert.strictEqual(f.blocks[11].id, ms[1].omittedBlocks[0].id, 'the omitted body starts with the scene itself');
    // a single screenplay: no choice to make
    const r1 = C.importSqliteProject(one.SQL, one.starc, DOMParser); assert.deepStrictEqual(r1.scripts.map((s) => s.name), ['Пилот']);
  });
  ok('starc: no structure document, BLOB or TEXT content, unknown and empty documents', () => {
    const db = new fx.SQL.Database();
    db.run('CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL, type INTEGER NOT NULL DEFAULT(0), content BLOB DEFAULT(NULL))');
    db.run('INSERT INTO documents (uuid, type, content) VALUES (?, ?, ?)', ['a', 10104, '<document><scene><content><scene_heading><v><![CDATA[НАТ. ПАРК - ДЕНЬ]]></v></scene_heading><beat_heading><v>бит</v></beat_heading><action><v><![CDATA[Ветер.]]></v></action></content></scene></document>']);
    db.run('INSERT INTO documents (uuid, type, content) VALUES (?, ?, ?)', ['b', 10104, null]);
    db.run('INSERT INTO documents (uuid, type, content) VALUES (?, ?, ?)', ['c', 101, new Uint8Array([1, 2, 3])]);
    const r = C.importSqliteProject(fx.SQL, db.export(), DOMParser); db.close();
    assert.deepStrictEqual(r.scripts.map((s) => tx(s.blocks)), [['scene|НАТ. ПАРК - ДЕНЬ', 'action|Ветер.']]);
  });
  ok('not a КИТ / STARC file', () => {
    assert.throws(() => C.importSqliteProject(fx.SQL, new TextEncoder().encode('<FinalDraft/>'), DOMParser), /не файл КИТ/);
    const db = new fx.SQL.Database(); db.run('CREATE TABLE other (x)');
    assert.throws(() => C.importSqliteProject(fx.SQL, db.export(), DOMParser), /нет сценария/); db.close();
  });
};
kitStarc().catch((e) => { console.log('FAIL kit/starc', e.message); process.exitCode = 1; })
  .then(() => console.log(process.exitCode ? 'test_io: FAILED' : 'test_io: ' + n + ' checks passed'));
