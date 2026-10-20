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
 * «Основной» — общий список всех участников (без повторов по УИН).
 */

var MAIN_SHEET = 'Основной';
var DATE_PREFIX_RE = /^(\d{2})\.(\d{2})\.(\d{2})\b\s*(.*)$/;
var UIN_RE = /^\d{2}-\d{2}-\d{7}$/;

// GET — описание всех доступных дат сдачи и полей формы для каждой.
function doGet(e) {
  try {
    return json_({ ok: true, sheets: listDateSheets_().map(describeSheet_) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// POST (тело — JSON { sheet, values: { <заголовок>: <значение> } }) — регистрация.
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var sheet = ss.getSheetByName(String(data.sheet || ''));
    if (!sheet || !parseSheetName_(sheet.getName()) || isPast_(sheet.getName())) {
      return json_({ ok: false, error: 'Дата сдачи не найдена. Обновите страницу.' });
    }

    var form = describeSheet_(sheet);
    var values = validate_(form.fields, data.values || {});

    var uinField = findField_(form.fields, 'uin');
    if (uinField && hasValue_(sheet, uinField.label, values[uinField.label])) {
      return json_({ ok: false, error: 'Участник с таким УИН уже записан на ' + form.date + '.' });
    }

    var number = appendRecord_(sheet, values);

    var main = ss.getSheetByName(MAIN_SHEET);
    if (main && !(uinField && hasValue_(main, uinField.label, values[uinField.label]))) {
      appendRecord_(main, values);
    }

    return json_({ ok: true, number: number, date: form.date, title: form.title });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Чтение структуры листов ---------- */

function listDateSheets_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .filter(function (s) { return parseSheetName_(s.getName()) && !isPast_(s.getName()); })
    .sort(function (a, b) {
      return parseSheetName_(a.getName()).time - parseSheetName_(b.getName()).time;
    });
}

function describeSheet_(sheet) {
  var info = parseSheetName_(sheet.getName());
  var headers = getHeaders_(sheet);
  var fields = [];
  headers.forEach(function (label, i) {
    if (!label || isNumberColumn_(label)) return;
    var field = { label: label, kind: kindOf_(label), options: readOptions_(sheet, i + 1) };
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

// Варианты из раскрывающегося списка столбца (проверка данных во 2-й строке).
function readOptions_(sheet, col) {
  var rule = sheet.getRange(2, col).getDataValidation();
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
  if (l.indexOf('уин') !== -1) return 'uin';
  if (l.indexOf('фио') !== -1) return 'fio';
  if (l.indexOf('ступен') !== -1) return 'stage';
  if (l === 'пол') return 'gender';
  if (l.indexOf('класс') !== -1) return 'grade';
  if (l.indexOf('букв') !== -1) return 'letter';
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
    var v = String(raw[f.label] == null ? '' : raw[f.label]).replace(/\s+/g, ' ').trim();
    if (!v) throw new Error('Заполните поле «' + f.label + '».');
    if (f.options && f.options.indexOf(v) === -1) {
      throw new Error('Недопустимое значение в поле «' + f.label + '».');
    }
    if (f.kind === 'uin' && !UIN_RE.test(v)) throw new Error('УИН должен быть в формате 00-00-0000000.');
    if (f.kind === 'fio' && v.split(' ').length < 2) throw new Error('Укажите фамилию и имя.');
    out[f.label] = v;
  });
  return out;
}

// Добавляет строку, раскладывая значения по столбцам с такими же заголовками.
function appendRecord_(sheet, values) {
  var headers = getHeaders_(sheet);
  var row = sheet.getLastRow() + 1;
  var number = row - 1; // строка 1 — заголовок
  var keys = Object.keys(values);
  var record = headers.map(function (h) {
    if (isNumberColumn_(h)) return number;
    var key = matchKey_(keys, h);
    return key ? toCell_(h, values[key]) : '';
  });
  headers.forEach(function (h, i) {
    if (kindOf_(h) === 'uin') sheet.getRange(row, i + 1).setNumberFormat('@');
  });
  sheet.getRange(row, 1, 1, headers.length).setValues([record]);
  return number;
}

function matchKey_(keys, header) {
  var h = header.toLowerCase();
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === h) return keys[i];
  return null;
}

// Числа пишем числами (как в выпадающих списках), УИН и прочее — текстом.
function toCell_(header, v) {
  if (kindOf_(header) !== 'uin' && /^\d+$/.test(v)) return Number(v);
  return v;
}

function hasValue_(sheet, header, value) {
  var col = getHeaders_(sheet).map(function (h) { return h.toLowerCase(); }).indexOf(header.toLowerCase());
  var last = sheet.getLastRow();
  if (col === -1 || last < 2) return false;
  return sheet.getRange(2, col + 1, last - 1, 1).getDisplayValues()
    .some(function (r) { return r[0].trim() === value; });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
