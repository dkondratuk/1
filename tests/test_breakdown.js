// script breakdown (node only): anchoring tags to text, per-scene items, studio special scenes, merge and the .xlsx workbook
require('../app/core.js'); const C = globalThis.Core;
const assert = require('assert');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const tags$ = (d, tag) => { const l = d.getElementsByTagName(tag); return Array.from({ length: l.length }, (_, i) => l.item(i)); };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const B = (id, t, x) => ({ id, t, x });
const proj = { rules: {}, chars: { 'МАША': {}, 'ПЕТЯ': {} }, locs: { 'КВАРТИРА': { pav: true } } };
const blocks = [
  B('s1', 'scene', 'ИНТ. КВАРТИРА. КУХНЯ - ДЕНЬ'), B('a1', 'action', 'Маша достаёт пистолет из ящика. Пистолет блестит.'), B('c1', 'character', 'МАША'), B('d1', 'dialogue', 'Где собака?'),
  B('s2', 'scene', 'НАТ. ДВОР - НОЧЬ'), B('a2', 'action', 'Петя прыгает с крыши. Во дворе лает собака, толпа зевак.'), B('c2', 'character', 'ПЕТЯ'), B('d2', 'dialogue', 'Пистолет у тебя?'),
  B('s3', 'scene', 'ИНТ. КВАРТИРА. КОРИДОР - ДЕНЬ'), B('a3', 'action', 'Маша прячет пистолет. На ней красное платье.'),
];
const T = (id, blockId, quote, cat, note, at) => ({ id, blockId, quote, cat, note: note || '', at });
const ep = { id: 'e', season: 1, number: 1, title: '', blocks: JSON.parse(JSON.stringify(blocks)), sceneMeta: {}, tags: [
  T('t1', 'a1', 'пистолет', 'props', 'травматический'), T('t2', 'a2', 'прыгает с крыши', 'stunts', 'каскадёр'), T('t3', 'a2', 'собака', 'animals'),
  T('t4', 'a2', 'толпа зевак', 'extras', '20 чел.'), T('t5', 'a3', 'пистолет', 'props'), T('t6', 'a3', 'красное платье', 'costume'), T('t7', 'a1', 'Пистолет', 'props', '', 37),
] };

