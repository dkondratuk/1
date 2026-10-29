const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(600);
  await p.click('#btnDraft'); await p.click('#drOk'); await p.waitForTimeout(200);
  // edit text
  await p.locator('#editor .b').nth(1).click(); await p.keyboard.press('End'); await p.keyboard.type(' Пахнет горелым.'); await p.waitForTimeout(400);
  await p.locator('.draftrow').first().click(); await p.waitForTimeout(300);
  console.log('DIFF', (await p.locator('#drDiff').innerText()).slice(0,200));
  await p.screenshot({path:'out/d1.png'}); await p.click('#drClose');
  await p.click('#btnSeason'); await p.waitForTimeout(300); await p.screenshot({path:'out/season.png'}); await p.click('#ssClose');
  // comment
  await p.evaluate(()=>{const el=document.querySelectorAll('#editor .b')[5]; const r=document.createRange(); r.setStart(el.firstChild,4); r.setEnd(el.firstChild,20); const s=getSelection(); s.removeAllRanges(); s.addRange(r);});
  await p.click('#btnComment'); await p.fill('#cmText','Сократить реплику'); await p.click('#cmOk'); await p.waitForTimeout(300);
  await p.screenshot({path:'out/c1.png'});
  // settings -> producer
  await p.click('#btnSettings'); await p.selectOption('#meRole','producer'); await p.fill('#meName','Анна'); await p.click('#stOk'); await p.waitForTimeout(300);
  console.log('editable', await p.getAttribute('#editor','contenteditable'));
  await p.click('[data-ltab=scenes]'); await p.waitForTimeout(200); await p.locator('.sc').nth(0).click(); await p.waitForTimeout(300);
  await p.screenshot({path:'out/sc.png'});
  await b.close();
})();
