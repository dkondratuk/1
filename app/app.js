/* Драфт: interface. Editor, panels, import/export. */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtDate = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // embedded FreeMono as a fallback for machines without Courier New
  try {
    const st = document.createElement('style');
    st.textContent = '@font-face{font-family:"FreeMonoEmb";src:url(data:font/ttf;base64,' + window.FONT_FREEMONO + ') format("truetype");font-weight:400}' +
      '@font-face{font-family:"FreeMonoEmb";src:url(data:font/ttf;base64,' + window.FONT_FREEMONOBOLD + ') format("truetype");font-weight:700}';
    document.head.appendChild(st);
  } catch (e) { /* font fallback is optional */ }

  // ---------- storage ----------
  const DB = {
    open() {
      return new Promise((res) => {
        try {
          const r = indexedDB.open('draft-app', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    },
    async get(k) {
      const db = await this.dbp; if (!db) return null;
      return new Promise((res) => { try { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } });
    },
    async put(k, v) {
      const db = await this.dbp; if (!db) return false;
      return new Promise((res) => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } });
    },
    async del(k) {
      const db = await this.dbp; if (!db) return false;
      return new Promise((res) => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } });
    },
  };
  DB.dbp = DB.open();
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };

  const S = { db: null, project: null, ep: null, st: null, rulesRes: [], me: ls.get('draft.me', { name: 'Сценарист', role: 'writer' }), activeComment: null, curScene: null, ltab: 'episodes', rtab: ls.get('draft.rtab', 'stats'), graphScope: 'project', selChar: null };
  const persist = debounce(() => { if (S.db) DB.put('db', S.db); }, 700);

  // ---------- downloads (artifact viewer capability or a plain link) ----------
  let dlP = null;
  if (window.claude && typeof window.claude.use === 'function') dlP = window.claude.use('downloads').catch(() => null);
  const DL_OK = ['txt', 'json', 'md', 'docx', 'pdf', 'html', 'zip', 'csv'];
  async function saveFile(name, data, mime) {
    const ext = name.split('.').pop().toLowerCase();
    const dl = dlP ? await dlP : null;
    if (dl) {
      let fname = name, payload = data;
      if (!DL_OK.includes(ext)) {
        await loadLib('jszip');
        const z = new window.JSZip(); z.file(name, data);
        payload = await z.generateAsync({ type: 'blob' }); fname = name.replace(/\.[^.]+$/, '') + '.zip';
        toast('Файл ' + name + ' упакован в .zip — так его можно сохранить из браузера.');
      }
      try { await dl.save({ filename: fname, data: payload }); }
      catch (e) { if (e && e.code !== 'declined') toast('Не удалось сохранить файл: ' + (e.message || e.code)); }
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  const LIBS = {
    jszip: ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => window.JSZip],
    jspdf: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => window.jspdf],
    pdfjs: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => window.pdfjsLib],
    pdfworker: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', () => window.pdfjsWorker],
  };
  function loadLib(name) {
    const [url, check] = LIBS[name];
    if (check()) return Promise.resolve(check());
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = url;
      s.onload = () => res(check()); s.onerror = () => rej(new Error('Не загрузилась библиотека ' + name + '. Нужен интернет.'));
      document.head.appendChild(s);
    });
  }

  // ---------- toast & modal ----------
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800); }
  function modal(html, onMount) {
    $('#modal').innerHTML = html; $('#modalBack').hidden = false;
    if (onMount) onMount($('#modal'));
    const f = $('#modal input, #modal textarea, #modal button'); if (f) f.focus();
  }
  function closeModal() { $('#modalBack').hidden = true; $('#modal').innerHTML = ''; }
  $('#modalBack').addEventListener('mousedown', (e) => { if (e.target.id === 'modalBack') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalBack').hidden) closeModal(); });

  // ---------- data helpers ----------
  const P = () => S.project;
  function sortEpisodes(p) { p.episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number)); }
  function newEpisode(p, season, title, blocks) {
    const same = p.episodes.filter((e) => e.season === season);
    const ep = { id: C.uid(), season, number: same.length ? Math.max(...same.map((e) => e.number)) + 1 : 1, title: title || '', blocks: blocks || [{ id: C.uid(), t: 'scene', x: '' }], sceneMeta: {}, comments: [], drafts: [], checks: {}, updated: Date.now() };
    p.episodes.push(ep); sortEpisodes(p); return ep;
  }
  function openEpisode(id) {
    const ep = P().episodes.find((e) => e.id === id) || P().episodes[0];
    if (S.ep && S.ep !== ep && (S.ep.updated || 0) > (S.ep.histAt || 0)) histAdd(S.ep, 'при переключении серии');
    S.ep = ep; S.db.currentEpId = ep.id; S.undo = []; S.redo = []; S.activeComment = null;
    renderEditor(); recompute(true); renderEpisodes(); persist();
  }
  function openProject(id) {
    S.project = S.db.projects.find((p) => p.id === id) || S.db.projects[0];
    S.db.currentProjectId = S.project.id;
    S.project.rules = Object.assign({}, C.DEFAULT_RULES, S.project.rules || {});
    S.project.relations = S.project.relations || [];
    applyPaper();
    renderProjectSelect();
    openEpisode(S.db.currentEpId);
  }

  // ---------- editor ----------
  const ed = $('#editor');
  function blockHTML(b) { return '<div class="b t-' + b.t + '" data-t="' + b.t + '" data-id="' + b.id + '">' + (b.x ? esc(b.x) : '<br>') + '</div>'; }
  function renderEditor() { ed.innerHTML = S.ep.blocks.map(blockHTML).join(''); applyRole(); }
  function readBlocks() {
    const out = [];
    for (const el of [...ed.childNodes]) {
      if (el.nodeType === 3) { if (el.textContent.trim()) out.push({ id: C.uid(), t: 'action', x: el.textContent }); continue; }
      if (el.nodeType !== 1) continue;
      let t = el.dataset.t || 'action';
      let id = el.dataset.id;
      if (!id || out.some((b) => b.id === id)) { id = C.uid(); el.dataset.id = id; }
      const x = el.textContent.replace(/\n/g, ' ');
      out.push({ id, t, x });
    }
    if (!out.length) out.push({ id: C.uid(), t: 'action', x: '' });
    return out;
  }
  function normalizeDom() {
    let bad = false;
    for (const el of [...ed.childNodes]) if (el.nodeType === 3 || (el.nodeType === 1 && !el.classList.contains('b'))) bad = true;
    if (!ed.childNodes.length) bad = true;
    if (bad) {
      const caret = getCaret();
      const blocks = readBlocks();
      ed.innerHTML = blocks.map(blockHTML).join('');
      if (caret) setCaret(blocks[blocks.length - 1].id, (blocks[blocks.length - 1].x || '').length);
    }
  }
  function curBlockEl() {
    const sel = window.getSelection(); if (!sel.rangeCount) return null;
    let n = sel.anchorNode; while (n && n !== ed) { if (n.nodeType === 1 && n.classList.contains('b')) return n; n = n.parentNode; }
    return null;
  }
  function caretOffset(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0).cloneRange(); const pre = document.createRange();
    pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  }
  function getCaret() { const el = curBlockEl(); return el ? { id: el.dataset.id, off: caretOffset(el) } : null; }
  function setCaret(id, off) {
    const el = ed.querySelector('[data-id="' + id + '"]'); if (!el) return;
    const r = document.createRange(); let left = off, done = false;
    const walk = (n) => {
      if (done) return;
      if (n.nodeType === 3) { if (left <= n.length) { r.setStart(n, left); done = true; } else left -= n.length; return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    if (!done) { r.selectNodeContents(el); r.collapse(false); }
    r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    el.focus && ed.focus();
  }
  function rangeIn(el, start, end) {
    const r = document.createRange(); let pos = 0, s = false, e = false;
    const walk = (n) => {
      if (e) return;
      if (n.nodeType === 3) {
        if (!s && start <= pos + n.length) { r.setStart(n, start - pos); s = true; }
        if (s && end <= pos + n.length) { r.setEnd(n, end - pos); e = true; }
        pos += n.length; return;
      }
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return s && e ? r : null;
  }
  function setType(el, t) {
    if (!el) return;
    pushUndo();
    el.dataset.t = t; el.className = 'b t-' + t;
    if (t === 'paren' && !el.textContent.trim()) { el.textContent = '()'; setCaret(el.dataset.id, 1); }
    if (t !== 'paren' && el.textContent === '()') { el.innerHTML = '<br>'; setCaret(el.dataset.id, 0); }
    $('#elemSelect').value = t;
    scheduleRecompute(); acUpdate();
  }
  function insertBlockAfter(el, t, x) {
    const id = C.uid();
    el.insertAdjacentHTML('afterend', blockHTML({ id, t, x }));
    return ed.querySelector('[data-id="' + id + '"]');
  }
  const NEXT = { scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'scene' };
  const EMPTY_ENTER = { action: 'scene', dialogue: 'action', character: 'action', paren: 'dialogue', scene: 'action', transition: 'scene' };
  function onEnter() {
    const el = curBlockEl(); if (!el) return;
    const t = el.dataset.t;
    const text = el.textContent;
    if (!text.trim() || (t === 'paren' && text.trim() === '()')) { el.textContent = ''; setType(el, EMPTY_ENTER[t]); return; }
    pushUndo();
    const sel = window.getSelection(); if (!sel.isCollapsed) sel.deleteFromDocument();
    const off = caretOffset(el);
    const full = el.textContent;
    if (off === 0) { const id = C.uid(); el.insertAdjacentHTML('beforebegin', blockHTML({ id, t, x: '' })); scheduleRecompute(); return; }
    const before = full.slice(0, off), after = full.slice(off);
    if (t === 'character') registerChar(before);
    el.textContent = before || '';
    if (!before) el.innerHTML = '<br>';
    let nt = after.trim() ? t : NEXT[t];
    if (t === 'paren' && after.trim() === ')') { nt = 'dialogue'; el.textContent = before + ')'; }
    const nb = insertBlockAfter(el, nt, nt === 'paren' && !after.trim() ? '()' : (after.trim() === ')' ? '' : after));
    setCaret(nb.dataset.id, nt === 'paren' && !after.trim() ? 1 : 0);
    $('#elemSelect').value = nt;
    scheduleRecompute();
  }
  // a finished character cue goes into the project dictionary, so autocomplete and the bible see it
  function registerChar(text) {
    const n = C.charName(text);
    if (n && n.length > 1 && !P().chars[n]) P().chars[n] = { age: '', desc: '', minor: false, guest: false };
  }
  function onTab(shift) {
    const el = curBlockEl(); if (!el) return;
    const t = el.dataset.t, text = el.textContent.trim(), off = caretOffset(el);
    if (shift) { const back = { character: 'action', dialogue: 'character', paren: 'dialogue', transition: 'action', action: 'scene', scene: 'action' }; setType(el, back[t]); return; }
    if (t === 'action' && !text) return setType(el, 'character');
    if (t === 'character' && !text) return setType(el, 'transition');
    if (t === 'transition' && !text) return setType(el, 'action');
    if (t === 'scene' && !text) return setType(el, 'action');
    if (t === 'paren' && (!text || text === '()')) { el.innerHTML = '<br>'; return setType(el, 'dialogue'); }
    if (t === 'dialogue') {
      if (!text) return setType(el, 'paren');
      if (off >= el.textContent.length) { pushUndo(); const nb = insertBlockAfter(el, 'paren', '()'); setCaret(nb.dataset.id, 1); $('#elemSelect').value = 'paren'; scheduleRecompute(); }
      return;
    }
    if (t === 'action' && text) return setType(el, 'character');
  }

  // undo / redo (our own, because the editor changes blocks programmatically)
  S.undo = []; S.redo = [];
  let lastEdit = 0;
  function snapshot() { return { blocks: readBlocks(), caret: getCaret(), sceneMeta: JSON.parse(JSON.stringify(S.ep.sceneMeta || {})) }; }
  function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 200) S.undo.shift(); S.redo = []; lastEdit = Date.now(); }
  function restore(sn) { S.ep.blocks = sn.blocks; if (sn.sceneMeta) S.ep.sceneMeta = sn.sceneMeta; renderEditor(); if (sn.caret) setCaret(sn.caret.id, sn.caret.off); recompute(); }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }

  ed.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); onEnter(); return; }
    if (Date.now() - lastEdit > 900 || /delete/.test(e.inputType) && !window.getSelection().isCollapsed) pushUndo();
    lastEdit = Date.now();
  });
  ed.addEventListener('input', () => {
    normalizeDom();
    const el = curBlockEl();
    if (el && el.dataset.t === 'action' && /^(ИНТ|НАТ|ПАВ)[.\s]/i.test(el.textContent) && el.textContent.length < 8) { el.dataset.t = 'scene'; el.className = 'b t-scene'; $('#elemSelect').value = 'scene'; }
    scheduleRecompute(); acUpdate();
  });
  ed.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!$('#ac').hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acMove(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Escape') { e.preventDefault(); acHide(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        const acceptedEnter = e.key === 'Enter' && AC.ctx === 'character';
        if (acAccept()) { e.preventDefault(); if (acceptedEnter) onEnter(); return; }
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); acHide(); onEnter(); return; }
    if (e.key === 'Tab') { e.preventDefault(); onTab(e.shiftKey); return; }
    if (mod && !e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); setType(curBlockEl(), C.TYPES[+e.key - 1]); return; }
    if (mod && (e.key === 'z' || e.key === 'я') && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && ((e.key === 'z' || e.key === 'я') && e.shiftKey || e.key === 'y' || e.key === 'н')) { e.preventDefault(); redo(); return; }
    if (mod && e.altKey && (e.code === 'KeyM')) { e.preventDefault(); startComment(); return; }
    if (mod && (e.key === 's' || e.key === 'ы')) { e.preventDefault(); recompute(); DB.put('db', S.db).then(() => toast('Сохранено на этом компьютере')); }
  });
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    pushUndo();
    if (!/\n/.test(text.trim())) { document.execCommand('insertText', false, text.replace(/\s+/g, ' ')); return; }
    if (text.length > 2000) { recompute(); histAdd(S.ep, 'перед вставкой текста', true); }
    const fin = C.finalizeImport(C.importText(text), P());
    const blocks = fin.blocks, rep = fin.report;
    Object.assign(S.ep.sceneMeta, fin.sceneMeta);
    const el = curBlockEl();
    let anchor = el;
    if (el && !el.textContent.trim()) { el.insertAdjacentHTML('afterend', blocks.map(blockHTML).join('')); anchor = el.nextSibling; el.remove(); }
    else if (el) el.insertAdjacentHTML('afterend', blocks.map(blockHTML).join(''));
    else ed.insertAdjacentHTML('beforeend', blocks.map(blockHTML).join(''));
    const last = blocks[blocks.length - 1]; if (last) setCaret(last.id, last.x.length);
    if (rep.newChars.length || rep.newLocs.length) toast('Вставлено ' + blocks.length + ' элементов. Новые персонажи: ' + rep.newChars.length + ', объекты: ' + rep.newLocs.length);
    recompute();
  });
  document.addEventListener('selectionchange', () => {
    const el = curBlockEl();
    $$('.b.cur', ed).forEach((x) => x !== el && x.classList.remove('cur'));
    if (el) { el.classList.add('cur'); $('#elemSelect').value = el.dataset.t; trackScene(el); }
    if (!el || !AC.el || AC.el !== el) acHide();
  });
  ed.addEventListener('click', () => acUpdate());

  function trackScene(el) {
    let n = el; while (n && n.dataset && n.dataset.t !== 'scene') n = n.previousElementSibling;
    const id = n && n.dataset ? n.dataset.id : null;
    if (id !== S.curScene) { S.curScene = id; $$('.sc', $('#pane-scenes')).forEach((x) => x.classList.toggle('active', x.dataset.id === id)); }
  }

  // ---------- autocomplete ----------
  const AC = { items: [], sel: 0, el: null, ctx: '', apply: null };
  function dictObjects() {
    const objs = {};
    for (const n of Object.keys(P().locs || {})) objs[n] = objs[n] || { n, count: 0, subs: {} };
    for (const ep of P().episodes) for (const b of (ep === S.ep ? readBlocks() : ep.blocks)) {
      if (b.t !== 'scene') continue;
      const h = C.parseHeading(b.x); if (!h.object) continue;
      const o = objs[h.object] || (objs[h.object] = { n: h.object, count: 0, subs: {} });
      o.count++; if (h.sub) o.subs[h.sub] = (o.subs[h.sub] || 0) + 1;
    }
    return objs;
  }
  function dictChars() {
    const c = {};
    for (const n of Object.keys(P().chars || {})) c[n] = 0;
    for (const ep of P().episodes) for (const b of (ep === S.ep ? readBlocks() : ep.blocks)) if (b.t === 'character') { const n = C.charName(b.x); if (n) c[n] = (c[n] || 0) + 1; }
    return c;
  }
  const startsWord = (name, q) => name.startsWith(q) || name.split(/[\s.«»"-]+/).some((w) => w.startsWith(q));
  function acUpdate() {
    const el = curBlockEl();
    if (!el || ed.getAttribute('contenteditable') === 'false') return acHide();
    const t = el.dataset.t, text = el.textContent, off = caretOffset(el);
    if (off < text.length && t !== 'character') return acHide();
    const U = C.up(text.slice(0, off));
    let items = [], ctx = t, hint = '';
    if (t === 'character') {
      const q = C.charName(U);
      if (/\($/.test(U.trim()) || /\([^)]*$/.test(U)) {
        const part = U.slice(U.lastIndexOf('('));
        items = C.EXTENSIONS.filter((x) => x.startsWith(part)).map((x) => ({ label: x, value: U.slice(0, U.lastIndexOf('(')).trimEnd() + ' ' + x }));
        hint = 'Расширение имени';
      } else if (q) {
        const dc = dictChars();
        items = Object.keys(dc).filter((n) => startsWord(n, q) && n !== q).sort((a, b) => dc[b] - dc[a] || a.localeCompare(b)).slice(0, 8)
          .map((n) => ({ label: n, value: n, note: dc[n] ? dc[n] + ' репл.' : 'из библии' }));
        hint = 'Tab или Enter — выбрать';
      }
    } else if (t === 'scene') {
      const h = C.parseHeading(U);
      const m = U.match(/^\s*(?:\d+[\-.\d]*\.?\s+)?(ИНТ\.?\s*\/\s*НАТ\.|НАТ\.?\s*\/\s*ИНТ\.|ИНТ\.|НАТ\.|ПАВ\.)\s*/);
      if (!m) {
        const q = U.trim();
        items = C.PREFIXES.filter((p) => !q || p.startsWith(q) || p.replace('.', '').startsWith(q)).map((p) => ({ label: p, value: p + ' ', note: { 'ИНТ.': 'интерьер', 'НАТ.': 'натура', 'ПАВ.': 'павильон', 'ИНТ./НАТ.': 'интерьер/натура' }[p] }));
        hint = 'Тип объекта';
      } else {
        const prefix = m[1].replace(/\s/g, '');
        const rest = U.slice(m[0].length);
        const dash = rest.search(/\s[-–—]\s?/);
        const objs = dictObjects();
        if (dash >= 0) {
          const q = rest.slice(dash).replace(/^\s[-–—]\s?/, '').trim();
          items = C.TIMES.filter((x) => x.startsWith(q) && x !== q).map((x) => ({ label: x, value: prefix + ' ' + rest.slice(0, dash).trim() + ' - ' + x }));
          hint = 'Время суток';
        } else if (/\.\s/.test(rest)) {
          const obj = rest.slice(0, rest.indexOf('. ')).trim(); const q = rest.slice(rest.indexOf('. ') + 2).trim();
          const o = objs[obj];
          if (o) items = Object.keys(o.subs).filter((s) => startsWord(s, q) && s !== q).sort((a, b) => o.subs[b] - o.subs[a]).map((s) => ({ label: s, value: prefix + ' ' + obj + '. ' + s, note: o.subs[s] + ' сц.' }));
          hint = 'Подобъект «' + obj + '». Дальше « - » и время';
        } else {
          const q = rest.trim();
          items = Object.values(objs).filter((o) => (!q || startsWord(o.n, q)) && o.n !== q).sort((a, b) => b.count - a.count).slice(0, 8)
            .map((o) => ({ label: o.n, value: prefix + ' ' + o.n, note: ((P().locs[o.n] || {}).pav ? 'павильон · ' : '') + o.count + ' сц.' }));
          hint = q ? 'Объекты проекта. Потом «. » — подобъект' : 'Объекты проекта';
        }
      }
      void h;
    } else if (t === 'transition') {
      items = C.TRANSITIONS.filter((x) => x.startsWith(U.trim()) && x !== U.trim()).map((x) => ({ label: x, value: x }));
    }
    if (!items.length) return acHide();
    AC.items = items; AC.sel = 0; AC.el = el; AC.ctx = ctx;
    const box = $('#ac');
    box.innerHTML = (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + items.map((it, i) => '<div class="it' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '"><span>' + esc(it.label) + '</span>' + (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</div>').join('');
    const sel = window.getSelection(); const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : el.getBoundingClientRect();
    const rect = r.width || r.height ? r : el.getBoundingClientRect();
    box.hidden = false;
    const top = Math.min(rect.bottom + 6, window.innerHeight - box.offsetHeight - 8);
    box.style.top = Math.max(8, top) + 'px';
    box.style.left = Math.min(rect.left, window.innerWidth - box.offsetWidth - 8) + 'px';
  }
  function acMove(d) { AC.sel = (AC.sel + d + AC.items.length) % AC.items.length; $$('#ac .it').forEach((x, i) => x.classList.toggle('sel', i === AC.sel)); }
  function acAccept(i) {
    const it = AC.items[i == null ? AC.sel : i]; if (!it || !AC.el) return false;
    pushUndo();
    AC.el.textContent = it.value; setCaret(AC.el.dataset.id, it.value.length);
    acHide(); scheduleRecompute();
    if (AC.ctx === 'scene') setTimeout(acUpdate, 0);
    return true;
  }
  function acHide() { $('#ac').hidden = true; AC.el = null; }
  $('#ac').addEventListener('mousedown', (e) => { const it = e.target.closest('.it'); if (it) { e.preventDefault(); acAccept(+it.dataset.i); } });

  // ---------- recompute ----------
  const scheduleRecompute = debounce(() => recompute(), 250);
  function recompute(full) {
    if (!S.ep) return;
    S.ep.blocks = readBlocks();
    S.ep.updated = Date.now();
    S.st = C.analyzeEpisode(S.ep, P());
    // under a numbering lock every new scene gets its A-number at once, so it never shifts the others
    if (S.ep.lock && C.lockAssign(S.st.scenes, S.ep.sceneMeta).length) S.st = C.analyzeEpisode(S.ep, P());
    S.rulesRes = C.evalRules(S.ep, P(), S.st, seasonContext());
    decorateEditor();
    if (S.zoom && S.zoom !== 1) sizePage();
    renderScenes(); renderRight(); renderRuler(); renderComments(); renderEpisodesMeta();
    persist();
    void full;
  }
  function seasonContext() {
    const objPages = {};
    for (const ep of P().episodes) {
      if (ep.season !== S.ep.season) continue;
      const st = ep === S.ep ? null : C.analyzeEpisode(ep, P());
      const objs = st ? st.objects : null;
      if (objs) objs.forEach((o) => { objPages[o.name] = (objPages[o.name] || 0) + o.pages; });
    }
    if (S.st) S.st.objects.forEach((o) => { objPages[o.name] = (objPages[o.name] || 0) + o.pages; });
    return { objPages };
  }
  function decorateEditor() {
    const els = [...ed.children];
    const breaks = S.st.lay.breaks;
    const sceneN = {}; S.st.scenes.forEach((s) => { sceneN[s.id] = s.num; });
    els.forEach((el, i) => {
      const br = breaks[i];
      if (br) { if (el.dataset.pb !== String(br.page)) el.dataset.pb = br.page; } else if (el.dataset.pb) delete el.dataset.pb;
      if (el.dataset.t === 'scene') { const n = sceneN[el.dataset.id]; if (n && el.dataset.n !== String(n)) el.dataset.n = n; }
      else if (el.dataset.n) delete el.dataset.n;
      const om = el.dataset.t === 'scene' && !!(S.ep.sceneMeta[el.dataset.id] || {}).omitted;
      if (om !== el.classList.contains('omit')) el.classList.toggle('omit', om);
    });
  }
  function renderRuler() {
    const st = S.st;
    $('#pageInfo').textContent = 'стр. ' + st.pages.toFixed(2) + ' · ' + C.fmtTime(st.minutes) + ' · ' + st.scenes.length + ' сц. · павильон ' + Math.round(st.pavPct) + '%' +
      (st.lines && st.lines.length ? ' · ' + st.lines.map((l) => l.name + ' ' + (l.share * 100).toFixed(0) + '%').join(' / ') : '');
    $('#roleInfo').textContent = roleName(S.me.role) + ': ' + S.me.name + (S.ep.lock ? ' · номера сцен залочены' : '');
  }

  // ---------- left: episodes ----------
  function renderProjectSelect() {
    $('#projectSelect').innerHTML = S.db.projects.map((p) => '<option value="' + p.id + '"' + (p === P() ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '<option value="__new">+ Новый проект…</option>';
  }
  $('#projectSelect').addEventListener('change', (e) => {
    if (e.target.value === '__new') {
      renderProjectSelect();
      modal('<h2>Новый проект</h2><div class="form-grid"><label>Название сериала<input type="text" id="npName" placeholder="Например, «Трёшка»"></label><label>Автор<input type="text" id="npAuthor"></label></div><p class="note">Справочники персонажей и объектов, правила студии и серии хранятся внутри проекта.</p><div class="actions"><button class="btn" id="npCancel">Отмена</button><button class="btn primary" id="npOk">Создать</button></div>', (m) => {
        $('#npCancel', m).onclick = closeModal;
        $('#npOk', m).onclick = () => {
          const p = { id: C.uid(), name: $('#npName', m).value.trim() || 'Новый сериал', author: $('#npAuthor', m).value.trim(), rules: Object.assign({}, C.DEFAULT_RULES), chars: {}, locs: {}, relations: [], episodes: [], created: Date.now() };
          newEpisode(p, 1, '');
          S.db.projects.push(p); closeModal(); S.db.currentEpId = p.episodes[0].id; openProject(p.id);
        };
      });
      return;
    }
    S.db.currentEpId = null; openProject(e.target.value);
  });
  function renderEpisodes() {
    const p = P(); const seasons = {};
    p.episodes.forEach((e) => { (seasons[e.season] = seasons[e.season] || []).push(e); });
    const drafts = p.episodes.flatMap((e) => (e.drafts || []).map((d) => ({ d, e }))).sort((a, b) => b.d.date - a.d.date).slice(0, 5);
    $('#pane-episodes').innerHTML = Object.keys(seasons).sort((a, b) => a - b).map((s) => '<div class="season"><h4>Сезон ' + s + '</h4>' +
      seasons[s].map((e) => '<div class="ep' + (e === S.ep ? ' active' : '') + '" data-id="' + e.id + '"><span class="t">Серия ' + e.number + (e.title ? '. ' + esc(e.title) : '') + '</span><span class="m" data-meta="' + e.id + '"></span></div>').join('') + '</div>').join('') +
      '<div class="row"><button class="btn small" id="addEp">+ Серия</button><button class="btn small ghost" id="addSeason">+ Сезон</button><button class="btn small ghost" id="renEp">Серия…</button><button class="btn small ghost danger" id="delEp">Удалить серию</button></div>' +
      '<div class="row"><button class="btn small ghost" id="projBtn">Проект: ' + esc(P().name) + '…</button><button class="btn small ghost" id="trashBtn">Корзина' + (S.trash.items.length ? ' · ' + S.trash.items.length : '') + '</button><button class="btn small ghost" id="histBtn">История</button></div>' +
      '<div class="h">Последние драфты</div>' + (drafts.length ? drafts.map((x) => '<div class="draftrow" data-ep="' + x.e.id + '" data-d="' + x.d.id + '"><span>С' + x.e.season + 'Е' + x.e.number + ' · ' + esc(x.d.name) + '</span><span class="muted mono">' + fmtDate(x.d.date) + '</span></div>').join('') : '<p class="note">Драфтов пока нет. Кнопка «Сохранить драфт» фиксирует версию серии с датой.</p>');
    renderEpisodesMeta();
    $$('.ep', $('#pane-episodes')).forEach((x) => x.onclick = () => { recompute(); openEpisode(x.dataset.id); });
    $('#addEp').onclick = () => { recompute(); const e = newEpisode(p, S.ep ? S.ep.season : 1, ''); openEpisode(e.id); };
    $('#addSeason').onclick = () => { recompute(); const e = newEpisode(p, Math.max(...p.episodes.map((x) => x.season)) + 1, ''); openEpisode(e.id); };
    $('#delEp').onclick = () => deleteEpisode();
    $('#projBtn').onclick = () => projectModal();
    $('#trashBtn').onclick = () => showTrash();
    $('#histBtn').onclick = () => showHistory();
    $('#renEp').onclick = () => modal('<h2>Серия</h2><div class="form-grid"><label>Сезон<input type="number" id="reS" min="1" value="' + S.ep.season + '"></label><label>Номер серии<input type="number" id="reN" min="1" value="' + S.ep.number + '"></label><label>Название<input type="text" id="reT" value="' + esc(S.ep.title) + '"></label></div><div class="actions"><button class="btn danger" id="reDel">Удалить серию</button><button class="btn" id="reC">Отмена</button><button class="btn primary" id="reOk">Сохранить</button></div>', (m) => {
      $('#reC', m).onclick = closeModal;
      $('#reOk', m).onclick = () => { S.ep.season = +$('#reS', m).value || 1; S.ep.number = +$('#reN', m).value || 1; S.ep.title = $('#reT', m).value.trim(); sortEpisodes(p); closeModal(); renderEpisodes(); renderTitle(); persist(); };
      $('#reDel', m).onclick = () => { closeModal(); deleteEpisode(); };
    });
    $$('.draftrow', $('#pane-episodes')).forEach((x) => x.onclick = () => { if (S.ep.id !== x.dataset.ep) { recompute(); openEpisode(x.dataset.ep); } showDrafts(x.dataset.d); });
    renderTitle();
  }
  function deleteEpisode() {
    const p = P();
    if (!canDelete()) return needProducer('Серию ' + S.ep.number + ' может удалить только продюсер.');
    modal('<h2>Удалить серию ' + S.ep.number + (S.ep.title ? ' «' + esc(S.ep.title) + '»' : '') + '?</h2><p class="note">Серия с текстом, драфтами, комментариями и историей уйдёт в корзину на ' + TRASH_DAYS + ' дней. Вернуть её можно кнопкой «Корзина» в списке серий.</p><div class="actions"><button class="btn" id="deC">Отмена</button><button class="btn danger" id="deOk">В корзину</button></div>', (m) => {
      $('#deC', m).onclick = closeModal;
      $('#deOk', m).onclick = async () => {
        closeModal(); recompute();
        const ep = S.ep;
        await histAdd(ep, 'перед удалением', true);
        await trashEpisode(p, ep);
        p.episodes = p.episodes.filter((e) => e !== ep);
        if (!p.episodes.length) newEpisode(p, 1, '');
        S.ep = null; openEpisode(p.episodes[0].id); toast('Серия в корзине: ' + TRASH_DAYS + ' дней её можно вернуть');
      };
    });
  }
  function projectModal() {
    const p = P();
    modal('<h2>Проект</h2><div class="form-grid"><label>Название<input type="text" id="pmName" value="' + esc(p.name) + '"></label><label>Автор (титульный лист)<input type="text" id="pmAuthor" value="' + esc(p.author || '') + '"></label></div>' +
      '<p class="note">Серий: ' + p.episodes.length + ' · персонажей в справочнике: ' + Object.keys(p.chars || {}).length + ' · объектов: ' + Object.keys(p.locs || {}).length + '. Правила студии и линии — в «Настройках».</p>' +
      '<div class="actions">' + (canDelete() ? '<button class="btn danger" id="pmDel">Удалить проект</button>' : '<span class="small muted">Удалить проект может только продюсер</span>') + '<button class="btn" id="pmC">Отмена</button><button class="btn primary" id="pmOk">Сохранить</button></div>', (m) => {
      $('#pmC', m).onclick = closeModal;
      $('#pmOk', m).onclick = () => { p.name = $('#pmName', m).value.trim() || p.name; p.author = $('#pmAuthor', m).value.trim(); closeModal(); renderProjectSelect(); renderEpisodes(); persist(); };
      if ($('#pmDel', m)) $('#pmDel', m).onclick = () => {
        $('#pmDel', m).outerHTML = '<span class="small">Проект «' + esc(p.name) + '» со всеми сериями уйдёт в корзину на ' + TRASH_DAYS + ' дней.</span> <button class="btn danger" id="pmDel2">Да, в корзину</button>';
        $('#pmDel2', m).onclick = async () => {
          closeModal(); recompute();
          await trashProject(p);
          S.ep = null;
          S.db.projects = S.db.projects.filter((x) => x !== p);
          if (!S.db.projects.length) { const np = { id: C.uid(), name: 'Новый сериал', author: '', rules: Object.assign({}, C.DEFAULT_RULES), chars: {}, locs: {}, relations: [], episodes: [], created: Date.now() }; newEpisode(np, 1, ''); S.db.projects.push(np); }
          S.db.currentEpId = null; openProject(S.db.projects[0].id); toast('Проект в корзине: ' + TRASH_DAYS + ' дней его можно вернуть');
        };
      };
    });
  }
  function renderEpisodesMeta() {
    for (const e of P().episodes) {
      const m = document.querySelector('[data-meta="' + e.id + '"]'); if (!m) continue;
      const st = e === S.ep && S.st ? S.st : (e._st || (e._st = C.analyzeEpisode(e, P())));
      m.textContent = st.pages.toFixed(1) + ' стр · ' + C.fmtTime(st.minutes) + ' · ' + st.scenes.length + ' сц' + (e.drafts && e.drafts.length ? ' · драфт ' + e.drafts.length : '');
    }
  }
  function renderTitle() { $('#epTitle').textContent = 'Сезон ' + S.ep.season + ', серия ' + S.ep.number + (S.ep.title ? ' — ' + S.ep.title : ''); }

  // ---------- left: scenes navigator & inspector ----------
  function renderScenes() {
    const pane = $('#pane-scenes'); if (pane.hidden) return;
    const r = P().rules;
    const insp = S.curScene && S.st.scenes.find((s) => s.id === S.curScene);
    const lock = S.ep.lock;
    const nc = C.numberingCheck(S.st.scenes, lock);
    const missing = lock ? C.lockMissing(lock, S.st.scenes) : [];
    const lockHTML = lock
      ? '<div class="rule ' + (missing.length || nc.issues.length ? 'warn' : 'ok') + '"><div class="top"><span class="dot"></span><span class="title">Номера сцен залочены</span><span class="val">' + fmtDate(lock.at) + '</span></div>' +
        '<div class="note">' + esc(lock.by) + '. Новые сцены получают буквенные номера (12A), убранные остаются как «ОПУЩЕНА».</div>' +
        (nc.issues.length ? '<ul>' + nc.issues.map((d) => '<li data-scene="' + d.sceneId + '">' + esc(d.text) + '</li>').join('') + '</ul>' : '') +
        (missing.length ? '<div class="note">Удалены без пометки «опущена»: ' + missing.map((n) => esc(n.num)).join(', ') + '</div><div class="row">' + missing.map((n) => '<button class="btn small" data-restore-omit="' + esc(n.num) + '">Вернуть ' + esc(n.num) + ' как опущенную</button>').join('') + '</div>' : '') +
        (canLock() ? '<div class="row"><button class="btn small ghost" id="unlockNum">Снять лок</button></div>' : '') + '</div>'
      : (canLock() && S.st.scenes.length ? '<div class="rule"><div class="top"><span class="dot"></span><span class="title">Номера сцен не залочены</span></div><div class="note">Перед запуском в производство зафиксируйте номера: после этого вставка даёт 12A, удаление даёт «ОПУЩЕНА», и график группы не ломается.</div><div class="row"><button class="btn small" id="lockNum">Залочить номера сцен</button></div></div>' : '');
    const numHTML = lockHTML + (nc.fromFile && !lock ? '<div class="rule ' + (nc.issues.length ? 'warn' : 'ok') + '"><div class="top"><span class="dot"></span><span class="title">Нумерация из файла</span><span class="val">' + (nc.issues.length ? nc.issues.length + ' замеч.' : 'по порядку') + '</span></div>' +
      (nc.partial ? '<div class="note">У части сцен номера нет.</div>' : '') +
      (nc.issues.length ? '<ul>' + nc.issues.map((d) => '<li data-scene="' + d.sceneId + '">' + esc(d.text) + '</li>').join('') + '</ul>' : '') +
      '<div class="row"><button class="btn small" id="renum">Перенумеровать по порядку' + (nc.proposal[0].includes('-') ? ' (' + esc(nc.proposal[0]) + '…)' : '') + '</button><span class="small muted">отменить: Ctrl+Z</span></div></div>' : '');
    pane.innerHTML = numHTML + S.st.scenes.map((s) => '<div class="sc' + (s.id === S.curScene ? ' active' : '') + (s.sec < r.shortSceneSec ? ' short' : '') + (s.omitted ? ' omitted' : '') + '" data-id="' + s.id + '"><span class="num">' + esc(s.num) + '</span><span class="hd">' + esc(s.heading || '(без заголовка)') + '</span>' +
      '<span class="meta"><span class="mono">' + C.fmtPages(s.pages) + ' · ' + C.fmtTime(s.min) + '</span>' + (s.pav ? '<span class="chip pav">павильон</span>' : '') + (s.night ? '<span class="chip night">ночь</span>' : '') +
      s.tags.map((t) => '<span class="chip tag">' + esc(C.TAGS[t]) + '</span>').join('') + (s.cast.length ? '<span>' + s.cast.length + ' арт.</span>' : '') + (s.day ? '<span>д.' + esc(s.day) + '</span>' : '') + (s.line ? '<span class="chip" style="border-color:' + lineColor(s.line) + ';color:' + lineColor(s.line) + '" title="' + (s.lineAuto ? 'авто: ' + esc(s.lineAuto) : 'задано вручную') + '">' + esc(s.line) + (s.lineAuto ? ' ·' : '') + '</span>' : '') + '</span>' +
      (s.synopsis ? '<span class="syn">' + esc(s.synopsis) + '</span>' : '') + '</div>').join('') +
      (insp ? inspectorHTML(insp) : '<p class="note">Нажмите на сцену, чтобы перейти к ней, добавить синопсис, сценарный день и производственные метки.</p>');
    $$('.sc', pane).forEach((x) => x.onclick = () => { S.curScene = x.dataset.id; jumpTo(x.dataset.id); renderScenes(); });
    $$('li[data-scene]', pane).forEach((li) => li.onclick = () => jumpTo(li.dataset.scene));
    const rn = $('#renum', pane);
    if (rn) rn.onclick = () => {
      histAdd(S.ep, 'перед перенумерацией', true);
      pushUndo();
      S.st.scenes.forEach((s, k) => { (S.ep.sceneMeta[s.id] = S.ep.sceneMeta[s.id] || {}).num = nc.proposal[k]; });
      recompute();
      const t = $('#toast'); t.innerHTML = 'Сцены перенумерованы: ' + esc(nc.proposal[0]) + ' … ' + esc(nc.proposal[nc.proposal.length - 1]) + ' <button class="btn small" id="undoRenum">Отменить</button>'; t.hidden = false;
      clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 8000);
      $('#undoRenum').onclick = () => { undo(); t.hidden = true; };
    };
    const lk = $('#lockNum', pane); if (lk) lk.onclick = lockNumbers;
    const ul = $('#unlockNum', pane); if (ul) ul.onclick = unlockNumbers;
    $$('[data-restore-omit]', pane).forEach((b) => b.onclick = () => restoreMissing(b.dataset.restoreOmit));
    if (insp) bindInspector(insp);
  }
  // ---------- numbering lock (shooting script) ----------
  function lockNumbers() {
    if (!canLock()) return needProducer('Залочить номера сцен');
    histAdd(S.ep, 'перед локом номеров', true);
    pushUndo();
    S.st.scenes.forEach((s) => { (S.ep.sceneMeta[s.id] = S.ep.sceneMeta[s.id] || {}).num = s.num; });
    S.ep.lock = { at: Date.now(), by: S.me.name + ' (' + roleName(S.me.role) + ')', nums: S.st.scenes.map((s) => ({ num: s.num, heading: s.heading })) };
    recompute(); renderScenes();
    toast('Номера сцен залочены: ' + S.st.scenes.length + ' сц.');
  }
  function unlockNumbers() {
    if (!canLock()) return needProducer('Снять лок номеров');
    modal('<h2>Снять лок номеров сцен</h2><p class="note">После снятия лока номера можно менять и перенумеровывать. Это ломает связь с графиком группы, поэтому действие записывается в историю с причиной.</p><label class="small muted">Причина<input type="text" id="ulReason" placeholder="Например: новый производственный драфт"></label><div class="actions"><button class="btn" id="ulC">Отмена</button><button class="btn primary" id="ulOk">Снять лок</button></div>', (m) => {
      $('#ulC', m).onclick = closeModal;
      $('#ulOk', m).onclick = () => {
        const reason = $('#ulReason', m).value.trim() || 'без причины';
        histAdd(S.ep, 'снят лок номеров: ' + reason, true);
        pushUndo();
        S.ep.lockLog = (S.ep.lockLog || []).concat([{ at: Date.now(), by: S.me.name, role: S.me.role, reason, was: S.ep.lock }]);
        delete S.ep.lock;
        closeModal(); recompute(); renderScenes(); toast('Лок снят');
      };
    });
  }
  // a scene that leaves the shooting script keeps its number as «ОПУЩЕНА»
  function omitScene(s) {
    pushUndo();
    const blocks = readBlocks();
    const meta = (S.ep.sceneMeta[s.id] = S.ep.sceneMeta[s.id] || {});
    meta.num = s.num; meta.omitted = true; meta.omittedBlocks = JSON.parse(JSON.stringify(blocks.slice(s.from, s.to + 1)));
    meta.omittedHeading = s.heading;
    blocks.splice(s.from, s.to - s.from + 1, { id: s.id, t: 'scene', x: C.omittedHeading(s.num) });
    S.ep.blocks = blocks; renderEditor(); recompute(); renderScenes();
  }
  function restoreScene(s) {
    const meta = S.ep.sceneMeta[s.id] || {};
    pushUndo();
    const blocks = readBlocks();
    const piece = meta.omittedBlocks && meta.omittedBlocks.length ? meta.omittedBlocks : [{ id: s.id, t: 'scene', x: meta.omittedHeading || '' }];
    blocks.splice(s.from, s.to - s.from + 1, ...piece);
    delete meta.omitted; delete meta.omittedBlocks; delete meta.omittedHeading;
    S.ep.blocks = blocks; renderEditor(); recompute(); renderScenes();
  }
  function restoreMissing(num) {
    pushUndo();
    const blocks = readBlocks();
    const at = C.lockInsertIndex(S.ep.lock, S.st.scenes, num, blocks.length);
    const id = C.uid();
    blocks.splice(at, 0, { id, t: 'scene', x: C.omittedHeading(num) });
    const rec = (S.ep.lock.nums || []).find((n) => n.num === num);
    S.ep.sceneMeta[id] = { num, omitted: true, omittedHeading: rec ? rec.heading : '' };
    S.ep.blocks = blocks; renderEditor(); recompute(); renderScenes();
  }
  function inspectorHTML(s) {
    const lock = !!S.ep.lock;
    return '<div class="inspector"><div class="row between"><b>Сцена ' + esc(s.num) + (s.omitted ? ' · опущена' : '') + '</b><span class="row">' + (lock ? (s.omitted ? '<button class="btn small" id="scRestore">Вернуть сцену</button>' : '<button class="btn small ghost danger" id="scOmit" title="Сцена остаётся в нумерации как «ОПУЩЕНА»">Опустить</button>') : '') + '<button class="btn small" id="scUp" title="Переместить выше">↑</button><button class="btn small" id="scDown" title="Переместить ниже">↓</button></span></div>' +
      '<label class="small muted">Синопсис<textarea id="scSyn" rows="2">' + esc(s.synopsis) + '</textarea></label>' +
      '<div class="row"><label class="small muted">Номер <input type="text" id="scNum" value="' + esc(s.fileNum ? s.num : '') + '" placeholder="' + esc(s.num) + '" style="width:70px"' + (lock ? ' readonly title="Номера залочены"' : '') + '></label>' +
      '<label class="small muted">Сценарный день <input type="text" id="scDay" value="' + esc(s.day) + '" style="width:70px"></label></div>' +
      ((P().lines || []).length ? '<label class="small muted">Линия <select id="scLine">' + lineOptions(s) + '</select></label>' : '') +
      '<div class="tags">' + Object.entries(C.TAGS).map(([k, v]) => '<label><input type="checkbox" data-tag="' + k + '"' + (s.tags.includes(k) ? ' checked' : '') + '>' + esc(v) + '</label>').join('') + '</div>' +
      '<label class="small muted">Персонажи без реплик (через запятую)<input type="text" id="scExtras" value="' + esc(((S.ep.sceneMeta[s.id] || {}).extras || []).join(', ')) + '"></label>' +
      '<div class="small muted">В сцене: ' + (s.cast.length ? s.cast.map(esc).join(', ') : '—') + '</div></div>';
  }
  function bindInspector(s) {
    const meta = () => (S.ep.sceneMeta[s.id] = S.ep.sceneMeta[s.id] || {});
    $('#scSyn').onchange = (e) => { meta().synopsis = e.target.value.trim(); recompute(); };
    $('#scDay').onchange = (e) => { meta().day = e.target.value.trim(); recompute(); };
    $('#scNum').onchange = (e) => { if (S.ep.lock) return; pushUndo(); meta().num = e.target.value.trim(); recompute(); };
    const om = $('#scOmit'); if (om) om.onclick = () => omitScene(s);
    const rs = $('#scRestore'); if (rs) rs.onclick = () => restoreScene(s);
    const sl = $('#scLine'); if (sl) sl.onchange = (e) => { pushUndo(); meta().line = e.target.value; recompute(); };
    $('#scExtras').onchange = (e) => { meta().extras = e.target.value.split(',').map((x) => C.charName(x)).filter(Boolean); recompute(); };
    $$('[data-tag]').forEach((c) => c.onchange = () => { const m = meta(); m.tags = m.tags || []; if (c.checked) m.tags.push(c.dataset.tag); else m.tags = m.tags.filter((t) => t !== c.dataset.tag); recompute(); });
    $('#scUp').onclick = () => moveScene(s, -1); $('#scDown').onclick = () => moveScene(s, 1);
  }
  function moveScene(s, dir) {
    const scenes = S.st.scenes; const k = scenes.indexOf(s); const other = scenes[k + dir]; if (!other) return;
    pushUndo();
    const blocks = readBlocks();
    const a = dir < 0 ? other : s, b = dir < 0 ? s : other;
    const pre = blocks.slice(0, a.from), A = blocks.slice(a.from, a.to + 1), B = blocks.slice(b.from, b.to + 1), post = blocks.slice(b.to + 1);
    S.ep.blocks = [...pre, ...B, ...A, ...post];
    renderEditor(); recompute(); jumpTo(s.id);
  }
  function jumpTo(blockId, flash) {
    const el = ed.querySelector('[data-id="' + blockId + '"]'); if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (flash !== false) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    if (ed.getAttribute('contenteditable') !== 'false') setCaret(blockId, el.textContent.length);
  }
  $$('[data-ltab]').forEach((b) => b.onclick = () => {
    S.ltab = b.dataset.ltab; $$('[data-ltab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#pane-episodes').hidden = S.ltab !== 'episodes'; $('#pane-scenes').hidden = S.ltab !== 'scenes';
    if (S.ltab === 'scenes') renderScenes(); else renderEpisodes();
  });

  // ---------- right panel ----------
  $$('[data-rtab]').forEach((b) => b.onclick = () => { S.rtab = b.dataset.rtab; ls.set('draft.rtab', S.rtab); renderRight(); });
  function renderRight() {
    $$('[data-rtab]').forEach((x) => x.classList.toggle('active', x.dataset.rtab === S.rtab));
    $$('.rpane').forEach((p) => { p.hidden = p.id !== 'pane-' + S.rtab; });
    const pane = $('#pane-' + S.rtab);
    if (pane.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
    ({ stats: renderStats, rules: renderRules, comments: renderCommentList, bible: renderBible, objects: renderObjects })[S.rtab](pane);
  }
  const lineColor = (name) => { const l = (P().lines || []).find((x) => x.name === name); return l ? l.color : 'var(--muted)'; };
  const lineOptions = (s) => {
    const sp = (P().lineRules || {}).special;
    const names = P().lines.map((l) => l.name).concat(sp && sp.name ? [sp.name] : []);
    return '<option value="">' + (s.lineAuto ? 'авто: ' + esc(s.line) + ' (' + esc(s.lineAuto) + ')' : '— не задана —') + '</option>' + names.map((n) => '<option value="' + esc(n) + '"' + (!s.lineAuto && s.line === n ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  };
  function linesHTML(st) {
    if (!st.lines || !st.lines.length) return '<div class="rule info"><div class="top"><span class="dot"></span><span class="title">Линии не настроены</span></div><div class="note">Если проект снимают две группы или нужно следить за балансом сюжетных линий, задайте линии и правила: сцены распределятся автоматически.</div><div class="row"><button class="btn small" id="setupLines">Настроить линии</button></div></div>';
    const tot = st.lines.reduce((a, l) => a + l.share, 0) + st.unassigned.share || 1;
    return '<div class="h">Линии · доля материала</div><div class="stack">' + st.lines.map((l) => '<i style="width:' + (l.share / tot * 100) + '%;background:' + l.color + '"></i>').join('') + '</div>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>Линия</th><th class="n">Сцен</th><th class="n">Стр.</th><th class="n">Время</th><th class="n">%</th><th class="n">Цель</th></tr></thead><tbody>' +
      st.lines.map((l) => '<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + l.color + ';margin-right:6px"></i>' + esc(l.name) + '</td><td class="n">' + l.scenes + '</td><td class="n">' + C.fmtPages(l.pages) + '</td><td class="n">' + C.fmtTime(l.min) + '</td><td class="n"><b>' + (l.share * 100).toFixed(0) + '</b></td><td class="n">' + (l.target != null ? l.target + '%' : '—') + '</td></tr>').join('') +
      (st.unassigned.scenes ? '<tr><td class="muted">без линии</td><td class="n">' + st.unassigned.scenes + '</td><td class="n">' + C.fmtPages(st.unassigned.pages) + '</td><td class="n">' + C.fmtTime(st.unassigned.min) + '</td><td class="n">' + (st.unassigned.share * 100).toFixed(0) + '</td><td></td></tr>' : '') +
      '</tbody></table></div><p class="note">Линия ставится автоматически по правилам проекта (объекты, владельцы, персонажи; точка у метки = авто) и правится вручную в карточке сцены. Правила и целевые доли — в «Настройках».</p>';
  }
  function renderStats(pane) {
    const st = S.st, r = P().rules, tot = st.minutes || 1;
    const seg = (v, c, l) => ({ v, c, l });
    const segs = [seg(st.pavMin, 'var(--pav)', 'Павильон'), seg(st.intMin, 'var(--accent)', 'Интерьер'), seg(st.extMin, 'var(--ok)', 'Натура')];
    pane.innerHTML =
      '<div class="kpis"><div class="kpi"><b>' + st.pages.toFixed(2) + '</b><span>страниц</span></div><div class="kpi"><b>' + C.fmtTime(st.minutes) + '</b><span>хронометраж</span></div><div class="kpi"><b>' + st.scenes.length + '</b><span>сцен</span></div>' +
      '<div class="kpi"><b>' + Math.round(st.pavPct) + '%</b><span>павильон</span></div><div class="kpi"><b>' + (st.nightMin / tot * 100).toFixed(0) + '%</b><span>ночь вне пав.</span></div><div class="kpi"><b>' + st.totalShifts.toFixed(1) + '</b><span>смен (оценка)</span></div></div>' +
      '<div class="stack">' + segs.map((s) => '<i style="width:' + (s.v / tot * 100) + '%;background:' + s.c + '"></i>').join('') + '</div>' +
      '<div class="legend">' + segs.map((s) => '<span><i style="background:' + s.c + '"></i>' + s.l + ' ' + C.fmtTime(s.v) + ' · ' + Math.round(s.v / tot * 100) + '%</span>').join('') + '</div>' +
      linesHTML(st) +
      '<div class="h">Объекты · доля по объёму текста</div><div class="tbl-wrap"><table class="t"><thead><tr><th>Объект</th><th class="n">Стр.</th><th class="n">Время</th><th class="n">%</th><th class="n">Смен</th></tr></thead><tbody>' +
      st.objects.map((o) => '<tr><td>' + esc(o.name) + (o.pav ? ' <span class="chip pav">пав.</span>' : '') + (o === st.main ? ' <span class="chip ok">основной</span>' : '') +
        '<div class="bar"><i class="' + (o.pav ? 'pav' : '') + '" style="width:' + (o.share * 100).toFixed(1) + '%"></i></div>' +
        (Object.keys(o.subs).length > 1 ? '<div class="small muted">' + Object.entries(o.subs).map(([k, v]) => esc(k) + ' ' + C.fmtTime(v)).join(' · ') + '</div>' : '') + '</td>' +
        '<td class="n">' + C.fmtPages(o.pages) + '</td><td class="n">' + C.fmtTime(o.min) + '</td><td class="n">' + (o.share * 100).toFixed(1) + '</td><td class="n">' + o.shifts.toFixed(2) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="h">Персонажи</div><div class="tbl-wrap"><table class="t"><thead><tr><th>Роль</th><th class="n">Сцен</th><th class="n">Репл.</th><th class="n">Время в кадре</th></tr></thead><tbody>' +
      st.characters.map((c) => '<tr><td>' + esc(c.name) + ((P().chars[c.name] || {}).minor ? ' <span class="chip warn">ребёнок</span>' : '') + ((P().chars[c.name] || {}).guest ? ' <span class="chip bad">дорогой</span>' : '') + '</td><td class="n">' + c.scenes + '</td><td class="n">' + c.replicas + '</td><td class="n">' + C.fmtTime(c.min) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="note">Страницы считаются по вёрстке Final Draft (' + C.PAPER[r.paper].name + ', ' + C.PAPER[r.paper].lines + ' строк, Courier 12) с переносами реплик и заголовков. Хронометраж = страницы × ' + r.minPerPage + ' мин. Смены — оценка по выработке: павильон ' + r.ratePav + ', интерьер ' + r.rateInt + ', натура ' + r.rateExt + ' мин/смену; сцены с детьми, животными и трюками ÷' + r.specialFactor + '. Поменять — в «Настройках».</p>';
    const sb = $('#setupLines', pane); if (sb) sb.onclick = () => $('#btnSettings').click();
  }
  function renderRules(pane) {
    const res = S.rulesRes;
    const cnt = (s) => res.filter((x) => x.status === s).length;
    const checks = S.ep.checks || (S.ep.checks = {});
    pane.innerHTML = '<div class="rules-summary"><span class="chip bad">нарушения: ' + cnt('fail') + '</span><span class="chip warn">предупреждения: ' + cnt('warn') + '</span><span class="chip ok">в норме: ' + cnt('ok') + '</span></div>' +
      '<p class="note">Шаблон: ' + esc(P().rules.preset) + '. Пороги меняются в «Настройках».</p>' +
      res.map((x) => '<div class="rule ' + x.status + '"><div class="top"><span class="dot"></span><span class="title">' + esc(x.title) + '</span><span class="val">' + esc(x.value) + '</span></div>' +
        (x.hint ? '<div class="note">' + esc(x.hint) + '</div>' : '') +
        (x.details.length ? '<ul>' + x.details.map((d) => '<li' + (d.sceneId ? ' data-scene="' + d.sceneId + '"' : '') + '>' + esc(d.text) + '</li>').join('') + '</ul>' : '') + '</div>').join('') +
      namingHTML() +
      '<div class="h">Чек-лист перед сдачей (вручную)</div><div class="manual">' + C.MANUAL_CHECKS.map((c, i) => '<label><input type="checkbox" data-chk="' + i + '"' + (checks[i] ? ' checked' : '') + '>' + esc(c) + '</label>').join('') + '</div>';
    $$('[data-scene]', pane).forEach((li) => li.onclick = () => jumpTo(li.dataset.scene));
    $$('[data-chk]', pane).forEach((c) => c.onchange = () => { checks[c.dataset.chk] = c.checked; persist(); });
    $$('[data-fix]', pane).forEach((b) => b.onclick = () => fixName(b.dataset.from, b.dataset.fix, b.dataset.kind));
  }
  function namingHTML() {
    const objs = Object.keys(dictObjects());
    const chars = Object.keys(dictChars());
    const io = C.namingIssues(objs).map((x) => Object.assign(x, { kind: 'obj' }));
    const ic = C.namingIssues(chars).map((x) => Object.assign(x, { kind: 'char' }));
    const all = [...io, ...ic];
    return '<div class="rule ' + (all.length ? 'warn' : 'ok') + '"><div class="top"><span class="dot"></span><span class="title">Написание для FilmToolz</span><span class="val">' + (all.length ? all.length + ' замеч.' : 'чисто') + '</span></div>' +
      '<div class="note">FilmToolz считает разным объектом любое расхождение в регистре, пробелах, точках и латинских буквах.</div>' +
      (all.length ? '<ul>' + all.map((x) => '<li>' + esc(x.name) + ' — ' + esc(x.why) + (x.fix ? ' <button class="btn small" data-kind="' + x.kind + '" data-from="' + esc(x.name) + '" data-fix="' + esc(x.fix) + '">Исправить</button>' : x.pair ? ' <button class="btn small" data-kind="' + x.kind + '" data-from="' + esc(x.pair[1]) + '" data-fix="' + esc(x.pair[0]) + '">Объединить в «' + esc(x.pair[0]) + '»</button>' : '') + '</li>').join('') + '</ul>' : '') + '</div>';
  }
  function fixName(from, to, kind) {
    pushUndo();
    for (const ep of P().episodes) {
      const blocks = ep === S.ep ? readBlocks() : ep.blocks;
      for (const b of blocks) {
        if (kind === 'obj' && b.t === 'scene') {
          const h = C.parseHeading(b.x);
          if (h.object === from) {
            // "ТРЕШКА ЗАЛ" -> "ТРЕШКА. ЗАЛ": the remainder becomes the sub-object
            const rest = from.startsWith(to + ' ') ? from.slice(to.length + 1) : '';
            h.object = to; if (rest) h.sub = rest + (h.sub ? '. ' + h.sub : '');
            b.x = C.formatHeading(h);
          }
        }
        if (kind === 'char' && b.t === 'character' && C.charName(b.x) === from) b.x = C.up(b.x).replace(from, to);
      }
      if (ep === S.ep) S.ep.blocks = blocks;
      delete ep._st;
    }
    if (kind === 'obj' && P().locs[from]) { P().locs[to] = P().locs[to] || P().locs[from]; delete P().locs[from]; }
    if (kind === 'char' && P().chars[from]) { P().chars[to] = P().chars[to] || P().chars[from]; delete P().chars[from]; }
    renderEditor(); recompute(); toast('«' + from + '» → «' + to + '» во всех сериях');
  }

  // ---------- comments ----------
  function startComment() {
    const sel = window.getSelection();
    const el = curBlockEl();
    if (!el || sel.isCollapsed) { toast('Выделите фрагмент текста, к которому нужен комментарий.'); return; }
    const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 200);
    const blockId = el.dataset.id;
    modal('<h2>Комментарий</h2><div class="cm"><div class="q">' + esc(quote) + '</div></div><textarea id="cmText" rows="4" placeholder="Что поправить и почему"></textarea>' +
      '<div class="row small muted">Автор: <b>' + esc(S.me.name) + '</b> <span class="role-badge' + (S.me.role === 'producer' ? ' prod' : '') + '">' + roleName(S.me.role) + '</span> · сменить в «Настройках»</div>' +
      '<div class="actions"><button class="btn" id="cmC">Отмена</button><button class="btn primary" id="cmOk">Добавить</button></div>', (m) => {
      $('#cmC', m).onclick = closeModal;
      $('#cmOk', m).onclick = () => {
        const text = $('#cmText', m).value.trim(); if (!text) return;
        const c = { id: C.uid(), blockId, quote, text, author: S.me.name, role: S.me.role, date: Date.now(), resolved: false, replies: [] };
        S.ep.comments.push(c); S.activeComment = c.id; closeModal();
        S.rtab = 'comments'; renderRight(); renderComments(); persist();
      };
      $('#cmText', m).focus();
    });
  }
  const roleName = (r) => ({ producer: 'Продюсер', editor: 'Редактор', writer: 'Сценарист', reader: 'Читатель' }[r] || 'Сценарист');
  const canEdit = () => S.me.role === 'writer' || S.me.role === 'editor';
  const canLock = () => S.me.role === 'producer' || S.me.role === 'editor';
  function renderComments() {
    const marks = $('#cmarks'); marks.innerHTML = '';
    const ranges = [], active = [];
    const used = [];
    for (const c of S.ep.comments || []) {
      const el = ed.querySelector('[data-id="' + c.blockId + '"]');
      c.lost = !el;
      if (!el) continue;
      const i = el.textContent.indexOf(c.quote);
      c.changed = i < 0;
      const r = i >= 0 ? rangeIn(el, i, i + c.quote.length) : null;
      if (r && !c.resolved) (c.id === S.activeComment ? active : ranges).push(r);
      let top = el.offsetTop - 96;
      while (used.some((u) => Math.abs(u - top) < 18)) top += 18;
      used.push(top);
      const m = document.createElement('div');
      m.className = 'cmark' + (c.role === 'producer' ? ' prod' : '') + (c.resolved ? ' resolved' : '');
      m.style.top = top + 'px';
      m.title = c.author + ': ' + c.text;
      m.textContent = '✎ ' + (1 + (c.replies || []).length);
      m.onclick = () => { S.activeComment = c.id; S.rtab = 'comments'; renderRight(); renderComments(); };
      marks.appendChild(m);
    }
    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set('cmt', new Highlight(...ranges));
      CSS.highlights.set('cmt-active', new Highlight(...active));
    }
  }
  function renderCommentList(pane) {
    const list = (S.ep.comments || []).slice().sort((a, b) => (a.resolved - b.resolved) || blockIndex(a.blockId) - blockIndex(b.blockId));
    pane.innerHTML = '<div class="row between"><span class="small muted">' + list.filter((c) => !c.resolved).length + ' открытых · ' + list.filter((c) => c.resolved).length + ' решённых</span><button class="btn small" id="cmNew">+ Комментарий</button></div>' +
      (list.length ? list.map((c) => '<div class="cm' + (c.id === S.activeComment ? ' active' : '') + (c.resolved ? ' resolved' : '') + '" data-c="' + c.id + '">' +
        '<div class="who"><b>' + esc(c.author) + '</b> <span class="role-badge' + (c.role === 'producer' ? ' prod' : '') + '">' + roleName(c.role) + '</span> · ' + fmtDate(c.date) + (c.resolved ? ' · <span class="chip ok">решено</span>' : '') + '</div>' +
        '<div class="q">' + esc(c.quote) + '</div>' + (c.lost ? '<div class="chip warn">фрагмент удалён</div>' : c.changed ? '<div class="chip warn">текст изменён</div>' : '') +
        '<div class="txt">' + esc(c.text) + '</div>' +
        (c.replies || []).map((r) => '<div class="reply"><div class="who"><b>' + esc(r.author) + '</b> <span class="role-badge' + (r.role === 'producer' ? ' prod' : '') + '">' + roleName(r.role) + '</span> · ' + fmtDate(r.date) + '</div><div class="txt">' + esc(r.text) + '</div></div>').join('') +
        '<div class="row"><input type="text" class="grow" placeholder="Ответить…" data-reply="' + c.id + '"><button class="btn small" data-res="' + c.id + '">' + (c.resolved ? 'Открыть' : 'Решено') + '</button><button class="btn small ghost danger" data-del="' + c.id + '" title="Удалить">×</button></div></div>').join('')
        : '<p class="note">Выделите фрагмент в тексте и нажмите «Комментарий» (Ctrl+Alt+M). Комментарий не меняет текст сценария: фрагмент подсвечивается, а на полях появляется метка.</p>') +
      '<p class="note">Чтобы передать замечания: «Экспорт → Файл проекта». Сценарист открывает файл, и комментарии продюсера встают на свои места.</p>';
    $('#cmNew', pane).onclick = startComment;
    $$('.cm', pane).forEach((x) => x.addEventListener('click', (e) => {
      if (e.target.closest('input,button')) return;
      const c = S.ep.comments.find((k) => k.id === x.dataset.c); S.activeComment = c.id; renderComments(); $$('.cm', pane).forEach((y) => y.classList.toggle('active', y === x));
      jumpTo(c.blockId, false);
    }));
    $$('[data-reply]', pane).forEach((inp) => inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      const c = S.ep.comments.find((k) => k.id === inp.dataset.reply);
      c.replies.push({ author: S.me.name, role: S.me.role, text: inp.value.trim(), date: Date.now() }); inp.blur(); renderCommentList(pane); renderComments(); persist();
    });
    $$('[data-res]', pane).forEach((b) => b.onclick = () => { const c = S.ep.comments.find((k) => k.id === b.dataset.res); c.resolved = !c.resolved; renderCommentList(pane); renderComments(); persist(); });
    $$('[data-del]', pane).forEach((b) => b.onclick = () => { S.ep.comments = S.ep.comments.filter((k) => k.id !== b.dataset.del); renderCommentList(pane); renderComments(); persist(); });
  }
  const blockIndex = (id) => { const i = S.ep.blocks.findIndex((b) => b.id === id); return i < 0 ? 1e9 : i; };
  $('#btnComment').onclick = startComment;

  // ---------- bible & relationships ----------
  function projectCharStats() {
    const res = {};
    for (const ep of P().episodes) {
      const st = ep === S.ep ? S.st : (ep._st || (ep._st = C.analyzeEpisode(ep, P())));
      for (const s of st.scenes) for (const n of s.cast) {
        const c = res[n] || (res[n] = { name: n, episodes: new Set(), scenes: 0, min: 0, replicas: 0, words: 0, partners: {}, objects: {}, first: null });
        c.episodes.add(ep.number + (P().episodes.some((e) => e.season > 1) ? '/' + ep.season : '')); c.scenes++; c.min += s.min;
        if (!c.first) c.first = { ep, s };
        c.objects[s.h.object] = (c.objects[s.h.object] || 0) + s.min;
        for (const m of s.cast) if (m !== n) c.partners[m] = (c.partners[m] || 0) + 1;
      }
      for (const c of st.characters) if (res[c.name]) { res[c.name].replicas += c.replicas; res[c.name].words += c.words; }
    }
    return res;
  }
  function renderBible(pane) {
    const ps = projectCharStats();
    const names = [...new Set([...Object.keys(P().chars), ...Object.keys(ps)])].sort((a, b) => ((ps[b] || {}).min || 0) - ((ps[a] || {}).min || 0));
    pane.innerHTML = '<div class="h">Карта связей</div><div class="row small"><label><input type="radio" name="gscope" value="project"' + (S.graphScope === 'project' ? ' checked' : '') + '> весь проект</label><label><input type="radio" name="gscope" value="episode"' + (S.graphScope === 'episode' ? ' checked' : '') + '> эта серия</label></div>' +
      '<div class="graph-wrap" id="graph"></div><p class="note">Линии — общие сцены, толщина — сколько раз встречаются. Нажмите на два имени по очереди, чтобы подписать связь (например, «супруги»).</p>' +
      '<div class="h">Библия персонажей</div>' +
      names.map((n) => {
        const c = P().chars[n] || { age: '', desc: '', minor: false, guest: false };
        const s = ps[n];
        const partners = s ? Object.entries(s.partners).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
        const objs = s ? Object.entries(s.objects).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
        const rel = (P().relations || []).filter((r) => r.a === n || r.b === n);
        return '<div class="chr"><div class="row between"><span class="nm">' + esc(n) + '</span><span class="small muted mono">' + (s ? s.scenes + ' сц · ' + C.fmtTime(s.min) : 'нет в тексте') + '</span></div>' +
          (c.desc ? '<div class="small">' + esc(c.desc) + (c.age ? ', ' + esc(c.age) : '') + '</div>' : '') +
          (s ? '<div class="small muted">Впервые: серия ' + s.first.ep.number + ', сц. ' + s.first.s.n + ' · серии: ' + [...s.episodes].join(', ') + ' · реплик ' + s.replicas + ', слов ' + s.words + '</div>' : '') +
          (partners.length ? '<div class="small muted">Чаще всего с: ' + partners.map(([k, v]) => esc(k) + ' (' + v + ')').join(', ') + '</div>' : '') +
          (rel.length ? '<div class="small">' + rel.map((r) => esc(r.a === n ? r.b : r.a) + ' — ' + esc(r.label)).join('; ') + '</div>' : '') +
          (objs.length ? '<div class="small muted">Где бывает: ' + objs.map(([k]) => esc(k)).join(', ') + '</div>' : '') +
          '<details><summary>Карточка</summary><div class="form-grid" style="margin-top:6px"><label>Возраст<input type="text" data-cf="age" data-n="' + esc(n) + '" value="' + esc(c.age) + '"></label><label>Кратко<input type="text" data-cf="desc" data-n="' + esc(n) + '" value="' + esc(c.desc) + '"></label></div>' +
          '<label class="small muted">Биография, арка, особенности речи<textarea data-cf="bio" data-n="' + esc(n) + '" rows="3">' + esc(c.bio || '') + '</textarea></label>' +
          '<div class="row small"><label><input type="checkbox" data-cf="minor" data-n="' + esc(n) + '"' + (c.minor ? ' checked' : '') + '> несовершеннолетний</label><label><input type="checkbox" data-cf="guest" data-n="' + esc(n) + '"' + (c.guest ? ' checked' : '') + '> дорогой артист / гест</label></div></details></div>';
      }).join('');
    $$('[name=gscope]', pane).forEach((r) => r.onchange = () => { S.graphScope = r.value; renderGraph(ps); });
    $$('[data-cf]', pane).forEach((inp) => inp.onchange = () => {
      const c = P().chars[inp.dataset.n] || (P().chars[inp.dataset.n] = { age: '', desc: '', minor: false, guest: false }); const f = inp.dataset.cf;
      c[f] = inp.type === 'checkbox' ? inp.checked : inp.value; delete c.auto;
      P().episodes.forEach((e) => delete e._st); persist();
      if (inp.type === 'checkbox') { S.st = C.analyzeEpisode(S.ep, P()); S.rulesRes = C.evalRules(S.ep, P(), S.st, seasonContext()); }
    });
    renderGraph(ps);
  }
  function renderGraph(ps) {
    let nodes, weight = {};
    if (S.graphScope === 'episode') {
      nodes = S.st.characters.map((c) => ({ n: c.name, w: c.scenes }));
      S.st.characters.forEach((c) => Object.entries(c.partners).forEach(([m, v]) => { const k = [c.name, m].sort().join('|'); weight[k] = v; }));
    } else {
      nodes = Object.values(ps).map((c) => ({ n: c.name, w: c.scenes }));
      Object.values(ps).forEach((c) => Object.entries(c.partners).forEach(([m, v]) => { const k = [c.name, m].sort().join('|'); weight[k] = v; }));
    }
    nodes.sort((a, b) => b.w - a.w); nodes = nodes.slice(0, 16);
    const W = 340, H = 300, cx = W / 2, cy = H / 2, R = 108;
    const pos = {}; nodes.forEach((nd, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, nodes.length); pos[nd.n] = [cx + R * Math.cos(a), cy + R * Math.sin(a), a]; });
    const maxW = Math.max(1, ...Object.values(weight));
    const rels = P().relations || [];
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Связи персонажей">';
    for (const [k, v] of Object.entries(weight)) {
      const [a, b] = k.split('|'); if (!pos[a] || !pos[b]) continue;
      const rel = rels.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
      svg += '<line class="edge' + (rel ? ' lab' : '') + '" x1="' + pos[a][0] + '" y1="' + pos[a][1] + '" x2="' + pos[b][0] + '" y2="' + pos[b][1] + '" stroke-width="' + (1 + 4 * v / maxW).toFixed(1) + '"/>';
      if (rel) svg += '<text class="elabel" text-anchor="middle" x="' + ((pos[a][0] + pos[b][0]) / 2) + '" y="' + ((pos[a][1] + pos[b][1]) / 2 - 3) + '">' + esc(rel.label) + '</text>';
    }
    const maxN = Math.max(1, ...nodes.map((x) => x.w));
    for (const nd of nodes) {
      const [x, y, a] = pos[nd.n]; const r = 5 + 9 * nd.w / maxN;
      const c = P().chars[nd.n] || {};
      const lx = x + Math.cos(a) * (r + 6), ly = y + Math.sin(a) * (r + 6) + 4;
      const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
      svg += '<circle data-node="' + esc(nd.n) + '" class="' + (c.minor ? 'minor' : '') + (S.selChar === nd.n ? ' sel' : '') + '" cx="' + x + '" cy="' + y + '" r="' + r.toFixed(1) + '" stroke-width="1.5"/><text x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '">' + esc(nd.n) + '</text>';
    }
    svg += '</svg>';
    const g = $('#graph'); if (!g) return;
    g.innerHTML = nodes.length ? svg : '<p class="note" style="padding:10px">Персонажи появятся, когда в тексте будут реплики.</p>';
    $$('circle[data-node]', g).forEach((c) => c.onclick = () => {
      const n = c.dataset.node;
      if (!S.selChar || S.selChar === n) { S.selChar = S.selChar === n ? null : n; renderGraph(ps); return; }
      const a = S.selChar, b = n; S.selChar = null;
      const ex = (P().relations || []).find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
      modal('<h2>' + esc(a) + ' и ' + esc(b) + '</h2><label class="small muted">Кто они друг другу<input type="text" id="relT" value="' + esc(ex ? ex.label : '') + '" placeholder="супруги, коллеги, бывшие…"></label><div class="actions">' + (ex ? '<button class="btn danger" id="relDel">Убрать связь</button>' : '') + '<button class="btn" id="relC">Отмена</button><button class="btn primary" id="relOk">Сохранить</button></div>', (m) => {
        $('#relC', m).onclick = () => { closeModal(); renderGraph(ps); };
        if (ex) $('#relDel', m).onclick = () => { P().relations = P().relations.filter((r) => r !== ex); closeModal(); renderRight(); persist(); };
        $('#relOk', m).onclick = () => { const l = $('#relT', m).value.trim(); if (ex) ex.label = l; else if (l) P().relations.push({ a, b, label: l }); closeModal(); renderRight(); persist(); };
      });
    });
  }

  // ---------- objects dictionary ----------
  function renderObjects(pane) {
    const objs = dictObjects();
    const names = Object.keys(objs).sort((a, b) => objs[b].count - objs[a].count);
    pane.innerHTML = '<p class="note">Отметьте павильоны: их объём идёт в «павильон» даже при заголовке ИНТ. Основной павильон — якорный объект проекта (квартира, офис). Базовые объекты освобождены от правила «не меньше 7 страниц».</p>' +
      names.map((n) => {
        const l = P().locs[n] || (P().locs[n] = { pav: false, base: false, main: false });
        const so = S.st.objects.find((o) => o.name === n);
        return '<div class="obj"><span class="nm">' + esc(n) + '</span><span class="small muted mono">' + objs[n].count + ' сц.' + (so ? ' · ' + C.fmtPages(so.pages) + ' стр. в серии' : '') + '</span>' +
          '<div class="flags"><label><input type="checkbox" data-lf="pav" data-n="' + esc(n) + '"' + (l.pav ? ' checked' : '') + '> павильон</label><label><input type="radio" name="mainObj" data-lf="main" data-n="' + esc(n) + '"' + (l.main ? ' checked' : '') + '> основной</label><label><input type="checkbox" data-lf="base" data-n="' + esc(n) + '"' + (l.base ? ' checked' : '') + '> базовый</label></div>' +
          (Object.keys(objs[n].subs).length ? '<div class="subs">Подобъекты: ' + Object.keys(objs[n].subs).map(esc).join(', ') + '</div>' : '') + '</div>';
      }).join('');
    $$('[data-lf]', pane).forEach((inp) => inp.onchange = () => {
      const f = inp.dataset.lf;
      if (f === 'main') Object.values(P().locs).forEach((l) => { l.main = false; });
      P().locs[inp.dataset.n][f] = inp.checked;
      P().episodes.forEach((e) => delete e._st);
      inp.blur(); recompute();
    });
  }

  // ---------- drafts ----------
  $('#btnDraft').onclick = () => {
    recompute();
    const n = (S.ep.drafts || []).length + 1;
    modal('<h2>Сохранить драфт</h2><label class="small muted">Название<input type="text" id="drName" value="Драфт ' + n + '"></label><label class="small muted">Что изменилось<textarea id="drNote" rows="2" placeholder="Например: правки продюсера по 3 и 5 сценам"></textarea></label><div class="actions"><button class="btn" id="drList">Все драфты</button><button class="btn" id="drC">Отмена</button><button class="btn primary" id="drOk">Сохранить</button></div>', (m) => {
      $('#drC', m).onclick = closeModal; $('#drList', m).onclick = () => showDrafts();
      $('#drOk', m).onclick = () => {
        const d = { id: C.uid(), name: $('#drName', m).value.trim() || 'Драфт ' + n, note: $('#drNote', m).value.trim(), date: Date.now(), author: S.me.name, blocks: JSON.parse(JSON.stringify(S.ep.blocks)), sceneMeta: JSON.parse(JSON.stringify(S.ep.sceneMeta || {})), pages: S.st.pages, scenes: S.st.scenes.length };
        S.ep.drafts.push(d); closeModal(); renderEpisodes(); persist(); toast('Сохранён «' + d.name + '»');
      };
    });
  };
  function showDrafts(openId) {
    const ds = (S.ep.drafts || []).slice().sort((a, b) => b.date - a.date);
    modal('<h2>Драфты · серия ' + S.ep.number + '</h2>' + (ds.length ? '<div class="tbl-wrap"><table class="t"><thead><tr><th>Драфт</th><th>Дата</th><th class="n">Стр.</th><th class="n">Сцен</th><th></th></tr></thead><tbody>' +
      ds.map((d) => '<tr><td><b>' + esc(d.name) + '</b>' + (d.note ? '<div class="small muted">' + esc(d.note) + '</div>' : '') + '<div class="small muted">' + esc(d.author || '') + '</div></td><td class="mono small">' + fmtDate(d.date) + '</td><td class="n">' + (d.pages || 0).toFixed(1) + '</td><td class="n">' + (d.scenes || 0) + '</td><td><div class="row"><button class="btn small" data-cmp="' + d.id + '">Сравнить с текущим</button><button class="btn small" data-rest="' + d.id + '">Восстановить</button></div></td></tr>').join('') +
      '</tbody></table></div>' : '<p class="note">У этой серии ещё нет драфтов.</p>') + '<div id="drDiff"></div><div class="actions"><button class="btn" id="drClose">Закрыть</button></div>', (m) => {
      $('#drClose', m).onclick = closeModal;
      $$('[data-cmp]', m).forEach((b) => b.onclick = () => { $('#drDiff', m).innerHTML = diffHTML(ds.find((d) => d.id === b.dataset.cmp)); });
      $$('[data-rest]', m).forEach((b) => b.onclick = () => {
        const d = ds.find((x) => x.id === b.dataset.rest);
        S.ep.drafts.push({ id: C.uid(), name: 'Авто: перед восстановлением «' + d.name + '»', date: Date.now(), author: S.me.name, blocks: JSON.parse(JSON.stringify(S.ep.blocks)), sceneMeta: JSON.parse(JSON.stringify(S.ep.sceneMeta || {})), pages: S.st.pages, scenes: S.st.scenes.length });
        histAdd(S.ep, 'перед восстановлением драфта', true);
        pushUndo(); S.ep.blocks = JSON.parse(JSON.stringify(d.blocks)); S.ep.sceneMeta = JSON.parse(JSON.stringify(d.sceneMeta || {}));
        closeModal(); renderEditor(); recompute(); renderEpisodes(); toast('Восстановлен «' + d.name + '». Текущий текст сохранён отдельным драфтом.');
      });
      if (openId && ds.find((d) => d.id === openId)) $('#drDiff', m).innerHTML = diffHTML(ds.find((d) => d.id === openId));
    });
  }
  function diffHTML(d) {
    const a = d.blocks.map((b) => b.t + '\u0001' + b.x), b = readBlocks().map((x) => x.t + '\u0001' + x.x);
    const n = a.length, m = b.length;
    if (n * m > 4e6) return '<p class="note">Слишком большой текст для сравнения в браузере.</p>';
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0, same = 0, add = 0, del = 0;
    const line = (s, cls) => { const [t, x] = s.split('\u0001'); out.push('<div class="' + cls + '">' + (t === 'scene' || t === 'character' ? esc(C.up(x)) : esc(x)) + '</div>'); };
    const flushSame = () => { if (same) out.push('<div class="sk">… без изменений: ' + same + ' абз.</div>'); same = 0; };
    while (i < n && j < m) {
      if (a[i] === b[j]) { same++; i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { flushSame(); line(a[i++], 'del'); del++; }
      else { flushSame(); line(b[j++], 'add'); add++; }
    }
    while (i < n) { flushSame(); line(a[i++], 'del'); del++; }
    while (j < m) { flushSame(); line(b[j++], 'add'); add++; }
    flushSame();
    return '<p class="small"><span class="chip ok">+' + add + ' добавлено</span> <span class="chip bad">−' + del + ' удалено</span> · «' + esc(d.name) + '» → текущий текст</p><div class="diff">' + out.join('') + '</div>';
  }

  // ---------- history (time rewind) & trash ----------
  // Snapshots of an episode live under their own key, so the project record stays small.
  const SNAP_EVERY = 15 * 60e3, TRASH_DAYS = 90;
  const canDelete = () => S.me.role === 'producer';
  const histKey = (ep) => 'hist:' + ep.id;
  S.hist = {};
  async function histLoad(ep) {
    if (!S.hist[ep.id]) S.hist[ep.id] = (await DB.get(histKey(ep))) || [];
    return S.hist[ep.id];
  }
  function epCopy(ep) { return { blocks: JSON.parse(JSON.stringify(ep.blocks)), sceneMeta: JSON.parse(JSON.stringify(ep.sceneMeta || {})) }; }
  async function histAdd(ep, reason, keep) {
    if (!ep) return null;
    if (ep === S.ep && S.ep.blocks) { /* S.ep.blocks is refreshed by recompute on every edit */ }
    const list = await histLoad(ep);
    const last = list[list.length - 1];
    const copy = epCopy(ep);
    const sig = JSON.stringify(copy);
    if (last && last.sig === sig) { ep.histAt = Date.now(); return last; }
    const st = ep === S.ep && S.st ? S.st : C.analyzeEpisode(ep, P());
    const h = { id: C.uid(), date: Date.now(), author: S.me.name, reason: reason || 'автоснимок', keep: !!keep, pages: st.pages, scenes: st.scenes.length, sig, blocks: copy.blocks, sceneMeta: copy.sceneMeta };
    list.push(h);
    S.hist[ep.id] = C.thinHistory(list);
    ep.histAt = h.date;
    await DB.put(histKey(ep), S.hist[ep.id]);
    persist();
    return h;
  }
  function autoSnap() {
    const ep = S.ep; if (!ep) return;
    if ((ep.updated || 0) > (ep.histAt || 0) && Date.now() - (ep.histAt || 0) >= SNAP_EVERY) histAdd(ep, 'автоснимок');
  }
  setInterval(autoSnap, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.ep && (S.ep.updated || 0) > (S.ep.histAt || 0)) { recompute(); histAdd(S.ep, 'автоснимок'); } });

  function sceneLabel(b, i) { const h = C.parseHeading(b.x || ''); return (h.num ? h.num + '. ' : (i + 1) + '. ') + C.up(C.formatHeading(h) || b.x || '(без заголовка)'); }
  async function showHistory(openId) {
    recompute();
    const list = (await histLoad(S.ep)).slice().sort((a, b) => b.date - a.date);
    const fmtFull = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    modal('<h2>Откат по времени · серия ' + S.ep.number + '</h2>' +
      '<p class="note">Снимок серии делается автоматически каждые 15 минут работы, при переключении серии и перед крупными изменениями (загрузка файла, восстановление драфта, перенумерация). За последние сутки хранятся все снимки, дальше по одному в час, после недели по одному в день. Можно вернуть всю серию или только одну сцену; текущий текст перед откатом тоже сохраняется.</p>' +
      (list.length ? '<input type="range" class="hs" id="hsRange" min="0" max="' + (list.length - 1) + '" value="' + (list.length - 1) + '" title="Влево — раньше, вправо — позже"><div class="hist-wrap"><div class="hist-list" id="hsList">' +
        list.map((h, i) => '<div class="hist-row" data-i="' + i + '"><span class="when">' + fmtFull(h.date) + '</span><span>' + esc(h.reason) + (h.keep ? ' ·' : '') + ' <span class="muted">' + esc(h.author || '') + '</span></span><span class="small muted">' + (h.pages || 0).toFixed(1) + ' стр · ' + (h.scenes || 0) + ' сц</span></div>').join('') +
        '</div><div class="hist-view" id="hsView"></div></div>' : '<p class="note">Снимков пока нет: они появятся после первых 15 минут работы над серией.</p>') +
      '<div class="actions"><button class="btn" id="hsDrafts">Именованные драфты</button><button class="btn" id="hsClose">Закрыть</button></div>', (m) => {
      $('#hsClose', m).onclick = closeModal; $('#hsDrafts', m).onclick = () => showDrafts();
      if (!list.length) return;
      const pick = (i) => {
        const h = list[i]; if (!h) return;
        $$('.hist-row', m).forEach((r) => r.classList.toggle('sel', +r.dataset.i === i));
        $('#hsRange', m).value = list.length - 1 - i;
        const scenes = h.blocks.map((b, idx) => (b.t === 'scene' ? { b, idx } : null)).filter(Boolean);
        $('#hsView', m).innerHTML = '<div class="row between"><b>' + fmtFull(h.date) + ' · ' + esc(h.reason) + '</b><button class="btn primary" id="hsAll">Вернуть всю серию</button></div>' +
          '<div class="row"><select id="hsScene">' + scenes.map(({ b, idx }) => '<option value="' + b.id + '">' + esc(sceneLabel(b, idx)) + '</option>').join('') + '</select><button class="btn" id="hsOne"' + (scenes.length ? '' : ' disabled') + '>Вернуть только эту сцену</button></div>' +
          diffHTML({ name: 'снимок ' + fmtFull(h.date), blocks: h.blocks });
        $('#hsAll', m).onclick = async () => {
          await histAdd(S.ep, 'перед откатом', true);
          pushUndo(); S.ep.blocks = JSON.parse(JSON.stringify(h.blocks)); S.ep.sceneMeta = JSON.parse(JSON.stringify(h.sceneMeta || {}));
          closeModal(); renderEditor(); recompute(); renderEpisodes();
          toast('Серия возвращена к состоянию на ' + fmtFull(h.date) + '. Отменить: Ctrl+Z, текущий текст сохранён в истории.');
        };
        $('#hsOne', m).onclick = async () => {
          const r = C.restoreScene(readBlocks(), h.blocks, $('#hsScene', m).value);
          if (!r) { toast('Сцена не найдена в снимке'); return; }
          await histAdd(S.ep, 'перед откатом сцены', true);
          pushUndo(); S.ep.blocks = r.blocks;
          closeModal(); renderEditor(); recompute(); renderEpisodes();
          toast((r.how === 'inserted' ? 'Сцена возвращена в текст' : 'Сцена заменена версией на ' + fmtFull(h.date)) + '. Отменить: Ctrl+Z.');
        };
      };
      $$('.hist-row', m).forEach((r) => r.onclick = () => pick(+r.dataset.i));
      $('#hsRange', m).oninput = (e) => pick(list.length - 1 - +e.target.value);
      const start = openId ? list.findIndex((h) => h.id === openId) : 0;
      pick(start < 0 ? 0 : start);
    });
  }
  $('#btnHistory').onclick = () => showHistory();

  // trash: deleted episodes and projects wait 90 days and can be put back by anyone
  S.trash = { items: [] };
  async function trashLoad() {
    const t = (await DB.get('trash')) || { items: [] };
    const cut = Date.now() - TRASH_DAYS * 86400e3;
    t.items = (t.items || []).filter((x) => x.deleted > cut);
    S.trash = t; return t;
  }
  const trashSave = () => DB.put('trash', S.trash);
  async function trashEpisode(p, ep) {
    const hist = await histLoad(ep);
    S.trash.items.unshift({ id: C.uid(), kind: 'episode', deleted: Date.now(), by: S.me.name, projectId: p.id, projectName: p.name, label: 'С' + ep.season + 'Е' + ep.number + (ep.title ? ' «' + ep.title + '»' : ''), data: JSON.parse(JSON.stringify(ep, (k, v) => (k === '_st' ? undefined : v))), hist: { [ep.id]: hist } });
    delete S.hist[ep.id];
    await trashSave();
  }
  async function trashProject(p) {
    const hist = {};
    for (const ep of p.episodes) { hist[ep.id] = await histLoad(ep); delete S.hist[ep.id]; }
    S.trash.items.unshift({ id: C.uid(), kind: 'project', deleted: Date.now(), by: S.me.name, projectId: p.id, projectName: p.name, label: 'Проект «' + p.name + '», серий: ' + p.episodes.length, data: stripCache(p), hist });
    await trashSave();
  }
  async function trashRestore(item) {
    for (const [id, list] of Object.entries(item.hist || {})) { S.hist[id] = list; await DB.put('hist:' + id, list); }
    S.trash.items = S.trash.items.filter((x) => x !== item); await trashSave();
    if (item.kind === 'project') {
      const p = item.data; p.id = S.db.projects.some((x) => x.id === p.id) ? C.uid() : p.id;
      S.db.projects.push(p); S.db.currentEpId = p.episodes[0] && p.episodes[0].id; openProject(p.id);
      toast('Проект «' + p.name + '» восстановлен');
      return;
    }
    let p = S.db.projects.find((x) => x.id === item.projectId);
    if (!p) { p = { id: item.projectId, name: item.projectName, author: '', rules: Object.assign({}, C.DEFAULT_RULES), chars: {}, locs: {}, relations: [], episodes: [], created: Date.now() }; S.db.projects.push(p); }
    const ep = item.data; if (p.episodes.some((e) => e.id === ep.id)) ep.id = C.uid();
    p.episodes.push(ep); sortEpisodes(p);
    if (p !== P()) { S.db.currentEpId = ep.id; openProject(p.id); } else openEpisode(ep.id);
    toast('Серия ' + item.label + ' восстановлена');
  }
  async function showTrash() {
    await trashLoad();
    const items = S.trash.items;
    const left = (x) => Math.max(0, Math.ceil((x.deleted + TRASH_DAYS * 86400e3 - Date.now()) / 86400e3));
    modal('<h2>Корзина</h2><p class="note">Удалённые серии и проекты хранятся здесь ' + TRASH_DAYS + ' дней вместе со всей историей и драфтами; вернуть их может любой участник. Удалять может только продюсер (роль задаётся в «Настройках»; в облачной версии роль выдаёт студия).</p>' +
      (items.length ? '<div class="tbl-wrap"><table class="t"><thead><tr><th>Что</th><th>Проект</th><th>Удалено</th><th>Кем</th><th class="n">Дней осталось</th><th></th></tr></thead><tbody>' +
        items.map((x) => '<tr class="trash-row"><td><b>' + esc(x.label) + '</b></td><td>' + esc(x.projectName) + '</td><td class="mono small">' + fmtDate(x.deleted) + '</td><td>' + esc(x.by || '') + '</td><td class="n">' + left(x) + '</td><td><button class="btn small" data-restore="' + x.id + '">Восстановить</button></td></tr>').join('') +
        '</tbody></table></div>' : '<p class="note">Корзина пуста.</p>') +
      '<div class="actions"><button class="btn" id="trClose">Закрыть</button></div>', (m) => {
      $('#trClose', m).onclick = closeModal;
      $$('[data-restore]', m).forEach((b) => b.onclick = () => { const it = items.find((x) => x.id === b.dataset.restore); closeModal(); trashRestore(it); });
    });
  }
  function needProducer(what) {
    modal('<h2>Нужна роль продюсера</h2><p class="note">' + what + ' Сценарист и читатель не могут удалять серии и проекты и трогать лок номеров: это защита от случайной или намеренной потери текста. Смените роль в «Настройках», если вы продюсер. Удалённое попадает в корзину на ' + TRASH_DAYS + ' дней, и вернуть его может любой участник.</p><div class="actions"><button class="btn" id="npC">Понятно</button></div>', (m) => { $('#npC', m).onclick = closeModal; });
  }

  // ---------- import ----------
  $('#btnImport').onclick = () => {
    modal('<h2>Загрузить готовый сценарий</h2><div class="drop" id="drop">Перетащите файл сюда или нажмите, чтобы выбрать<br><span class="small">Final Draft (.fdx), Word (.docx), PDF, Fountain или текст (.txt)</span></div>' +
      '<div class="form-grid"><label>Куда<select id="impWhere"><option value="new">Новая серия</option><option value="replace">Заменить текст этой серии</option></select></label><label>Сезон<input type="number" id="impSeason" min="1" value="' + S.ep.season + '"></label></div>' +
      '<p class="note">Сценарий переводится в формат Final Draft: заголовки сцен приводятся к виду «ИНТ. ОБЪЕКТ. ПОДОБЪЕКТ - ДЕНЬ», имена персонажей — к единому написанию, ремарки получают скобки. Персонажи и объекты сразу попадают в справочники проекта, сцены с ПАВ. — в павильон. Из КИТ Сценариста и Story Architect сохраните сценарий в .fdx или .docx.</p>' +
      '<label class="small muted">Или вставьте текст<textarea id="impText" rows="5" placeholder="1. ИНТ. КВАРТИРА - ДЕНЬ&#10;&#10;Маша смотрит в окно.&#10;&#10;МАША&#10;Ну и где он?"></textarea></label>' +
      '<div class="actions"><button class="btn" id="impC">Отмена</button><button class="btn primary" id="impTextOk">Разобрать текст</button></div>', (m) => {
      const drop = $('#drop', m);
      drop.onclick = () => { $('#fileInput').dataset.mode = 'script'; $('#fileInput').click(); };
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); };
      $('#impC', m).onclick = closeModal;
      $('#impTextOk', m).onclick = () => { const t = $('#impText', m).value; if (t.trim()) finishImport(C.importText(t), 'текст'); };
    });
  };
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (e.target.dataset.mode === 'project') openProjectFile(f); else importFile(f);
  });
  async function importFile(f) {
    const ext = f.name.split('.').pop().toLowerCase();
    try {
      toast('Разбираю ' + f.name + '…');
      let blocks;
      if (ext === 'fdx' || ext === 'xml') blocks = C.importFDX(await f.text());
      else if (ext === 'docx') {
        await loadLib('jszip');
        const zip = await window.JSZip.loadAsync(await f.arrayBuffer());
        const xml = await zip.file('word/document.xml').async('string');
        const stf = zip.file('word/styles.xml');
        const styles = C.docxStyles(stf ? await stf.async('string') : '');
        blocks = C.classifyLines(C.docxParagraphs(xml, undefined, styles));
      } else if (ext === 'pdf') blocks = await importPDF(f);
      else if (ext === 'json') { openProjectFile(f); return; }
      else blocks = C.importText(await f.text());
      if (!blocks || !blocks.length) throw new Error('В файле не нашлось текста сценария.');
      finishImport(blocks, f.name);
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
  }
  async function importPDF(f) {
    await loadLib('pdfjs');
    try { await loadLib('pdfworker'); } catch (e) { /* real worker may still load */ }
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfworker[0];
    const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      pages.push(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })));
    }
    return C.classifyLines(C.pdfLines(pages));
  }
  function finishImport(rawBlocks, source) {
    const where = ($('#impWhere') || {}).value || 'new';
    const season = +(($('#impSeason') || {}).value) || S.ep.season;
    recompute();
    const fin = C.finalizeImport(rawBlocks, P());
    const blocks = fin.blocks, rep = fin.report;
    let ep;
    if (where === 'replace') { histAdd(S.ep, 'перед загрузкой файла', true); pushUndo(); ep = S.ep; ep.blocks = blocks; ep.sceneMeta = fin.sceneMeta; }
    else {
      // a title line before the first scene names the episode
      let title = (source || '').replace(/\.[^.]+$/, '');
      if (blocks[0] && blocks[0].t === 'action' && blocks[1] && blocks[1].t === 'scene' && blocks[0].x.length < 90) title = blocks.shift().x;
      ep = newEpisode(P(), season, title, blocks); ep.sceneMeta = fin.sceneMeta;
    }
    closeModal(); openEpisode(ep.id);
    const st = S.st;
    modal('<h2>Сценарий загружен</h2><p>' + esc(source) + ': ' + st.scenes.length + ' сцен, ' + st.pages.toFixed(1) + ' стр. в формате Final Draft (' + C.fmtTime(st.minutes) + ').</p>' +
      '<div class="form-grid"><div><div class="h">Новые персонажи · ' + rep.newChars.length + '</div><p class="small">' + (rep.newChars.map(esc).join(', ') || '—') + '</p></div>' +
      '<div><div class="h">Унифицировано написание</div><p class="small">' + (rep.unified.map(esc).join('<br>') || '—') + '</p></div></div>' +
      (rep.castScenes ? '<p class="small">Списки действующих лиц под заголовками (' + rep.castScenes + ' сцен) убраны из текста: персонажи без реплик записаны в карточки сцен и учитываются в составе.</p>' : '') +
      (rep.guessed.length ? '<div class="rule warn"><div class="top"><span class="dot"></span><span class="title">Заголовки без ИНТ./НАТ./ПАВ. — поставлено ИНТ., проверьте</span></div><ul>' + rep.guessed.map((g) => '<li>' + esc(g) + '</li>').join('') + '</ul></div>' : '') +
      (rep.untyped.length ? '<div class="rule fail"><div class="top"><span class="dot"></span><span class="title">Заголовки не распознаны</span></div><ul>' + rep.untyped.map((g) => '<li>' + esc(g) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="h">Объекты · отметьте павильоны</div><div class="tbl-wrap"><table class="t"><thead><tr><th>Объект</th><th class="n">Стр.</th><th class="n">Доля</th><th>Павильон</th></tr></thead><tbody>' +
      st.objects.map((o) => '<tr><td>' + esc(o.name) + '</td><td class="n">' + C.fmtPages(o.pages) + '</td><td class="n">' + (o.share * 100).toFixed(1) + '%</td><td><input type="checkbox" data-ipav="' + esc(o.name) + '"' + ((P().locs[o.name] || {}).pav ? ' checked' : '') + '></td></tr>').join('') +
      '</tbody></table></div><div class="actions"><button class="btn primary" id="impDone">Готово</button></div>', (m) => {
      $$('[data-ipav]', m).forEach((c) => c.onchange = () => { (P().locs[c.dataset.ipav] = P().locs[c.dataset.ipav] || {}).pav = c.checked; });
      $('#impDone', m).onclick = () => { closeModal(); P().episodes.forEach((e) => delete e._st); recompute(); renderEpisodes(); };
    });
  }

  // ---------- project file ----------
  function openProjectFile(f) {
    f.text().then((t) => {
      const data = JSON.parse(t);
      const proj = data.project || data;
      if (!proj.episodes) throw new Error('Это не файл проекта Драфта.');
      const ex = S.db.projects.find((p) => p.id === proj.id);
      if (ex) {
        // merge: keep local text, add comments and drafts that are new
        let added = 0;
        for (const e2 of proj.episodes) {
          const e1 = ex.episodes.find((e) => e.id === e2.id);
          if (!e1) { ex.episodes.push(e2); added++; continue; }
          for (const c of e2.comments || []) {
            const c1 = e1.comments.find((x) => x.id === c.id);
            if (!c1) { e1.comments.push(c); added++; }
            else { for (const r of c.replies || []) if (!c1.replies.some((x) => x.date === r.date && x.text === r.text)) { c1.replies.push(r); added++; } c1.resolved = c1.resolved || c.resolved; }
          }
          for (const d of e2.drafts || []) if (!e1.drafts.some((x) => x.id === d.id)) { e1.drafts.push(d); added++; }
          if ((e2.updated || 0) > (e1.updated || 0)) { e1.blocks = e2.blocks; e1.sceneMeta = e2.sceneMeta; e1.updated = e2.updated; }
        }
        Object.assign(ex.chars, Object.assign({}, proj.chars, ex.chars)); Object.assign(ex.locs, Object.assign({}, proj.locs, ex.locs));
        toast('Проект обновлён: добавлено ' + added + ' комментариев, ответов и драфтов');
        openProject(ex.id);
      } else { S.db.projects.push(proj); S.db.currentEpId = null; openProject(proj.id); toast('Проект «' + proj.name + '» открыт'); }
      persist();
    }).catch((err) => toast('Не удалось открыть файл: ' + err.message));
  }

  // ---------- export ----------
  $('#btnExport').onclick = (e) => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; };
  document.addEventListener('click', () => { $('#exportMenu').hidden = true; });
  const fileBase = () => (P().name + ' С' + S.ep.season + 'Е' + String(S.ep.number).padStart(2, '0') + (S.ep.title ? ' ' + S.ep.title : '')).replace(/[\\/:*?"<>|«»]/g, '').trim();
  $$('[data-exp]').forEach((b) => b.onclick = async () => {
    $('#exportMenu').hidden = true; recompute();
    const k = b.dataset.exp;
    try {
      if (k === 'fdx') modal('<h2>Экспорт в Final Draft</h2><label class="row"><input type="checkbox" id="fxNum" checked> Номера сцен в виде «серия-сцена» (' + S.ep.number + '-1, ' + S.ep.number + '-2…) для FilmToolz</label><p class="note">FilmToolz принимает файлы Final Draft напрямую: объекты, персонажи и хронометраж сцен приходят из структуры файла.</p><div class="actions"><button class="btn" id="fxC">Отмена</button><button class="btn primary" id="fxOk">Сохранить .fdx</button></div>', (m) => {
        $('#fxC', m).onclick = closeModal;
        $('#fxOk', m).onclick = () => { const x = C.exportFDX(S.ep, P(), S.st, { episodePrefix: $('#fxNum', m).checked }); closeModal(); saveFile(fileBase() + '.fdx', x, 'application/xml'); };
      });
      if (k === 'fountain') saveFile(fileBase() + '.txt', C.exportFountain(S.ep, P()), 'text/plain');
      if (k === 'project') saveFile(P().name.replace(/[\\/:*?"<>|«»]/g, '') + '.json', JSON.stringify({ app: 'draft', version: 1, project: stripCache(P()) }, null, 1), 'application/json');
      if (k === 'openproject') { $('#fileInput').dataset.mode = 'project'; $('#fileInput').click(); }
      if (k === 'docx') {
        await loadLib('jszip');
        const z = new window.JSZip();
        Object.entries(C.DOCX_STATIC).forEach(([n, v]) => z.file(n, v));
        z.file('word/document.xml', C.docxDocumentXML(S.ep, P(), S.st));
        saveFile(fileBase() + '.docx', await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      }
      if (k === 'pdf') pdfDialog();
      if (k === 'bible') saveFile(P().name + ' — библия персонажей.html', bibleHTML(), 'text/html');
    } catch (err) { toast('Экспорт не удался: ' + err.message); }
  });
  const stripCache = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === '_st' ? undefined : v)));
  // every PDF is a named copy: the recipient is printed diagonally on each page and in the footer next to the trade-secret notice
  function pdfDialog() {
    const sec = P().secret || {};
    const drafts = S.ep.drafts || [];
    const label = drafts.length ? drafts[drafts.length - 1].name : 'Рабочий драфт';
    modal('<h2>PDF в формате Final Draft</h2><div class="form-grid"><label>Для кого (имя или почта)<input type="text" id="pdfTo" value="' + esc(S.me.name) + '"></label><label>Название драфта на титуле<input type="text" id="pdfLabel" value="' + esc(label) + '"></label></div>' +
      '<label class="row"><input type="checkbox" id="pdfWm" checked' + (S.me.role === 'reader' ? ' disabled' : '') + '> Водяной знак с именем получателя на каждой странице</label>' +
      (sec.org ? '<p class="note">Гриф: «Коммерческая тайна. ' + esc(sec.org) + (sec.addr ? ', ' + esc(sec.addr) : '') + '».</p>' : '<p class="note">Гриф коммерческой тайны не задан: заполните обладателя в «Настройках», иначе колонтитул будет без него.</p>') +
      '<div class="actions"><button class="btn" id="pdfC">Отмена</button><button class="btn primary" id="pdfOk">Сохранить PDF</button></div>', (m) => {
      $('#pdfC', m).onclick = closeModal;
      $('#pdfOk', m).onclick = () => { const o = { to: $('#pdfTo', m).value.trim() || S.me.name, label: $('#pdfLabel', m).value.trim(), wm: $('#pdfWm', m).checked }; closeModal(); exportPDF(o).catch((err) => toast('Экспорт не удался: ' + err.message)); };
    });
  }
  async function exportPDF(opts) {
    opts = opts || { to: S.me.name, label: '', wm: true };
    toast('Готовлю PDF…');
    const lib = await loadLib('jspdf');
    const paper = C.paperOf(P().rules);
    const F = paper.fmt;
    const W = paper.w * 72, H = paper.h * 72;
    const doc = new lib.jsPDF({ unit: 'pt', format: [W, H] });
    doc.addFileToVFS('FreeMono.ttf', window.FONT_FREEMONO); doc.addFont('FreeMono.ttf', 'FreeMono', 'normal');
    doc.addFileToVFS('FreeMonoBold.ttf', window.FONT_FREEMONOBOLD); doc.addFont('FreeMonoBold.ttf', 'FreeMono', 'bold');
    doc.setFont('FreeMono', 'normal'); doc.setFontSize(12);
    const today = new Date().toLocaleDateString('ru-RU');
    const sec = P().secret || {};
    const stamp = () => {
      // footer: trade-secret notice (98-ФЗ: owner and address) and the recipient of this copy
      doc.setFontSize(8);
      const foot = (sec.org ? 'КОММЕРЧЕСКАЯ ТАЙНА. Обладатель: ' + sec.org + (sec.addr ? ', ' + sec.addr : '') + '. ' : '') + 'Экземпляр: ' + opts.to + ' · ' + today;
      doc.text(doc.splitTextToSize(foot, W - 2 * 54), W / 2, H - 0.45 * 72, { align: 'center' });
      doc.setFontSize(12);
      if (!opts.wm) return;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.11 }));
      doc.setFontSize(30);
      const txt = opts.to + ' · ' + today;
      doc.text(txt, W / 2, H / 2, { align: 'center', angle: 38 });
      doc.text(txt, W / 2, H * 0.82, { align: 'center', angle: 38 });
      doc.text(txt, W / 2, H * 0.18, { align: 'center', angle: 38 });
      doc.restoreGraphicsState();
      doc.setFontSize(12);
    };
    // title page: title and author centred, contacts bottom left, draft label and date bottom right (industry layout)
    doc.setFont('FreeMono', 'bold');
    doc.text(C.up(P().name), W / 2, 4 * 72, { align: 'center' });
    doc.setFont('FreeMono', 'normal');
    doc.text('Серия ' + S.ep.number + (S.ep.title ? '. «' + S.ep.title + '»' : ''), W / 2, 4 * 72 + 24, { align: 'center' });
    if (P().author) doc.text(P().author, W / 2, 4 * 72 + 60, { align: 'center' });
    const bottom = (paper.h - paper.bottom) * 72;
    if (P().contact) doc.splitTextToSize(P().contact, 3.2 * 72).forEach((t, i) => doc.text(t, paper.left * 72, bottom - 36 + i * 12));
    doc.text(opts.label || 'Рабочий драфт', W - paper.right * 72, bottom - 36, { align: 'right' });
    doc.text(today, W - paper.right * 72, bottom - 24, { align: 'right' });
    if (S.ep.lock) doc.text('Номера сцен залочены ' + new Date(S.ep.lock.at).toLocaleDateString('ru-RU'), W - paper.right * 72, bottom - 12, { align: 'right' });
    stamp();
    const lay = S.st.lay;
    const sceneN = {}; S.st.scenes.forEach((s) => { sceneN[s.from] = s.num; });
    lay.pages.forEach((pg, k) => {
      doc.addPage([W, H]);
      if (k > 0) doc.text((k + 1) + '.', (paper.w - paper.right) * 72, 0.5 * 72 + 9, { align: 'right' });
      let line = 0;
      const base = paper.top * 72 + 9.6;
      for (const it of pg.items) {
        line += it.sb;
        const f = F[it.t] || F.action;
        it.lines.forEach((tx, j) => {
          const y = base + (line + j) * 12;
          if (f.right) doc.text(tx, (f.indent + f.width / 10) * 72, y, { align: 'right' });
          else doc.text(tx, f.indent * 72, y);
          if (j === 0 && it.t === 'scene' && sceneN[it.i] && !it.contd) { doc.text(String(sceneN[it.i]), (paper.left - 0.75) * 72, y); doc.text(String(sceneN[it.i]), (paper.w - paper.right + 0.3) * 72, y, { align: 'right' }); }
        });
        line += it.lines.length;
        if (it.more) { doc.text('(ДАЛЬШЕ)', F.character.indent * 72, base + line * 12); line++; }
      }
      stamp();
    });
    const blob = doc.output('blob');
    await saveFile(fileBase() + (opts.to && opts.to !== S.me.name ? ' — ' + opts.to.replace(/[\\/:*?"<>|«»@]/g, '_') : '') + '.pdf', blob, 'application/pdf');
  }
  function bibleHTML() {
    const ps = projectCharStats();
    const rows = Object.keys(P().chars).sort((a, b) => ((ps[b] || {}).min || 0) - ((ps[a] || {}).min || 0)).map((n) => {
      const c = P().chars[n], s = ps[n];
      const rel = (P().relations || []).filter((r) => r.a === n || r.b === n).map((r) => esc(r.a === n ? r.b : r.a) + ' — ' + esc(r.label)).join('; ');
      return '<section><h2>' + esc(n) + (c.age ? ', ' + esc(c.age) : '') + '</h2>' + (c.desc ? '<p>' + esc(c.desc) + '</p>' : '') + (c.bio ? '<p>' + esc(c.bio).replace(/\n/g, '<br>') + '</p>' : '') +
        (s ? '<p class="m">Серии: ' + [...s.episodes].join(', ') + ' · сцен ' + s.scenes + ' · в кадре ' + C.fmtTime(s.min) + ' · реплик ' + s.replicas + '</p>' : '') + (rel ? '<p class="m">Связи: ' + rel + '</p>' : '') + '</section>';
    }).join('');
    return '<!doctype html><meta charset="utf-8"><title>' + esc(P().name) + ' — персонажи</title><style>body{font:15px/1.5 Georgia,serif;max-width:720px;margin:40px auto;padding:0 16px}h1{font-size:26px}h2{font:700 16px "Courier New",monospace;margin:28px 0 4px}.m{color:#666;font-size:13px}</style><h1>' + esc(P().name) + ': библия персонажей</h1>' + rows;
  }

  // ---------- season summary ----------
  $('#btnSeason').onclick = () => {
    recompute();
    const eps = P().episodes.filter((e) => e.season === S.ep.season);
    const rows = eps.map((e) => { const st = e === S.ep ? S.st : C.analyzeEpisode(e, P()); const rr = C.evalRules(e, P(), st); return { e, st, fails: rr.filter((x) => x.status === 'fail').length }; });
    const objs = {};
    rows.forEach(({ e, st }) => st.objects.forEach((o) => { const x = objs[o.name] || (objs[o.name] = { name: o.name, pages: 0, eps: [], pav: o.pav }); x.pages += o.pages; x.eps.push(e.number); }));
    const totalPages = rows.reduce((a, r) => a + r.st.pages, 0) || 1;
    modal('<h2>Сезон ' + S.ep.season + ': сводка</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>Серия</th><th class="n">Стр.</th><th class="n">Время</th><th class="n">Сцен</th><th class="n">Павильон</th><th class="n">Основной</th><th class="n">Ночь</th><th class="n">Объектов</th><th class="n">Нарушений</th></tr></thead><tbody>' +
      rows.map(({ e, st, fails }) => '<tr><td>' + e.number + (e.title ? '. ' + esc(e.title) : '') + (st.lines && st.lines.length ? '<div class="small muted">' + st.lines.map((l) => esc(l.name) + ' ' + (l.share * 100).toFixed(0) + '%').join(' · ') + '</div>' : '') + '</td><td class="n">' + st.pages.toFixed(1) + '</td><td class="n">' + C.fmtTime(st.minutes) + '</td><td class="n">' + st.scenes.length + '</td><td class="n">' + Math.round(st.pavPct) + '%</td><td class="n">' + (st.main ? Math.round(st.main.share * 100) + '%' : '—') + '</td><td class="n">' + (st.nightMin / (st.minutes || 1) * 100).toFixed(0) + '%</td><td class="n">' + st.objects.length + '</td><td class="n">' + (fails ? '<span class="chip bad">' + fails + '</span>' : '<span class="chip ok">0</span>') + '</td></tr>').join('') +
      '</tbody></table></div><div class="h">Объекты сезона</div><div class="tbl-wrap"><table class="t"><thead><tr><th>Объект</th><th class="n">Стр. за сезон</th><th class="n">Доля</th><th>Серии</th></tr></thead><tbody>' +
      Object.values(objs).sort((a, b) => b.pages - a.pages).map((o) => '<tr><td>' + esc(o.name) + (o.pav ? ' <span class="chip pav">пав.</span>' : '') + (o.pages < P().rules.newObjectMinPages && !(P().locs[o.name] || {}).base ? ' <span class="chip warn">меньше ' + P().rules.newObjectMinPages + ' стр.</span>' : '') + '</td><td class="n">' + C.fmtPages(o.pages) + '</td><td class="n">' + (o.pages / totalPages * 100).toFixed(1) + '%</td><td>' + o.eps.join(', ') + '</td></tr>').join('') +
      '</tbody></table></div><div class="actions"><button class="btn" id="ssCsv">Скачать CSV</button><button class="btn primary" id="ssClose">Закрыть</button></div>', (m) => {
      $('#ssClose', m).onclick = closeModal;
      $('#ssCsv', m).onclick = () => {
        const lines = ['Серия;Сцена;Линия;Заголовок;Тип;Объект;Подобъект;Время суток;Сценарный день;Павильон;Стр (1/8);Хронометраж;Персонажи;Метки'];
        rows.forEach(({ e, st }) => st.scenes.forEach((s) => lines.push([e.number, s.num, s.line, s.heading, s.h.prefix, s.h.object, s.h.sub, s.h.time, s.day, s.pav ? 'да' : '', C.fmtPages(s.pages), C.fmtTime(s.min), s.cast.join(', '), s.tags.map((t) => C.TAGS[t]).join(', ')].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(';'))));
        saveFile(P().name + ' сезон ' + S.ep.season + ' — сцены.csv', '﻿' + lines.join('\n'), 'text/csv');
      };
    });
  };

  // ---------- settings ----------
  $('#btnSettings').onclick = () => {
    const r = P().rules;
    const num = (k, label, step) => '<label>' + label + '<input type="number" step="' + (step || 1) + '" data-r="' + k + '" value="' + r[k] + '"></label>';
    const sec = P().secret || {};
    modal('<h2>Настройки</h2><div class="h">Вы</div><div class="form-grid"><label>Имя в комментариях<input type="text" id="meName" value="' + esc(S.me.name) + '"></label><label>Роль<select id="meRole"><option value="writer">Сценарист</option><option value="editor">Редактор</option><option value="producer">Продюсер (комментарии, лок, удаление)</option><option value="reader">Читатель (только чтение, PDF со знаком)</option></select></label><label>Тема<select id="meTheme"><option value="">Как в системе</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>' +
      '<label>Шрифт на экране<select id="meFont"><option value="courier">Courier New (как Final Draft)</option><option value="liberation">Liberation Mono (метрики Courier New, кириллица)</option><option value="ptmono">PT Mono (веб-шрифт)</option><option value="freemono">FreeMono (встроенный)</option></select></label><label class="row"><input type="checkbox" id="meWm"> Водяной знак на экране (имя и дата)</label></div>' +
      '<div class="h">Проект</div><div class="form-grid"><label>Название<input type="text" id="prName" value="' + esc(P().name) + '"></label><label>Автор (титульный лист)<input type="text" id="prAuthor" value="' + esc(P().author || '') + '"></label><label>Контакты (титульный лист, слева внизу)<input type="text" id="prContact" value="' + esc(P().contact || '') + '" placeholder="продюсер, телефон, почта"></label><label>Формат листа<select data-r="paper"><option value="letter">Letter, как Final Draft (54 строки)</option><option value="a4">A4, отступы Final Draft (58 строк)</option><option value="a4ru">A4 «американка» (русский стандарт, 58 строк)</option></select></label>' + num('minPerPage', 'Минут на страницу', 0.05) + '</div>' +
      '<div class="h">Гриф коммерческой тайны (98-ФЗ, ст. 10)</div><div class="form-grid"><label>Обладатель информации<input type="text" id="secOrg" value="' + esc(sec.org || '') + '" placeholder="ООО «Студия»"></label><label>Место нахождения<input type="text" id="secAddr" value="' + esc(sec.addr || '') + '" placeholder="г. Москва, ул. …"></label></div><p class="note">Гриф печатается в нижнем колонтитуле каждой страницы PDF вместе с именем получателя. Без режима коммерческой тайны у владельца сценария привлечь к ответственности за утечку практически невозможно.</p>' +
      '<div class="h">Линии (сюжетные линии или съёмочные группы)</div><div id="lineEditor"></div><div class="row"><button class="btn small" id="addLine">+ Линия</button><button class="btn small ghost" id="lineExample">Пример: «Служанка»</button></div>' +
      '<div class="form-grid"><label>Спецкатегория (шаг 0)<input type="text" id="lrSpecialName" value="' + esc(((P().lineRules || {}).special || {}).name || '') + '" placeholder="ИИ"></label><label>Её слова в заголовке<input type="text" id="lrSpecialKw" value="' + esc(C.listOf(((P().lineRules || {}).special || {}).keywords).join(', ')) + '" placeholder="ЗАЯВОЧНЫЙ ПЛАН, ФЛЭШФОРВАРД"></label><label>Приоритет при пересечении<select id="lrPriority"></select></label>' + num('lineTolerance', 'Допуск по линиям, п.п.') + '</div>' +
      '<div class="h">Производственные параметры</div><div class="form-grid">' + num('maxPages', 'Макс. страниц в серии') + num('scenesPerPage', 'Сцен на страницу, не больше', 0.1) + num('shortSceneSec', 'Короткая сцена, сек') + num('maxShortScenes', 'Допустимо коротких сцен') +
      num('mainShareMin', 'Основной павильон, % материала') + num('mainShiftShareMin', 'Основной павильон, % смен') + num('baseObjectsMax', 'Ориентир числа объектов') + num('newObjectMinPages', 'Новый объект, мин. страниц') +
      num('nightMaxPct', 'Ночь вне павильона, макс. %') + num('bigCast', 'Многолюдная сцена, артистов больше') + num('bigCastMaxScenes', 'Многолюдных сцен, не больше') + num('ensembleMinSec', 'Сбор ансамбля, мин. сек') + num('specialMaxPct', 'Дети/животные/трюки, макс. %') +
      num('ratePav', 'Выработка павильон, мин/смена', 0.5) + num('rateInt', 'Выработка интерьер, мин/смена', 0.5) + num('rateExt', 'Выработка натура, мин/смена', 0.5) + num('specialFactor', 'Замедление на сложных сценах, раз', 0.1) + '</div>' +
      '<div class="actions"><button class="btn" id="stReset">Вернуть шаблон студии</button><button class="btn" id="stC">Отмена</button><button class="btn primary" id="stOk">Сохранить</button></div>', (m) => {
      $('#meRole', m).value = S.me.role; $('[data-r=paper]', m).value = r.paper; $('#meTheme', m).value = ls.get('draft.theme', '');
      $('#meFont', m).value = ls.get('draft.font', 'courier'); $('#meWm', m).checked = !!ls.get('draft.wm', false);
      renderLineEditor(m, P().lines || [], (P().lineRules || {}).priority);
      $('#addLine', m).onclick = () => renderLineEditor(m, readLineEditor(m).concat([{ name: '', target: null }]), $('#lrPriority', m).value);
      $('#lineExample', m).onclick = () => {
        renderLineEditor(m, SLUZHANKA.lines, SLUZHANKA.rules.priority);
        $('#lrSpecialName', m).value = SLUZHANKA.rules.special.name; $('#lrSpecialKw', m).value = SLUZHANKA.rules.special.keywords.join(', ');
      };
      $('#stC', m).onclick = closeModal;
      $('#stReset', m).onclick = () => { Object.entries(C.DEFAULT_RULES).forEach(([k, v]) => { const i = $('[data-r="' + k + '"]', m); if (i) i.value = v; }); };
      $('#stOk', m).onclick = () => {
        S.me = { name: $('#meName', m).value.trim() || 'Без имени', role: $('#meRole', m).value }; ls.set('draft.me', S.me);
        const th = $('#meTheme', m).value; ls.set('draft.theme', th); applyTheme();
        ls.set('draft.font', $('#meFont', m).value); applyFont(); ls.set('draft.wm', $('#meWm', m).checked);
        P().name = $('#prName', m).value.trim() || P().name; P().author = $('#prAuthor', m).value.trim(); P().contact = $('#prContact', m).value.trim();
        P().secret = { org: $('#secOrg', m).value.trim(), addr: $('#secAddr', m).value.trim() };
        P().lines = readLineEditor(m);
        P().lineRules = { special: { name: $('#lrSpecialName', m).value.trim(), keywords: C.listOf($('#lrSpecialKw', m).value) }, priority: $('#lrPriority', m).value };
        $$('[data-r]', m).forEach((i) => { P().rules[i.dataset.r] = i.type === 'number' ? parseFloat(i.value) : i.value; });
        P().episodes.forEach((e) => delete e._st);
        closeModal(); applyRole(); applyPaper(); renderProjectSelect(); recompute(); renderEpisodes(); fitPage();
      };
    });
  };
  // the rules Dima described for «Служанка» (two shooting units)
  const SLUZHANKA = {
    lines: [
      { name: 'Линия 1 (дом Николая)', target: 50, objects: 'ДОМ НИКОЛАЯ, ДОМ НИКЛОАЯ, ДОМ ГРАФА, ГОСПИТАЛЬ, ПОЛЕ БОЯ', owners: 'НИКОЛАЯ, КНЯГИНИ, МУРАТОВА, АПОЛЛИНАРИИ', chars: 'НИКОЛАЙ, АННА, МУРАТОВ, КНЯГИНЯ, АПОЛЛИНАРИЯ, МУРАВИНСКИЙ, СИМКА, ПОТАП, АКСИНЬЯ' },
      { name: 'Линия 2 (Аверины и Спицыны)', target: 50, objects: 'ДОМ АВЕРИН, ДОМ АВРЕИН, ДОМ СПИЦЫН, КОНЮШНЯ, СЕНОВАЛ, МАГАЗИН, МУЖСКОЙ КЛУБ, ДВОРЯНСКОЕ СОБРАНИЕ', owners: 'АВЕРИНЫХ, СПИЦЫНЫХ, НИФОНТОВА, СМИРНОВА, РОМЫ, ЮЛИ, ЕКАТЕРИНЫ, ЕЛЕНЫ, ОЛИ', chars: 'АВЕРИН, ЕЛЕНА, РОМА, СПИЦЫН, ЕКАТЕРИНА, ЮЛЯ, НИФОНТОВ, ОЛЯ, ПРОХОР, СМИРНОВ, СОФЬЯ' },
    ],
    rules: { special: { name: 'ИИ', keywords: ['ЗАЯВОЧНЫЙ ПЛАН', 'ФЛЭШФОРВАРД', 'ФЛЕШФОРВАРД'] }, priority: 'Линия 1 (дом Николая)' },
  };
  function renderLineEditor(m, lines, priority) {
    const box = $('#lineEditor', m);
    box.innerHTML = lines.map((l, i) => '<div class="inspector" data-line="' + i + '" style="margin-bottom:8px"><div class="form-grid"><label>Название<input type="text" data-lf="name" value="' + esc(l.name) + '"></label><label>Целевая доля, %<input type="number" data-lf="target" value="' + (l.target == null ? '' : l.target) + '"></label></div>' +
      '<label class="small muted">Шаг 1 · однозначные объекты: подстроки заголовка через запятую, без окончаний, с опечатками автора<input type="text" data-lf="objects" value="' + esc(C.listOf(l.objects).join(', ')) + '" placeholder="ДОМ НИКОЛАЯ, ГОСПИТАЛЬ"></label>' +
      '<label class="small muted">Шаг 2 · владельцы спорных объектов: целые слова заголовка (КАРЕТА НИКОЛАЯ → «НИКОЛАЯ»)<input type="text" data-lf="owners" value="' + esc(C.listOf(l.owners).join(', ')) + '" placeholder="НИКОЛАЯ, КНЯГИНИ"></label>' +
      '<label class="small muted">Шаг 3 · основные персонажи линии (эпизодических не вносить)<input type="text" data-lf="chars" value="' + esc(C.listOf(l.chars).join(', ')) + '" placeholder="НИКОЛАЙ, АННА"></label>' +
      '<div class="row"><button class="btn small ghost danger" data-delline="' + i + '">Убрать линию</button></div></div>').join('') || '<p class="note">Линий нет. Добавьте, если проект снимается несколькими группами или нужно следить за балансом сюжетных линий.</p>';
    $$('[data-delline]', box).forEach((b) => b.onclick = () => { const ls2 = readLineEditor(m); ls2.splice(+b.dataset.delline, 1); renderLineEditor(m, ls2, $('#lrPriority', m).value); });
    const pr = $('#lrPriority', m);
    pr.innerHTML = '<option value="">— первая по списку —</option>' + lines.filter((l) => l.name).map((l) => '<option value="' + esc(l.name) + '"' + (l.name === priority ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
  }
  function readLineEditor(m) {
    return $$('[data-line]', m).map((d, i) => {
      const g = (f) => $('[data-lf=' + f + ']', d).value;
      const old = (P().lines || [])[i];
      return { name: g('name').trim(), target: g('target') === '' ? null : parseFloat(g('target')), objects: C.listOf(g('objects')), owners: C.listOf(g('owners')), chars: C.listOf(g('chars')), color: old && old.color ? old.color : C.LINE_COLORS[i % C.LINE_COLORS.length] };
    }).filter((l) => l.name);
  }
  function applyRole() {
    const ro = !canEdit();
    ed.setAttribute('contenteditable', ro ? 'false' : 'true');
    $('#elemSelect').disabled = ro;
    const reader = S.me.role === 'reader';
    $('#btnImport').hidden = reader; $('#btnDraft').hidden = reader; $('#btnHistory').hidden = reader;
    $$('[data-exp]').forEach((b) => { b.hidden = reader && b.dataset.exp !== 'pdf'; });
    applyWatermark();
  }
  function applyTheme() { const th = ls.get('draft.theme', ''); if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme; }
  // the sheet follows the page template: paper size, margins and element indents come from Core.PAPER
  function applyPaper() {
    const paper = C.paperOf(P().rules);
    const F = paper.fmt;
    const st = document.documentElement.style;
    st.setProperty('--pg-w', paper.w + 'in'); st.setProperty('--pg-h', paper.h + 'in');
    st.setProperty('--pg-top', paper.top + 'in'); st.setProperty('--pg-bottom', paper.bottom + 'in');
    st.setProperty('--pg-left', paper.left + 'in'); st.setProperty('--pg-right', paper.right + 'in');
    st.setProperty('--tx-w', (paper.w - paper.left - paper.right) + 'in');
    for (const [t, k] of [['character', 'char'], ['paren', 'paren'], ['dialogue', 'dial'], ['transition', 'tr']]) {
      st.setProperty('--in-' + k, (F[t].indent - paper.left) + 'in');
      st.setProperty('--w-' + k, (F[t].width / 10) + 'in');
    }
  }
  const FONTS = { courier: '"Courier New", Courier, "Liberation Mono", "FreeMonoEmb", monospace', liberation: '"Liberation Mono", "Courier New", "FreeMonoEmb", monospace', ptmono: '"PT Mono", "Courier New", "FreeMonoEmb", monospace', freemono: '"FreeMonoEmb", "FreeMono", "Courier New", monospace' };
  function applyFont() {
    const f = ls.get('draft.font', 'courier');
    if (f === 'ptmono' && !$('#ptmonoLink')) { const l = document.createElement('link'); l.id = 'ptmonoLink'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=PT+Mono&display=swap'; document.head.appendChild(l); }
    document.documentElement.style.setProperty('--script', FONTS[f] || FONTS.courier);
  }
  // on-screen watermark: name and date over the sheet, so a screenshot names its owner (readers always, others by choice)
  function applyWatermark() {
    const on = S.me.role === 'reader' || !!ls.get('draft.wm', false);
    const pg = $('#page');
    if (on) pg.dataset.wm = S.me.name + ' · ' + new Date().toLocaleDateString('ru-RU'); else delete pg.dataset.wm;
  }
  $('#elemSelect').onchange = (e) => { const el = ed.querySelector('.b.cur') || curBlockEl(); if (el) { setType(el, e.target.value); setCaret(el.dataset.id, el.textContent.length); } };
  $('#btnFocus').onclick = () => document.body.classList.toggle('focus');

  // narrow screens: a button to open the production panel
  const panelBtn = document.createElement('button'); panelBtn.className = 'btn ghost'; panelBtn.id = 'btnPanel'; panelBtn.textContent = 'Панель';
  panelBtn.onclick = () => document.body.classList.toggle('show-right');
  $('.tb-group').appendChild(panelBtn);

  // ---------- boot ----------
  async function boot() {
    applyTheme();
    let db = await DB.get('db');
    if (!db || !db.projects || !db.projects.length) {
      const p = C.demoProject();
      db = { projects: [p], currentProjectId: p.id, currentEpId: p.episodes[0].id };
    }
    S.db = db;
    await trashLoad();
    applyFont();
    openProject(db.currentProjectId);
    renderRight();
    fitPage();
  }
  // the sheet keeps its real 8.5in geometry and is scaled to fit narrow windows
  S.zoom = 1;
  const pagePx = () => Math.round(C.paperOf(P().rules).w * 96);
  function fitPage() {
    const w = $('#desk').clientWidth - 24;
    const z = Math.max(0.4, Math.min(1, w / pagePx()));
    S.zoom = z;
    $('#page').style.transform = z === 1 ? '' : 'scale(' + z + ')';
    sizePage();
    renderComments();
  }
  function sizePage() {
    const z = S.zoom || 1;
    $('#pageWrap').style.width = (pagePx() * z) + 'px';
    $('#pageWrap').style.height = z === 1 ? '' : ($('#page').offsetHeight * z) + 'px';
  }
  window.addEventListener('resize', debounce(fitPage, 150));
  $('#btnFocus').addEventListener('click', () => setTimeout(fitPage, 50));
  boot();
  window.__draft = { S, C, recompute, readBlocks, histAdd, histLoad, showHistory, showTrash, autoSnap, lockNumbers, omitScene, restoreScene, restoreMissing, exportPDF, applyRole, applyPaper, renderScenes };
})();
