const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message));
  await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(500);
  // lines live in Производство → «Параметры студии…» (producer or editor)
  await p.evaluate(() => { const d = window.__draft; d.S.me = { name: 'Продюсер', role: 'producer' }; d.applyRole(); });
  await p.locator('#mStudio').dispatchEvent('click'); await p.waitForTimeout(200);
  for (const [i, name] of [[0, 'Группа А'], [1, 'Группа Б']]) { await p.click('#addLine'); await p.fill('[data-line="' + i + '"] [data-lf=name]', name); await p.fill('[data-line="' + i + '"] [data-lf=target]', '50'); }
  await p.click('#spOk'); await p.waitForTimeout(300);
  await p.evaluate(() => { const d = window.__draft; d.S.me = { name: 'Сценарист', role: 'writer' }; d.applyRole(); });
  await p.click('[data-ltab=scenes]'); await p.waitForTimeout(200);
  for (const [i,v] of [[0,'Группа А'],[1,'Группа А'],[2,'Группа Б'],[3,'Группа Б'],[5,'Группа А']]) { await p.locator('.sc').nth(i).click(); await p.waitForTimeout(150); await p.selectOption('#scLine',v); await p.waitForTimeout(300); }
  await p.screenshot({path:'out/lines1.png'});
  await p.click('[data-rtab=rules]'); await p.waitForTimeout(200); console.log(await p.locator('.rule:has-text("Баланс линий")').innerText());
  await b.close();
})();
