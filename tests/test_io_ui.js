// io group, UI: paste, Fountain and PDF round trips through the app, FilmToolz name fix keeps the script day
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const nm = path.resolve(__dirname, '../node_modules') + '/';
const URL = 'file://' + path.resolve(__dirname, '../app/_test.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-io-'));
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c || extra === undefined ? '' : '\n     ' + JSON.stringify(extra))); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
    await ctx.route('**/*', (r) => { const u = r.request().url();
      if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
      if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
      if (u.includes('pdf.worker.min.js')) return r.fulfill({ path: nm + 'pdfjs-dist/build/pdf.worker.min.js', contentType: 'text/javascript' });
      if (u.includes('pdf.min.js')) return r.fulfill({ path: nm + 'pdfjs-dist/build/pdf.min.js', contentType: 'text/javascript' });
      return u.startsWith('file:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { console.log('PE', e.message); fails++; });
    await p.goto(URL); await p.waitForTimeout(1200);
    const blocks = () => p.evaluate(() => window.__draft.readBlocks().map((x) => x.t + '|' + x.x));
    const scenes = () => p.evaluate(() => { window.__draft.recompute(); return window.__draft.S.st.scenes.map((s) => [s.num, s.day, !!s.fileNum]); });
    const importFile = async (f) => {
      await p.evaluate(() => { document.getElementById('fileInput').dataset.mode = 'script'; });
      await p.setInputFiles('#fileInput', f); await p.waitForTimeout(1500);
      const done = p.locator('#impDone'); if (await done.count()) await done.dispatchEvent('click');
      await p.waitForTimeout(300);
    };

    // 1. multi-line paste: the first cue of a scene, a parenthetical with a capital, an ellipsis and the script day survive
    await p.evaluate(() => { const els = [...document.querySelectorAll('#editor .b')]; const el = els[els.length - 1]; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('editor').focus(); });
    const n0 = (await blocks()).length;
    await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'ИНТ. КУХНЯ - ДЕНЬ 7\n\nПЕТЯ\n(Маше)\n...Ну да.\n'); document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await p.waitForTimeout(300);
    const after = (await blocks()).slice(n0);
    ok(JSON.stringify(after) === JSON.stringify(['scene|ИНТ. КУХНЯ - ДЕНЬ', 'character|ПЕТЯ', 'paren|(Маше)', 'dialogue|...Ну да.']), 'paste keeps the opening cue, the parenthetical and the ellipsis', after);
    const sc = await scenes();
    ok(sc[sc.length - 1][1] === '7', 'pasted heading day goes to the scene card', sc[sc.length - 1]);

    // 2. Fountain export from the menu and import back: text, types, numbers and days
    await p.evaluate(() => { const S = window.__draft.S; const ids = S.ep.blocks.filter((x) => x.t === 'scene').map((x) => x.id); const nums = ['A1', '12А', '51-12', '13', '14', '15', '16'];
      ids.forEach((id, k) => { S.ep.sceneMeta[id] = Object.assign(S.ep.sceneMeta[id] || {}, { num: nums[k] || String(20 + k), day: String(k + 1) }); }); window.__draft.recompute(); });
    const src = await blocks(), srcScenes = await scenes();
    await p.click('#btnExport');
    const dl = p.waitForEvent('download');
    await p.locator('#exportMenu [data-exp=fountain]').dispatchEvent('click');
    const fnt = path.join(tmp, 'ep.txt'); await (await dl).saveAs(fnt);
    const ftxt = fs.readFileSync(fnt, 'utf8');
    ok(/#A1#/.test(ftxt) && /#12А#/.test(ftxt) && /#51-12#/.test(ftxt), 'Fountain export writes scene numbers');
    await importFile(fnt);
    const back = await blocks();
    ok(JSON.stringify(back) === JSON.stringify(src), 'Fountain round trip keeps text and element types', back.filter((x, i) => x !== src[i]).slice(0, 4));
    const backScenes = await scenes();
    ok(JSON.stringify(backScenes.map((s) => s.slice(0, 2))) === JSON.stringify(srcScenes.map((s) => s.slice(0, 2))), 'Fountain round trip keeps scene numbers and days', [srcScenes, backScenes]);

    // 3. PDF export and import back: the margin scene numbers become the scene numbers again
    const dl2 = p.waitForEvent('download');
    await p.evaluate(() => window.__draft.exportPDF({ to: window.__draft.S.me.name, label: '', wm: false }));
    const pdf = path.join(tmp, 'ep.pdf'); await (await dl2).saveAs(pdf);
    await importFile(pdf);
    const pdfScenes = await scenes();
    ok(JSON.stringify(pdfScenes.map((s) => [s[0], s[2]])) === JSON.stringify(srcScenes.map((s) => [s[0], true])), 'PDF round trip keeps scene numbers', [srcScenes, pdfScenes]);

    // 4. FilmToolz name fix keeps a script day typed in the heading
    await p.evaluate(() => { const hs = [...document.querySelectorAll('#editor .b[data-t=scene]')]; hs[0].textContent = 'ИНТ. ТРЕШКА ЗАЛ - ДЕНЬ 2'; hs[1].textContent = 'ИНТ. ТРЕШКА - НОЧЬ 3'; window.__draft.recompute(); });
    await p.locator('[data-rtab=rules]').dispatchEvent('click'); await p.waitForTimeout(300);
    const fix = p.locator('#pane-rules [data-fix="ТРЕШКА"][data-from="ТРЕШКА ЗАЛ"]');
    ok(await fix.count() > 0, 'naming check offers to merge ТРЕШКА ЗАЛ');
    if (await fix.count()) {
      await fix.first().dispatchEvent('click'); await p.waitForTimeout(300);
      const hs = (await blocks()).filter((x) => x.startsWith('scene|'));
      ok(hs[0] === 'scene|ИНТ. ТРЕШКА. ЗАЛ - ДЕНЬ 2' && hs[1] === 'scene|ИНТ. ТРЕШКА - НОЧЬ 3', 'name fix keeps the day in the heading', hs.slice(0, 2));
    }
  } catch (e) { console.log('ERROR', e); fails++; }
  await b.close();
  console.log(fails ? 'test_io_ui: ' + fails + ' FAILED' : 'test_io_ui: all passed');
  process.exit(fails ? 1 : 0);
})();
