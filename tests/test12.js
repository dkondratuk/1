// Stage 1: numbering lock (A-numbers, OMITTED), page templates, reader role, PDF watermark and trade-secret footer
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const nm = path.resolve(__dirname, '../node_modules') + '/';
  await p.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(600);
  const ev = (f, ...a) => p.evaluate(f, ...a);
  // writer cannot lock; editor can
  await p.click('[data-ltab=scenes]'); await p.waitForTimeout(200);
  console.log('writer sees lock button:', await p.locator('#lockNum').count());
  await ev(() => { const d = window.__draft; d.S.me = { name: 'Редактор Иванова', role: 'editor' }; d.applyRole(); d.renderScenes(); });
  await p.click('#lockNum'); await p.waitForTimeout(300);
  const l1 = await ev(() => ({ lock: !!window.__draft.S.ep.lock, nums: window.__draft.S.st.scenes.map((s) => s.num).join(',') }));
  console.log('locked', l1);
  // insert a new scene after scene 1 (Enter at end of the first heading, then type a heading)
  await p.click('#editor .b.t-scene'); await p.keyboard.press('End'); await p.keyboard.press('Enter');
  await p.keyboard.press('Control+1'); await p.keyboard.type('ИНТ. НОВАЯ СЦЕНА - ДЕНЬ'); await p.waitForTimeout(500);
  const l2 = await ev(() => { window.__draft.recompute(); return window.__draft.S.st.scenes.map((s) => s.num).join(','); });
  console.log('after insert', l2);
  // omit scene 2 (the original second scene) through the inspector
  await ev(() => { const d = window.__draft; d.S.curScene = d.S.st.scenes[2].id; d.renderScenes(); });
  await p.click('#scOmit'); await p.waitForTimeout(300);
  const l3 = await ev(() => window.__draft.S.st.scenes.map((s) => s.num + (s.omitted ? '*' : '')).join(','));
  console.log('after omit', l3, 'heading:', await ev(() => window.__draft.S.st.scenes[2].heading));
  console.log('rules scene count excludes omitted:', await ev(() => window.__draft.S.rulesRes.find((r) => r.id === 'scenes').value));
  // FDX export writes OMITTED; FilmToolz docx skips it
  const fdx = await ev(() => window.__draft.C.exportFDX(window.__draft.S.ep, window.__draft.S.project, window.__draft.S.st, {}));
  console.log('fdx omitted:', /Number="2" Type="Scene Heading"><SceneProperties[^>]*\/><Text>OMITTED/.test(fdx), 'fdx 1A:', fdx.includes('Number="1A"'));
  const docx = await ev(() => window.__draft.C.docxDocumentXML(window.__draft.S.ep, window.__draft.S.project, window.__draft.S.st));
  console.log('docx has omitted:', docx.includes('УДАЛЕНА'), 'docx has 1A:', docx.includes('1-1A.'));
  // restore the omitted scene
  await p.click('#scRestore'); await p.waitForTimeout(300);
  console.log('after restore', await ev(() => window.__draft.S.st.scenes.map((s) => s.num + (s.omitted ? '*' : '')).join(',')));
  // delete a whole scene heading by hand -> missing number shows up with a restore button
  await ev(() => { const d = window.__draft; const s = d.S.st.scenes[3]; const bl = d.readBlocks(); bl.splice(s.from, s.to - s.from + 1); d.S.ep.blocks = bl; document.querySelector('#editor').innerHTML = bl.map((b) => '<div class="b t-' + b.t + '" data-t="' + b.t + '" data-id="' + b.id + '">' + b.x + '</div>').join(''); d.recompute(); d.renderScenes(); });
  await p.waitForTimeout(200);
  console.log('missing buttons:', await p.locator('[data-restore-omit]').count(), await p.locator('[data-restore-omit]').first().innerText());
  await p.locator('[data-restore-omit]').first().click(); await p.waitForTimeout(300);
  console.log('after missing restore', await ev(() => window.__draft.S.st.scenes.map((s) => s.num + (s.omitted ? '*' : '')).join(',')));
  await p.screenshot({ path: 'out/lock1.png' });
  // unlock with a reason (editor allowed)
  await p.click('#unlockNum'); await p.fill('#ulReason', 'тестовое снятие'); await p.click('#ulOk'); await p.waitForTimeout(300);
  console.log('unlocked:', await ev(() => !window.__draft.S.ep.lock && window.__draft.S.ep.lockLog[0].reason));
  // page template: A4 russian changes CSS geometry and the page count
  const geo = await ev(() => { const d = window.__draft; d.S.project.rules.paper = 'a4ru'; d.applyPaper(); d.recompute(); const cs = getComputedStyle(document.documentElement); return { w: cs.getPropertyValue('--pg-w').trim(), char: cs.getPropertyValue('--in-char').trim(), pageW: document.querySelector('#page').getBoundingClientRect().width, pages: d.S.st.pages.toFixed(2) }; });
  console.log('a4ru', geo);
  await ev(() => { const d = window.__draft; d.S.project.rules.paper = 'letter'; d.applyPaper(); d.recompute(); });
  // reader: read-only, export only PDF, watermark on screen
  await ev(() => { const d = window.__draft; d.S.me = { name: 'Актёр Сидоров', role: 'reader' }; d.applyRole(); });
  console.log('reader', await ev(() => ({ ce: document.querySelector('#editor').getAttribute('contenteditable'), imp: document.querySelector('#btnImport').hidden, fdxHidden: document.querySelector('[data-exp=fdx]').hidden, pdfHidden: document.querySelector('[data-exp=pdf]').hidden, wm: document.querySelector('#page').dataset.wm })));
  // PDF with watermark and trade-secret footer: capture the blob
  await ev(() => { window.__pdf = null; const orig = URL.createObjectURL; URL.createObjectURL = (bl) => { window.__pdf = bl; return orig(bl); }; window.__draft.S.project.secret = { org: 'ООО «Студия Тест»', addr: 'г. Москва' }; });
  await ev(() => window.__draft.exportPDF({ to: 'Актёр Сидоров', label: 'Розовая ревизия', wm: true }));
  await p.waitForTimeout(800);
  const b64 = await ev(async () => { const buf = await window.__pdf.arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  const data = new Uint8Array(Buffer.from(b64, 'base64'));
  fs.writeFileSync('out/test12.pdf', data);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const txt = async (i) => (await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join('');
  const t1 = await txt(1), t2 = await txt(2);
  console.log('pdf pages', doc.numPages, '| title has label:', t1.includes('Розовая ревизия'), '| footer org:', t2.includes('Студия Тест'), '| copy:', t2.includes('Экземпляр: Актёр Сидоров'), '| watermark:', t2.split('Актёр Сидоров').length - 1 >= 3);
  console.log('errors', errs);
  await b.close();
})();
