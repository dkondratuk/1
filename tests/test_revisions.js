// production revisions (WGA colours, marks against the revision base), locked pages (A-pages) and FDX revisions (node only)
require('../app/core.js'); const C = globalThis.Core;
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
// 1. WGA order with Russian names; the cycle restarts with «Вторая белая»
eq([0, 1, 2, 3, 4, 5, 6, 7, 8].map(C.revName), ['Белая', 'Голубая', 'Розовая', 'Жёлтая', 'Зелёная', 'Золотистая', 'Бежевая', 'Лососевая', 'Вишнёвая'], 'WGA order');
eq([9, 10, 17, 18].map(C.revName), ['Вторая белая', 'Вторая голубая', 'Вторая вишнёвая', 'Третья белая'], 'second cycle');
ok(/^#[0-9a-f]{6}$/.test(C.revColor(1)) && C.revColor(1) === C.revColor(10), 'colour per set');
// 2. marks: text change, type change, new block, the block after a deletion; the highest level wins, earlier ones stay
const B = (id, t, x) => ({ id, t, x });
const orig = [B('a', 'scene', 'ИНТ. КУХНЯ - ДЕНЬ'), B('b', 'action', 'Маша варит кофе.'), B('c', 'character', 'МАША'), B('d', 'dialogue', 'Доброе утро.'), B('e', 'action', 'Входит Петя.'), B('f', 'action', 'Конец.')];
const r1 = C.newRevision(0, orig, 'Продюсер');
ok(r1.level === 1 && r1.name === 'Голубая' && r1.base.length === 6 && r1.base[0] !== orig[0], 'revision 1 copies the text');
let cur = orig.map((b) => Object.assign({}, b));
cur[1].x = 'Маша варит крепкий кофе.';           // text change
cur[4].t = 'character';                           // type change
cur.splice(3, 0, B('g', 'paren', '(сонно)'));      // new block
cur = cur.filter((b) => b.id !== 'f');             // deleted at the end: the last block is marked
eq(C.revMarks(cur, [r1]), [0, 1, 0, 1, 0, 1], 'level-1 marks');
ok(C.revMarks(orig, [r1]).every((x) => x === 0), 'unchanged text has no marks');
const r2 = C.newRevision(1, cur, 'Редактор');
ok(r2.level === 2 && r2.name === 'Розовая', 'revision 2');
const cur2 = cur.map((b) => Object.assign({}, b));
cur2[0].x = 'ИНТ. КУХНЯ - НОЧЬ';                   // changed in revision 2
cur2.splice(4, 1);                                 // dialogue d deleted: the next block (e) is marked
eq(C.revMarks(cur2, [r1, r2]), [2, 1, 0, 1, 2], 'level 2 over level 1, earlier marks remain');
// a block edited again in revision 2 takes level 2
cur2[1].x += ' Очень.'; eq(C.revMarks(cur2, [r1, r2])[1], 2, 'highest level');
// 3. analyzeEpisode exposes the marks; FDX writes the sets and RevisionID, reads them back
const p = C.demoProject(); const ep = p.episodes[0];
const st0 = C.analyzeEpisode(ep, p);
ok(st0.revs === null, 'no revisions: no marks');
const fdx0 = C.exportFDX(ep, p, st0, {});
ok(!/Revisions|RevisionID="[1-9]/.test(fdx0), 'FDX without revisions unchanged');
ep.revisions = [C.newRevision(0, ep.blocks, 'Продюсер')]; ep.revLevel = 1;
const k = ep.blocks.findIndex((b) => b.t === 'action');
ep.blocks[k].x += ' Новая фраза.';
const st1 = C.analyzeEpisode(ep, p);
ok(st1.revs[k] === 1 && st1.revs.filter(Boolean).length === 1, 'one marked block');
const fdx1 = C.exportFDX(ep, p, st1, {});
ok(/<Revisions ActiveSet="1" Location="7.75" RevisionMode="Active" RevisionsShown="Active" ShowAllMarks="No" ShowAllSets="No" ShowPageColor="No">/.test(fdx1), 'Revisions element');
ok(/<Revision Color="#[0-9A-F]{12}" FullRevision="No" ID="1" Mark="\*" Name="Голубая" Style=""\/>/.test(fdx1), 'Revision set 1');
ok((fdx1.match(/<Text RevisionID="1">/g) || []).length === 1, 'RevisionID on the revised run');
ok(C.fdxActiveSet(fdx1) === 1 && C.fdxActiveSet('<Revisions ActiveSet="2" RevisionMode="Off">') === 0, 'active set');
let DP = null; try { DP = require('@xmldom/xmldom').DOMParser; } catch (e) { try { DP = require('xmldom').DOMParser; } catch (e2) {} }
if (DP) {
  const bl = C.importFDX(fdx1, DP);
  ok(bl.filter((b) => b.rev === 1).length === 1 && /Новая фраза/.test(bl.find((b) => b.rev === 1).x), 'RevisionID read back');
  const rv = C.revisionsFromMarks(bl, C.fdxActiveSet(fdx1), 1);
  ok(rv.revLevel === 1 && rv.revisions[0].name === 'Голубая', 'revisions rebuilt from marks');
  eq(C.revMarks(bl, rv.revisions), bl.map((b) => b.rev || 0), 'rebuilt bases give the same marks');
  ok(C.revisionsFromMarks(C.importFDX(fdx0, DP), 1) === null, 'plain FD file starts no revision');
} else console.log('xmldom not found: FDX import checks skipped');
const mk = [{ rev: 2 }, {}, { rev: 1 }].map((b, i) => Object.assign({ id: 'm' + i, t: 'action', x: 'x' + i }, b));
const rm = C.revisionsFromMarks(mk, 0, 1);
eq(C.revMarks(mk, rm.revisions), [2, 0, 1], 'two levels from marks');
// 4. mark column: 7.6 in on Letter, outside the text and inside the sheet on every template
ok(C.revMarkX(C.PAPER.letter) === 7.6, 'Letter 7.6in');
for (const k2 of ['a4', 'a4ru']) { const pp = C.PAPER[k2], x = C.revMarkX(pp); ok(x > pp.w - pp.right && x < pp.w - 0.2, k2 + ' mark inside the sheet: ' + x); }

// 5. locked pages
const lines = (k, tag) => Array.from({ length: k }, (_, j) => B(tag + j, 'action', 'Строка ' + tag + j + '.'));
// 40 one-line actions = 2 per 2 lines... each action takes sb 1 + 1 line: 27 per 54-line page
const doc = lines(80, 'a');
const L0 = C.paginate(doc, { lines: 54 });
const plain = JSON.stringify(L0);
ok(JSON.stringify(C.paginate(doc, { lines: 54, pageLock: null })) === plain, 'no lock: layout identical');
eq(L0.labels, ['1', '2', '3'], 'plain labels');
const lock = C.pageLockFrom(L0, doc);
ok(lock.pages.length === 3 && lock.pages[1].id === doc[L0.pages[1].items[0].i].id && !lock.pages[1].mid, 'lock records page starts');
const L1 = C.paginate(doc, { lines: 54, pageLock: lock });
eq(L1.pages.map((pg) => pg.items.map((it) => it.i)), L0.pages.map((pg) => pg.items.map((it) => it.i)), 'locked, unchanged: same pages');
eq(L1.labels, ['1', '2', '3'], 'locked labels');
// add 10 blocks on page 1: page 1A appears, page 2 starts with the same block
const s2 = L0.pages[1].items[0].i;
const grown = doc.slice(0, 5).concat(lines(10, 'n'), doc.slice(5));
const L2 = C.paginate(grown, { lines: 54, pageLock: lock });
eq(L2.labels, ['1', '1A', '2', '3'], 'A-page after page 1');
ok(grown[L2.pages[2].items[0].i].id === doc[s2].id, 'page 2 keeps its first block');
const U2 = C.paginate(grown, { lines: 54 });
ok(U2.pages.length === 4 && grown[U2.pages[1].items[0].i].id !== doc[s2].id, 'without the lock the text would shift');
// more text: 1B
const grown2 = doc.slice(0, 5).concat(lines(40, 'm'), doc.slice(5));
eq(C.paginate(grown2, { lines: 54, pageLock: lock }).labels, ['1', '1A', '1B', '2', '3'], '1B');
// page 1 loses text: it stays short, page 2 does not move up
const shrunk = doc.filter((b, i) => i < 3 || i > 10);
const L3 = C.paginate(shrunk, { lines: 54, pageLock: lock });
eq(L3.labels, ['1', '2', '3'], 'short page keeps numbers');
ok(shrunk[L3.pages[1].items[0].i].id === doc[s2].id && L3.pages[0].items.length === s2 - 8, 'page 1 is short');
// the first block of page 2 deleted: page 2 starts with the next one of its blocks
const noStart = doc.filter((b, i) => i !== s2);
const L4 = C.paginate(noStart, { lines: 54, pageLock: lock });
ok(L4.labels.join() === '1,2,3' && noStart[L4.pages[1].items[0].i].id === doc[s2 + 1].id, 'page start deleted');
// a block moved from page 3 to page 1 counts as new text on page 1
const mv = doc.slice(); const [moved] = mv.splice(70, 1); mv.splice(2, 0, moved);
const L5 = C.paginate(mv, { lines: 54, pageLock: lock });
ok(L5.labels.join() === '1,1A,2,3' && mv[L5.pages[2].items[0].i].id === doc[s2].id, 'moved block flows into 1A: ' + L5.labels);
// a page that started inside a long block
const long = [B('h', 'scene', 'ИНТ. ДОМ - ДЕНЬ')].concat(lines(20, 'p'), [B('big', 'action', Array.from({ length: 40 }, (_, j) => 'Фраза номер ' + j + ' идёт дальше.').join(' '))], lines(30, 'q'));
const M0 = C.paginate(long, { lines: 54 });
const ml = C.pageLockFrom(M0, long);
ok(ml.pages.some((pg) => pg.mid && pg.id === 'big'), 'mid-block page start recorded');
eq(C.paginate(long, { lines: 54, pageLock: ml }).labels, M0.labels, 'mid-block lock keeps the layout');
eq(C.paginate(long, { lines: 54, pageLock: ml }).pages.map((pg) => pg.items.length), M0.pages.map((pg) => pg.items.length), 'mid-block lock: same items');
// analyzeEpisode: page labels in scenes, timing from the text, not from the short/A pages
const ep2 = { blocks: [B('s1', 'scene', 'ИНТ. ОФИС - ДЕНЬ')].concat(lines(60, 'x'), [B('s2', 'scene', 'НАТ. ДВОР - НОЧЬ')], lines(30, 'y')), sceneMeta: {} };
const pr = { rules: {}, chars: {}, locs: {} };
const A0 = C.analyzeEpisode(ep2, pr);
ep2.pageLock = C.pageLockFrom(A0.lay, ep2.blocks);
ep2.blocks.splice(3, 0, ...lines(12, 'z'));
const A1 = C.analyzeEpisode(ep2, pr);
ok(A1.lay.labels.includes('1A'), 'analyze: A-page');
ok(Math.abs(A1.pages - C.paginate(ep2.blocks, { lines: 54 }).total) < 1e-9, 'timing counts the text');
ok(A1.scenes[1].page === A0.scenes[1].page, 'scene 2 keeps its page: ' + A1.scenes[1].page);
ok(new RegExp('Number="2" Type="Scene Heading"><SceneProperties[^>]*Page="' + A1.scenes[1].page + '"').test(C.exportFDX(ep2, pr, A1, {})), 'FDX scene page label');
console.log('test_revisions: ' + n + ' checks passed');
