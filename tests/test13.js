// Classic chrome: menus, toolbar, panels, status-bar hints, first-run dialog, zoom
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await p.goto('file://' + path.resolve(__dirname, '../app/_test.html')); await p.waitForTimeout(600);
  console.log('first run dialog:', await p.locator('#modal h2').innerText());
  await p.screenshot({ path: 'out/ui-start.png' });
  await p.click('#stGo'); await p.waitForTimeout(200);
  console.log('dialog closed:', await p.locator('#modalBack').isHidden(), 'remembered:', await p.evaluate(() => localStorage.getItem('draft.started')));
  await p.screenshot({ path: 'out/ui-classic.png' });
  // menus open on click, switch on hover, close on Escape
  await p.click('.mb[data-menu=file] .mb-btn'); await p.waitForTimeout(100);
  console.log('file menu open:', await p.locator('.mb[data-menu=file] .mm').isVisible(), 'items:', await p.locator('.mb[data-menu=file] .mm button').count());
  await p.hover('.mb[data-menu=format] .mb-btn'); await p.waitForTimeout(100);
  console.log('hover switched to format:', await p.locator('.mb[data-menu=format] .mm').isVisible(), 'file closed:', await p.locator('.mb[data-menu=file] .mm').isHidden());
  await p.screenshot({ path: 'out/ui-menu.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  console.log('escape closed:', await p.locator('.mb[data-menu=format] .mm').isHidden());
  // Format menu changes the element type of the current block
  await p.click('#editor .b.t-action'); await p.waitForTimeout(100);
  await p.click('.mb[data-menu=format] .mb-btn'); await p.click('.mm [data-type=transition]'); await p.waitForTimeout(200);
  console.log('type via menu:', await p.evaluate(() => document.querySelector('#editor .b.cur').dataset.t), 'select:', await p.locator('#elemSelect').inputValue());
  await p.keyboard.press('Control+2'); await p.waitForTimeout(100);
  console.log('hint:', await p.locator('#hint').innerText());
  // paper template from the menu
  await p.click('.mb[data-menu=format] .mb-btn'); await p.click('.mm [data-paper=a4ru]'); await p.waitForTimeout(300);
  console.log('paper:', await p.evaluate(() => window.__draft.S.project.rules.paper), 'ruler width:', await p.evaluate(() => document.querySelector('#pageRuler').style.width), 'checked:', await p.locator('[data-paper=a4ru].on').count());
  await p.click('.mb[data-menu=format] .mb-btn'); await p.click('.mm [data-paper=letter]'); await p.waitForTimeout(200);
  // panels toggle from the toolbar and come back from the Document menu
  await p.click('#tbNav'); await p.waitForTimeout(200);
  console.log('left hidden:', await p.locator('#leftPanel').isHidden(), 'menu check off:', await p.locator('#mLeft.on').count());
  await p.click('.mb[data-menu=doc] .mb-btn'); await p.click('#mScenes'); await p.waitForTimeout(200);
  console.log('left back on scenes:', await p.locator('#leftPanel').isVisible(), await p.locator('[data-ltab=scenes].active').count());
  await p.click('#closeRight'); await p.waitForTimeout(200);
  console.log('right hidden:', await p.locator('#rightPanel').isHidden());
  await p.click('.mb[data-menu=prod] .mb-btn'); await p.click('#mRules'); await p.waitForTimeout(200);
  console.log('right back on rules:', await p.locator('#rightPanel').isVisible(), await p.locator('[data-rtab=rules].active').count());
  // toolbar export menu and the File menu share the export actions
  await p.click('#btnExport'); await p.waitForTimeout(100);
  console.log('export menu:', await p.locator('#exportMenu').isVisible());
  await p.keyboard.press('Escape');
  // zoom
  await p.click('.mb[data-menu=view] .mb-btn'); await p.click('#mZoomIn'); await p.waitForTimeout(200);
  console.log('zoom:', await p.evaluate(() => window.__draft.S.zoom.toFixed(2)), await p.evaluate(() => document.querySelector('#page').style.transform));
  await p.keyboard.press('Control+0'); await p.waitForTimeout(200);
  console.log('zoom reset:', await p.evaluate(() => window.__draft.S.zoom));
  // status bar
  console.log('status:', await p.locator('#pageInfo').innerText(), '|', await p.locator('#roleInfo').innerText());
  // dark theme
  await p.click('.mb[data-menu=view] .mb-btn'); await p.click('#mThemeDark'); await p.waitForTimeout(300);
  await p.screenshot({ path: 'out/ui-dark.png' });
  console.log('dark:', await p.evaluate(() => document.documentElement.dataset.theme));
  // narrow window
  await p.setViewportSize({ width: 900, height: 700 }); await p.waitForTimeout(400);
  await p.screenshot({ path: 'out/ui-narrow.png' });
  console.log('errors', errs);
  await b.close();
})();
