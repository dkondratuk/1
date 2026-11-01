// regression checks for the numbering lock, omitted scenes and FDX geometry (node only)
require('../app/core.js'); const C = globalThis.Core;
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
// 1. omitted markers in Russian are recognised (no ASCII \b after Cyrillic)
ok(C.OMIT_RE.test('УДАЛЕНА') && C.OMIT_RE.test('ОПУЩЕНА 12') && C.OMIT_RE.test('OMITTED') && !C.OMIT_RE.test('УДАЛЕНАЯ'), 'OMIT_RE');
// 2. A-numbers before the first scene: A1, B1; after A1 and before 1 → B1
const sc = (a) => a.map((x, i) => ({ id: 's' + i, num: x || String(i + 1), fileNum: !!x }));
assert.deepStrictEqual(C.lockAssign(sc([null, null, '1']), {}).map((x) => x.num), ['A1', 'B1']); n++;
assert.deepStrictEqual(C.lockAssign(sc(['A1', null, '1', null, '2']), {}).map((x) => x.num), ['B1', '1A']); n++;
assert.deepStrictEqual(C.lockAssign(sc(['1', null, null, '2']), {}).map((x) => x.num), ['1A', '1B']); n++;
// 3. restoring a missing locked number goes behind A-scenes added after the lock
const lock = { nums: ['1', '2', '3', '4'].map((num) => ({ num })) };
const scenes = [['1', 0, 1], ['2', 2, 3], ['2A', 4, 5], ['2B', 6, 7], ['4', 8, 9]].map(([num, from, to]) => ({ num, from, to }));
ok(C.lockInsertIndex(lock, scenes, '3', 10) === 8, 'lockInsertIndex after 2B');
// 4. an omitted scene is not material: rules and line shares skip it
const p = C.demoProject(); const ep = p.episodes[0];
const st0 = C.analyzeEpisode(ep, p);
const s3 = st0.scenes[2];
ep.blocks.splice(s3.from, s3.to - s3.from + 1, { id: s3.id, t: 'scene', x: 'УДАЛЕНА' });
ep.sceneMeta = ep.sceneMeta || {}; ep.sceneMeta[s3.id] = { num: '3', omitted: true };
const st = C.analyzeEpisode(ep, p);
const rules = C.evalRules(ep, p, st);
const short = rules.find((r) => r.id === 'short');
ok(!short.details.some((d) => /УДАЛЕНА/.test(d.text)), 'short rule skips omitted');
const bal = rules.find((r) => r.id === 'balance');
ok(/из 5$/.test(bal.value), 'balance denominator without omitted: ' + bal.value);
ok(st.unassigned.scenes === 5 || st.lines.reduce((a, l) => a + l.scenes, 0) + st.unassigned.scenes === 5, 'line shares skip omitted');
// a heading typed by hand as УДАЛЕНА is an omitted scene even without meta
const ep2 = { blocks: [{ id: 'a', t: 'scene', x: 'УДАЛЕНА' }, { id: 'b', t: 'scene', x: 'ИНТ. ОФИС - ДЕНЬ' }], sceneMeta: {} };
ok(C.analyzeEpisode(ep2, p).scenes[0].omitted, 'typed УДАЛЕНА is omitted');
// 5. FDX: indents from the page edge (Final Draft convention), no non-FD PageLayout attributes, no УДАЛЕНА location
const fdx = C.exportFDX(ep, p, st, {});
ok(/ElementSettings Type="Action">.*LeftIndent="1\.50" RightIndent="7\.50"/.test(fdx), 'Action indents 1.50/7.50');
ok(!/PaperWidth|LeftMargin/.test(fdx), 'PageLayout without PaperWidth/LeftMargin');
ok(!/<Location>УДАЛЕНА/.test(fdx) && /OMITTED/.test(fdx), 'omitted scene exported as OMITTED, not a location');
// 6. FDX import: Final Draft's <OmittedScene> body is not resurrected; Russian omitted heading is flagged
let DP = null; try { DP = require('@xmldom/xmldom').DOMParser; } catch (e) { try { DP = require('xmldom').DOMParser; } catch (e2) {} }
if (DP) {
  const xml = '<?xml version="1.0"?><FinalDraft><Content>' +
    '<Paragraph Type="Scene Heading" Number="1"><Text>ИНТ. ОФИС - ДЕНЬ</Text></Paragraph>' +
    '<Paragraph Type="Action"><Text>Текст.</Text></Paragraph>' +
    '<Paragraph Type="Scene Heading" Number="2"><OmittedScene><Paragraph Type="Scene Heading"><Text>НАТ. ДВОР - НОЧЬ</Text></Paragraph><Paragraph Type="Action"><Text>Мёртвый текст.</Text></Paragraph></OmittedScene><Text>OMITTED</Text></Paragraph>' +
    '<Paragraph Type="Scene Heading" Number="3"><Text>ОПУЩЕНА</Text></Paragraph>' +
    '</Content></FinalDraft>';
  const bl = C.importFDX(xml, DP);
  ok(!bl.some((b) => /Мёртвый|ДВОР/.test(b.x)), 'OmittedScene body skipped: ' + JSON.stringify(bl));
  ok(bl.filter((b) => b.omitted).length === 2, 'two omitted scenes flagged');
} else console.log('xmldom not found: FDX import checks skipped');
// 7. paper geometry: the text column matches the action width on every template
for (const k of ['letter', 'a4', 'a4ru']) { const pp = C.paperOf({ paper: k }); ok(Math.abs((pp.w - pp.left - pp.right) - pp.fmt.action.width / 10) < 0.01, k + ' text column'); }
// 8. PDF import ignores rotated watermarks and the small footer stamp
const pg = [[{ str: 'ИНТ. ОФИС - ДЕНЬ', x: 108, y: 700, w: 100, h: 12 }, { str: 'Текст сцены.', x: 108, y: 676, w: 80, h: 12 },
  { str: 'Актёр · 01.11.2026', x: 200, y: 400, w: 200, h: 30, rot: true }, { str: 'Экземпляр: Актёр · 01.11.2026', x: 200, y: 30, w: 120, h: 8 }]];
const pl = C.pdfLines(pg).map((l) => l.text);
ok(pl.length === 2 && !pl.some((t) => /Актёр/.test(t)), 'pdfLines drops watermark and footer: ' + JSON.stringify(pl));
console.log('test_lock: ' + n + ' checks passed');
