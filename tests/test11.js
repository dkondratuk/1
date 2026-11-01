const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
  await p.addInitScript(() => { try { localStorage.setItem('draft.started', 'true'); } catch (e) {} });
  p.on('pageerror',e=>console.log('PE',e.message)); p.on('console',m=>{ if(m.type()==='error') console.log('CE',m.text()); });
  await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  await p.goto('file://'+require('path').resolve(__dirname,'../app/_test.html')); await p.waitForTimeout(600);
  // snapshot of the initial text
  const h1 = await p.evaluate(async()=>{ const d=window.__draft; d.recompute(); const h=await d.histAdd(d.S.ep,'тест'); return {reason:h.reason, n:(await d.histLoad(d.S.ep)).length}; });
  console.log('snap1', h1);
  // edit the first action block
  await p.click('#editor .b.t-action'); await p.keyboard.press('End'); await p.keyboard.type(' ДОБАВЛЕНО ПОСЛЕ СНИМКА'); await p.waitForTimeout(500);
  const h2 = await p.evaluate(async()=>{ const d=window.__draft; d.recompute(); await d.histAdd(d.S.ep,'тест 2'); return (await d.histLoad(d.S.ep)).length; });
  console.log('snaps', h2);
  await p.locator('#btnHistory').dispatchEvent('click'); await p.waitForTimeout(400);
  console.log('rows', await p.locator('.hist-row').count(), 'diff', await p.locator('#hsView .diff').count());
  await p.locator('.hist-row').nth(1).click(); await p.waitForTimeout(200);
  console.log('del lines', await p.locator('#hsView .diff .del').count(), 'add', await p.locator('#hsView .diff .add').count());
  await p.screenshot({path:'out/hist1.png'});
  // restore one scene (the first) from the older snapshot
  await p.click('#hsOne'); await p.waitForTimeout(400);
  const txt = await p.evaluate(()=>window.__draft.readBlocks().map(b=>b.x).join('\n'));
  console.log('scene restored, still contains added?', txt.includes('ДОБАВЛЕНО'));
  console.log('toast', await p.locator('#toast').innerText());
  // history now has the 'перед откатом сцены' entry
  console.log('hist n', await p.evaluate(async()=>(await window.__draft.histLoad(window.__draft.S.ep)).map(h=>h.reason).join(', ')));
  // writer cannot delete
  await p.click('#delEp'); await p.waitForTimeout(200); console.log('writer delete modal:', await p.locator('#modal h2').innerText()); await p.click('#npC');
  // switch role to producer
  await p.evaluate(()=>{ window.__draft.S.me={name:'Продюсер Петров',role:'producer'}; });
  await p.click('#delEp'); await p.waitForTimeout(200); console.log('producer modal:', await p.locator('#modal h2').innerText());
  await p.click('#deOk'); await p.waitForTimeout(600);
  console.log('eps after delete', await p.locator('.ep').count(), 'trash btn', await p.locator('#trashBtn').innerText());
  await p.click('#trashBtn'); await p.waitForTimeout(300); await p.screenshot({path:'out/trash1.png'});
  console.log('trash rows', await p.locator('.trash-row').count());
  await p.click('[data-restore]'); await p.waitForTimeout(600);
  console.log('eps after restore', await p.locator('.ep').count(), await p.locator('#epTitle').innerText());
  console.log('hist after restore', await p.evaluate(async()=>(await window.__draft.histLoad(window.__draft.S.ep)).length));
  // delete the project
  await p.click('#projBtn'); await p.click('#pmDel'); await p.click('#pmDel2'); await p.waitForTimeout(600);
  console.log('project after delete', await p.locator('#projBtn').innerText());
  await p.click('#trashBtn'); await p.waitForTimeout(300); await p.click('[data-restore]'); await p.waitForTimeout(800);
  console.log('project after restore', await p.locator('#projBtn').innerText(), await p.locator('.ep').count());
  // reload: trash and history persist
  await p.reload(); await p.waitForTimeout(800);
  console.log('after reload hist', await p.evaluate(async()=>(await window.__draft.histLoad(window.__draft.S.ep)).length), await p.locator('#trashBtn').innerText());
  await b.close();
})();
