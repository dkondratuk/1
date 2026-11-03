// Sides (сайды), UI: Production menu dialog, roles, quick picks, personal PDFs (watermark, footer, header, numbers), log, merge
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
let fails = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
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
  const role = (r, name) => ev(([r, name]) => { const d = window.__draft; d.S.me = { name, role: r }; d.applyRole(); d.recompute(); }, [r, name]);
  const menu = async (id) => { await p.locator(id).dispatchEvent('click'); await p.waitForTimeout(250); };
  // capture every saved file (name and blob) instead of downloading it
  await ev(() => {
    window.__files = []; let last = null;
    const orig = URL.createObjectURL; URL.createObjectURL = (bl) => { last = bl; return orig(bl); };
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__files.push({ name: this.download, blob: last }); };
    window.__draft.S.project.secret = { org: 'ООО «Студия Тест»', addr: 'г. Москва' };
  });
  const pdfs = async () => {
    const raw = await ev(async () => Promise.all(window.__files.filter((f) => /\.pdf$/.test(f.name)).map(async (f) => { const u = new Uint8Array(await f.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return { name: f.name, b64: btoa(s) }; })));
    await ev(() => { window.__files = []; });
    return Promise.all(raw.map(async (f) => {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(f.b64, 'base64')), useSystemFonts: true }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); pages.push({ items: (await pg.getTextContent()).items, w: pg.view[2] }); }
      return { name: f.name, pages, text: (k) => pages[k].items.map((it) => it.str).join(''), flat: (k) => pages[k].items.map((it) => it.str).join('').replace(/\s+/g, '') };
    }));
  };
  const sc = await ev(() => window.__draft.S.st.scenes.map((s) => ({ id: s.id, num: s.num, heading: s.heading, cast: s.cast, day: s.day })));

  // 1. a project without a log; the sides window (issue and journal) is the producer's: a writer has no menu item, and
  // the hidden item / showSides() only show «Нужен режим «Продюсер»»
  ok(await ev(() => window.__draft.S.project.sidesLog === undefined), 'demo project has no sidesLog (backward compatible)');
  ok(await p.locator('#mSides').evaluate((x) => x.hidden) && await p.locator('.mb[data-menu=prod]').evaluate((x) => x.hidden), 'writer: «Сайды…» and the whole Производство menu are hidden');
  await menu('#mSides');
  ok(/Нужен режим «Продюсер»/.test(await p.locator('#modal h2').innerText()) && await p.locator('#sdOk, #sdClose').count() === 0, 'writer: the item shows «Нужен режим «Продюсер»», not the sides window');
  await p.click('#npC');
  await ev(() => window.__draft.showSides());
  ok(/Нужен режим «Продюсер»/.test(await p.locator('#modal h2').innerText()), 'writer: showSides() shows the same window');
  await p.click('#npC');
  ok(await ev(() => window.__draft.issueSides({ ids: [window.__draft.S.st.scenes[0].id], to: ['X'], expires: '2030-01-01' })) === false, 'writer: issueSides refused');
  await p.click('#npC').catch(() => {});
  ok(!(await ev(() => (window.__draft.S.project.sidesLog || []).length)) && !(await ev(() => window.__files.length)), 'nothing logged, nothing saved');

  // 2. producer: quick picks
  await role('producer', 'Редактор Иванова');
  await menu('#mSides');
  ok(await p.locator('#sdOk').count() === 1, 'producer: issue button');
  const exp = await p.inputValue('#sdExp');
  ok(exp === await ev(() => window.__draft.C.sidesExpiry(Date.now(), 3)), 'expiry defaults to +3 days: ' + exp);
  const checked = () => ev(() => [...document.querySelectorAll('[data-sd]')].filter((b) => b.checked).map((b) => b.dataset.sd));
  await p.selectOption('#sdChar', 'ЛЕНА');
  ok(JSON.stringify(await checked()) === JSON.stringify(sc.filter((s) => s.cast.includes('ЛЕНА')).map((s) => s.id)), 'pick: scenes of ЛЕНА');
  await p.selectOption('#sdDay', '1');
  ok(JSON.stringify(await checked()) === JSON.stringify(sc.filter((s) => String(s.day) === '1').map((s) => s.id)), 'pick: story day 1');
  ok(await p.inputValue('#sdChar') === '', 'day pick clears the character pick');
  ok(/Отмечено сцен: 2/.test(await p.locator('#sdSum').innerText()), 'summary: ' + await p.locator('#sdSum').innerText());
  // choose scenes 2 and 4 by clicking rows (scene 4 first: order of choice does not matter)
  await p.click('#sdNone');
  await p.click('[data-sdrow="' + sc[3].id + '"] td:nth-child(3)'); await p.click('[data-sdrow="' + sc[1].id + '"] td:nth-child(3)');
  ok(JSON.stringify(await checked()) === JSON.stringify([sc[1].id, sc[3].id]), 'row click toggles the scene');
  // validation: no recipients
  await p.click('#sdOk');
  ok(await p.locator('#sdOk').count() === 1 && /получател/.test(await p.locator('#toast').innerText()), 'no recipients: dialog stays, toast asks');
  await p.fill('#sdTo', 'Анна Петрова (Лена)\nИван Сидоров\n');
  await p.fill('#sdNote', 'Съёмочный день 12');
  await p.click('#sdOk'); await p.waitForTimeout(2500);
  let files = await pdfs();
  ok(files.length === 2, 'one PDF per recipient: ' + files.map((f) => f.name).join(' | '));
  ok(/сайды Съёмочный день 12 — Анна Петрова \(Лена\)\.pdf$/.test(files[0].name) && /Иван Сидоров\.pdf$/.test(files[1].name), 'file names carry the recipient');
  const f = files[0], ru = exp.split('-').reverse().join('.');
  const all = f.pages.map((pg, k) => f.text(k)).join('\n');
  ok(f.text(0).includes('Сайды · Съёмочный день 12 · стр. 1'), 'header on page 1');
  ok(!all.includes(await ev(() => window.__draft.C.up(window.__draft.S.project.name))) || f.text(0).indexOf(sc[1].heading.slice(0, 10)) >= 0, 'no title page: page 1 is the first chosen scene');
  ok(f.text(0).includes(sc[1].heading.slice(0, 12)), 'page 1 starts with scene ' + sc[1].num);
  ok(all.includes(sc[3].heading.slice(0, 12)), 'second chosen scene printed');
  ok([0, 2, 4, 5].every((k) => !all.includes(sc[k].heading)), 'unchosen scenes skipped');
  ok(all.indexOf(sc[1].heading.slice(0, 12)) < all.indexOf(sc[3].heading.slice(0, 12)), 'script order');
  ok(f.pages.every((pg, k) => f.flat(k).includes('Экземпляр:АннаПетрова(Лена)·действительнодо' + ru)), 'footer on every page: copy and expiry ' + ru);
  ok(f.pages.every((pg, k) => f.text(k).includes('КОММЕРЧЕСКАЯ ТАЙНА') && f.text(k).includes('Студия Тест')), 'trade-secret line on every page');
  ok(f.pages.every((pg, k) => f.flat(k).split('АннаПетрова').length - 1 >= 4 && f.flat(k).includes('АннаПетрова(Лена)·до' + ru)), 'diagonal watermark with name and expiry on every page');
  ok(!files[1].text(0).includes('Анна Петрова'), 'the second copy is personal');
  const nums = f.pages[0].items.filter((it) => it.str === sc[1].num).map((it) => it.transform[4]);
  ok(nums.some((x) => x < 72) && nums.some((x) => x > f.pages[0].w - 100), 'scene number on both sides: ' + nums.map(Math.round));
  // the log
  let log = await ev(() => window.__draft.S.project.sidesLog);
  ok(log.length === 2 && log[0].to === 'Анна Петрова (Лена)' && log[1].to === 'Иван Сидоров', 'log: one entry per copy');
  ok(log.every((e) => e.id && e.at && e.by === 'Редактор Иванова' && e.role === 'producer' && e.note === 'Съёмочный день 12' && e.expires === exp && JSON.stringify(e.scenes) === JSON.stringify([sc[1].num, sc[3].num])), 'log fields: ' + JSON.stringify(log[0]));

  // 3. producer, one file with all copies
  await role('producer', 'Продюсер Орлов');
  await menu('#mSides');
  ok((await p.locator('.sides-log tbody tr').count()) === 2 && /Иван Сидоров/.test(await p.locator('.sides-log').innerText()), 'dialog shows the log');
  await p.click('#sdAll'); await p.fill('#sdTo', 'Оля\nПаша\nКатя'); await p.check('#sdOne');
  await p.click('#sdOk'); await p.waitForTimeout(3000);
  files = await pdfs();
  ok(files.length === 1 && /3 экз\.pdf$/.test(files[0].name), 'one file: ' + files.map((x) => x.name));
  const per = files[0].pages.length / 3;
  ok(Number.isInteger(per) && per >= 1, 'three equal copies: ' + files[0].pages.length + ' pages');
  ok(['Оля', 'Паша', 'Катя'].every((nm2, i) => files[0].text(i * per).includes('Экземпляр: ' + nm2) && files[0].text(i * per).includes('стр. 1')), 'each copy restarts at стр. 1 with its own name');
  log = await ev(() => window.__draft.S.project.sidesLog);
  ok(log.length === 5 && log[4].by === 'Продюсер Орлов' && log[4].scenes.length === sc.length, 'log: three more entries');
  // persisted with the project file (export path uses the project object)
  const json = await ev(() => JSON.stringify({ app: 'draft', version: 1, project: window.__draft.S.project }));
  ok(JSON.parse(json).project.sidesLog.length === 5, 'log is part of the project JSON');

  // 4. merge: a copy of the project with one entry we do not have and missing two we have
  const other = JSON.parse(json);
  other.project.sidesLog = other.project.sidesLog.slice(2).concat([{ id: 'ext1', at: 1, by: 'Другой', role: 'producer', to: 'Гость', scenes: ['1'], note: '', expires: '2020-01-01' }]);
  const fp = path.resolve(__dirname, '../out/sides_merge.json'); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(other));
  await ev(() => { document.getElementById('fileInput').dataset.mode = 'project'; });
  await p.setInputFiles('#fileInput', fp); await p.waitForTimeout(800);
  log = await ev(() => window.__draft.S.project.sidesLog);
  ok(log.length === 6 && log[0].id === 'ext1', 'merged log: union, oldest first');
  await menu('#mSides');
  ok(/истёк/.test(await p.locator('.sides-log').innerText()), 'expired copy is marked');
  await p.click('#sdClose');

  // 5. regressions: a past expiry is refused; on a revised page the revision title gets its own line under the sides header
  await role('producer', 'Продюсер Орлов');
  const logN = await ev(() => window.__draft.S.project.sidesLog.length);
  await menu('#mSides');
  ok(await p.getAttribute('#sdExp', 'min') === await ev(() => window.__draft.C.isoDay(Date.now())), 'date field starts at today');
  await p.click('#sdAll'); await p.fill('#sdTo', 'Анна'); await p.fill('#sdExp', '2020-01-01');
  await p.click('#sdOk'); await p.waitForTimeout(300);
  ok(await p.locator('#sdOk').count() === 1 && /уже прошёл/.test(await p.locator('#toast').innerText()), 'past expiry: the dialog stays and says why');
  await p.click('#sdClose');
  ok(await ev(() => window.__draft.issueSides({ ids: [window.__draft.S.st.scenes[0].id], to: ['Анна'], expires: '2020-01-01' })) === false, 'issueSides refuses a past expiry');
  ok(await ev(() => window.__draft.S.project.sidesLog.length) === logN && !(await ev(() => window.__files.length)), 'nothing saved or logged');
  await ev(() => { const d = window.__draft; d.startRevision(); const s2 = d.S.st.scenes[1], b2 = d.S.ep.blocks.slice(s2.from + 1).find((x) => x.t === 'action'); document.querySelector('#editor [data-id="' + b2.id + '"]').textContent += ' Новая фраза.'; d.recompute(); });
  await ev((id) => window.__draft.issueSides({ ids: [id], to: ['Анна Петрова'], note: 'Съёмочный день 12, смена 2, павильон Мосфильм', expires: '2030-01-01' }), sc[1].id);
  await p.waitForTimeout(1500);
  files = await pdfs();
  const top = files[0].pages[0].items.filter((it) => /^Сайды ·|Драфт \d+ —/.test(it.str)).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
  const hd = top.find((x) => /^Сайды/.test(x.s)), rv = top.find((x) => /Драфт \d+ —/.test(x.s));
  ok(hd && rv && (Math.abs(hd.y - rv.y) >= 9 || hd.x + hd.w <= rv.x || rv.x + rv.w <= hd.x), 'sides header and revision title do not overprint: ' + JSON.stringify(top));
  ok(hd && hd.x + hd.w <= files[0].pages[0].w - 72 + 1 && /стр\. 1$/.test(hd.s), 'a long note keeps the header inside the text width');
  ok(rv && rv.y > files[0].pages[0].items.filter((it) => /ИНТ|НАТ/.test(it.str)).reduce((a, it) => Math.max(a, it.transform[5]), 0), 'revision title above the text');

  // 6. a copy whose file was not saved (save declined) is not logged
  const p2 = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.addInitScript(() => {
    try { localStorage.setItem('draft.started', 'true'); } catch (e) {}
    window.__saves = [];
    window.claude = { use: async () => ({ save: async (o) => { window.__saves.push(o.filename); if (/Иван/.test(o.filename)) { const e = new Error('declined'); e.code = 'declined'; throw e; } } }) };
  });
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p2.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p2.waitForTimeout(600);
  const r2 = await p2.evaluate(async () => { const d = window.__draft; d.S.me = { name: 'Продюсер', role: 'producer' }; d.applyRole(); const ok1 = await d.issueSides({ ids: [d.S.st.scenes[0].id], to: ['Анна', 'Иван'], expires: '2030-01-01' }); return { ok1, saves: window.__saves.length, log: (d.S.project.sidesLog || []).map((e) => e.to), toast: document.querySelector('#toast').textContent }; });
  ok(r2.ok1 && r2.saves === 2 && r2.log.join() === 'Анна' && /1 экз\. из 2/.test(r2.toast), 'declined copy is not logged: ' + JSON.stringify(r2));
  const r3 = await p2.evaluate(async () => { const d = window.__draft; const ok1 = await d.issueSides({ ids: [d.S.st.scenes[0].id], to: ['Иван'], expires: '2030-01-01' }); return { ok1, log: (d.S.project.sidesLog || []).length, toast: document.querySelector('#toast').textContent }; });
  ok(r3.ok1 === false && r3.log === 1 && /не сохранены/.test(r3.toast), 'nothing saved: nothing logged, the toast says so: ' + JSON.stringify(r3));
  await p2.close();

  // 7. the trade-secret notice is printed even when no owner is set; the reader's PDF is always in the reader's own name
  await ev(() => { delete window.__draft.S.project.secret; window.__files = []; });
  await role('producer', 'Продюсер Орлов');
  await ev((id) => window.__draft.issueSides({ ids: [id], to: ['Анна'], expires: '2030-01-01' }), sc[1].id);
  await p.waitForTimeout(1500);
  files = await pdfs();
  ok(files.length === 1 && files[0].pages.every((pg, k) => files[0].text(k).includes('КОММЕРЧЕСКАЯ ТАЙНА') && files[0].flat(k).includes('безсогласияобладателязапрещены')), 'sides without an owner: generic trade-secret line on every page');
  // 7. a reader's copy: the PDF dialog's watermark checkbox (on while «Для кого» is filled) tiles the recipient's name
  await p.locator('[data-exp="pdf"]').first().dispatchEvent('click'); await p.waitForTimeout(300);
  ok(!(await p.locator('#pdfTo').isDisabled()) && await p.inputValue('#pdfTo') === 'Продюсер Орлов' && await p.locator('#pdfWm').isChecked(), 'PDF dialog: recipient prefilled, watermark on');
  await p.fill('#pdfTo', ''); ok(!(await p.locator('#pdfWm').isChecked()), 'an empty «Для кого» turns the watermark off');
  await p.fill('#pdfTo', 'Читатель Иванов'); ok(await p.locator('#pdfWm').isChecked(), 'a name turns it on');
  await p.click('#pdfOk'); await p.waitForTimeout(2500);
  files = await pdfs();
  const rtext = files.length ? files[0].pages.map((pg, k) => files[0].flat(k)).join('') : '';
  ok(files.length === 1 && rtext.includes('Экземпляр:ЧитательИванов') && rtext.includes('КОММЕРЧЕСКАЯТАЙНА') && rtext.split('ЧитательИванов').length - 1 > files[0].pages.length, 'reader copy: the name in the footer, the trade-secret line and the tiled watermark');
  await ev(() => window.__draft.exportPDF({ to: 'Читатель Иванов', wm: false })); await p.waitForTimeout(500);
  files = await pdfs();
  const rt2 = files.length ? files[0].pages.map((pg, k) => files[0].flat(k)).join('') : '';
  ok(files.length === 1 && rt2.includes('Экземпляр:ЧитательИванов') && rt2.split('ЧитательИванов').length - 1 === files[0].pages.length, 'without the checkbox: the name in the footer only');
  // 8. scene lengths: a tiny live scene shows 1/8 in the scene list and in the sides list, never 0
  await role('producer', 'Продюсер Орлов');
  await ev(() => { const ed = document.getElementById('editor'); ed.insertAdjacentHTML('beforeend', '<div class="b t-scene" data-t="scene" data-id="tiny1">ИНТ. КОРИДОР - ДЕНЬ</div>'); window.__draft.recompute(); });
  await p.locator('[data-ltab="scenes"]').dispatchEvent('click'); await p.waitForTimeout(200);
  const tiny = await ev(() => { const s = window.__draft.S.st.scenes.find((x) => x.id === 'tiny1'); return { e: Math.round(s.pages * 8) }; });
  ok(tiny.e === 0, 'the tiny scene rounds to 0 eighths');
  ok(/^1\/8 ·/.test(await ev(() => document.querySelector('.sc[data-id="tiny1"] .meta .mono').textContent)), 'scene list: tiny scene shows 1/8');
  await menu('#mSides');
  ok(await p.locator('[data-sdrow="tiny1"] td:last-child').innerText() === '1/8', 'sides list: tiny scene shows 1/8');
  await p.locator('[data-sdrow="tiny1"] td:nth-child(3)').click();
  ok(/· 1\/8 стр\./.test(await p.locator('#sdSum').innerText()), 'sides summary counts 1/8: ' + await p.locator('#sdSum').innerText());
  await p.click('#sdClose');

  ok(!errs.length, 'no page errors ' + errs.join('; '));
  console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
