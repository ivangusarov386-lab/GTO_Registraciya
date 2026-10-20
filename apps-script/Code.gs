/**
 * Бэкенд регистрации на ГТО.
 * Скрипт привязывается к таблице «Регистрация ГТО» (Расширения → Apps Script).
 *
 * Форма на сайте строится по самой таблице:
 *   - листы, название которых начинается с даты «дд.мм.гг», — это даты сдачи;
 *     текст после даты (например «(3-4 классы)») показывается как подпись;
 *   - поля формы — заголовки первой строки листа (кроме «№»);
 *   - если в столбце есть раскрывающийся список, на сайте будет выбор из него;
 *   - если у столбца «класс» списка нет, классы берутся из названия листа («3-4 классы»).
 *   - столбец «Правила» — отметка об ознакомлении с информационным окном на сайте;
 *     если в столбце стоят флажки, ставится галочка, иначе пишется «Ознакомлен».
 *     Текст окна — в rules.js на сайте; если заполнен лист «Правила» (столбец A), берётся оттуда.
 * Если участник с таким УИН уже записан на эту дату, сайт спрашивает, хотите ли
 * отредактировать данные, и при согласии перезаписывает его строку (№ сохраняется).
 * Остальные листы («Основной» — шаблон, «Правила») скрипт не изменяет.
 *
 * Запись на дату закрыта (дата не показывается на сайте), если лист скрыт или в его
 * названии есть слово «закрыто», например «23.11.26 (3-4 классы) [закрыто]».
 * Удобнее всего — через меню таблицы «ГТО → Закрыть / Открыть запись на эту дату».
 */

var RULES_SHEET = 'Правила';
var RULES_ACCEPTED = 'Ознакомлен';
var DATE_PREFIX_RE = /^(\d{2})\.(\d{2})\.(\d{2})\b\s*(.*)$/;
var UIN_RE = /^\d{2}-\d{2}-\d{7}$/;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

var CACHE_KEY = 'form-v1';
var CACHE_SECONDS = 300;

// GET — описание всех доступных дат сдачи и полей формы для каждой.
// Ответ кэшируется на 5 минут: повторные открытия сайта не читают таблицу заново.
function doGet(e) {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CACHE_KEY);
    if (cached) return text_(cached);
    var body = JSON.stringify({ ok: true, sheets: listDateSheets_().map(describeSheet_), rules: readRules_() });
    try { cache.put(CACHE_KEY, body, CACHE_SECONDS); } catch (err) { /* слишком большой ответ — без кэша */ }
    return text_(body);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// Любая ручная правка таблицы сбрасывает кэш, чтобы сайт сразу увидел изменения.
function onEdit() {
  clearCache_();
}

// Меню в таблице: после переименования листов или смены раскрывающихся списков
// (эти действия не вызывают onEdit) можно обновить сайт сразу, не дожидаясь 5 минут.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ГТО')
    .addItem('Закрыть запись на эту дату', 'closeRegistration')
    .addItem('Открыть запись на эту дату', 'openRegistration')
    .addSeparator()
    .addItem('Обновить данные на сайте', 'refreshSite')
    .addToUi();
}

var CLOSED_MARK = ' [закрыто]';
var CLOSED_RE = /\s*\[?\s*закрыт[а-я]*\s*\]?/i;

function isClosed_(sheet) {
  return sheet.isSheetHidden() || CLOSED_RE.test(sheet.getName());
}

// Меню «Закрыть запись на эту дату»: к названию активного листа добавляется « [закрыто]».
function closeRegistration() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (!parseSheetName_(sheet.getName())) {
    ss.toast('Сначала откройте лист с датой сдачи.', 'ГТО', 5);
    return;
  }
  if (!CLOSED_RE.test(sheet.getName())) sheet.setName(sheet.getName() + CLOSED_MARK);
  clearCache_();
  ss.toast('Запись закрыта: дата больше не показывается на сайте.', 'ГТО', 5);
}

// Меню «Открыть запись на эту дату»: из названия убирается пометка о закрытии.
function openRegistration() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (!parseSheetName_(sheet.getName())) {
    ss.toast('Сначала откройте лист с датой сдачи.', 'ГТО', 5);
    return;
  }
  sheet.setName(sheet.getName().replace(CLOSED_RE, '').trim());
  clearCache_();
  ss.toast('Запись открыта: дата снова показывается на сайте.', 'ГТО', 5);
}

function refreshSite() {
  clearCache_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Сайт покажет актуальные даты и списки при следующем открытии.', 'ГТО', 5);
}

function clearCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// POST (тело — JSON { sheet, values: { <заголовок>: <значение> }, update, originalUin }) — регистрация.
// Если УИН уже записан на эту дату и update не true, возвращает { exists: true, current }.
// originalUin — при исправлении заявки с сайта: строка ищется по прежнему УИН,
// чтобы можно было исправить и сам УИН.
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var sheet = ss.getSheetByName(String(data.sheet || ''));
    if (!sheet || !parseSheetName_(sheet.getName()) || isPast_(sheet.getName())) {
      return json_({ ok: false, closed: true, error: 'Запись на эту дату закрыта. Выберите другую дату.' });
    }
    if (isClosed_(sheet)) {
      return json_({ ok: false, closed: true, error: 'Запись на эту дату закрыта. Выберите другую дату.' });
    }

    var form = describeSheet_(sheet);
    var values = validate_(form.fields, data.values || {});

    var uinField = findField_(form.fields, 'uin');
    var existing = uinField ? findRow_(sheet, uinField.label, values[uinField.label]) : 0;

    if (uinField && data.update === true && data.originalUin && data.originalUin !== values[uinField.label]) {
      var original = findRow_(sheet, uinField.label, String(data.originalUin));
      if (existing && existing !== original) {
        return json_({ ok: false, error: 'Участник с УИН ' + values[uinField.label] + ' уже записан на ' + form.date + '.' });
      }
      existing = original || existing;
    }

    if (existing && data.update !== true) {
      return json_({ ok: false, exists: true, title: form.title, current: readRecord_(sheet, existing) });
    }

    var number = writeRecord_(sheet, existing || nextRow_(sheet), values);
    return json_({ ok: true, updated: !!existing, number: number, date: form.date, title: form.title });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Чтение структуры листов ---------- */

function listDateSheets_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .filter(function (s) { return parseSheetName_(s.getName()) && !isPast_(s.getName()) && !isClosed_(s); })
    .sort(function (a, b) {
      return parseSheetName_(a.getName()).time - parseSheetName_(b.getName()).time;
    });
}

function describeSheet_(sheet) {
  var info = parseSheetName_(sheet.getName());
  var headers = getHeaders_(sheet);
  // Проверки данных всех столбцов 2-й строки — одним запросом.
  var rules = headers.length ? sheet.getRange(2, 1, 1, headers.length).getDataValidations()[0] : [];
  var fields = [];
  headers.forEach(function (label, i) {
    if (!label || isNumberColumn_(label)) return;
    var field = { label: label, kind: kindOf_(label), options: optionsFromRule_(rules[i]) };
    if (field.kind === 'rules') {
      field.options = null;
      field.checkbox = !!rules[i] && rules[i].getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
    }
    if (!field.options && field.kind === 'grade') field.options = gradesFromLabel_(info.label);
    fields.push(field);
  });
  return {
    sheet: sheet.getName(),
    date: info.date,
    label: info.label,
    title: info.label ? info.date + ' — ' + info.label : info.date,
    fields: fields,
  };
}

// Текст правил: каждая непустая ячейка столбца A листа «Правила» — отдельный абзац.
function readRules_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RULES_SHEET);
  if (!sheet || sheet.getLastRow() === 0) return [];
  return sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (v) { return v; });
}


// «23.11.26 (3-4 классы)» → { date: '23.11.26', label: '3-4 классы', time }
function parseSheetName_(name) {
  var m = DATE_PREFIX_RE.exec(String(name).trim());
  if (!m) return null;
  var d = new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return {
    date: m[1] + '.' + m[2] + '.' + m[3],
    label: m[4].replace(/^[\s(\-–—]+|[\s)]+$/g, ''),
    time: d.getTime(),
  };
}

function isPast_(name) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return parseSheetName_(name).time < today;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });
}

// Варианты из раскрывающегося списка столбца (правило проверки данных во 2-й строке).
function optionsFromRule_(rule) {
  if (!rule) return null;
  var type = rule.getCriteriaType();
  var args = rule.getCriteriaValues();
  var list = null;
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    list = args[0];
  } else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    list = [].concat.apply([], args[0].getDisplayValues());
  }
  if (!list) return null;
  var seen = {};
  list = list.map(function (v) { return String(v).trim(); })
    .filter(function (v) { return v && !seen[v] && (seen[v] = true); });
  return list.length ? list : null;
}

