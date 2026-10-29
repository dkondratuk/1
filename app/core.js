/* Драфт: model, Final Draft page layout, analysis and production rules. No DOM here, so it runs in node tests too. */
(function (root) {
  'use strict';

  const TYPES = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition'];
  const TYPE_LABEL = { scene: 'Сцена', action: 'Описание', character: 'Персонаж', paren: 'Ремарка', dialogue: 'Реплика', transition: 'Переход' };

  // Final Draft default screenplay geometry. Indent: inches from the left edge of the sheet; width: characters
  // (Courier 12 = 10 characters per inch); sb: blank lines before the element.
  const FMT = {
    scene:      { indent: 1.5, width: 60, sb: 2 },
    action:     { indent: 1.5, width: 60, sb: 1 },
    character:  { indent: 3.7, width: 38, sb: 1 },
    paren:      { indent: 3.1, width: 25, sb: 0 },
    dialogue:   { indent: 2.5, width: 35, sb: 0 },
    transition: { indent: 5.5, width: 20, sb: 1, right: true },
  };
  const PAPER = {
    letter: { name: 'Letter (Final Draft)', w: 8.5, h: 11, lines: 54 },
    a4: { name: 'A4', w: 8.27, h: 11.69, lines: 58 },
  };

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
  const PREFIX_RE = /^\s*(?:(\d+[\-–.\d]*[А-ЯA-Z]?)[.)]?\s+)?(ИНТ\.?\s*\/\s*НАТ\.?|НАТ\.?\s*\/\s*ИНТ\.?|ИНТ\.|НАТ\.|ПАВ\.|ИНТ(?=\s)|НАТ(?=\s)|ПАВ(?=\s)|INT\.|EXT\.|INT\.?\/EXT\.?|I\/E\.?)\s*/i;
  const TIME_RE = new RegExp('(?:\\s*[-–—]\\s*|\\s+|^)(РАННЕЕ УТРО|ПОЗДНИЙ ВЕЧЕР|' + TIMES.join('|') + ')\\.?(?:\\s*(?:Д\\.?\\s*|ДЕНЬ\\s*)?(\\d{1,3})\\.?)?\\s*$', 'i');

  function prefixType(p) {
    const s = up(p).replace(/\s/g, '');
    if (/ПАВ/.test(s)) return 'pav';
    if (/(ИНТ.*НАТ|НАТ.*ИНТ|INT.*EXT|I\/E)/.test(s)) return 'intext';
    if (/НАТ|EXT/.test(s)) return 'ext';
    return 'int';
  }
  const TYPE_PREFIX = { int: 'ИНТ.', ext: 'НАТ.', intext: 'ИНТ./НАТ.', pav: 'ПАВ.' };

  const NUM_RE = /^\s*(\d+[\-–.\d]*[А-ЯA-Z]?)[.)]\s+/;
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

  function charName(text) {
    return clean(up(text).replace(/\(.*?\)/g, ' ').replace(/\b(ПРОД|CONT'?D)\.?/g, '')).replace(/[.:]+$/, '');
  }

  // ---------- pagination (Final Draft rules) ----------
  function wrap(text, width) {
    const words = clean(text).split(' ');
    const lines = [];
    let cur = '';
    for (let w of words) {
      while (w.length > width) {
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, width)); w = w.slice(width);
      }
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
    return lines;
  }
  function displayText(b) {
    const t = b.x || '';
    return (b.t === 'scene' || b.t === 'character' || b.t === 'transition') ? up(t) : t;
  }

  function paginate(blocks, opts) {
    const lpp = (opts && opts.lines) || 54;
    const pages = [{ items: [] }];
    const info = blocks.map((b) => {
      const f = FMT[b.t] || FMT.action;
      const lines = wrap(displayText(b), f.width);
      return { lines, L: lines.length, sb: f.sb };
    });
    const breaks = {};
    let used = 0;
    let lastChar = '';
    const newPage = () => { pages.push({ items: [] }); used = 0; };
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], inf = info[i];
      if (b.t === 'character') lastChar = charName(b.x);
      let sb = used === 0 ? 0 : inf.sb;
      const next = info[i + 1];
      let need = sb + inf.L;
      if ((b.t === 'scene' || b.t === 'character') && next) need += (used + need === 0 ? 0 : next.sb) + 1;
      if (b.t === 'paren' && next && blocks[i + 1].t === 'dialogue') need += 1;
      const avail = lpp - used;
      if (need <= avail) {
        pages[pages.length - 1].items.push({ i, t: b.t, lines: inf.lines, sb });
        used += sb + inf.L;
        continue;
      }
      // try to split long action / dialogue across the page
      const splittable = b.t === 'action' || b.t === 'dialogue';
      let room = avail - sb - (b.t === 'dialogue' ? 1 : 0);
      if (splittable && room >= 2 && inf.L - room >= 2 && used > 0) {
        let lines = inf.lines.slice();
        pages[pages.length - 1].items.push({ i, t: b.t, lines: lines.slice(0, room), sb, more: b.t === 'dialogue' ? lastChar : '' });
        lines = lines.slice(room);
        newPage();
        breaks[i] = { page: pages.length, split: true };
        if (b.t === 'dialogue') {
          pages[pages.length - 1].items.push({ i, t: 'character', lines: [lastChar + ' (ПРОД.)'], sb: 0, contd: true });
          used += 1;
        }
        while (lines.length > lpp - used) {
          const take = lpp - used - (b.t === 'dialogue' ? 1 : 0);
          pages[pages.length - 1].items.push({ i, t: b.t, lines: lines.slice(0, take), sb: 0, more: b.t === 'dialogue' ? lastChar : '' });
          lines = lines.slice(take);
          newPage();
          if (b.t === 'dialogue') { pages[pages.length - 1].items.push({ i, t: 'character', lines: [lastChar + ' (ПРОД.)'], sb: 0, contd: true }); used += 1; }
        }
        pages[pages.length - 1].items.push({ i, t: b.t, lines, sb: 0 });
        used += lines.length;
        continue;
      }
      if (used > 0) {
        // dialogue blocks moved to a new page keep their speaker
        const moveFrom = (b.t === 'dialogue' || b.t === 'paren') ? backtrackSpeaker(pages[pages.length - 1].items, blocks) : null;
        newPage();
        if (moveFrom && moveFrom.length) {
          for (const it of moveFrom) { it.sb = it === moveFrom[0] ? 0 : it.sb; pages[pages.length - 1].items.push(it); used += it.sb + it.lines.length; }
          breaks[moveFrom[0].i] = { page: pages.length };
        } else breaks[i] = { page: pages.length };
      }
      sb = used === 0 ? 0 : inf.sb;
      let lines = inf.lines.slice();
      while (lines.length > lpp - used) {
        const take = lpp - used;
        pages[pages.length - 1].items.push({ i, t: b.t, lines: lines.slice(0, take), sb });
        lines = lines.slice(take); sb = 0;
        newPage();
      }
      pages[pages.length - 1].items.push({ i, t: b.t, lines, sb });
      used += sb + lines.length;
    }
    const last = pages[pages.length - 1];
    const lastUsed = last.items.reduce((a, it) => a + it.sb + it.lines.length, 0);
    const total = blocks.length ? (pages.length - 1) + lastUsed / lpp : 0;
    return { pages, total, info, breaks, lpp };
  }
  // when a dialogue does not fit, its character cue (and parenthetical) move with it
  function backtrackSpeaker(items, blocks) {
    const out = [];
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (it.t === 'paren' || it.t === 'character') { out.unshift(it); items.splice(k, 1); if (it.t === 'character') break; }
      else break;
    }
    if (!out.length || out[0].t !== 'character') { items.push(...out); return null; }
    return out;
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
    const paper = PAPER[rules.paper] || PAPER.letter;
    const blocks = ep.blocks || [];
    const lay = paginate(blocks, { lines: paper.lines });
    const pages = lay.total;
    const minutes = pages * rules.minPerPage;
    const nominal = lay.info.map((inf, i) => (i === 0 ? 0 : inf.sb) + inf.L);
    const totalNominal = nominal.reduce((a, b) => a + b, 0) || 1;
    const locs = project.locs || {};
    const chars = project.chars || {};
    const dictNames = Object.keys(chars);
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
      (meta.extras || []).forEach((n) => mentioned.add(charName(n)));
      const cast = new Set([...speaking, ...mentioned]);
      const h = parseHeading(s.heading);
      const loc = locs[h.object] || {};
      const pav = h.type === 'pav' || !!loc.pav;
      const share = lines / totalNominal;
      const min = share * minutes;
      const minors = [...cast].filter((n) => chars[n] && chars[n].minor);
      const guests = [...cast].filter((n) => chars[n] && chars[n].guest);
      const tags = meta.tags || [];
      const special = tags.some((t) => SPECIAL_TAGS.includes(t)) || minors.length > 0;
      const rate = pav ? rules.ratePav : (h.type === 'ext' || h.type === 'intext') ? rules.rateExt : rules.rateInt;
      const shifts = min / (special ? rate / rules.specialFactor : rate);
      return {
        id: s.id, n: k + 1, from: s.from, to: s.to, heading: s.heading, h, pav, night: isNight(h),
        lines, share, pages: share * pages, min, sec: Math.round(min * 60), cast: [...cast], speaking: [...speaking],
        silent: [...cast].filter((n) => !speaking.has(n)), minors, guests, tags, special, shifts, replicas, dialogueWords,
        synopsis: meta.synopsis || '', day: meta.day || h.day || '', num: meta.num || String(k + 1), fileNum: !!meta.num,
        line: meta.line || '',
      };
    });
    for (const s of scenes) {
      if (s.line) continue;
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
    for (const s of scenes) {
      const t = lineMap[s.line] || (s.line ? (lineMap[s.line] = { name: s.line, scenes: 0, min: 0, pages: 0, lines: 0 }) : unassigned);
      t.scenes++; t.min += s.min; t.pages += s.pages; t.lines += s.lines;
    }
    // objects
    const objects = {};
    for (const s of scenes) {
      const key = s.h.object || '(без объекта)';
      const o = objects[key] || (objects[key] = { name: key, scenes: 0, lines: 0, min: 0, pages: 0, shifts: 0, pav: false, type: s.h.type, subs: {} });
      o.scenes++; o.lines += s.lines; o.min += s.min; o.pages += s.pages; o.shifts += s.shifts;
      o.pav = o.pav || s.pav;
      if (s.h.sub) o.subs[s.h.sub] = (o.subs[s.h.sub] || 0) + s.min;
    }
    const sceneLines = scenes.reduce((a, s) => a + s.lines, 0) || 1;
    const lineList = Object.values(lineMap).map((l) => Object.assign(l, { share: l.lines / sceneLines }));
    unassigned.share = unassigned.lines / sceneLines;
    const objList = Object.values(objects).map((o) => Object.assign(o, {
      share: o.lines / sceneLines, base: !!(locs[o.name] || {}).base, main: !!(locs[o.name] || {}).main,
    })).sort((a, b) => b.lines - a.lines);
    let main = objList.find((o) => o.main) || objList.find((o) => o.pav) || objList[0] || null;
    const totalShifts = scenes.reduce((a, s) => a + s.shifts, 0);
    const sum = (f) => scenes.filter(f).reduce((a, s) => a + s.min, 0);
    const tot = minutes || 1;
    const stats = {
      pages, minutes, scenes, objects: objList, main, totalShifts, lay,
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
    for (const s of scenes) {
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
    add('scenes', 'Количество сцен', st.scenes.length <= maxScenes ? 'ok' : st.scenes.length <= maxScenes + 2 ? 'warn' : 'fail',
      st.scenes.length + ' / ' + maxScenes, [], 'Ориентир: не больше одной сцены на страницу.');
    const shorts = st.scenes.filter((s, i) => {
      if (s.sec >= r.shortSceneSec) return false;
      const prev = st.scenes[i - 1], next = st.scenes[i + 1];
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
      const fs = st.scenes.find((s) => s.h.object === o.name);
      const label = o.name + ' · ' + fmtPages(o.pages) + ' стр., ' + o.scenes + ' сц.' + (seasonCtx && season > o.pages ? ' · за сезон ' + fmtPages(season) + ' стр.' : '');
      small.push({ sceneId: fs && fs.id, text: label, okSeason: season >= r.newObjectMinPages });
    }
    const bad = small.filter((x) => !x.okSeason);
    add('newobj', 'Новые объекты: не меньше ' + r.newObjectMinPages + ' стр.', bad.length ? 'fail' : small.length ? 'warn' : 'ok',
      bad.length ? bad.length + ' объект(а) мало' : small.length ? 'добор по сезону' : 'нет нарушений', small,
      'Объект на 1–2 сцены запрещён. Меньший объём допустим, если добор в других сериях сезона даёт полную смену, или если объект отмечен как базовый.');
    const nightPct = st.nightMin / (st.minutes || 1) * 100;
    const nightScenes = st.scenes.filter((s) => s.night);
    add('night', 'Ночь (без павильона)', nightPct <= r.nightMaxPct ? 'ok' : nightPct <= r.nightMaxPct * 1.5 ? 'warn' : 'fail',
      nightPct.toFixed(1) + '% / ' + r.nightMaxPct + '%', nightScenes.map((s) => sref(s, s.heading + (s.pav ? ' · павильон' : ''))),
      'Ночная жилая натура летом почти под запретом.');
    const extNight = nightScenes.filter((s) => s.h.type === 'ext' || s.h.type === 'intext');
    if (extNight.length) add('extnight', 'Ночная натура', 'warn', extNight.length + ' сц.', extNight.map((s) => sref(s)));
    const big = st.scenes.filter((s) => s.cast.length > r.bigCast);
    add('bigcast', 'Сцены больше ' + r.bigCast + ' артистов', big.length <= r.bigCastMaxScenes ? (big.length ? 'warn' : 'ok') : 'fail',
      big.length + ' / ' + r.bigCastMaxScenes, big.map((s) => sref(s, s.heading + ' · ' + s.cast.length + ' арт.')));
    const ens = big.filter((s) => s.sec < r.ensembleMinSec);
    add('ensemble', 'Сбор ансамбля короче ' + r.ensembleMinSec + ' с', ens.length ? 'fail' : 'ok', ens.length + ' сц.',
      ens.map((s) => sref(s, s.heading + ' · ' + s.sec + ' с')), 'Раз собрали всех, сцена должна быть плотной.');
    const small23 = st.scenes.filter((s) => s.cast.length >= 2 && s.cast.length <= 3).length;
    add('balance', 'Баланс: сцены на 2–3 артистов', 'info', small23 + ' из ' + st.scenes.length);
    const spPct = st.specialMin / (st.minutes || 1) * 100;
    const sp = st.scenes.filter((s) => s.special);
    add('special', 'Дети, животные, трюки, сложная постановка', spPct <= r.specialMaxPct ? (sp.length ? 'warn' : 'ok') : 'fail',
      spPct.toFixed(0) + '% хронометража', sp.map((s) => sref(s, s.heading + ' · ' + [...s.tags.filter((t) => SPECIAL_TAGS.includes(t)).map((t) => TAGS[t]), ...(s.minors.length ? ['несовершеннолетние: ' + s.minors.join(', ')] : [])].join(', '))),
      'Выработка в таких сценах падает в 2–3 раза.');
    const tagged = (t) => st.scenes.filter((s) => s.tags.includes(t));
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
      if (st.unassigned.scenes) details.push({ sceneId: st.scenes.find((s) => !s.line).id, text: 'без линии: ' + st.unassigned.scenes + ' сц., ' + (st.unassigned.share * 100).toFixed(0) + '%' });
      const hasTargets = st.lines.some((l) => l.target != null);
      add('lines', 'Баланс линий', !hasTargets ? 'info' : off.length ? (off.some((l) => Math.abs(l.share * 100 - l.target) > tol * 2) ? 'fail' : 'warn') : 'ok',
        st.lines.map((l) => (l.share * 100).toFixed(0) + '%').join(' / '), details, hasTargets ? 'Допуск ±' + tol + ' п.п. от цели.' : 'Цели по линиям задаются в настройках проекта: «Группа А: 50».');
    }
    const guestSilent = st.scenes.filter((s) => s.guests.some((g) => !s.speaking.includes(g)));
    const guestScenes = st.scenes.filter((s) => s.guests.length);
    if (guestScenes.length) add('guests', 'Дорогие артисты', guestSilent.length ? 'warn' : 'info', guestScenes.length + ' сц.',
      guestScenes.map((s) => sref(s, s.heading + ' · ' + s.guests.join(', ') + (guestSilent.includes(s) ? ' (без реплик)' : ''))),
      'Не вызывать «для массовки».');
    return out;
  }
  // scene numbers taken from a file: duplicates, gaps, wrong order; a proposal keeps the file's "51-" prefix
  function numberingCheck(scenes) {
    const issues = [];
    const fromFile = scenes.filter((s) => s.fileNum).length;
    if (!fromFile) return { fromFile: 0, issues, proposal: null };
    const seen = {};
    let prevN = 0;
    let prefix = '';
    for (const s of scenes) {
      const m = String(s.num).match(/^(\d+-)?(\d+)([А-ЯA-Z]?)$/);
      if (!s.fileNum) { issues.push({ sceneId: s.id, text: s.n + '. нет номера в файле' }); continue; }
      if (!m) { issues.push({ sceneId: s.id, text: s.num + ': нестандартный номер' }); continue; }
      if (m[1] && !prefix) prefix = m[1];
      const n = +m[2];
      if (seen[s.num]) issues.push({ sceneId: s.id, text: s.num + ': номер повторяется' });
      seen[s.num] = true;
      if (!m[3]) {
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
  const HEADING_START = /^\s*(?:\d+[\-–.\d]*[А-ЯA-Z]?[.)]?\s+)?(ИНТ|НАТ|ПАВ|INT|EXT|I\/E)[.\s/]/i;
  const isCaps = (s) => /[А-ЯЁA-Z]/.test(s) && !/[а-яёa-z]/.test(s.replace(/\(.*?\)/g, ''));
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
      if (HEADING_START.test(text) || styleType === 'scene') { const b = push('scene', normalizeHeadingText(text)); const ph = parseHeading(text); if (ph.guessed) b.guessed = true; if (ph.num) b.num = ph.num; continue; }
      if (styleType === 'cast' || (styleType == null && last && last.t === 'scene' && looksLikeCast(text))) { push('cast', text); continue; }
      if (styleType === 'character' && (NOT_NAMES.test(up(text)) || /^(ЗАСТАВКА|ГРАФИКА|МУЗЫКА|ИИ:)/i.test(text))) { push('action', text); continue; }
      if (styleType && styleType !== 'scene') { pushTyped(styleType, text); continue; }
      if (styled && style) { push('action', text); continue; }
      if (/^(СМЕНА КАДРА|ЗАТЕМНЕНИЕ|НАПЛЫВ|ИЗ ЗАТЕМНЕНИЯ|CUT TO|FADE)/i.test(text) && isCaps(text)) { push('transition', text); continue; }
      if (rel != null) {
        if (rel >= 3.4 && isCaps(text)) { push('transition', text); continue; }
        if (rel >= 1.6 && rel < 3.4 && isCaps(text) && text.length <= 40) { pushTyped('character', text); continue; }
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
      if (isCaps(text) && text.length <= 40 && !SENT_END.test(text.replace(/\(.*?\)$/, '').trim()) && nextText && !NOT_NAMES.test(text)) {
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
    if (items.length < 2) return items.length === 1 && /^[А-ЯЁа-яёA-Za-z\- ]{2,25}$/.test(text) && text.split(' ').length <= 2;
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
    if (/cast|действующ|участ|персонажи в сцене/.test(s)) return 'cast';
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
    txt = txt.replace(/\r/g, '').replace(/^(?:(?:Title|Credit|Author|Authors|Episode|Source|Draft date|Contact|Notes):.*\n)+/i, '');
    const lines = txt.split('\n').map((s) => ({ text: s.replace(/^\s*[>]?\s*/, '').replace(/^[.!@~]/, ''), joinable: true }));
    // Fountain forced elements and centered text are reduced to plain text
    return classifyLines(lines);
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
      if (p.getElementsByTagName('Paragraph').length) continue;
      let text = '';
      const ts = p.getElementsByTagName('Text');
      for (let j = 0; j < ts.length; j++) text += ts[j].textContent;
      text = clean(text);
      if (!text) continue;
      let t = map[p.getAttribute('Type')] || 'action';
      const fdxNum = (p.getAttribute('Number') || '').trim();
      if (t === 'scene') text = normalizeHeadingText(text);
      if (t === 'character') text = normalizeCharacter(text);
      if (t === 'paren' && !/^\(/.test(text)) text = '(' + text + ')';
      const nb = { id: uid(), t, x: text };
      if (t === 'scene' && fdxNum) nb.num = fdxNum;
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
        if (h.day || h.flash || num) report.sceneMeta[b.id] = { day: h.day, tags: h.flash ? ['flashback'] : [], num };
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
    const lay = st.lay;
    const pageOf = {};
    lay.pages.forEach((pg, k) => pg.items.forEach((it) => { if (!(it.i in pageOf)) pageOf[it.i] = k + 1; }));
    const sceneByIdx = {}; st.scenes.forEach((s) => { sceneByIdx[s.from] = s; });
    const paras = (ep.blocks || []).map((b, i) => {
      const s = sceneByIdx[i];
      const num = s ? (opts.episodePrefix && !/-/.test(s.num) ? (ep.number || 1) + '-' + s.num : s.num) : '';
      const props = s ? '<SceneProperties Length="' + fmtPages(s.pages) + '" Page="' + (pageOf[i] || 1) + '" Title="' + xmlEsc(s.synopsis || '') + '"/>' : '';
      const text = displayText(b);
      return '    <Paragraph' + (s ? ' Number="' + num + '"' : '') + ' Type="' + FDX_TYPE[b.t] + '">' + props + '<Text>' + xmlEsc(text) + '</Text></Paragraph>';
    });
    const el = (name, f, behavior) => '    <ElementSettings Type="' + name + '"><FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="Courier New" RevisionID="0" Size="12" Style=""/><ParagraphSpec Alignment="' + (f.right ? 'Right' : 'Left') + '" FirstIndent="0.00" Leading="Regular" LeftIndent="' + f.indent.toFixed(2) + '" RightIndent="' + (f.indent + f.width / 10).toFixed(2) + '" SpaceBefore="' + (f.sb * 12) + '" Spacing="1" StartsNewPage="No"/><Behavior PaginateAs="' + name + '" ReturnKey="' + behavior + '" Shortcut=""/></ElementSettings>';
    const chars = Object.keys(project.chars || {}).sort();
    const locs = new Set();
    (ep.blocks || []).filter((b) => b.t === 'scene').forEach((b) => { const h = parseHeading(b.x); if (h.object) locs.add(h.object + (h.sub ? '. ' + h.sub : '')); });
    return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n  <Content>\n' + paras.join('\n') + '\n  </Content>\n' +
      '  <TitlePage>\n    <Content>\n' + [project.name, ep.title ? 'Серия ' + (ep.number || '') + '. ' + ep.title : '', project.author || ''].filter(Boolean).map((t) => '      <Paragraph Alignment="Center" Type="General"><Text>' + xmlEsc(t) + '</Text></Paragraph>').join('\n') + '\n    </Content>\n  </TitlePage>\n' +
      el('Scene Heading', FMT.scene, 'Action') + '\n' + el('Action', FMT.action, 'Action') + '\n' + el('Character', FMT.character, 'Dialogue') + '\n' +
      el('Parenthetical', FMT.paren, 'Dialogue') + '\n' + el('Dialogue', FMT.dialogue, 'Action') + '\n' + el('Transition', FMT.transition, 'Scene Heading') + '\n' +
      '  <PageLayout BackgroundColor="#FFFFFFFFFFFF" BottomMargin="72" BreakDialogueAndActionAtSentences="Yes" DocumentLeading="Normal" FooterMargin="36" ForegroundColor="#000000000000" HeaderMargin="36" InvisiblesColor="#A0A0A0A0A0A0" TopMargin="72" UsesSmartQuotes="Yes"><AutoCastList AddParentheses="Yes" AutomaticallyGenerate="No" CastListElement="Cast List"/></PageLayout>\n' +
      '  <SmartType>\n    <Characters>\n' + chars.map((c) => '      <Character>' + xmlEsc(c) + '</Character>').join('\n') + '\n    </Characters>\n' +
      '    <Extensions>\n' + EXTENSIONS.map((x) => '      <Extension>' + xmlEsc(x) + '</Extension>').join('\n') + '\n    </Extensions>\n' +
      '    <SceneIntros>\n' + PREFIXES.map((x) => '      <SceneIntro>' + xmlEsc(x) + '</SceneIntro>').join('\n') + '\n    </SceneIntros>\n' +
      '    <Locations>\n' + [...locs].sort().map((x) => '      <Location>' + xmlEsc(x) + '</Location>').join('\n') + '\n    </Locations>\n' +
      '    <TimesOfDay Separator=" - ">\n' + TIMES.map((x) => '      <TimeOfDay>' + x + '</TimeOfDay>').join('\n') + '\n    </TimesOfDay>\n' +
      '    <Transitions>\n' + TRANSITIONS.map((x) => '      <Transition>' + xmlEsc(x) + '</Transition>').join('\n') + '\n    </Transitions>\n  </SmartType>\n</FinalDraft>\n';
  }
  function exportFountain(ep, project) {
    const out = ['Title: ' + (project.name || ''), 'Episode: ' + (ep.number || '') + (ep.title ? ' ' + ep.title : ''), ''];
    for (const b of ep.blocks || []) {
      const t = displayText(b);
      if (b.t === 'scene') out.push('', '.' + t, '');
      else if (b.t === 'character') out.push('@' + t);
      else if (b.t === 'paren') out.push(t);
      else if (b.t === 'dialogue') out.push(t, '');
      else if (b.t === 'transition') out.push('> ' + t, '');
      else out.push(t, '');
    }
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
    const paras = (ep.blocks || []).map((b, i) => {
      const f = FMT[b.t];
      const left = tw(f.indent - 1.5), right = tw(7.5 - (f.indent + f.width / 10));
      const pPr = '<w:pPr><w:spacing w:before="' + (i === 0 ? 0 : f.sb * 240) + '" w:after="0" w:line="240" w:lineRule="exact"/><w:ind w:left="' + left + '" w:right="' + Math.max(0, right) + '"/>' + (f.right ? '<w:jc w:val="right"/>' : '') + (b.t === 'scene' || b.t === 'character' ? '<w:keepNext/>' : '') + '</w:pPr>';
      if (b.t === 'scene' && sceneByIdx[i]) {
        const ft = filmtoolzHeading(sceneByIdx[i], ep);
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
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const ind = p.getElementsByTagNameNS(W, 'ind')[0];
      const st = p.getElementsByTagNameNS(W, 'pStyle')[0];
      const jc = p.getElementsByTagNameNS(W, 'jc')[0];
      const styleId = st ? st.getAttributeNS(W, 'val') : '';
      const sdef = styles[styleId] || {};
      let left = ind ? parseInt(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start') || '0', 10) / 1440 : (sdef.indent != null ? sdef.indent : 0);
      const hasIndent = !!ind || sdef.indent != null;
      let parts = [''];
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          if (c.localName === 't') parts[parts.length - 1] += c.textContent;
          else if (c.localName === 'tab') parts[parts.length - 1] += ' ';
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
        // scene numbers printed in the margins are not part of the text
        const num = /^\s*\d+[A-ZА-Я]?\.?\s*$/;
        while (r.parts.length > 1 && num.test(r.parts[0].str)) r.parts.shift();
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
        if (/^\d+[A-ZА-Я]?\.?$/.test(text)) continue;
        const gapBefore = prevY != null && prevY - r.y > 18;
        lines.push({ text: text.replace(/^\d+[A-ZА-Я]?\.?\s+(?=(ИНТ|НАТ|ПАВ|INT|EXT))/i, '').replace(/\s+\d+[A-ZА-Я]?\.?$/, (m) => HEADING_START.test(text) ? '' : m), indent: r.parts[0].x / 72, gapBefore, joinable: !gapBefore });
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
    parseLines, LINE_COLORS, autoLine, listOf,
    TYPES, TYPE_LABEL, FMT, PAPER, TIMES, PREFIXES, TRANSITIONS, EXTENSIONS, TAGS, SPECIAL_TAGS, DEFAULT_RULES, MANUAL_CHECKS,
    uid, up, clean, parseHeading, formatHeading, charName, wrap, paginate, displayText, analyzeEpisode, evalRules, fmtPages, fmtTime,
    namingIssues, fixHomoglyphs, classifyLines, importText, importFDX, absorb, exportFDX, exportFountain, docxDocumentXML, DOCX_STATIC,
    docxParagraphs, docxStyles, splitCast, splitCue, finalizeImport, numberingCheck, pdfLines, demoProject, sceneSplit, thinHistory, restoreScene, HIST, normalizeHeadingText, normalizeCharacter, filmtoolzHeading, HEADING_START,
  };
})(typeof window !== 'undefined' ? window : globalThis);
