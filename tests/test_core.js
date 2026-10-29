require('../app/core.js'); const C=globalThis.Core;
for (const h of ['ПАВ. КВАРТИРА ВОРОНОВЫХ. КУХНЯ - УТРО','1-3. ИНТ. ОФИС. КАБИНЕТ ДЕНЬ 2.','нат. двор — ночь','ИНТ./НАТ. МАШИНА ИГОРЯ - ДЕНЬ','12. INT. HOUSE - NIGHT','ИНТ. БОЛЬНИЦА'])
  console.log(h,'=>',JSON.stringify(C.parseHeading(h)), '|', C.formatHeading(C.parseHeading(h)));
const p=C.demoProject(); const ep=p.episodes[0];
const st=C.analyzeEpisode(ep,p);
console.log('pages',st.pages.toFixed(3),'min',st.minutes.toFixed(2),'scenes',st.scenes.length);
st.scenes.forEach(s=>console.log(s.n,s.h.object,'|',s.h.sub,s.h.time,s.pav?'PAV':'',C.fmtPages(s.pages),C.fmtTime(s.min),s.cast.join(',')));
st.objects.forEach(o=>console.log(o.name,(o.share*100).toFixed(1)+'%',o.shifts.toFixed(2)));
C.evalRules(ep,p,st).forEach(r=>console.log(r.status,r.title,r.value));
// long pagination
const long=[];for(let i=0;i<40;i++){long.push({t:'scene',x:'ИНТ. ОФИС - ДЕНЬ'},{t:'action',x:'Очень длинное описание '.repeat(20)},{t:'character',x:'ИГОРЬ'},{t:'dialogue',x:'Реплика '.repeat(40)});}
const L=C.paginate(long,{lines:54}); console.log('long pages',L.total.toFixed(2),L.pages.length, L.pages.map(p=>p.items.reduce((a,i)=>a+i.sb+i.lines.length,0)).slice(0,8).join(','));
console.log(C.importText(`1. ИНТ. КВАРТИРА - ДЕНЬ\n\nМаша сидит на диване. Она\nсмотрит в окно.\n\nМАША\n(тихо)\nНу и где он?\n\nПЕТЯ. Я здесь!\n\nСМЕНА КАДРА:\n`).map(b=>b.t+': '+b.x).join('\n'));
console.log(C.exportFDX(ep,p,st,{}).slice(0,600));
