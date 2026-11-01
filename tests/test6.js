const { chromium } = require('playwright');
const nm=require('path').resolve(__dirname,'../node_modules')+'/';
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>{const u=r.request().url();
    if(u.includes('jszip.min.js'))return r.fulfill({path:nm+'jszip/dist/jszip.min.js',contentType:'text/javascript'});
    if(u.startsWith('file:'))return r.continue(); return r.abort();});
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(500);
  await p.locator('#btnImport').dispatchEvent('click'); const [fc]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles('samples/treshka.docx');
  await p.waitForSelector('#impDone',{timeout:15000}); await p.screenshot({path:'out/imp_report.png'}); await p.click('#impDone'); await p.waitForTimeout(500);
  await p.evaluate(()=>document.querySelector('#desk').scrollTo(0,9200)); await p.waitForTimeout(300);
  await p.screenshot({path:'out/imp_text.png'});
  await p.click('[data-rtab=rules]'); await p.waitForTimeout(300); await p.screenshot({path:'out/imp_rules.png'});
  await b.close();
})();
