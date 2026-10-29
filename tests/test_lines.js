require('../app/core.js'); const C=globalThis.Core; const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
(async()=>{
  const data=new Uint8Array(require('fs').readFileSync('samples/ies51.pdf'));
  const doc=await pdfjs.getDocument({data}).promise; const pages=[];
  for(let i=1;i<=doc.numPages;i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();pages.push(tc.items.map(it=>({str:it.str,x:it.transform[4],y:it.transform[5],w:it.width})));}
  const p={chars:{},locs:{},episodes:[],rules:{},lines:[
   { name: 'Линия 1', target: 50, objects: 'ДОМ НИКОЛАЯ, ДОМ НИКЛОАЯ, ДОМ ГРАФА, ГОСПИТАЛЬ, ПОЛЕ БОЯ', owners: 'НИКОЛАЯ, КНЯГИНИ, МУРАТОВА, АПОЛЛИНАРИИ', chars: 'НИКОЛАЙ, АННА, МУРАТОВ, КНЯГИНЯ, АПОЛЛИНАРИЯ, МУРАВИНСКИЙ, СИМКА, ПОТАП, АКСИНЬЯ' },
   { name: 'Линия 2', target: 50, objects: 'ДОМ АВЕРИН, ДОМ АВРЕИН, ДОМ СПИЦЫН, КОНЮШНЯ, СЕНОВАЛ, МАГАЗИН, МУЖСКОЙ КЛУБ, ДВОРЯНСКОЕ СОБРАНИЕ', owners: 'АВЕРИНЫХ, СПИЦЫНЫХ, НИФОНТОВА, СМИРНОВА, РОМЫ, ЮЛИ, ЕКАТЕРИНЫ, ЕЛЕНЫ, ОЛИ', chars: 'АВЕРИН, ЕЛЕНА, РОМА, СПИЦЫН, ЕКАТЕРИНА, ЮЛЯ, НИФОНТОВ, ОЛЯ, ПРОХОР, СМИРНОВ, СОФЬЯ' }],
   lineRules:{special:{name:'ИИ',keywords:['ЗАЯВОЧНЫЙ ПЛАН','ФЛЭШФОРВАРД']},priority:'Линия 1'}};
  const fin=C.finalizeImport(C.classifyLines(C.pdfLines(pages)),p);
  // synthetic checks
  fin.blocks.push({id:'x1',t:'scene',x:'НАТ. ЗАЯВОЧНЫЙ ПЛАН. ДОМ НИКОЛАЯ - ДЕНЬ'},{id:'x2',t:'scene',x:'НАТ. КАРЕТА НИКОЛАЯ - ДЕНЬ'},{id:'x3',t:'action',x:'Едет прислуга.'},{id:'x4',t:'scene',x:'НАТ. ПОЛИЦИЯ. ПАРК - ДЕНЬ'},{id:'x5',t:'character',x:'ОФИЦИАНТ'},{id:'x6',t:'dialogue',x:'Да.'});
  const st=C.analyzeEpisode({blocks:fin.blocks,sceneMeta:fin.sceneMeta},p);
  st.scenes.forEach(s=>console.log(s.n,s.heading.padEnd(50),'->',s.line||'—',s.lineAuto||''));
  st.lines.forEach(l=>console.log(l.name,(l.share*100).toFixed(0)+'%',l.scenes));
  console.log(C.evalRules({blocks:fin.blocks,sceneMeta:fin.sceneMeta},p,st).find(r=>r.id==='lines'));
})();
