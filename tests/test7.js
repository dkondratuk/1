const { chromium } = require('playwright');
const nm=require('path').resolve(__dirname,'../node_modules')+'/';
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>{const u=r.request().url();
    if(u.includes('jszip.min.js'))return r.fulfill({path:nm+'jszip/dist/jszip.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.worker.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.worker.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.min.js',contentType:'text/javascript'});
    if(u.startsWith('file:'))return r.continue(); return r.abort();});
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(500);
  for (const f of ['samples/ies51.pdf','samples/treshka.docx']) {
    await p.locator('#btnImport').dispatchEvent('click'); const [fc]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles(f);
    await p.waitForSelector('#impDone',{timeout:30000}); console.log(f, await p.locator('#modal p').first().innerText()); await p.click('#impDone'); await p.waitForTimeout(500);
  }
  await p.click('[data-ltab=scenes]'); await p.waitForTimeout(300); await p.screenshot({path:'out/num1.png'});
  await p.click('#renum'); await p.waitForTimeout(500); await p.screenshot({path:'out/num2.png'});
  console.log('after renum', await p.locator('.sc .num').first().innerText());
  await p.click('#undoRenum'); await p.waitForTimeout(500);
  console.log('after undo', await p.locator('.sc .num').first().innerText(), (await p.locator('#toast').isHidden()));
  await b.close();
})();
