// КИТ Сценарист (.kitsp) and Story Architect (.starc) import through the app: sql.js loads lazily from cdnjs (routed to
// node_modules here), Файл → Открыть… takes both as a script (the same dialog opens project files), a STARC project
// with two screenplays asks which one, the reader cannot load
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
const F = require('./kitstarc_fixtures.js');
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c || extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); if (!c) fails++; };

(async () => {
  const fx = await F.build();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-kit-'));
  const kitF = path.join(tmp, 'kvartira.kitsp'), starcF = path.join(tmp, 'serial.starc');
  fs.writeFileSync(kitF, fx.kitsp); fs.writeFileSync(starcF, fx.starc);
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
    const asked = [];
    await ctx.route('**/*', (r) => { const u = r.request().url();
      if (u.includes('/sql.js/')) asked.push(u.replace(/^.*\/ajax\/libs\//, ''));
      if (u.includes('sql-wasm.wasm')) return r.fulfill({ path: nm + 'sql.js/dist/sql-wasm.wasm', contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } });
      if (u.includes('sql-wasm.js')) return r.fulfill({ path: nm + 'sql.js/dist/sql-wasm.js', contentType: 'text/javascript' });
      return u.startsWith('file:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    p.on('console', (m) => process.env.DBG && console.log('CON', m.text()));
    p.on('requestfailed', (r) => process.env.DBG && console.log('RF', r.url()));
    p.on('pageerror', (e) => { console.log('PE', e.message); fails++; });
    await p.goto(URL); await p.waitForTimeout(1200);
    const ev = (f, a) => p.evaluate(f, a);
    const state = () => ev(() => { const d = window.__draft; d.recompute(); const ep = d.S.ep;
      return { title: ep.title, blocks: d.readBlocks().map((x) => x.t + '|' + x.x + (x.dual ? '|dual' : '')), meta: d.S.st.scenes.map((s) => ({ num: s.num, day: s.day || '', omitted: !!s.omitted, extras: (ep.sceneMeta[s.id] || {}).extras || [], syn: (ep.sceneMeta[s.id] || {}).synopsis || '' })),
        eps: d.S.project.episodes.length, chars: Object.keys(d.S.project.chars), author: d.S.project.author || '' }; });
    const done = async () => { await p.waitForSelector('#impDone', { timeout: 15000 }).catch(async (e) => { console.log('toast:', await p.textContent('#toast'), await p.evaluate(() => document.querySelector('.modal, #modal') && document.querySelector('.modal, #modal').textContent.slice(0, 200))); throw e; }); await p.locator('#impDone').dispatchEvent('click'); await p.waitForTimeout(300); };

    ok((await p.getAttribute('#fileInput', 'accept')).split(',').includes('.kitsp') && (await p.getAttribute('#fileInput', 'accept')).split(',').includes('.starc'), 'the file picker offers .kitsp and .starc');
    ok(!(await ev(() => !!window.initSqlJs)), 'sql.js is not loaded until a КИТ / STARC file is opened');
    const eps0 = (await state()).eps;

    // 1. Файл → Открыть… → .kitsp
    await p.locator('#btnImport').dispatchEvent('click');
    ok(/\.kitsp/.test(await p.textContent('#drop')) && /\.starc/.test(await p.textContent('#drop')), 'the import dialog names both formats');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles(kitF);
    await done();
    let s = await state();
    ok(s.eps === eps0 + 1, 'the .kitsp script is a new episode', s.eps);
    ok(s.title === 'Квартирный вопрос', 'its title comes from the КИТ project name', s.title);
    ok(JSON.stringify(s.blocks) === JSON.stringify(['scene|ИНТ. КВАРТИРА МАШИ - ДЕНЬ', 'action|Маша смотрит в окно. Петя & кот.', 'character|МАША', 'paren|(тихо)', 'dialogue|Ну и где он?', 'action|ТИТР: Москва, 1999',
      'character|МАША', 'dialogue|Да.', 'character|ПЕТЯ|dual', 'dialogue|Нет.', 'transition|СМЕНА КАДРА:', 'scene|НАТ. ДВОР - НОЧЬ', 'action|Тишина.']), 'КИТ blocks map to Драфт elements (cast list, folders and unprinted text dropped, dual dialogue kept)', s.blocks);
    ok(s.meta[0].num === '5' && s.meta[0].syn === 'Маша ждёт Петю.' && s.meta[0].extras.join() === 'СОСЕД', 'the fixed scene number, scene description and silent cast go to the scene card', s.meta[0]);
    ok(['МАША', 'ПЕТЯ', 'СОСЕД'].every((n) => s.chars.includes(n)), 'characters are in the project dictionary', s.chars);
    ok(asked.some((u) => u === 'sql.js/1.10.3/sql-wasm.js') && asked.some((u) => u === 'sql.js/1.10.3/sql-wasm.wasm'), 'sql.js 1.10.3 and its wasm come from cdnjs', asked);

    // 2. Файл → Открыть… (the same dialog takes project files and scripts) → .starc with two screenplays: a picker, the second one is loaded
    await p.locator('#btnImport').dispatchEvent('click');
    const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc2.setFiles(starcF);
    await p.waitForSelector('#sqlPick', { timeout: 15000 });
    const names = await p.$$eval('#sqlPick label', (ls) => ls.map((l) => l.textContent.trim()));
    ok(names.length === 2 && /^Пилот/.test(names[0]) && /^Серия 2 & финал/.test(names[1]), 'the picker lists the screenplays, not drafts or the recycle bin', names);
    await p.locator('#sqlPick input[value="1"]').check();
    await p.locator('#sqlOk').dispatchEvent('click');
    await done();
    s = await state();
    ok(s.eps === eps0 + 2 && s.title === 'Серия 2 & финал', 'the chosen screenplay is a new episode named after it', [s.eps, s.title]);
    ok(JSON.stringify(s.blocks) === JSON.stringify(['scene|ИНТ. КУХНЯ - ДЕНЬ', 'action|Маша пьёт чай.', 'action|Вася молчит.', 'character|МАША', 'paren|(в сторону)', 'dialogue|<шёпотом> Тсс.', 'character|МАША', 'dialogue|Раз.', 'character|ВАСЯ|dual', 'dialogue|Два.', 'shot|КРУПНО — ЧАШКА',
      'scene|УДАЛЕНА', 'scene|ИНТ. ПОДЪЕЗД - НОЧЬ', 'action|Темно 2.']), 'STARC blocks map to Драфт elements', s.blocks);
    ok(s.meta[0].num === '7' && s.meta[0].day === '3' && s.meta[0].syn === 'Завязка' && s.meta[1].omitted, 'scene number, story day, description and the omitted scene come across', s.meta);
    ok(await ev(() => { const d = window.__draft, sc = d.S.st.scenes[1]; return (d.S.ep.sceneMeta[sc.id].omittedBlocks || []).map((x) => x.x).join('|') === 'НАТ. УЛИЦА - НОЧЬ|Дождь.'; }), 'the omitted scene keeps its body for «Вернуть сцену»');
    // undo history and the episode list: the new episode is an ordinary one (Ctrl+Z inside it has nothing from the import)
    ok(await ev(() => window.__draft.S.project.episodes.some((e) => e.title === 'Квартирный вопрос')), 'the КИТ episode is still there');

  } catch (e) { console.log('FAIL exception', e); fails++; }
  finally { await b.close(); }
  console.log(fails ? 'test_kitstarc_ui: ' + fails + ' FAILED' : 'test_kitstarc_ui: all passed');
  process.exit(fails ? 1 : 0);
})();
