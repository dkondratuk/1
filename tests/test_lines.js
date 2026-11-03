require('../app/core.js'); const C=globalThis.Core; const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
(async()=>{
  const data=new Uint8Array(require('fs').readFileSync('samples/ies51.pdf'));
  const doc=await pdfjs.getDocument({data}).promise; const pages=[];
  for(let i=1;i<=doc.numPages;i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();pages.push(tc.items.map(it=>({str:it.str,x:it.transform[4],y:it.transform[5],w:it.width})));}
  // lines are assigned by hand in the scene card (no auto-assignment): here every other scene goes to line 2
  const p={chars:{},locs:{},episodes:[],rules:{},lines:[
   { name: 'Линия 1', target: 50 },
   { name: 'Линия 2', target: 50 }]};
  const fin=C.finalizeImport(C.classifyLines(C.pdfLines(pages)),p);
  // synthetic checks
  fin.blocks.push({id:'x1',t:'scene',x:'НАТ. ЗАЯВОЧНЫЙ ПЛАН. ДОМ НИКОЛАЯ - ДЕНЬ'},{id:'x2',t:'scene',x:'НАТ. КАРЕТА НИКОЛАЯ - ДЕНЬ'},{id:'x3',t:'action',x:'Едет прислуга.'},{id:'x4',t:'scene',x:'НАТ. ПОЛИЦИЯ. ПАРК - ДЕНЬ'},{id:'x5',t:'character',x:'ОФИЦИАНТ'},{id:'x6',t:'dialogue',x:'Да.'});
  fin.blocks.filter(b=>b.t==='scene').forEach((b,i)=>{ (fin.sceneMeta[b.id]=fin.sceneMeta[b.id]||{}).line = i%2 ? 'Линия 2' : 'Линия 1'; });
  const st=C.analyzeEpisode({blocks:fin.blocks,sceneMeta:fin.sceneMeta},p);
  st.scenes.forEach(s=>console.log(s.n,s.heading.padEnd(50),'->',s.line||'—'));
  st.lines.forEach(l=>console.log(l.name,(l.share*100).toFixed(0)+'%',l.scenes));
  console.log(C.evalRules({blocks:fin.blocks,sceneMeta:fin.sceneMeta},p,st).find(r=>r.id==='lines'));
})();
