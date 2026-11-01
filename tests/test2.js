const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(500);
  await p.click('[data-rtab=bible]'); await p.waitForTimeout(300);
  console.log(await p.evaluate(()=>document.querySelector('#graph').innerHTML.slice(0,300)));
  await b.close();
})();
