// Chrome group, UI: hidden panels and focus mode keep the page, phone menus stay on screen, Navigator drawer, dark primary contrast, one dropdown, menubar keys
const { chromium } = require('playwright');
const path = require('path');
let fails = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const nm = path.resolve(__dirname, '../node_modules') + '/';
(async () => {
  const b = await chromium.launch();
  async function open(w, h, store) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
    p.on('pageerror', (e) => ok(false, 'page error ' + e.message));
    await p.addInitScript((st) => { try { localStorage.setItem('draft.started', 'true'); for (const k in st) localStorage.setItem(k, st[k]); } catch (e) {} }, store || {});
    await p.route('**/*', (r) => { const u = r.request().url();
      if (u.includes('jszip.min.js')) return r.fulfill({ path: nm + 'jszip/dist/jszip.min.js', contentType: 'text/javascript' });
      if (u.includes('jspdf.umd.min.js')) return r.fulfill({ path: nm + 'jspdf/dist/jspdf.umd.min.js', contentType: 'text/javascript' });
      return u.startsWith('file:') ? r.continue() : r.abort(); });
    await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(600);
    return p;
  }
  const geo = (p) => p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s), cs = getComputedStyle(e), q = e.getBoundingClientRect(); return { w: q.width, x: q.x, right: q.right, vis: cs.display !== 'none' && q.width > 0 && q.right > 0 && q.x < innerWidth }; };
    return { center: r('#center'), left: r('#leftPanel'), right: r('#rightPanel'), zoom: window.__draft.S.zoom, cls: document.body.className,
      on: { mLeft: document.querySelector('#mLeft').classList.contains('on'), tbNav: document.querySelector('#tbNav').classList.contains('on'), mRight: document.querySelector('#mRight').classList.contains('on'), tbProd: document.querySelector('#tbProd').classList.contains('on') } };
  });
  const click = async (p, s) => { await p.locator(s).first().dispatchEvent('click'); await p.waitForTimeout(250); };

  // 1. desktop 1440: hiding a panel or focus mode never hides the page
  let p = await open(1440, 900);
  await click(p, '#tbNav'); let g = await geo(p);
  ok(g.center.w > 1000 && g.zoom === 1, 'hide Navigator keeps the page: center ' + g.center.w + ' zoom ' + g.zoom);
  ok(g.right.vis && g.right.x > 1000, 'production panel stays on the right: x ' + g.right.x);
  ok(!g.on.tbNav && !g.on.mLeft && g.on.tbProd, 'marks after hiding Navigator ' + JSON.stringify(g.on));
  await click(p, '#tbNav'); await click(p, '#tbProd'); g = await geo(p);
  ok(g.center.w > 1100 && g.left.vis && !g.right.vis, 'hide Production keeps the page: center ' + g.center.w);
  await click(p, '#tbProd'); await click(p, '#btnFocus'); g = await geo(p);
  ok(g.center.w === 1440 && g.zoom === 1, 'focus mode shows the whole page: center ' + g.center.w);
  ok(!g.on.tbNav && !g.on.tbProd, 'focus mode marks both panels off');
  await click(p, '#tbNav'); g = await geo(p);
  ok(!/focus|hide-left/.test(g.cls) && g.left.vis && g.center.w > 700, 'Navigator toggle in focus mode leaves focus and shows the panel: ' + g.cls);
  ok(await p.evaluate(() => localStorage.getItem('draft.hideLeft')) === 'false', 'hideLeft not saved as hidden after leaving focus');
  await p.context().close();
  // boot with a saved hidden Navigator
  p = await open(1440, 900, { 'draft.hideLeft': 'true', 'draft.hideRight': 'true' }); g = await geo(p);
  ok(g.center.w === 1440 && g.zoom === 1, 'boot with both panels hidden shows the page: ' + g.center.w);
  await p.context().close();

  // 2. 1000px: hide Navigator and focus mode still give the page the full width
  p = await open(1000, 800); await click(p, '#tbNav'); g = await geo(p);
  ok(g.center.w === 1000 && g.zoom > 0.9, 'hide Navigator at 1000px: center ' + g.center.w + ' zoom ' + g.zoom);
  ok(!g.on.tbProd && !g.on.mRight, 'closed production drawer is not marked on at 1000px');
  await click(p, '#tbNav'); await click(p, '#btnFocus'); g = await geo(p);
  ok(g.center.w === 1000, 'focus at 1000px: center ' + g.center.w);
  await click(p, '#btnFocus'); await click(p, '#tbProd'); g = await geo(p);
  ok(g.right.vis && g.on.tbProd, 'production drawer opens and is marked at 1000px');
  await p.context().close();
  // a desktop-saved hidden production panel still opens as a drawer on a narrow window
  p = await open(1000, 800, { 'draft.hideRight': 'true' }); await click(p, '#tbProd'); g = await geo(p);
  ok(g.right.vis, 'production drawer opens at 1000px after hideRight was saved on desktop');
  await p.context().close();

  // 3. phone 390px: menus stay on screen, Navigator drawer reachable
  p = await open(390, 800);
  g = await geo(p); ok(g.center.w === 390, 'phone center full width ' + g.center.w);
  ok(!g.on.tbNav && !g.on.tbProd && !g.on.mLeft && !g.on.mRight, 'phone marks off while drawers are closed ' + JSON.stringify(g.on));
  for (const m of await p.$$eval('.mb', (x) => x.map((e) => e.dataset.menu))) {
    await click(p, `.mb[data-menu=${m}] .mb-btn`);
    const r = await p.evaluate((m) => { const q = document.querySelector(`.mb[data-menu=${m}] .mm`).getBoundingClientRect(); return { x: q.x, right: q.right }; }, m);
    ok(r.x >= 0 && r.right <= 390, `menu ${m} on screen: ${r.x}..${r.right}`);
    await p.mouse.click(200, 700); await p.waitForTimeout(100);
  }
  await click(p, '#btnExport');
  let r = await p.evaluate(() => { const q = document.querySelector('#exportMenu').getBoundingClientRect(); return { x: q.x, right: q.right }; });
  ok(r.x >= 0 && r.right <= 390, `export menu on screen: ${r.x}..${r.right}`);
  await p.keyboard.press('Escape');
  await click(p, '#tbNav'); g = await geo(p);
  ok(g.left.vis && g.left.x >= 0 && g.left.w <= 390 && g.on.tbNav, 'phone Navigator opens as a drawer ' + JSON.stringify(g.left));
  ok(g.center.w === 390, 'page keeps its width under the drawer');
  await click(p, '#closeLeft'); g = await geo(p); ok(!g.left.vis, 'drawer closes with ×');
  await click(p, '#mScenes'); g = await geo(p);
  ok(g.left.vis && await p.evaluate(() => !document.querySelector('#pane-scenes').hidden), 'Документ → Список сцен opens the scene list on a phone');
  const sc = await p.$('#pane-scenes .sc');
  if (sc) { await sc.click(); await p.waitForTimeout(200); g = await geo(p); ok(!g.left.vis, 'picking a scene closes the phone drawer'); }
  await click(p, '#tbNav'); await click(p, '[data-ltab=episodes]'); await p.locator('#pane-episodes .ep').first().click(); await p.waitForTimeout(200);
  g = await geo(p); ok(!g.left.vis, 'picking an episode closes the phone drawer');
  await p.context().close();

  // 4. dark theme: primary buttons readable
  p = await open(1280, 800, { 'draft.theme': '"dark"' });
  await click(p, '#mStart');
  const cr = await p.evaluate(() => {
    const btn = document.querySelector('#modal .btn.primary'); const cs = getComputedStyle(btn);
    const lum = (s) => { const [r, g, b] = s.match(/\d+/g).slice(0, 3).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const a = lum(cs.color), c = lum(cs.backgroundColor); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
  });
  ok(cr >= 4.5, 'dark primary button contrast ' + cr.toFixed(2));
  await p.context().close();

  // 5. only one dropdown at a time, 6. menubar keyboard
  p = await open(1280, 800);
  const vis = () => p.evaluate(() => ({ mm: [...document.querySelectorAll('.mb .mm')].filter((x) => !x.hidden).length, exp: !document.querySelector('#exportMenu').hidden }));
  await p.click('#btnExport'); await p.click('.mb[data-menu=file] .mb-btn'); let v = await vis();
  ok(v.mm === 1 && !v.exp, 'menubar menu closes Экспорт ' + JSON.stringify(v));
  await p.click('#btnExport'); v = await vis(); ok(v.mm === 0 && v.exp, 'Экспорт closes the menubar menu ' + JSON.stringify(v));
  await p.keyboard.press('Escape');
  await p.click('#editor .b >> nth=2'); await p.keyboard.press('End');
  const caret = () => p.evaluate(() => { const s = getSelection(); return document.activeElement.id + ':' + (s.anchorNode && s.anchorNode.textContent.slice(0, 20)) + ':' + s.anchorOffset; });
  const before = await caret();
  const act = () => p.evaluate(() => { const a = document.activeElement; const m = a.closest('.mb'); return (m ? m.dataset.menu : '') + '|' + (a.id || a.textContent.trim().slice(0, 20)); });
  await p.keyboard.press('F10'); ok((await act()) === 'file|Файл', 'F10 focuses Файл: ' + await act());
  await p.keyboard.press('ArrowDown'); let a = await act(); v = await vis();
  ok(v.mm === 1 && a === 'file|mNewEp', 'ArrowDown opens Файл at the first item: ' + a);
  await p.keyboard.press('ArrowDown'); a = await act(); ok(a === 'file|mNewSeason', 'ArrowDown moves to the next item: ' + a);
  await p.keyboard.press('ArrowRight'); a = await act(); ok(a.startsWith('edit|') && (await p.evaluate(() => document.querySelector('.mb[data-menu=edit]').classList.contains('open'))), 'ArrowRight opens the next menu: ' + a);
  await p.keyboard.press('Escape'); a = await act(); v = await vis(); ok(v.mm === 0 && a.startsWith('edit|'), 'Escape closes the menu and keeps focus on its title: ' + a);
  await p.keyboard.press('Escape'); ok((await caret()) === before, 'second Escape returns to the caret in the text: ' + await caret() + ' vs ' + before);
  await p.keyboard.press('Alt'); a = await act(); ok(a === 'file|Файл', 'lone Alt focuses the menubar: ' + a);
  await p.keyboard.press('Alt'); ok((await caret()) === before, 'Alt again returns to the text');
  await p.keyboard.down('Alt'); await p.keyboard.press('Shift'); await p.keyboard.up('Alt'); ok((await caret()) === before, 'Alt+Shift (layout switch) does not focus the menubar');
  // a View command run from the keyboard hands focus back to the text
  await p.keyboard.press('F10'); for (let i = 0; i < 2; i++) await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowDown'); a = await act(); ok(a.startsWith('view|'), 'reached Вид: ' + a);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await p.context().close();

  await b.close();
  console.log(n - fails + '/' + n + ' chrome UI checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
