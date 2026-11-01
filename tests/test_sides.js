// Sides (сайды): model helpers — chosen scenes in script order, quick picks, recipients, expiry, log merge
const assert = require('assert');
require('../app/core.js');
const C = globalThis.Core;
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };

const p = C.demoProject(), ep = p.episodes[0], st = C.analyzeEpisode(ep, p);
const sc = st.scenes;
ok(sc.length >= 5, 'demo has scenes');

// 1. sidesBlocks: only the chosen scenes, in script order whatever the order of ids, with a map back to the script
const pick = [sc[3].id, sc[0].id];
const sb = C.sidesBlocks(ep.blocks, sc, pick);
ok(sb.blocks.length === (sc[0].to - sc[0].from + 1) + (sc[3].to - sc[3].from + 1), 'block count of two scenes');
ok(sb.blocks[0].id === sc[0].id, 'starts with the earlier scene');
ok(sb.map[0] === sc[0].from && sb.map[sb.map.length - 1] === sc[3].to, 'map points into the script');
ok(sb.blocks.every((b, i) => b === ep.blocks[sb.map[i]]), 'every block is the script block it maps to');
ok(!sb.blocks.some((b) => b.id === sc[1].id || b.id === sc[2].id), 'unchosen scenes skipped entirely');
// same page format: re-flowed with the script paper, and a scene alone never carries text of a neighbour
const paper = C.paperOf(p.rules);
const lay = C.paginate(sb.blocks, { lines: paper.lines, fmt: paper.fmt });
ok(lay.pages.length >= 1 && lay.pages[0].items[0].t === 'scene', 'sides page 1 opens with a heading');
ok(lay.pages.every((pg) => pg.items.every((it) => it.i < sb.blocks.length)), 'layout indexes the sides blocks');
// omitted scenes never print
const omit = Object.assign({}, sc[1], { omitted: true });
ok(C.sidesBlocks(ep.blocks, [sc[0], omit], [sc[0].id, omit.id]).blocks.length === sc[0].to - sc[0].from + 1, 'omitted scene skipped');
ok(C.sidesBlocks(ep.blocks, sc, []).blocks.length === 0, 'nothing chosen, nothing printed');

// 2. quick picks: a character's scenes, a story day's scenes
const lena = C.sidesPick(sc, { char: 'ЛЕНА' });
ok(lena.length === sc.filter((s) => s.cast.includes('ЛЕНА')).length && lena.length > 0, 'scenes of ЛЕНА: ' + lena.length);
const day1 = C.sidesPick(sc, { day: '1' });
ok(day1.length === sc.filter((s) => String(s.day) === '1').length && day1.length > 0, 'scenes of day 1: ' + day1.length);
ok(C.sidesPick(sc, { day: '' }).length === 0, 'empty day picks nothing');
ok(C.sidesPick([Object.assign({}, sc[0], { omitted: true })], { char: sc[0].cast[0] }).length === 0, 'omitted scenes are not picked');

// 3. recipients: one per line, trimmed, each once
const r = C.sidesRecipients('Анна Петрова (Лена)\n\n  Иван Сидоров \r\nанна петрова (лена)\nОля');
ok(JSON.stringify(r) === JSON.stringify(['Анна Петрова (Лена)', 'Иван Сидоров', 'Оля']), 'recipients ' + JSON.stringify(r));
ok(C.sidesRecipients('').length === 0 && C.sidesRecipients(null).length === 0, 'no recipients');

// 4. expiry: +3 days by default, across a month end; printed as ДД.ММ.ГГГГ; valid through the day
ok(C.sidesExpiry(new Date(2026, 10, 30, 15), 3) === '2026-12-03', 'expiry crosses the month');
ok(C.sidesExpiry(new Date(2026, 0, 1)) === '2026-01-04', 'default +3');
ok(C.ruDate('2026-12-03') === '03.12.2026', 'ru date');
ok(!C.sidesExpired({ expires: '2026-12-03' }, new Date(2026, 11, 3, 23, 59)), 'valid on the last day');
ok(C.sidesExpired({ expires: '2026-12-03' }, new Date(2026, 11, 4, 0, 1)), 'expired the next day');
ok(!C.sidesExpired({}, Date.now()), 'no expiry, never expired');

// 5. log merge: union by id, oldest first, inputs untouched, old files without a log
const a = [{ id: 'a', at: 1, to: 'X' }, { id: 'c', at: 5, to: 'Z' }], b = [{ id: 'b', at: 3, to: 'Y' }, { id: 'a', at: 1, to: 'X' }];
const m = C.mergeSidesLog(a, b);
ok(m.map((e) => e.id).join() === 'a,b,c', 'merged ' + m.map((e) => e.id).join());
ok(a.length === 2 && b.length === 2, 'inputs untouched');
ok(C.mergeSidesLog(undefined, b).length === 2 && C.mergeSidesLog(a, undefined).length === 2 && C.mergeSidesLog().length === 0, 'missing logs');

console.log('test_sides: ' + n + ' asserts ok');