// 1. categories: twelve, Russian names, a colour each, ids unique
eq(C.BREAKDOWN.map((c) => c.name), ['Реквизит', 'Костюм', 'Грим', 'Транспорт', 'Массовка', 'Трюки', 'Животные', 'Спецэффекты', 'Звук/музыка', 'Оружие', 'Декорация', 'Персонаж-эпизод'], 'categories');
ok(C.BREAKDOWN.every((c) => /^#[0-9a-f]{6}$/.test(c.color)) && new Set(C.BREAKDOWN.map((c) => c.id)).size === 12, 'colours and ids');

// 2. per scene, deduplicated by name (case, ё, trailing punctuation), notes kept
let st = C.analyzeEpisode(ep, proj);
eq(st.scenes[0].bd, { props: [{ name: 'Пистолет', note: 'травматический' }] }, 'scene 1: one prop for two tags of the same word');
eq(Object.keys(st.scenes[1].bd).sort(), ['animals', 'extras', 'stunts'], 'scene 2 categories');
eq(st.scenes[2].bd.costume[0].name, 'Красное платье', 'capitalised name');
const items = C.breakdownItems(st);
const gun = items.find((i) => i.cat === 'props' && i.name === 'Пистолет');
eq(gun.scenes, ['1', '3'], 'prop across scenes 1 and 3');
eq(items.map((i) => i.cat), ['props', 'costume', 'extras', 'stunts', 'animals'], 'items in category order');
const byObj = C.breakdownByObject(st);
const flat = byObj.find((o) => o.name === 'КВАРТИРА');
ok(flat && flat.scenes.join() === '1,3' && flat.cats.props.length === 1 && flat.cats.costume[0] === 'Красное платье', 'per object summary: ' + JSON.stringify(flat));

// 3. studio rules: Трюки / Животные in the breakdown make the scene special once, even with the scene tag as well
const base = C.analyzeEpisode({ ...ep, tags: [] }, proj);
ok(!base.scenes[1].special && st.scenes[1].special, 'breakdown stunts make scene 2 special');
eq(st.scenes[1].bdTags, ['stunts', 'animals'], 'derived special tags');
ok(st.scenes[1].shifts > base.scenes[1].shifts * 2, 'special shift rate applies');
const both = C.analyzeEpisode({ ...ep, sceneMeta: { s2: { tags: ['stunts'] } } }, proj);
eq(both.scenes[1].bdTags, ['animals'], 'a scene tag already set is not repeated');
eq(both.scenes[1].shifts, st.scenes[1].shifts, 'no double count: same shifts');
eq(both.specialMin, st.specialMin, 'no double count: same special minutes');
const rule = C.evalRules(ep, proj, st, null).find((r) => r.id === 'special' || /Дети, животные/.test(r.title));
ok(rule && rule.details.some((d) => /Трюки \(по разбивке\)/.test(d.text)), 'rule names the breakdown source: ' + JSON.stringify(rule && rule.details));

// 4. anchoring: an edit inside the element keeps the tag; a join moves it; deleted text marks it lost
const tags = JSON.parse(JSON.stringify(ep.tags));
let cur = JSON.parse(JSON.stringify(blocks));
cur[1].x = 'Медленно ' + cur[1].x;
eq(C.anchorTags(cur, tags, blocks), 0, 'edit in place: nothing moves');
// join a2 into c1's place: a2 disappears, its text ends up in the element before it
const prev = cur; cur = cur.slice(); cur[4] = { ...cur[4] }; cur.splice(5, 1); cur[4].x = 'НАТ. ДВОР - НОЧЬ ' + blocks[5].x;
eq(C.anchorTags(cur, tags, prev), 3, 'three tags followed the joined text');
ok(tags.filter((t) => ['t2', 't3', 't4'].includes(t.id)).every((t) => t.blockId === 's2' && !t.lost), 'tags now on s2');
cur[8] = { ...cur[8], x: 'Маша прячет нож. На ней красное платье.' };
C.anchorTags(cur, tags, cur);
ok(tags.find((t) => t.id === 't5').lost && !tags.find((t) => t.id === 't6').lost, 'deleted text: tag lost, not moved to another scene');
ok(tags.find((t) => t.id === 't5').blockId === 'a3', 'a lost tag keeps its element, so it comes back with the text');
ok(!C.analyzeEpisode({ ...ep, blocks: cur, tags }, proj).scenes[2].bd.props, 'lost tag counts nowhere');
cur[8] = { ...cur[8], x: 'Маша прячет пистолет. На ней красное платье.' }; C.anchorTags(cur, tags, cur);
ok(!tags.find((t) => t.id === 't5').lost, 'the text is back: so is the tag');
// a word tagged elsewhere: the nearest element from the old place wins
const t8 = { id: 't8', blockId: 'gone', quote: 'пистолет', cat: 'props' };
C.anchorTags(blocks, [t8], [...blocks.slice(0, 9), { id: 'gone' }]);
eq(t8.blockId, 'a3', 'nearest to the old position');
eq(C.findAnchor(['a', 'xb', 'c', 'xb'], 'xb', 3), 3, 'findAnchor start');
eq(C.findAnchor(['a', 'xb', 'c', 'd'], 'xb', 2), 1, 'findAnchor earlier first');
eq(C.findAnchor(['a'], 'z', 0), -1, 'findAnchor none');
eq(C.findAnchor(['xb', 'a', 'c', 'd', 'e'], 'xb', 4, 3), -1, 'findAnchor reach');
eq(C.quoteAt('Пистолет и пистолет. Пистолет', 'Пистолет', 25), 21, 'quoteAt picks the nearest occurrence');

// 5. merge: union by id, removals on either side stay removed; older projects without tags are fine
const m = C.mergeTags({ tags: [T('a', 'x', 'q', 'props'), T('b', 'x', 'q', 'props')], untagged: ['c'] }, { tags: [T('b', 'x', 'q', 'props'), T('c', 'x', 'q', 'sfx'), T('d', 'x', 'q', 'sound')], untagged: ['a'] });
eq(m.tags.map((t) => t.id), ['b', 'd'], 'merge');
eq(m.untagged.sort(), ['a', 'c'], 'merge untagged');
eq(C.mergeTags({}, {}).tags, [], 'no tags at all');
const old = C.analyzeEpisode({ id: 'o', blocks, sceneMeta: {} }, proj);
ok(old.scenes.every((s) => s.bd && !Object.keys(s.bd).length && !s.bdTags.length), 'episode without ep.tags');

// 6. workbook: parts, well-formed XML, Cyrillic sheet names and cells, bold header style, columns
(async () => {
  const files = C.breakdownXLSX(ep, proj, st);
  for (const k of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet4.xml']) ok(files[k], 'part ' + k);
  const z = new JSZip(); Object.entries(files).forEach(([k, v]) => z.file(k, v));
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  const z2 = await JSZip.loadAsync(buf);
  const errs = [];
  const parse = async (k) => {
    const xml = await z2.file(k).async('string');
    const doc = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') errs.push(k + ': ' + msg); } }).parseFromString(xml, 'text/xml');
    return doc;
  };
  for (const k of Object.keys(z2.files)) if (!z2.files[k].dir) await parse(k);
  eq(errs, [], 'all parts are well-formed XML');
  const wb = await parse('xl/workbook.xml');
  eq(tags$(wb, 'sheet').map((s) => s.getAttribute('name')), ['Сцены', 'Объекты', 'Персонажи', 'Разбивка'], 'sheet names');
  const rels = await parse('xl/_rels/workbook.xml.rels');
  ok(tags$(rels, 'Relationship').some((r) => r.getAttribute('Target') === 'styles.xml'), 'styles related');
  const styles = await parse('xl/styles.xml');
  ok(styles.getElementsByTagName('font')[1].getElementsByTagName('b').length === 1, 'bold font for the header');
  const rows = async (i) => {
    const d = await parse('xl/worksheets/sheet' + i + '.xml');
    return tags$(d, 'row').map((r) => {
      const out = [];
      for (const c of tags$(r, 'c')) {
        const col = c.getAttribute('r').replace(/\d+$/, ''); let k = 0; for (const ch of col) k = k * 26 + ch.charCodeAt(0) - 64;
        const t = c.getElementsByTagName('t')[0], v = c.getElementsByTagName('v')[0];
        out[k - 1] = t ? t.textContent : v ? +v.textContent : '';
        if (r.getAttribute('r') === '1') ok(c.getAttribute('s') === '1', 'header cell bold: ' + col);
      }
      return out;
    });
  };
  const sc = await rows(1);
  eq(sc[0].slice(0, 10), ['№', 'Заголовок', 'Объект', 'Режим', 'ИНТ/НАТ/ПАВ', 'Сценарный день', 'Страницы', 'Хронометраж', 'Персонажи', 'Массовка'], 'scene columns');
  eq(sc[0].length, 10 + 11, 'one column per category (Массовка once)');
  eq(sc.length, 4, 'one row per scene');
  const col = (name) => sc[0].indexOf(name);
  eq(sc[1][col('Объект')], 'КВАРТИРА', 'object');
  eq(sc[1][col('ИНТ/НАТ/ПАВ')], 'ИНТ. (пав.)', 'pavilion by the project');
  eq(sc[2][col('Режим')], 'НОЧЬ', 'time of day');
  ok(/^(\d+ )?\d\/8$|^\d+$/.test(sc[1][col('Страницы')]), 'pages in eighths: ' + sc[1][col('Страницы')]);
  ok(/^\d+:\d\d$/.test(sc[1][col('Хронометраж')]), 'timing m:ss');
  eq(sc[2][col('Персонажи')], 'ПЕТЯ', 'cast');
  eq(sc[2][col('Массовка')], 'Толпа зевак', 'crowd from the breakdown');
  eq(sc[2][col('Трюки')], 'Прыгает с крыши', 'stunts column');
  eq(sc[1][col('Реквизит')], 'Пистолет', 'props column');
  const ob = await rows(2);
  eq(ob[0], ['Объект', 'Павильон', 'Сцен', 'Страницы', 'Хронометраж', '%', 'Смен'], 'objects header');
  ok(ob.some((r) => r[0] === 'КВАРТИРА' && r[1] === 'да' && r[2] === 2 && typeof r[5] === 'number'), 'objects row');
  const ch = await rows(3);
  ok(ch.some((r) => r[0] === 'МАША' && r[1] === 1 && r[2] === 1 && /^0:\d\d$/.test(r[3])), 'characters: ' + JSON.stringify(ch));
  const bd = await rows(4);
  eq(bd[0], ['Категория', 'Элемент', 'Сцены', 'Сцен', 'Примечание'], 'breakdown header');
  ok(bd.some((r) => r[0] === 'Реквизит' && r[1] === 'Пистолет' && r[2] === '1, 3' && r[3] === 2 && r[4] === 'травматический'), 'breakdown row');
  ok(bd.some((r) => r[0] === 'Трюки' && r[4] === 'каскадёр'), 'note');
  // characters that XML forbids are dropped, markup is escaped
  const ep2 = { ...ep, tags: [T('z', 'a1', 'Маша', 'cameo', 'a<b>&"\u0001')] };
  const f2 = C.breakdownXLSX(ep2, proj, C.analyzeEpisode(ep2, proj));
  const e2 = []; new DOMParser({ onError: (l, msg) => { if (l !== 'warning') e2.push(msg); } }).parseFromString(f2['xl/worksheets/sheet4.xml'], 'text/xml');
  eq(e2, [], 'escaped text stays well-formed');
  ok(f2['xl/worksheets/sheet4.xml'].includes('a&lt;b&gt;&amp;&quot;<'), 'escaped note');
  console.log('test_breakdown: ' + n + ' checks ok');
})().catch((e) => { console.error(e); process.exit(1); });
