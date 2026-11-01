// synthetic КИТ Сценарист (.kitsp) and Story Architect (.starc) files: SQLite databases built with sql.js, with the
// tables and XML the two programs write (see README, «КИТ Сценарист и Story Architect»)
const path = require('path');
const initSqlJs = require('sql.js');
const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
const v = (tag, text, attrs) => '<' + tag + (attrs || '') + '><v><![CDATA[' + text + ']]></v></' + tag + '>\n';
const KIT_XML = '<?xml version="1.0"?>\n<scenario version="1.0">\n' +
  v('folder_header', 'ПЕРВЫЙ АКТ', ' uuid="{f1}"') +
  v('scene_heading', 'ИНТ. КВАРТИРА МАШИ - ДЕНЬ', ' uuid="{s1}" number="5"') +
  v('scene_characters', 'МАША, ПЕТЯ, СОСЕД') +
  v('scene_description', 'Маша ждёт Петю.') +
  v('action', 'Маша смотрит в окно. Петя &amp; кот.') +
  v('character', 'Маша') + v('parenthetical', 'тихо') + v('dialog', 'Ну и где он?') +
  v('noprintable_text', 'не печатать') +
  v('title_header', 'ТИТР:') + v('title', 'Москва, 1999') +
  '<splitter_start/>\n' + v('character', 'МАША') + v('dialog', 'Да.') + '<splitter/>\n' + v('character', 'ПЕТЯ') + v('dialog', 'Нет.') + '<splitter_end/>\n' +
  v('transition', 'СМЕНА КАДРА:') +
  v('folder_footer', 'КОНЕЦ ПАПКИ') +
  v('scene_heading', 'НАТ. ДВОР - НОЧЬ', ' uuid="{s2}"') + v('note', 'Тишина.') +
  '</scenario>\n';
const STARC_XML = (n) => '<?xml version="1.0"?>\n<document mime-type="application/x-starc/document/screenplay/text" version="1.0">\n' +
  '<scene uuid="{a' + n + '}" plots=""><number value="7" custom="true" eat="true" fixed="true"/><story_day><![CDATA[День 3]]></story_day><description><![CDATA[Завязка]]></description>\n<content>\n' +
  v('scene_heading', 'ИНТ. КУХНЯ - ДЕНЬ') + v('scene_characters', 'МАША, ВАСЯ, ТЁТЯ') +
  v('action', 'Маша пьёт чай.\nВася молчит.') +
  v('character', 'МАША') + v('parenthetical', '(в сторону)') + v('dialogue', '&lt;шёпотом&gt; Тсс.') +
  v('inline_note', 'заметка автора') +
  '<splitter type="start"/>\n' +
  '<character><params ifc="true"/><v><![CDATA[МАША]]></v></character>\n<dialogue><params ifc="true"/><v><![CDATA[Раз.]]></v></dialogue>\n' +
  '<character><params ifc="false"/><v><![CDATA[ВАСЯ]]></v></character>\n<dialogue><params ifc="false"/><v><![CDATA[Два.]]></v></dialogue>\n' +
  '<splitter type="end"/>\n' + v('shot', 'КРУПНО — ЧАШКА') +
  '</content>\n</scene>\n' +
  '<scene uuid="{b' + n + '}" plots="" omited="true"><content>\n' + v('scene_heading', 'НАТ. УЛИЦА - НОЧЬ') + v('action', 'Дождь.') + '</content>\n</scene>\n' +
  '<scene uuid="{c' + n + '}" plots=""><content>\n' + v('scene_heading', 'ИНТ. ПОДЪЕЗД - НОЧЬ') + v('action', 'Темно' + (n > 1 ? ' ' + n : '') + '.') + '</content>\n</scene>\n' +
  '</document>\n';
const it = (uuid, type, name, kids) => '<item uuid="' + uuid + '" type="' + type + '" name="' + name + '" draft_name="" color="#000000" draft_color="" visible="true"' + (kids ? '>\n' + kids + '</item>\n' : '/>\n');
async function build(opts) {
  const SQL = await initSqlJs({ locateFile: () => wasm });
  const kit = new SQL.Database();
  kit.run('CREATE TABLE scenario (id INTEGER PRIMARY KEY AUTOINCREMENT, scheme TEXT NOT NULL, text TEXT NOT NULL, is_draft INTEGER NOT NULL DEFAULT(0))');
  kit.run('CREATE TABLE scenario_data (id INTEGER PRIMARY KEY AUTOINCREMENT, data_name TEXT NOT NULL UNIQUE, data_value TEXT DEFAULT(NULL))');
  kit.run('INSERT INTO scenario (scheme, text, is_draft) VALUES (?, ?, 1)', ['', '<?xml version="1.0"?>\n<scenario version="1.0">' + v('scene_heading', 'ИНТ. ЧЕРНОВИК - ДЕНЬ') + '</scenario>']);
  kit.run('INSERT INTO scenario (scheme, text, is_draft) VALUES (?, ?, 0)', ['', KIT_XML]);
  kit.run("INSERT INTO scenario_data (data_name, data_value) VALUES ('name', 'Квартирный вопрос'), ('author', 'И. Петров'), ('contacts', 'petrov@example.ru')");
  const starc = new SQL.Database();
  starc.run('CREATE TABLE system_variables (variable TEXT PRIMARY KEY ON CONFLICT REPLACE, value TEXT NOT NULL)');
  starc.run('CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL, type INTEGER NOT NULL DEFAULT(0), content BLOB DEFAULT(NULL), synced_at TEXT DEFAULT(NULL))');
  const two = !(opts && opts.single);
  const structure = '<?xml version="1.0"?>\n<document mime-type="application/x-starc/document/structure" version="1.0">\n' +
    it('{p}', 10000, 'Проект') +
    it('{sp1}', 10100, 'Пилот', it('{tp1}', 10101, 'Титульная страница') + it('{tx1}', 10104, 'Сценарий', '<draft uuid="{dr1}" name="Старая версия" color="#ff0000" readonly="true"/>\n')) +
    (two ? it('{sp2}', 10100, 'Серия 2 &amp; финал', it('{tx2}', 10104, 'Сценарий')) : '') +
    it('{bin}', 10001, 'Корзина', it('{sp3}', 10100, 'Удалённый', it('{tx3}', 10104, 'Сценарий'))) +
    '</document>';
  const put = (uuid, type, content) => starc.run('INSERT INTO documents (uuid, type, content) VALUES (?, ?, ?)', [uuid, type, content == null ? null : new TextEncoder().encode(content)]);
  put('{struct}', 1, structure); put('{p}', 10000, '<document/>'); put('{sp1}', 10100, '<document/>');
  put('{tx1}', 10104, STARC_XML(1)); put('{dr1}', 10104, STARC_XML(9));
  if (two) put('{tx2}', 10104, STARC_XML(2));
  put('{tx3}', 10104, STARC_XML(3));
  const out = { kitsp: kit.export(), starc: starc.export(), SQL };
  kit.close(); starc.close();
  return out;
}
module.exports = { build, KIT_XML, STARC_XML };