// «3-4 классы» → ['3', '4']; «5 класс» → ['5']
function gradesFromLabel_(label) {
  var m = /(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s*кл/i.exec(label || '');
  if (!m) return null;
  var from = Number(m[1]), to = Number(m[2] || m[1]), out = [];
  for (var g = from; g <= to && g <= 11; g++) out.push(String(g));
  return out.length ? out : null;
}

function kindOf_(label) {
  var l = label.toLowerCase();
  if (/e-?mail|почт/.test(l)) return 'email';
  if (l.indexOf('уин') !== -1) return 'uin';
  if (l.indexOf('фио') !== -1) return 'fio';
  if (l.indexOf('ступен') !== -1) return 'stage';
  if (l === 'пол') return 'gender';
  if (l.indexOf('класс') !== -1) return 'grade';
  if (l.indexOf('букв') !== -1) return 'letter';
  if (l.indexOf('правил') !== -1) return 'rules';
  return 'text';
}

function isNumberColumn_(label) {
  return label === '№' || /^(n|no|номер|№ п\/п)$/i.test(label);
}

function findField_(fields, kind) {
  for (var i = 0; i < fields.length; i++) if (fields[i].kind === kind) return fields[i];
  return null;
}

/* ---------- Проверка и запись ---------- */

function validate_(fields, raw) {
  var out = {};
  fields.forEach(function (f) {
    if (f.kind === 'rules') {
      if (raw[f.label] !== true) throw new Error('Подтвердите регистрацию на сайте ГТО.');
      out[f.label] = f.checkbox ? true : RULES_ACCEPTED;
      return;
    }
    var v = String(raw[f.label] == null ? '' : raw[f.label]).replace(/\s+/g, ' ').trim();
    if (!v) throw new Error('Заполните поле «' + f.label + '».');
    if (f.options && f.options.indexOf(v) === -1) {
      throw new Error('Недопустимое значение в поле «' + f.label + '».');
    }
    if (f.kind === 'uin' && !UIN_RE.test(v)) throw new Error('УИН должен быть в формате 00-00-0000000.');
    if (f.kind === 'fio' && v.split(' ').length < 2) throw new Error('Укажите фамилию и имя.');
    if (f.kind === 'email') {
      v = v.replace(/\s/g, '').toLowerCase();
      if (!EMAIL_RE.test(v)) throw new Error('Проверьте адрес электронной почты.');
    }
    out[f.label] = v;
  });
  return out;
}

// Записывает значения в строку row по столбцам с такими же заголовками.
// № новой строки — порядковый, у существующей не меняется.
function writeRecord_(sheet, row, values) {
  var headers = getHeaders_(sheet);
  var range = sheet.getRange(row, 1, 1, headers.length);
  var old = range.getValues()[0];
  var keys = Object.keys(values);
  var number = row - 1; // строка 1 — заголовок
  var record = headers.map(function (h, i) {
    if (isNumberColumn_(h)) {
      if (old[i] !== '' && old[i] != null) number = old[i];
      return number;
    }
    var key = matchKey_(keys, h);
    return key ? toCell_(h, values[key]) : old[i];
  });
  headers.forEach(function (h, i) {
    if (kindOf_(h) === 'uin') sheet.getRange(row, i + 1).setNumberFormat('@');
  });
  range.setValues([record]);
  return number;
}

// Первая строка после последней заполненной. Столбцы «№» и «Правила» не учитываются:
// в шаблоне они могут быть заранее заполнены номерами или пустыми флажками.
function nextRow_(sheet) {
  var headers = getHeaders_(sheet);
  var last = sheet.getLastRow();
  if (last < 2) return 2;
  var rows = sheet.getRange(2, 1, last - 1, headers.length).getDisplayValues();
  for (var r = rows.length - 1; r >= 0; r--) {
    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      if (!h || isNumberColumn_(h) || kindOf_(h) === 'rules') continue;
      if (String(rows[r][c]).trim()) return r + 3;
    }
  }
  return 2;
}

function readRecord_(sheet, row) {
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
  var out = {};
  headers.forEach(function (h, i) {
    if (h && !isNumberColumn_(h) && kindOf_(h) !== 'rules') out[h] = values[i];
  });
  return out;
}

function matchKey_(keys, header) {
  var h = header.toLowerCase();
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === h) return keys[i];
  return null;
}

// Числа пишем числами (как в выпадающих списках), УИН и прочее — текстом.
function toCell_(header, v) {
  if (typeof v !== 'string') return v;
  if (kindOf_(header) !== 'uin' && /^\d+$/.test(v)) return Number(v);
  return v;
}

// Номер строки, где в столбце header стоит value, или 0.
function findRow_(sheet, header, value) {
  var col = getHeaders_(sheet).map(function (h) { return h.toLowerCase(); }).indexOf(header.toLowerCase());
  var last = sheet.getLastRow();
  if (col === -1 || last < 2) return 0;
  var cells = sheet.getRange(2, col + 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < cells.length; i++) if (cells[i][0].trim() === value) return i + 2;
  return 0;
}

function text_(body) {
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
