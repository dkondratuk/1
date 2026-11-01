/* Драфт: model, Final Draft page layout, analysis and production rules. No DOM here, so it runs in node tests too. */
(function (root) {
  'use strict';

  const TYPES = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition'];
  const TYPE_LABEL = { scene: 'Сцена', action: 'Описание', character: 'Персонаж', paren: 'Ремарка', dialogue: 'Реплика', transition: 'Переход' };

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
  };
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
    return (b.t === 'scene' || b.t === 'character' || b.t === 'transition') ? up(t) : t;
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

  function paginate(blocks, opts) {
    const lpp = (opts && opts.lines) || 54;
    const F = (opts && opts.fmt) || FMT;
    const pages = [{ items: [] }];
    const info = blocks.map((b) => {
      const f = F[b.t] || F.action;
      const lines = wrap(displayText(b), f.width);
      return { lines, L: lines.length, sb: f.sb };
    });
    // breaks: block i starts a page; inner: page breaks inside block i, as a line offset from its top
    const breaks = {}, inner = {};
    let used = 0;
    let lastChar = '', lastCue = '';
    // locked pages: the plan says where a locked page must start and names the pages (12, 12A…)
    const PL = pageLockPlan(blocks, opts && opts.pageLock);
    const labels = PL ? [PL.label(0)] : null;
    const items = () => pages[pages.length - 1].items;
    const newPage = (q) => { pages.push({ items: [] }); used = 0; if (PL) labels.push(PL.next(q)); };
    const put = (it) => { items().push(it); used += it.sb + it.lines.length; };
    // the cue repeated at the top of the next page keeps its extension: ИВАН (ЗК) (ПРОД.)
    const contd = (i) => ({ i, t: 'character', lines: [lastCue + ' (ПРОД.)'], sb: 0, contd: true });
    // what goes to the next page with block b: a scene heading never ends a page, a cue and parentheticals stay with
    // their dialogue, and a speech broken between its parts gets (ДАЛЬШЕ) here and the cue with (ПРОД.) there
    const carryOver = (b, i) => {
      const cur = items(), out = [];
      let u = used, speech = b.t === 'dialogue' || b.t === 'paren';
      const take = () => { const it = cur.pop(); u -= it.sb + it.lines.length; out.unshift(it); };
      while (cur.length) {
        const it = cur[cur.length - 1];
        if (it.t === 'scene') { take(); speech = false; continue; }
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
        const a = PL.at.get(i), force = (q) => {
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
      const f = F[b.t] || F.action, nb = blocks[i + 1], next = info[i + 1];
      let sb = used === 0 ? 0 : inf.sb;
      let need = sb + inf.L;
      // keep with next: a heading takes at least 2 lines of the next element, a cue the first line of its speech,
      // a parenthetical the dialogue line after it
      if (next && b.t === 'scene') need += next.sb + Math.min(next.L, 2);
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
    const lastUsed = last.items.reduce((a, it) => a + it.sb + it.lines.length, 0);
    const total = blocks.length ? (pages.length - 1) + lastUsed / lpp : 0;
    return { pages, total, info, breaks, inner, lpp, labels: labels || pages.map((pg, k) => String(k + 1)), locked: !!PL };
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
    let last = -1;
    lock.pages.forEach((pg, q) => {
      let i = null, mid = false;
      if (pg.mid && pos.has(pg.id) && kept.has(pos.get(pg.id))) { i = pos.get(pg.id); mid = true; } else if (firstOf.has(q)) i = firstOf.get(q);
      // a page whose text is all gone, or that would come before the previous one, is skipped (its number is not printed)
      // (several pages may start inside one long block)
      if (i == null || i < last || (i === last && !mid)) return;
      if (mid) slot(i).mids.push(q); else slot(i).start = q;
      last = i;
    });
    const used = new Set(lock.pages.map((pg, q) => String(pg.n || q + 1)));
    const plan = { at, mids: [], cur: 0, aN: 0 };
    plan.label = (q) => { plan.cur = q; plan.aN = 0; return String(lock.pages[q].n || q + 1); };
    plan.next = (q) => {
      if (q == null && plan.mids.length) q = plan.mids.shift();
      if (q != null) return plan.label(q);
      let s; do s = aPageLabel(String(lock.pages[plan.cur].n || plan.cur + 1), ++plan.aN); while (used.has(s) && plan.aN < 200);
      return s;
    };
    return plan;
  }

  // ---------- production revisions (WGA colour order, as in Final Draft) ----------
  // Level 0 is the white original. Every revision keeps a copy of the text at its start (base); a block differs from a
  // base when it is new there, has other text or another type, or follows text deleted since (Final Draft marks the line
  // where text was removed). A block carries the highest level it differs in, so earlier marks stay with their colour.
  const REV_SETS = [['Белая', '#8a8a8a'], ['Голубая', '#2f7fd8'], ['Розовая', '#e0569a'], ['Жёлтая', '#c9a000'], ['Зелёная', '#2e9e4f'],
    ['Золотистая', '#d08c00'], ['Бежевая', '#b08a5e'], ['Лососевая', '#f0785a'], ['Вишнёвая', '#b0223f']];
  const REV_ORD = ['', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая', 'Седьмая', 'Восьмая', 'Девятая', 'Десятая'];
  function revName(level) {
    const name = REV_SETS[level % REV_SETS.length][0], k = Math.floor(level / REV_SETS.length);
    return k ? (REV_ORD[k] || (k + 1) + '-я') + ' ' + name.toLowerCase() : name;
  }
  const revColor = (level) => REV_SETS[level % REV_SETS.length][1];
  // the right-margin column of the marks: 7.6 in on Letter, never over the text nor off the sheet
  const revMarkX = (paper) => Math.min(paper.w - 0.3, Math.max(7.6, paper.w - paper.right + 0.1));
  function revMarks(blocks, revisions) {
    const out = blocks.map(() => 0);
    const pos = new Map(blocks.map((b, i) => [b.id, i]));
    for (const r of revisions || []) {
      const lv = r.level || 0, base = r.base || [];
      if (!lv) continue;
      const was = new Map(base.map((b) => [b.id, b]));
      blocks.forEach((b, i) => { const o = was.get(b.id); if ((!o || o.t !== b.t || (o.x || '') !== (b.x || '')) && lv > out[i]) out[i] = lv; });
      for (let k = 0; k < base.length; k++) {
        if (pos.has(base[k].id)) continue;
        let j = k + 1; while (j < base.length && !pos.has(base[j].id)) j++;
        const i = j < base.length ? pos.get(base[j].id) : blocks.length - 1;
        if (i >= 0 && lv > out[i]) out[i] = lv;
        k = j - 1;
      }
    }
    return out;
  }
  // a fresh revision: the next level, its WGA name and colour, and the text it is measured against
  function newRevision(prevLevel, blocks, by, date) {
    const level = (prevLevel || 0) + 1;
    return { level, name: revName(level), color: revColor(level), date: date || Date.now(), by: by || '', base: blocks.map((b) => ({ id: b.id, t: b.t, x: b.x || '' })) };
  }
  // FDX import: marks read from RevisionID become revisions whose base is the text without the marks of that level and
  // above, so revMarks gives every block back exactly the level it had in Final Draft
  function revisionsFromMarks(blocks, active, date) {
    const max = Math.max(0, active || 0, ...blocks.map((b) => b.rev || 0));
    if (!blocks.some((b) => b.rev)) return null;
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
        if (b.t === 'action') {
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
    let main = objList.find((o) => o.main) || objList.find((o) => o.pav) || objList[0] || null;
    const totalShifts = live.reduce((a, s) => a + s.shifts, 0);
    const sum = (f) => live.filter(f).reduce((a, s) => a + s.min, 0);
    const tot = minutes || 1;
    const stats = {
      pages, minutes, scenes, objects: objList, main, totalShifts, lay,
      revs: ep.revisions && ep.revisions.length ? revMarks(blocks, ep.revisions) : null,
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
  // tags follow their text like comments: an element that no longer holds the quote (joined, split) hands the tag to the
  // nearest element that does, searched from where the tag was in prev (the blocks before the edit). Unlike a comment a tag
  // marks a word that recurs (a prop), so it looks only a few elements away: a deleted word must not jump to another scene
  const TAG_REACH = 3;
  function anchorTags(blocks, tags, prev) {
    const pos = {}; blocks.forEach((b, i) => { pos[b.id] = i; });
    const texts = blocks.map((b) => b.x || '');
    let moved = 0;
    for (const t of tags || []) {
      const i = pos[t.blockId];
      if (i != null && texts[i].indexOf(t.quote) >= 0) { if (t.lost) delete t.lost; continue; }
      let start = i;
      if (start == null) { const j = prev ? prev.findIndex((b) => b.id === t.blockId) : -1; start = j >= 0 ? j : blocks.length - 1; }
      const k = findAnchor(texts, t.quote, start, TAG_REACH);
      if (k >= 0) { if (blocks[k].id !== t.blockId) moved++; t.blockId = blocks[k].id; delete t.lost; } else t.lost = true;
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
  // sheets «Сцены», «Объекты», «Персонажи», «Разбивка»; returns { path: xml } for a zip
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
        s.day || '', s.omitted ? '' : fmtPages(s.pages), s.omitted ? '' : fmtTime(s.min), s.cast.join(', '), crowd, ...cats.map((c) => join(bd[c.id]))]);
    }
    const objects = [['Объект', 'Павильон', 'Сцен', 'Страницы', 'Хронометраж', '%', 'Смен']];
    for (const o of st.objects) objects.push([o.name, o.pav ? 'да' : 'нет', o.scenes, fmtPages(o.pages), fmtTime(o.min), round(o.share * 100, 1), round(o.shifts, 2)]);
    const chars = [['Персонаж', 'Сцен', 'Реплик', 'Время в кадре']];
    for (const c of st.characters || []) chars.push([c.name, c.scenes, c.replicas, fmtTime(c.min)]);
    const items = [['Категория', 'Элемент', 'Сцены', 'Сцен', 'Примечание']];
    for (const it of breakdownItems(st)) items.push([BD[it.cat].name, it.name, it.scenes.join(', '), it.scenes.length, it.notes.join('; ')]);
    const sheets = [
      ['Сцены', xlSheet(scenes, [7, 44, 22, 10, 12, 10, 10, 11, 30, 18, ...cats.map(() => 18)])],
      ['Объекты', xlSheet(objects, [30, 10, 7, 10, 12, 7, 7])],
      ['Персонажи', xlSheet(chars, [26, 7, 8, 13])],
      ['Разбивка', xlSheet(items, [18, 30, 24, 7, 30])],
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
    const extNight = nightScenes.filter((s) => s.h.type === 'ext' || s.h.type === 'intext');
    if (extNight.length) add('extnight', 'Ночная натура', 'warn', extNight.length + ' сц.', extNight.map((s) => sref(s)));
    const big = live.filter((s) => s.cast.length > r.bigCast);
    add('bigcast', 'Сцены больше ' + r.bigCast + ' артистов', big.length <= r.bigCastMaxScenes ? (big.length ? 'warn' : 'ok') : 'fail',
      big.length + ' / ' + r.bigCastMaxScenes, big.map((s) => sref(s, s.heading + ' · ' + s.cast.length + ' арт.')));
    const ens = big.filter((s) => s.sec < r.ensembleMinSec);
    add('ensemble', 'Сбор ансамбля короче ' + r.ensembleMinSec + ' с', ens.length ? 'fail' : 'ok', ens.length + ' сц.',
      ens.map((s) => sref(s, s.heading + ' · ' + s.sec + ' с')), 'Раз собрали всех, сцена должна быть плотной.');
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
  function classifyLines(lines) {
    const blocks = [];
    const ind = lines.map((l) => l.indent).filter((x) => x != null);
    const margin = ind.length ? leftMargin(ind) : null;
    // a document with named screenplay styles: anything in an unknown style is action, not a continuation
    const styled = lines.filter((l) => styleToType(l.style)).length >= 10;
    let prev = null;
    const push = (t, x) => { const b = { id: uid(), t, x: clean(x) }; blocks.push(b); prev = b; return b; };
    for (let k = 0; k < lines.length; k++) {
      const L = lines[k];
      let text = clean(L.text);
      if (!text) { prev = prev && prev.t === 'gap' ? prev : { t: 'gap' }; continue; }
      const style = (L.style || '').toLowerCase();
      const rel = L.indent != null && margin != null ? L.indent - margin : null;
      const gap = !prev || prev.t === 'gap' || L.gapBefore;
      const last = blocks[blocks.length - 1];
      const styleType = styleToType(style);
      // the normalised heading drops the number and the script day: both ride on the block to absorb, which puts them in the scene card
      if (HEADING_START.test(text) || styleType === 'scene') { const b = push('scene', normalizeHeadingText(text)); const ph = parseHeading(text); if (ph.guessed) b.guessed = true; if (ph.num) b.num = ph.num; if (ph.day) b.day = ph.day; continue; }
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
      const inl = text.match(/^([А-ЯЁA-Z][А-ЯЁA-Z\- ]{1,30}?)\s*(\([^)]*\))?\s*[.:]\s+(.+)$/);
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

  function importText(txt) {
    txt = txt.replace(/\r/g, '');
    // a Fountain title page marks the file as Fountain: only then '!' (forced action) and '~' (lyrics) are markup, not text
    const TITLE_RE = /^(?:(?:Title|Credit|Author|Authors|Episode|Source|Draft date|Contact|Notes):.*\n)+/i;
    const fountain = TITLE_RE.test(txt);
    txt = txt.replace(TITLE_RE, '');
    // Fountain forced elements and centered text are reduced to plain text; ordinary text ("...Ну да.", "> стрелка") is kept as is
    // in a Fountain file any '.X' is a forced heading («.«СОН»», ".2 ГОДА СПУСТЯ"); in plain text only before a capital
    const FORCED_RE = fountain ? /^\.(?=[^.\s])/ : /^\.(?=[A-ZА-ЯЁ])/;
    const unforce = (s) => {
      const t = s.replace(/^\s+/, '');
      if (/^>.*<\s*$/.test(t)) return t.replace(/^>\s*/, '').replace(/\s*<\s*$/, '');
      if (/^>\s*[A-ZА-ЯЁ0-9 .:()\-]+:?\s*$/.test(t)) return t.replace(/^>\s*/, '');
      if (fountain && /^[!~](?=[^!\s])/.test(t)) return t.slice(1);
      // a forced heading left empty (a new scene exported before it got a heading) is nothing, not an action ". #1#"
      if (fountain && /^\.\s*(?:#[^#\s]+#)?\s*$/.test(t)) return '';
      return t.replace(FORCED_RE, '').replace(/^@(?=[A-ZА-ЯЁ])/, '');
    };
    const nums = [];
    const lines = txt.split('\n').map((s) => {
      let text = unforce(s);
      const forced = FORCED_RE.test(s.replace(/^\s+/, ''));
      const action = fountain && /^\s*!(?=[^!\s])/.test(s);
      // Fountain scene number "#12А#" at the end of a heading
      const m = text.match(/^(.*?)\s*#([^#\s]+)#\s*$/);
      const head = forced || HEADING_START.test(m ? m[1] : text);
      if (head && m) text = m[1];
      if (head && clean(text)) nums.push(m ? m[2] : '');
      return { text, joinable: true, style: forced ? 'Scene Heading' : action ? 'Action' : undefined };
    });
    const blocks = classifyLines(lines);
    let k = 0;
    for (const b of blocks) if (b.t === 'scene') { const n = nums[k++]; if (n) b.num = n; }
    return blocks;
  }
  function importFDX(xml, DOMParserImpl) {
    const doc = new (DOMParserImpl || DOMParser)().parseFromString(xml, 'application/xml');
    const map = { 'Scene Heading': 'scene', Action: 'action', Character: 'character', Parenthetical: 'paren', Dialogue: 'dialogue', Transition: 'transition', Shot: 'action', General: 'action' };
    const content = doc.getElementsByTagName('Content')[0];
    if (!content) throw new Error('В файле нет текста сценария (раздел Content).');
    const blocks = [];
    const ps = content.getElementsByTagName('Paragraph');
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      // Final Draft keeps the dead body of an omitted scene inside <OmittedScene>: never import it as live text
      let anc = p.parentNode, dead = false;
      while (anc && anc !== content) { if (anc.nodeName === 'OmittedScene') { dead = true; break; } anc = anc.parentNode; }
      if (dead) continue;
      const hasOmitted = p.getElementsByTagName('OmittedScene').length > 0;
      if (!hasOmitted && p.getElementsByTagName('Paragraph').length) continue;
      let text = '';
      const ts = p.getElementsByTagName('Text');
      // only this paragraph's own Text runs, not those of nested paragraphs
      let rev = 0;
      for (let j = 0; j < ts.length; j++) { let q = ts[j].parentNode; while (q && q.nodeName !== 'Paragraph') q = q.parentNode; if (q === p) { text += ts[j].textContent; if (ts[j].textContent.trim()) rev = Math.max(rev, +ts[j].getAttribute('RevisionID') || 0); } }
      text = clean(text);
      let t = map[p.getAttribute('Type')] || 'action';
      if (hasOmitted && !text) { text = 'OMITTED'; t = 'scene'; }
      if (!text) continue;
      const fdxNum = (p.getAttribute('Number') || '').trim();
      const fdxDay = t === 'scene' ? parseHeading(text).day : '';
      if (t === 'scene') text = normalizeHeadingText(text);
      if (t === 'character') text = normalizeCharacter(text);
      if (t === 'paren' && !/^\(/.test(text)) text = '(' + text + ')';
      const nb = { id: uid(), t, x: text };
      if (t === 'scene' && fdxNum) nb.num = fdxNum;
      if (rev > 0) nb.rev = rev;
      if (fdxDay) nb.day = fdxDay;
      if (t === 'scene' && (hasOmitted || OMIT_RE.test(text))) { nb.x = omittedHeading(fdxNum); nb.omitted = true; }
      blocks.push(nb);
    }
    return blocks;
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
        if (b.omitted || OMIT_RE.test(b.x)) { (report.sceneMeta[b.id] = report.sceneMeta[b.id] || { num }).omitted = true; b.x = omittedHeading(num); delete b.omitted; continue; }
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
  const FDX_TYPE = { scene: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition' };
  function exportFDX(ep, project, st, opts) {
    opts = opts || {};
    const revs = st.revs || [];
    const sceneByIdx = {}; st.scenes.forEach((s) => { sceneByIdx[s.from] = s; });
    const paper = paperOf(project.rules);
    const F = paper.fmt;
    const paras = (ep.blocks || []).map((b, i) => {
      const s = sceneByIdx[i];
      const num = s ? (opts.episodePrefix && !/-/.test(s.num) ? (ep.number || 1) + '-' + s.num : s.num) : '';
      const props = s ? '<SceneProperties Length="' + fmtPages(s.pages) + '" Page="' + (s.page || 1) + '" Title="' + xmlEsc(s.synopsis || '') + '"/>' : '';
      const text = s && s.omitted ? 'OMITTED' : displayText(b) + headingDay(s, b);
      return '    <Paragraph' + (s ? ' Number="' + num + '"' : '') + ' Type="' + FDX_TYPE[b.t] + '">' + props + '<Text' + (revs[i] ? ' RevisionID="' + revs[i] + '"' : '') + '>' + xmlEsc(text) + '</Text></Paragraph>';
    });
    const el = (name, f, behavior) => '    <ElementSettings Type="' + name + '"><FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="Courier New" RevisionID="0" Size="12" Style=""/><ParagraphSpec Alignment="' + (f.right ? 'Right' : 'Left') + '" FirstIndent="0.00" Leading="Regular" LeftIndent="' + f.indent.toFixed(2) + '" RightIndent="' + (f.right ? rightEdge(f, paper) : f.indent + f.width / 10).toFixed(2) + '" SpaceBefore="' + (f.sb * 12) + '" Spacing="1" StartsNewPage="No"/><Behavior PaginateAs="' + name + '" ReturnKey="' + behavior + '" Shortcut=""/></ElementSettings>';
    const chars = Object.keys(project.chars || {}).sort();
    const locs = new Set();
    st.scenes.filter((s) => !s.omitted).forEach((s) => { const h = s.h; if (h.object) locs.add(h.object + (h.sub ? '. ' + h.sub : '')); });
    return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n  <Content>\n' + paras.join('\n') + '\n  </Content>\n' +
      '  <TitlePage>\n    <Content>\n' + [project.name, ep.title ? 'Серия ' + (ep.number || '') + '. ' + ep.title : '', project.author || ''].filter(Boolean).map((t) => '      <Paragraph Alignment="Center" Type="General"><Text>' + xmlEsc(t) + '</Text></Paragraph>').join('\n') + '\n    </Content>\n  </TitlePage>\n' +
      el('Scene Heading', F.scene, 'Action') + '\n' + el('Action', F.action, 'Action') + '\n' + el('Character', F.character, 'Dialogue') + '\n' +
      el('Parenthetical', F.paren, 'Dialogue') + '\n' + el('Dialogue', F.dialogue, 'Action') + '\n' + el('Transition', F.transition, 'Scene Heading') + '\n' +
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
  function exportFountain(ep, project, st) {
    st = st || analyzeEpisode(ep, project);
    const out = ['Title: ' + (project.name || ''), 'Episode: ' + (ep.number || '') + (ep.title ? ' ' + ep.title : ''), ''];
    const sceneByIdx = {}; st.scenes.forEach((s) => { sceneByIdx[s.from] = s; });
    const blocks = ep.blocks || [];
    blocks.forEach((b, i) => {
      const t = displayText(b);
      const s = sceneByIdx[i];
      const next = blocks[i + 1];
      // Fountain scene number "#12А#"; a blank line ends a speech, so it comes only after its last paren or dialogue
      if (b.t === 'scene') out.push('', '.' + (s && s.omitted ? omittedHeading(s.num) : t + headingDay(s, b)) + (s && s.num ? ' #' + s.num + '#' : ''), '');
      else if (b.t === 'character') out.push('@' + t);
      else if (b.t === 'paren' || b.t === 'dialogue') { out.push(t); if (!next || (next.t !== 'paren' && next.t !== 'dialogue')) out.push(''); }
      else if (b.t === 'transition') out.push('> ' + t, '');
      else out.push(t, '');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // FilmToolz Word import: "1-3. ИНТ. ОБЪЕКТ. ПОДОБЪЕКТ ДЕНЬ 2." + line break + characters + (мм:сс)
  const FT_TIME = { 'ДЕНЬ': 'ДЕНЬ', 'НОЧЬ': 'НОЧЬ', 'УТРО': 'УТРО', 'ВЕЧЕР': 'ВЕЧЕР', 'РАССВЕТ': 'УТРО', 'РАННЕЕ УТРО': 'УТРО', 'РЕЖИМ': 'ВЕЧЕР', 'ЗАКАТ': 'ВЕЧЕР', 'СУМЕРКИ': 'ВЕЧЕР', 'ПОЗДНИЙ ВЕЧЕР': 'ВЕЧЕР' };
  const FT_PREFIX = { int: 'ИНТ.', ext: 'НАТ.', intext: 'НАТ/ИНТ.', pav: 'ПАВ.' };
  function filmtoolzHeading(s, ep) {
    const h = s.h;
    let line = (/^\d+-\d+/.test(s.num) ? s.num : (ep.number || 1) + '-' + s.num) + '. ' + (h.type ? FT_PREFIX[h.type] + ' ' : '') + h.object + (h.sub ? '. ' + h.sub : '');
    const tm = FT_TIME[h.time] || '';
    if (tm) line += ' ' + tm;
    if (s.day) line += ' ' + String(s.day).replace(/\D/g, '') + '.';
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
      const pPr = '<w:pPr><w:spacing w:before="' + (i === 0 ? 0 : f.sb * 240) + '" w:after="0" w:line="240" w:lineRule="exact"/><w:ind w:left="' + left + '" w:right="' + Math.max(0, right) + '"/>' + (f.right ? '<w:jc w:val="right"/>' : '') + (b.t === 'scene' || b.t === 'character' ? '<w:keepNext/>' : '') + '</w:pPr>';
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
  // keep every snapshot for a day, one per hour for a week, then one per day; marked ones (keep) survive thinning
  const HIST = { dense: 24 * 3600e3, hourly: 7 * 24 * 3600e3, max: 400 };
  function thinHistory(list, now) {
    now = now || Date.now();
    const sorted = list.slice().sort((a, b) => a.date - b.date);
    const out = []; let lastKey = null;
    for (const h of sorted) {
      const age = now - h.date;
      const key = h.keep ? 'k' + h.date : age < HIST.dense ? 'd' + h.date : age < HIST.hourly ? 'h' + Math.floor(h.date / 3600e3) : 'D' + Math.floor(h.date / 86400e3);
      if (key === lastKey && out.length && !out[out.length - 1].keep) out[out.length - 1] = h;
      else out.push(h);
      lastKey = key;
    }
    return out.slice(-HIST.max);
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

  root.Core = {
    BREAKDOWN, BD, BD_SPECIAL, findAnchor, quoteAt, anchorTags, bdKey, bdName, breakdownItems, breakdownByObject, mergeTags, breakdownXLSX,
    REV_SETS, revName, revColor, revMarkX, revMarks, newRevision, revisionsFromMarks, fdxActiveSet, pageLockFrom,
    parseLines, LINE_COLORS, autoLine, listOf, paperOf, FMT_RU, lockAssign, lockMissing, lockInsertIndex, omittedHeading, OMIT_RE, numParts,
    TYPES, TYPE_LABEL, FMT, PAPER, TIMES, PREFIXES, TRANSITIONS, EXTENSIONS, TAGS, SPECIAL_TAGS, DEFAULT_RULES, MANUAL_CHECKS,
    uid, up, clean, parseHeading, formatHeading, charName, wrap, paginate, rightEdge, displayText, analyzeEpisode, evalRules, fmtPages, fmtTime,
    namingIssues, fixHomoglyphs, classifyLines, importText, importFDX, absorb, exportFDX, exportFountain, docxDocumentXML, DOCX_STATIC,
    docxParagraphs, docxStyles, splitCast, splitCue, finalizeImport, numberingCheck, pdfLines, demoProject, sceneSplit, thinHistory, restoreScene, HIST, normalizeHeadingText, normalizeCharacter, filmtoolzHeading, HEADING_START,
  };
})(typeof window !== 'undefined' ? window : globalThis);
