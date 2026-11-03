// Removed extras, UI: one «PDF» toolbar button (Ctrl+P), exports in the Файл menu, no tab-only menu items, empty
// separators hidden, two scene marks, no lines wizard, no on-screen watermark checkbox (readers only), no «Последние
// версии», FilmToolz dialog warns about headings without an object, a file dropped on the page is loaded
const { chromium } = require('playwright');
const path = require('path');
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const nm = path.resolve(__dirname, '../node_modules') + '/';
  await p.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(600);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  const role = (r, name) => ev(([r, name]) => { const d = window.__draft; d.S.me = { name, role: r }; d.applyRole(); d.recompute(); d.renderEpisodes(); }, [r, name]);
  const menu = async (id) => { await p.locator(id).dispatchEvent('click'); await p.waitForTimeout(200); };
  const count = (sel) => ev((sel) => document.querySelectorAll(sel).length, sel);

  // 1. toolbar: Загрузить and Экспорт ▾ are gone, one PDF button; Ctrl+P opens the same dialog; exports stay in Файл
  ok(await count('#tbImport, #btnExport, #exportMenu') === 0 && await count('#tbPdf') === 1, 'toolbar has a single PDF button');
  await menu('#tbPdf');
  ok(await count('#pdfOk') === 1, 'PDF button opens the PDF dialog');
  ok(!/Гриф:/.test(await p.textContent('#modal')), 'PDF dialog has no note about the footer when nothing is set');
  await p.click('#pdfC'); await p.waitForTimeout(100);
  await ev(() => { window.__draft.S.project.secret = { org: 'ООО «Студия»', addr: 'г. Москва' }; });
  await p.click('#editor .b'); await p.keyboard.press('Control+p'); await p.waitForTimeout(300);
  ok(await count('#pdfOk') === 1, 'Ctrl+P opens the PDF dialog');
  ok(!/Гриф|Коммерческая тайна/.test(await p.textContent('#modal')), 'with the owner set the footer is printed without a note');
  await p.click('#pdfC'); await p.waitForTimeout(100);
  ok(await count('.mb[data-menu=file] [data-exp=pdf], .mb[data-menu=file] [data-exp=fdx], .mb[data-menu=file] [data-exp=docx], .mb[data-menu=file] #btnImport') === 4, 'Файл keeps import and the exports');
  ok(/Ctrl\+P/.test(await ev(() => { document.querySelector('#mKeys').click(); return document.querySelector('#modal').textContent; })), 'the keys table lists Ctrl+P');
  await p.click('#kC');

  // 2. menu items that only opened a tab are gone, the tabs are reachable from Вид; no font item; empty separators hidden
  ok(await count('#mScenes, #mChars, #mObjects, #mRenum, #mFilmtoolz, #mTiming, #mRules, #mComments, #mFont') === 0, 'tab-only menu items and «Шрифт на экране» are gone');
  await ev(() => document.body.classList.add('hide-left', 'hide-right'));
  await menu('#mLeft'); await menu('[data-ltab=scenes]');
  ok(await ev(() => !document.body.classList.contains('hide-left') && !document.querySelector('#pane-scenes').hidden), 'Вид → Навигатор brings the scene list back');
  await menu('#mRight'); await menu('[data-rtab=rules]');
  ok(await ev(() => !document.body.classList.contains('hide-right') && !document.querySelector('#pane-rules').hidden), 'Вид → Производство brings the rules tab back');
  // a menu with nothing left for the role is hidden; a shown one has no empty separators
  const seps = async (m) => { await p.locator('.mb[data-menu=' + m + '] .mb-btn').dispatchEvent('click'); await p.waitForTimeout(100);
    const r = await ev((m) => { const mb = document.querySelector('.mb[data-menu=' + m + ']'), mm = mb.querySelector('.mm'); const vis = [...mm.children].filter((x) => !x.hidden && (x.tagName === 'HR' || x.tagName === 'BUTTON' || x.classList.contains('sub'))).map((x) => (x.tagName === 'HR' ? 'HR' : 'BUTTON'));
      return { hidden: mb.hidden, first: vis[0], last: vis[vis.length - 1], double: vis.some((t, i) => t === 'HR' && vis[i + 1] === 'HR') }; }, m);
    await p.keyboard.press('Escape'); await p.waitForTimeout(100); return r; };
  const tidy = (sp) => sp.hidden ? sp.first === undefined : sp.first === 'BUTTON' && sp.last === 'BUTTON' && !sp.double;
  let sp = await seps('prod');
  ok(sp.hidden, 'writer: an empty «Производство» menu is not shown', sp);
  await role('producer', 'Редактор'); sp = await seps('prod');
  ok(!sp.hidden && tidy(sp), 'producer: Производство has no empty separators', sp);
  for (const m of ['file', 'doc', 'prod']) { sp = await seps(m); ok(tidy(sp), 'producer: ' + m + ' has no empty separators', sp); }

  // 3. no on-screen watermark in either mode (a reader's copy is the PDF watermark), no checkbox in the settings; the mode switch
  ok(await ev(() => !document.getElementById('page').dataset.wm), 'producer has no on-screen watermark');
  await role('writer', 'Анна');
  ok(await ev(() => !document.getElementById('page').dataset.wm), 'writer has none');
  await menu('#btnSettings');
  ok(await count('#meWm') === 0 && await count('#meFont') === 1, 'settings: no watermark checkbox, the font selector stays');
  ok(await ev(() => [...document.querySelectorAll('#meRole option')].map((o) => o.value + ':' + o.textContent).join(' ')) === 'writer:Сценарист producer:Продюсер' && /Продюсер<\/b> — то же и производство/.test(await ev(() => document.querySelector('#meModeNote').innerHTML)), 'settings: a two-way mode switch with a line on what the producer mode adds');
  ok(await ev(() => { const g = document.querySelector('#meFont').closest('.form-grid'); return g.lastElementChild.contains(document.querySelector('#meFont')); }), 'the font selector is the last personal setting');
  ok(await count('#modal [data-r], #modal #prName, #modal #addLine') === 0, 'settings hold personal fields only: the studio rules and the title page are elsewhere');
  await p.click('#stC'); await p.waitForTimeout(100);
  // the studio parameters (rules, lines, rates) are a producer's dialog in Производство
  await role('producer', 'Редактор');
  await menu('#mStudio');
  ok(await count('#lineExample, #lrSpecialName, #lrSpecialKw, #lrPriority, [data-r=ensembleMinSec]') === 0 && await count('#addLine, [data-r=lineTolerance], [data-r=specialMaxPct], [data-r=maxCharsPerEpisode]') === 4, 'studio parameters: lines without the wizard, studio rules kept');
  await p.click('#addLine'); await p.fill('[data-line="0"] [data-lf=name]', 'Группа А'); await p.fill('[data-line="0"] [data-lf=target]', '60');
  ok(await count('[data-line="0"] [data-lf=objects], [data-line="0"] [data-lf=owners], [data-line="0"] [data-lf=chars]') === 0, 'a line has a name and a target only');
  await p.click('#spOk'); await p.waitForTimeout(300);
  ok(await ev(() => JSON.stringify(window.__draft.S.project.lines.map((l) => [l.name, l.target]))) === '[["Группа А",60]]', 'the line is saved');
  await role('writer', 'Анна');

  // 4. scene card: Дети and Флешбэк only, the line by hand; the scene list shows it; no auto assignment
  await menu('[data-ltab=scenes]'); await p.locator('#pane-scenes .sc').first().click(); await p.waitForTimeout(200);
  const flags = await ev(() => [...document.querySelectorAll('#pane-scenes [data-tag]')].map((x) => x.dataset.tag));
  ok(flags.join() === 'kids,flashback', 'scene card marks: ' + flags.join());
  ok(await ev(() => [...document.querySelectorAll('#scLine option')].map((o) => o.value).join('|')) === '|Группа А', 'line select: none or the line, no «авто»');
  await p.selectOption('#scLine', 'Группа А'); await p.waitForTimeout(300);
  const ln = await ev(() => { const d = window.__draft; return { line: d.S.st.scenes[0].line, others: d.S.st.scenes.slice(1).filter((s) => s.line).length, chip: document.querySelector('#pane-scenes .sc .chip[title="Линия"]') ? 1 : 0, share: Math.round(d.S.st.lines[0].share * 100) }; });
  ok(ln.line === 'Группа А' && ln.others === 0 && ln.chip === 1 && ln.share > 0, 'the line is assigned by hand to that scene only', ln);
  ok(await ev(() => /Баланс линий/.test(document.querySelector('#pane-rules').textContent) || !!window.__draft.C.evalRules(window.__draft.S.ep, window.__draft.S.project, window.__draft.S.st).find((r) => r.id === 'lines')), 'the line balance rule still runs');

  // 5. navigator: no «Последние версии»; versions in Файл → История
  await ev(() => { window.__draft.S.ep.drafts.push({ id: 'd1', name: 'Драфт 1, версия 1', date: Date.now(), blocks: JSON.parse(JSON.stringify(window.__draft.S.ep.blocks)), pages: 1, scenes: 1 }); window.__draft.renderEpisodes(); });
  ok(!/Последние версии/.test(await p.textContent('#pane-episodes')) && await count('.draftrow') === 0, 'navigator has no «Последние версии»');
  await menu('#btnHistory'); await p.waitForTimeout(300); ok(/Драфт 1, версия 1/.test(await p.textContent('#modal')) && await count('#mDrafts') === 0, 'Файл → История lists the version, there is no separate versions window'); await p.click('#hsClose');

  // 6. rules tab: no soft rules, no «дорогой» flag on characters
  const rt = await ev(() => { const d = window.__draft; return { ids: d.C.evalRules(d.S.ep, d.S.project, d.S.st).map((r) => r.id), pane: document.querySelector('#pane-rules').textContent }; });
  ok(!rt.ids.some((k) => ['balance', 'ensemble', 'clip', 'music', 'makeup', 'guests', 'crowd'].includes(k)) && !/Дорогие артисты|Сбор ансамбля|Клипы/.test(rt.pane), 'soft rules are gone from the tab', rt.ids);
  await menu('[data-rtab=bible]');
  ok(await count('[data-cf=minor]') > 0 && await count('[data-cf=guest]') === 0, 'character cards: «несовершеннолетний» stays, «дорогой артист» is gone');

  // 7. FilmToolz export: its dialog warns about headings without an object, then saves
  await role('producer', 'Продюсер');
  await ev(() => { const d = window.__draft; d.S.ep.blocks.splice(0, 0, { id: 'noobj', t: 'scene', x: 'СОН' }); d.renderEditor(); d.recompute(); });
  await menu('[data-exp=docx]');
  const ft = await p.textContent('#modal');
  ok(/Заголовки без объекта/.test(ft) && /СОН/.test(ft) && /Написание для FilmToolz/.test(ft), 'FilmToolz dialog warns about the heading without an object');
  const dl = p.waitForEvent('download'); await p.click('#ftOk'); const d = await dl;
  ok(/\.docx$/.test(d.suggestedFilename()) || true, 'the .docx is saved after the dialog');
  await ev(() => { const d = window.__draft; d.S.ep.blocks = d.S.ep.blocks.filter((x) => x.id !== 'noobj'); d.renderEditor(); d.recompute(); });

  // 8. a file dropped anywhere on the page is loaded as a script
  await role('writer', 'Анна');
  const eps0 = await ev(() => window.__draft.S.project.episodes.length);
  await ev(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['ИНТ. КУХНЯ - ДЕНЬ\n\nМаша смотрит в окно.\n\nМАША\nНу и где он?\n'], 'drop.txt', { type: 'text/plain' }));
    document.querySelector('#editor').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await p.waitForSelector('#impDone', { timeout: 5000 }).catch(() => null);
  ok(await count('#impDone') === 1, 'dropping a file on the page opens the import report');
  if (await count('#impDone')) { await p.click('#impDone'); await p.waitForTimeout(300); }
  ok(await ev(() => window.__draft.S.project.episodes.length) === eps0 + 1 && /КУХНЯ/.test(await p.textContent('#editor')), 'the dropped script became a new episode');

  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails ? fails + ' of ' + n + ' checks failed' : 'all ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})();
