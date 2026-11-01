/* Драфт: model, Final Draft page layout, analysis and production rules. No DOM here, so it runs in node tests too. */
(function (root) {
  'use strict';

  // the order is the shortcut: Ctrl+1 … Ctrl+7 (Final Draft's Shot comes last, so Ctrl+1…6 stay as they were)
  const TYPES = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'shot'];
  const TYPE_LABEL = { scene: 'Сцена', action: 'Описание', character: 'Персонаж', paren: 'Ремарка', dialogue: 'Реплика', transition: 'Переход', shot: 'Кадр' };

  // Final Draft default screenplay geometry, as in the ElementSettings of FDX files saved by Final Draft 11/13.
  // Indent: inches from the left edge of the sheet; width: characters (Courier 12 = 10 characters per inch);
  // sb: blank lines before the element; edge: where a right-aligned element ends.
  const FMT = {
    scene:      { indent: 1.5, width: 60, sb: 2 },
    action:     { indent: 1.5, width: 60, sb: 1 },
    character:  { indent: 3.5, width: 37.5, sb: 1 },
    paren:      { indent: 3.0, width: 25, sb: 0 },
    dialogue:   { indent: 2.5, width: 35, sb: 0 },
    transition: { indent: 5.5, width: 16, sb: 1, right: true, edge: 7.1 },
    // Final Draft Shot («КРУПНО — ЛИЦО ИВАНА»): the action column, in capitals, one blank line before
    shot:       { indent: 1.5, width: 60, sb: 1 },
  };
  // Russian «американка» (screenwriter.ru): A4, margins top/bottom 2.5 cm, left 3.75 cm, right 1.25 cm (text 16 cm = 63 chars);
  // character 6.75 cm from the left margin, dialogue 3.75/3.75 cm, parenthetical 5.5/4.5 cm.
  const cm = (x) => x / 2.54;
  const FMT_RU = {
    scene:      { indent: cm(3.75), width: 63, sb: 2 },
    action:     { indent: cm(3.75), width: 63, sb: 1 },
    character:  { indent: cm(3.75 + 6.75), width: 36, sb: 1 },
    paren:      { indent: cm(3.75 + 5.5), width: 23, sb: 0 },
    dialogue:   { indent: cm(3.75 + 3.75), width: 33, sb: 0 },
    transition: { indent: cm(3.75 + 10), width: 23, sb: 1, right: true },
    shot:       { indent: cm(3.75), width: 63, sb: 1 },
  };
  // Dual dialogue (Final Draft Format → Dual Dialogue): two speeches side by side, each in half of the action column.
  // In a column the dialogue starts at the column's edge, the parenthetical 0.5 in and the cue 1.0 in into it; on Letter
  // that is dialogue 1.50 in / 4.50 in, 2.7 in wide, as Final Draft lays out the pair.
  const DUAL_CACHE = new Map();
  function dualFmt(F) {
    F = F || FMT;
    if (DUAL_CACHE.has(F)) return DUAL_CACHE.get(F);
    const col = F.action.width / 2;
    const out = [0, 1].map((k) => {
      const o = F.action.indent + k * col / 10;
      return {
        character: { indent: o + 1.0, width: col - 12, sb: F.character.sb },
        paren: { indent: o + 0.5, width: col - 10, sb: 0 },
        dialogue: { indent: o, width: col - 3, sb: 0 },
      };
    });
    DUAL_CACHE.set(F, out);
    return out;
  }
  // pairs of speeches printed side by side: the second cue carries dual; the first speech is the one right before it
  // (cue, then only parentheticals and dialogue). a: first cue, b: the dual cue, e: the last element of the second speech
  function dualPairs(blocks) {
    const out = [];
    let cue = -1;
    for (let i = 0; i < (blocks || []).length; i++) {
      const b = blocks[i];
      if (b.t === 'character') {
        // three at once is not a thing in Final Draft: a speech already on the right never starts another pair
        if (b.dual && cue >= 0 && !(out.length && out[out.length - 1].b === cue)) out.push({ a: cue, b: i, e: i });
        cue = i;
      } else if (b.t === 'paren' || b.t === 'dialogue') { if (out.length && out[out.length - 1].b === cue) out[out.length - 1].e = i; }
      else cue = -1;
    }
    return out;
  }
  // page templates: lines = text lines per page at 6 lines per inch; margins in inches
  const PAPER = {
    letter: { name: 'Letter (Final Draft)', w: 8.5, h: 11, lines: 54, fmt: FMT, top: 1, bottom: 1, left: 1.5, right: 1 },
    // Final Draft's A4 keeps the Letter text column (6 in from 1.5 in), so the right margin is what is left of the sheet
    a4: { name: 'A4 (Final Draft)', w: 8.27, h: 11.69, lines: 58, fmt: FMT, top: 1, bottom: 1, left: 1.5, right: 0.77 },
    a4ru: { name: 'A4 «американка»', w: 8.27, h: 11.69, lines: 58, fmt: FMT_RU, top: cm(2.5), bottom: cm(2.5), left: cm(3.75), right: cm(1.25) },
  };
  const paperOf = (rules) => PAPER[(rules || {}).paper] || PAPER.letter;

  const TIMES = ['ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР', 'РЕЖИМ', 'РАССВЕТ', 'ЗАКАТ', 'СУМЕРКИ'];
  const PREFIXES = ['ИНТ.', 'НАТ.', 'ПАВ.', 'ИНТ./НАТ.'];
  const TRANSITIONS = ['СМЕНА КАДРА:', 'ЗАТЕМНЕНИЕ.', 'ИЗ ЗАТЕМНЕНИЯ:', 'НАПЛЫВ:', 'ВСТАВКА:', 'КОНЕЦ ВОСПОМИНАНИЯ.', 'ТИТР:'];
  const EXTENSIONS = ['(ЗК)', '(ПРОД.)', '(ПО ТЕЛЕФОНУ)', '(ТИТР)', '(В КАДРЕ)'];
  const TAGS = {
    kids: 'Дети', animals: 'Животные', stunts: 'Трюки', complex: 'Сложная постановка',
    clip: 'Клип', music: 'Музыка / трек', crowd: 'Массовка', makeup: 'Сложный грим', far: 'Выезд / удалённо', flashback: 'Флешбэк',
  };
  const SPECIAL_TAGS = ['kids', 'animals', 'stunts', 'complex'];

  const DEFAULT_RULES = {
    preset: 'Ситком 24 мин (рекомендации студии)',
    paper: 'letter',
    minPerPage: 1.0,
    maxPages: 24,
    scenesPerPage: 1,
    shortSceneSec: 20,
    maxShortScenes: 2,
    mainShareMin: 70,
    mainShiftShareMin: 60,
    baseObjectsMax: 3,
    newObjectMinPages: 7,
    nightMaxPct: 10,
    extMaxPct: 30,
    maxCharsPerEpisode: 20,
    bigCast: 5,
    bigCastMaxScenes: 3,
    ensembleMinSec: 30,
    specialMaxPct: 15,
    ratePav: 9,
    rateInt: 7.5,
    rateExt: 7,
    specialFactor: 2.5,
    lineTolerance: 5,
  };
  const MANUAL_CHECKS = [
    'Учтена удалённость локаций от города (особенно разовые выезды)',
    'Внутри сцен нет избыточной многокадровой разработки и сложного «балета»',
    'Интерьеры подходят для контроля света (без панорамных окон)',
    'Для натуры продуманы бэкап-локации по погоде',
    'Массовые сцены заранее оговорены с производством',
    'Музыкальные сцены и треки проверены на бюджет и права',
  ];

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const up = (s) => (s || '').toLocaleUpperCase('ru-RU');
  const clean = (s) => (s || '').replace(/[ \t]/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // ---------- scene headings ----------
  const PREFIX_RE = /^\s*(?:((?:\d+-)?[A-ZА-Я]?\d+[\-–.\d]*[А-ЯA-Z]?)[.)]?\s+)?(ИНТ\.?\s*\/\s*НАТ\.?|НАТ\.?\s*\/\s*ИНТ\.?|ИНТ\.|НАТ\.|ПАВ\.|ИНТ(?=\s)|НАТ(?=\s)|ПАВ(?=\s)|INT\.|EXT\.|INT\.?\/EXT\.?|I\/E\.?)\s*/i;
  const TIME_RE = new RegExp('(?:\\s*[-–—]\\s*|\\s+|^)(РАННЕЕ УТРО|ПОЗДНИЙ ВЕЧЕР|' + TIMES.join('|') + ')\\.?(?:\\s*(?:Д\\.?\\s*|ДЕНЬ\\s*)?(\\d{1,3})\\.?)?\\s*$', 'i');

  function prefixType(p) {
    const s = up(p).replace(/\s/g, '');
    if (/ПАВ/.test(s)) return 'pav';
    if (/(ИНТ.*НАТ|НАТ.*ИНТ|INT.*EXT|I\/E)/.test(s)) return 'intext';
    if (/НАТ|EXT/.test(s)) return 'ext';
    return 'int';
  }
  const TYPE_PREFIX = { int: 'ИНТ.', ext: 'НАТ.', intext: 'ИНТ./НАТ.', pav: 'ПАВ.' };

  // scene numbers: 12, 12А, 1-12, 51-12А and the letter-first A1, B1 that lockAssign gives scenes before the first locked one
  const NUM_RE = /^\s*((?:\d+-)?[A-ZА-Я]?\d+[\-–.\d]*[А-ЯA-Z]?)[.)]\s+/;
  const FLASH_RE = /^\s*(ФЛЕШБЭК|ФЛЭШБЭК|ФЛЕШБЕК|ВОСПОМИНАНИЕ|ФЛЕШФОРВАРД|СОН|FLASHBACK)\s*[.:\-–—]?\s*/i;
  function parseHeading(text) {
    const raw = clean(up(text));
    const res = { raw, num: '', type: null, prefix: '', object: '', sub: '', time: '', day: '', flash: '', ok: false, guessed: false };
    let rest = raw;
    const n = rest.match(NUM_RE);
    if (n) { res.num = n[1]; rest = rest.slice(n[0].length); }
    const f = rest.match(FLASH_RE);
    if (f) { res.flash = up(f[1]); rest = rest.slice(f[0].length); }
    const m = rest.match(PREFIX_RE);
    if (m) {
      res.type = prefixType(m[2]);
      res.prefix = TYPE_PREFIX[res.type];
      rest = rest.slice(m[0].length);
      res.ok = true;
    }
    const t = rest.match(TIME_RE);
    if (t && t.index > 0) {
      res.time = up(t[1]);
      res.day = t[2] || '';
      rest = rest.slice(0, t.index);
    } else {
      const d = rest.match(/\s[-–—]\s*([^-–—]+)$/);
      if (d) { res.time = clean(d[1]).replace(/\.$/, ''); rest = rest.slice(0, d.index); }
    }
    rest = rest.replace(/[\s\-–—.,]+$/, '').trim();
    let parts = rest.split(/\.\s+|\s+[-–—]\s+/).map(clean).filter(Boolean);
    res.object = (parts[0] || '').replace(/\.$/, '');
    res.sub = parts.slice(1).join('. ').replace(/\.$/, '');
    // "ОБЪЕКТ. ПОДОБЪЕКТ. ДЕНЬ 1" without ИНТ./НАТ./ПАВ.: a heading all the same, the type is guessed as interior
    if (!res.type && res.time && res.object) { res.type = 'int'; res.prefix = TYPE_PREFIX.int; res.ok = true; res.guessed = true; }
    return res;
  }
  function formatHeading(h) {
    if (!h.type) return h.raw;
    let s = (h.flash ? h.flash + '. ' : '') + h.prefix + ' ' + h.object;
    if (h.sub) s += '. ' + h.sub;
    if (h.time) s += ' - ' + h.time;
    return s;
  }
  const isNight = (h) => /НОЧЬ/.test(h.time || '');

  // \b is ASCII-only in JS, so the boundary around ПРОД is spelled out for Cyrillic
  function charName(text) {
    return clean(up(text).replace(/\(.*?\)/g, ' ').replace(/(^|[^А-ЯЁA-Z0-9])(ПРОД|CONT'?D)\.?(?![А-ЯЁA-Z0-9])/g, '$1')).replace(/[.:]+$/, '');
  }

  // ---------- pagination (Final Draft rules) ----------
  function wrap(text, width) {
    const lines = [];
    let cur = '';
    for (const word of clean(text).split(' ')) {
      // like Final Draft and the browser, a line may also break after a hyphen inside a word (что-|то)
      word.replace(/([^\s-]-)(?=[^\s\d-])/g, '$1\u0000').split('\u0000').forEach((part, k) => {
        let w = part;
        const sep = k ? '' : ' ';
        while (w.length > width) {
          if (cur) { lines.push(cur); cur = ''; }
          lines.push(w.slice(0, width)); w = w.slice(width);
        }
        if (!cur) cur = w;
        else if (cur.length + sep.length + w.length <= width) cur += sep + w;
        else { lines.push(cur); cur = w; }
      });
    }
    lines.push(cur);
    return lines;
  }
  function displayText(b) {
    const t = b.x || '';
    return (b.t === 'scene' || b.t === 'character' || b.t === 'transition' || b.t === 'shot') ? up(t) : t;
  }
  // a right-aligned element ends at its own edge (Final Draft transition: 7.10 in) or at the right margin
  const rightEdge = (f, paper) => f.edge || paper.w - paper.right;

  // Final Draft BreakDialogueAndActionAtSentences: break after the last sentence end that fits in `room` lines,
  // with at least 2 lines on each side; the rest is rewrapped for the next page
  function sentenceSplit(text, width, room) {
    const re = /[.!?…]+['"»”)]*\s+/g;
    let m, best = null;
    while ((m = re.exec(text))) {
      const cut = m.index + m[0].length, head = wrap(text.slice(0, cut), width);
      if (head.length > room) break;
      if (head.length >= 2 && wrap(text.slice(cut), width).length >= 2) best = { head, rest: text.slice(cut), done: text.slice(0, cut) };
    }
    return best;
  }
  // no sentence end fits and the block is taller than the page: it has to break at a line, still 2 lines on each side
  function lineSplit(lines, room) {
    const k = Math.min(room, lines.length - 2);
    return k >= 2 ? { head: lines.slice(0, k), rest: lines.slice(k).join(' '), done: lines.slice(0, k).join(' ') } : null;
  }

  // lines an item takes on its page: a dual pair counts once, on its first item, as tall as its longer column
  const itH = (it) => (it.dual ? (it.dualH != null ? it.sb + it.dualH : 0) : it.sb + it.lines.length);
  function paginate(blocks, opts) {
    const lpp = (opts && opts.lines) || 54;
    const F = (opts && opts.fmt) || FMT;
    const pages = [{ items: [] }];
    const info = blocks.map((b) => {
      const f = F[b.t] || F.action;
      const lines = wrap(displayText(b), f.width);
      return { lines, L: lines.length, sb: f.sb };
    });
    // dual dialogue: both speeches of a pair wrap in their own column and go on one page together, as tall as the longer
    // column; a pair taller than a page (never in practice) is printed one speech after the other
    const DF = dualFmt(F), pairAt = {}, duals = [];
    for (const p of dualPairs(blocks)) {
      const col = (from, to, c) => {
        let h = 0; const its = [];
        for (let q = from; q <= to; q++) { const lines = wrap(displayText(blocks[q]), DF[c][blocks[q].t].width); its.push({ q, lines, row: h, col: c }); h += lines.length; }
        return { its, h };
      };
      const L = col(p.a, p.b - 1, 0), R = col(p.b, p.e, 1), h = Math.max(L.h, R.h);
      if (h > lpp - 2) continue;
      Object.assign(p, { h, hL: L.h, hR: R.h, its: L.its.concat(R.its) });
      pairAt[p.a] = p; duals.push(p);
      for (const x of p.its) info[x.q] = { lines: x.lines, L: x.lines.length, sb: x.q === p.a ? info[x.q].sb : 0, dual: x.col };
    }
    // breaks: block i starts a page; inner: page breaks inside block i, as a line offset from its top
    const breaks = {}, inner = {};
    let used = 0;
    let lastChar = '', lastCue = '';
    // locked pages: the plan says where a locked page must start and names the pages (12, 12A…)
    const PL = pageLockPlan(blocks, opts && opts.pageLock);
    const labels = PL ? [PL.label(0)] : null;
    const items = () => pages[pages.length - 1].items;
    const newPage = (q) => { pages.push({ items: [] }); used = 0; if (PL) labels.push(PL.next(q)); };
    const put = (it) => { items().push(it); used += itH(it); };
    // the cue repeated at the top of the next page keeps its extension: ИВАН (ЗК) (ПРОД.)
    const contd = (i) => ({ i, t: 'character', lines: [lastCue + ' (ПРОД.)'], sb: 0, contd: true });
    // an «УДАЛЕНА» heading is a whole scene of its own: it stays on the page where the scene was
    const omitted = (k) => blocks[k].t === 'scene' && OMIT_RE.test(blocks[k].x || '');
    // what goes to the next page with block b: a scene heading never ends a page, a cue and parentheticals stay with
    // their dialogue, and a speech broken between its parts gets (ДАЛЬШЕ) here and the cue with (ПРОД.) there
    const carryOver = (b, i) => {
      const cur = items(), out = [];
      let u = used, speech = b.t === 'dialogue' || b.t === 'paren';
      const take = () => { const it = cur.pop(); u -= itH(it); out.unshift(it); };
      while (cur.length) {
        const it = cur[cur.length - 1];
        // a dual pair is never pulled apart; a shot, like a heading, goes with what it introduces
        if (it.dual) break;
        if ((it.t === 'scene' && !omitted(it.i)) || it.t === 'shot') { take(); speech = false; continue; }
        if (!speech) break;
        if (it.t === 'paren') take();
        else if (it.t === 'character') { take(); speech = false; }
        else if (it.t === 'dialogue' && lastCue) {
          if (u + 1 <= lpp) { it.more = lastChar; out.unshift(contd(out.length ? out[0].i : i)); break; }
          take();
        } else break;
      }
      // a page is never emptied: then the block breaks here instead
      if (!cur.length) { cur.push(...out.filter((it) => !it.contd)); return null; }
      return out;
    };
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], inf = info[i];
      if (b.t === 'character') { lastChar = charName(b.x); lastCue = clean(up(b.x).replace(/\(\s*(ПРОД|CONT'?D)\.?\s*\)/g, ' ')) || lastChar; }
      else if (b.t !== 'dialogue' && b.t !== 'paren') lastChar = lastCue = '';
      if (PL) {
        // a locked page starts where it started at the lock, however much text the page before it lost or gained:
        // the break is forced here (a heading or cue left at the bottom still goes along with its text)
        let a = PL.at.get(i);
        // a locked page that started inside a dual pair (laid out one after the other at the lock) starts with the pair
        if (pairAt[i]) for (let q = i + 1; q <= pairAt[i].e; q++) {
          const aq = PL.at.get(q);
          if (aq && aq.start != null && (!a || a.start == null || aq.start > a.start)) a = { start: aq.start, mids: ((a && a.mids) || []).concat(aq.mids) };
        }
        const force = (q) => {
          if (!items().length) { labels[labels.length - 1] = PL.next(q); return; }
          const carry = carryOver(b, i);
          newPage(q);
          if (carry && carry.length) { carry[0].sb = 0; carry.forEach(put); breaks[carry[0].i] = { page: pages.length }; } else breaks[i] = { page: pages.length };
        };
        // a page that began inside the previous block, which now ends sooner: that page starts with this block
        if (PL.mids.length) { const q = PL.mids[0]; PL.mids = []; if (!(a && a.start != null)) force(q); }
        if (a && a.start != null && a.start > PL.cur) force(a.start);
        if (a) PL.mids = a.mids.filter((q) => q > PL.cur);
      }
      const pr = pairAt[i];
      if (pr) {
        lastChar = lastCue = '';
        let sb = used === 0 ? 0 : inf.sb;
        if (sb + pr.h > lpp - used) {
          const carry = used > 0 ? carryOver(b, i) : null;
          newPage();
          if (carry && carry.length) { carry[0].sb = 0; carry.forEach(put); breaks[carry[0].i] = { page: pages.length }; } else breaks[i] = { page: pages.length };
          sb = used === 0 ? 0 : inf.sb;
        }
        pr.its.forEach((x, n) => items().push(Object.assign({ i: x.q, t: blocks[x.q].t, lines: x.lines, sb: n ? 0 : sb, dual: { col: x.col, row: x.row } }, n ? {} : { dualH: pr.h })));
        used += sb + pr.h;
        i = pr.e;
        continue;
      }
      const f = F[b.t] || F.action, nb = blocks[i + 1], next = info[i + 1];
      let sb = used === 0 ? 0 : inf.sb;
      let need = sb + inf.L;
      // keep with next: a heading takes at least 2 lines of the next element, a cue the first line of its speech,
      // a parenthetical the dialogue line after it
      if (next && ((b.t === 'scene' && !omitted(i)) || b.t === 'shot')) need += next.sb + Math.min(pairAt[i + 1] ? pairAt[i + 1].h : next.L, 2);
      if (next && b.t === 'character') need += next.sb + 1;
      if (next && b.t === 'paren' && nb.t === 'dialogue') need += 1;
      if (need <= lpp - used) { put({ i, t: b.t, lines: inf.lines, sb }); continue; }
      const splittable = b.t === 'action' || b.t === 'dialogue', dlg = b.t === 'dialogue' && !!lastCue;
      const text = displayText(b);
      let sp = splittable && used > 0 ? sentenceSplit(text, f.width, lpp - used - sb - (dlg ? 1 : 0)) : null;
      // no sentence end to break at: the block moves to the next page, unless it is taller than a page anyway
      const carry = !sp && used > 0 && !(splittable && inf.L > lpp) ? carryOver(b, i) : null;
      if (carry) {
        newPage();
        if (carry.length) { carry[0].sb = 0; carry.forEach(put); breaks[carry[0].i] = { page: pages.length }; } else breaks[i] = { page: pages.length };
        sb = used === 0 ? 0 : inf.sb;
      }
      // place the block, breaking it wherever it does not fit (at a sentence end when there is one)
      let rest = text, done = '';
      for (;;) {
        const lines = wrap(rest, f.width);
        if (sb + lines.length <= lpp - used) { put({ i, t: b.t, lines, sb }); break; }
        const room = lpp - used - sb - (dlg ? 1 : 0);
        const cut = sp || (splittable && sentenceSplit(rest, f.width, room)) || lineSplit(lines, room) ||
          { head: lines.slice(0, Math.max(1, room)), rest: lines.slice(Math.max(1, room)).join(' '), done: lines.slice(0, Math.max(1, room)).join(' ') };
        sp = null;
        put({ i, t: b.t, lines: cut.head, sb, more: dlg ? lastChar : '' });
        done += (done ? ' ' : '') + cut.done; rest = cut.rest; sb = 0;
        newPage();
        (inner[i] = inner[i] || []).push({ page: pages.length, line: wrap(done, f.width).length });
        if (dlg) put(contd(i));
      }
    }
    const last = pages[pages.length - 1];
    const lastUsed = last.items.reduce((a, it) => a + itH(it), 0);
    const total = blocks.length ? (pages.length - 1) + lastUsed / lpp : 0;
    return { pages, total, info, breaks, inner, lpp, labels: labels || pages.map((pg, k) => String(k + 1)), locked: !!PL, duals };
  }

  // ---------- locked pages (Final Draft «Lock Pages») ----------
  // The lock remembers, for every page, its label and the block it starts with (mid: the page starts inside that block),
  // and for every block the page it started on (of). Later the same blocks start the same pages; text that does not fit
  // goes to A-pages (12A, 12B…), a page that lost text stays short, and the next page keeps its number.
  function pageLockFrom(lay, blocks) {
    const of = {}, pages = [];
    lay.pages.forEach((pg, k) => {
      for (const it of pg.items) if (!it.contd && !(blocks[it.i].id in of)) of[blocks[it.i].id] = k;
      const first = pg.items.find((it) => !it.contd) || pg.items[0];
      if (!first) return;
      pages.push({ n: (lay.labels || [])[k] || String(k + 1), id: blocks[first.i].id, mid: of[blocks[first.i].id] < k });
    });
    return { pages, of };
  }
  // longest non-decreasing run of locked page numbers, so a scene moved elsewhere counts as new text there
  function lnds(a) {
    const tails = [], tailK = [], prev = [];
    a.forEach((v, k) => {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] <= v) lo = m + 1; else hi = m; }
      prev[k] = lo ? tailK[lo - 1] : -1; tails[lo] = v; tailK[lo] = k;
    });
    const keep = a.map(() => false);
    for (let k = tails.length ? tailK[tails.length - 1] : -1; k >= 0; k = prev[k]) keep[k] = true;
    return keep;
  }
  function aPageLabel(base, n) {
    const m = String(base).match(/^(.*?)([A-Z]?)$/), k = (m[2] ? LETTERS.indexOf(m[2]) + 1 : 0) + n - 1;
    return m[1] + (k < LETTERS.length ? LETTERS[k] : 'Z' + (LETTERS[k - LETTERS.length] || k));
  }
  function pageLockPlan(blocks, lock) {
    if (!lock || !lock.pages || !lock.pages.length) return null;
    const of = lock.of || {}, own = (id) => Object.prototype.hasOwnProperty.call(of, id);
    const idx = [], val = [];
    blocks.forEach((b, i) => { if (own(b.id)) { idx.push(i); val.push(of[b.id]); } });
    const keep = lnds(val), kept = new Set(), firstOf = new Map();
    idx.forEach((i, k) => { if (!keep[k]) return; kept.add(i); if (!firstOf.has(val[k])) firstOf.set(val[k], i); });
    const pos = new Map(blocks.map((b, i) => [b.id, i]));
    const at = new Map(), slot = (i) => { if (!at.has(i)) at.set(i, { start: null, mids: [] }); return at.get(i); };
    let last = -1, lastQ = -1;
    // a page whose text is all gone goes into the label of the page before it (2-3, as Final Draft numbers it), so the
    // replacement page tells the crew to take out the old page 3 too; one before the first page goes into the next one
    const gone = {}, lead = [];
    const name = (q) => String(lock.pages[q].n || q + 1);
    lock.pages.forEach((pg, q) => {
      let i = null, mid = false;
      if (pg.mid && pos.has(pg.id) && kept.has(pos.get(pg.id))) { i = pos.get(pg.id); mid = true; } else if (firstOf.has(q)) i = firstOf.get(q);
      // a page that would come before the previous one is skipped (its number is not printed)
      // (several pages may start inside one long block)
      if (i == null) { if (lastQ >= 0) (gone[lastQ] = gone[lastQ] || []).push(q); else lead.push(q); return; }
      if (i < last || (i === last && !mid)) return;
      if (mid) slot(i).mids.push(q); else slot(i).start = q;
      if (lead.length && lastQ < 0 && i === 0) { gone[q] = lead.slice(); gone[q].first = true; }
      last = i; lastQ = q;
    });
    const used = new Set(lock.pages.map((pg, q) => name(q)));
    const plan = { at, mids: [], cur: 0, aN: 0 };
    plan.label = (q) => {
      plan.cur = q; plan.aN = 0;
      const g = gone[q];
      return !g ? name(q) : g.first ? name(g[0]) + '-' + name(q) : name(q) + '-' + name(g[g.length - 1]);
    };
    plan.next = (q) => {
      if (q == null && plan.mids.length) q = plan.mids.shift();
      if (q != null) return plan.label(q);
      let s; do s = aPageLabel(name(plan.cur), ++plan.aN); while (used.has(s) && plan.aN < 200);
      return s;
    };
    return plan;
  }

  // ---------- production drafts (Final Draft revisions, numbered instead of WGA colours) ----------
  // The studio names every production revision by number: level 0 is «Драфт 1» (the text as first sent out), level n is
  // «Драфт n+1». Colours are kept only for the FDX file, where Final Draft needs one per set; the app never shows them.
  // Level 0 is the original. Every revision keeps a copy of the text at its start (base); a block differs from a
  // base when it is new there, has other text or another type, or follows text deleted since (Final Draft marks the line
  // where text was removed). A block carries the highest level it differs in, so earlier marks stay with their colour.
  const REV_SETS = [['Белая', '#8a8a8a'], ['Голубая', '#2f7fd8'], ['Розовая', '#e0569a'], ['Жёлтая', '#c9a000'], ['Зелёная', '#2e9e4f'],
    ['Золотистая', '#d08c00'], ['Бежевая', '#b08a5e'], ['Лососевая', '#f0785a'], ['Вишнёвая', '#b0223f']];
  const REV_ORD = ['', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая', 'Седьмая', 'Восьмая', 'Девятая', 'Десятая'];
  const revName = (level) => 'Драфт ' + ((level || 0) + 1);
  // the WGA colour name, only for reading old files and for the FDX set list
  function revColorName(level) {
    const name = REV_SETS[level % REV_SETS.length][0], k = Math.floor(level / REV_SETS.length);
    return k ? (REV_ORD[k] || (k + 1) + '-я') + ' ' + name.toLowerCase() : name;
  }
  const revColor = (level) => REV_SETS[level % REV_SETS.length][1];
  // the right-margin column of the marks: 7.6 in on Letter, never over the text nor off the sheet
  const revMarkX = (paper) => Math.min(paper.w - 0.3, Math.max(7.6, paper.w - paper.right + 0.1));
  // Text moved elsewhere (a scene moved up or down) is revised too: blocks outside the longest run that keeps the base
  // order are marked, as Final Draft marks cut-and-pasted text. Under a page lock (lock) a deletion is marked on the page
  // the text left: when the next surviving block starts a locked page, the block before the deleted text takes the mark.
  // A deletion right after a block already marked in that revision (an «УДАЛЕНА» heading) marks nothing more.
  function revMarks(blocks, revisions, lock) {
    const out = blocks.map(() => 0);
    const pos = new Map(blocks.map((b, i) => [b.id, i]));
    const starts = new Set(((lock && lock.pages) || []).filter((pg) => !pg.mid).map((pg) => pg.id));
    for (const r of revisions || []) {
      const lv = r.level || 0, base = r.base || [];
      if (!lv) continue;
      const was = new Map(base.map((b) => [b.id, b])), at = new Map(base.map((b, k) => [b.id, k]));
      // dual dialogue switched on or off is a change of the page too (a base taken before the flag existed has none)
      const chg = blocks.map((b) => { const o = was.get(b.id); return !o || o.t !== b.t || (o.x || '') !== (b.x || '') || !!o.dual !== !!(b.dual && b.t === 'character'); });
      const idx = [], val = [];
      blocks.forEach((b, i) => { if (at.has(b.id)) { idx.push(i); val.push(at.get(b.id)); } });
      const inOrder = lnds(val);
      idx.forEach((i, k) => { if (!inOrder[k]) chg[i] = true; });
      chg.forEach((c, i) => { if (c && lv > out[i]) out[i] = lv; });
      for (let k = 0; k < base.length; k++) {
        if (pos.has(base[k].id)) continue;
        let j = k + 1; while (j < base.length && !pos.has(base[j].id)) j++;
        const before = k > 0 ? pos.get(base[k - 1].id) : undefined, after = j < base.length ? pos.get(base[j].id) : undefined;
        k = j - 1;
        if (before != null && chg[before]) continue;
        let i = after != null ? after : blocks.length - 1;
        if (before != null && after != null && starts.has(blocks[after].id)) i = before;
        if (i >= 0 && lv > out[i]) out[i] = lv;
      }
    }
    return out;
  }
  // a fresh draft: the next level, its number name (colour only for FDX), and the text it is measured against
  function newRevision(prevLevel, blocks, by, date) {
    const level = (prevLevel || 0) + 1;
    return { level, name: revName(level), color: revColor(level), date: date || Date.now(), by: by || '', base: blocks.map((b) => (b.dual && b.t === 'character' ? { id: b.id, t: b.t, x: b.x || '', dual: true } : { id: b.id, t: b.t, x: b.x || '' })) };
  }
  // FDX import: marks read from RevisionID become revisions whose base is the text without the marks of that level and
  // above, so revMarks gives every block back exactly the level it had in Final Draft
  function revisionsFromMarks(blocks, active, date) {
    const max = Math.max(0, active || 0, ...blocks.map((b) => b.rev || 0));
    // a set Final Draft was writing in counts even before its first mark: later edits are marked in it
    if (!max) return null;
    const revisions = [];
    for (let lv = 1; lv <= max; lv++) revisions.push(newRevision(lv - 1, blocks.filter((b) => (b.rev || 0) < lv), 'Final Draft', date));
    return { revisions, revLevel: max };
  }
  // <Revisions ActiveSet=… RevisionMode=…>: the set Final Draft was writing in, when revision mode was on
  function fdxActiveSet(xml) {
    const m = String(xml).match(/<Revisions\b[^>]*>/);
    if (!m || /RevisionMode="Off"/.test(m[0])) return 0;
    const a = m[0].match(/ActiveSet="(\d+)"/);
    return a ? +a[1] : 0;
  }

  // ---------- analysis ----------
  function sceneSplit(blocks) {
    const scenes = [];
    let cur = null;
    blocks.forEach((b, i) => {
      if (b.t === 'scene') { cur = { id: b.id, idx: i, from: i, to: i, heading: b.x }; scenes.push(cur); }
      else if (cur) cur.to = i;
    });
    return scenes;
  }

  function analyzeEpisode(ep, project) {
    const rules = Object.assign({}, DEFAULT_RULES, project.rules || {});
    const paper = paperOf(rules);
    const blocks = ep.blocks || [];
    const lay = paginate(blocks, { lines: paper.lines, fmt: paper.fmt, pageLock: ep.pageLock });
    // locked pages keep their numbers (short pages, A-pages), but the timing counts the text itself
    const pages = lay.locked ? paginate(blocks, { lines: paper.lines, fmt: paper.fmt }).total : lay.total;
    const pageAt = [];
    lay.pages.forEach((pg, k) => pg.items.forEach((it) => { if (pageAt[it.i] == null) pageAt[it.i] = lay.labels[k]; }));
    const minutes = pages * rules.minPerPage;
    const nominal = lay.info.map((inf, i) => (i === 0 ? 0 : inf.sb) + inf.L);
    // a dual pair takes the height of its longer column, not both: the second speech adds only what overhangs the first
    for (const p of lay.duals || []) {
      let r = 0;
      for (let q = p.b; q <= p.e; q++) { r += nominal[q]; nominal[q] = 0; }
      nominal[p.b - 1] += Math.max(0, r - p.hL);
    }
    const totalNominal = nominal.reduce((a, b) => a + b, 0) || 1;
    const locs = project.locs || {};
    const chars = project.chars || {};
    const dictNames = Object.keys(chars);
    const bdBy = bdByScene(blocks, ep.tags);
    const scenes = sceneSplit(blocks).map((s, k) => {
      let lines = 0;
      const speaking = new Set();
      const mentioned = new Set();
      let dialogueWords = 0, replicas = 0;
      let speaker = '';
      for (let i = s.from; i <= s.to; i++) {
        lines += nominal[i];
        const b = blocks[i];
        if (b.t === 'character') { speaker = charName(b.x); if (speaker) { speaking.add(speaker); replicas++; } }
        if (b.t === 'dialogue') dialogueWords += clean(b.x).split(' ').filter(Boolean).length;
        if (b.t === 'action' || b.t === 'shot') {
          const U = b.x || '';
          for (const n of dictNames) if (n.length > 1 && new RegExp('(^|[^А-ЯЁA-Z])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^А-ЯЁA-Z])').test(U)) mentioned.add(n);
        }
      }
      const meta = (ep.sceneMeta || {})[s.id] || {};
      // an omitted scene keeps its tags and extras in meta (restore brings them back) but contributes no cast, tags or shifts
      const omitted = !!meta.omitted || OMIT_RE.test(s.heading || '');
      if (omitted) { speaking.clear(); mentioned.clear(); }
      else (meta.extras || []).forEach((n) => mentioned.add(charName(n)));
      const cast = new Set([...speaking, ...mentioned]);
      const h = parseHeading(s.heading);
      const loc = locs[h.object] || {};
      const pav = h.type === 'pav' || !!loc.pav;
      const share = lines / totalNominal;
      const min = share * minutes;
      const minors = [...cast].filter((n) => chars[n] && chars[n].minor);
      const guests = [...cast].filter((n) => chars[n] && chars[n].guest);
      const tags = omitted ? [] : (meta.tags || []);
      // breakdown items in Трюки / Животные make the scene special as the scene tags do; a scene with both counts once
      const bd = omitted ? {} : (bdBy[s.id] || {});
      const bdTags = Object.keys(BD_SPECIAL).filter((c) => bd[c] && bd[c].length && !tags.includes(BD_SPECIAL[c])).map((c) => BD_SPECIAL[c]);
      const special = tags.concat(bdTags).some((t) => SPECIAL_TAGS.includes(t)) || minors.length > 0;
      const rate = pav ? rules.ratePav : (h.type === 'ext' || h.type === 'intext') ? rules.rateExt : rules.rateInt;
      const shifts = omitted ? 0 : min / (special ? rate / rules.specialFactor : rate);
      return {
        id: s.id, n: k + 1, from: s.from, to: s.to, heading: s.heading, h, pav, night: isNight(h),
        lines, share, pages: share * pages, min, sec: Math.round(min * 60), cast: [...cast], speaking: [...speaking],
        silent: [...cast].filter((n) => !speaking.has(n)), minors, guests, tags, bd, bdTags, special, shifts, replicas, dialogueWords,
        synopsis: meta.synopsis || '', day: meta.day || h.day || '', num: meta.num || String(k + 1), fileNum: !!meta.num,
        line: meta.line || '', omitted, page: pageAt[s.from] || '1',
      };
    });
    for (const s of scenes) {
      if (s.line || s.omitted) continue;
      const auto = autoLine(s, project);
      if (auto) { s.line = auto.line; s.lineAuto = auto.how; }
    }
    // story lines / shooting units: share of material per line, against the project's targets
    const lineDefs = project.lines || [];
    const lineMap = {};
    lineDefs.forEach((l) => { lineMap[l.name] = { name: l.name, target: l.target, color: l.color, scenes: 0, min: 0, pages: 0, lines: 0 }; });
    const sp = (project.lineRules || {}).special;
    if (sp && sp.name) lineMap[sp.name] = { name: sp.name, target: null, color: '#6b7280', special: true, scenes: 0, min: 0, pages: 0, lines: 0 };
    let unassigned = { name: '', scenes: 0, min: 0, pages: 0, lines: 0 };
    const live = scenes.filter((s) => !s.omitted);
    for (const s of live) {
      const t = lineMap[s.line] || (s.line ? (lineMap[s.line] = { name: s.line, scenes: 0, min: 0, pages: 0, lines: 0 }) : unassigned);
      t.scenes++; t.min += s.min; t.pages += s.pages; t.lines += s.lines;
    }
    // objects (omitted scenes keep their number but have no object, cast or time)
    const objects = {};
    for (const s of scenes) {
      if (s.omitted) continue;
      const key = s.h.object || '(без объекта)';
      const o = objects[key] || (objects[key] = { name: key, scenes: 0, lines: 0, min: 0, pages: 0, shifts: 0, pav: false, type: s.h.type, subs: {} });
      o.scenes++; o.lines += s.lines; o.min += s.min; o.pages += s.pages; o.shifts += s.shifts;
      o.pav = o.pav || s.pav;
      if (s.h.sub) o.subs[s.h.sub] = (o.subs[s.h.sub] || 0) + s.min;
    }
    const sceneLines = live.reduce((a, s) => a + s.lines, 0) || 1;
    const lineList = Object.values(lineMap).map((l) => Object.assign(l, { share: l.lines / sceneLines }));
    unassigned.share = unassigned.lines / sceneLines;
    const objList = Object.values(objects).map((o) => Object.assign(o, {
      share: o.lines / sceneLines, base: !!(locs[o.name] || {}).base, main: !!(locs[o.name] || {}).main,
    })).sort((a, b) => b.lines - a.lines);
    // the main pavilion is the object marked «основной», or else a pavilion: an episode with neither has none
    let main = objList.find((o) => o.main) || objList.find((o) => o.pav) || null;
    const totalShifts = live.reduce((a, s) => a + s.shifts, 0);
    const sum = (f) => live.filter(f).reduce((a, s) => a + s.min, 0);
    const tot = minutes || 1;
    const stats = {
      pages, minutes, scenes, objects: objList, main, totalShifts, lay,
      revs: ep.revisions && ep.revisions.length ? revMarks(blocks, ep.revisions, ep.pageLock) : null,
      pavMin: sum((s) => s.pav), intMin: sum((s) => !s.pav && s.h.type === 'int'),
      extMin: sum((s) => !s.pav && (s.h.type === 'ext' || s.h.type === 'intext')),
      nightMin: sum((s) => s.night && !s.pav), nightAllMin: sum((s) => s.night),
      specialMin: sum((s) => s.special),
      mainShiftShare: main && totalShifts ? main.shifts / totalShifts : 0,
      lines: lineList, unassigned,
    };
    stats.pavPct = stats.pavMin / tot * 100;
    // characters
    const cmap = {};
    for (const s of live) {
      for (const n of s.cast) {
        const c = cmap[n] || (cmap[n] = { name: n, scenes: 0, speaking: 0, min: 0, replicas: 0, words: 0, partners: {} });
        c.scenes++; c.min += s.min;
        if (s.speaking.includes(n)) c.speaking++;
        for (const m of s.cast) if (m !== n) c.partners[m] = (c.partners[m] || 0) + 1;
      }
    }
    let speaker = '';
    for (const b of blocks) {
      if (b.t === 'character') { speaker = charName(b.x); if (cmap[speaker]) cmap[speaker].replicas++; }
      if (b.t === 'dialogue' && cmap[speaker]) cmap[speaker].words += clean(b.x).split(' ').filter(Boolean).length;
    }
    stats.characters = Object.values(cmap).sort((a, b) => b.min - a.min);
    return stats;
  }

  // ---------- script breakdown (Final Draft Tagger, Movie Magic) ----------
  // categories in the order of the tagging popup (keys 1–9 pick the first nine); the colour marks the tagged text on screen
  const BREAKDOWN = [
    { id: 'props', name: 'Реквизит', color: '#d97706' },
    { id: 'costume', name: 'Костюм', color: '#7c3aed' },
    { id: 'makeup', name: 'Грим', color: '#db2777' },
    { id: 'vehicles', name: 'Транспорт', color: '#0891b2' },
    { id: 'extras', name: 'Массовка', color: '#65a30d' },
    { id: 'stunts', name: 'Трюки', color: '#dc2626' },
    { id: 'animals', name: 'Животные', color: '#a16207' },
    { id: 'sfx', name: 'Спецэффекты', color: '#ea580c' },
    { id: 'sound', name: 'Звук/музыка', color: '#2563eb' },
    { id: 'weapons', name: 'Оружие', color: '#64748b' },
    { id: 'set', name: 'Декорация', color: '#059669' },
    { id: 'cameo', name: 'Персонаж-эпизод', color: '#c026d3' },
  ];
  const BD = {}; BREAKDOWN.forEach((c) => { BD[c.id] = c; });
  // breakdown categories that make a scene special for the studio rules, as the scene tag they stand for (counted once)
  const BD_SPECIAL = { stunts: 'stunts', animals: 'animals' };

  // the element nearest to start (outward, earlier first) whose text holds the quote; -1 if none. Comments and tags share it
  function findAnchor(texts, quote, start, maxDist) {
    if (!quote || !texts.length) return -1;
    start = Math.max(0, Math.min(Math.floor(start) || 0, texts.length - 1));
    for (let d = 0; d < texts.length && !(d > maxDist); d++) for (const k of d ? [start - d, start + d] : [start]) if (k >= 0 && k < texts.length && texts[k].indexOf(quote) >= 0) return k;
    return -1;
  }
  // the occurrence of the quote nearest to where it was tagged, so a word repeated in one element keeps its own tag
  function quoteAt(text, quote, at) {
    let best = -1;
    if (!quote) return best;
    for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) if (best < 0 || Math.abs(i - (at || 0)) < Math.abs(best - (at || 0))) best = i;
    return best;
  }
  // tags follow their text like comments, but a tag marks a word that recurs (a prop), so it never jumps to the same word
  // elsewhere: it moves only with its own text, within its scene and a few elements away (TAG_REACH):
  // - its element is gone in this edit (joined into a neighbour): the nearest element that holds the quote takes it;
  // - its element is still there without the quote (split by Enter): only an element new in this edit may take it;
  // - otherwise the words were deleted or rewritten: the tag is lost and waits on its own element for the text to come
  //   back (Ctrl+Z, a draft, «Вернуть сцену»). An element gone before the last edit is not searched again.
  // prev is the text before the edit; t.at follows typing earlier in the element, so a repeated word keeps its own tag
  const TAG_REACH = 3;
  function sceneSpan(blocks, i) {
    let a = i, z = i;
    while (a > 0 && blocks[a].t !== 'scene') a--;
    while (z + 1 < blocks.length && blocks[z + 1].t !== 'scene') z++;
    return [a, z];
  }
  function shiftAt(at, was, now) {
    if (was == null || was === now) return at || 0;
    let p = 0; const m = Math.min(was.length, now.length);
    while (p < m && was[p] === now[p]) p++;
    let q = 0; while (q < m - p && was[was.length - 1 - q] === now[now.length - 1 - q]) q++;
    return (at || 0) >= was.length - q ? (at || 0) + now.length - was.length : at || 0;
  }
  function anchorTags(blocks, tags, prev) {
    const pos = {}; blocks.forEach((b, i) => { pos[b.id] = i; });
    const texts = blocks.map((b) => b.x || '');
    const old = {}; (prev || []).forEach((b, i) => { old[b.id] = { i, x: b.x || '' }; });
    const fresh = (k) => prev && !(blocks[k].id in old);
    let moved = 0;
    for (const t of tags || []) {
      const i = pos[t.blockId], was = old[t.blockId];
      if (i != null && texts[i].indexOf(t.quote) >= 0) {
        const at = quoteAt(texts[i], t.quote, shiftAt(t.at, was && was.x, texts[i]));
        if (t.at != null || at) t.at = at;
        if (t.lost) delete t.lost;
        continue;
      }
      let start = i, any = false;
      if (start == null && was) {
        // where the element was: the nearest element of prev still in the text, earlier first
        for (let d = 1; start == null && d < prev.length; d++) for (const j of [was.i - d, was.i + d]) if (start == null && prev[j] && prev[j].id in pos) start = pos[prev[j].id];
        any = true;
      }
      let k = -1;
      if (start != null) {
        const [a, z] = sceneSpan(blocks, start);
        const sub = texts.map((x, j) => (j >= a && j <= z && (any || fresh(j)) ? x : ''));
        k = findAnchor(sub, t.quote, start, TAG_REACH);
      }
      if (k >= 0) {
        if (blocks[k].id !== t.blockId) moved++;
        t.blockId = blocks[k].id; t.at = quoteAt(texts[k], t.quote, (t.at || 0) + texts[k].length - (was ? was.x.length : 0)); delete t.lost;
      } else t.lost = true;
    }
    return moved;
  }
  // one item per category and name: «Пистолет», «пистолет.» and «ПИСТОЛЕТ» are the same prop
  const bdKey = (s) => clean(String(s || '')).toLowerCase().replace(/ё/g, 'е').replace(/^[«"'(\s]+|[»"').,:;!?\s]+$/g, '');
  const bdName = (s) => { const q = clean(String(s || '')).replace(/^[«"'(]+|[»"').,:;!?]+$/g, ''); return q.charAt(0).toUpperCase() + q.slice(1); };
  // tags by scene id: { sceneId: { cat: [{ name, note }] } }; a tag whose text is gone counts nowhere
  function bdByScene(blocks, tags) {
    const sceneOf = {}; let cur = '';
    blocks.forEach((b) => { if (b.t === 'scene') cur = b.id; sceneOf[b.id] = cur; });
    const out = {};
    for (const t of tags || []) {
      if (t.lost || !BD[t.cat] || !(t.blockId in sceneOf)) continue;
      const sid = sceneOf[t.blockId], m = out[sid] || (out[sid] = {}), list = m[t.cat] || (m[t.cat] = []);
      const k = bdKey(t.quote); if (!k) continue;
      const it = list.find((x) => bdKey(x.name) === k);
      if (!it) list.push({ name: bdName(t.quote), note: t.note || '' });
      else if (t.note && !it.note.split('; ').includes(t.note)) it.note = it.note ? it.note + '; ' + t.note : t.note;
    }
    return out;
  }
  // the whole episode by category: [{ cat, name, scenes: [num], sceneIds, notes }] in the categories' order, names alphabetical
  function breakdownItems(st) {
    const map = {};
    for (const s of st.scenes) for (const [cat, list] of Object.entries(s.bd || {})) for (const x of list) {
      const k = cat + '\u0001' + bdKey(x.name);
      const it = map[k] || (map[k] = { cat, name: x.name, scenes: [], sceneIds: [], notes: [] });
      if (!it.sceneIds.includes(s.id)) { it.sceneIds.push(s.id); it.scenes.push(s.num); }
      if (x.note && !it.notes.includes(x.note)) it.notes.push(x.note);
    }
    const all = Object.values(map);
    return BREAKDOWN.flatMap((c) => all.filter((it) => it.cat === c.id).sort((a, b) => a.name.localeCompare(b.name, 'ru')));
  }
  // per object (location): what the scenes shot there need, by category
  function breakdownByObject(st) {
    const out = {};
    for (const s of st.scenes) {
      if (s.omitted || !s.bd || !Object.keys(s.bd).length) continue;
      const key = s.h.object || '(без объекта)';
      const o = out[key] || (out[key] = { name: key, scenes: [], cats: {} });
      if (!o.scenes.includes(s.num)) o.scenes.push(s.num);
      for (const [cat, list] of Object.entries(s.bd)) {
        const names = o.cats[cat] || (o.cats[cat] = []);
        for (const x of list) if (!names.some((n) => bdKey(n) === bdKey(x.name))) names.push(x.name);
      }
    }
    return Object.values(out);
  }
  // two copies of an episode: tags from both, except the ones either side removed (ep.untagged keeps those ids)
  function mergeTags(e1, e2) {
    const off = [...new Set([...(e1.untagged || []), ...(e2.untagged || [])])];
    const tags = (e1.tags || []).slice();
    for (const t of e2.tags || []) if (!tags.some((x) => x.id === t.id)) tags.push(t);
    const res = { tags: tags.filter((t) => !off.includes(t.id)), untagged: off };
    return res;
  }

  // ---------- breakdown workbook (.xlsx, minimal SpreadsheetML) ----------
  const xlEsc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xlCol = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  // rows: arrays of strings and numbers; the first row is the bold header and stays frozen when scrolling
  function xlSheet(rows, widths) {
    const cell = (v, r, c, st) => {
      const ref = xlCol(c) + (r + 1), s = st ? ' s="' + st + '"' : '';
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
      if (v == null || v === '') return '';
      return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xlEsc(v) + '</t></is></c>';
    };
    const ncol = Math.max(1, ...rows.map((r) => r.length));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:' + xlCol(ncol - 1) + Math.max(1, rows.length) + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (widths ? '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '') +
      '<sheetData>' + rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => cell(v, r, c, r === 0 ? 1 : typeof v === 'string' && v.length > 40 ? 2 : 0)).join('') + '</row>').join('') + '</sheetData></worksheet>';
  }
  // sheets «Сцены», «Объекты», «Персонажи», «Разбивка», «По объектам»; returns { path: xml } for a zip
  function breakdownXLSX(ep, project, st) {
    const cats = BREAKDOWN.filter((c) => c.id !== 'extras');
    const join = (list) => (list || []).map((x) => x.name).join(', ');
    const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    const scenes = [['№', 'Заголовок', 'Объект', 'Режим', 'ИНТ/НАТ/ПАВ', 'Сценарный день', 'Страницы', 'Хронометраж', 'Персонажи', 'Массовка', ...cats.map((c) => c.name)]];
    for (const s of st.scenes) {
      const bd = s.bd || {};
      // the crowd column takes the breakdown's «Массовка» items, or the scene's own «Массовка» mark
      const crowd = join(bd.extras) || (s.tags.includes('crowd') ? 'да' : '');
      scenes.push([s.num, s.heading || '', s.omitted ? '' : s.h.object, s.omitted ? '' : s.h.time, s.omitted ? '' : (s.h.prefix || '') + (s.pav && s.h.type !== 'pav' ? ' (пав.)' : ''),
        s.day || '', s.omitted ? '' : fmtScenePages(s), s.omitted ? '' : fmtTime(s.min), s.cast.join(', '), crowd, ...cats.map((c) => join(bd[c.id]))]);
    }
    const objects = [['Объект', 'Павильон', 'Сцен', 'Страницы', 'Хронометраж', '%', 'Смен']];
    for (const o of st.objects) objects.push([o.name, o.pav ? 'да' : 'нет', o.scenes, fmtPages(o.pages), fmtTime(o.min), round(o.share * 100, 1), round(o.shifts, 2)]);
    const chars = [['Персонаж', 'Сцен', 'Реплик', 'Время в кадре']];
    for (const c of st.characters || []) chars.push([c.name, c.scenes, c.replicas, fmtTime(c.min)]);
    const items = [['Категория', 'Элемент', 'Сцены', 'Сцен', 'Примечание']];
    for (const it of breakdownItems(st)) items.push([BD[it.cat].name, it.name, it.scenes.join(', '), it.scenes.length, it.notes.join('; ')]);
    // per object: what the scenes shot there need, by category (the «Разбивка» tab's object summary)
    const byObj = [['Объект', 'Сцены', 'Сцен', ...BREAKDOWN.map((c) => c.name)]];
    for (const o of breakdownByObject(st)) byObj.push([o.name, o.scenes.join(', '), o.scenes.length, ...BREAKDOWN.map((c) => (o.cats[c.id] || []).join(', '))]);
    const sheets = [
      ['Сцены', xlSheet(scenes, [7, 44, 22, 10, 12, 10, 10, 11, 30, 18, ...cats.map(() => 18)])],
      ['Объекты', xlSheet(objects, [30, 10, 7, 10, 12, 7, 7])],
      ['Персонажи', xlSheet(chars, [26, 7, 8, 13])],
      ['Разбивка', xlSheet(items, [18, 30, 24, 7, 30])],
      ['По объектам', xlSheet(byObj, [30, 18, 7, ...BREAKDOWN.map(() => 20)])],
    ];
    const NS = 'http://schemas.openxmlformats.org/', XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const files = {
      '[Content_Types].xml': XML + '<Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>',
      '_rels/.rels': XML + '<Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': XML + '<workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' +
        sheets.map((s, i) => '<sheet name="' + xlEsc(s[0]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>',
      'xl/_rels/workbook.xml.rels': XML + '<Relationships xmlns="' + NS + 'package/2006/relationships">' +
        sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      // styles: 0 plain, 1 bold header on grey, 2 wrapped long text
      'xl/styles.xml': XML + '<styleSheet xmlns="' + NS + 'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EAED"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    };
    sheets.forEach((s, i) => { files['xl/worksheets/sheet' + (i + 1) + '.xml'] = s[1]; });
    void ep; void project;
    return files;
  }

  // ---------- production rules (studio PDF) ----------
  function evalRules(ep, project, st, seasonCtx) {
    const r = Object.assign({}, DEFAULT_RULES, project.rules || {});
    const out = [];
    const add = (id, title, status, value, details, hint) => out.push({ id, title, status, value, details: details || [], hint: hint || '' });
    const sref = (s, text) => ({ sceneId: s.id, text: s.n + '. ' + (text || s.heading) });
    const p = st.pages;
    add('pages', 'Объём серии', p <= r.maxPages ? 'ok' : p <= r.maxPages * 1.05 ? 'warn' : 'fail',
      p.toFixed(1) + ' / ' + r.maxPages + ' стр.', [], 'Одна страница в формате Final Draft ≈ ' + r.minPerPage + ' мин.');
    const maxScenes = Math.max(1, Math.round(Math.max(p, 1) * r.scenesPerPage));
    // omitted scenes keep their number but are not material: no rule counts them
    const live = st.scenes.filter((s) => !s.omitted);
    const nScenes = live.length;
    add('scenes', 'Количество сцен', nScenes <= maxScenes ? 'ok' : nScenes <= maxScenes + 2 ? 'warn' : 'fail',
      nScenes + ' / ' + maxScenes, [], 'Ориентир: не больше одной сцены на страницу.');
    const shorts = live.filter((s, i) => {
      if (s.sec >= r.shortSceneSec) return false;
      const prev = live[i - 1], next = live[i + 1];
      const same = (o) => o && o.h.object === s.h.object && o.h.sub === s.h.sub;
      return !(same(prev) || same(next));
    });
    add('short', 'Дробность: короткие перебивки', shorts.length <= r.maxShortScenes ? (shorts.length ? 'warn' : 'ok') : 'fail',
      shorts.length + ' сцен < ' + r.shortSceneSec + ' с', shorts.map((s) => sref(s, s.heading + ' · ' + s.sec + ' с')),
      'Дробить допустимо только при неизменной мизансцене (одним блоком).');
    if (st.main) {
      const share = st.main.share * 100, shiftShare = st.mainShiftShare * 100;
      const status = share >= r.mainShareMin && shiftShare >= r.mainShiftShareMin ? 'ok' : share >= r.mainShareMin - 10 ? 'warn' : 'fail';
      add('main', 'Основной павильон: ' + st.main.name, status,
        Math.round(share) + '% материала · ' + Math.round(shiftShare) + '% смен', [],
        'Нужно ≥ ' + r.mainShareMin + '% материала и ≥ ' + r.mainShiftShareMin + '% смен. Основной объект отмечается во вкладке «Объекты».');
    } else if (st.objects.length) {
      add('main', 'Основной павильон не найден', 'fail', '0% материала', st.objects.map((o) => ({ text: o.name + ' · ' + fmtPages(o.pages) + ' стр.' })),
        'Ни один объект не отмечен как павильон или основной. Нужно ≥ ' + r.mainShareMin + '% материала в основном павильоне; отметьте его во вкладке «Объекты».');
    }
    const nObj = st.objects.length;
    add('objects', 'Число объектов', nObj <= r.baseObjectsMax ? 'ok' : nObj <= r.baseObjectsMax + 2 ? 'warn' : 'fail',
      nObj + ' (ориентир ' + r.baseObjectsMax + ')', st.objects.map((o) => ({ text: o.name + ' · ' + fmtPages(o.pages) + ' стр.' })));
    const small = [];
    for (const o of st.objects) {
      if (o === st.main || o.base) continue;
      if (o.pages >= r.newObjectMinPages) continue;
      const season = seasonCtx ? (seasonCtx.objPages[o.name] || 0) : o.pages;
      const fs = live.find((s) => s.h.object === o.name);
      const label = o.name + ' · ' + fmtPages(o.pages) + ' стр., ' + o.scenes + ' сц.' + (seasonCtx && season > o.pages ? ' · за сезон ' + fmtPages(season) + ' стр.' : '');
      small.push({ sceneId: fs && fs.id, text: label, okSeason: season >= r.newObjectMinPages });
    }
    const bad = small.filter((x) => !x.okSeason);
    add('newobj', 'Новые объекты: не меньше ' + r.newObjectMinPages + ' стр.', bad.length ? 'fail' : small.length ? 'warn' : 'ok',
      bad.length ? bad.length + ' объект(а) мало' : small.length ? 'добор по сезону' : 'нет нарушений', small,
      'Объект на 1–2 сцены запрещён. Меньший объём допустим, если добор в других сериях сезона даёт полную смену, или если объект отмечен как базовый.');
    const nightPct = st.nightMin / (st.minutes || 1) * 100;
    const nightScenes = live.filter((s) => s.night);
    add('night', 'Ночь (без павильона)', nightPct <= r.nightMaxPct ? 'ok' : nightPct <= r.nightMaxPct * 1.5 ? 'warn' : 'fail',
      nightPct.toFixed(1) + '% / ' + r.nightMaxPct + '%', nightScenes.map((s) => sref(s, s.heading + (s.pav ? ' · павильон' : ''))),
      'Ночная жилая натура летом почти под запретом.');
    // nature (натура) share cap: exterior scenes outside a pavilion, by running time; 0 switches the rule off
    if (+r.extMaxPct > 0) {
      const extPct = st.extMin / (st.minutes || 1) * 100;
      const extScenes = live.filter((s) => !s.pav && (s.h.type === 'ext' || s.h.type === 'intext'));
      add('ext', 'Натура', extPct <= r.extMaxPct ? 'ok' : extPct <= r.extMaxPct * 1.5 ? 'warn' : 'fail',
        extPct.toFixed(1) + '% / ' + r.extMaxPct + '%', extScenes.map((s) => sref(s, s.heading + ' · ' + fmtTime(s.min))),
        'Натура зависит от погоды и света, выработка на ней ниже. Ориентир — не больше ' + r.extMaxPct + '% хронометража.');
    }
    const extNight = nightScenes.filter((s) => s.h.type === 'ext' || s.h.type === 'intext');
    if (extNight.length) add('extnight', 'Ночная натура', 'warn', extNight.length + ' сц.', extNight.map((s) => sref(s)));
    const big = live.filter((s) => s.cast.length > r.bigCast);
    add('bigcast', 'Сцены больше ' + r.bigCast + ' артистов', big.length <= r.bigCastMaxScenes ? (big.length ? 'warn' : 'ok') : 'fail',
      big.length + ' / ' + r.bigCastMaxScenes, big.map((s) => sref(s, s.heading + ' · ' + s.cast.length + ' арт.')));
    const ens = big.filter((s) => s.sec < r.ensembleMinSec);
    add('ensemble', 'Сбор ансамбля короче ' + r.ensembleMinSec + ' с', ens.length ? 'fail' : 'ok', ens.length + ' сц.',
      ens.map((s) => sref(s, s.heading + ' · ' + s.sec + ' с')), 'Раз собрали всех, сцена должна быть плотной.');
    // characters in the episode (speaking and listed in scene cards); 0 switches the rule off
    if (+r.maxCharsPerEpisode > 0) {
      const chars = st.characters || [], nc = chars.length, speak = chars.filter((c) => c.speaking).length, mx = r.maxCharsPerEpisode;
      add('chars', 'Персонажей в серии', nc <= mx ? 'ok' : nc <= Math.ceil(mx * 1.2) ? 'warn' : 'fail',
        nc + ' / ' + mx + (speak !== nc ? ' · с репликами ' + speak : ''), chars.map((c) => ({ text: c.name + ' · ' + c.scenes + ' сц.' + (c.speaking ? '' : ' · без реплик') })),
        'Каждый новый артист — отдельный кастинг, договор и смены.');
    }
    const small23 = live.filter((s) => s.cast.length >= 2 && s.cast.length <= 3).length;
    add('balance', 'Баланс: сцены на 2–3 артистов', 'info', small23 + ' из ' + live.length);
    const spPct = st.specialMin / (st.minutes || 1) * 100;
    const sp = live.filter((s) => s.special);
    add('special', 'Дети, животные, трюки, сложная постановка', spPct <= r.specialMaxPct ? (sp.length ? 'warn' : 'ok') : 'fail',
      spPct.toFixed(0) + '% хронометража', sp.map((s) => sref(s, s.heading + ' · ' + [...s.tags.filter((t) => SPECIAL_TAGS.includes(t)).map((t) => TAGS[t]), ...(s.bdTags || []).map((t) => TAGS[t] + ' (по разбивке)'), ...(s.minors.length ? ['несовершеннолетние: ' + s.minors.join(', ')] : [])].join(', '))),
      'Выработка в таких сценах падает в 2–3 раза.');
    const tagged = (t) => live.filter((s) => s.tags.includes(t));
    const clips = tagged('clip');
    add('clip', 'Клипы', clips.length ? 'warn' : 'ok', clips.length + ' сц.', clips.map((s) => sref(s)), 'Только при драматургической необходимости.');
    const music = tagged('music');
    if (music.length) add('music', 'Музыка и права', 'info', music.length + ' сц.', music.map((s) => sref(s)), 'Согласовать с производством и юристами.');
    const crowd = tagged('crowd');
    if (crowd.length) add('crowd', 'Массовка', 'info', crowd.length + ' сц.', crowd.map((s) => sref(s)), 'Обсудить с производством заранее.');
    const makeup = tagged('makeup');
    if (makeup.length) add('makeup', 'Сложный грим', 'info', makeup.length + ' сц.', makeup.map((s) => sref(s)), 'Синяки и шрамы не тянуть дальше одной серии.');
    if (st.lines && st.lines.length) {
      const tol = r.lineTolerance == null ? 5 : r.lineTolerance;
      const off = st.lines.filter((l) => l.target != null && Math.abs(l.share * 100 - l.target) > tol);
      const details = st.lines.map((l) => ({ text: l.name + ': ' + (l.share * 100).toFixed(0) + '%' + (l.target != null ? ' (цель ' + l.target + '%)' : '') + ' · ' + fmtPages(l.pages) + ' стр., ' + l.scenes + ' сц.' }));
      if (st.unassigned.scenes && live.find((s) => !s.line)) details.push({ sceneId: live.find((s) => !s.line).id, text: 'без линии: ' + st.unassigned.scenes + ' сц., ' + (st.unassigned.share * 100).toFixed(0) + '%' });
      const hasTargets = st.lines.some((l) => l.target != null);
      add('lines', 'Баланс линий', !hasTargets ? 'info' : off.length ? (off.some((l) => Math.abs(l.share * 100 - l.target) > tol * 2) ? 'fail' : 'warn') : 'ok',
        st.lines.map((l) => (l.share * 100).toFixed(0) + '%').join(' / '), details, hasTargets ? 'Допуск ±' + tol + ' п.п. от цели.' : 'Цели по линиям задаются в настройках проекта: «Группа А: 50».');
    }
    const guestSilent = live.filter((s) => s.guests.some((g) => !s.speaking.includes(g)));
    const guestScenes = live.filter((s) => s.guests.length);
    if (guestScenes.length) add('guests', 'Дорогие артисты', guestSilent.length ? 'warn' : 'info', guestScenes.length + ' сц.',
      guestScenes.map((s) => sref(s, s.heading + ' · ' + s.guests.join(', ') + (guestSilent.includes(s) ? ' (без реплик)' : ''))),
      'Не вызывать «для массовки».');
    return out;
  }
  // scene numbers taken from a file: duplicates, gaps, wrong order; a proposal keeps the file's "51-" prefix
  // ---------- locked scene numbers (shooting script) ----------
  // After the lock, numbers never move: a new scene between 12 and 13 becomes 12A (then 12B…), a scene inserted before the
  // first one becomes A1, a deleted scene keeps its number as «УДАЛЕНА» (OMITTED). Numbers may carry an episode prefix «3-12».
  // no \b here: in JS it is an ASCII word boundary and never fires after a Cyrillic letter
  const OMIT_RE = /^\s*(УДАЛЕНА|ОПУЩЕНА|OMITTED)(?![A-Za-zА-Яа-яЁё0-9_])/i;
  const NUM_PARTS = /^(\d+-)?([A-ZА-Я]*)(\d+)([A-ZА-Я]*)$/;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  function numParts(num) {
    const m = String(num || '').match(NUM_PARTS);
    return m ? { prefix: m[1] || '', pre: m[2], base: +m[3], post: m[4] } : null;
  }
  function nextLetter(used) {
    for (const L of LETTERS) if (!used.has(L)) return L;
    let i = 0; while (used.has('A' + LETTERS[i])) i++; return 'A' + LETTERS[i];
  }
  // scenes: analyzeEpisode's list; returns [{sceneId, num}] for scenes that had no fixed number yet
  function lockAssign(scenes, sceneMeta) {
    const out = [];
    const taken = new Set(scenes.filter((s) => s.fileNum).map((s) => s.num));
    const fixed = scenes.map((s) => (s.fileNum ? s.num : null));
    for (let i = 0; i < scenes.length; i++) {
      if (fixed[i]) continue;
      let prev = null;
      for (let k = i - 1; k >= 0; k--) if (fixed[k]) { prev = fixed[k]; break; }
      let num;
      if (prev) {
        const p = numParts(prev);
        if (!p) num = prev + 'A';
        else if (p.pre) {
          // prev is itself a number before p.base (A1): the new scene is also before p.base, so B1, C1…
          const used = new Set();
          for (const t of taken) { const q = numParts(t); if (q && q.prefix === p.prefix && q.base === p.base && q.pre) used.add(q.pre); }
          num = p.prefix + nextLetter(used) + p.base;
        } else {
          const used = new Set();
          for (const t of taken) { const q = numParts(t); if (q && q.prefix === p.prefix && q.base === p.base && !q.pre && q.post) used.add(q.post); }
          num = p.prefix + p.base + nextLetter(used);
        }
      } else {
        let next = null;
        for (let k = i + 1; k < scenes.length; k++) if (fixed[k]) { next = fixed[k]; break; }
        const p = next ? numParts(next) : null;
        if (p) {
          const used = new Set();
          for (const t of taken) { const q = numParts(t); if (q && q.prefix === p.prefix && q.base === p.base && q.pre) used.add(q.pre); }
          num = p.prefix + nextLetter(used) + p.base;
        } else num = String(i + 1);
      }
      taken.add(num); fixed[i] = num;
      out.push({ sceneId: scenes[i].id, num });
      (sceneMeta[scenes[i].id] = sceneMeta[scenes[i].id] || {}).num = num;
    }
    return out;
  }
  // numbers that were locked but no longer appear in the script (the scene was deleted instead of omitted)
  function lockMissing(lock, scenes) {
    const have = new Set(scenes.map((s) => s.num));
    return (lock && lock.nums || []).filter((n) => !have.has(n.num));
  }
  // where a restored OMITTED scene goes: after the last present scene that precedes it in the locked order
  function lockInsertIndex(lock, scenes, num, blocksLength) {
    const order = (lock && lock.nums || []).map((n) => n.num);
    const pos = order.indexOf(num);
    const inOrder = new Set(order);
    for (let k = pos - 1; k >= 0; k--) {
      let i = scenes.findIndex((x) => x.num === order[k]); if (i < 0) continue;
      // A-scenes added after the lock (2A, 2B…) are not in lock.nums: the restored scene goes behind them
      const p = numParts(order[k]);
      while (p && i + 1 < scenes.length && !inOrder.has(scenes[i + 1].num)) { const q = numParts(scenes[i + 1].num); if (q && q.prefix === p.prefix && q.base === p.base && !q.pre) i++; else break; }
      return scenes[i].to + 1;
    }
    const first = scenes[0];
    return first ? first.from : blocksLength;
  }
  function omittedHeading(num) { return 'УДАЛЕНА'; }

  function numberingCheck(scenes, lock) {
    const issues = [];
    const fromFile = scenes.filter((s) => s.fileNum).length;
    if (!fromFile) return { fromFile: 0, issues, proposal: null };
    if (lock) {
      // under a lock the order is whatever the shooting script says: only duplicates are a problem
      const seen = {};
      for (const s of scenes) { if (seen[s.num]) issues.push({ sceneId: s.id, text: s.num + ': номер повторяется' }); seen[s.num] = true; }
      return { fromFile, issues, proposal: null, locked: true };
    }
    const seen = {};
    let prevN = 0;
    let prefix = '';
    for (const s of scenes) {
      const m = String(s.num).match(/^(\d+-)?([А-ЯA-Z]*)(\d+)([А-ЯA-Z]*)$/);
      if (!s.fileNum) { issues.push({ sceneId: s.id, text: s.n + '. нет номера в файле' }); continue; }
      if (!m) { issues.push({ sceneId: s.id, text: s.num + ': нестандартный номер' }); continue; }
      if (m[1] && !prefix) prefix = m[1];
      const n = +m[3];
      if (seen[s.num]) issues.push({ sceneId: s.id, text: s.num + ': номер повторяется' });
      seen[s.num] = true;
      if (!m[2] && !m[4]) {
        if (n < prevN) issues.push({ sceneId: s.id, text: s.num + ': порядок нарушен (после ' + prevN + ')' });
        else if (n > prevN + 1) issues.push({ sceneId: s.id, text: s.num + ': пропущены номера ' + (prevN + 1) + (n - 1 > prevN + 1 ? '–' + (n - 1) : '') });
        prevN = n;
      }
    }
    const proposal = scenes.map((s, k) => prefix + (k + 1));
    return { fromFile, issues, proposal, partial: fromFile < scenes.length };
  }
  function fmtPages(p) {
    const e = Math.round(p * 8);
    const w = Math.floor(e / 8), r = e % 8;
    if (!w && !r) return '0';
    return (w ? w : '') + (r ? (w ? ' ' : '') + r + '/8' : '');
  }
  // a scene's length in eighths, as in Final Draft and Movie Magic: a live scene is never shorter than 1/8
  function sceneEighths(s) { return s.omitted ? 0 : Math.max(1, Math.round((s.pages || 0) * 8)); }
  function fmtEighths(e) { return fmtPages(e / 8); }
  function fmtScenePages(s) { return s.omitted ? fmtPages(0) : fmtEighths(sceneEighths(s)); }
  function fmtTime(min) {
    const s = Math.round(min * 60);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ---------- naming check (FilmToolz matches names exactly) ----------
  const LAT2CYR = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', X: 'Х', Y: 'У', a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у' };
  function fixHomoglyphs(s) {
    if (!/[А-Яа-яЁё]/.test(s) || !/[A-Za-z]/.test(s)) return s;
    return s.replace(/[A-Za-z]+/g, (w) => /^[ABEKMHOPCTXYaeopcxy]+$/.test(w) ? w.replace(/./g, (c) => LAT2CYR[c] || c) : w);
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function namingIssues(names) {
    const issues = [];
    for (const n of names) {
      if (fixHomoglyphs(n) !== n) issues.push({ name: n, fix: fixHomoglyphs(n), why: 'латинские буквы в русском слове' });
      else if (/\s{2,}|^\s|\s$/.test(n)) issues.push({ name: n, fix: clean(n), why: 'лишние пробелы' });
    }
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      if (a.length > 3 && lev(a, b) === 1) issues.push({ name: a + ' / ' + b, why: 'похожие названия, возможно, это один объект', pair: [a, b] });
      else if (b.startsWith(a + ' ')) issues.push({ name: b, why: 'похоже на подобъект «' + a + '» без точки', pair: [a, b] });
      else if (a.startsWith(b + ' ')) issues.push({ name: a, why: 'похоже на подобъект «' + b + '» без точки', pair: [b, a] });
    }
    return issues;
  }

  // ---------- import ----------
  const HEADING_START = /^\s*(?:(?:\d+-)?[A-ZА-Я]?\d+[\-–.\d]*[А-ЯA-Z]?[.)]?\s+)?(ИНТ|НАТ|ПАВ|INT|EXT|I\/E)[.\s/]/i;
  // only the text outside parentheses counts: a parenthetical such as "(Маше)" is never a caps cue
  const isCaps = (s) => { const o = s.replace(/\(.*?\)/g, ''); return /[А-ЯЁA-Z]/.test(o) && !/[а-яёa-z]/.test(o); };
  const SENT_END = /[.!?…:»")\]]$/;
  const NOT_NAMES = /^(ТИТР|НАДПИСЬ|ЗТМ|ВСТАВКА|КОНЕЦ|ПРОДОЛЖЕНИЕ|СМЕНА КАДРА|ЗАТЕМНЕНИЕ|НАПЛЫВ|FADE|CUT)/;

  // lines: [{text, indent?(inches from the sheet edge), style?, gapBefore?}] -> blocks
  // plain text «ИМЯ. Реплика» / «ИМЯ (тихо): реплика»
  const INLINE_CUE = /^([А-ЯЁA-Z][А-ЯЁA-Z\- ]{1,30}?)\s*(\([^)]*\))?\s*[.:]\s+(.+)$/;
  function classifyLines(lines) {
    const blocks = [];
    const ind = lines.map((l) => l.indent).filter((x) => x != null);
    const margin = ind.length ? leftMargin(ind) : null;
    // a document with named screenplay styles: anything in an unknown style is action, not a continuation
    const styled = lines.filter((l) => styleToType(l.style)).length >= 10;
    let prev = null;
    let L = null;
    // a cue line marked dual (Fountain «МАША ^») makes its cue the second speech of a dual dialogue pair
    const push = (t, x) => { const b = { id: uid(), t, x: clean(x) }; if (t === 'character' && L && L.dual) b.dual = true; blocks.push(b); prev = b; return b; };
    for (let k = 0; k < lines.length; k++) {
      L = lines[k];
      let text = clean(L.text);
      if (!text) { prev = prev && prev.t === 'gap' ? prev : { t: 'gap' }; continue; }
      const style = (L.style || '').toLowerCase();
      const rel = L.indent != null && margin != null ? L.indent - margin : null;
      const gap = !prev || prev.t === 'gap' || L.gapBefore;
      const last = blocks[blocks.length - 1];
      const styleType = styleToType(style);
      // the normalised heading drops the number and the script day: both ride on the block to absorb, which puts them in the scene card
      // a Fountain forced action («!ИНТ. ЭТО ПРОСТО ТЕКСТ») is never a heading
      if ((!L.forced && HEADING_START.test(text)) || styleType === 'scene') { const b = push('scene', normalizeHeadingText(text)); const ph = parseHeading(text); if (ph.guessed) b.guessed = true; if (ph.num) b.num = ph.num; if (ph.day) b.day = ph.day; continue; }
      // a cast list sits in the action column; a lone caps name with text right under it is the cue of the scene's first speech
      const nx = lines[k + 1];
      const cueAbove = text.indexOf(',') < 0 && !!(nx && clean(nx.text) && !nx.gapBefore);
      if (styleType === 'cast' || (styleType == null && last && last.t === 'scene' && (rel == null || rel < 0.6) && !cueAbove && looksLikeCast(text))) { push('cast', text); continue; }
      if (styleType === 'character' && (NOT_NAMES.test(up(text)) || /^(ЗАСТАВКА|ГРАФИКА|МУЗЫКА|ИИ:)/i.test(text))) { push('action', text); continue; }
      if (styleType && styleType !== 'scene') { pushTyped(styleType, text); continue; }
      if (styled && style) { push('action', text); continue; }
      if (/^(СМЕНА КАДРА|ЗАТЕМНЕНИЕ|НАПЛЫВ|ИЗ ЗАТЕМНЕНИЯ|CUT TO|FADE)/i.test(text) && isCaps(text)) { push('transition', text); continue; }
      if (rel != null) {
        if (rel >= 3.4 && isCaps(text)) { push('transition', text); continue; }
        if (rel >= 1.6 && rel < 3.4 && !/^\(/.test(text) && isCaps(text) && text.length <= 40) { pushTyped('character', text); continue; }
        if (rel >= 1.2 && /^\(/.test(text)) { pushTyped('paren', text); continue; }
        if (rel >= 0.6 && rel < 1.6) {
          if (last && (last.t === 'dialogue') && !gap && L.joinable !== false) { last.x = clean(last.x + ' ' + text); continue; }
          pushTyped('dialogue', text); continue;
        }
        if (last && last.t === 'action' && !gap && L.joinable) { last.x = clean(last.x + ' ' + text); continue; }
        push('action', text); continue;
      }
      // plain text: inline "ИМЯ. Реплика" or "ИМЯ (тихо): реплика"
      const inl = text.match(INLINE_CUE);
      if (inl && isCaps(inl[1]) && !NOT_NAMES.test(inl[1]) && !/[.!?]$/.test(inl[1])) {
        push('character', inl[1]);
        if (inl[2]) push('paren', inl[2]);
        push('dialogue', inl[3]);
        continue;
      }
      const nextText = clean((lines[k + 1] || {}).text || '');
      if (!/^\(/.test(text) && isCaps(text) && text.length <= 40 && !SENT_END.test(text.replace(/\(.*?\)$/, '').trim()) && nextText && !NOT_NAMES.test(text)) {
        push('character', text.replace(/:$/, '')); continue;
      }
      if (/^\(.*\)?$/.test(text) && prev && (prev.t === 'character' || prev.t === 'dialogue')) { pushTyped('paren', text); continue; }
      if (prev && (prev.t === 'character' || prev.t === 'paren')) { push('dialogue', text); continue; }
      if (prev && prev.t === 'dialogue' && !gap) { prev.x = clean(prev.x + ' ' + text); continue; }
      if (prev && prev.t === 'action' && !gap && !SENT_END.test(prev.x)) { prev.x = clean(prev.x + ' ' + text); continue; }
      push('action', text);
    }
    function pushTyped(t, text) {
      if (t === 'paren' && !/^\(/.test(text)) text = '(' + text.replace(/\)$/, '') + ')';
      if (t === 'character') {
        // "ГРИША (орет зк)": the extension stays in the cue, the stage direction becomes a parenthetical
        const sp = splitCue(text);
        push('character', sp.cue);
        if (sp.paren) push('paren', sp.paren);
        return;
      }
      push(t, text);
    }
    return blocks.filter((b) => b.x);
  }
  // a line right after a heading that is only a comma-separated list of names is the scene's cast list
  function looksLikeCast(text) {
    if (/[.!?:;]/.test(text) || text.length > 160) return false;
    const items = text.split(',').map(clean).filter(Boolean);
    // a single item must be in caps: a lone lower-case word ("Тишина") is action and must stay in the text
    if (items.length < 2) return items.length === 1 && isCaps(text) && /^[А-ЯЁа-яёA-Za-z\- ]{2,25}$/.test(text) && text.split(' ').length <= 2;
    return items.every((it) => /^[А-ЯЁа-яёA-Za-z\- ]{2,30}$/.test(it) && it.split(' ').length <= 3);
  }
  const EXT_RE = /(^|[^А-ЯЁA-Z])(З\.?\s?К\.?|ЗА КАДРОМ|ПРОД\.?|ПО ТЕЛЕФОНУ|ТИТР|В КАДРЕ|V\.?O\.?|O\.?S\.?|CONT'?D)(?![А-ЯЁA-Z])/g;
  function splitCue(text) {
    let t = up(clean(text)).replace(/:$/, '');
    const m = t.match(/^([^(]+?)\s*\((.*)\)\s*$/);
    if (!m) return { cue: normalizeCharacter(t), paren: '' };
    const name = clean(m[1]);
    let inner = clean(m[2]);
    const exts = [];
    inner = inner.replace(EXT_RE, (x, pre, ext) => { exts.push(ext); return pre + ' '; });
    inner = clean(inner.replace(/^[,\s]+|[,\s]+$/g, ''));
    const extNorm = exts.map((x) => /ПРОД|CONT/.test(x) ? '(ПРОД.)' : /ТЕЛЕФОН/.test(x) ? '(ПО ТЕЛЕФОНУ)' : /ТИТР/.test(x) ? '(ТИТР)' : /В КАДРЕ/.test(x) ? '(В КАДРЕ)' : '(ЗК)');
    const cue = fixHomoglyphs(name + (extNorm.length ? ' ' + [...new Set(extNorm)].join(' ') : ''));
    return { cue, paren: inner ? '(' + inner.toLocaleLowerCase('ru-RU') + ')' : '' };
  }
  // cast lines leave the text and become the scene's silent characters
  function splitCast(blocks) {
    const cast = {};
    let scene = null;
    const out = [];
    for (const b of blocks) {
      if (b.t === 'scene') { scene = b.id; out.push(b); continue; }
      if (b.t === 'cast') { if (scene) cast[scene] = (cast[scene] || []).concat(b.x.split(',').map((x) => charName(x)).filter(Boolean)); continue; }
      out.push(b);
    }
    return { blocks: out, cast };
  }
  function styleToType(s) {
    if (!s) return null;
    s = s.toLowerCase();
    // KIT Сценарист names its cast block "Scene Characters" / "Персонажи сцены": test it before the scene heading pattern
    if (/cast|scene[ _-]?char|действующ|участ|персонажи (в )?сцен/.test(s)) return 'cast';
    if (/scene|сцен|заголов|slug/.test(s)) return 'scene';
    if (/charact|персонаж|имя/.test(s)) return 'character';
    if (/paren|ремарк/.test(s)) return 'paren';
    if (/dialog|реплик|диалог/.test(s)) return 'dialogue';
    if (/transit|переход/.test(s)) return 'transition';
    // Final Draft's Shot element, «Кадр» / «План» in Russian templates
    if (/^(shot|кадр|план)\b|^(shot|кадр)$/.test(s)) return 'shot';
    if (/action|описан|действ|текст|narration|general/.test(s)) return 'action';
    return null;
  }
  // the action margin is the leftmost indent that is used often enough (dialogue may be the most frequent one)
  function leftMargin(arr) {
    const c = {};
    for (const x of arr) { const k = Math.round(x * 10) / 10; c[k] = (c[k] || 0) + 1; }
    const need = Math.max(2, arr.length * 0.05);
    const keys = Object.keys(c).map(Number).sort((a, b) => a - b);
    return keys.find((k) => c[k] >= need) ?? keys[0];
  }
  function normalizeHeadingText(text) {
    const h = parseHeading(text);
    return h.type ? formatHeading(h) : up(clean(text));
  }
  function normalizeCharacter(text) {
    let t = up(clean(text)).replace(/:$/, '');
    t = t.replace(/\((З\.?\s?К\.?|ЗА КАДРОМ|V\.?O\.?|O\.?S\.?)\)/g, '(ЗК)').replace(/\((ПРОД\.?|CONT'?D)\)/g, '(ПРОД.)');
    return fixHomoglyphs(t);
  }

  // ---------- title page (Final Draft TitlePage, Fountain «Key: value») ----------
  // ep.titlePage = { fields: what the imported title page said, base: the project/episode values right after the import,
  // fdx: Final Draft's own paragraphs (alignment, fonts, blank lines) with a role on the ones we read, extra: other
  // Fountain keys }. A field is written back as it was imported until its project or episode value is changed here.
  const EPISODE_RE = /^(?:Серия|Эпизод|Episode|Ep\.)(?![\p{L}])/iu;
  const CREDIT_RE = /^(?:written by|screenplay by|teleplay by|story by|by|автор(?:ы)?(?: сценария)?|сценарий|сценаристы?|по сценарию)\s*:?$/iu;
  const TPDATE_RE = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d\d-\d\d|(?:январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр|January|February|March|April|May|June|July|August|September|October|November|December)[\p{L}]*\s+(?:\d{1,2},?\s+)?\d{4}/iu;
  function parseEpisodeLine(s) {
    const m = clean(s).replace(EPISODE_RE, '').match(/^\s*(\d+)?\s*[.:,—–-]?\s*(.*)$/u);
    const title = clean(m[2] || '').replace(/^[«"“]+|[»"”]+$/g, '');
    return { number: m[1] ? +m[1] : null, title };
  }
  const tpEpKey = (ep) => (ep.number || '') + '|' + (ep.title || '');
  const tpEpLine = (ep) => 'Серия ' + (ep.number || '') + (ep.title ? '. ' + ep.title : '');
  // the values a title page shows now: imported text where nothing changed since, the project's and episode's otherwise
  function titleInfo(ep, project, today) {
    const tp = ep.titlePage || null, b = (tp && tp.base) || null, f = (tp && tp.fields) || {};
    const lv = ep.revLevel || 0, draftNow = revName(lv);
    const revDate = ((ep.revisions || []).find((r) => r.level === lv) || {}).date;
    const same = (k, cur) => !!b && (b[k] || '') === (cur || '');
    // changed: the project or episode value differs from the one the title page was imported with (always, without one)
    const changed = { title: !same('title', project.name), author: !same('author', project.author), contact: !same('contact', project.contact),
      draft: !same('draft', draftNow), episode: !same('episode', tpEpKey(ep)) };
    changed.date = changed.draft;
    return {
      changed,
      title: !changed.title && f.title ? f.title : project.name || '',
      author: !changed.author && f.author != null ? f.author : project.author || '',
      contact: !changed.contact && f.contact != null ? f.contact : project.contact || '',
      draft: !changed.draft && f.draft ? f.draft : draftNow,
      date: !changed.date && f.date ? f.date : ruDate(isoDay(today || revDate || Date.now())),
      episode: tpEpLine(ep),
      extra: (tp && tp.extra) || [],
    };
  }
  // after an import: a new episode takes its title and number from the title page, an empty author or contact of the
  // project is filled in, and the title page is kept on the episode to be written back
  function adoptTitlePage(tp, ep, project, isNew) {
    if (!tp || !tp.fields) return;
    const f = tp.fields;
    if (isNew) {
      if (f.episode && f.episode.title) ep.title = f.episode.title;
      else if (f.title && !f.episode && up(clean(f.title)) !== up(clean(project.name))) ep.title = clean(f.title);
      const n = f.episode && f.episode.number;
      if (n && !(project.episodes || []).some((e) => e !== ep && e.season === ep.season && e.number === n)) ep.number = n;
    }
    if (!project.author && f.author) project.author = clean(f.author.replace(/\n/g, ', '));
    if (!project.contact && f.contact) project.contact = clean(f.contact.replace(/\n+/g, ', '));
    const out = { fields: f, base: { title: project.name || '', author: project.author || '', contact: project.contact || '', draft: revName(ep.revLevel || 0), episode: tpEpKey(ep) } };
    if (tp.fdx) out.fdx = tp.fdx;
    if (tp.extra && tp.extra.length) out.extra = tp.extra;
    ep.titlePage = out;
  }
  // Fountain: «Key: value» lines (a value may go on indented lines below) up to the first line that is neither
  const FNT_KEYS = /^(?:Title|Credit|Author|Authors|Episode|Source|Draft date|Draft|Revision|Contact|Notes|Copyright|Date)\s*:/i;
  function fountainTitle(txt) {
    const lines = txt.split('\n');
    if (!FNT_KEYS.test(lines[0] || '')) return null;
    const pairs = [];
    let k = 0;
    for (; k < lines.length; k++) {
      const s = lines[k];
      if (!s.trim()) break;
      const m = s.match(/^([A-Za-z][A-Za-z \-]*?)\s*:\s*(.*)$/);
      if (/^(?: {2,}|\t)\S/.test(s) && pairs.length) { const pr = pairs[pairs.length - 1]; pr[1] += (pr[1] ? '\n' : '') + s.trim(); }
      else if (m) pairs.push([m[1].trim(), m[2].trim()]);
      else break;
    }
    // emphasis marks (*bold*, _underline_) are markup, not text
    const plain = (v) => { let o; do { o = v; v = v.replace(/(\*{1,3}|_)(\S(?:.*?\S)?)\1/g, '$2'); } while (v !== o); return v; };
    const fields = {}, extra = [];
    for (const [key, v0] of pairs) {
      const v = plain(v0), K = key.toLowerCase();
      if (K === 'title') fields.title = v.replace(/\n/g, ' ');
      else if (K === 'author' || K === 'authors') fields.author = v;
      else if (K === 'episode') fields.episode = parseEpisodeLine(v.replace(/\n/g, ' '));
      else if (K === 'contact') fields.contact = v;
      else if (K === 'draft date' || K === 'date') fields.date = v;
      else if (K === 'draft' || K === 'revision') fields.draft = v;
      else extra.push([key, v0]);
    }
    return { tp: { fields, extra }, rest: lines.slice(k).join('\n') };
  }

  // opts.fountain: the file is Fountain (a .fountain file, or any text that opens with a Fountain title page)
  function importText(txt, opts) {
    txt = txt.replace(/\r/g, '');
    const ft = fountainTitle(txt);
    const fountain = !!(ft || (opts && opts.fountain));
    if (ft) txt = ft.rest;
    // Fountain forced elements and centered text are reduced to plain text; ordinary text ("...Ну да.", "> стрелка") is kept as is
    // in a Fountain file any '.X' is a forced heading («.«СОН»», ".2 ГОДА СПУСТЯ"); in plain text only before a capital
    const FORCED_RE = fountain ? /^\.(?=[^.\s])/ : /^\.(?=[A-ZА-ЯЁ])/;
    const unforce = (s) => {
      const t = s.replace(/^\s+/, '');
      if (/^>.*<\s*$/.test(t)) return t.replace(/^>\s*/, '').replace(/\s*<\s*$/, '');
      if (/^>\s*[A-ZА-ЯЁ0-9 .:()\-]+:?\s*$/.test(t)) return t.replace(/^>\s*/, '');
      if (fountain && (/^!(?=\S)/.test(t) || /^~(?=[^~\s])/.test(t))) return t.slice(1);
      // a forced heading left empty (a new scene exported before it got a heading) is nothing, not an action ". #1#"
      if (fountain && /^\.\s*(?:#[^#\s]+#)?\s*$/.test(t)) return '';
      return t.replace(FORCED_RE, '').replace(/^@(?=[A-ZА-ЯЁ])/, '');
    };
    // Fountain markup that is not script text: notes [[…]], boneyard /* … */, sections (#), page breaks (===);
    // a synopsis line («= …») becomes the synopsis of the scene above it
    const DROP = '\u0001';
    if (fountain) txt = txt.replace(/\/\*[\s\S]*?\*\//g, DROP).replace(/\[\[[\s\S]*?\]\]/g, DROP);
    const raw = [], synAt = {};
    let lastHead = -1;
    for (let s of txt.split('\n')) {
      if (fountain) {
        if (s.includes(DROP)) { s = s.split(DROP).join(''); if (!s.trim()) continue; }
        if (/^\s*#/.test(s) || /^\s*={3,}\s*$/.test(s)) continue;
        const sy = s.match(/^\s*=(?!=)\s*(.*)$/);
        if (sy) { if (lastHead >= 0 && clean(sy[1])) synAt[lastHead] = clean((synAt[lastHead] ? synAt[lastHead] + ' ' : '') + sy[1]); continue; }
        const t = s.trim();
        if (FORCED_RE.test(t) || HEADING_START.test(t)) lastHead = raw.length;
      }
      raw.push(s);
    }
    const nums = [], syns = [];
    const blank = (k) => k < 0 || k >= raw.length || !raw[k].replace(/\u200B/g, '').trim();
    const lines = raw.map((s, k) => {
      // our export's escape (FNT_ZW): a line opening with a zero-width space is text as it stands, never markup (a
      // speech line «#яжемать», «=== », «.ИНТ…»); with one at the end too it is a shot the shot rule would not see
      if (fountain && s.includes(FNT_ZW)) {
        if (/^[ \t]*\u200B/.test(s)) {
          const shotM = /\u200B\s*$/.test(s.replace(/^[ \t]*\u200B/, ''));
          return { text: s.replace(/\u200B/g, ''), joinable: true, style: shotM ? 'Shot' : 'Dialogue', forced: true };
        }
        s = s.replace(/\u200B/g, '');
      }
      // Fountain dual dialogue: «МАША ^» is the cue of the second speech, printed beside the one before it
      let dual = false;
      if (/\S\s*\^\s*$/.test(s) && isCaps(s.replace(/\^\s*$/, '').replace(/^\s*@/, ''))) { s = s.replace(/\s*\^\s*$/, ''); dual = true; }
      let text = unforce(s);
      if (dual) return { text, joinable: true, style: 'Character', dual: true };
      const forced = FORCED_RE.test(s.replace(/^\s+/, ''));
      const action = fountain && /^\s*!(?=\S)/.test(s);
      // Fountain scene number "#12А#" at the end of a heading
      const m = text.match(/^(.*?)\s*#([^#\s]+)#\s*$/);
      const head = forced || (!action && HEADING_START.test(m ? m[1] : text));
      if (head && m) text = m[1];
      if (head && clean(text)) { nums.push(m ? m[2] : ''); syns.push(synAt[k] || ''); }
      // Fountain has no shot element: a capitals line standing alone (our export forces capitals action with «!») is a shot
      const t0 = s.trim();
      const shot = fountain && !head && !forced && !action && blank(k - 1) && blank(k + 1) && fountainShotLike(t0);
      return { text, joinable: true, style: forced ? 'Scene Heading' : action ? 'Action' : shot ? 'Shot' : undefined, forced: action || undefined };
    });
    const blocks = classifyLines(lines);
    let k = 0;
    for (const b of blocks) if (b.t === 'scene') { const n = nums[k], sy = syns[k]; k++; if (n) b.num = n; if (sy) b.synopsis = sy; }
    if (ft) blocks.titlePage = ft.tp;
    return blocks;
  }
  function importFDX(xml, DOMParserImpl) {
    const doc = new (DOMParserImpl || DOMParser)().parseFromString(xml, 'application/xml');
    const map = { 'Scene Heading': 'scene', Action: 'action', Character: 'character', Parenthetical: 'paren', Dialogue: 'dialogue', Transition: 'transition', Shot: 'shot', General: 'action' };
    // the script's own <Content> is a child of <FinalDraft>; the title page has a <Content> of its own
    const root = doc.documentElement, inTitle = (el) => { for (let q = el; q; q = q.parentNode) if (q.nodeName === 'TitlePage') return true; return false; };
    let content = null, tpEl = null;
    for (let c = root && root.firstChild; c; c = c.nextSibling) { if (c.nodeName === 'Content' && !content) content = c; if (c.nodeName === 'TitlePage' && !tpEl) tpEl = c; }
    if (!content) content = Array.from(doc.getElementsByTagName('Content')).find((c) => !inTitle(c)) || null;
    if (!content) throw new Error('В файле нет текста сценария (раздел Content).');
    const blocks = [], ddCues = new Map();
    const ps = content.getElementsByTagName('Paragraph');
    const kids = (el, name) => { const out = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeName === name) out.push(c); return out; };
    // a paragraph's own text: its Text runs, not those of nested paragraphs
    const ownText = (p) => { let text = '', rev = 0; const ts = p.getElementsByTagName('Text');
      for (let j = 0; j < ts.length; j++) { let q = ts[j].parentNode; while (q && q.nodeName !== 'Paragraph') q = q.parentNode; if (q === p) { text += ts[j].textContent; if (ts[j].textContent.trim()) rev = Math.max(rev, +ts[j].getAttribute('RevisionID') || 0); } }
      return { text: clean(text), rev }; };
    // unknown element types (Cast List, Shot, New Act…) are matched by name like Word styles, otherwise they become action
    const typeOf = (p) => { const ty = p.getAttribute('Type') || ''; return map[ty] || (/summary|synops|outline|title|act\b/i.test(ty) ? 'action' : styleToType(ty)) || 'action'; };
    const shape = (t, text) => { if (t === 'scene') return normalizeHeadingText(text); if (t === 'character') return normalizeCharacter(text); if (t === 'paren' && !/^\(/.test(text)) return '(' + text + ')'; return text; };
    // paragraphs that are not script text: the dead body of an omitted scene (<OmittedScene>), and what Final Draft 10+
    // keeps in a heading's scene properties (the Summary, character arc beats) as paragraphs of their own
    const DEAD = { OmittedScene: 1, SceneProperties: 1, Summary: 1, SceneArcBeats: 1, CharacterArcBeat: 1 };
    // a <Paragraph><DualDialogue>…</DualDialogue></Paragraph> wrapper has no text: its speeches are read one by one
    const isWrap = (p) => kids(p, 'DualDialogue').length > 0;
    // the body of an omitted scene, dual pairs included (the second cue of a wrapper is the dual one)
    const deadBody = (om) => {
      const out = [];
      const one = (q, dual) => { const o = ownText(q), tq = typeOf(q); if (!o.text) return; const b = { id: uid(), t: tq, x: shape(tq, o.text) }; if (dual && tq === 'character') b.dual = true; out.push(b); };
      for (const q of kids(om, 'Paragraph')) {
        if (!isWrap(q)) { one(q, false); continue; }
        for (const d of kids(q, 'DualDialogue')) { let n = 0; for (const q2 of kids(d, 'Paragraph')) { if (typeOf(q2) === 'character' && ownText(q2).text) n++; one(q2, n === 2); } }
      }
      return out.filter((x) => x.t !== 'cast');
    };
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      // Final Draft keeps the dead body of an omitted scene inside <OmittedScene>: never import it as live text
      let anc = p.parentNode, dead = false;
      while (anc && anc !== content) { if (DEAD[anc.nodeName]) { dead = true; break; } anc = anc.parentNode; }
      if (dead) continue;
      // <DualDialogue>: the second cue inside it is the dual one
      let dd = p.parentNode;
      while (dd && dd !== content && dd.nodeName !== 'DualDialogue') dd = dd.parentNode;
      if (dd === content) dd = null;
      const hasOmitted = kids(p, 'OmittedScene').length > 0;
      if (!hasOmitted && isWrap(p)) continue;
      let { text, rev } = ownText(p);
      let t = typeOf(p);
      if (hasOmitted && !text) { text = 'OMITTED'; t = 'scene'; }
      if (!text) continue;
      const fdxNum = (p.getAttribute('Number') || '').trim();
      const fdxDay = t === 'scene' ? parseHeading(text).day : '';
      text = shape(t, text);
      const nb = { id: uid(), t, x: text };
      if (dd && t === 'character') { const n = (ddCues.get(dd) || 0) + 1; ddCues.set(dd, n); if (n === 2) nb.dual = true; }
      // the scene's Summary (Final Draft 10+) becomes its synopsis; without one, the SceneProperties Title (older files)
      const sp = t === 'scene' ? kids(p, 'SceneProperties')[0] : null;
      const sum = sp ? kids(sp, 'Summary').map((q) => kids(q, 'Paragraph').map((x) => ownText(x).text).filter(Boolean).join(' ')).filter(Boolean).join(' ') : '';
      if (sum) nb.synopsis = sum;
      else if (sp && (sp.getAttribute('Title') || '').trim()) nb.synopsis = sp.getAttribute('Title').trim();
      if (t === 'scene' && fdxNum) nb.num = fdxNum;
      if (rev > 0) nb.rev = rev;
      if (fdxDay) nb.day = fdxDay;
      if (t === 'scene' && (hasOmitted || OMIT_RE.test(text))) {
        nb.x = omittedHeading(fdxNum); nb.omitted = true;
        // the dead body stays with the scene (as «Удалить сцену» keeps it), so «Вернуть сцену» can bring it back
        const om = hasOmitted ? kids(p, 'OmittedScene')[0] : null;
        const body = om ? deadBody(om) : [];
        if (body.length) {
          if (body[0].t !== 'scene') body.unshift({ id: nb.id, t: 'scene', x: '' }); else body[0].id = nb.id;
          nb.omittedBlocks = body; nb.omittedHeading = body[0].x;
        }
      }
      blocks.push(nb);
    }
    const tp = tpEl ? fdxTitle(tpEl) : null;
    if (tp) blocks.titlePage = tp;
    return blocks;
  }
  // ---------- КИТ Сценарист (.kitsp) and Story Architect (.starc) ----------
  // Both are SQLite files (read with sql.js, passed in by the caller). КИТ keeps the script as XML in scenario.text
  // (<scenario version="1.0"><scene_heading number=".."><v><![CDATA[..]]></v></scene_heading>…), the main text is the
  // row with is_draft = 0. STARC keeps every document in documents(uuid, type, content); the screenplay text is type
  // 10104 (<document><scene uuid=".." omited="true"><number value="5" fixed="true"/><story_day>..</story_day>
  // <content><scene_heading><v>..</v></scene_heading>…</content></scene>…</document>), names come from the structure
  // document (type 1, <item uuid type name>). Both escape the text as HTML inside CDATA. Unknown elements are skipped.
  const KIT_TYPE = {
    scene_heading: 'scene', time_and_place: 'scene', scene_characters: 'cast', action: 'action', character: 'character',
    parenthetical: 'paren', dialog: 'dialogue', dialogue: 'dialogue', lyrics: 'dialogue', transition: 'transition', shot: 'shot',
    note: 'action', title_header: 'action', title: 'action', unformatted_text: 'action',
    sound: 'action', music: 'action', cue: 'action', text: 'action',
    // not text of the script: folders, acts, sequences, beats, notes the writer does not print
    noprintable_text: null, inline_note: null, folder_header: null, folder_footer: null, scene_group_header: null, scene_group_footer: null,
    act_heading: null, act_footer: null, sequence_heading: null, sequence_footer: null, beat_heading: null, page_splitter: null,
    part_heading: null, part_footer: null, chapter_heading: null, chapter_footer: null, undefined: null,
  };
  const htmlUnesc = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1));
    return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', nbsp: ' ' }[k];
  }).replace(/\u2028|\u2029/g, '\n');
  const elKids = (el) => { const out = []; for (let c = el && el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; };
  const kidEl = (el, name) => elKids(el).find((c) => c.nodeName === name) || null;
  function screenplayXmlBlocks(xml, DOMParserImpl) {
    const doc = new (DOMParserImpl || DOMParser)().parseFromString(String(xml).replace(/^﻿/, ''), 'application/xml');
    const root = doc && doc.documentElement;
    if (!root || root.nodeName === 'parsererror' || root.getElementsByTagName('parsererror').length) throw new Error('Текст сценария в файле повреждён.');
    const blocks = [];
    let table = 0, col = 2, dualDone = false, titleHead = null;
    const shape = (t, text) => { if (t === 'scene') return normalizeHeadingText(text); if (t === 'character') return normalizeCharacter(text); if (t === 'paren' && !/^\(/.test(text)) return '(' + text + ')'; return text; };
    const valueOf = (el) => { const v = kidEl(el, 'v'); return htmlUnesc(v ? v.textContent : (elKids(el).length ? '' : el.textContent)); };
    const para = (el) => {
      const name = el.nodeName, t = KIT_TYPE[name];
      if (t === undefined || t === null) { titleHead = null; return; }
      // a paragraph of the second column of a dual dialogue (STARC marks the first column with params ifc="true")
      const pr = kidEl(el, 'params');
      if (table && pr && pr.getAttribute('ifc') === 'false') col = 2;
      if (table && pr && pr.getAttribute('ifc') === 'true') col = 1;
      const raw = valueOf(el);
      // КИТ «Заголовок титра» + «Титр»: one line of description, «ТИТР: Москва, 1999»
      if (name === 'title' && titleHead) { titleHead.x = clean(titleHead.x + ' ' + raw.replace(/\n+/g, ' ')); titleHead = null; return; }
      titleHead = null;
      const lines = t === 'action' ? raw.split('\n').map(clean).filter(Boolean) : [clean(raw.replace(/\n+/g, ' '))].filter(Boolean);
      if (!lines.length) return;
      for (const ln of lines) {
        const nb = { id: uid(), t, x: shape(t, ln) };
        if (t === 'scene') {
          const day = parseHeading(ln).day; if (day) nb.day = day;
          const num = clean(el.getAttribute('number') || ''); if (num) nb.num = num;
          const desc = clean(htmlUnesc(el.getAttribute('description') || '')); if (desc) nb.synopsis = desc;
        }
        if (t === 'character' && table && col === 2 && !dualDone) { nb.dual = true; dualDone = true; }
        blocks.push(nb);
      }
      if (name === 'title_header') titleHead = blocks[blocks.length - 1];
      // КИТ «Описание сцены» is the scene's synopsis, not printed text
    };
    const walk = (el) => {
      for (const c of elKids(el)) {
        const n = c.nodeName;
        if (n === 'splitter_start' || (n === 'splitter' && c.getAttribute('type') === 'start')) { table = 1; col = 1; dualDone = false; continue; }
        if (n === 'splitter_end' || (n === 'splitter' && c.getAttribute('type') === 'end')) { table = 0; continue; }
        if (n === 'splitter') { if (table) col = 2; continue; }
        if (n === 'scene_description') {
          const s = clean(valueOf(c).replace(/\n+/g, ' '));
          for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k].t === 'scene') { if (s) blocks[k].synopsis = blocks[k].synopsis ? blocks[k].synopsis + ' ' + s : s; break; }
          continue;
        }
        if (n === 'content') { walk(c); continue; }
        if (kidEl(c, 'content')) { group(c); continue; }
        para(c);
      }
    };
    // a STARC group (scene, beat, sequence…): its number, story day, description and omitted mark go to its first scene
    const group = (g) => {
      const from = blocks.length;
      walk(kidEl(g, 'content'));
      const k = blocks.findIndex((b, i) => i >= from && b.t === 'scene');
      if (k < 0 || blocks[k]._g) return;
      const b = blocks[k]; b._g = true;
      const nm = kidEl(g, 'number');
      if (nm && (nm.getAttribute('fixed') === 'true' || nm.getAttribute('custom') === 'true') && clean(nm.getAttribute('value'))) b.num = clean(nm.getAttribute('value'));
      const day = kidEl(g, 'story_day'), dx = day ? clean(htmlUnesc(day.textContent)) : '';
      // «День 3», «3», «Day 3» -> 3, the script day of the scene card
      if (dx) b.day = (dx.match(/\d+/) || [dx])[0];
      const ds = kidEl(g, 'description'); if (ds && clean(htmlUnesc(ds.textContent))) b.synopsis = clean(htmlUnesc(ds.textContent).replace(/\n+/g, ' '));
      if (g.getAttribute('omited') === 'true' || g.getAttribute('omitted') === 'true') {
        // the dead body stays with the scene card, as for <OmittedScene> in .fdx
        let end = blocks.length;
        for (let i = k + 1; i < blocks.length; i++) if (blocks[i].t === 'scene') { end = i; break; }
        const body = blocks.slice(k, end).map((x) => ({ id: x.id, t: x.t, x: x.x })).filter((x) => x.t !== 'cast');
        blocks.splice(k + 1, end - k - 1);
        b.omittedBlocks = body; b.omittedHeading = body[0].x; b.omitted = true; b.x = omittedHeading(b.num || '');
      }
    };
    walk(root);
    blocks.forEach((b) => delete b._g);
    return blocks;
  }
  function importKIT(xml, DOMParserImpl) { return screenplayXmlBlocks(xml, DOMParserImpl); }
  function importSTARC(xml, DOMParserImpl) { return screenplayXmlBlocks(xml, DOMParserImpl); }
  const STARC_TEXT = 10104, STARC_SERIES_TEXT = 10115, STARC_STRUCTURE = 1, STARC_SCREENPLAY = 10100, STARC_BIN = 10001;
  const sqlText = (v) => (v == null ? '' : typeof v === 'string' ? v : new TextDecoder('utf-8').decode(v));
  // rows of a query as objects; a missing table or column gives no rows
  const sqlRows = (db, q) => { try { const r = db.exec(q)[0]; return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : []; } catch (e) { return []; } };
  // a .kitsp / .starc file -> { format, scripts: [{ name, blocks }] } (STARC may hold several screenplays and episodes)
  function importSqliteProject(SQL, bytes, DOMParserImpl) {
    let db;
    try { db = new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); db.exec('SELECT name FROM sqlite_master LIMIT 1'); }
    catch (e) { throw new Error('Это не файл КИТ Сценариста или Story Architect (не база SQLite).'); }
    try {
      const tables = sqlRows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
      if (tables.includes('scenario')) {
        const rows = sqlRows(db, 'SELECT * FROM scenario ORDER BY id');
        // the main text first (is_draft = 0), then the draft ("черновик") if the main one is empty
        rows.sort((a, b) => (+a.is_draft || 0) - (+b.is_draft || 0));
        let blocks = [];
        for (const r of rows) { const x = sqlText(r.text); if (x.trim()) { blocks = importKIT(x, DOMParserImpl); if (blocks.length) break; } }
        const data = {}; sqlRows(db, 'SELECT data_name, data_value FROM scenario_data').forEach((r) => { data[r.data_name] = clean(htmlUnesc(sqlText(r.data_value)).replace(/<[^>]+>/g, ' ')); });
        const name = data.name || (rows[0] && clean(sqlText(rows[0].name))) || '';
        const fields = {};
        if (name) fields.title = name;
        if (data.author) fields.author = data.author;
        if (data.contacts) fields.contact = data.contacts;
        if (Object.keys(fields).length) blocks.titlePage = { fields };
        return { format: 'kitsp', scripts: [{ name, blocks }] };
      }
      if (tables.includes('documents')) {
        const docs = sqlRows(db, 'SELECT uuid, type, content FROM documents');
        const names = {}, parent = {}, inBin = new Set(), isItem = new Set();
        const st = docs.find((d) => +d.type === STARC_STRUCTURE);
        if (st) {
          try {
            const sd = new (DOMParserImpl || DOMParser)().parseFromString(sqlText(st.content), 'application/xml');
            const visit = (el, up, bin) => {
              for (const c of elKids(el)) {
                if (c.nodeName !== 'item') continue;
                const u = c.getAttribute('uuid') || '', ty = +c.getAttribute('type') || 0;
                names[u] = { name: clean(htmlUnesc(c.getAttribute('name') || '')), type: ty }; parent[u] = up; isItem.add(u);
                const b = bin || ty === STARC_BIN; if (b) inBin.add(u);
                visit(c, u, b);
              }
            };
            visit(sd.documentElement, null, false);
          } catch (e) { /* no names: the scripts are still read */ }
        }
        // a script is named after its screenplay (the parent item of the text), an episode by its own name
        const nameOf = (u) => { for (let q = u, d = 0; q && d < 4; q = parent[q], d++) { const n = names[q]; if (n && n.name && (n.type === STARC_SCREENPLAY || q === u && n.type !== STARC_TEXT)) return n.name; } return (names[parent[u]] || {}).name || ''; };
        const scripts = [];
        for (const d of docs) {
          const ty = +d.type;
          if (ty !== STARC_TEXT && ty !== STARC_SERIES_TEXT) continue;
          // drafts and versions of a text are separate documents that the structure lists as <draft>: only the current text
          if (st && (!isItem.has(d.uuid) || inBin.has(d.uuid))) continue;
          const x = sqlText(d.content);
          if (!x.trim()) continue;
          const blocks = importSTARC(x, DOMParserImpl);
          if (blocks.length) scripts.push({ name: nameOf(d.uuid), blocks, series: ty === STARC_SERIES_TEXT });
        }
        // a series text is all its episodes together: keep it only when there are no episodes to choose from
        const own = scripts.filter((s) => !s.series);
        return { format: 'starc', scripts: own.length ? own : scripts };
      }
      throw new Error('Это не файл КИТ Сценариста или Story Architect: в базе нет сценария.');
    } finally { db.close(); }
  }
  const xmlKids = (el, name) => { const out = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeName === name) out.push(c); return out; };
  const xmlAttrs = (el) => { const o = {}; for (let i = 0; i < el.attributes.length; i++) o[el.attributes[i].name] = el.attributes[i].value; return o; };
  // Final Draft's title page is free text: every paragraph is kept as it is (alignment, font, blank lines), and the ones
  // we understand get a role: centred title, «Серия N. …», author (the first other centred line; a credit such as
  // «Written by» is skipped), contact on the left, draft label and date on the right
  function fdxTitle(tpEl) {
    const c = xmlKids(tpEl, 'Content')[0];
    if (!c) return null;
    const paras = xmlKids(c, 'Paragraph').map((p) => ({ a: xmlAttrs(p), r: xmlKids(p, 'Text').map((t) => ({ a: xmlAttrs(t), x: t.textContent })) }));
    if (!paras.some((p) => p.r.some((r) => r.x.trim()))) return null;
    const fields = {}, contact = [];
    const al = (p) => (p.a.Alignment || 'Left').toLowerCase();
    // a title page typed all on the left still has a title: its first line
    const anyCenter = paras.some((p) => al(p) === 'center' && p.r.some((r) => r.x.trim()));
    for (const p of paras) {
      const x = clean(p.r.map((r) => r.x).join(''));
      if (!x) continue;
      const a = !anyCenter && fields.title == null ? 'center' : al(p);
      if (a === 'center') {
        if (fields.title == null) { p.role = 'title'; fields.title = x; }
        else if (!fields.episode && EPISODE_RE.test(x)) { p.role = 'episode'; fields.episode = parseEpisodeLine(x); }
        else if (CREDIT_RE.test(x)) p.role = 'credit';
        else if (fields.author == null) { p.role = 'author'; fields.author = x; }
      } else if (a === 'right') {
        if (fields.date == null && TPDATE_RE.test(x)) { p.role = 'date'; fields.date = x; }
        else if (fields.draft == null) { p.role = 'draft'; fields.draft = x; }
      } else { p.role = 'contact'; contact.push(x); }
    }
    if (contact.length) fields.contact = contact.join('\n');
    return { fields, fdx: paras };
  }
  // the <TitlePage> written to .fdx: Final Draft's own paragraphs when the episode came from a title page (a field
  // changed here since replaces the text of its paragraphs), otherwise the layout of our PDF title page
  const TP_PARA = { FirstIndent: '0.00', Leading: 'Regular', LeftIndent: '1.00', RightIndent: '7.50', SpaceBefore: '0', Spacing: '1', StartsNewPage: 'No' };
  const TP_TEXT = { AdornmentStyle: '0', Background: '#FFFFFFFFFFFF', Color: '#000000000000', Font: 'Courier Final Draft', RevisionID: '0', Size: '12', Style: '' };
  function fdxTitleXML(ep, project, today) {
    const ti = titleInfo(ep, project, today), tp = ep.titlePage;
    const para = (align, x, style) => ({ a: Object.assign({ Alignment: align }, TP_PARA), r: [{ a: Object.assign({}, TP_TEXT, style ? { Style: style } : {}), x }] });
    let paras;
    if (tp && tp.fdx && tp.fdx.length) {
      paras = tp.fdx.map((p) => ({ a: p.a, r: p.r, role: p.role }));
      const setText = (p, x) => Object.assign({}, p, { r: [{ a: (p.r[0] || {}).a || Object.assign({}, TP_TEXT), x }] });
      const put = (role, lines, align) => {
        const at = []; paras.forEach((p, k) => { if (p.role === role) at.push(k); });
        if (!at.length) {
          if (!lines.some(Boolean)) return;
          // no paragraph for it yet: a centred field goes under the centred block, the others to the end
          let k = paras.length;
          if (align === 'Center') { k = 0; paras.forEach((p, q) => { if (p.role === 'title' || p.role === 'episode' || p.role === 'credit' || p.role === 'author') k = q + 1; }); }
          paras.splice(k, 0, ...lines.map((x) => Object.assign(para(align, x), { role })));
          return;
        }
        at.forEach((k, j) => { paras[k] = setText(paras[k], lines[j] || ''); });
        const last = at[at.length - 1];
        if (lines.length > at.length) paras.splice(last + 1, 0, ...lines.slice(at.length).map((x) => setText(paras[last], x)));
      };
      if (ti.changed.title) put('title', [ti.title], 'Center');
      if (ti.changed.episode) put('episode', [ti.episode], 'Center');
      if (ti.changed.author) put('author', [ti.author], 'Center');
      if (ti.changed.contact) put('contact', ti.contact ? ti.contact.split('\n') : [''], 'Left');
      if (ti.changed.draft) put('draft', [ti.draft], 'Right');
      if (ti.changed.date) put('date', [ti.date], 'Right');
    } else {
      const blank = (n, a) => Array.from({ length: n }, () => para(a || 'Center', ''));
      paras = [...blank(16), para('Center', up(ti.title), 'Bold'), ...blank(1), para('Center', ti.episode), ...blank(3)];
      if (ti.author) paras.push(para('Center', ti.author));
      paras.push(...blank(Math.max(1, 46 - paras.length)), para('Right', ti.draft), para('Right', ti.date));
      if (ti.contact) paras.push(...blank(1, 'Left'), ...ti.contact.split('\n').map((x) => para('Left', x)));
    }
    const at = (o) => Object.keys(o).map((k) => ' ' + k + '="' + xmlEsc(o[k]) + '"').join('');
    return '  <TitlePage>\n    <Content>\n' + paras.map((p) => '      <Paragraph' + at(p.a) + '>' + p.r.map((r) => '<Text' + at(r.a) + '>' + xmlEsc(r.x) + '</Text>').join('') + '</Paragraph>').join('\n') + '\n    </Content>\n  </TitlePage>\n';
  }
  // after import: unify spelling with the project dictionary and register new names
  function absorb(blocks, project) {
    project.chars = project.chars || {}; project.locs = project.locs || {};
    const locKey = (s) => up(s).replace(/[\s.]+/g, '');
    const locIndex = {}; Object.keys(project.locs).forEach((n) => { locIndex[locKey(n)] = n; });
    const chIndex = {}; Object.keys(project.chars).forEach((n) => { chIndex[locKey(n)] = n; });
    const report = { newChars: [], newLocs: [], pavLocs: [], unified: [], guessed: [], untyped: [], sceneMeta: {} };
    for (const b of blocks) {
      if (b.t === 'scene') {
        const h = parseHeading(b.x);
        // numbering, script day and flashback marks come from the file and are kept in the scene card
        const num = h.num || b.num || '';
        const day = h.day || b.day || '';
        delete b.day;
        if (day || h.flash || num) report.sceneMeta[b.id] = { day, tags: h.flash ? ['flashback'] : [], num };
        if (b.synopsis) { (report.sceneMeta[b.id] = report.sceneMeta[b.id] || { tags: [], num }).synopsis = b.synopsis; delete b.synopsis; }
        if (b.omitted || OMIT_RE.test(b.x)) {
          const m = (report.sceneMeta[b.id] = report.sceneMeta[b.id] || { num }); m.omitted = true;
          if (b.omittedBlocks) { m.omittedBlocks = b.omittedBlocks; m.omittedHeading = b.omittedHeading || ''; }
          b.x = omittedHeading(num); delete b.omitted; delete b.omittedBlocks; delete b.omittedHeading; continue;
        }
        delete b.num;
        if (h.guessed || b.guessed) { report.guessed.push(b.x); delete b.guessed; }
        if (!h.type) { report.untyped.push(b.x); continue; }
        let obj = fixHomoglyphs(h.object);
        const existing = locIndex[locKey(obj)];
        if (existing && existing !== obj) { report.unified.push(obj + ' → ' + existing); obj = existing; }
        if (!project.locs[obj]) { project.locs[obj] = { pav: h.type === 'pav', base: false, main: false }; locIndex[locKey(obj)] = obj; report.newLocs.push(obj); }
        if (h.type === 'pav' && !project.locs[obj].pav) project.locs[obj].pav = true;
        if (project.locs[obj].pav && !report.pavLocs.includes(obj)) report.pavLocs.push(obj);
        h.object = obj; h.sub = fixHomoglyphs(h.sub);
        b.x = formatHeading(h);
      }
      if (b.t === 'character') {
        const n = charName(b.x);
        if (!n) continue;
        const ex = chIndex[locKey(n)];
        if (ex && ex !== n) { b.x = b.x.replace(n, ex); report.unified.push(n + ' → ' + ex); continue; }
        if (!project.chars[n]) { project.chars[n] = { age: '', desc: '', minor: false, guest: false }; chIndex[locKey(n)] = n; report.newChars.push(n); }
      }
    }
    return report;
  }
  // import pipeline after classification: cast lists -> silent characters, dictionaries, scene metadata
  function finalizeImport(rawBlocks, project) {
    const sp = splitCast(rawBlocks);
    const blocks = sp.blocks;
    const report = absorb(blocks, project);
    const sceneMeta = report.sceneMeta;
    const speaking = {};
    let scene = null;
    for (const b of blocks) { if (b.t === 'scene') scene = b.id; if (b.t === 'character' && scene) (speaking[scene] = speaking[scene] || new Set()).add(charName(b.x)); }
    for (const [id, names] of Object.entries(sp.cast)) {
      const extras = [...new Set(names.map(fixHomoglyphs))].filter((n) => !(speaking[id] && speaking[id].has(n)));
      for (const n of names) if (!project.chars[n]) { project.chars[n] = { age: '', desc: '', minor: false, guest: false }; report.newChars.push(n); }
      if (extras.length) (sceneMeta[id] = sceneMeta[id] || {}).extras = extras;
    }
    report.castScenes = Object.keys(sp.cast).length;
    return { blocks, sceneMeta, report };
  }

  // ---------- export ----------
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const FDX_TYPE = { scene: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot' };
  function exportFDX(ep, project, st, opts) {
    opts = opts || {};
    const revs = st.revs || [];
    const sceneByIdx = {}; st.scenes.forEach((s) => { sceneByIdx[s.from] = s; });
    const paper = paperOf(project.rules);
    const F = paper.fmt;
    const paras = (ep.blocks || []).map((b, i) => {
      const s = sceneByIdx[i];
      const num = s ? (opts.episodePrefix && !/-/.test(s.num) ? (ep.number || 1) + '-' + s.num : s.num) : '';
      // the synopsis is Final Draft's scene Summary (and the Title, which older files and versions read)
      const props = s ? '<SceneProperties Length="' + fmtScenePages(s) + '" Page="' + (s.page || 1) + '" Title="' + xmlEsc(s.synopsis || '') + '"' + (s.synopsis ? '><Summary><Paragraph Alignment="Left"><Text>' + xmlEsc(s.synopsis) + '</Text></Paragraph></Summary></SceneProperties>' : '/>') : '';
      const text = s && s.omitted ? 'OMITTED' : displayText(b) + headingDay(s, b);
      // an omitted scene carries its dead body inside <OmittedScene>, as Final Draft writes it
      const dead = s && s.omitted ? ((ep.sceneMeta || {})[s.id] || {}).omittedBlocks : null;
      let om = '';
      if (dead && dead.length) {
        const db = dead.filter((d) => FDX_TYPE[d.t]), dp = db.map((d) => '<Paragraph Type="' + FDX_TYPE[d.t] + '"><Text>' + xmlEsc(displayText(d)) + '</Text></Paragraph>');
        for (const pr of dualPairs(db).reverse()) dp.splice(pr.a, pr.e - pr.a + 1, '<Paragraph><DualDialogue>' + dp.slice(pr.a, pr.e + 1).join('') + '</DualDialogue></Paragraph>');
        om = '<OmittedScene>' + dp.join('') + '</OmittedScene>';
      }
      return '    <Paragraph' + (s ? ' Number="' + num + '"' : '') + ' Type="' + FDX_TYPE[b.t] + '">' + props + om + '<Text' + (revs[i] ? ' RevisionID="' + revs[i] + '"' : '') + '>' + xmlEsc(text) + '</Text></Paragraph>';
    });
    // a dual pair goes into one <Paragraph><DualDialogue>…</DualDialogue></Paragraph>, both speeches inside, as Final Draft writes it
    for (const p of dualPairs(ep.blocks || []).reverse()) {
      paras.splice(p.a, p.e - p.a + 1, '    <Paragraph><DualDialogue>\n' + paras.slice(p.a, p.e + 1).map((x) => '  ' + x).join('\n') + '\n    </DualDialogue></Paragraph>');
    }
    const el = (name, f, behavior) => '    <ElementSettings Type="' + name + '"><FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="Courier New" RevisionID="0" Size="12" Style=""/><ParagraphSpec Alignment="' + (f.right ? 'Right' : 'Left') + '" FirstIndent="0.00" Leading="Regular" LeftIndent="' + f.indent.toFixed(2) + '" RightIndent="' + (f.right ? rightEdge(f, paper) : f.indent + f.width / 10).toFixed(2) + '" SpaceBefore="' + (f.sb * 12) + '" Spacing="1" StartsNewPage="No"/><Behavior PaginateAs="' + name + '" ReturnKey="' + behavior + '" Shortcut=""/></ElementSettings>';
    const chars = Object.keys(project.chars || {}).sort();
    const locs = new Set();
    st.scenes.filter((s) => !s.omitted).forEach((s) => { const h = s.h; if (h.object) locs.add(h.object + (h.sub ? '. ' + h.sub : '')); });
    return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n  <Content>\n' + paras.join('\n') + '\n  </Content>\n' +
      fdxTitleXML(ep, project, opts.today) +
      el('Scene Heading', F.scene, 'Action') + '\n' + el('Action', F.action, 'Action') + '\n' + el('Character', F.character, 'Dialogue') + '\n' +
      el('Parenthetical', F.paren, 'Dialogue') + '\n' + el('Dialogue', F.dialogue, 'Action') + '\n' + el('Transition', F.transition, 'Scene Heading') + '\n' + el('Shot', F.shot, 'Action') + '\n' +
      '  <PageLayout BackgroundColor="#FFFFFFFFFFFF" BottomMargin="' + Math.round(paper.bottom * 72) + '" BreakDialogueAndActionAtSentences="Yes" DocumentLeading="Normal" FooterMargin="36" ForegroundColor="#000000000000" HeaderMargin="36" InvisiblesColor="#A0A0A0A0A0A0" TopMargin="' + Math.round(paper.top * 72) + '" UsesSmartQuotes="Yes"><AutoCastList AddParentheses="Yes" AutomaticallyGenerate="No" CastListElement="Cast List"/></PageLayout>\n' + fdxRevisions(ep, revs) +
      '  <SmartType>\n    <Characters>\n' + chars.map((c) => '      <Character>' + xmlEsc(c) + '</Character>').join('\n') + '\n    </Characters>\n' +
      '    <Extensions>\n' + EXTENSIONS.map((x) => '      <Extension>' + xmlEsc(x) + '</Extension>').join('\n') + '\n    </Extensions>\n' +
      '    <SceneIntros>\n' + PREFIXES.map((x) => '      <SceneIntro>' + xmlEsc(x) + '</SceneIntro>').join('\n') + '\n    </SceneIntros>\n' +
      '    <Locations>\n' + [...locs].sort().map((x) => '      <Location>' + xmlEsc(x) + '</Location>').join('\n') + '\n    </Locations>\n' +
      '    <TimesOfDay Separator=" - ">\n' + TIMES.map((x) => '      <TimeOfDay>' + x + '</TimeOfDay>').join('\n') + '\n    </TimesOfDay>\n' +
      '    <Transitions>\n' + TRANSITIONS.map((x) => '      <Transition>' + xmlEsc(x) + '</Transition>').join('\n') + '\n    </Transitions>\n  </SmartType>\n</FinalDraft>\n';
  }
  // Final Draft's revision sets (48-bit colours, ID = level); written only for an episode that has revisions
  function fdxRevisions(ep, revs) {
    const max = Math.max(ep.revLevel || 0, ...revs.map((x) => x || 0), 0);
    if (!max) return '';
    const c48 = (hex) => '#' + hex.slice(1).toUpperCase().replace(/../g, (h) => h + h);
    const sets = [];
    for (let lv = 1; lv <= max; lv++) sets.push('    <Revision Color="' + c48(revColor(lv)) + '" FullRevision="No" ID="' + lv + '" Mark="*" Name="' + xmlEsc(revName(lv)) + '" Style=""/>');
    return '  <Revisions ActiveSet="' + (ep.revLevel || max) + '" Location="7.75" RevisionMode="Active" RevisionsShown="Active" ShowAllMarks="No" ShowAllSets="No" ShowPageColor="No">\n' + sets.join('\n') + '\n  </Revisions>\n';
  }
  // a script day kept only in the scene card goes into the heading text ("ИНТ. КУХНЯ - ДЕНЬ 2"), where Final Draft, FilmToolz and our import read it
  function headingDay(s, b) {
    const d = s && !s.omitted && b.t === 'scene' ? String(s.day || '').replace(/\D/g, '') : '';
    return d && !parseHeading(b.x).day && parseHeading(b.x + ' ' + d).day === d ? ' ' + d : '';
  }
  // an action that Fountain would read as something else (a heading, a cue, a transition, markup) is forced with «!»
  const FNT_LEAD = /^(?:[.!@~=#>]|\[\[|\/\*)/;
  // Fountain has no escape for a speech line that starts with markup, nor for «[[» and «/*» inside text: our export puts a
  // zero-width space there (invisible in any Fountain app) and importText reads such a line as plain text
  const FNT_ZW = '\u200B';
  const fountainInline = (t) => String(t).replace(/\[\[/g, '[' + FNT_ZW + '[').replace(/\/\*/g, '/' + FNT_ZW + '*');
  // the capitals line Fountain import takes for a shot (Fountain itself has no shot element)
  function fountainShotLike(t0) {
    return /^[^!>.@~#=\[(]/.test(t0) && isCaps(t0) && t0.length <= 60 && !HEADING_START.test(t0) && !/\^\s*$/.test(t0) &&
      !/^(СМЕНА КАДРА|ЗАТЕМНЕНИЕ|НАПЛЫВ|ИЗ ЗАТЕМНЕНИЯ|CUT TO|FADE|КОНЕЦ|THE END|ПРОДОЛЖЕНИЕ СЛЕДУЕТ)/i.test(t0) && !/(TO|В):$/.test(t0) && !/^\(.*\)$/.test(t0);
  }
  function fountainForce(t, afterHeading) {
    if (!t) return false;
    if (FNT_LEAD.test(t) || isCaps(t) || /\^\s*$/.test(t)) return true;
    const ctx = afterHeading ? [{ text: 'ИНТ. ДОМ - ДЕНЬ', style: 'Scene Heading' }, { text: '' }] : [];
    const r = classifyLines(ctx.concat([{ text: t, joinable: true }])).slice(afterHeading ? 1 : 0);
    return !(r.length === 1 && r[0].t === 'action' && r[0].x === clean(t));
  }
  // Fountain title page: «Key: value», a value of several lines goes on indented lines under its key
  function fountainTitleLines(ep, project, today) {
    const ti = titleInfo(ep, project, today);
    const kv = (k, v) => (/\n/.test(v) ? [k + ':'].concat(v.split('\n').map((x) => '    ' + x)) : [k + ': ' + v]);
    const out = [...kv('Title', ti.title), ...kv('Episode', (ep.number || '') + (ep.title ? ' ' + ep.title : ''))];
    if (ti.author) out.push(...kv('Author', ti.author));
    out.push(...kv('Draft', ti.draft), ...kv('Draft date', ti.date));
    if (ti.contact) out.push(...kv('Contact', ti.contact));
    for (const [k, v] of ti.extra) out.push(...kv(k, v));
    return out;
  }
  function exportFountain(ep, project, st, opts) {
    st = st || analyzeEpisode(ep, project);
    const out = fountainTitleLines(ep, project, opts && opts.today).concat(['']);
    const sceneByIdx = {}; st.scenes.forEach((s) => { sceneByIdx[s.from] = s; });
    const blocks = ep.blocks || [];
    const dualB = new Set(dualPairs(blocks).map((p) => p.b));
    blocks.forEach((b, i) => {
      const t0 = displayText(b), t = fountainInline(t0);
      const s = sceneByIdx[i];
      const next = blocks[i + 1];
      // Fountain scene number "#12А#"; a blank line ends a speech, so it comes only after its last paren or dialogue
      // the scene's synopsis follows its heading as Fountain's «= …»
      if (b.t === 'scene') out.push('', '.' + (s && s.omitted ? omittedHeading(s.num) : t + headingDay(s, b)) + (s && s.num ? ' #' + s.num + '#' : ''), '', ...(s && s.synopsis && !s.omitted ? ['= ' + fountainInline(clean(s.synopsis)), ''] : []));
      // the second cue of a dual pair carries Fountain's «^»
      else if (b.t === 'character') out.push('@' + t + (dualB.has(i) ? ' ^' : ''));
      // a speech line that Fountain would read as markup (#, =, ===, [[, /*, a forced element, a heading) is escaped
      else if (b.t === 'paren' || b.t === 'dialogue') { out.push((FNT_LEAD.test(t0) || HEADING_START.test(t0) || /\^\s*$/.test(t0) || INLINE_CUE.test(t0) ? FNT_ZW : '') + t); if (!next || (next.t !== 'paren' && next.t !== 'dialogue')) out.push(''); }
      else if (b.t === 'transition') out.push('> ' + t, '');
      // a shot is a capitals line on its own; an action in capitals is forced with «!» so it does not read back as a shot
      // one the import's shot rule would miss (long, «(ДЕТАЛЬ)», «...И ТИШИНА», «В:») carries the zero-width marks
      else if (b.t === 'shot') out.push('', t === t0 && fountainShotLike(t0) ? t : FNT_ZW + t + FNT_ZW, '');
      else out.push((fountainForce(t, i > 0 && blocks[i - 1].t === 'scene') ? '!' : '') + t, '');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // FilmToolz Word import: "1-3. ИНТ. ОБЪЕКТ. ПОДОБЪЕКТ ДЕНЬ 2." + line break + characters + (мм:сс)
  const FT_TIME = { 'ДЕНЬ': 'ДЕНЬ', 'НОЧЬ': 'НОЧЬ', 'УТРО': 'УТРО', 'ВЕЧЕР': 'ВЕЧЕР', 'РАССВЕТ': 'УТРО', 'РАННЕЕ УТРО': 'УТРО', 'РЕЖИМ': 'ВЕЧЕР', 'ЗАКАТ': 'ВЕЧЕР', 'СУМЕРКИ': 'ВЕЧЕР', 'ПОЗДНИЙ ВЕЧЕР': 'ВЕЧЕР' };
  const FT_PREFIX = { int: 'ИНТ.', ext: 'НАТ.', intext: 'НАТ/ИНТ.', pav: 'ПАВ.' };
  function filmtoolzHeading(s, ep) {
    const h = s.h;
    const num = (/^\d+-\d+/.test(s.num) ? s.num : (ep.number || 1) + '-' + s.num) + '. ';
    // a heading without a recognised object («СОН», «ФЛЕШБЭК», empty) keeps its own text instead of vanishing
    const raw = up(String(s.heading || '')).replace(/^\s*(?:\d+-)?[A-ZА-Я]?\d+[\-–.\d]*[А-ЯA-Z]?[.)]?\s+/, '').replace(/[\s.]+$/, '').trim();
    let line = h.object ? (h.type ? FT_PREFIX[h.type] + ' ' : '') + h.object + (h.sub ? '. ' + h.sub : '') : raw || 'БЕЗ ЗАГОЛОВКА';
    const tm = FT_TIME[h.time] || '';
    if (tm && h.object) line += ' ' + tm;
    const day = String(s.day || '').replace(/\D/g, '');
    if (day) line += ' ' + day;
    // FilmToolz reads the heading up to the closing period, so the line always ends with one
    line = num + line.replace(/[\s.]+$/, '') + '.';
    const cast = s.cast.join(', ');
    return { line, cast: (cast ? cast + ' ' : '') + '(' + fmtTime(s.min).padStart(5, '0') + ')' };
  }
  function docxDocumentXML(ep, project, st) {
    const tw = (inch) => Math.round(inch * 1440);
    const sceneByIdx = {}; st.scenes.forEach((s) => { sceneByIdx[s.from] = s; });
    const run = (t) => '<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">' + xmlEsc(t) + '</w:t></w:r>';
    const br = '<w:r><w:br/></w:r>';
    // omitted scenes are not shot, so FilmToolz must not see them
    const skip = new Set(); st.scenes.forEach((s) => { if (s.omitted) for (let i = s.from; i <= s.to; i++) skip.add(i); });
    const paras = (ep.blocks || []).filter((b, i) => !skip.has(i)).map((b, i) => {
      const f = FMT[b.t];
      const left = tw(f.indent - 1.5), right = tw(7.5 - (f.indent + f.width / 10));
      const pPr = '<w:pPr><w:spacing w:before="' + (i === 0 ? 0 : f.sb * 240) + '" w:after="0" w:line="240" w:lineRule="exact"/><w:ind w:left="' + left + '" w:right="' + Math.max(0, right) + '"/>' + (f.right ? '<w:jc w:val="right"/>' : '') + (b.t === 'scene' || b.t === 'character' || b.t === 'shot' ? '<w:keepNext/>' : '') + '</w:pPr>';
      const s = st.scenes.find((x) => x.id === b.id);
      if (b.t === 'scene' && s) {
        const ft = filmtoolzHeading(s, ep);
        return '<w:p>' + pPr + run(ft.line) + br + run(ft.cast) + '</w:p>';
      }
      return '<w:p>' + pPr + run(displayText(b)) + '</w:p>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras.join('') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="2160" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }
  const DOCX_STATIC = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  };

  // docx import: paragraphs with indent (inches from sheet edge, assuming the left page margin) and style
  // styles.xml: style id -> {name, indent (inches from the sheet edge)}; the ids are opaque ("af0"), the names mean something
  function docxStyles(xml, DOMParserImpl) {
    const map = {};
    if (!xml) return map;
    const doc = new (DOMParserImpl || DOMParser)().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const sts = doc.getElementsByTagNameNS(W, 'style');
    for (let i = 0; i < sts.length; i++) {
      const st = sts[i];
      if (st.getAttributeNS(W, 'type') !== 'paragraph') continue;
      const nm = st.getElementsByTagNameNS(W, 'name')[0];
      const ind = st.getElementsByTagNameNS(W, 'ind')[0];
      const based = st.getElementsByTagNameNS(W, 'basedOn')[0];
      map[st.getAttributeNS(W, 'styleId')] = {
        name: nm ? nm.getAttributeNS(W, 'val') : '', basedOn: based ? based.getAttributeNS(W, 'val') : '',
        indent: ind ? parseInt(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start') || '0', 10) / 1440 : null,
      };
    }
    return map;
  }
  function docxParagraphs(xml, DOMParserImpl, styles) {
    styles = styles || {};
    const doc = new (DOMParserImpl || DOMParser)().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const ps = doc.getElementsByTagNameNS(W, 'p');
    const out = [];
    // a hand-formatted script indents only cues, parentheticals and dialogue: then an unindented paragraph sits at the page margin
    // (a stray indented paragraph or two does not count, the plain-text heuristics stay for such a document)
    const leftOf = (p) => { const ind = p.getElementsByTagNameNS(W, 'ind')[0]; const st = p.getElementsByTagNameNS(W, 'pStyle')[0]; const sd = styles[st ? st.getAttributeNS(W, 'val') : ''] || {};
      return ind ? parseInt(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start') || '0', 10) / 1440 : sd.indent; };
    let nonEmpty = 0, indented = 0;
    for (let i = 0; i < ps.length; i++) { if (!ps[i].textContent.trim()) continue; nonEmpty++; if (leftOf(ps[i]) >= 0.5) indented++; }
    const marginKnown = indented >= Math.max(3, nonEmpty * 0.1);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const ind = p.getElementsByTagNameNS(W, 'ind')[0];
      const st = p.getElementsByTagNameNS(W, 'pStyle')[0];
      const jc = p.getElementsByTagNameNS(W, 'jc')[0];
      const styleId = st ? st.getAttributeNS(W, 'val') : '';
      const sdef = styles[styleId] || {};
      let left = ind ? parseInt(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start') || '0', 10) / 1440 : (sdef.indent != null ? sdef.indent : 0);
      const hasIndent = !!ind || sdef.indent != null || marginKnown;
      let parts = [''];
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          if (c.localName === 't') parts[parts.length - 1] += c.textContent;
          else if (c.localName === 'tab') parts[parts.length - 1] += ' ';
          // Ctrl+Shift+- in Word: "кто-то", "САНКТ-ПЕТЕРБУРГ" (a plain hyphen, so names match those typed in the app)
          else if (c.localName === 'noBreakHyphen') parts[parts.length - 1] += '-';
          else if (c.localName === 'br' || c.localName === 'cr') parts.push('');
          else if (c.localName !== 'pPr') walk(c);
        }
      };
      walk(p);
      const style = sdef.name || styleId;
      const right = jc && /right|end/.test(jc.getAttributeNS(W, 'val'));
      parts.forEach((t, k) => out.push({ text: t, indent: hasIndent || right ? 1.5 + left + (right ? 4 : 0) : null, style: k === 0 ? style : '', fromBreak: k > 0 }));
    }
    // FilmToolz-style heading with a line break: the second line lists characters and time, which the app computes itself
    return out.filter((l, k) => !(l.fromBreak && out[k - 1] && HEADING_START.test(out[k - 1].text)));
  }

  // pdf import: text items -> lines with x position in inches
  function pdfLines(pagesItems) {
    const lines = [];
    // a title page (no scene headings on the first page of a multi-page file) is skipped
    const hasHeading = (items) => items.some((it) => HEADING_START.test(it.str || ''));
    if (pagesItems.length > 1 && !hasHeading(pagesItems[0]) && pagesItems.slice(1).some(hasHeading)) pagesItems = pagesItems.slice(1);
    // watermarks (rotated) and footers or stamps in a smaller or larger size are not script text: the script is one size
    const sizes = pagesItems.flat().filter((it) => it.h && !it.rot && it.str && it.str.trim()).map((it) => it.h).sort((a, b) => a - b);
    const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    pagesItems = pagesItems.map((items) => items.filter((it) => !it.rot && !(body && it.h && (it.h < body * 0.8 || it.h > body * 1.3))));
    for (const items of pagesItems) {
      const rows = [];
      for (const it of items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.y);
        let row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push(it);
      }
      rows.sort((a, b) => b.y - a.y);
      let prevY = null;
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x);
        // scene numbers printed in the margins (12, 12А, 51-12, A1) are not part of the text, but the left one is the scene's number
        const num = /^\s*(?:\d+-)?[A-ZА-Я]?\d+(?:[\-–.]\d+)*[A-ZА-Я]?\.?\s*$/;
        let lnum = '';
        while (r.parts.length > 1 && num.test(r.parts[0].str)) lnum = lnum || clean(r.parts.shift().str).replace(/\.$/, '');
        while (r.parts.length > 1 && num.test(r.parts[r.parts.length - 1].str)) r.parts.pop();
        let text = '';
        let endX = null;
        for (const p of r.parts) {
          if (endX != null && p.x - endX > 1.5) text += ' ';
          text += p.str; endX = p.x + (p.w || 0);
        }
        text = clean(text);
        if (/^\d+\.?$/.test(text) && r === rows[0]) { prevY = null; continue; }
        if (/^\(?(ДАЛЬШЕ|MORE)\)?$/i.test(text)) continue;
        text = text.replace(/\s*\((ПРОД|CONT'?D)\.?\)\s*$/i, '');
        if (num.test(text)) continue;
        const gapBefore = prevY != null && prevY - r.y > 18;
        // only the right copy of the left number is dropped: a lone trailing number is the script day ("ДЕНЬ 2")
        let out = text.replace(/^(?:\d+-)?[A-ZА-Я]?\d+(?:[\-–.]\d+)*[A-ZА-Я]?\.?\s+(?=(ИНТ|НАТ|ПАВ|INT|EXT))/i, (m) => { lnum = lnum || m.trim().replace(/\.$/, ''); return ''; })
          .replace(/\s+(?:\d+-)?[A-ZА-Я]?\d+(?:[\-–.]\d+)*[A-ZА-Я]?\.?$/, (m) => HEADING_START.test(text) && lnum && clean(m).replace(/\.$/, '') === lnum ? '' : m);
        // the heading carries its number into classifyLines, which keeps it as the scene's number
        if (lnum && HEADING_START.test(out)) out = lnum + '. ' + out;
        lines.push({ text: out, indent: r.parts[0].x / 72, gapBefore, joinable: !gapBefore });
        prevY = r.y;
      }
    }
    return lines;
  }

  function demoProject() {
    const B = (t, x) => ({ id: uid(), t, x });
    const blocks = [
      B('scene', 'ПАВ. КВАРТИРА ВОРОНОВЫХ. КУХНЯ - УТРО'),
      B('action', 'Тесная кухня. На плите шипит сковородка. ЛЕНА ВОРОНОВА (38) одновременно жарит сырники, проверяет дневник сына и отвечает на рабочий чат.'),
      B('action', 'Входит ИГОРЬ ВОРОНОВ (40), в одном носке, с телефоном у уха.'),
      B('character', 'ИГОРЬ'),
      B('paren', '(в телефон)'),
      B('dialogue', 'Да, Борис Петрович. Конечно. Уже выезжаю. Практически в пробке.'),
      B('action', 'Отключается. Садится за стол. Берёт сырник.'),
      B('character', 'ЛЕНА'),
      B('dialogue', 'Ты в пробке в одном носке?'),
      B('character', 'ИГОРЬ'),
      B('dialogue', 'Это стратегическая пробка. Я в ней с понедельника. Где второй носок?'),
      B('character', 'ЛЕНА'),
      B('dialogue', 'Там же, где твоя совесть. Миша опять получил двойку по русскому. Учительница пишет, что он написал «жы» и обосновал это свободой слова.'),
      B('character', 'МИША (ЗК)'),
      B('dialogue', 'Это была позиция!'),
      B('scene', 'ПАВ. КВАРТИРА ВОРОНОВЫХ. ДЕТСКАЯ - УТРО'),
      B('action', 'МИША (14) лежит на кровати в наушниках и делает вид, что спит. Лена входит, снимает с него один наушник.'),
      B('character', 'ЛЕНА'),
      B('dialogue', 'Позиция у тебя будет у доски. С объяснительной. Вставай.'),
      B('character', 'МИША'),
      B('dialogue', 'Мам, по статистике подростки, которых будят до восьми, хуже усваивают материал.'),
      B('character', 'ЛЕНА'),
      B('dialogue', 'По статистике мамы, которых доводят до восьми, хуже усваивают подростков.'),
      B('scene', 'ИНТ. ОФИС «ГОРСТРОЙ». ОПЕНСПЕЙС - ДЕНЬ'),
      B('action', 'Игорь пробирается к своему столу, стараясь не попасться на глаза. За стеклянной стеной кабинета БОРИС ПЕТРОВИЧ (60) разговаривает с ИНВЕСТОРОМ.'),
      B('character', 'СВЕТА'),
      B('paren', '(шёпотом)'),
      B('dialogue', 'Он тебя искал. Три раза. На третий раз сказал «ну-ну».'),
      B('character', 'ИГОРЬ'),
      B('dialogue', '«Ну-ну» — это хорошо или плохо?'),
      B('character', 'СВЕТА'),
      B('dialogue', 'Это как «жы». Зависит от позиции.'),
      B('scene', 'НАТ. ДВОР ДОМА ВОРОНОВЫХ - НОЧЬ'),
      B('action', 'Игорь сидит на детской площадке с пакетом из магазина. Рядом садится сосед ПАВЛИК (45) с собакой.'),
      B('character', 'ПАВЛИК'),
      B('dialogue', 'Опять не пускают?'),
      B('character', 'ИГОРЬ'),
      B('dialogue', 'Я сам не захожу. Готовлю речь.'),
      B('scene', 'ИНТ. БОЛЬНИЦА. ПРИЁМНЫЙ ПОКОЙ - ДЕНЬ'),
      B('action', 'Лена с Мишей сидят в очереди. У Миши перебинтован палец.'),
      B('character', 'МИША'),
      B('dialogue', 'Это был эксперимент.'),
      B('scene', 'ПАВ. КВАРТИРА ВОРОНОВЫХ. КУХНЯ - ВЕЧЕР'),
      B('action', 'Вся семья за столом. Игорь, Лена, Миша. Тишина. Слышно, как тикают часы.'),
      B('character', 'ИГОРЬ'),
      B('dialogue', 'Меня повысили.'),
      B('action', 'Лена роняет вилку. Миша снимает наушники.'),
      B('character', 'ЛЕНА'),
      B('dialogue', 'За что?'),
      B('character', 'ИГОРЬ'),
      B('dialogue', 'Говорят, за стратегическое мышление. Я три дня стоял в пробке, которой не было, и за это время придумал, как сократить им смету на сорок процентов.'),
      B('transition', 'ЗАТЕМНЕНИЕ.'),
    ];
    const sceneIds = blocks.filter((b) => b.t === 'scene').map((b) => b.id);
    const ep1 = {
      id: uid(), season: 1, number: 1, title: 'Стратегическая пробка', blocks, updated: Date.now(),
      sceneMeta: { [sceneIds[3]]: { tags: ['animals'], day: '1', synopsis: 'Игорь боится идти домой' }, [sceneIds[4]]: { tags: [], day: '2' }, [sceneIds[0]]: { tags: [], day: '1', synopsis: 'Утро Вороновых' } },
      comments: [], drafts: [], checks: {},
    };
    ep1.comments.push({ id: uid(), blockId: blocks[12].id, quote: 'обосновал это свободой слова', text: 'Отличная шутка, оставляем. Но проверьте, чтобы Миша не выглядел совсем хамом — канал просил мягче.', author: 'Продюсер', role: 'producer', date: Date.now() - 3600e3, resolved: false, replies: [] });
    ep1.comments.push({ id: uid(), blockId: blocks[38].id, quote: 'ПРИЁМНЫЙ ПОКОЙ', text: 'Больница на одну сцену — производство не согласует. Перенесите в квартиру или добавьте больничный объём во 2-й серии.', author: 'Продюсер', role: 'producer', date: Date.now() - 1800e3, resolved: false, replies: [] });
    const ep2 = { id: uid(), season: 1, number: 2, title: 'Новая должность', blocks: [
      B('scene', 'ПАВ. КВАРТИРА ВОРОНОВЫХ. ПРИХОЖАЯ - УТРО'),
      B('action', 'Игорь в новом костюме крутится перед зеркалом.'),
      B('character', 'ИГОРЬ'),
      B('dialogue', 'Начальник отдела. Звучит?'),
    ], sceneMeta: {}, comments: [], drafts: [], checks: {}, updated: Date.now() - 86400e3 };
    return {
      id: uid(), name: 'Вороновы (демо)', author: '', rules: Object.assign({}, DEFAULT_RULES),
      chars: {
        'ЛЕНА': { age: '38', desc: 'Мать семейства, менеджер проектов', minor: false, guest: false },
        'ИГОРЬ': { age: '40', desc: 'Муж Лены, инженер-сметчик', minor: false, guest: false },
        'МИША': { age: '14', desc: 'Сын, философ-нигилист', minor: true, guest: false },
        'СВЕТА': { age: '30', desc: 'Коллега Игоря', minor: false, guest: false },
        'БОРИС ПЕТРОВИЧ': { age: '60', desc: 'Начальник Игоря', minor: false, guest: true },
        'ПАВЛИК': { age: '45', desc: 'Сосед', minor: false, guest: false },
      },
      locs: {
        'КВАРТИРА ВОРОНОВЫХ': { pav: true, base: true, main: true },
        'ОФИС «ГОРСТРОЙ»': { pav: false, base: true, main: false },
      },
      relations: [{ a: 'ЛЕНА', b: 'ИГОРЬ', label: 'супруги' }, { a: 'ЛЕНА', b: 'МИША', label: 'мать и сын' }, { a: 'ИГОРЬ', b: 'СВЕТА', label: 'коллеги' }],
      episodes: [ep1, ep2],
      created: Date.now(),
    };
  }

  const LINE_COLORS = ['#2346c8', '#b26a00', '#1f7a46', '#8e24aa', '#b3261e', '#00838f'];
  const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map((x) => up(clean(x))).filter(Boolean);
  // Automatic line by the project's rules, in this order:
  // 0. a special category by heading keywords (ЗАЯВОЧНЫЙ ПЛАН, ФЛЭШФОРВАРД) wins over everything;
  // 1. unambiguous objects: a heading substring of a line (prefixes without endings, typos included);
  // 2. disputed objects: the owner named in the heading, matched by whole words;
  // 3. the scene's cast: any character of the priority line, else of another line.
  function autoLine(s, project) {
    const lines = project.lines || [];
    if (!lines.length) return null;
    const head = up(s.heading || '');
    const words = head.split(/[^А-ЯЁA-Z0-9]+/).filter(Boolean);
    const lr = project.lineRules || {};
    const special = lr.special || {};
    const skw = listOf(special.keywords);
    if (special.name && skw.some((k) => head.includes(k))) return { line: special.name, how: 'спецсцена' };
    for (const l of lines) if (listOf(l.objects).some((k) => head.includes(k))) return { line: l.name, how: 'объект' };
    for (const l of lines) if (listOf(l.owners).some((k) => words.includes(k))) return { line: l.name, how: 'владелец' };
    const cast = (s.cast || []).map((c) => up(c));
    const first = (n) => n.split(/[\s-]/)[0];
    const has = (l) => listOf(l.chars).some((k) => cast.includes(k) || cast.some((c) => first(c) === k));
    const order = lines.slice().sort((a, b) => (a.name === lr.priority ? -1 : 0) - (b.name === lr.priority ? -1 : 0));
    for (const l of order) if (has(l)) return { line: l.name, how: 'персонажи' };
    return null;
  }
  // "Группа А: 50" per line -> [{name, target}]
  function parseLines(text) {
    return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const m = l.match(/^(.*?)\s*[:=]\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/);
      return { name: m ? m[1].trim() : l, target: m ? parseFloat(m[2].replace(',', '.')) : null, color: LINE_COLORS[i % LINE_COLORS.length] };
    });
  }
  // ---------- history (time rewind) ----------
  // Every snapshot is kept. To fit in the browser they are stored as reverse deltas: the newest snapshot is whole, each
  // older one keeps only what differs from the next one (ops: [from, count] runs of that snapshot's blocks, or a block
  // itself; inh: fields equal to it). Every HIST.key-th snapshot stays whole, so a restore never walks a long chain.
  // Snapshots written whole by older versions are read as they are. Versions are dropped only over a storage budget
  // (thinHistory), oldest automatic ones first; marked ones (keep) never.
  const HIST = { key: 30, budget: 40e6, dense: 24 * 3600e3, hourly: 7 * 24 * 3600e3 };
  const HIST_FIELDS = ['blocks', 'sceneMeta', 'lock', 'revisions', 'revLevel', 'pageLock', 'tags', 'titlePage', 'sugs'];
  const histIsDelta = (h) => !!(h && Array.isArray(h.ops));
  // a short fingerprint of a state (a snapshot used to keep the whole JSON of the episode a second time for this)
  function hashStr(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + ':' + s.length.toString(36);
  }
  const histSig = (state) => hashStr(JSON.stringify(state));
  const sigOf = (h) => (h && typeof h.sig === 'string' && h.sig.length > 64 ? (h.sig = hashStr(h.sig)) : h && h.sig);
  const sameJSON = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  // cur as a delta against ref (the next, newer snapshot)
  function histEncode(cur, ref) {
    const out = {};
    for (const k of Object.keys(cur)) if (!HIST_FIELDS.includes(k) && k !== 'sz') out[k] = cur[k];
    const pos = new Map((ref.blocks || []).map((b, i) => [b.id, i])), ops = [];
    for (const b of cur.blocks || []) {
      const j = pos.get(b.id), last = ops[ops.length - 1];
      if (j != null && sameJSON(ref.blocks[j], b)) { if (Array.isArray(last) && last[0] + last[1] === j) last[1]++; else ops.push([j, 1]); }
      else ops.push(b);
    }
    out.ops = ops;
    const inh = [];
    for (const f of HIST_FIELDS) {
      if (f === 'blocks' || !(f in cur)) continue;
      if (f in ref && sameJSON(cur[f], ref[f])) inh.push(f); else out[f] = cur[f];
    }
    if (inh.length) out.inh = inh;
    out.sz = JSON.stringify(out).length;
    return out;
  }
  function histDecode(d, ref) {
    const out = {};
    for (const k of Object.keys(d)) if (k !== 'ops' && k !== 'inh' && k !== 'sz') out[k] = d[k];
    const blocks = [];
    for (const op of d.ops) { if (Array.isArray(op)) for (let q = op[0]; q < op[0] + op[1]; q++) blocks.push(ref.blocks[q]); else blocks.push(op); }
    out.blocks = blocks;
    for (const f of d.inh || []) out[f] = ref[f];
    return out;
  }
  // the whole state of snapshot i (old whole snapshots come back as they are); shared parts are not copied
  function histState(list, i) {
    const h = list[i];
    if (!h || !histIsDelta(h)) return h || null;
    let j = i + 1; while (j < list.length && histIsDelta(list[j])) j++;
    if (j >= list.length) return null;
    let st = list[j];
    for (let k = j - 1; k >= i; k--) st = histDecode(list[k], st);
    return st;
  }
  // every state, newest to oldest in one pass (for thinning)
  function histStates(list) {
    const out = new Array(list.length);
    for (let i = list.length - 1; i >= 0; i--) out[i] = histIsDelta(list[i]) ? (out[i + 1] ? histDecode(list[i], out[i + 1]) : null) : list[i];
    return out;
  }
  const histEntrySize = (h) => h.sz || (h.sz = JSON.stringify(h).length);
  const histSize = (list) => list.reduce((a, h) => a + histEntrySize(h), 0);
  // a new whole snapshot goes on the end; the one before it becomes a delta unless it is a key snapshot
  function histPush(list, h) {
    list.forEach(sigOf);
    const n = list.length, last = list[n - 1];
    if (last && !histIsDelta(last)) {
      let c = 0; for (let k = n - 2; k >= 0 && histIsDelta(list[k]); k--) c++;
      if (c < HIST.key - 1 && list.length > 0) list[n - 1] = histEncode(last, h);
    }
    delete h.sz; histEntrySize(h);
    list.push(h);
    return list;
  }
  // Over the budget only: first the old tiers (every snapshot for a day, one an hour for a week, one a day after), then the
  // oldest automatic snapshots. Marked snapshots (keep) and the newest one are never dropped. Returns the list (new array)
  // with .dropped = how many went.
  function thinHistory(list, budget, now) {
    now = now || Date.now();
    budget = budget == null ? HIST.budget : budget;
    // within the budget the list itself comes back (callers keep one array per episode)
    if (histSize(list) <= budget || list.length < 2) return list;
    // stored order is date order; deltas refer to the next entry, so the order is never changed here
    const out = list.slice();
    Object.defineProperty(out, 'dropped', { value: 0, writable: true, enumerable: false });
    let size = histSize(out);
    const states = histStates(out);
    const drop = (i) => {
      size -= histEntrySize(out[i]);
      out.splice(i, 1); states.splice(i, 1); out.dropped++;
      // the snapshot before it was a delta against the one dropped: now against the next one
      if (i > 0 && histIsDelta(out[i - 1]) && states[i - 1] && states[i]) { size -= histEntrySize(out[i - 1]); out[i - 1] = histEncode(states[i - 1], states[i]); size += out[i - 1].sz; }
    };
    const tier = (h) => { const age = now - h.date; return age < HIST.dense ? 'd' + h.date : age < HIST.hourly ? 'h' + Math.floor(h.date / 3600e3) : 'D' + Math.floor(h.date / 86400e3); };
    for (let i = 0; i < out.length - 1 && size > budget;) {
      if (!out[i].keep && !out[i + 1].keep && tier(out[i]) === tier(out[i + 1])) drop(i); else i++;
    }
    for (let i = 0; i < out.length - 1 && size > budget;) { if (!out[i].keep) drop(i); else i++; }
    return out;
  }
  // put one scene from a snapshot back into the current text; the rest of the text is untouched
  function restoreScene(cur, snap, sceneId) {
    const ss = sceneSplit(snap); const sc = ss.find((s) => s.id === sceneId);
    if (!sc) return null;
    const have = new Set(cur.map((b) => b.id));
    const cs = sceneSplit(cur); const at = cs.find((s) => s.id === sceneId);
    const out = cur.slice();
    if (at) {
      for (let i = at.from; i <= at.to; i++) have.delete(cur[i].id);
      const piece = snap.slice(sc.from, sc.to + 1).map((b) => Object.assign({}, b, { id: have.has(b.id) ? uid() : b.id }));
      out.splice(at.from, at.to - at.from + 1, ...piece);
      return { blocks: out, how: 'replaced' };
    }
    const piece = snap.slice(sc.from, sc.to + 1).map((b) => Object.assign({}, b, { id: have.has(b.id) ? uid() : b.id }));
    let pos = null;
    for (const s of ss) { if (s.id === sceneId) break; const c = cs.find((x) => x.id === s.id); if (c) pos = c.to + 1; }
    if (pos == null) { const idx = ss.indexOf(sc); pos = cs[idx] ? cs[idx].from : cur.length; }
    out.splice(pos, 0, ...piece);
    return { blocks: out, how: 'inserted' };
  }
  // the pages of a layout as block ranges: page k holds the blocks that start on it (a block carried over from the page
  // before stays with that page); a page that only continues an earlier block has no range of its own
  function pageRanges(lay) {
    const first = [];
    lay.pages.forEach((pg, k) => pg.items.forEach((it) => { if (it.i != null && first[it.i] == null) first[it.i] = k; }));
    const out = [];
    first.forEach((k, i) => {
      const r = out[out.length - 1];
      if (r && r.k === k) r.to = i; else out.push({ k, label: (lay.labels || [])[k] || String(k + 1), from: i, to: i });
    });
    return out;
  }
  // put blocks from..to of a snapshot (one page) back into the current text, the way restoreScene does for a scene:
  // what stands between the page's neighbours now is replaced; without them, the span of the page's own elements; if
  // none of it is left, the page goes in after the nearest earlier element the text still has
  // Returns { blocks, at, count, removed, ids, kept }: ids = the restored elements, at = where the first of them stands,
  // kept = elements left in place between them (text written inside the page since, when the span had grown too large).
  function restoreRange(cur, snap, from, to) {
    const piece0 = snap.slice(from, to + 1);
    if (!piece0.length) return null;
    const pos = new Map(cur.map((b, i) => [b.id, i]));
    const prev = from > 0 ? pos.get(snap[from - 1].id) : -1, next = to + 1 < snap.length ? pos.get(snap[to + 1].id) : cur.length;
    // between the neighbours, unless that span has grown far beyond the page (text written in between since)
    if (prev != null && next != null && prev < next && next - prev - 1 <= piece0.length * 3 + 10) {
      const a = prev + 1, z = next - 1;
      const have = new Set(cur.map((b) => b.id));
      for (let i = a; i <= z; i++) have.delete(cur[i].id);
      const piece = piece0.map((b) => Object.assign({}, b, { id: have.has(b.id) ? uid() : b.id }));
      const out = cur.slice();
      out.splice(a, z - a + 1, ...piece);
      return { blocks: out, at: a, count: piece.length, removed: z - a + 1, ids: piece.map((b) => b.id), kept: 0 };
    }
    // otherwise only the page's own elements: each one still there is replaced in place, one deleted since comes back
    // next to its nearest surviving neighbour of the page; anything else in between (written since) stays
    const live = piece0.filter((b) => pos.has(b.id));
    if (!live.length) {
      let a = 0;
      for (let q = from - 1; q >= 0; q--) if (pos.has(snap[q].id)) { a = pos.get(snap[q].id) + 1; break; }
      const piece = piece0.map((b) => Object.assign({}, b));
      const out = cur.slice();
      out.splice(a, 0, ...piece);
      return { blocks: out, at: a, count: piece.length, removed: 0, ids: piece.map((b) => b.id), kept: 0 };
    }
    // missing elements: those before the first survivor go in front of it, the others right after the survivor before them
    const before = new Map(), after = new Map();
    let anchor = null; const lead = [];
    for (const b of piece0) {
      if (pos.has(b.id)) { anchor = b.id; continue; }
      const c = Object.assign({}, b);
      if (!anchor) lead.push(c); else { if (!after.has(anchor)) after.set(anchor, []); after.get(anchor).push(c); }
    }
    before.set(live[0].id, lead);
    const snapOf = new Map(piece0.map((b) => [b.id, b]));
    const out = [], ids = [];
    let at = -1, lo = Infinity, hi = -1;
    for (const b of cur) {
      const s0 = snapOf.get(b.id);
      if (!s0) { out.push(b); continue; }
      const group = (before.get(b.id) || []).concat([Object.assign({}, s0)], after.get(b.id) || []);
      if (at < 0) at = out.length;
      lo = Math.min(lo, out.length);
      out.push(...group); ids.push(...group.map((x) => x.id));
      hi = out.length - 1;
    }
    const idSet = new Set(ids);
    let kept = 0; for (let i = lo; i <= hi; i++) if (!idSet.has(out[i].id)) kept++;
    return { blocks: out, at, count: ids.length, removed: live.length, ids, kept };
  }

  // ---------- who changed what ----------
  // Every element carries its last editor and time (lastBy, lastAt). An element whose type, text and dual flag are the
  // same as in prev keeps prev's stamp; a new or changed one gets who/at. The stamp never counts as text: revisions,
  // exports and text comparisons (blocksSig) ignore it.
  function stampBlocks(prev, next, who, at) {
    const was = new Map((prev || []).map((b) => [b.id, b]));
    return next.map((b) => {
      const p = was.get(b.id);
      const same = p && p.t === b.t && (p.x || '') === (b.x || '') && !!p.dual === !!b.dual;
      if (same) {
        if (p.lastBy === b.lastBy && p.lastAt === b.lastAt) return b;
        const o = Object.assign({}, b);
        if (p.lastBy) { o.lastBy = p.lastBy; o.lastAt = p.lastAt; } else { delete o.lastBy; delete o.lastAt; }
        return o;
      }
      if (!who) return b;
      return Object.assign({}, b, { lastBy: who, lastAt: at || Date.now() });
    });
  }
  const STAMP_KEYS = { lastBy: 1, lastAt: 1 };
  const blocksSig = (blocks) => JSON.stringify(blocks, (k, v) => (STAMP_KEYS[k] ? undefined : v));
  // the editors of an episode, most text first: [{name, n}]
  function blockAuthors(blocks) {
    const m = new Map();
    for (const b of blocks || []) if (b.lastBy) m.set(b.lastBy, (m.get(b.lastBy) || 0) + 1);
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }

  // ---------- suggestions (Правка → «Режим предложений», track changes) ----------
  // The text model (ep.blocks) holds accepted text only: pagination, analysis, revisions and every export read it and
  // never see a suggestion. Suggestions are records beside it (ep.sugs), each with an id, author (by) and time (at):
  //   { k:'ins', bid, off, x, ctx }  text x proposed at offset off of block bid's accepted text (ctx: the accepted text
  //                                  just before it, so the place is found again after the text around it changed)
  //   { k:'del', bid, off, x }       accepted text x at off proposed for deletion
  //   { k:'add', bid, after, t, x }  a whole new element bid (type t, text x) after element `after` (null: first)
  //   { k:'rm', bid }                accepted element bid proposed for deletion
  // On screen a block is a list of segments: '=' accepted, '+' inserted, '-' struck ({k, x, id, by, at}).
  // ep.sugGone keeps the ids accepted, rejected or withdrawn, so a merge of two copies does not bring them back.
  const SG_CTX = 12;
  // segments of one accepted block from its text and its records (records that no longer fit are left out)
  function sgBlockSegs(x, ins, dels, dropped) {
    x = x || '';
    const placed = [];
    for (const d of (dels || []).slice().sort((a, b) => a.off - b.off || String(a.id).localeCompare(String(b.id)))) {
      if (!d.x) { dropped.push(d.id); continue; }
      const free = (p) => p >= 0 && p + d.x.length <= x.length && x.substr(p, d.x.length) === d.x && !placed.some((q) => p < q.off + q.x.length && q.off < p + d.x.length);
      let at = free(d.off) ? d.off : -1;
      if (at < 0) {
        // the text moved: the nearest free occurrence of the struck words
        let best = -1;
        for (let p = x.indexOf(d.x); p >= 0; p = x.indexOf(d.x, p + 1)) if (free(p) && (best < 0 || Math.abs(p - d.off) < Math.abs(best - d.off))) best = p;
        at = best;
      }
      if (at < 0) { dropped.push(d.id); continue; }
      placed.push(Object.assign({}, d, { off: at }));
    }
    const delAt = new Array(x.length).fill(null);
    for (const d of placed) for (let q = d.off; q < d.off + d.x.length; q++) delAt[q] = d;
    const insAt = {};
    for (const s of ins || []) {
      if (!s.x) { dropped.push(s.id); continue; }
      let off = Math.max(0, Math.min(x.length, s.off | 0));
      if (s.ctx && x.slice(Math.max(0, off - s.ctx.length), off) !== s.ctx) {
        let best = -1;
        for (let p = x.indexOf(s.ctx); p >= 0; p = x.indexOf(s.ctx, p + 1)) if (best < 0 || Math.abs(p + s.ctx.length - off) < Math.abs(best + s.ctx.length - off)) best = p;
        if (best >= 0) off = best + s.ctx.length;
      }
      // never inside a struck run: after it, as a replacement reads (~~old~~new)
      while (off > 0 && off < x.length && delAt[off] && delAt[off] === delAt[off - 1]) off++;
      (insAt[off] = insAt[off] || []).push(s);
    }
    const chars = [];
    for (let p = 0; p <= x.length; p++) {
      for (const s of (insAt[p] || []).sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id)))) for (const c of s.x) chars.push({ c, k: '+', id: s.id, by: s.by, at: s.at });
      if (p < x.length) { const d = delAt[p]; chars.push(d ? { c: x[p], k: '-', id: d.id, by: d.by, at: d.at } : { c: x[p], k: '=' }); }
    }
    return sgGroup(chars);
  }
  // characters back into runs; a run is one kind and one record
  function sgGroup(chars) {
    const out = [];
    for (const ch of chars) {
      const last = out[out.length - 1];
      if (last && last.k === ch.k && (ch.k === '=' || last.id === ch.id)) { last.x += ch.c; continue; }
      out.push(ch.k === '=' ? { k: '=', x: ch.c } : { k: ch.k, x: ch.c, id: ch.id, by: ch.by, at: ch.at });
    }
    return out;
  }
  function sgChars(segs) {
    const out = [];
    for (const s of segs || []) for (const c of s.x || '') out.push(s.k === '=' ? { c, k: '=' } : { c, k: s.k, id: s.id, by: s.by, at: s.at });
    return out;
  }
  // the text of segments: 'acc' accepted (= and -), 'prop' as proposed (= and +), 'view' everything on screen
  function sgText(segs, which) {
    let s = '';
    for (const g of segs || []) if (which === 'view' || g.k === '=' || g.k === (which === 'prop' ? '+' : '-')) s += g.x;
    return s;
  }
  // what is on screen, in order: [{ b, add, rm, segs }] (b: the block, or the proposed one for an added element)
  function sgView(blocks, sugs) {
    const dropped = [], byBid = {}, adds = [];
    for (const s of sugs || []) {
      if (!s || !s.id) continue;
      if (s.k === 'add') { adds.push(s); continue; }
      const o = (byBid[s.bid] = byBid[s.bid] || { ins: [], del: [], rm: null });
      if (s.k === 'ins') o.ins.push(s); else if (s.k === 'del') o.del.push(s); else if (s.k === 'rm') o.rm = s;
    }
    const known = new Set((blocks || []).map((b) => b.id));
    for (const bid of Object.keys(byBid)) if (!known.has(bid)) { const o = byBid[bid]; [...o.ins, ...o.del, ...(o.rm ? [o.rm] : [])].forEach((s) => dropped.push(s.id)); }
    const after = {};
    for (const a of adds.sort((p, q) => (p.at || 0) - (q.at || 0) || String(p.id).localeCompare(String(q.id)))) (after[a.after || ''] = after[a.after || ''] || []).push(a);
    const items = [], done = new Set();
    const emitAdds = (key) => {
      for (const a of after[key] || []) {
        if (done.has(a.id) || known.has(a.bid)) { if (known.has(a.bid) && !done.has(a.id)) { done.add(a.id); dropped.push(a.id); } continue; }
        done.add(a.id);
        const b = { id: a.bid, t: a.t || 'action', x: a.x || '' };
        if (a.dual && b.t === 'character') b.dual = true;
        items.push({ b, add: a, rm: null, segs: b.x ? [{ k: '=', x: b.x }] : [] });
        emitAdds(a.bid);
      }
    };
    emitAdds('');
    for (const b of blocks || []) {
      const o = byBid[b.id];
      items.push({ b, add: null, rm: (o && o.rm) || null, segs: o && (o.ins.length || o.del.length) ? sgBlockSegs(b.x, o.ins, o.del, dropped) : (b.x ? [{ k: '=', x: b.x }] : []) });
      emitAdds(b.id);
    }
    // an element added after one that is gone (or in a loop): at the end, so it is not lost
    for (const a of adds) if (!done.has(a.id)) { done.add(a.id); const b = { id: a.bid, t: a.t || 'action', x: a.x || '' }; items.push({ b, add: a, rm: null, segs: b.x ? [{ k: '=', x: b.x }] : [] }); }
    return { items, dropped };
  }
  // the screen back into the model: { blocks, sugs }. An item with segs null has no suggestions in it
  function sgSerialize(items) {
    const blocks = [], sugs = [], seen = new Set();
    const fresh = (id) => { let k = id, n = 2; while (seen.has(k)) k = id + '-' + n++; seen.add(k); return k; };
    let prev = null;
    for (const it of items) {
      const b = it.b;
      if (it.add) {
        const x = it.segs ? sgText(it.segs, 'prop') : b.x || '';
        const s = { id: fresh(it.add.id), k: 'add', bid: b.id, after: prev, t: b.t, x, by: it.add.by, at: it.add.at };
        if (b.dual && b.t === 'character') s.dual = true;
        sugs.push(s); prev = b.id; continue;
      }
      let acc = '';
      if (it.segs) for (const g of it.segs) {
        if (g.k === '=') { acc += g.x; continue; }
        if (g.k === '+') sugs.push({ id: fresh(g.id), k: 'ins', bid: b.id, off: acc.length, x: g.x, ctx: acc.slice(-SG_CTX), by: g.by, at: g.at });
        else { sugs.push({ id: fresh(g.id), k: 'del', bid: b.id, off: acc.length, x: g.x, by: g.by, at: g.at }); acc += g.x; }
      } else acc = b.x || '';
      if (it.rm) sugs.push({ id: fresh(it.rm.id), k: 'rm', bid: b.id, by: it.rm.by, at: it.rm.at });
      blocks.push(acc === (b.x || '') ? b : Object.assign({}, b, { x: acc }));
      prev = b.id;
    }
    return { blocks, sugs };
  }
  // accept (accept=true) or reject the suggestions with these ids (null: all): { blocks, sugs, n }
  function sgResolve(blocks, sugs, ids, accept) {
    const want = ids ? new Set(ids) : null, got = new Set(), hit = (id) => { if (!id || (want && !want.has(id))) return false; got.add(id); return true; };
    const items = [];
    for (const it of sgView(blocks, sugs).items) {
      if (it.add && hit(it.add.id)) { if (accept) items.push({ b: it.b, add: null, rm: null, segs: it.segs }); continue; }
      if (it.rm && hit(it.rm.id)) { if (accept) continue; it.rm = null; }
      const segs = [];
      for (const g of it.segs) {
        if (g.k === '=' || !hit(g.id)) { segs.push(g); continue; }
        if ((g.k === '+') === !!accept) segs.push({ k: '=', x: g.x });
      }
      items.push({ b: it.b, add: it.add, rm: it.rm, segs: sgGroup(sgChars(segs)) });
    }
    const r = sgSerialize(items);
    r.n = got.size;
    return r;
  }
  // one edit of one block on screen: view range [a, b) replaced by text. mode 'sug' records it as a suggestion of o.by
  // (struck instead of removed, typed text inserted); 'direct' changes the text itself (removes struck or inserted text
  // in the range; typing right after inserted text extends it). Returns { segs, caret } (caret as a view offset)
  function sgEdit(segs, a, b, text, o) {
    o = o || {};
    const sug = o.mode === 'sug', me = o.by || '', at = o.at || Date.now(), newId = o.uid || uid;
    let chars = sgChars(segs);
    a = Math.max(0, Math.min(a, chars.length)); b = Math.max(a, Math.min(b, chars.length));
    const mine = (ch, k) => ch && ch.k === k && ch.by === me;
    let caret = a;
    if (b > a) {
      const out = chars.slice(0, a);
      let delId = null;
      if (sug) delId = (mine(chars[a - 1], '-') && chars[a - 1].id) || (mine(chars[b], '-') && chars[b].id) || null;
      let kept = 0;
      for (let q = a; q < b; q++) {
        const ch = chars[q];
        if (!sug || ch.k === '+') continue;
        if (ch.k === '=') { delId = delId || newId(); out.push({ c: ch.c, k: '-', id: delId, by: me, at }); } else out.push(ch);
        kept++;
      }
      chars = out.concat(chars.slice(b));
      caret = a + (sug && !o.back ? kept : 0);
    }
    if (text) {
      text = String(text).replace(/[\r\n]+/g, ' ');
      if (sug) {
        // typing inside a struck run goes after it
        while (caret > 0 && caret < chars.length && chars[caret].k === '-' && chars[caret - 1].k === '-' && chars[caret].id === chars[caret - 1].id) caret++;
        const insId = (mine(chars[caret - 1], '+') && chars[caret - 1].id) || (mine(chars[caret], '+') && chars[caret].id) || newId();
        const ref = chars.find((c) => c.id === insId);
        const add = [...text].map((c) => ({ c, k: '+', id: insId, by: me, at: ref ? ref.at : at }));
        chars.splice(caret, 0, ...add); caret += add.length;
      } else {
        const l = chars[caret - 1];
        const add = [...text].map((c) => (l && l.k === '+' ? { c, k: '+', id: l.id, by: l.by, at: l.at } : { c, k: '=' }));
        chars.splice(caret, 0, ...add); caret += add.length;
      }
    }
    return { segs: sgGroup(chars), caret };
  }
  // a block split at view offset off: [left, right] (Enter outside the suggestion mode)
  function sgSplit(segs, off) {
    const chars = sgChars(segs);
    return [sgGroup(chars.slice(0, off)), sgGroup(chars.slice(off))];
  }
  // Enter inside an accepted element in the suggestion mode: the tail is struck here and proposed as a new element.
  // Returns { segs, tail } (tail: the proposed text of the new element)
  function sgSplitSug(segs, off, o) {
    o = o || {};
    const chars = sgChars(segs), me = o.by || '', at = o.at || Date.now();
    let tail = '', delId = chars[off - 1] && chars[off - 1].k === '-' && chars[off - 1].by === me ? chars[off - 1].id : null;
    const out = chars.slice(0, off);
    for (const ch of chars.slice(off)) {
      if (ch.k === '+') { tail += ch.c; continue; }
      if (ch.k === '=') { tail += ch.c; delId = delId || (o.uid || uid)(); out.push({ c: ch.c, k: '-', id: delId, by: me, at }); } else out.push(ch);
    }
    return { segs: sgGroup(out), tail };
  }
  // the side list «Предложения», in text order: [{ ids, k: 'ins'|'del'|'rep'|'add'|'rm', x, old, t, bid, bi, by, at }]
  // (bi: the index in blocks of the accepted element it is in or follows, -1 before the first; 'rep' is a struck run
  // followed by the same author's insertion: a replacement)
  function sgList(blocks, sugs) {
    const out = [], idx = new Map((blocks || []).map((b, i) => [b.id, i]));
    let bi = -1;
    for (const it of sgView(blocks, sugs).items) {
      if (it.add) { out.push({ ids: [it.add.id], k: 'add', x: it.b.x, t: it.b.t, bid: it.b.id, bi, by: it.add.by, at: it.add.at }); continue; }
      bi = idx.has(it.b.id) ? idx.get(it.b.id) : bi;
      if (it.rm) out.push({ ids: [it.rm.id], k: 'rm', x: it.b.x, t: it.b.t, bid: it.b.id, bi, by: it.rm.by, at: it.rm.at });
      const seen = new Set();
      it.segs.forEach((g, q) => {
        if (g.k === '=' || seen.has(g.id)) return;
        seen.add(g.id);
        const nx = it.segs[q + 1];
        if (g.k === '-' && nx && nx.k === '+' && nx.by === g.by && !seen.has(nx.id)) {
          seen.add(nx.id);
          out.push({ ids: [g.id, nx.id], k: 'rep', old: g.x, x: nx.x, t: it.b.t, bid: it.b.id, bi, by: g.by, at: Math.max(g.at || 0, nx.at || 0) });
          return;
        }
        out.push({ ids: [g.id], k: g.k === '+' ? 'ins' : 'del', x: it.segs.filter((s) => s.id === g.id).map((s) => s.x).join(''), t: it.b.t, bid: it.b.id, bi, by: g.by, at: g.at });
      });
    }
    return out;
  }
  // two copies of an episode: suggestions of both (union by id; the same record in both: the later one), except those
  // either side accepted, rejected or withdrawn (ep.sugGone)
  function mergeSugs(e1, e2) {
    const gone = [...new Set([...(e1.sugGone || []), ...(e2.sugGone || [])])], off = new Set(gone);
    const out = new Map();
    for (const s of (e1.sugs || []).concat(e2.sugs || [])) {
      if (!s || !s.id || off.has(s.id)) continue;
      const o = out.get(s.id);
      if (!o || (s.at || 0) > (o.at || 0) || (s.x || '').length > (o.x || '').length) out.set(s.id, s);
    }
    return { sugs: [...out.values()], gone: gone.slice(-5000) };
  }
  // ids that were in old and are not in now go to ep.sugGone (capped); ids back in now (an undo) leave it
  function sgTrackGone(ep, old, now) {
    const has = new Set((now || []).map((s) => s.id));
    const lost = (old || []).filter((s) => s && !has.has(s.id)).map((s) => s.id);
    let g = ep.sugGone || [];
    if (g.length && has.size) g = g.filter((id) => !has.has(id));
    if (lost.length) g = g.concat(lost.filter((id) => !g.includes(id)));
    if (g.length > 5000) g = g.slice(-5000);
    if (g.length) ep.sugGone = g; else delete ep.sugGone;
    return lost;
  }
  // a fingerprint of the suggestions ('' with none, so episodes without them compare as before)
  const sgSig = (sugs) => ((sugs || []).length ? JSON.stringify(sugs) : '');

  // ---------- audit log (project-wide, append-only) ----------
  const AUDIT_TYPES = { unlock: 'Снят лок номеров', pageunlock: 'Снят лок страниц', lockdrop: 'Лок снят восстановлением или загрузкой', delete: 'Удаление', restore: 'Возврат из корзины', rollback: 'Откат по истории', sides: 'Сайды', draft: 'Новый драфт', ai: 'ИИ' };
  function mergeAuditLog(a, b) {
    const out = (a || []).slice(), ids = new Set(out.map((x) => x.id));
    for (const x of b || []) if (x && !ids.has(x.id)) { out.push(x); ids.add(x.id); }
    return out.sort((x, y) => (x.at || 0) - (y.at || 0));
  }
  // what the «Журнал действий» shows: the project log, the db-wide one (projects deleted and brought back) and the
  // unlock records episodes kept before the project log existed (each once: an entry the log already has is not repeated)
  function auditEntries(project, extra) {
    const out = mergeAuditLog(project.auditLog, (extra || []).filter((x) => !x.projectId || x.projectId === project.id || x.type === 'delete' || x.type === 'restore'));
    const seen = new Set(out.map((x) => x.type + '|' + (x.ep || '') + '|' + x.at));
    for (const e of project.episodes || []) {
      const lab = 'С' + e.season + 'Е' + e.number;
      for (const l of e.lockLog || []) { const k = 'unlock|' + e.id + '|' + l.at, k2 = 'lockdrop|' + e.id + '|' + l.at; if (!seen.has(k) && !seen.has(k2)) out.push({ id: 'll' + e.id + l.at, at: l.at, by: l.by, role: l.role, type: 'unlock', ep: e.id, epLabel: lab, text: 'Снят лок номеров сцен', reason: l.reason }); }
      for (const l of e.pageLockLog || []) { const k = 'pageunlock|' + e.id + '|' + l.at, k2 = 'lockdrop|' + e.id + '|' + l.at; if (!seen.has(k) && !seen.has(k2)) out.push({ id: 'pl' + e.id + l.at, at: l.at, by: l.by, role: l.role, type: 'pageunlock', ep: e.id, epLabel: lab, text: 'Снят лок страниц' + (l.was && l.was.pages ? ' (' + l.was.pages + ' стр.)' : ''), reason: l.reason }); }
    }
    return out.sort((x, y) => (y.at || 0) - (x.at || 0));
  }

  // ---------- sides (scenes for a shooting day) ----------
  // Final Draft «Print selected scenes»: only the chosen scenes, in script order, re-flowed on the same page format.
  // map[i] is the script index of block i of the sides, so scene numbers and revision marks stay those of the script.
  function sidesBlocks(blocks, scenes, ids) {
    const want = new Set(ids), out = [], map = [];
    for (const s of scenes) {
      if (!want.has(s.id) || s.omitted) continue;
      for (let i = s.from; i <= s.to; i++) { out.push(blocks[i]); map.push(i); }
    }
    return { blocks: out, map };
  }
  // quick picks of the dialog: every scene of one character (speaking or in the action), or of one story day
  function sidesPick(scenes, by) {
    return scenes.filter((s) => !s.omitted && (by.char ? s.cast.includes(by.char) : by.day != null && by.day !== '' && String(s.day) === String(by.day))).map((s) => s.id);
  }
  // recipients: one per line, each name once (the same actor typed twice would get two identical copies)
  function sidesRecipients(text) {
    const seen = new Set();
    return String(text || '').split(/\r?\n/).map(clean).filter((n) => { const k = n.toLowerCase(); if (!n || seen.has(k)) return false; seen.add(k); return true; });
  }
  // dates as YYYY-MM-DD in local time (the value of <input type=date>), printed as ДД.ММ.ГГГГ whatever the locale
  function isoDay(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function sidesExpiry(from, days) { const d = new Date(from); d.setDate(d.getDate() + (days == null ? 3 : days)); return isoDay(d); }
  // the trade-secret notice (98-ФЗ, ст. 10) printed on every PDF page: with the owner from the settings, or a generic one
  function secretNotice(secret) {
    const sec = secret || {};
    if (sec.org) return 'КОММЕРЧЕСКАЯ ТАЙНА. Обладатель: ' + sec.org + (sec.addr ? ', ' + sec.addr : '') + '.';
    return 'КОММЕРЧЕСКАЯ ТАЙНА. Копирование и передача третьим лицам без согласия обладателя запрещены.';
  }
  // two copies of one comment: the later «Решено»/«Открыть» wins (resolvedAt); copies from before resolvedAt keep «resolved on either side»
  function mergeCommentState(c1, c2) {
    const t1 = c1.resolvedAt || 0, t2 = c2.resolvedAt || 0;
    if (t2 > t1) { c1.resolved = !!c2.resolved; c1.resolvedAt = t2; if (c2.resolvedBy) c1.resolvedBy = c2.resolvedBy; else delete c1.resolvedBy; }
    else if (!t1 && !t2) c1.resolved = !!(c1.resolved || c2.resolved);
    return c1;
  }
  function ruDate(iso) { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || ''); }
  // a copy is valid through its expiry day
  function sidesExpired(entry, now) { return !!(entry && entry.expires) && isoDay(now == null ? Date.now() : now) > entry.expires; }
  // the issue log merges like comments: every entry of both copies of the project, once, oldest first
  function mergeSidesLog(a, b) {
    const out = (a || []).slice();
    for (const e of b || []) if (e && e.id && !out.some((x) => x.id === e.id)) out.push(e);
    return out.sort((x, y) => (x.at || 0) - (y.at || 0));
  }

  // ---------- find and replace (Final Draft Edit → Find / Replace) ----------
  // o: { matchCase, word (whole word), types: ['character', …] or empty for all }. The text searched is what the page
  // shows, so a heading or a cue typed in lower case is found as it is printed (capitals); an «УДАЛЕНА» placeholder is not text
  const CAPS_T = { scene: 1, character: 1, transition: 1, shot: 1 };
  function findRegex(q, o) {
    if (!q) return null;
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), W = '[\\p{L}\\p{N}_]';
    return new RegExp(o && o.word ? '(?<!' + W + ')' + esc + '(?!' + W + ')' : esc, 'gu' + (o && o.matchCase ? '' : 'i'));
  }
  function findMatches(blocks, q, o) {
    o = o || {};
    const re = findRegex(q, o), out = [];
    if (!re) return out;
    (blocks || []).forEach((b, i) => {
      if (o.types && o.types.length && !o.types.includes(b.t)) return;
      const x = b.x || '';
      if (b.t === 'scene' && OMIT_RE.test(x)) return;
      const shown = CAPS_T[b.t] ? up(x) : x, hay = shown.length === x.length ? shown : x;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(hay))) { out.push({ i, id: b.id, start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex++; }
    });
    return out;
  }
  // every match (or only the one at one = {i, start}) replaced by repl as typed; changed blocks are new objects
  function replaceMatches(blocks, q, repl, o, one) {
    const ms = findMatches(blocks, q, o).filter((m) => !one || (m.i === one.i && m.start === one.start));
    const byI = {};
    ms.forEach((m) => { (byI[m.i] = byI[m.i] || []).push(m); });
    const out = (blocks || []).map((b, i) => {
      const list = byI[i];
      if (!list) return b;
      let x = b.x || '';
      for (const m of list.slice().reverse()) x = x.slice(0, m.start) + repl + x.slice(m.end);
      return Object.assign({}, b, { x });
    });
    return { blocks: out, count: ms.length };
  }

  root.Core = {
    findMatches, replaceMatches, titleInfo, adoptTitlePage, parseEpisodeLine, fountainForce,
    sidesBlocks, sidesPick, sidesRecipients, sidesExpiry, sidesExpired, mergeSidesLog, isoDay, ruDate, secretNotice, mergeCommentState,
    BREAKDOWN, BD, BD_SPECIAL, findAnchor, quoteAt, anchorTags, bdKey, bdName, breakdownItems, breakdownByObject, mergeTags, breakdownXLSX,
    REV_SETS, revName, revColorName, revColor, revMarkX, revMarks, newRevision, revisionsFromMarks, fdxActiveSet, pageLockFrom,
    dualFmt, dualPairs, parseLines, LINE_COLORS, autoLine, listOf, paperOf, FMT_RU, lockAssign, lockMissing, lockInsertIndex, omittedHeading, OMIT_RE, numParts,
    TYPES, TYPE_LABEL, FMT, PAPER, TIMES, PREFIXES, TRANSITIONS, EXTENSIONS, TAGS, SPECIAL_TAGS, DEFAULT_RULES, MANUAL_CHECKS,
    uid, up, clean, parseHeading, formatHeading, charName, wrap, paginate, rightEdge, displayText, analyzeEpisode, evalRules, fmtPages, fmtTime, sceneEighths, fmtEighths, fmtScenePages,
    namingIssues, fixHomoglyphs, classifyLines, importText, importFDX, importKIT, importSTARC, importSqliteProject, absorb, exportFDX, exportFountain, docxDocumentXML, DOCX_STATIC,
    docxParagraphs, docxStyles, splitCast, splitCue, finalizeImport, numberingCheck, pdfLines, demoProject, sceneSplit, thinHistory, restoreScene, HIST,
    sgView, sgSerialize, sgResolve, sgEdit, sgSplit, sgSplitSug, sgText, sgList, mergeSugs, sgTrackGone, sgSig, sgGroup, sgChars,
    histPush, histState, histStates, histSize, histSig, histIsDelta, histEncode, histDecode, hashStr, pageRanges, restoreRange, stampBlocks, blocksSig, blockAuthors, AUDIT_TYPES, mergeAuditLog, auditEntries, normalizeHeadingText, normalizeCharacter, filmtoolzHeading, HEADING_START,
  };
})(typeof window !== 'undefined' ? window : globalThis);
