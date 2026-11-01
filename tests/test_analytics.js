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
console.log('test_analytics: ok');
