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
// 9. history: every snapshot is kept as a reverse delta, the newest stays whole, states come back exactly
{
  const D = 900e3, t0 = Date.UTC(2026, 9, 1);
  const base = C.demoProject().episodes[0];
  const mk = (i) => {
    const blocks = JSON.parse(JSON.stringify(base.blocks));
    blocks[1] = Object.assign({}, blocks[1], { x: blocks[1].x + ' правка ' + i });
    if (i % 7 === 0) blocks.push({ id: 'n' + i, t: 'action', x: 'Новый абзац ' + i });
    const st = { blocks, sceneMeta: { a: { num: String(i % 3) } }, lock: null, revisions: i > 50 ? [C.newRevision(0, base.blocks, 'Р', 1)] : null, revLevel: i > 50 ? 1 : 0, pageLock: null, tags: [], titlePage: null };
    return Object.assign({ id: 'h' + i, date: t0 + i * D, author: i % 2 ? 'Анна' : 'Борис', reason: i % 10 ? 'автоснимок' : 'перед правкой', keep: i % 10 === 0, sig: C.histSig(st) }, st);
  };
  const N = 30 * 96; // 30 days of 15-minute snapshots
  const list = [], want = [];
    const strip = (h) => JSON.stringify(Object.keys(h).filter((k) => k !== 'sz').sort().map((k) => [k, h[k]]));
  for (let i = 0; i < N; i++) { const h = mk(i); want.push(strip(h)); C.histPush(list, h); }
  const kept = C.thinHistory(list, C.HIST.budget, t0 + N * D);
  ok(kept === list && kept.length === N, '30 days of 15-minute snapshots are all kept within the budget: ' + kept.length);
  ok(!C.histIsDelta(list[N - 1]) && list[N - 1].blocks.length > 0, 'the newest snapshot stays whole');
  ok(list.filter((h) => !C.histIsDelta(h)).length <= Math.ceil(N / C.HIST.key) + 1, 'only every ' + C.HIST.key + 'th snapshot is whole');
  for (const i of [0, 1, 29, 30, 31, 500, 1234, N - 2, N - 1]) assert.strictEqual(strip(C.histState(list, i)), want[i], 'state ' + i);
  n++;
  const all = C.histStates(list); ok(all.every((s, i) => strip(s) === want[i]), 'histStates gives every state back');
  const whole = want.reduce((a, s) => a + s.length, 0), packed = C.histSize(list);
  ok(packed < whole / 10, 'deltas are small: ' + packed + ' vs ' + whole);
  // over a budget: old automatic snapshots go first, keep snapshots and the newest never; what is left still restores
  const cut = C.thinHistory(list, packed / 3, t0 + N * D);
  ok(cut.dropped > 0 && C.histSize(cut) <= packed / 3, 'thinning only over the budget: dropped ' + cut.dropped);
  ok(cut.filter((h) => h.keep).length === list.filter((h) => h.keep).length, 'keep snapshots survive thinning');
  ok(cut[cut.length - 1].id === 'h' + (N - 1), 'the newest survives');
  const byId = {}; want.forEach((w, i) => { byId['h' + i] = w; });
  ok(C.histStates(cut).every((s, i) => strip(s) === byId[cut[i].id]), 'every snapshot left after thinning restores exactly');
  // old whole-format snapshots (with the long sig) load, restore and take new ones after them
  const old = [0, 1, 2].map((i) => { const h = mk(i); h.sig = JSON.stringify({ blocks: h.blocks }); return h; });
  const oldWant = old.map((h) => JSON.stringify(h.blocks));
  C.histPush(old, mk(3));
  ok(old[0].sig.length < 64 && C.histIsDelta(old[2]) && !C.histIsDelta(old[0]), 'old snapshots: sig shortened, the last becomes a delta');
  ok([0, 1, 2].every((i) => JSON.stringify(C.histState(old, i).blocks) === oldWant[i]), 'old-format snapshots still restore');
  // a page of a snapshot goes back into the current text, the rest stays
  const snap = base.blocks, lay = C.paginate(snap, { lines: 54 });
  const pr = C.pageRanges(lay);
  ok(pr.length >= 1 && pr[0].from === 0 && pr.every((r, k) => k === 0 || r.from === pr[k - 1].to + 1), 'page ranges cover the text in order');
  const cur = snap.map((b) => Object.assign({}, b, { x: b.x + ' НОВОЕ' }));
  const r0 = C.restoreRange(cur, snap, pr[0].from, pr[0].to);
  ok(r0.blocks.slice(0, pr[0].to + 1).every((b, i) => b.x === snap[i].x) && r0.blocks.slice(pr[0].to + 1).every((b) => / НОВОЕ$/.test(b.x)), 'restoreRange replaces only that page');
  const cur2 = cur.slice(); cur2.splice(2, 0, { id: 'ins', t: 'action', x: 'Вставлено позже' });
  ok(!C.restoreRange(cur2, snap, 0, 4).blocks.some((b) => b.id === 'ins'), 'text written inside the page since the snapshot goes with it');
  const cur3 = cur.filter((b, i) => i > 4);
  const r3 = C.restoreRange(cur3, snap, 0, 4);
  ok(r3.blocks.length === cur3.length + 5 && r3.blocks[0].x === snap[0].x, 'a page deleted since comes back in its place');
  // the span between the neighbours grew far beyond the page: only the page's own elements go back, new text stays
  {
    const mk = (id, x) => ({ id, t: 'action', x });
    const sn = [mk('a', 'p1'), mk('b', 'b0'), mk('c', 'c0'), mk('d', 'd0'), mk('e', 'p3')];
    const cu = [mk('a', 'p1'), mk('b', 'b1'), mk('c', 'c1')];
    for (let i = 0; i < 40; i++) cu.push(mk('n' + i, 'НОВОЕ ' + i));
    cu.push(mk('e', 'p3'));
    const rr = C.restoreRange(cu, sn, 1, 3);
    ok(rr.blocks.filter((b) => /^НОВОЕ/.test(b.x)).length === 40, 'page restore keeps the blocks written inside the page since the snapshot');
    ok(rr.blocks.find((b) => b.id === 'b').x === 'b0' && rr.blocks.find((b) => b.id === 'c').x === 'c0' && rr.blocks.findIndex((b) => b.id === 'd') === rr.blocks.findIndex((b) => b.id === 'c') + 1, 'its own elements are replaced in place, a deleted one comes back after its neighbour');
    ok(rr.removed === 2 && rr.count === 3 && rr.kept === 0 && rr.ids.join() === 'b,c,d' && rr.blocks.length === 45, 'restoreRange reports what it restored');
    const cu2 = [mk('b', 'b1')]; for (let i = 0; i < 30; i++) cu2.push(mk('m' + i, 'НОВОЕ ' + i)); cu2.push(mk('d', 'd1'));
    const r2 = C.restoreRange(cu2, sn, 1, 3);
    ok(r2.blocks.filter((b) => /^НОВОЕ/.test(b.x)).length === 30 && r2.kept === 30 && r2.blocks.map((b) => b.id).slice(0, 2).join() === 'b,c' && r2.blocks[r2.blocks.length - 1].x === 'd0', 'neighbours gone: the page comes back around the new text without deleting it');
  }
  // audit log: union by id, unlock records of the episodes shown once
  const A = [{ id: '1', at: 1, type: 'delete' }], B = [{ id: '1', at: 1, type: 'delete' }, { id: '2', at: 2, type: 'sides' }];
  assert.deepStrictEqual(C.mergeAuditLog(A, B).map((x) => x.id), ['1', '2']); n++;
  const pj = { id: 'p', auditLog: [{ id: 'u', at: 7, type: 'unlock', ep: 'e' }], episodes: [{ id: 'e', season: 1, number: 2, lockLog: [{ at: 7, reason: 'r' }, { at: 3, reason: 'старое' }], pageLockLog: [{ at: 4, reason: 'стр', was: { pages: 3 } }] }] };
  const ae = C.auditEntries(pj, []);
  ok(ae.length === 3 && ae[0].id === 'u' && ae.some((x) => x.reason === 'старое' && x.type === 'unlock') && ae.some((x) => x.type === 'pageunlock' && x.epLabel === 'С1Е2'), 'auditEntries includes old lockLog/pageLockLog once');
}
console.log('test_lock: ' + n + ' checks passed');
