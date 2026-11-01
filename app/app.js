/* Драфт: interface. Editor, panels, import/export. */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
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
    // the project, its trash and its snapshots are shared by every tab: a write goes through only if no other tab
    // wrote since this one loaded (the 'rev' record, checked in the same transaction), otherwise the tab turns stale
    async put(k, v) {
      // the per-episode analysis cache (_st) is derived data: never stored, so a stale one cannot survive a reload
      if (k === 'db') v = JSON.parse(JSON.stringify(v, (kk, x) => (kk === '_st' ? undefined : x)));
      const db = await this.dbp; if (!db) return false;
      const shared = k === 'db' || k === 'trash' || String(k).startsWith('hist:');
      if (shared && TAB.stale) return false;
      const t0 = Date.now();
      return new Promise((res) => {
        let lost = false, n = 0;
        try {
          const tx = db.transaction('kv', 'readwrite'), os = tx.objectStore('kv');
          tx.oncomplete = () => { res(true); if (!shared) return; TAB.last = Math.max(TAB.last, n); if (k === 'db') TAB.savedAt = t0; TAB.told(n); };
          tx.onerror = () => res(false);
          // a commit that fails on quota aborts the transaction without an error event
          tx.onabort = () => { res(false); if (lost) TAB.conflict(); };
          if (!shared) { os.put(v, k); return; }
          const q = os.get('rev');
          q.onsuccess = () => {
            const r = q.result || { n: 0 };
            if (r.tab !== TAB.id && (r.n || 0) !== TAB.rev) { lost = true; tx.abort(); return; }
            n = (r.n || 0) + 1;
            try { os.put(v, k); os.put({ n, tab: TAB.id, at: Date.now() }, 'rev'); } catch (e) { try { tx.abort(); } catch (e2) { /* already over */ } }
          };
        } catch (e) { res(false); }
      });
    },
    async del(k) {
      const db = await this.dbp; if (!db) return false;
      return new Promise((res) => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false); } catch (e) { res(false); } });
    },
  };
  DB.dbp = DB.open();
  // Two tabs on one computer: the tab that wrote last owns the data. The other one learns it from the channel or from a
  // refused write, keeps its unsaved text aside (see rescueTab) and becomes read-only until reloaded.
  // rev: the record this tab loaded; last: the newest record it knows of (a late message from a closed tab is older)
  const TAB = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), rev: 0, last: 0, savedAt: 0, stale: false, ch: null };
  try { TAB.ch = new BroadcastChannel('draft-app'); TAB.ch.onmessage = (e) => { if (e.data && e.data.tab !== TAB.id && (e.data.n || 0) > TAB.last) TAB.conflict(); }; } catch (e) { /* the write check still guards */ }
  TAB.told = (n) => { try { if (TAB.ch) TAB.ch.postMessage({ tab: TAB.id, n }); } catch (e) { /* ignore */ } };
  TAB.conflict = async () => {
    if (TAB.stale || TAB.adopting || !S.db) return;
    // a tab with nothing unsaved simply takes the newer data: a second tab that was only opened or looked at, or the
    // tail write of this same page before a reload, must not lock anyone out
    TAB.adopting = true;
    try { if (await adoptNewer()) return; } catch (e) { /* fall back to read-only below */ } finally { TAB.adopting = false; }
    TAB.stale = true;
    rescueTab();
    if (S.ep) applyRole();
    banner('Драфт изменён в другой вкладке. Здесь теперь только чтение, чтобы не затереть те правки. Обновите страницу — несохранённый текст этой вкладки появится в драфтах серии.', true);
  };
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };

  const S = { db: null, project: null, ep: null, st: null, rulesRes: [], me: ls.get('draft.me', { name: 'Сценарист', role: 'writer' }), activeComment: null, curScene: null, ltab: 'episodes', rtab: ls.get('draft.rtab', 'stats'), graphScope: 'project', selChar: null };
  const persist = debounce(() => { if (S.db) DB.put('db', S.db).then(saved); }, 700);
  // a failed save is never silent: the bar stays until a later save goes through
  function saved(ok) { if (!TAB.stale) banner(ok ? '' : 'Не удалось сохранить в браузере (нет места или хранилище недоступно). Сохраните файл проекта: «Экспорт → Файл проекта».'); return ok; }
  function banner(msg, reload) {
    let b = document.getElementById('saveBar');
    if (!b) { b = document.createElement('div'); b.id = 'saveBar'; b.className = 'savebar'; b.setAttribute('role', 'alert'); document.body.appendChild(b); }
    b.hidden = !msg;
    b.innerHTML = esc(msg) + (reload ? ' <button class="btn small" type="button">Обновить</button>' : '');
    if (reload) b.querySelector('button').onclick = () => location.reload();
  }

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
    const ep = { id: C.uid(), season, number: same.length ? Math.max(...same.map((e) => e.number)) + 1 : 1, title: title || '', blocks: blocks || [{ id: C.uid(), t: 'scene', x: '' }], sceneMeta: {}, comments: [], drafts: [], checks: {}, updated: Date.now(), textAt: Date.now() };
    p.episodes.push(ep); sortEpisodes(p); return ep;
  }
  function openEpisode(id) {
    const ep = P().episodes.find((e) => e.id === id) || P().episodes[0];
    if (S.ep && S.ep !== ep && (S.ep.updated || 0) > (S.ep.histAt || 0)) histAdd(S.ep, 'при переключении серии');
    S.ep = ep; S.db.currentEpId = ep.id; S.undo = []; S.redo = []; S.activeComment = null; S.textSig = null;
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
    if (!el || !canEdit()) return;
    pushUndo();
    el.dataset.t = t; el.className = 'b t-' + t;
    if (t === 'paren' && !el.textContent.trim()) { el.textContent = '()'; setCaret(el.dataset.id, 1); }
    if (t !== 'paren' && el.textContent === '()') { el.innerHTML = '<br>'; setCaret(el.dataset.id, 0); }
    $('#elemSelect').value = t;
    scheduleRecompute(); acUpdate();
    if (typeof renderHint === 'function') renderHint();
  }
  function insertBlockAfter(el, t, x) {
    const id = C.uid();
    el.insertAdjacentHTML('afterend', blockHTML({ id, t, x }));
    return ed.querySelector('[data-id="' + id + '"]');
  }
  const NEXT = { scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'scene' };
  const EMPTY_ENTER = { action: 'scene', dialogue: 'action', character: 'action', paren: 'dialogue', scene: 'action', transition: 'scene' };
  // deletes the selection and joins its first and last elements, as a word processor does; the caret stays at the join
  function deleteSelection() {
    const sel = window.getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
    const blk = (n) => { while (n && n !== ed) { if (n.nodeType === 1 && n.classList.contains('b')) return n; n = n.parentNode; } return null; };
    const r = sel.getRangeAt(0), a = blk(r.startContainer), z = blk(r.endContainer);
    r.deleteContents();
    if (!a) return;
    if (z && z !== a) { const off = a.textContent.length; a.textContent += z.textContent; z.remove(); setCaret(a.dataset.id, off); }
    if (!a.textContent) { a.innerHTML = '<br>'; setCaret(a.dataset.id, 0); }
  }
  function onEnter() {
    const sel = window.getSelection(), wasSel = sel.rangeCount && !sel.isCollapsed;
    // Enter over a selection replaces it with a split at the join, so the tail takes the first element's type
    if (wasSel) { pushUndo(); deleteSelection(); }
    const el = curBlockEl(); if (!el) return;
    const t = el.dataset.t;
    const text = el.textContent;
    if (!wasSel && (!text.trim() || (t === 'paren' && text.trim() === '()'))) { el.textContent = ''; setType(el, EMPTY_ENTER[t]); return; }
    if (!wasSel) pushUndo();
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
  // revision bases never change once taken, so undo shares them instead of copying every base on each keystroke
  function snapshot() { return { blocks: readBlocks(), caret: getCaret(), sceneMeta: JSON.parse(JSON.stringify(S.ep.sceneMeta || {})), lock: S.ep.lock ? JSON.parse(JSON.stringify(S.ep.lock)) : null, revisions: S.ep.revisions ? S.ep.revisions.slice() : null, revLevel: S.ep.revLevel || 0, pageLock: S.ep.pageLock || null, tags: jcopy(S.ep.tags || []) }; }
  function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 200) S.undo.shift(); S.redo = []; lastEdit = Date.now(); }
  function restore(sn) { S.ep.blocks = sn.blocks; if (sn.sceneMeta) S.ep.sceneMeta = sn.sceneMeta; setLock(S.ep, sn); renderEditor(); if (sn.caret) setCaret(sn.caret.id, sn.caret.off); recompute(); }
  function undo() { if (!S.undo.length || S.me.role === 'reader') return; S.redo.push(snapshot()); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length || S.me.role === 'reader') return; S.undo.push(snapshot()); restore(S.redo.pop()); }

  ed.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); onEnter(); return; }
    if (Date.now() - lastEdit > 900 || /delete/.test(e.inputType) && !window.getSelection().isCollapsed) pushUndo();
    lastEdit = Date.now();
  });
  ed.addEventListener('input', (e) => {
    normalizeDom();
    const el = curBlockEl();
    // Chrome's own join of two elements wraps the moved text in style spans (caps, white-space): the element keeps plain text only
    if (el && !e.isComposing && el.querySelector('*:not(br)')) { const off = caretOffset(el), txt = el.textContent; if (txt) el.textContent = txt; else el.innerHTML = '<br>'; setCaret(el.dataset.id, off); }
    if (el && el.dataset.t === 'action' && /^(ИНТ|НАТ|ПАВ)[.\s]/i.test(el.textContent) && el.textContent.length < 8) { el.dataset.t = 'scene'; el.className = 'b t-scene'; $('#elemSelect').value = 'scene'; }
    scheduleRecompute(); acUpdate();
  });
  ed.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!$('#ac').hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acMove(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Escape') { e.preventDefault(); acHide(); return; }
      // on an empty element (or with Shift+Tab) Tab and Enter cycle element types, as in Final Draft, instead of inserting the first suggestion
      if ((e.key === 'Tab' || e.key === 'Enter') && (e.shiftKey || !(AC.el && AC.el.textContent.trim()))) acHide();
      else if (e.key === 'Tab' || e.key === 'Enter') {
        const acceptedEnter = e.key === 'Enter' && AC.ctx === 'character';
        if (acAccept()) { e.preventDefault(); if (acceptedEnter) onEnter(); return; }
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); acHide(); onEnter(); return; }
    if (e.key === 'Tab') { e.preventDefault(); onTab(e.shiftKey); return; }
    if (mod && !e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); setType(curBlockEl(), C.TYPES[+e.key - 1]); return; }
    // with Shift held e.key is 'Z'/'Я', and on a non-Latin layout other than Russian the physical key decides
    const kz = e.code === 'KeyZ' && !/^[a-z]$/i.test(e.key) || /^[zя]$/i.test(e.key), ky = e.code === 'KeyY' && !/^[a-z]$/i.test(e.key) || /^[yн]$/i.test(e.key);
    if (mod && kz && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (kz && e.shiftKey || ky)) { e.preventDefault(); redo(); return; }
    if (mod && e.altKey && (e.code === 'KeyM')) { e.preventDefault(); startComment(); return; }
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
    // the pasted elements replace the selection and go in at the caret: the element is split there, like typing would
    if (!window.getSelection().isCollapsed) deleteSelection();
    const el = curBlockEl(), html = blocks.map(blockHTML).join('');
    if (!el) ed.insertAdjacentHTML('beforeend', html);
    else {
      const full = el.textContent, off = caretOffset(el), before = full.slice(0, off), after = full.slice(off).replace(/^\s+/, '');
      if (!before.trim() && !after.trim()) { el.insertAdjacentHTML('afterend', html); el.remove(); }
      else if (!before.trim()) { el.insertAdjacentHTML('beforebegin', html); el.textContent = after; }
      else { el.textContent = before; el.insertAdjacentHTML('afterend', html + (after.trim() ? blockHTML({ id: C.uid(), t: el.dataset.t, x: after }) : '')); }
    }
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
      } else if (q && !/\(/.test(U)) {
        // a cue that already has an extension is finished: no name list, so Enter never rewrites «ИВАН (ЗК)»
        const dc = dictChars(), rest = C.up(text.slice(off)), keep = /^\s*\(/.test(rest) ? rest : '';
        const names = Object.keys(dc).filter((n) => startsWord(n, q) && n !== q).sort((a, b) => dc[b] - dc[a] || a.localeCompare(b)).slice(0, 8);
        // an exact existing name stays first, so Enter keeps «ИВАН» rather than «ИВАН ПЕТРОВИЧ» (the cue being typed does not count)
        if (names.length && (q in (P().chars || {}) || (dc[q] || 0) > (C.charName(C.up(text)) === q ? 1 : 0))) names.unshift(q);
        items = names.map((n) => ({ label: n, value: n + keep, note: dc[n] ? dc[n] + ' репл.' : 'из библии' }));
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
    const nb = readBlocks(), sig = JSON.stringify(nb);
    // 'updated' moves on every recompute; textAt only when the words change, so merging two copies can tell which text is newer
    if (S.textSig && S.textSig.id === S.ep.id && S.textSig.sig !== sig) S.ep.textAt = Date.now();
    S.textSig = { id: S.ep.id, sig };
    if (S.ep.tags && S.ep.tags.length) C.anchorTags(nb, S.ep.tags, S.ep.blocks);
    S.ep.blocks = nb;
    S.ep.updated = Date.now();
    S.st = C.analyzeEpisode(S.ep, P());
    // under a numbering lock every new scene gets its A-number at once, so it never shifts the others
    // a lock with no frozen number on any scene is stale state (it would renumber everything 1, 1A, 1B…): leave it alone
    if (S.ep.lock && S.st.scenes.some((s) => s.fileNum) && C.lockAssign(S.st.scenes, S.ep.sceneMeta).length) S.st = C.analyzeEpisode(S.ep, P());
    // revision marks are derived from the revision bases; each block keeps its level (block.rev) for the exports
    nb.forEach((b, i) => { const r = S.st.revs ? S.st.revs[i] : 0; if (r) b.rev = r; else delete b.rev; });
    // the open episode's text changed: its cached analysis is stale for the episode list and the bible once it is left
    delete S.ep._st;
    S.rulesRes = C.evalRules(S.ep, P(), S.st, seasonContext());
    decorateEditor();
    if (S.zoom && S.zoom !== 1) sizePage();
    renderScenes(); renderRight(); renderRuler(); renderComments(); renderTags(); renderEpisodesMeta();
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
    const breaks = S.st.lay.breaks, labels = S.st.lay.labels;
    const sceneN = {}; S.st.scenes.forEach((s) => { sceneN[s.id] = s.num; });
    els.forEach((el, i) => {
      const br = breaks[i];
      if (br) { const lb = labels[br.page - 1] || String(br.page); if (el.dataset.pb !== lb) el.dataset.pb = lb; } else if (el.dataset.pb) delete el.dataset.pb;
      if (el.dataset.t === 'scene') { const n = sceneN[el.dataset.id]; if (n && el.dataset.n !== String(n)) el.dataset.n = n; }
      else if (el.dataset.n) delete el.dataset.n;
      const om = el.dataset.t === 'scene' && !!(S.ep.sceneMeta[el.dataset.id] || {}).omitted;
      if (om !== el.classList.contains('omit')) el.classList.toggle('omit', om);
    });
    // a page that ends inside a block: a dashed line under the line where it ends, outside the editable text
    const pg = $('#page');
    pg.querySelectorAll(':scope > .pbin').forEach((m) => m.remove());
    const inner = S.st.lay.inner || {};
    for (const k of Object.keys(inner)) {
      const el = els[k];
      if (!el) continue;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
      // measured from the block's bottom, so a 'стр. N' label above the block does not shift it
      const top = el.offsetTop + el.offsetHeight - S.st.lay.info[k].L * lh;
      for (const b of inner[k]) {
        const m = document.createElement('div');
        m.className = 'pbin'; m.setAttribute('aria-hidden', 'true'); m.dataset.page = b.page;
        m.textContent = 'стр. ' + (labels[b.page - 1] || b.page); m.style.top = (top + b.line * lh) + 'px';
        pg.appendChild(m);
      }
    }
    // revision marks: an asterisk in the right margin of every line of a revised element, in its revision's colour
    pg.querySelectorAll(':scope > .revmark').forEach((m) => m.remove());
    const revs = S.st.revs;
    if (revs && revMarksOn()) els.forEach((el, i) => {
      const lv = revs[i]; if (!lv) return;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 16, L = S.st.lay.info[i].L;
      const m = document.createElement('div');
      m.className = 'revmark'; m.setAttribute('aria-hidden', 'true'); m.dataset.level = lv; m.title = C.revName(lv) + ' ревизия';
      m.textContent = Array(L).fill('*').join('\n'); m.style.color = C.revColor(lv);
      m.style.top = (el.offsetTop + el.offsetHeight - L * lh) + 'px'; m.style.lineHeight = lh + 'px';
      pg.appendChild(m);
    });
  }
  const revMarksOn = () => ls.get('draft.revMarks', true) !== false;
  function renderRuler() {
    const st = S.st;
    $('#pageInfo').textContent = 'стр. ' + st.pages.toFixed(2) + ' · ' + C.fmtTime(st.minutes) + ' · ' + st.scenes.length + ' сц. · павильон ' + Math.round(st.pavPct) + '%' +
      (st.lines && st.lines.length ? ' · ' + st.lines.map((l) => l.name + ' ' + (l.share * 100).toFixed(0) + '%').join(' / ') : '');
    $('#roleInfo').textContent = roleName(S.me.role) + ': ' + S.me.name + (S.ep.lock ? ' · номера сцен залочены' : '');
    const lv = S.ep.revLevel || 0, ri = $('#revInfo');
    ri.hidden = !lv && !S.ep.pageLock;
    ri.innerHTML = (lv ? '<i style="background:' + C.revColor(lv) + '"></i>' + esc(C.revName(lv)) + ' ревизия' : '') + (S.ep.pageLock ? (lv ? ' · ' : '') + 'страницы залочены' : '');
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
    $('#addEp').onclick = () => { if (readOnly('Новая серия')) return; recompute(); const e = newEpisode(p, S.ep ? S.ep.season : 1, ''); openEpisode(e.id); };
    $('#addSeason').onclick = () => { if (readOnly('Новый сезон')) return; recompute(); const e = newEpisode(p, Math.max(...p.episodes.map((x) => x.season)) + 1, ''); openEpisode(e.id); };
    $('#delEp').onclick = () => deleteEpisode();
    $('#projBtn').onclick = () => projectModal();
    $('#trashBtn').onclick = () => showTrash();
    $('#histBtn').onclick = () => showHistory();
    $('#renEp').onclick = () => readOnly('Изменение серии') || modal('<h2>Серия</h2><div class="form-grid"><label>Сезон<input type="number" id="reS" min="1" value="' + S.ep.season + '"></label><label>Номер серии<input type="number" id="reN" min="1" value="' + S.ep.number + '"></label><label>Название<input type="text" id="reT" value="' + esc(S.ep.title) + '"></label></div><div class="actions"><button class="btn danger" id="reDel">Удалить серию</button><button class="btn" id="reC">Отмена</button><button class="btn primary" id="reOk">Сохранить</button></div>', (m) => {
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
        if (!(await trashEpisode(p, ep))) { toast('Серия не удалена: не удалось положить её в корзину (нет места в браузере или Драфт изменён в другой вкладке).'); return; }
        p.episodes = p.episodes.filter((e) => e !== ep);
        if (!p.episodes.length) newEpisode(p, 1, '');
        S.ep = null; openEpisode(p.episodes[0].id); toast('Серия в корзине: ' + TRASH_DAYS + ' дней её можно вернуть');
      };
    });
  }
  function projectModal() {
    if (readOnly('Изменение проекта')) return;
    const p = P();
    modal('<h2>Проект</h2><div class="form-grid"><label>Название<input type="text" id="pmName" value="' + esc(p.name) + '"></label><label>Автор (титульный лист)<input type="text" id="pmAuthor" value="' + esc(p.author || '') + '"></label></div>' +
      '<p class="note">Серий: ' + p.episodes.length + ' · персонажей в справочнике: ' + Object.keys(p.chars || {}).length + ' · объектов: ' + Object.keys(p.locs || {}).length + '. Правила студии и линии — в «Настройках».</p>' +
      '<div class="actions">' + (canDelete() ? '<button class="btn danger" id="pmDel">Удалить проект</button>' : '<span class="small muted">Удалить проект может только продюсер</span>') + '<button class="btn" id="pmC">Отмена</button><button class="btn primary" id="pmOk">Сохранить</button></div>', (m) => {
      $('#pmC', m).onclick = closeModal;
      $('#pmOk', m).onclick = () => { if (readOnly('Изменение проекта')) return; p.name = $('#pmName', m).value.trim() || p.name; p.author = $('#pmAuthor', m).value.trim(); closeModal(); renderProjectSelect(); renderEpisodes(); persist(); };
      if ($('#pmDel', m)) $('#pmDel', m).onclick = () => {
        $('#pmDel', m).outerHTML = '<span class="small">Проект «' + esc(p.name) + '» со всеми сериями уйдёт в корзину на ' + TRASH_DAYS + ' дней.</span> <button class="btn danger" id="pmDel2">Да, в корзину</button>';
        $('#pmDel2', m).onclick = async () => {
          closeModal(); recompute();
          if (!(await trashProject(p))) { toast('Проект не удалён: не удалось положить его в корзину (нет места в браузере или Драфт изменён в другой вкладке).'); return; }
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
        '<div class="note">' + esc(lock.by) + '. Новые сцены получают буквенные номера (12A), убранные остаются в нумерации как «УДАЛЕНА».</div>' +
        (nc.issues.length ? '<ul>' + nc.issues.map((d) => '<li data-scene="' + d.sceneId + '">' + esc(d.text) + '</li>').join('') + '</ul>' : '') +
        (missing.length ? '<div class="note">Убраны из текста без пометки «УДАЛЕНА»: ' + missing.map((n) => esc(n.num)).join(', ') + '</div><div class="row">' + missing.map((n) => '<button class="btn small" data-restore-omit="' + esc(n.num) + '">Вернуть ' + esc(n.num) + ' как УДАЛЕНА</button>').join('') + '</div>' : '') +
        (canLock() ? '<div class="row"><button class="btn small ghost" id="unlockNum">Снять лок</button></div>' : '') + '</div>'
      : (canLock() && S.st.scenes.length ? '<div class="rule"><div class="top"><span class="dot"></span><span class="title">Номера сцен не залочены</span></div><div class="note">Перед запуском в производство зафиксируйте номера: после этого вставка даёт 12A, удаление даёт «УДАЛЕНА», и график группы не ломается.</div><div class="row"><button class="btn small" id="lockNum">Залочить номера сцен</button></div></div>' : '');
    const numHTML = lockHTML + (nc.fromFile && !lock ? '<div class="rule ' + (nc.issues.length ? 'warn' : 'ok') + '"><div class="top"><span class="dot"></span><span class="title">Нумерация из файла</span><span class="val">' + (nc.issues.length ? nc.issues.length + ' замеч.' : 'по порядку') + '</span></div>' +
      (nc.partial ? '<div class="note">У части сцен номера нет.</div>' : '') +
      (nc.issues.length ? '<ul>' + nc.issues.map((d) => '<li data-scene="' + d.sceneId + '">' + esc(d.text) + '</li>').join('') + '</ul>' : '') +
      '<div class="row"><button class="btn small" id="renum">Перенумеровать по порядку' + (nc.proposal[0].includes('-') ? ' (' + esc(nc.proposal[0]) + '…)' : '') + '</button><span class="small muted">отменить: Ctrl+Z</span></div></div>' : '');
    pane.innerHTML = numHTML + S.st.scenes.map((s) => '<div class="sc' + (s.id === S.curScene ? ' active' : '') + (s.sec < r.shortSceneSec ? ' short' : '') + (s.omitted ? ' omitted' : '') + '" data-id="' + s.id + '"><span class="num">' + esc(s.num) + '</span><span class="hd">' + esc(s.heading || '(без заголовка)') + '</span>' +
      '<span class="meta"><span class="mono">' + C.fmtPages(s.pages) + ' · ' + C.fmtTime(s.min) + '</span>' + (s.pav ? '<span class="chip pav">павильон</span>' : '') + (s.night ? '<span class="chip night">ночь</span>' : '') +
      s.tags.map((t) => '<span class="chip tag">' + esc(C.TAGS[t]) + '</span>').join('') + (s.cast.length ? '<span>' + s.cast.length + ' арт.</span>' : '') + (s.day ? '<span>д.' + esc(s.day) + '</span>' : '') + (S.ep.pageLock ? '<span title="Страница (лок страниц)">с. ' + esc(s.page) + '</span>' : '') + (s.line ? '<span class="chip" style="border-color:' + lineColor(s.line) + ';color:' + lineColor(s.line) + '" title="' + (s.lineAuto ? 'авто: ' + esc(s.lineAuto) : 'задано вручную') + '">' + esc(s.line) + (s.lineAuto ? ' ·' : '') + '</span>' : '') + '</span>' +
      (s.synopsis ? '<span class="syn">' + esc(s.synopsis) + '</span>' : '') + '</div>').join('') +
      (insp ? inspectorHTML(insp) : '<p class="note">Нажмите на сцену, чтобы перейти к ней, добавить синопсис, сценарный день и производственные метки.</p>');
    $$('.sc', pane).forEach((x) => x.onclick = () => { S.curScene = x.dataset.id; jumpTo(x.dataset.id); renderScenes(); });
    $$('li[data-scene]', pane).forEach((li) => li.onclick = () => jumpTo(li.dataset.scene));
    const rn = $('#renum', pane);
    if (rn) rn.onclick = () => {
      if (readOnly('Перенумерация')) return;
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
  // ---------- production revisions and locked pages (Final Draft: Production → Revisions, Lock Pages) ----------
  const fmtDay = (t) => new Date(t).toLocaleDateString('ru-RU');
  function showRevisions() {
    recompute();
    const ep = S.ep, lv = ep.revLevel || 0, list = (ep.revisions || []).slice().reverse();
    const may = canLock() && !TAB.stale, next = C.revName(lv + 1);
    const marked = (S.st.revs || []).filter((x) => x === lv && lv).length;
    const pl = ep.pageLock, aPages = S.st.lay.labels.filter((l) => /[A-Z]$/.test(l)).length;
    const sw = (lvl) => '<i class="revsw" style="background:' + C.revColor(lvl) + '"></i>';
    modal('<h2>Ревизии · серия ' + ep.number + '</h2>' +
      '<p class="note">' + (lv ? 'Текущая ревизия — <b>' + esc(C.revName(lv)) + '</b>. Всё, что меняется в тексте, помечается звёздочкой на правом поле; пометки прошлых ревизий остаются в своём цвете. В PDF на изменённых страницах — шапка с названием ревизии и датой.' : 'Текст — белый оригинал, пометок нет. Когда сценарий ушёл в производство, начните ревизию: дальнейшие правки будут помечаться звёздочкой на полях, как в Final Draft.') + '</p>' +
      (list.length ? '<div class="tbl-wrap"><table class="t"><thead><tr><th>Ревизия</th><th>Начата</th><th>Кто</th><th class="n">Помечено</th></tr></thead><tbody>' +
        list.map((r) => '<tr><td>' + sw(r.level) + esc(r.name || C.revName(r.level)) + (r.level === lv ? ' <span class="chip">текущая</span>' : '') + '</td><td class="mono small">' + fmtDay(r.date) + '</td><td class="small">' + esc(r.by || '') + '</td><td class="n">' + (S.st.revs || []).filter((x) => x === r.level).length + '</td></tr>').join('') +
        '<tr><td>' + sw(0) + 'Белая</td><td colspan="3" class="small muted">оригинал</td></tr></tbody></table></div>' : '') +
      '<div class="row">' + (may ? '<button class="btn primary" id="rvStart">' + sw(lv + 1) + 'Начать ревизию «' + esc(next) + '»</button>' : '<span class="small muted">Начать ревизию может продюсер или редактор.</span>') + '</div>' +
      '<label class="row"><input type="checkbox" id="rvMarks"' + (revMarksOn() ? ' checked' : '') + '> Показывать пометки на экране</label>' +
      (lv ? '<p class="note">Помечено элементов в текущей ревизии: ' + marked + '. В окне PDF можно напечатать только изменённые страницы.</p>' : '') +
      '<div class="h">Лок страниц</div>' +
      (pl ? '<div class="rule ok"><div class="top"><span class="dot"></span><span class="title">Страницы залочены</span><span class="val">' + fmtDate(pl.at) + '</span></div><div class="note">' + esc(pl.by || '') + '. Номера страниц не сдвигаются: текст, который не помещается, уходит на A-страницы (12A, 12B), а укоротившаяся страница остаётся короткой. A-страниц сейчас: ' + aPages + '.</div>' + (may ? '<div class="row"><button class="btn small ghost" id="rvUnlock">Снять лок страниц…</button></div>' : '') + '</div>'
        : '<div class="rule"><div class="top"><span class="dot"></span><span class="title">Страницы не залочены</span></div><div class="note">Перед рассылкой ревизий группе залочьте страницы: тогда исправленная страница 12 заменяет прежнюю 12, не сдвигая остальные.</div>' + (may ? '<div class="row"><button class="btn small" id="rvLock">Залочить страницы</button></div>' : '') + '</div>') +
      '<div class="actions"><button class="btn" id="rvClose">Закрыть</button></div>', (m) => {
      $('#rvClose', m).onclick = closeModal;
      $('#rvMarks', m).onchange = (e) => { ls.set('draft.revMarks', e.target.checked); decorateEditor(); };
      if ($('#rvStart', m)) $('#rvStart', m).onclick = () => { startRevision(); showRevisions(); };
      if ($('#rvLock', m)) $('#rvLock', m).onclick = () => { lockPages(); showRevisions(); };
      if ($('#rvUnlock', m)) $('#rvUnlock', m).onclick = unlockPages;
    });
  }
  function startRevision() {
    if (readOnly('Новая ревизия')) return;
    if (!canLock()) return needProducer('Начать ревизию');
    recompute();
    histAdd(S.ep, 'перед началом ревизии', true);
    pushUndo();
    const r = C.newRevision(S.ep.revLevel || 0, S.ep.blocks, S.me.name + ' (' + roleName(S.me.role) + ')');
    S.ep.revisions = (S.ep.revisions || []).concat([r]); S.ep.revLevel = r.level;
    recompute();
    toast(r.name + ' ревизия начата: правки помечаются звёздочкой на полях. Отменить: Ctrl+Z');
  }
  function lockPages() {
    if (readOnly('Лок страниц')) return;
    if (!canLock()) return needProducer('Залочить страницы');
    recompute();
    histAdd(S.ep, 'перед локом страниц', true);
    pushUndo();
    S.ep.pageLock = Object.assign({ at: Date.now(), by: S.me.name + ' (' + roleName(S.me.role) + ')' }, C.pageLockFrom(S.st.lay, S.ep.blocks));
    recompute();
    toast('Страницы залочены: ' + S.ep.pageLock.pages.length + ' стр.');
  }
  function unlockPages() {
    if (readOnly('Снять лок страниц')) return;
    if (!canLock()) return needProducer('Снять лок страниц');
    modal('<h2>Снять лок страниц</h2><p class="note">После снятия лока страницы перенумеруются подряд, A-страницы исчезнут, и разосланные группе страницы перестанут совпадать с текстом. Поэтому действие записывается в историю с причиной.</p><label class="small muted">Причина<input type="text" id="upReason" placeholder="Например: новый полный драфт"></label><div class="actions"><button class="btn" id="upC">Отмена</button><button class="btn primary" id="upOk">Снять лок</button></div>', (m) => {
      $('#upC', m).onclick = closeModal;
      $('#upOk', m).onclick = () => {
        const reason = $('#upReason', m).value.trim() || 'без причины';
        histAdd(S.ep, 'снят лок страниц: ' + reason, true);
        pushUndo();
        const was = S.ep.pageLock || {};
        S.ep.pageLockLog = (S.ep.pageLockLog || []).concat([{ at: Date.now(), by: S.me.name, role: S.me.role, reason, was: { at: was.at, by: was.by, pages: (was.pages || []).length } }]);
        delete S.ep.pageLock;
        closeModal(); recompute(); toast('Лок страниц снят');
      };
    });
  }
  // a scene that leaves the shooting script keeps its number as «УДАЛЕНА»
  function omitScene(s) {
    if (readOnly('Удаление сцены')) return;
    pushUndo();
    const blocks = readBlocks();
    const meta = (S.ep.sceneMeta[s.id] = S.ep.sceneMeta[s.id] || {});
    meta.num = s.num; meta.omitted = true; meta.omittedBlocks = JSON.parse(JSON.stringify(blocks.slice(s.from, s.to + 1)));
    meta.omittedHeading = s.heading;
    blocks.splice(s.from, s.to - s.from + 1, { id: s.id, t: 'scene', x: C.omittedHeading(s.num) });
    S.ep.blocks = blocks; renderEditor(); recompute(); renderScenes();
  }
  function restoreScene(s) {
    if (readOnly('Возврат сцены')) return;
    const meta = S.ep.sceneMeta[s.id] || {};
    pushUndo();
    const blocks = readBlocks();
    const piece = meta.omittedBlocks && meta.omittedBlocks.length ? meta.omittedBlocks : [{ id: s.id, t: 'scene', x: meta.omittedHeading || '' }];
    // only the «УДАЛЕНА» heading is replaced: anything typed under it stays after the restored text
    blocks.splice(s.from, 1, ...piece);
    delete meta.omitted; delete meta.omittedBlocks; delete meta.omittedHeading;
    S.ep.blocks = blocks; renderEditor(); recompute(); renderScenes();
  }
  function restoreMissing(num) {
    if (readOnly('Возврат номера') || !S.ep.lock) return;
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
    if (S.me.role === 'reader') return '<div class="inspector"><b>Сцена ' + esc(s.num) + (s.omitted ? ' · удалена' : '') + '</b>' + (s.synopsis ? '<p class="small">' + esc(s.synopsis) + '</p>' : '') + (s.day ? '<div class="small muted">Сценарный день: ' + esc(s.day) + '</div>' : '') + '<div class="small muted">В сцене: ' + (s.cast.length ? s.cast.map(esc).join(', ') : '—') + '</div></div>';
    const ed2 = canEdit();
    return '<div class="inspector"><div class="row between"><b>Сцена ' + esc(s.num) + (s.omitted ? ' · удалена' : '') + '</b><span class="row">' + (lock ? (s.omitted ? '<button class="btn small" id="scRestore">Вернуть сцену</button>' : '<button class="btn small ghost danger" id="scOmit" title="Текст убирается, а номер остаётся в сценарии как «УДАЛЕНА»">Удалить сцену</button>') : '') + (ed2 ? '<button class="btn small" id="scUp" title="Переместить выше">↑</button><button class="btn small" id="scDown" title="Переместить ниже">↓</button>' : '') + '</span></div>' +
      '<label class="small muted">Синопсис<textarea id="scSyn" rows="2">' + esc(s.synopsis) + '</textarea></label>' +
      '<div class="row"><label class="small muted">Номер <input type="text" id="scNum" value="' + esc(s.fileNum ? s.num : '') + '" placeholder="' + esc(s.num) + '" style="width:70px"' + (lock ? ' readonly title="Номера залочены"' : '') + '></label>' +
      '<label class="small muted">Сценарный день <input type="text" id="scDay" value="' + esc(s.day) + '" style="width:70px"></label></div>' +
      ((P().lines || []).length ? '<label class="small muted">Линия <select id="scLine">' + lineOptions(s) + '</select></label>' : '') +
      '<div class="tags">' + Object.entries(C.TAGS).map(([k, v]) => '<label><input type="checkbox" data-tag="' + k + '"' + (s.tags.includes(k) ? ' checked' : '') + '>' + esc(v) + '</label>').join('') + '</div>' +
      '<label class="small muted">Персонажи без реплик (через запятую)<input type="text" id="scExtras" value="' + esc(((S.ep.sceneMeta[s.id] || {}).extras || []).join(', ')) + '"></label>' +
      '<div class="small muted">В сцене: ' + (s.cast.length ? s.cast.map(esc).join(', ') : '—') + '</div></div>';
  }
  function bindInspector(s) {
    if (S.me.role === 'reader') return;
    const meta = () => (S.ep.sceneMeta[s.id] = S.ep.sceneMeta[s.id] || {});
    $('#scSyn').onchange = (e) => { meta().synopsis = e.target.value.trim(); recompute(); };
    $('#scDay').onchange = (e) => { meta().day = e.target.value.trim(); recompute(); };
    $('#scNum').onchange = (e) => { if (S.ep.lock) return; pushUndo(); meta().num = e.target.value.trim(); recompute(); };
    const om = $('#scOmit'); if (om) om.onclick = () => omitScene(s);
    const rs = $('#scRestore'); if (rs) rs.onclick = () => restoreScene(s);
    const sl = $('#scLine'); if (sl) sl.onchange = (e) => { pushUndo(); meta().line = e.target.value; recompute(); };
    $('#scExtras').onchange = (e) => { meta().extras = e.target.value.split(',').map((x) => C.charName(x)).filter(Boolean); recompute(); };
    $$('[data-tag]').forEach((c) => c.onchange = () => { const m = meta(); m.tags = m.tags || []; if (c.checked) m.tags.push(c.dataset.tag); else m.tags = m.tags.filter((t) => t !== c.dataset.tag); recompute(); });
    const up = $('#scUp'), dn = $('#scDown'); if (up) up.onclick = () => moveScene(s, -1); if (dn) dn.onclick = () => moveScene(s, 1);
  }
  function moveScene(s, dir) {
    if (!canEdit()) return readOnly('Перемещение сцены') || toast('Перемещать сцены может сценарист или редактор');
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
            // formatHeading drops a typed number and script day: keep them in the heading text
            b.x = (h.num ? h.num + '. ' : '') + C.formatHeading(h) + (h.day ? ' ' + h.day : '');
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
    if (readOnly('Комментарий')) return;
    const sel = window.getSelection();
    const el = curBlockEl();
    if (!el || sel.isCollapsed) { toast('Выделите фрагмент текста, к которому нужен комментарий.'); return; }
    // a comment is anchored to one element: a selection that runs into the next ones is clipped to it, so the quote is found there
    const r0 = sel.getRangeAt(0).cloneRange();
    if (!el.contains(r0.startContainer)) r0.setStart(el, 0);
    if (!el.contains(r0.endContainer)) r0.setEnd(el, el.childNodes.length);
    const quote = r0.toString().replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!quote) { toast('Выделите фрагмент текста, к которому нужен комментарий.'); return; }
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
  const canEdit = () => !TAB.stale && (S.me.role === 'writer' || S.me.role === 'editor');
  const canLock = () => S.me.role === 'producer' || S.me.role === 'editor';
  // a reader only reads and prints a watermarked PDF: every path that changes the project checks this
  const readOnly = (what) => { if (TAB.stale) { toast('Драфт изменён в другой вкладке: здесь только чтение. Обновите страницу.'); return true; } if (S.me.role !== 'reader') return false; toast('Роль «Читатель»: только чтение' + (what ? '. ' + what + ' недоступно' : '')); return true; };
  function renderComments() {
    const marks = $('#cmarks'); marks.innerHTML = '';
    const ranges = [], active = [];
    const used = [];
    let all = null;
    for (const c of S.ep.comments || []) {
      let el = ed.querySelector('[data-id="' + c.blockId + '"]');
      // joining or splitting elements moves the quoted text to another element: follow it, nearest to the old place first
      if ((!el || el.textContent.indexOf(c.quote) < 0) && c.quote) {
        all = all || [...ed.querySelectorAll('.b[data-id]')];
        const start = Math.max(0, Math.min(el ? all.indexOf(el) : blockIndex(c.blockId), all.length - 1));
        const hit = all[C.findAnchor(all.map((x) => x.textContent), c.quote, start)];
        if (hit) { el = hit; c.blockId = hit.dataset.id; }
      }
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
      ((S.ep.deletedComments || []).length ? '<div class="row"><button class="btn small ghost" id="cmDeleted">Удалённые (' + S.ep.deletedComments.length + ')</button></div>' +
        (S.cmDeletedOpen ? S.ep.deletedComments.map((c) => '<div class="cm resolved"><div class="who"><b>' + esc(c.author) + '</b> <span class="role-badge' + (c.role === 'producer' ? ' prod' : '') + '">' + roleName(c.role) + '</span> · удалил ' + esc(c.deletedBy || '') + ' ' + fmtDate(c.deleted) + '</div><div class="q">' + esc(c.quote) + '</div><div class="txt">' + esc(c.text) + '</div><div class="row"><button class="btn small" data-undel="' + c.id + '">Вернуть</button></div></div>').join('') : '') : '') +
      '<p class="note">Чтобы передать замечания: «Экспорт → Файл проекта». Сценарист открывает файл, и комментарии продюсера встают на свои места.</p>';
    $('#cmNew', pane).onclick = startComment;
    $$('.cm[data-c]', pane).forEach((x) => x.addEventListener('click', (e) => {
      if (e.target.closest('input,button')) return;
      const c = S.ep.comments.find((k) => k.id === x.dataset.c); S.activeComment = c.id; renderComments(); $$('.cm', pane).forEach((y) => y.classList.toggle('active', y === x));
      jumpTo(c.blockId, false);
    }));
    $$('[data-reply]', pane).forEach((inp) => inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      if (readOnly('Ответ на замечание')) return;
      const c = S.ep.comments.find((k) => k.id === inp.dataset.reply);
      c.replies.push({ author: S.me.name, role: S.me.role, text: inp.value.trim(), date: Date.now() }); inp.blur(); renderCommentList(pane); renderComments(); persist();
    });
    $$('[data-res]', pane).forEach((b) => b.onclick = () => { if (readOnly()) return; const c = S.ep.comments.find((k) => k.id === b.dataset.res); c.resolved = !c.resolved; renderCommentList(pane); renderComments(); persist(); });
    // only the author or a producer removes a remark, and it goes to the 'deleted' list, where anyone can put it back
    $$('[data-del]', pane).forEach((b) => b.onclick = () => {
      if (readOnly('Удаление замечания')) return;
      const c = S.ep.comments.find((k) => k.id === b.dataset.del); if (!c) return;
      if (!canDelete() && !(c.author === S.me.name && c.role !== 'producer')) return needProducer('Замечание удаляет только его автор (' + c.author + ') или продюсер. Если оно учтено, отметьте его «Решено».');
      S.ep.comments = S.ep.comments.filter((k) => k !== c);
      (S.ep.deletedComments = S.ep.deletedComments || []).push(Object.assign(c, { deleted: Date.now(), deletedBy: S.me.name }));
      renderCommentList(pane); renderComments(); persist();
      toast('Замечание удалено. Вернуть его можно в списке «Удалённые» под замечаниями.');
    });
    if ($('#cmDeleted', pane)) $('#cmDeleted', pane).onclick = () => { S.cmDeletedOpen = !S.cmDeletedOpen; renderCommentList(pane); };
    $$('[data-undel]', pane).forEach((b) => b.onclick = () => {
      if (readOnly('Возврат замечания')) return;
      const c = (S.ep.deletedComments || []).find((k) => k.id === b.dataset.undel); if (!c) return;
      S.ep.deletedComments = S.ep.deletedComments.filter((k) => k !== c);
      delete c.deleted; delete c.deletedBy; S.ep.comments.push(c);
      renderCommentList(pane); renderComments(); persist(); toast('Замечание возвращено');
    });
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
          (s ? '<div class="small muted">Впервые: серия ' + s.first.ep.number + ', сц. ' + esc(s.first.s.num) + ' · серии: ' + [...s.episodes].join(', ') + ' · реплик ' + s.replicas + ', слов ' + s.words + '</div>' : '') +
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
    if (readOnly('Сохранение драфта')) return;
    recompute();
    const n = (S.ep.drafts || []).length + 1;
    modal('<h2>Сохранить драфт</h2><label class="small muted">Название<input type="text" id="drName" value="Драфт ' + n + '"></label><label class="small muted">Что изменилось<textarea id="drNote" rows="2" placeholder="Например: правки продюсера по 3 и 5 сценам"></textarea></label><div class="actions"><button class="btn" id="drList">Все драфты</button><button class="btn" id="drC">Отмена</button><button class="btn primary" id="drOk">Сохранить</button></div>', (m) => {
      $('#drC', m).onclick = closeModal; $('#drList', m).onclick = () => showDrafts();
      $('#drOk', m).onclick = () => {
        const d = { id: C.uid(), name: $('#drName', m).value.trim() || 'Драфт ' + n, note: $('#drNote', m).value.trim(), date: Date.now(), author: S.me.name, ...epCopy(S.ep), pages: S.st.pages, scenes: S.st.scenes.length };
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
        if (readOnly('Восстановление драфта')) return;
        const d = ds.find((x) => x.id === b.dataset.rest);
        S.ep.drafts.push({ id: C.uid(), name: 'Авто: перед восстановлением «' + d.name + '»', date: Date.now(), author: S.me.name, ...epCopy(S.ep), pages: S.st.pages, scenes: S.st.scenes.length });
        histAdd(S.ep, 'перед восстановлением драфта', true);
        pushUndo(); S.ep.blocks = JSON.parse(JSON.stringify(d.blocks)); S.ep.sceneMeta = JSON.parse(JSON.stringify(d.sceneMeta || {})); setLock(S.ep, d);
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
  const jcopy = (v) => JSON.parse(JSON.stringify(v));
  function epCopy(ep) { return { blocks: jcopy(ep.blocks), sceneMeta: jcopy(ep.sceneMeta || {}), lock: ep.lock ? jcopy(ep.lock) : null, revisions: ep.revisions ? jcopy(ep.revisions) : null, revLevel: ep.revLevel || 0, pageLock: ep.pageLock ? jcopy(ep.pageLock) : null, tags: jcopy(ep.tags || []) }; }
  // the numbering lock travels with the numbers it froze, revisions and locked pages with the text they describe:
  // a saved state without the key (older data) leaves it as is
  function setLock(ep, sn) {
    if (!sn) return;
    if ('lock' in sn) { if (sn.lock) ep.lock = jcopy(sn.lock); else delete ep.lock; }
    if ('revisions' in sn) { if (sn.revisions && sn.revisions.length) { ep.revisions = jcopy(sn.revisions); ep.revLevel = sn.revLevel || ep.revisions[ep.revisions.length - 1].level; } else { delete ep.revisions; delete ep.revLevel; } }
    if ('pageLock' in sn) { if (sn.pageLock) ep.pageLock = jcopy(sn.pageLock); else delete ep.pageLock; }
    // breakdown tags are anchored to the text, so they come back with it; a tag brought back is no longer 'removed' for merges
    if ('tags' in sn) { ep.tags = jcopy(sn.tags || []); if (ep.untagged) ep.untagged = ep.untagged.filter((id) => !ep.tags.some((t) => t.id === id)); }
  }
  async function histAdd(ep, reason, keep) {
    if (!ep) return null;
    // the state is copied before the first await: callers change the episode right after calling histAdd
    const copy = epCopy(ep);
    const sig = JSON.stringify(copy);
    const st = ep === S.ep && S.st ? S.st : C.analyzeEpisode(ep, P());
    const pages = st.pages, scenes = st.scenes.length;
    const list = await histLoad(ep);
    const last = list[list.length - 1];
    if (last && last.sig === sig) { ep.histAt = Date.now(); return last; }
    const h = { id: C.uid(), date: Date.now(), author: S.me.name, reason: reason || 'автоснимок', keep: !!keep, pages, scenes, sig, blocks: copy.blocks, sceneMeta: copy.sceneMeta, lock: copy.lock, revisions: copy.revisions, revLevel: copy.revLevel, pageLock: copy.pageLock, tags: copy.tags };
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
  // leaving the page: the debounced save would never run, so write at once; the localStorage copy is the only write
  // sure to land during unload, and boot() puts it back if the database missed it
  function saveNow() {
    if (!S.ep || !S.db) return;
    scheduleRecompute.cancel(); recompute(); persist.cancel();
    // a stale tab cannot edit, and rescueTab already set aside what it had not saved
    if (TAB.stale) return;
    const pend = { tab: TAB.id, at: Date.now(), epId: S.ep.id, blocks: S.ep.blocks, sceneMeta: S.ep.sceneMeta || {}, lock: S.ep.lock || null, revisions: S.ep.revisions || null, revLevel: S.ep.revLevel || 0, pageLock: S.ep.pageLock || null, tags: S.ep.tags || [], textAt: S.ep.textAt || 0, updated: S.ep.updated };
    ls.set('draft.pending', pend);
    DB.put('db', S.db).then((ok) => { saved(ok); if (ok && (ls.get('draft.pending', null) || {}).at === pend.at) try { localStorage.removeItem('draft.pending'); } catch (e) { /* ignore */ } });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden || !S.ep) return; saveNow(); if (!TAB.stale && (S.ep.updated || 0) > (S.ep.histAt || 0)) histAdd(S.ep, 'автоснимок'); });
  window.addEventListener('pagehide', saveNow);
  // text that would otherwise be dropped is kept as a named draft of its episode (the same text only once)
  function keepDraft(ep, name, src) {
    const c = epCopy(src), sig = JSON.stringify(c.blocks);
    ep.drafts = ep.drafts || [];
    if (ep.drafts.some((d) => JSON.stringify(d.blocks) === sig)) return false;
    let st = { pages: 0, scenes: [] };
    try { const p = S.db.projects.find((x) => x.episodes.includes(ep)) || P(); st = C.analyzeEpisode({ ...ep, blocks: c.blocks, sceneMeta: c.sceneMeta }, { ...p, rules: Object.assign({}, C.DEFAULT_RULES, p.rules || {}) }); } catch (e) { /* the counts are cosmetic */ }
    ep.drafts.push({ id: C.uid(), name: name + ' ' + fmtDate(Date.now()), date: Date.now(), author: S.me.name, ...c, pages: st.pages, scenes: st.scenes.length });
    return true;
  }
  // what this tab has not saved yet: episodes whose text changed since its last save, and new comments
  async function unsavedItems() {
    if (S.ep) { scheduleRecompute.cancel(); recompute(); }
    const since = TAB.savedAt || 0;
    const cur = (await DB.get('db')) || { projects: [] };
    const curEp = {}; (cur.projects || []).forEach((p) => (p.episodes || []).forEach((e) => { curEp[e.id] = e; }));
    const items = [];
    for (const p of S.db.projects) for (const e of p.episodes) {
      const o = curEp[e.id];
      const text = (e.textAt || 0) > since && (!o || JSON.stringify(o.blocks) !== JSON.stringify(e.blocks));
      const cms = (e.comments || []).filter((c) => (c.date || 0) > since || (c.replies || []).some((x) => (x.date || 0) > since));
      if (text || cms.length) items.push({ at: Date.now(), projectId: p.id, projectName: p.name, ep: JSON.parse(JSON.stringify({ ...e, drafts: [], _st: undefined, comments: cms })), text });
    }
    return items;
  }
  // nothing unsaved here: load what the other tab stored and carry on editing it (same episode, caret kept)
  async function adoptNewer() {
    if ((await unsavedItems()).length) return false;
    const rev = (await DB.get('rev')) || { n: 0 };
    const db = await DB.get('db');
    if (!db || !db.projects || !db.projects.length) return false;
    db.projects.forEach((p) => (p.episodes || []).forEach((e) => delete e._st));
    const epId = S.ep && S.ep.id, caret = document.activeElement === ed ? getCaret() : null;
    TAB.rev = TAB.last = rev.n || 0; TAB.savedAt = Date.now();
    S.db = db; S.ep = null;
    if (epId && db.projects.some((p) => (p.episodes || []).some((e) => e.id === epId))) db.currentEpId = epId;
    await trashLoad();
    openProject(db.currentProjectId);
    // adopting is not an edit: writing it back would bounce ownership between the tabs
    persist.cancel();
    if (caret) setCaret(caret.id, caret.off);
    return true;
  }
  // a stale tab sets aside what it has not saved
  async function rescueTab() {
    const items = await unsavedItems();
    if (!items.length) return;
    ls.set('draft.rescue.' + TAB.id, items);
    const all = (await DB.get('rescue')) || [];
    if (await DB.put('rescue', all.concat(items))) try { localStorage.removeItem('draft.rescue.' + TAB.id); } catch (e) { /* ignore */ }
  }
  // boot: put back what an unloading or stale tab set aside
  function restoreAside(db, rev, rescue) {
    let n = 0;
    const find = (id) => { for (const p of db.projects) { const e = (p.episodes || []).find((x) => x.id === id); if (e) return { p, e }; } return null; };
    const pend = ls.get('draft.pending', null);
    if (pend && pend.epId && pend.blocks) {
      const f = find(pend.epId);
      if (f && JSON.stringify(f.e.blocks) !== JSON.stringify(pend.blocks)) {
        // the same tab wrote last and its unload copy is newer: that is just the tail the database missed
        if (rev.tab === pend.tab && (pend.textAt || 0) >= (f.e.textAt || 0)) { f.e.blocks = pend.blocks; f.e.sceneMeta = pend.sceneMeta || {}; setLock(f.e, pend); f.e.textAt = pend.textAt; f.e.updated = Math.max(f.e.updated || 0, pend.updated || 0); }
        else if (rev.tab !== pend.tab && keepDraft(f.e, 'Несохранённое из другой вкладки', pend)) n++;
      }
    }
    const list = (rescue || []).slice();
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('draft.rescue.')) list.push(...(ls.get(k, []) || [])); } } catch (e) { /* storage blocked */ }
    for (const it of list) {
      const e2 = it.ep; if (!e2 || !e2.id) continue;
      let f = find(e2.id);
      if (!f) {
        let p = db.projects.find((x) => x.id === it.projectId);
        if (!p) { p = { id: it.projectId, name: it.projectName || 'Восстановленный проект', author: '', rules: Object.assign({}, C.DEFAULT_RULES), chars: {}, locs: {}, relations: [], episodes: [], created: Date.now() }; db.projects.push(p); }
        p.episodes.push(Object.assign(e2, { drafts: [], comments: e2.comments || [] })); sortEpisodes(p); n++; continue;
      }
      if (it.text && JSON.stringify(f.e.blocks) !== JSON.stringify(e2.blocks) && keepDraft(f.e, 'Из другой вкладки', e2)) n++;
      for (const c of e2.comments || []) {
        if ((f.e.deletedComments || []).some((x) => x.id === c.id)) continue;
        const c1 = (f.e.comments = f.e.comments || []).find((x) => x.id === c.id);
        if (!c1) { f.e.comments.push(c); n++; } else for (const x of c.replies || []) if (!c1.replies.some((y) => y.date === x.date && y.text === x.text)) { c1.replies.push(x); n++; }
      }
    }
    return n;
  }

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
          pushUndo(); S.ep.blocks = JSON.parse(JSON.stringify(h.blocks)); S.ep.sceneMeta = JSON.parse(JSON.stringify(h.sceneMeta || {})); setLock(S.ep, h);
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
  $('#btnHistory').onclick = () => readOnly('История') || showHistory();

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
    // without a trash copy the episode must not go away
    if (await trashSave()) return true;
    S.trash.items.shift(); S.hist[ep.id] = hist; return false;
  }
  async function trashProject(p) {
    const hist = {};
    for (const ep of p.episodes) { hist[ep.id] = await histLoad(ep); delete S.hist[ep.id]; }
    S.trash.items.unshift({ id: C.uid(), kind: 'project', deleted: Date.now(), by: S.me.name, projectId: p.id, projectName: p.name, label: 'Проект «' + p.name + '», серий: ' + p.episodes.length, data: stripCache(p), hist });
    if (await trashSave()) return true;
    S.trash.items.shift(); Object.assign(S.hist, hist); return false;
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
    if (readOnly('Загрузка сценария')) return;
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
      if (ext === 'fdx' || ext === 'xml') { const xml = await f.text(); blocks = C.importFDX(xml); blocks.activeSet = C.fdxActiveSet(xml); }
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
      pages.push(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.hypot(it.transform[2], it.transform[3]), rot: Math.abs(it.transform[1]) > 0.01 || Math.abs(it.transform[2]) > 0.01 })));
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
    if (where === 'replace') {
      histAdd(S.ep, 'перед загрузкой файла', true); pushUndo(); ep = S.ep; ep.blocks = blocks; ep.sceneMeta = fin.sceneMeta;
      // a new file brings its own numbering: the old lock no longer describes it (Ctrl+Z brings both back)
      if (ep.lock) { ep.lockLog = (ep.lockLog || []).concat([{ at: Date.now(), by: S.me.name, role: S.me.role, reason: 'текст заменён загруженным файлом', was: ep.lock }]); delete ep.lock; }
      // the same for locked pages and revisions: they describe the old text's elements
      if (ep.pageLock) { ep.pageLockLog = (ep.pageLockLog || []).concat([{ at: Date.now(), by: S.me.name, role: S.me.role, reason: 'текст заменён загруженным файлом', was: { at: ep.pageLock.at, by: ep.pageLock.by, pages: (ep.pageLock.pages || []).length } }]); delete ep.pageLock; }
      delete ep.revisions; delete ep.revLevel;
    }
    else {
      // a title line before the first scene names the episode
      let title = (source || '').replace(/\.[^.]+$/, '');
      if (blocks[0] && blocks[0].t === 'action' && blocks[1] && blocks[1].t === 'scene' && blocks[0].x.length < 90) title = blocks.shift().x;
      ep = newEpisode(P(), season, title, blocks); ep.sceneMeta = fin.sceneMeta;
    }
    // revision marks from Final Draft (RevisionID) become this episode's revisions (after a title line was taken off)
    const rv = C.revisionsFromMarks(ep.blocks, rawBlocks.activeSet || 0);
    if (rv) { ep.revisions = rv.revisions; ep.revLevel = rv.revLevel; }
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
        // merge: add comments and drafts that are new; the text is taken only from a copy whose words changed later,
        // and the local text is kept as a draft first
        if (S.ep) recompute();
        let added = 0, replaced = 0;
        for (const e2 of proj.episodes) {
          const e1 = ex.episodes.find((e) => e.id === e2.id);
          if (!e1) { ex.episodes.push(e2); added++; continue; }
          for (const c of e2.comments || []) {
            const c1 = e1.comments.find((x) => x.id === c.id);
            if (!c1 && (e1.deletedComments || []).some((x) => x.id === c.id)) continue;
            if (!c1) { e1.comments.push(c); added++; }
            else { for (const r of c.replies || []) if (!c1.replies.some((x) => x.date === r.date && x.text === r.text)) { c1.replies.push(r); added++; } c1.resolved = c1.resolved || c.resolved; }
          }
          for (const d of e2.drafts || []) if (!e1.drafts.some((x) => x.id === d.id)) { e1.drafts.push(d); added++; }
          // files from before textAt existed fall back to 'updated', which also moves when a copy is only opened
          const newer = (e1.textAt || e2.textAt) ? (e2.textAt || 0) > (e1.textAt || 0) : (e2.updated || 0) > (e1.updated || 0);
          const textWon = newer && JSON.stringify(e1.blocks) !== JSON.stringify(e2.blocks);
          if (textWon) {
            keepDraft(e1, 'Авто: перед открытием файла проекта', e1);
            e1.blocks = e2.blocks; e1.sceneMeta = e2.sceneMeta; e1.updated = e2.updated; e1.textAt = e2.textAt; replaced++;
          }
          // revisions come from the copy that started the latest one (on a tie, with the text that won); locked pages,
          // like the numbering lock, from the newest lock or unlock event
          const revAt = (e) => Math.max(0, ...(e.revisions || []).map((r) => r.date || 0));
          if (revAt(e2) > revAt(e1) || (textWon && revAt(e2) === revAt(e1))) setLock(e1, { revisions: e2.revisions || null, revLevel: e2.revLevel || 0 });
          const plAt = (e) => Math.max(e.pageLock ? e.pageLock.at || 0 : 0, ...(e.pageLockLog || []).map((l) => l.at || 0), 0);
          if (plAt(e2) > plAt(e1)) setLock(e1, { pageLock: e2.pageLock || null });
          const plog = (e1.pageLockLog || []).slice();
          for (const l of e2.pageLockLog || []) if (!plog.some((x) => x.at === l.at)) plog.push(l);
          if (plog.length) e1.pageLockLog = plog.sort((a, b) => a.at - b.at);
          // the numbering lock is production state, not text: the newest lock or unlock event wins whichever text copy won
          const lockAt = (e) => Math.max(e.lock ? e.lock.at || 0 : 0, ...(e.lockLog || []).map((l) => l.at || 0), 0);
          if (lockAt(e2) > lockAt(e1)) {
            if (e2.lock) {
              e1.lock = e2.lock;
              const byNum = {}; (e2.lock.nums || []).forEach((n) => { byNum[n.num] = 1; });
              // keep the producer's frozen numbers on the scenes that carry them in the incoming copy
              e1.sceneMeta = e1.sceneMeta || {};
              for (const [id, m] of Object.entries(e2.sceneMeta || {})) if (m && byNum[m.num]) (e1.sceneMeta[id] = e1.sceneMeta[id] || {}).num = m.num;
            } else delete e1.lock;
          }
          const log = (e1.lockLog || []).slice();
          for (const l of e2.lockLog || []) if (!log.some((x) => x.at === l.at)) log.push(l);
          if (log.length) e1.lockLog = log.sort((a, b) => a.at - b.at);
        }
        if (proj.secret && !ex.secret) ex.secret = proj.secret;
        Object.assign(ex.chars, Object.assign({}, proj.chars, ex.chars)); Object.assign(ex.locs, Object.assign({}, proj.locs, ex.locs));
        toast('Проект обновлён: добавлено ' + added + ' комментариев, ответов и драфтов' + (replaced ? '; текст серий (' + replaced + ') заменён более новым из файла, прежний сохранён в драфтах' : ''));
        openProject(ex.id);
      } else { S.db.projects.push(proj); S.db.currentEpId = null; openProject(proj.id); toast('Проект «' + proj.name + '» открыт'); }
      persist();
    }).catch((err) => toast('Не удалось открыть файл: ' + err.message));
  }

  // ---------- export ----------
  $('#btnExport').onclick = (e) => { e.stopPropagation(); const show = $('#exportMenu').hidden; closeMenus(); $('#exportMenu').hidden = !show; if (show) clampMenu($('#exportMenu')); };
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
      if (k === 'fountain') saveFile(fileBase() + '.txt', C.exportFountain(S.ep, P(), S.st), 'text/plain');
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
    // the newest draft the team named, not an automatic «Авто: перед восстановлением…» copy
    const named = drafts.filter((d) => !/^Авто:/.test(d.name)).sort((a, b) => b.date - a.date);
    const label = named.length ? named[0].name : 'Рабочий драфт';
    modal('<h2>PDF в формате Final Draft</h2><div class="form-grid"><label>Для кого (имя или почта)<input type="text" id="pdfTo" value="' + esc(S.me.name) + '"></label><label>Название драфта на титуле<input type="text" id="pdfLabel" value="' + esc(label) + '"></label></div>' +
      '<label class="row"><input type="checkbox" id="pdfWm" checked' + (S.me.role === 'reader' ? ' disabled' : '') + '> Водяной знак с именем получателя на каждой странице</label>' +
      (S.ep.revLevel ? '<label class="row"><input type="checkbox" id="pdfChanged"> Только изменённые страницы</label><p class="note">Страницы с пометками ревизии «' + esc(C.revName(S.ep.revLevel)) + '» и титул; номера страниц прежние. Так рассылают замену страниц группе.</p>' : '') +
      (sec.org ? '<p class="note">Гриф: «Коммерческая тайна. ' + esc(sec.org) + (sec.addr ? ', ' + esc(sec.addr) : '') + '».</p>' : '<p class="note">Гриф коммерческой тайны не задан: заполните обладателя в «Настройках», иначе колонтитул будет без него.</p>') +
      '<div class="actions"><button class="btn" id="pdfC">Отмена</button><button class="btn primary" id="pdfOk">Сохранить PDF</button></div>', (m) => {
      $('#pdfC', m).onclick = closeModal;
      $('#pdfOk', m).onclick = () => { const o = { to: $('#pdfTo', m).value.trim() || S.me.name, label: $('#pdfLabel', m).value.trim(), wm: $('#pdfWm', m).checked, changedOnly: !!($('#pdfChanged', m) || {}).checked }; closeModal(); exportPDF(o).catch((err) => toast('Экспорт не удался: ' + err.message)); };
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
    // revisions: a band in the revision colour at the top of a revised page (coloured paper), the set's name and date
    const revs = S.st.revs || [], revOf = (lv) => (S.ep.revisions || []).find((r) => r.level === lv);
    const revTitle = (lv) => C.revName(lv) + ' ревизия — ' + new Date((revOf(lv) || {}).date || Date.now()).toLocaleDateString('ru-RU');
    const band = (lv) => {
      const h = C.revColor(lv), c = [1, 3, 5].map((j) => Math.round(255 - (255 - parseInt(h.substr(j, 2), 16)) * 0.35));
      doc.setFillColor(c[0], c[1], c[2]); doc.rect(0, 0, W, 0.14 * 72, 'F');
    };
    if (S.ep.revLevel) { band(S.ep.revLevel); doc.text(revTitle(S.ep.revLevel), W - paper.right * 72, bottom - 48, { align: 'right' }); }
    stamp();
    const lay = S.st.lay;
    const sceneN = {}; S.st.scenes.forEach((s) => { sceneN[s.from] = s.num; });
    const pageRev = lay.pages.map((pg) => Math.max(0, ...pg.items.map((it) => revs[it.i] || 0)));
    const markX = C.revMarkX(paper) * 72;
    const printed = lay.pages.map((pg, k) => k).filter((k) => !opts.changedOnly || lay.pages[k].items.some((it) => revs[it.i] === S.ep.revLevel));
    if (opts.changedOnly && !printed.length) { toast('В ревизии «' + C.revName(S.ep.revLevel) + '» пока нет изменённых страниц'); return; }
    printed.forEach((k) => {
      const pg = lay.pages[k];
      doc.addPage([W, H]);
      // locked pages print their own labels (12A): the page number never shifts between the copies sent out
      if (k > 0) doc.text((lay.labels[k] || k + 1) + '.', (paper.w - paper.right) * 72, 0.5 * 72 + 9, { align: 'right' });
      if (pageRev[k]) { band(pageRev[k]); doc.text(revTitle(pageRev[k]), (paper.w - paper.right - 0.75) * 72, 0.5 * 72 + 9, { align: 'right' }); }
      let line = 0;
      const base = paper.top * 72 + 9.6;
      for (const it of pg.items) {
        line += it.sb;
        const f = F[it.t] || F.action;
        it.lines.forEach((tx, j) => {
          const y = base + (line + j) * 12;
          if (f.right) doc.text(tx, C.rightEdge(f, paper) * 72, y, { align: 'right' });
          else doc.text(tx, f.indent * 72, y);
          if (revs[it.i] && !it.contd) doc.text('*', markX, y);
          if (j === 0 && it.t === 'scene' && sceneN[it.i] && !it.contd) { doc.text(String(sceneN[it.i]), (paper.left - 0.75) * 72, y); doc.text(String(sceneN[it.i]), Math.min(paper.w - paper.right + 0.3, paper.w - 0.35) * 72, y, { align: 'right' }); }
        });
        line += it.lines.length;
        if (it.more) { doc.text('(ДАЛЬШЕ)', F.character.indent * 72, base + line * 12); line++; }
      }
      stamp();
    });
    const blob = doc.output('blob');
    await saveFile(fileBase() + (opts.changedOnly ? ' — изменённые страницы' : '') + (opts.to && opts.to !== S.me.name ? ' — ' + opts.to.replace(/[\\/:*?"<>|«»@]/g, '_') : '') + '.pdf', blob, 'application/pdf');
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
    const sts = eps.map((e) => (e === S.ep ? S.st : C.analyzeEpisode(e, P())));
    // the same season context as the Rules tab: an object short in one episode but long enough over the season is only a warning
    const objPages = {};
    sts.forEach((st) => st.objects.forEach((o) => { objPages[o.name] = (objPages[o.name] || 0) + o.pages; }));
    const rows = eps.map((e, i) => { const st = sts[i]; const rr = C.evalRules(e, P(), st, { objPages }); return { e, st, fails: rr.filter((x) => x.status === 'fail').length }; });
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
    // menu and toolbar entries that change the project are hidden for a reader, so the menus only offer what works
    ['#tbImport', '#tbDraft', '#tbHistory', '#mNewEp', '#mNewSeason', '#mTrash', '#mExportFt', '#mLock', '#mPageLock', '#mRenum', '#mUndo', '#mRedo', '#tbUndo', '#tbRedo'].forEach((q) => { const x = $(q); if (x) x.hidden = reader; });
    $$('[data-type]').forEach((b) => { b.disabled = ro; });
    $$('[data-paper]').forEach((b) => { b.disabled = reader; });
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
    // columns are exactly the characters pagination wraps at: in ch, since Courier's advance (0.60009 em) makes
    // 60 characters a fraction of a pixel wider than 6in and a full line would wrap on screen only
    st.setProperty('--tx-w', F.action.width + 'ch');
    st.setProperty('--rev-x', C.revMarkX(paper) + 'in');
    for (const [t, k] of [['character', 'char'], ['paren', 'paren'], ['dialogue', 'dial'], ['transition', 'tr']]) {
      st.setProperty('--in-' + k, (F[t].indent - paper.left) + 'in');
      // a right-aligned transition ends at its edge (Final Draft 7.10 in) or flush with the right margin, as on paper
      st.setProperty('--w-' + k, F[t].right ? 'calc(' + (C.rightEdge(F[t], paper) - F[t].indent) + 'in + 1px)' : F[t].width + 'ch');
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
    if (!on) { delete pg.dataset.wm; pg.style.removeProperty('--wm-img'); return; }
    // tiled over the whole sheet, so any screenshot of any part of the text carries the name
    const txt = S.me.name + ' · ' + new Date().toLocaleDateString('ru-RU');
    pg.dataset.wm = txt;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="300"><text x="230" y="160" text-anchor="middle" transform="rotate(-32 230 150)" font-family="Courier New, monospace" font-size="26" fill="#808080" fill-opacity="0.16">' + esc(txt) + '</text></svg>';
    pg.style.setProperty('--wm-img', 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")');
  }
  $('#elemSelect').onchange = (e) => { const el = ed.querySelector('.b.cur') || curBlockEl(); if (el) { setType(el, e.target.value); setCaret(el.dataset.id, el.textContent.length); } };
  $('#btnFocus').onclick = () => { document.body.classList.toggle('focus'); document.body.classList.remove('show-left', 'show-right'); syncViewMenu(); setTimeout(fitPage, 30); };

  // narrow screens: a button to open the production panel
  const panelBtn = document.createElement('button'); panelBtn.className = 'tb'; panelBtn.id = 'btnPanel'; panelBtn.textContent = 'Панель';
  panelBtn.onclick = () => { document.body.classList.toggle('show-right'); syncViewMenu(); };
  $('.tb-group').appendChild(panelBtn);

  // ---------- classic chrome: menu bar, toolbar, status bar ----------
  // Menus open on click and switch on hover while one is open, like a desktop application.
  const menus = $$('.mb');
  const closeMenus = () => menus.forEach((m) => { m.classList.remove('open'); $('.mm', m).hidden = true; });
  // a dropdown is shifted back inside the window when its button sits near the right edge (phones, wrapped menubar)
  function clampMenu(mm) {
    mm.style.transform = ''; mm.style.maxHeight = ''; mm.style.overflowY = '';
    const r = mm.getBoundingClientRect(), W = document.documentElement.clientWidth;
    const dx = r.left < 4 ? 4 - r.left : r.right > W - 4 ? Math.max(4 - r.left, W - 4 - r.right) : 0;
    if (dx) mm.style.transform = 'translateX(' + Math.round(dx) + 'px)';
    if (r.bottom > innerHeight - 4) { mm.style.maxHeight = Math.max(120, innerHeight - 4 - r.top) + 'px'; mm.style.overflowY = 'auto'; }
  }
  const openMenu = (m) => { closeMenus(); $('#exportMenu').hidden = true; m.classList.add('open'); $('.mm', m).hidden = false; syncViewMenu(); clampMenu($('.mm', m)); };
  menus.forEach((m) => {
    const btn = $('.mb-btn', m);
    btn.onclick = (e) => { e.stopPropagation(); if (m.classList.contains('open')) closeMenus(); else openMenu(m); };
    btn.onmouseenter = () => { if (menus.some((x) => x.classList.contains('open')) && !m.classList.contains('open')) openMenu(m); };
    $('.mm', m).addEventListener('click', (e) => { if (e.target.closest('button')) setTimeout(leaveMenus, 0); e.stopPropagation(); });
  });
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); $('#exportMenu').hidden = true; } });
  // keyboard: F10 or a lone Alt puts focus on the menubar, arrows walk menus and items, Enter runs, Escape returns to the text
  let menuReturn = null, altAlone = false;
  const mbBtns = () => menus.map((m) => $('.mb-btn', m));
  const mmItems = (m) => $$('.mm button', m).filter((b) => !b.disabled && b.offsetParent);
  const enterMenubar = () => {
    const a = document.activeElement, sel = window.getSelection();
    menuReturn = { el: a && a !== document.body ? a : ed, range: sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null };
    mbBtns()[0].focus();
  };
  const leaveMenus = () => {
    closeMenus();
    if (!menuReturn || !$('#menubar').contains(document.activeElement)) { menuReturn = null; return; }
    const { el, range } = menuReturn; menuReturn = null;
    if (!document.contains(el)) return;
    el.focus({ preventScroll: true });
    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  };
  const openAndFocus = (m, last) => { openMenu(m); const it = mmItems(m); if (it.length) it[last ? it.length - 1 : 0].focus(); };
  $('#menubar').addEventListener('keydown', (e) => {
    const open = menus.find((x) => x.classList.contains('open'));
    const m = open || menus.find((x) => x.contains(document.activeElement)); if (!m || e.ctrlKey || e.metaKey || e.altKey) return;
    const j = menus.indexOf(m), onBtn = document.activeElement === $('.mb-btn', m);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); const n = menus[(j + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length];
      if (open) openAndFocus(n); else $('.mb-btn', n).focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const up = e.key === 'ArrowUp';
      if (!open || onBtn) { openAndFocus(m, up); return; }
      const it = mmItems(m), i = it.indexOf(document.activeElement);
      if (it.length) it[(i + (up ? -1 : 1) + it.length) % it.length].focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && onBtn) { e.preventDefault(); openAndFocus(m); }
    else if (e.key === 'Escape') { e.preventDefault(); if (open && !onBtn) { closeMenus(); $('.mb-btn', m).focus(); } else leaveMenus(); }
  });
  document.addEventListener('keydown', (e) => {
    // capture phase: editor handlers that stop a key must still cancel the lone-Alt gesture (Alt+Shift switches the layout)
    altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); if ($('#menubar').contains(document.activeElement)) leaveMenus(); else if ($('#modalBack').hidden) enterMenubar(); }
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt' || !altAlone) return; altAlone = false; e.preventDefault();
    if ($('#menubar').contains(document.activeElement)) leaveMenus(); else if ($('#modalBack').hidden) enterMenubar();
  });
  document.addEventListener('mousedown', () => { altAlone = false; menuReturn = null; });
  window.addEventListener('blur', () => { altAlone = false; });
  // toolbar buttons repeat the most used menu commands
  const same = (from, to) => { $(from).onclick = () => $(to).click(); };
  same('#tbUndo', '#mUndo'); same('#tbRedo', '#mRedo'); same('#tbComment', '#btnComment'); same('#tbDraft', '#btnDraft'); same('#tbHistory', '#btnHistory'); same('#tbImport', '#btnImport');
  $('#mUndo').onclick = () => { undo(); ed.focus(); };
  $('#mRedo').onclick = () => { redo(); ed.focus(); };
  $('#mFind').onclick = () => toast('Поиск по странице: Ctrl+F в браузере');
  $('#mNewEp').onclick = () => $('#addEp').click();
  $('#mNewSeason').onclick = () => $('#addSeason').click();
  $('#mDrafts').onclick = () => showDrafts();
  $('#mTrash').onclick = () => readOnly('Корзина') || showTrash();
  $('#mEpisode').onclick = () => $('#renEp').click();
  $('#mProject').onclick = () => projectModal();
  $('#mTitlePage').onclick = () => $('#btnSettings').click();
  $('#mLines').onclick = () => $('#btnSettings').click();
  $('#mFont').onclick = () => $('#btnSettings').click();
  $('#mRules').onclick = () => showRight('rules');
  $('#mTiming').onclick = () => showRight('stats');
  $('#mComments').onclick = () => showRight('comments');
  $('#mChars').onclick = () => showRight('bible');
  $('#mObjects').onclick = () => showRight('objects');
  $('#mFilmtoolz').onclick = () => showRight('objects');
  $('#mScenes').onclick = () => showLeft('scenes');
  $('#mRenum').onclick = () => showLeft('scenes');
  $('#mLock').onclick = () => { showLeft('scenes'); const b = $('#lockNum') || $('#unlockNum'); if (b) b.click(); else if (!canLock()) needProducer('Залочить номера сцен'); };
  $('#mExportFt').onclick = () => $('#exportMenu [data-exp=docx]').click();
  $('#mRevisions').onclick = () => showRevisions();
  $('#mPageLock').onclick = () => { if (S.ep.pageLock) unlockPages(); else if (!readOnly('Лок страниц')) lockPages(); };
  $$('[data-type]').forEach((b) => b.onclick = () => { const el = ed.querySelector('.b.cur') || curBlockEl(); if (el) { setType(el, b.dataset.type); setCaret(el.dataset.id, el.textContent.length); } });
  $$('[data-paper]').forEach((b) => b.onclick = () => { if (readOnly('Формат листа')) return; P().rules.paper = b.dataset.paper; P().episodes.forEach((e) => delete e._st); applyPaper(); recompute(); fitPage(); persist(); syncViewMenu(); });
  const setTheme = (t) => { ls.set('draft.theme', t); applyTheme(); syncViewMenu(); };
  $('#mThemeLight').onclick = () => setTheme('light'); $('#mThemeDark').onclick = () => setTheme('dark'); $('#mThemeAuto').onclick = () => setTheme('');
  $('#mZoomIn').onclick = () => setZoom((S.zoomUser || S.zoom) * 1.15);
  $('#mZoomOut').onclick = () => setZoom((S.zoomUser || S.zoom) / 1.15);
  $('#mZoomFit').onclick = () => setZoom(null);
  function setZoom(z) { S.zoomUser = z ? Math.max(0.4, Math.min(2, z)) : null; fitPage(); }
  // panels: toggled from the toolbar, the View menu and the panel headers
  const narrow = () => window.matchMedia('(max-width: 1180px)').matches;
  const phone = () => window.matchMedia('(max-width: 760px)').matches;
  // In focus mode a panel toggle leaves focus mode and shows the panel: flipping a flag that has no visible effect would only hide the panel later.
  // Phones show both panels as drawers over the page (show-left / show-right) and do not save that state.
  function toggleLeft() {
    const b = document.body.classList, wasFocus = b.contains('focus'); b.remove('focus');
    if (phone()) b.toggle('show-left', wasFocus || !b.contains('show-left'));
    else { b.toggle('hide-left', !wasFocus && !b.contains('hide-left')); ls.set('draft.hideLeft', b.contains('hide-left')); }
    syncViewMenu(); setTimeout(fitPage, 30);
  }
  function toggleRight() {
    const b = document.body.classList, wasFocus = b.contains('focus'); b.remove('focus');
    if (narrow()) { b.toggle('show-right', wasFocus || !b.contains('show-right')); if (b.contains('show-right') && b.contains('hide-right')) { b.remove('hide-right'); ls.set('draft.hideRight', false); } }
    else { b.toggle('hide-right', !wasFocus && !b.contains('hide-right')); ls.set('draft.hideRight', b.contains('hide-right')); }
    syncViewMenu(); setTimeout(fitPage, 30);
  }
  function showLeft(tab) { document.body.classList.remove('hide-left', 'focus'); ls.set('draft.hideLeft', false); if (phone()) document.body.classList.add('show-left'); $$('[data-ltab]').find((b) => b.dataset.ltab === tab).click(); syncViewMenu(); }
  // on a phone the Navigator drawer covers the page, so picking an episode or a scene closes it
  $('#leftPanel').addEventListener('click', (e) => { if (phone() && e.target.closest('.ep, .sc, li[data-scene]')) { document.body.classList.remove('show-left'); syncViewMenu(); } });
  function showRight(tab) { document.body.classList.remove('hide-right', 'focus'); ls.set('draft.hideRight', false); if (narrow()) document.body.classList.add('show-right'); $$('[data-rtab]').find((b) => b.dataset.rtab === tab).click(); syncViewMenu(); }
  $('#tbNav').onclick = toggleLeft; $('#mLeft').onclick = toggleLeft; $('#closeLeft').onclick = toggleLeft;
  $('#tbProd').onclick = toggleRight; $('#mRight').onclick = toggleRight; $('#closeRight').onclick = toggleRight;
  function syncViewMenu() {
    const b = document.body.classList;
    // the marks follow what is on screen: drawers count only while open
    const leftOn = !b.contains('focus') && (phone() ? b.contains('show-left') : !b.contains('hide-left'));
    const rightOn = !b.contains('focus') && !b.contains('hide-right') && (!narrow() || b.contains('show-right'));
    $('#mLeft').classList.toggle('on', leftOn); $('#tbNav').classList.toggle('on', leftOn);
    $('#mRight').classList.toggle('on', rightOn); $('#tbProd').classList.toggle('on', rightOn);
    const th = ls.get('draft.theme', '');
    $('#mThemeLight').classList.toggle('on', th === 'light'); $('#mThemeDark').classList.toggle('on', th === 'dark'); $('#mThemeAuto').classList.toggle('on', !th);
    $$('[data-paper]').forEach((x) => x.classList.toggle('on', x.dataset.paper === (P() && P().rules.paper)));
    $('#mLock').textContent = S.ep && S.ep.lock ? 'Снять лок номеров сцен…' : 'Залочить номера сцен…';
    $('#mPageLock').textContent = S.ep && S.ep.pageLock ? 'Снять лок страниц…' : 'Залочить страницы';
  }
  if (ls.get('draft.hideLeft', false)) document.body.classList.add('hide-left');
  if (ls.get('draft.hideRight', false)) document.body.classList.add('hide-right');
  // status bar hint: what Enter and Tab do in the current element (Final Draft shows the same in its status bar)
  const HINTS = {
    scene: '<b>Enter</b> → описание · <b>Tab</b> → описание · заголовок: ИНТ./НАТ./ПАВ. ОБЪЕКТ - ВРЕМЯ',
    action: '<b>Enter</b> → новое описание · <b>Tab</b> → персонаж',
    character: '<b>Enter</b> → реплика · <b>Tab</b> (пустой) → переход · имя подставляется по первым буквам',
    paren: '<b>Enter</b> → реплика · ремарка в скобках',
    dialogue: '<b>Enter</b> → описание · <b>Tab</b> → ремарка · <b>Ctrl+3</b> → персонаж',
    transition: '<b>Enter</b> → сцена · <b>Tab</b> (пустой) → описание',
  };
  function renderHint() {
    const el = ed.querySelector('.b.cur') || curBlockEl();
    const t = el ? el.dataset.t : '';
    $('#hint').innerHTML = !canEdit() ? 'Только чтение' : (HINTS[t] || '<b>Tab</b> и <b>Enter</b> переключают элементы · <b>Ctrl+1…6</b> задают тип');
  }
  document.addEventListener('selectionchange', debounce(renderHint, 80));
  // Help menu
  const KEYS_HTML = '<div class="tbl-wrap"><table class="t"><tbody>' + [['Enter', 'Следующий элемент (описание → описание, персонаж → реплика, реплика → описание)'], ['Tab', 'Описание → персонаж, реплика → ремарка, пустой персонаж → переход'], ['Shift+Tab', 'Предыдущий тип элемента'], ['Ctrl+1 … Ctrl+6', 'Сцена, описание, персонаж, ремарка, реплика, переход'], ['Ctrl+Z / Ctrl+Y', 'Отменить / повторить'], ['Ctrl+Alt+M', 'Комментарий к выделенному'], ['Ctrl+S', 'Сохранить на этом компьютере (сохраняется и само)'], ['Esc', 'Закрыть окно или меню']].map((r) => '<tr><td class="n">' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</tbody></table></div>';
  function showStart() {
    modal('<h2>Начало работы</h2><p>«Драфт» — сценарный редактор в формате Final Draft. Страница на экране совпадает со страницей на бумаге: одна страница ≈ одна минута экрана.</p>' +
      '<ol class="start"><li><b>Пишите, не отвлекаясь на формат.</b> Начните заголовок с ИНТ., НАТ. или ПАВ. — он станет сценой. <b>Enter</b> и <b>Tab</b> переключают элементы, тип всегда виден в левом верхнем углу.</li>' +
      '<li><b>Имена подставляются сами.</b> Начните печатать персонажа или объект — список появится по первым буквам.</li>' +
      '<li><b>Ничего не теряется.</b> Текст сохраняется сам, каждые 15 минут делается снимок (Файл → История), крупные версии фиксируйте кнопкой «Сохранить драфт».</li>' +
      '<li><b>Навигатор слева</b> — серии и сцены; <b>Производство справа</b> — хронометраж, павильон, проверка по параметрам студии, замечания, персонажи, объекты.</li>' +
      '<li><b>Экспорт</b> — PDF в формате Final Draft, .fdx и Word для FilmToolz. У каждого PDF именной водяной знак.</li></ol>' +
      KEYS_HTML + '<div class="actions"><button class="btn primary" id="stGo">Начать</button></div>', (m) => { $('#stGo', m).onclick = () => { ls.set('draft.started', true); closeModal(); ed.focus(); }; });
  }
  $('#mStart').onclick = showStart;
  $('#mKeys').onclick = () => modal('<h2>Клавиши</h2>' + KEYS_HTML + '<div class="actions"><button class="btn primary" id="kC">Закрыть</button></div>', (m) => { $('#kC', m).onclick = closeModal; });
  $('#mFormatHelp').onclick = () => modal('<h2>Формат сценария</h2><p class="note">Страница: Courier 12, 54 строки (Letter, как в Final Draft) или 58 строк (A4). Поля 1,5" слева и 1" с остальных сторон. Персонаж от 3,5", ремарка от 3,0", реплика от 2,5" шириной 3,5", переход от 5,5" до 7,1" (вправо). Русская «американка» на A4: поля 3,75 / 1,25 / 2,5 / 2,5 см, персонаж 6,75 см от поля, реплика 3,75 / 3,75 см, ремарка 5,5 / 4,5 см. Шаблон листа выбирается в меню Формат.</p>' +
    '<p class="note">Заголовок сцены: ИНТ./НАТ./ПАВ. ОБЪЕКТ. ПОДОБЪЕКТ - ВРЕМЯ (ДЕНЬ, НОЧЬ, УТРО, ВЕЧЕР, РЕЖИМ). Номера сцен ставятся в сценарии автоматически; перед производством продюсер или редактор лочит номера, после чего вставка даёт 12A, а удаление оставляет «УДАЛЕНА».</p><div class="actions"><button class="btn primary" id="fhC">Закрыть</button></div>', (m) => { $('#fhC', m).onclick = closeModal; });
  $('#mAbout').onclick = () => modal('<h2>Драфт</h2><p class="note">Русскоязычный сценарный редактор в формате Final Draft: точная страница, нумерация и ревизии как в производстве, экспорт в FilmToolz, продюсерские замечания, история изменений и защита текста.</p><div class="actions"><button class="btn primary" id="abC">Закрыть</button></div>', (m) => { $('#abC', m).onclick = closeModal; });
  // global shortcuts that work outside the editor too
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'p' || e.key === 'з')) { e.preventDefault(); $('#exportMenu [data-exp=pdf]').click(); }
    if (mod && e.shiftKey && (e.key === 'S' || e.key === 'Ы' || e.key === 's' || e.key === 'ы')) { e.preventDefault(); $('#btnDraft').click(); }
    // Ctrl+S saves wherever the focus is (the editor's keydown bubbles here too), so the browser's «Save page as» never opens
    if (mod && !e.shiftKey && !e.altKey && S.db && (e.code === 'KeyS' && !/^[a-z]$/i.test(e.key) || /^[sы]$/i.test(e.key))) { e.preventDefault(); recompute(); persist.cancel(); DB.put('db', S.db).then((ok) => toast(saved(ok) ? 'Сохранено на этом компьютере' : TAB.stale ? 'Не сохранено: Драфт изменён в другой вкладке. Обновите страницу.' : 'Не удалось сохранить в браузере. Сохраните файл проекта: «Экспорт → Файл проекта».')); }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); $('#mZoomIn').click(); }
    if (mod && e.key === '-') { e.preventDefault(); $('#mZoomOut').click(); }
    if (mod && e.key === '0') { e.preventDefault(); setZoom(null); }
  });

  // ---------- boot ----------
  async function boot() {
    applyTheme();
    // the revision is read before the project: a write in between makes this tab stale, never the other one
    const rev = (await DB.get('rev')) || { n: 0 };
    TAB.rev = TAB.last = rev.n || 0; TAB.savedAt = Date.now();
    let db = await DB.get('db');
    if (!db || !db.projects || !db.projects.length) {
      const p = C.demoProject();
      db = { projects: [p], currentProjectId: p.id, currentEpId: p.episodes[0].id };
    }
    // drop analysis caches stored by older versions: they may predate the episode's last edits
    db.projects.forEach((p) => (p.episodes || []).forEach((e) => delete e._st));
    S.db = db;
    const rescue = await DB.get('rescue');
    let aside = !!rescue;
    try { aside = aside || localStorage.getItem('draft.pending') != null || Object.keys(localStorage).some((k) => k.startsWith('draft.rescue.')); } catch (e) { /* storage blocked */ }
    if (aside) {
      const n = restoreAside(db, rev, rescue);
      // the copies set aside are dropped only once the project that took them in is stored
      if (await DB.put('db', db)) {
        try { Object.keys(localStorage).filter((k) => k === 'draft.pending' || k.startsWith('draft.rescue.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
        if (rescue) await DB.del('rescue');
      }
      if (n) setTimeout(() => toast('Восстановлен несохранённый текст из другой вкладки: ' + n + ' — смотрите драфты и замечания серий.'), 800);
    }
    await trashLoad();
    applyFont();
    openProject(db.currentProjectId);
    renderRight();
    fitPage();
    syncViewMenu(); renderHint();
    if (!ls.get('draft.started', false)) showStart();
  }
  // the sheet keeps its real 8.5in geometry and is scaled to fit narrow windows
  S.zoom = 1;
  const pagePx = () => Math.round(C.paperOf(P().rules).w * 96);
  function fitPage() {
    const w = $('#desk').clientWidth - 24;
    const z = S.zoomUser || Math.max(0.4, Math.min(1, w / pagePx()));
    S.zoom = z;
    $('#page').style.transform = z === 1 ? '' : 'scale(' + z + ')';
    sizePage();
    renderComments();
  }
  function sizePage() {
    const z = S.zoom || 1;
    $('#pageWrap').style.width = (pagePx() * z) + 'px';
    $('#pageWrap').style.height = z === 1 ? '' : (($('#page').offsetHeight + 22) * z) + 'px';
    renderRuler2();
  }
  // inch ruler above the sheet, like the one in Final Draft: the shaded part is the text area
  function renderRuler2() {
    const paper = C.paperOf(P().rules);
    const r = $('#pageRuler');
    const z = S.zoom || 1;
    r.style.width = pagePx() + 'px'; r.style.transform = z === 1 ? '' : 'scale(' + z + ')';
    let html = '<span class="tx" style="left:' + (paper.left * 96) + 'px;width:' + ((paper.w - paper.left - paper.right) * 96) + 'px"></span>';
    for (let q = 0; q <= paper.w * 4; q++) {
      const x = q * 24;
      html += '<i class="' + (q % 4 === 0 ? 'big' : '') + '" style="left:' + x + 'px"></i>';
      if (q % 4 === 0 && q) html += '<b style="left:' + x + 'px">' + (q / 4) + '</b>';
    }
    r.innerHTML = html;
  }
  window.addEventListener('resize', debounce(fitPage, 150));
  window.addEventListener('resize', debounce(syncViewMenu, 150));
  $('#btnFocus').addEventListener('click', () => setTimeout(fitPage, 50));
  boot();
  window.__draft = { S, C, recompute, readBlocks, histAdd, histLoad, showHistory, showTrash, autoSnap, lockNumbers, omitScene, restoreScene, restoreMissing, exportPDF, applyRole, applyPaper, renderScenes, showRevisions, startRevision, lockPages, unlockPages, undo, redo };
})();
