require('../app/core.js'); const C=globalThis.Core;
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
(async()=>{
  const data=new Uint8Array(require('fs').readFileSync(process.argv[2]));
  const doc=await pdfjs.getDocument({data,useSystemFonts:true}).promise;
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();pages.push(tc.items.map(it=>({str:it.str,x:it.transform[4],y:it.transform[5],w:it.width})));}
  const lines=C.pdfLines(pages);
  const p={chars:{},locs:{},episodes:[],rules:{}};
  const fin=C.finalizeImport(C.classifyLines(lines),p);
  const types={}; fin.blocks.forEach(b=>types[b.t]=(types[b.t]||0)+1); console.log(types);
  console.log(fin.blocks.slice(0,30).map(b=>b.t+': '+b.x.slice(0,80)).join('\n'));
  const st=C.analyzeEpisode({blocks:fin.blocks,sceneMeta:fin.sceneMeta},p);
  console.log('pages',st.pages.toFixed(1),'scenes',st.scenes.length,'guessed',fin.report.guessed.length,'untyped',fin.report.untyped, 'cast',fin.report.castScenes);
  st.scenes.forEach(s=>console.log(s.n,s.heading,'|',C.fmtPages(s.pages),s.cast.join(',')));
})();
