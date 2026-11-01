// production drafts (numbered «Драфт N», marks against the previous draft), locked pages (A-pages) and FDX revisions (node only)
require('../app/core.js'); const C = globalThis.Core;
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
// 1. drafts are named by number: the original is «Драфт 1», every new one counts up, with no colour names
eq([0, 1, 2, 3, 9, 18].map(C.revName), ['Драфт 1', 'Драфт 2', 'Драфт 3', 'Драфт 4', 'Драфт 10', 'Драфт 19'], 'numbered drafts');
eq([0, 1, 9, 18].map(C.revColorName), ['Белая', 'Голубая', 'Вторая белая', 'Третья белая'], 'WGA names kept only for FDX/old files');
ok(/^#[0-9a-f]{6}$/.test(C.revColor(1)) && C.revColor(1) === C.revColor(10), 'colour per set');
// 2. marks: text change, type change, new block, the block after a deletion; the highest level wins, earlier ones stay
const B = (id, t, x) => ({ id, t, x });
const orig = [B('a', 'scene', 'ИНТ. КУХНЯ - ДЕНЬ'), B('b', 'action', 'Маша варит кофе.'), B('c', 'character', 'МАША'), B('d', 'dialogue', 'Доброе утро.'), B('e', 'action', 'Входит Петя.'), B('f', 'action', 'Конец.')];
const r1 = C.newRevision(0, orig, 'Продюсер');
ok(r1.level === 1 && r1.name === 'Драфт 2' && r1.base.length === 6 && r1.base[0] !== orig[0], 'revision 1 copies the text');
let cur = orig.map((b) => Object.assign({}, b));
cur[1].x = 'Маша варит крепкий кофе.';           // text change
cur[4].t = 'character';                           // type change
cur.splice(3, 0, B('g', 'paren', '(сонно)'));      // new block
cur = cur.filter((b) => b.id !== 'f');             // deleted at the end: the last block is marked
eq(C.revMarks(cur, [r1]), [0, 1, 0, 1, 0, 1], 'level-1 marks');
ok(C.revMarks(orig, [r1]).every((x) => x === 0), 'unchanged text has no marks');
const r2 = C.newRevision(1, cur, 'Редактор');
ok(r2.level === 2 && r2.name === 'Драфт 3', 'revision 2');
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
ok(/<Revision Color="#[0-9A-F]{12}" FullRevision="No" ID="1" Mark="\*" Name="Драфт 2" Style=""\/>/.test(fdx1), 'Revision set 1');
ok((fdx1.match(/<Text RevisionID="1">/g) || []).length === 1, 'RevisionID on the revised run');
ok(C.fdxActiveSet(fdx1) === 1 && C.fdxActiveSet('<Revisions ActiveSet="2" RevisionMode="Off">') === 0, 'active set');
let DP = null; try { DP = require('@xmldom/xmldom').DOMParser; } catch (e) { try { DP = require('xmldom').DOMParser; } catch (e2) {} }
if (DP) {
  const bl = C.importFDX(fdx1, DP);
  ok(bl.filter((b) => b.rev === 1).length === 1 && /Новая фраза/.test(bl.find((b) => b.rev === 1).x), 'RevisionID read back');
  const rv = C.revisionsFromMarks(bl, C.fdxActiveSet(fdx1), 1);
  ok(rv.revLevel === 1 && rv.revisions[0].name === 'Драфт 2', 'revisions rebuilt from marks');
  eq(C.revMarks(bl, rv.revisions), bl.map((b) => b.rev || 0), 'rebuilt bases give the same marks');
  ok(C.revisionsFromMarks(C.importFDX(fdx0, DP), C.fdxActiveSet(fdx0)) === null, 'plain FD file starts no revision');
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

// 6. regressions: what the changed pages must carry under a page lock
{
  const doc6 = [B('h', 'scene', 'ИНТ. ДОМ - ДЕНЬ')].concat(lines(150, 'L'));
  const P0 = C.paginate(doc6, { lines: 54 }), lk = C.pageLockFrom(P0, doc6), rv = C.newRevision(0, doc6, 'Редактор');
  const ids = (k) => P0.pages[k].items.map((it) => doc6[it.i].id), p3 = ids(2);
  const marked = (bl) => { const L = C.paginate(bl, { lines: 54, pageLock: lk }), m = C.revMarks(bl, [rv], lk); return { labels: L.labels.join(), pages: L.labels.filter((l, k) => L.pages[k].items.some((it) => m[it.i])) }; };
  // the bottom of page 3 deleted: page 3 carries the mark (it changed), not the first line of locked page 4
  let r6 = marked(doc6.filter((b) => !p3.slice(-3).includes(b.id)));
  eq([r6.labels, r6.pages], ['1,2,3,4,5,6', ['3']], 'deletion at the bottom of a locked page marks that page');
  // everything on page 3 deleted: page 2 becomes 2-3 and carries the mark, so the old page 3 is replaced too
  r6 = marked(doc6.filter((b) => !p3.includes(b.id)));
  eq([r6.labels, r6.pages], ['1,2-3,4,5,6', ['2-3']], 'emptied locked page: 2-3');
  r6 = marked(doc6.filter((b) => !ids(0).includes(b.id)));
  eq(r6.labels, '1-2,3,4,5,6', 'emptied first page: 1-2');
  // without a lock a deletion still marks the next line
  eq(C.revMarks(doc6.filter((b) => !p3.slice(-3).includes(b.id)), [rv]).findIndex(Boolean), p3.length - 3 + doc6.indexOf(doc6.find((b) => b.id === p3[0])), 'no lock: the next block is marked');
  // an omitted scene: «УДАЛЕНА» stays on its page and is the only mark (the next scene's heading did not change)
  const sc = []; for (let s = 1; s <= 4; s++) { sc.push(B('S' + s, 'scene', 'ИНТ. КОМНАТА ' + s + ' - ДЕНЬ')); sc.push(...lines(30, 'A' + s + '_')); }
  const Q0 = C.paginate(sc, { lines: 54 }), lk2 = C.pageLockFrom(Q0, sc), rv2 = C.newRevision(0, sc, 'Редактор');
  const om = sc.filter((b) => !/^A2_/.test(b.id)).map((b) => (b.id === 'S2' ? B('S2', 'scene', C.omittedHeading('2')) : b));
  const Q1 = C.paginate(om, { lines: 54, pageLock: lk2 }), m2 = C.revMarks(om, [rv2], lk2);
  const pageOf = (L, bl, id) => L.labels[L.pages.findIndex((pg) => pg.items.some((it) => bl[it.i].id === id))];
  ok(pageOf(Q1, om, 'S2') === pageOf(Q0, sc, 'S2') && pageOf(Q1, om, 'S3') === pageOf(Q0, sc, 'S3'), '«УДАЛЕНА» stays on the page where the scene was: ' + pageOf(Q1, om, 'S2'));
  eq(om.filter((b, i) => m2[i]).map((b) => b.id), ['S2'], 'only the «УДАЛЕНА» heading is marked');
  ok(!C.paginate([B('x', 'action', 'a'), B('o', 'scene', 'УДАЛЕНА'), B('y', 'scene', 'ИНТ. ДОМ - ДЕНЬ')].concat(lines(3, 'z')), { lines: 6 }).pages[1].items.some((it) => it.i === 1), 'an omitted heading at the bottom of a page is not carried over');
  // a scene moved down: the moved text is marked, the rest not
  const mv6 = sc.filter((b) => /^(S1|A1_)/.test(b.id)).concat(sc.filter((b) => /^(S3|A3_)/.test(b.id)), sc.filter((b) => /^(S2|A2_)/.test(b.id)), sc.filter((b) => /^(S4|A4_)/.test(b.id)));
  const m3 = C.revMarks(mv6, [rv2]);
  const moved6 = mv6.filter((b, i) => m3[i]).map((b) => b.id);
  const sceneOf6 = (k) => mv6.filter((b) => b.id === 'S' + k || b.id.startsWith('A' + k + '_')).map((b) => b.id).join();
  ok(moved6.join() === sceneOf6(2) || moved6.join() === sceneOf6(3), 'a moved scene is marked as a whole: ' + moved6.length + ' from ' + moved6[0]);
  ok(C.revMarks(sc, [rv2]).every((x) => !x), 'same order: no marks');
}
// 7. FDX: a revision started in Final Draft with nothing marked yet still comes back as the active set
if (DP) {
  const p7 = C.demoProject(), e7 = p7.episodes[0];
  e7.revisions = [C.newRevision(0, e7.blocks, 'Продюсер')]; e7.revLevel = 1;
  const x7 = C.exportFDX(e7, p7, C.analyzeEpisode(e7, p7), {});
  ok(/ActiveSet="1"[^>]*RevisionMode="Active"/.test(x7), 'FDX: active set without marks');
  const b7 = C.importFDX(x7, DP), r7 = C.revisionsFromMarks(b7, C.fdxActiveSet(x7));
  ok(r7 && r7.revLevel === 1 && r7.revisions.length === 1 && r7.revisions[0].name === 'Драфт 2', 'the started revision survives the round trip');
  ok(C.revMarks(b7, r7.revisions).every((x) => !x), 'and nothing is marked yet');
  const b8 = b7.map((b) => Object.assign({}, b)); b8[1].x += ' Правка.';
  ok(C.revMarks(b8, r7.revisions)[1] === 1, 'a later edit is marked in it');
}
console.log('test_revisions: ' + n + ' checks passed');
