// Vocabulary and menus, UI: Файл in Final Draft order with an Экспорт ▸ submenu, one «Открыть…» for project files and
// scripts, one «История» window for automatic snapshots and named versions (no «Версии серии…»), three small dialogs
// instead of one «Настройки», paper in «Параметры страницы…» (not in Формат), Документ items, the start dialog names
// the real menus, the status bar explains read-only, unlock reasons are optional, no «смен (оценка)» tile
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
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
  const items = (m) => ev((m) => [...document.querySelectorAll('.mb[data-menu=' + m + '] .mm > *')].filter((x) => !x.hidden).map((x) => x.tagName === 'HR' ? '|' : x.id || (x.dataset && x.dataset.exp) || (x.classList.contains('sub') ? 'sub:' + x.id : x.textContent.trim())), m);

  // 1. Файл: Final Draft order, Экспорт as a submenu, no «Версии серии…» / «Загрузить сценарий…» / «Открыть файл проекта…»
  let f = await items('file');
  ok(f.join(' ') === 'mNewEp mNewSeason btnImport | mSave project btnDraft | btnHistory mTrash | subExport | fPageSetup | btnSettings', 'Файл order: Новая серия / Новый сезон / Открыть / Сохранить / Сохранить как файл проекта / Сохранить версию / История / Корзина / Экспорт / Параметры страницы / Настройки (the title page lives in Документ only)', f);
  ok(await count('#mDrafts, [data-exp=openproject]') === 0, 'no separate versions window and no second open item');
  ok(await ev(() => [...document.querySelectorAll('#subExport .sm button')].map((x) => x.dataset.exp).join()) === 'pdf,fdx,docx,fountain,bible,xlsx', 'Экспорт ▸ holds PDF, .fdx, Word для FilmToolz, Fountain, Библия, Excel');
  ok(await ev(() => document.querySelector('[data-exp=xlsx]').hidden), 'Excel export is hidden for a writer');
  await p.click('.mb[data-menu=file] .mb-btn'); await p.hover('#subExport .sub-btn'); await p.waitForTimeout(150);
  let sm = await ev(() => { const s = document.querySelector('#subExport .sm'), q = s.getBoundingClientRect(), mm = document.querySelector('.mb[data-menu=file] .mm').getBoundingClientRect(); return { hidden: s.hidden, besides: q.left >= mm.right - 2, onScreen: q.right <= innerWidth }; });
  ok(!sm.hidden && sm.besides && sm.onScreen, 'hovering Экспорт opens the submenu beside the menu', sm);
  await p.hover('#btnSettings'); await p.waitForTimeout(100);
  ok(await ev(() => document.querySelector('#subExport .sm').hidden), 'hovering another item folds the submenu');
  // keyboard: Right opens the submenu, Left closes it, Enter on an item runs it
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await p.keyboard.press('F10'); await p.keyboard.press('ArrowDown'); for (let i = 0; i < 8; i++) await p.keyboard.press('ArrowDown');
  ok(await ev(() => document.activeElement.classList.contains('sub-btn')), 'arrows reach the Экспорт item');
  await p.keyboard.press('ArrowRight');
  ok(await ev(() => !document.querySelector('#subExport .sm').hidden && document.activeElement.dataset.exp === 'pdf'), 'ArrowRight opens the submenu on PDF');
  await p.keyboard.press('ArrowLeft');
  ok(await ev(() => document.querySelector('#subExport .sm').hidden && document.activeElement.classList.contains('sub-btn')), 'ArrowLeft folds it back');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok(await count('#pdfOk') === 1, 'Enter on the PDF item opens the PDF dialog'); await p.click('#pdfC');
  // Формат keeps the elements and dual dialogue, no paper; Документ: Серия, Проект, Титульный лист, Параметры страницы, Сводка сезона (producer/editor)
  ok(await count('[data-paper], .mb[data-menu=format] .mh') === 0 && await count('.mb[data-menu=format] [data-type]') === 7 && await count('#mDual') === 1, 'Формат: elements and dual dialogue only');
  let d = await items('doc');
  ok(d.join(' ') === 'mEpisode mProject | mTitlePage', 'Документ for a writer: Серия, Проект, Титульный лист (page setup lives in Файл only)', d);
  ok(await count('#fTitlePage, #mPageSetup, #mBreakdown') === 0, 'one home per dialog: no second Титульный лист / Параметры страницы, no «Разбивка сцен» panel opener');
  await role('producer', 'Редактор'); d = await items('doc');
  ok(d.join(' ') === 'mEpisode mProject | mTitlePage | btnSeason', 'Документ for a producer adds Сводка сезона', d);
  // Вид: focus mode is a check item ticked while on; Производство: «Залочить номера сцен» without «…» (acts at once), the unlock variant with it
  await menu('#btnFocus'); await p.click('.mb[data-menu=view] .mb-btn'); await p.waitForTimeout(100);
  ok(await ev(() => document.body.classList.contains('focus') && document.querySelector('#btnFocus').classList.contains('check') && document.querySelector('#btnFocus').classList.contains('on')), 'Вид → Режим фокуса is ticked while focus is on');
  await p.keyboard.press('Escape'); await menu('#btnFocus'); await p.click('.mb[data-menu=view] .mb-btn'); await p.waitForTimeout(100);
  ok(await ev(() => !document.body.classList.contains('focus') && !document.querySelector('#btnFocus').classList.contains('on')), 'the tick goes when focus is off'); await p.keyboard.press('Escape');
  await p.click('.mb[data-menu=prod] .mb-btn'); await p.waitForTimeout(100);
  ok(await ev(() => document.querySelector('#mLock').textContent) === 'Залочить номера сцен', 'lock item has no ellipsis: it acts at once'); await p.keyboard.press('Escape');
  await menu('#mLock'); await p.waitForTimeout(200);
  ok(await ev(() => !!window.__draft.S.ep.lock && document.getElementById('modalBack').hidden), 'Производство → Залочить номера сцен locks at once, no dialog');
  await p.click('.mb[data-menu=prod] .mb-btn'); await p.waitForTimeout(100);
  ok(await ev(() => document.querySelector('#mLock').textContent) === 'Снять лок номеров сцен…', 'the unlock variant keeps the ellipsis (it asks a reason)'); await p.keyboard.press('Escape');
  await menu('#mLock'); await p.waitForTimeout(200); ok(await count('#ulOk') === 1, 'Снять лок номеров сцен… opens the reason dialog'); await p.click('#ulOk'); await p.waitForTimeout(200);
  await ev(() => { delete window.__draft.S.ep.lockLog; });
  ok((await items('prod')).includes('mStudio') && await count('#mLines') === 0, 'Производство has «Параметры студии…» instead of «Линии…»');
  await role('writer', 'Сценарист');
  ok(await ev(() => document.querySelector('#mStudio').hidden && document.querySelector('#btnSeason').hidden), 'writer: no studio parameters, no season summary');

  // 2. «Открыть…»: one dialog, a script becomes an episode, a .json opens as a project file
  const eps0 = await ev(() => window.__draft.S.project.episodes.length);
  await menu('#btnImport');
  ok(/^Открыть/.test(await p.textContent('#modal h2')) && /\.json/.test(await p.textContent('#drop')) && /\.fdx/.test(await p.textContent('#drop')), 'the Open dialog names project files and scripts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-menus-'));
  const scr = path.join(tmp, 'scr.txt'); fs.writeFileSync(scr, 'ИНТ. ГАРАЖ - НОЧЬ\n\nТемно.\n\nПЕТЯ\nКто здесь?\n');
  let [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles(scr);
  await p.waitForSelector('#impDone', { timeout: 5000 }).catch(() => null); if (await count('#impDone')) { await p.click('#impDone'); await p.waitForTimeout(300); }
  ok(await ev(() => window.__draft.S.project.episodes.length) === eps0 + 1 && /ГАРАЖ/.test(await p.textContent('#editor')), 'a script from the Open dialog is a new episode');
  const pf = path.join(tmp, 'proj.json');
  fs.writeFileSync(pf, await ev(() => { const d = window.__draft; const pr = d.projectFileData(d.S.project); pr.id = 'p-from-file'; pr.name = 'ИЗ_ФАЙЛА'; pr.episodes = pr.episodes.slice(0, 1); return JSON.stringify({ app: 'draft', version: 1, project: pr }); }));
  await menu('#btnImport');
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles(pf); await p.waitForTimeout(800);
  ok(await ev(() => window.__draft.S.project.name) === 'ИЗ_ФАЙЛА', 'a .json from the same dialog opens as a project');
  await ev(() => { const d = window.__draft; d.S.db.projects = d.S.db.projects.filter((x) => x.id !== 'p-from-file'); d.S.db.currentEpId = null; });
  await p.selectOption('#projectSelect', { index: 0 }); await p.waitForTimeout(400);

  // 3. История: versions and snapshots in one list with a type column, restore and compare from a version row, «Сохранить версию…» inside
  await ev(async () => { const d = window.__draft; await d.histAdd(d.S.ep, 'автоснимок'); });
  await menu('#btnDraft'); await p.fill('#drName', 'ВЕРСИЯ_А'); await p.fill('#drNote', 'заметка к версии'); await p.click('#drOk'); await p.waitForTimeout(200);
  ok(/сохранена в «Истории»/.test(await p.textContent('#toast')), 'the toast says the version is in История');
  await ev(() => { const d = window.__draft; const el = document.querySelector('#editor .b.t-action'); el.textContent = 'ПРАВКА_ПОСЛЕ_ВЕРСИИ'; d.recompute(); });
  await menu('#btnHistory'); await p.waitForTimeout(300);
  ok(/^История/.test(await p.textContent('#modal h2')) && await count('#hsSave') === 1 && await count('#hsDrafts') === 0, 'one История window with «Сохранить версию…» inside');
  const rows = await ev(() => [...document.querySelectorAll('.hist-row')].map((r) => r.dataset.kind + ':' + r.querySelector('.chip').textContent));
  ok(rows.includes('ver:Версия') && rows.includes('snap:Автоснимок'), 'rows carry a type: Версия and Автоснимок', rows);
  await p.locator('.hist-row[data-ver]').first().click(); await p.waitForTimeout(200);
  const view = await p.textContent('#hsView');
  ok(/ВЕРСИЯ_А/.test(view) && /заметка к версии/.test(view) && await count('#hsView .diff .add') === 1 && await count('#hsAll, #hsOne') === 2, 'a version row shows its name, note, the diff with the current text and both restore buttons', view.slice(0, 120));
  await p.click('#hsAll'); await p.waitForTimeout(300);
  ok(await ev(() => !window.__draft.S.ep.blocks.some((x) => x.x === 'ПРАВКА_ПОСЛЕ_ВЕРСИИ')) && /Восстановлена версия «ВЕРСИЯ_А»/.test(await p.textContent('#toast')), 'restoring a version from История brings its text back');
  ok(await ev(async () => { const d = window.__draft, l = await d.histLoad(d.S.ep); return l.some((h) => /перед восстановлением версии/.test(h.reason) && h.keep); }), 'the text before the restore is a keep snapshot');
  ok(await ev(() => !window.__draft.S.ep.drafts.some((x) => /^Авто:/.test(x.name))), 'no automatic «Авто: перед восстановлением» version is added any more');
  await menu('#btnHistory'); await p.waitForTimeout(300); await p.click('#hsSave'); await p.waitForTimeout(200);
  ok(await count('#drName') === 1, '«Сохранить версию…» inside История opens the save dialog'); await p.click('#drC');

  // 4. three dialogs: Настройки (personal), Титульный лист (project / notice), Параметры студии (rules, lines, rates); Параметры страницы
  await menu('#btnSettings');
  ok(await count('#meName, #meRole, #meTheme, #meFont') === 4 && await count('#modal [data-r], #modal #prName, #modal #secOrg, #modal #addLine') === 0, 'Настройки: name, role, theme, font only');
  await p.click('#stC');
  await menu('#mTitlePage');
  ok(await count('#prName, #prAuthor, #prContact, #prDraft, #secOrg, #secAddr') === 6 && /Драфт 1/.test(await p.inputValue('#prDraft')), 'Титульный лист: project name, author, contacts, draft label, trade-secret owner');
  await p.fill('#prAuthor', 'Автор Тестов'); await p.fill('#secOrg', 'ООО «Студия»'); await p.click('#tpOk'); await p.waitForTimeout(200);
  ok(await ev(() => window.__draft.S.project.author === 'Автор Тестов' && window.__draft.S.project.secret.org === 'ООО «Студия»'), 'title page fields are saved');
  await menu('#fPageSetup');
  ok(await count('#psPaper, #psMin') === 2, 'Параметры страницы: paper and minutes per page');
  await p.selectOption('#psPaper', 'a4ru'); await p.fill('#psMin', '1.2'); await p.click('#psOk'); await p.waitForTimeout(300);
  ok(await ev(() => window.__draft.S.project.rules.paper === 'a4ru' && window.__draft.S.project.rules.minPerPage === 1.2 && document.querySelector('#pageRuler').style.width === '794px'), 'paper and minutes are applied');
  await menu('#fPageSetup'); await p.selectOption('#psPaper', 'letter'); await p.fill('#psMin', '1'); await p.click('#psOk'); await p.waitForTimeout(200);
  await menu('#mStudio');
  ok(/Нужен режим «Продюсер»/.test(await p.textContent('#modal')), 'a writer asking for the studio parameters is told it is a producer\'s dialog'); await p.click('#npC');
  await role('producer', 'Продюсер');
  await menu('#mStudio');
  ok(await count('#modal [data-r=maxPages], #modal [data-r=ratePav], #modal #addLine, #modal [data-r=lineTolerance]') === 4 && await count('#modal #meName, #modal #prName, #modal #psPaper') === 0, 'Параметры студии: rules, lines, rates, nothing personal');
  await p.fill('[data-r=maxPages]', '30'); await p.click('#spOk'); await p.waitForTimeout(200);
  ok(await ev(() => window.__draft.S.project.rules.maxPages === 30), 'studio rules are saved');

  // 5. the producer edits too: the status bar names the mode, the toolbar keeps the element select and undo/redo; Время without the shifts tile, the estimate stays in Параметры
  ok(!/Только чтение/.test(await p.textContent('#hint')) && /^Режим: Продюсер · Продюсер/.test((await p.textContent('#roleInfo')).trim()), 'status bar shows the mode: ' + await p.textContent('#roleInfo'));
  ok(await ev(() => !document.querySelector('#elemSelect').hidden && !document.querySelector('#tbUndo').hidden && !document.querySelector('#tbRedo').hidden && document.querySelector('#editor').getAttribute('contenteditable') === 'true'), 'element select and undo/redo stay on the toolbar, the text is editable');
  await menu('[data-rtab=stats]');
  ok(!/смен \(оценка\)/.test(await p.textContent('#pane-stats')) && await count('#pane-stats .kpi') === 5, 'Время has no «смен (оценка)» tile');
  await menu('[data-rtab=rules]');
  ok(/Смены — оценка по выработке/.test(await p.textContent('#pane-rules')), 'the shift estimate text is in Параметры');
  await role('writer', 'Сценарист');
  ok(/^Режим: Сценарист · Сценарист/.test((await p.textContent('#roleInfo')).trim()) && await ev(() => !document.querySelector('#elemSelect').hidden && document.querySelector('#mAudit').hidden && document.querySelector('.mb[data-menu=prod]').hidden), 'a writer: the mode in the status bar, no Производство menu');

  // 6. «Снять лок» without a reason goes through and is logged; the log keeps a reason when given
  await role('producer', 'Редактор');
  await ev(() => window.__draft.lockNumbers()); await p.waitForTimeout(200);
  await ev(() => window.__draft.unlockNumbers()); await p.waitForTimeout(200);
  ok(await count('#ulErr') === 0 && /необязательно/.test(await p.textContent('#modal')), 'the reason field is optional');
  await p.click('#ulOk'); await p.waitForTimeout(200);
  ok(await ev(() => !window.__draft.S.ep.lock && window.__draft.S.ep.lockLog.length === 1 && window.__draft.S.ep.lockLog[0].reason === ''), 'numbers unlocked without a reason, the log has the entry');
  await ev(() => window.__draft.lockPages()); await p.waitForTimeout(200);
  await ev(() => window.__draft.unlockPages()); await p.waitForTimeout(200);
  await p.fill('#upReason', 'перепечатка'); await p.click('#upOk'); await p.waitForTimeout(200);
  ok(await ev(() => !window.__draft.S.ep.pageLock && window.__draft.S.ep.pageLockLog[0].reason === 'перепечатка'), 'pages unlocked with a reason');
  await role('writer', 'Сценарист');

  // 7. Сохранить (Ctrl+S) in Файл; the start dialog has three points that name real menus
  await ev(() => { document.getElementById('toast').hidden = true; });
  await menu('#mSave'); await p.waitForTimeout(300);
  ok(/Сохранено на этом компьютере/.test(await p.textContent('#toast')), 'Файл → Сохранить saves locally');
  await menu('#mStart');
  const st = await p.textContent('#modal');
  ok(await count('#modal ol.start li') === 3 && /Файл → «История…»/.test(st) && /Файл → «Сохранить версию…»/.test(st) && /Файл → «Корзина…»/.test(st) && /Вид → «Навигатор»/.test(st) && /Файл → «Экспорт»/.test(st) && !/Сохранить драфт|Версии серии/.test(st), 'start dialog: three points naming the real menus');
  ok(/вкладки «Время», «Параметры», «Замечания», «Персонажи», «Объекты»/.test(st) && !/параметры студии/.test(st), 'the start dialog names the production tabs as they are labelled');
  await p.click('#stGo');

  // 8. no stray PDF dialog after the menus
  ok(await ev(() => !document.querySelector('#pdfLabel')), 'no stray PDF dialog');
  // PDF title label: «Драфт 1» even when a named version exists (the words draft and version do not cross)
  await role('writer', 'Сценарист');
  await menu('#btnDraft'); await p.click('#drOk'); await p.waitForTimeout(200);
  await menu('[data-exp=pdf]'); await p.waitForTimeout(200);
  ok(await p.inputValue('#pdfLabel') === 'Драфт 1', 'PDF title label is the production draft, not the named version: ' + await p.inputValue('#pdfLabel')); await p.click('#pdfC');

  // 9. one window, one name, one menu home; one place per field; no leftover «роль»; a fresh name; one row of tabs
  await role('producer', 'Редактор');
  ok(await count('#mExportFt') === 0 && await ev(() => [...document.querySelectorAll('.mm button')].filter((x) => /FilmToolz/.test(x.textContent)).map((x) => x.textContent.trim())).then((l) => l.length === 1 && l[0] === 'Word для FilmToolz (.docx)'), 'FilmToolz export has one menu entry, in Файл → Экспорт');
  await menu('[data-exp=docx]'); await p.waitForTimeout(200);
  ok(/^Word для FilmToolz/.test(await p.textContent('#modal h2')), 'the FilmToolz window carries the menu item\'s name'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await ev(() => { const bk = document.querySelector('#modalBack'); if (bk && !bk.hidden) { const c = document.querySelector('#modal .actions .btn:not(.primary):not(.danger)'); if (c) c.click(); } });
  await menu('#mProject');
  ok(await count('#pmName, #pmAuthor, #pmOk') === 0 && await count('#pmDel') === 1 && /Титульный лист/.test(await p.textContent('#modal')), 'Проект…: no name/author fields (they live in the title page), the delete button stays');
  await p.click('#pmC');
  await role('writer', 'Сценарист'); await menu('#mProject');
  ok(await count('#pmDel') === 1, 'writer: Проект… shows the same «Удалить проект» button as «Серия…» shows «Удалить серию»');
  await p.click('#pmDel'); await p.waitForTimeout(150);
  ok(/Нужен режим «Продюсер»/.test(await p.textContent('#modal h2')), 'writer: «Удалить проект» opens the «Нужен режим «Продюсер»» window'); await p.click('#npC');
  await menu('[data-rtab=stats]');
  ok(!/Роль/.test(await p.textContent('#pane-stats')) && /<th>Персонаж<\/th>/.test(await ev(() => document.querySelector('#pane-stats').innerHTML)), 'the characters table is headed «Персонаж», no «Роль» left');
  ok(await ev(() => ![...document.querySelectorAll('body *')].some((x) => x.children.length === 0 && /\bРоль\b/.test(x.textContent))), 'no «Роль» anywhere in the UI');
  await ev(() => { const d = window.__draft; d.S.me = { name: '', role: 'writer' }; d.applyRole(); });
  ok((await p.textContent('#roleInfo')).trim() === 'Режим: Сценарист', 'no name yet: the status bar says only «Режим: Сценарист»');
  await menu('#btnSettings');
  ok(await p.inputValue('#meName') === '' && await p.getAttribute('#meName', 'placeholder') === 'Без имени', 'Настройки: the empty name shows its placeholder'); await p.click('#stC');
  await ev(() => { const d = window.__draft; d.S.me = { name: '', role: 'producer' }; d.applyRole(); d.lockNumbers(); });
  ok(await ev(() => window.__draft.S.ep.lock.by) === 'Без имени (Продюсер)', 'a lock by an unnamed producer is signed «Без имени»');
  await ev(() => window.__draft.unlockNumbers('')); await p.waitForTimeout(100); await ev(() => { if (document.querySelector('#ulOk')) document.querySelector('#ulOk').click(); });
  await role('producer', 'Редактор');
  const tabRows = await ev(() => { const t = [...document.querySelectorAll("#rightPanel .tab")].filter((x) => !x.hidden); const tops = new Set(t.map((x) => Math.round(x.getBoundingClientRect().top))); return { n: t.length, rows: tops.size, cut: t.some((x) => x.scrollWidth > x.clientWidth + 1), w: document.querySelector('#rightPanel').getBoundingClientRect().width }; });
  ok(tabRows.n === 6 && tabRows.rows === 1 && !tabRows.cut, "producer: six production tabs on one row, none clipped", tabRows);

  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails ? fails + ' of ' + n + ' checks failed' : 'all ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})();
