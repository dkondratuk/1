// Format group, UI: screen wrapping matches paginate(), page markers inside blocks, Final Draft geometry on screen and in the PDF
const { chromium } = require('playwright');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
let fails = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
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
  await ev(() => {
    const d = window.__draft;
    window.__load = (bl) => {
      d.S.ep.blocks = bl.map((x, k) => Object.assign({ id: 'f' + k }, x));
      document.querySelector('#editor').innerHTML = d.S.ep.blocks.map((x) => '<div class="b t-' + x.t + '" data-t="' + x.t + '" data-id="' + x.id + '"></div>').join('');
      [...document.querySelectorAll('#editor > .b')].forEach((el, k) => { el.textContent = d.S.ep.blocks[k].x; });
      d.recompute();
    };
  });
  // 1. every block wraps on screen into as many lines as the model counts (full-width lines, hyphens), on every paper
  for (const paper of ['letter', 'a4', 'a4ru']) {
    const res = await ev((paper) => {
      const d = window.__draft, C = d.C;
      d.S.project.rules.paper = paper; d.applyPaper();
      const F = C.paperOf(d.S.project.rules).fmt, bl = [];
      for (const t of ['scene', 'action', 'character', 'paren', 'dialogue', 'transition']) {
        const w = Math.floor(F[t].width);
        bl.push({ t, x: 'Ж'.repeat(w - 6) + ' абвгд' }, { t, x: 'Ж'.repeat(w - 5) + ' абвгд' });
      }
      bl.push({ t: 'paren', x: '(смотрит на Марию-Антуанетту, по-доброму)' },
        { t: 'action', x: 'Иван-Петрович входит в комнату, что-то бормочет по-прежнему и садится у окна, глядя на Марию-Антуанетту во дворе.' },
        { t: 'dialogue', x: 'Ну что-то же надо делать, правда? Я вот по-честному не понимаю, куда-нибудь да пойдём, кто-нибудь поможет.' });
      window.__load(bl);
      const els = [...document.querySelectorAll('#editor > .b')];
      return els.map((el, k) => ({ t: bl[k].t, x: bl[k].x.slice(0, 20), scr: Math.round(el.getBoundingClientRect().height / d.S.zoom / 16), mod: d.S.st.lay.info[k].L }));
    }, paper);
    for (const r of res) ok(r.scr === r.mod, paper + ' ' + r.t + ' "' + r.x + '": screen ' + r.scr + ' lines, model ' + r.mod);
  }
  // 2. Final Draft geometry on screen (Letter): cue at 3.50 in, parenthetical 3.00 in, transition ends at 7.10 in
  const geo = await ev(() => {
    const d = window.__draft; d.S.project.rules.paper = 'letter'; d.applyPaper();
    window.__load([{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }, { t: 'character', x: 'Иван' }, { t: 'paren', x: '(тихо)' }, { t: 'dialogue', x: 'Да.' }, { t: 'transition', x: 'СМЕНА КАДРА:' }]);
    const els = [...document.querySelectorAll('#editor > .b')], pg = document.querySelector('#page').getBoundingClientRect(), z = d.S.zoom;
    const x = (el, r) => ((r ? el.getBoundingClientRect().right : el.getBoundingClientRect().left) - pg.left) / z / 96;
    const tr = document.createRange(); tr.selectNodeContents(els[4]);
    return { ch: x(els[1]), pa: x(els[2]), dl: x(els[3]), trR: (tr.getBoundingClientRect().right - pg.left) / z / 96 };
  });
  ok(Math.abs(geo.ch - 3.5) < 0.01 && Math.abs(geo.pa - 3.0) < 0.01 && Math.abs(geo.dl - 2.5) < 0.01, 'screen indents ' + JSON.stringify(geo));
  ok(Math.abs(geo.trR - 7.1) < 0.02, 'transition ends at 7.10 in: ' + geo.trR);
  // 3. a page that ends inside a block: no marker above the block, a dashed marker under the right line instead
  const S1 = 'Короткая фраза здесь, чтобы занять всю строку описания целиком и до конца. ';
  const mk = await ev((S1) => {
    const d = window.__draft, bl = [{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }];
    for (let k = 0; k < 20; k++) bl.push({ t: 'action', x: 'Одна строка.' });
    bl.push({ t: 'action', x: S1.repeat(60) });
    window.__load(bl);
    const els = [...document.querySelectorAll('#editor > .b')], el = els[21], m = [...document.querySelectorAll('#page > .pbin')];
    const head = d.S.st.lay.pages[0].items.find((it) => it.i === 21);
    return { pb: el.dataset.pb || null, marks: m.map((x) => x.dataset.page).join(), inner: JSON.stringify(d.S.st.lay.inner), top: m.length ? parseFloat(m[0].style.top) : null, want: el.offsetTop + head.lines.length * 16, last: null };
  }, S1);
  ok(mk.pb === null, 'split block has no marker above it');
  ok(mk.marks === '2,3', 'markers for pages 2 and 3 inside the block: ' + mk.marks + ' ' + mk.inner);
  ok(Math.abs(mk.top - mk.want) < 0.5, 'marker under the last line of page 1: ' + mk.top + ' vs ' + mk.want);
  // 4. PDF: scene heading carried with its action, (ДАЛЬШЕ)/ИВАН (ЗК) (ПРОД.), cue at 3.50 in, transition right edge 7.10 in
  await ev(() => {
    const bl = [{ t: 'scene', x: 'ИНТ. КУХНЯ - ДЕНЬ' }];
    for (let k = 0; k < 47; k++) bl.push({ t: 'action', x: 'Строка.' });
    bl.push({ t: 'scene', x: 'НАТ. ДВОР - НОЧЬ' }, { t: 'action', x: 'Двор пуст.' }, { t: 'character', x: 'Иван (ЗК)' });
    bl.push({ t: 'dialogue', x: 'Первая фраза реплики длинная и занимает строку. '.repeat(70) }, { t: 'transition', x: 'Смена кадра:' });
    window.__load(bl);
    window.__pdf = null; const orig = URL.createObjectURL; URL.createObjectURL = (x) => { window.__pdf = x; return orig(x); };
  });
  await ev(() => window.__draft.exportPDF({ to: 'Тест', label: '', wm: false }));
  await p.waitForTimeout(800);
  const b64 = await ev(async () => { const u = new Uint8Array(await window.__pdf.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(b64, 'base64')), useSystemFonts: true }).promise;
  const page = async (i) => (await (await doc.getPage(i)).getTextContent()).items.filter((it) => it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4] / 72, y: it.transform[5], w: it.width / 72 }));
  const p2 = await page(2), p3 = await page(3), p4 = await page(4);
  const lastOf = (pg) => pg.filter((it) => it.y > 60).sort((a, c) => a.y - c.y)[0];
  ok(!/НАТ\. ДВОР/.test(lastOf(p2).s), 'PDF page 1 does not end on the heading: ' + lastOf(p2).s);
  ok(p3.some((it) => /НАТ\. ДВОР/.test(it.s)), 'heading printed on page 2');
  ok(p3.some((it) => it.s === '(ДАЛЬШЕ)' && Math.abs(it.x - 3.5) < 0.01), 'PDF (ДАЛЬШЕ) at 3.50 in');
  ok(p3.some((it) => it.s === 'ИВАН (ЗК)' && Math.abs(it.x - 3.5) < 0.01), 'PDF cue at 3.50 in');
  ok(p4.some((it) => it.s === 'ИВАН (ЗК) (ПРОД.)'), 'PDF continuation keeps (ЗК)');
  const all = [];
  for (let i = 2; i <= doc.numPages; i++) all.push(...(await page(i)));
  const tr = all.find((it) => it.s === 'СМЕНА КАДРА:');
  ok(tr && Math.abs(tr.x + tr.w - 7.1) < 0.02, 'PDF transition ends at 7.10 in: ' + (tr && tr.x + tr.w));
  ok(doc.numPages - 1 === await ev(() => window.__draft.S.st.lay.pages.length), 'PDF pages = paginate() pages');
  ok(!errs.length, 'page errors: ' + errs.join('; '));
  await b.close();
  console.log('test_format_ui: ' + (n - fails) + '/' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
