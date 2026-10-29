const { chromium } = require('playwright');
const nm=require('path').resolve(__dirname,'../node_modules')+'/';
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>{const u=r.request().url();
    if(u.includes('pdf.worker.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.worker.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.min.js',contentType:'text/javascript'});
    if(u.startsWith('file:'))return r.continue(); return r.abort();});
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(500);
  await p.click('#btnImport'); const [fc]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles('samples/ies51.pdf');
  await p.waitForSelector('#impDone',{timeout:30000}); await p.click('#impDone'); await p.waitForTimeout(400);
  await p.click('#btnSettings'); await p.click('#lineExample'); await p.waitForTimeout(200); await p.screenshot({path:'out/set.png'}); await p.click('#stOk'); await p.waitForTimeout(500);
  console.log(await p.locator('#pageInfo').innerText());
  await p.click('[data-ltab=scenes]'); await p.waitForTimeout(300); await p.locator('.sc').nth(8).click(); await p.waitForTimeout(300); await p.screenshot({path:'out/lines2.png'});
  await p.selectOption('#scLine','Линия 2 (Аверины и Спицыны)'); await p.waitForTimeout(400); console.log(await p.locator('#pageInfo').innerText());
  await b.close();
})();
