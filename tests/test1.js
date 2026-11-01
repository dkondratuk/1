const { chromium } = require('playwright');
const path=require('path'), fs=require('fs');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const nm=require('path').resolve(__dirname,'../node_modules')+'/';
  await p.route('**/*',r=>{const u=r.request().url();
    if(u.includes('jszip.min.js'))return r.fulfill({path:nm+'jszip/dist/jszip.min.js',contentType:'text/javascript'});
    if(u.includes('jspdf.umd.min.js'))return r.fulfill({path:nm+'jspdf/dist/jspdf.umd.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.worker.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.worker.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.min.js',contentType:'text/javascript'});
    if(u.startsWith('file:'))return r.continue(); return r.abort();});
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(800);
  await p.screenshot({path:'out/s1.png'});
  // type a new scene at end
  const last=p.locator('#editor .b').last(); await last.click(); await p.keyboard.press('End');
  await p.keyboard.press('Enter'); // after transition -> scene
  await p.keyboard.type('п'); await p.waitForTimeout(300);
  console.log('AC1', await p.locator('#ac').innerText());
  await p.keyboard.press('Tab'); await p.keyboard.type('кв'); await p.waitForTimeout(300);
  console.log('AC2', await p.locator('#ac').innerText());
  await p.keyboard.press('Tab'); await p.keyboard.type('. к'); await p.waitForTimeout(300);
  console.log('AC3', await p.locator('#ac').innerText());
  await p.keyboard.press('Tab'); await p.keyboard.type(' - н'); await p.waitForTimeout(300);
  console.log('AC4', await p.locator('#ac').innerText());
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.keyboard.type('Лена моет посуду.'); await p.keyboard.press('Enter'); await p.keyboard.press('Tab');
  await p.keyboard.type('и'); await p.waitForTimeout(300);
  console.log('AC5', await p.locator('#ac').innerText());
  await p.keyboard.press('Enter'); await p.keyboard.type('Я дома!'); await p.keyboard.press('Tab'); await p.keyboard.type('уходит'); 
  await p.keyboard.press('Enter'); await p.keyboard.type('Ушёл.');
  await p.waitForTimeout(600);
  const blocks=await p.evaluate(()=>window.__draft.readBlocks().slice(-7).map(b=>b.t+': '+b.x));
  console.log(blocks.join('\n'));
  console.log('ruler', await p.locator('#pageInfo').innerText());
  await p.screenshot({path:'out/s2.png'});
  // undo
  await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
  console.log('after undo', await p.evaluate(()=>window.__draft.readBlocks().slice(-1)[0].x));
  for (const t of ['rules','comments','bible','objects']) { await p.click(`[data-rtab=${t}]`); await p.waitForTimeout(200); await p.screenshot({path:`out/r_${t}.png`}); }
  await p.click('[data-ltab=scenes]'); await p.waitForTimeout(200); await p.locator('.sc').nth(3).click(); await p.waitForTimeout(400); await p.screenshot({path:'out/s3.png'});
  console.log('ERR',errs);
  await b.close();
})();
