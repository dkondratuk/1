const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(500);
  await p.click('#delEp'); await p.click('#deOk'); await p.waitForTimeout(300); console.log('eps', await p.locator('.ep').count());
  await p.click('#projBtn'); await p.fill('#pmName','Вороновы 2'); await p.click('#pmOk'); await p.waitForTimeout(200); console.log(await p.locator('#projBtn').innerText());
  await p.click('#projBtn'); await p.click('#pmDel'); await p.click('#pmDel2'); await p.waitForTimeout(300); console.log(await p.locator('#projBtn').innerText(), await p.locator('.ep').count());
  await p.screenshot({path:'out/left.png'});
  await b.close();
})();
