// regression checks for the analytics fixes (core): omitted scenes contribute nothing to shifts, % and characters
const assert = require('assert');
require('../app/core.js');
const C = globalThis.Core;
const B = (t, x) => ({ id: C.uid(), t, x });
const proj = { rules: {}, chars: { 'МИША': { minor: true }, 'ЛЕНА': {} }, locs: { 'КВАРТИРА': { pav: true, main: true } } };
const b = [B('scene', 'ПАВ. КВАРТИРА - ДЕНЬ'), B('action', 'x '.repeat(200)), B('scene', 'УДАЛЕНА'), B('scene', 'ИНТ. ОФИС - ДЕНЬ'), B('action', 'y '.repeat(200))];
const ep = { blocks: b, sceneMeta: { [b[2].id]: { omitted: true, num: '2', tags: ['kids'], extras: ['МИША'] } } };
const st = C.analyzeEpisode(ep, proj);
const om = st.scenes[1];
assert.ok(om.omitted, 'scene 2 is omitted');
assert.deepStrictEqual([om.cast, om.tags, om.special, om.shifts], [[], [], false, 0], 'omitted scene has no cast, tags or shifts');
const liveShifts = st.scenes.filter((s) => !s.omitted).reduce((a, s) => a + s.shifts, 0);
assert.ok(Math.abs(st.totalShifts - liveShifts) < 1e-12, 'totalShifts counts live scenes only');
assert.ok(Math.abs(st.mainShiftShare - st.main.shifts / liveShifts) < 1e-12, 'main shift share over live scenes');
assert.strictEqual(st.specialMin, 0, 'no special minutes from an omitted scene');
assert.deepStrictEqual(st.characters.map((c) => c.name), [], 'extras of an omitted scene are not characters');
const rr = C.evalRules(ep, proj, st);
const spec = rr.find((x) => x.id === 'special');
assert.ok(spec && /^0%/.test(spec.value) && !spec.details.length, 'special rule shows 0% with no scenes: ' + (spec && spec.value));
assert.ok(/41% смен/.test(rr.find((x) => x.id === 'main').value), 'main rule uses live shifts');
// meta is kept, so restoring the scene brings tags and extras back
assert.deepStrictEqual(ep.sceneMeta[b[2].id].tags, ['kids']);
delete ep.sceneMeta[b[2].id].omitted; b[2].x = 'ИНТ. ДЕТСКАЯ - ДЕНЬ';
const st2 = C.analyzeEpisode(ep, proj);
assert.deepStrictEqual([st2.scenes[1].cast, st2.scenes[1].special], [['МИША'], true], 'restored scene gets its extras and tags back');
// studio rules: an all-exterior episode has no main pavilion (no fallback to any object), the nature share cap and the characters limit
{
  const nb = [B('scene', 'НАТ. ЛЕС - ДЕНЬ'), B('action', 'x '.repeat(150)), B('scene', 'НАТ. ЛЕС - ДЕНЬ'), B('action', 'y '.repeat(150)), B('scene', 'НАТ. ЛЕС - ДЕНЬ'), B('action', 'z '.repeat(150))];
  const np = { rules: {}, chars: {}, locs: {} }, nep = { blocks: nb, sceneMeta: {} }, nst = C.analyzeEpisode(nep, np);
  assert.strictEqual(nst.main, null, 'no main pavilion without a pavilion or a main mark');
  const nr = C.evalRules(nep, np, nst), main = nr.find((x) => x.id === 'main'), ext = nr.find((x) => x.id === 'ext');
  assert.ok(main && main.status === 'fail' && /не найден/.test(main.title) && /^0%/.test(main.value), 'main pavilion rule fails: ' + JSON.stringify(main));
  assert.ok(ext && ext.status === 'fail' && /^100\.0% \/ 30%/.test(ext.value) && ext.details.length === 3, 'nature share fails at 100%: ' + JSON.stringify(ext && ext.value));
  assert.ok(!C.evalRules(nep, { ...np, rules: { extMaxPct: 0 } }, nst).some((x) => x.id === 'ext'), 'extMaxPct 0 switches the nature rule off');
  assert.strictEqual(C.evalRules(nep, { ...np, rules: { extMaxPct: 100 } }, nst).find((x) => x.id === 'ext').status, 'ok', 'nature within the cap');
  // the main object marked by hand is the main pavilion even when it is not a pavilion
  const mp = { rules: {}, chars: {}, locs: { 'ЛЕС': { main: true } } }, mst = C.analyzeEpisode(nep, mp);
  assert.strictEqual(mst.main && mst.main.name, 'ЛЕС');
  assert.strictEqual(C.evalRules(nep, mp, mst).find((x) => x.id === 'main').title, 'Основной павильон: ЛЕС');
  // an episode with no objects at all has nothing to check
  const eep = { blocks: [B('action', 'Текст.')], sceneMeta: {} };
  assert.ok(!C.evalRules(eep, np, C.analyzeEpisode(eep, np)).some((x) => x.id === 'main'), 'no objects: no main rule');
}
{
  const cb = [B('scene', 'ПАВ. КВАРТИРА - ДЕНЬ')];
  for (let i = 0; i < 22; i++) cb.push(B('character', 'ГЕРОЙ ' + i), B('dialogue', 'Реплика.'));
  const cp = { rules: {}, chars: {}, locs: { 'КВАРТИРА': { pav: true } } }, cep = { blocks: cb, sceneMeta: { [cb[0].id]: { extras: ['СОСЕД'] } } }, cst = C.analyzeEpisode(cep, cp);
  const ch = C.evalRules(cep, cp, cst).find((x) => x.id === 'chars');
  assert.ok(ch && ch.status === 'warn' && ch.value === '23 / 20 · с репликами 22' && ch.details.length === 23 && ch.details.some((d) => /СОСЕД.*без реплик/.test(d.text)), 'characters limit warns: ' + JSON.stringify(ch && ch.value));
  assert.strictEqual(C.evalRules(cep, { ...cp, rules: { maxCharsPerEpisode: 10 } }, cst).find((x) => x.id === 'chars').status, 'fail');
  assert.ok(!C.evalRules(cep, { ...cp, rules: { maxCharsPerEpisode: 0 } }, cst).some((x) => x.id === 'chars'), 'maxCharsPerEpisode 0 switches it off');
  assert.ok(C.DEFAULT_RULES.extMaxPct > 0 && C.DEFAULT_RULES.maxCharsPerEpisode > 0, 'defaults present');
}
// the demo gets no new failures from the new rules
{
  const dp = C.demoProject();
  for (const de of dp.episodes) { const pr = { ...dp, rules: Object.assign({}, C.DEFAULT_RULES, dp.rules) }; const rs = C.evalRules(de, pr, C.analyzeEpisode(de, pr));
    assert.ok(['ext', 'chars'].every((id) => rs.find((x) => x.id === id).status === 'ok'), 'demo episode ' + de.number + ' passes nature and characters'); }
}
// comment resolution: the later toggle wins on merge; copies without timestamps keep «resolved on either side»
{
  const m = (a, b) => C.mergeCommentState(Object.assign({}, a), b);
  assert.strictEqual(m({ resolved: true, resolvedAt: 100, resolvedBy: 'А' }, { resolved: false, resolvedAt: 200, resolvedBy: 'Б' }).resolved, false, 'reopened later stays open');
  assert.deepStrictEqual(m({ resolved: false, resolvedAt: 300, resolvedBy: 'А' }, { resolved: true, resolvedAt: 200, resolvedBy: 'Б' }), { resolved: false, resolvedAt: 300, resolvedBy: 'А' }, 'local later state kept');
  assert.deepStrictEqual(m({ resolved: false }, { resolved: true, resolvedAt: 5, resolvedBy: 'Б' }), { resolved: true, resolvedAt: 5, resolvedBy: 'Б' }, 'timestamped toggle beats an old copy');
  assert.strictEqual(m({ resolved: false }, { resolved: true }).resolved, true, 'old files: resolved on either side');
}
console.log('test_analytics: ok');
