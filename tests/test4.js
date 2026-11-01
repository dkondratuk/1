const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1280,height:800}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(600);
  console.log(await p.evaluate(()=>{const r=e=>JSON.stringify(document.querySelector(e).getBoundingClientRect()); return [r('#page'),r('#cmarks'),r('.cmark'),getComputedStyle(document.querySelector('#cmarks')).right, document.querySelector('.cmark').outerHTML].join('\n')}));
  await b.close();
})();
