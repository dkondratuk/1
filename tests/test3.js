const { chromium } = require('playwright');
const nm=require('path').resolve(__dirname,'../node_modules')+'/';
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({acceptDownloads:true,viewport:{width:1280,height:800}}); const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>{const u=r.request().url();
    if(u.includes('jszip.min.js'))return r.fulfill({path:nm+'jszip/dist/jszip.min.js',contentType:'text/javascript'});
    if(u.includes('jspdf.umd.min.js'))return r.fulfill({path:nm+'jspdf/dist/jspdf.umd.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.worker.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.worker.min.js',contentType:'text/javascript'});
    if(u.includes('pdf.min.js'))return r.fulfill({path:nm+'pdfjs-dist/build/pdf.min.js',contentType:'text/javascript'});
    if(u.startsWith('file:'))return r.continue(); return r.abort();});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(600);
  await p.screenshot({path:'out/z1280.png'});
  let K=0; const EXT={fdx:'fdx',docx:'docx',pdf:'pdf',fountain:'txt',project:'json'};
  async function exp(kind, extra){ const dl=p.waitForEvent('download'); await p.locator(`[data-exp=${kind}]`).dispatchEvent('click'); if(extra) await extra(); const d=await dl; const f='out/e'+(K++)+'.'+EXT[kind]; console.log('suggested',d.suggestedFilename()); await d.saveAs(f); console.log('saved',f); return f; }
  const fdx=await exp('fdx', async()=>{await p.click('#fxOk');});
  const docx=await exp('docx', async()=>{await p.click('#ftOk');}); const pdf=await exp('pdf', async()=>{await p.click('#pdfOk');}); const txt=await exp('fountain');
  await exp('project');
  for (const f of [fdx,docx,pdf,txt]) {
    await p.locator('#btnImport').dispatchEvent('click'); await p.waitForTimeout(200);
    const [fc]=await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles(f);
    await p.waitForSelector('#impDone',{timeout:15000});
    console.log(f, '->', (await p.locator('#modal p').first().innerText()));
    if (f===pdf) await p.screenshot({path:'out/imp_pdf.png'});
    await p.click('#impDone');
    const bl=await p.evaluate(()=>window.__draft.readBlocks().map(b=>b.t[0]+':'+b.x.slice(0,30)));
    console.log(bl.slice(0,14).join(' | '));
  }
  await b.close();
})();
