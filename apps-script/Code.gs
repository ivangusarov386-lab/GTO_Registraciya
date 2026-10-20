/**
 * Бэкенд регистрации на ГТО.
 * Скрипт привязывается к таблице «Регистрация ГТО» (Расширения → Apps Script).
 *
 * Листы таблицы:
 *   «Основной»  — общий список всех зарегистрированных (без повторов по УИН);
 *   «дд.мм.гг»  — отдельный лист на каждую дату сдачи.
 * Колонки на всех листах: № | ФИО | УИН | Ступень | пол | класс | Буква
 */

var MAIN_SHEET = 'Основной';
var HEADER = ['№', 'ФИО', 'УИН', 'Ступень', 'пол', 'класс', 'Буква'];
var DATE_SHEET_RE = /^\d{2}\.\d{2}\.\d{2}$/;
var UIN_RE = /^\d{2}-\d{2}-\d{7}$/;

// GET ?action=dates — список дат сдачи (названия листов вида дд.мм.гг).
function doGet(e) {
  return json_({ ok: true, dates: listDates_() });
}

// POST (тело — JSON) — регистрация участника на выбранную дату.
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    var p = validate_(data);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dateSheet = ss.getSheetByName(p.date);
    if (!dateSheet || !DATE_SHEET_RE.test(p.date)) {
      return json_({ ok: false, error: 'Дата сдачи не найдена.' });
    }
    if (findUin_(dateSheet, p.uin)) {
      return json_({ ok: false, error: 'Участник с таким УИН уже записан на ' + p.date + '.' });
    }

    var number = appendRow_(dateSheet, p);

    var main = ss.getSheetByName(MAIN_SHEET);
    if (main && !findUin_(main, p.uin)) {
      appendRow_(main, p);
    }

    return json_({ ok: true, number: number, date: p.date });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function listDates_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (name) { return DATE_SHEET_RE.test(name); })
    .filter(function (name) { return parseDate_(name) >= today_(); })
    .sort(function (a, b) { return parseDate_(a) - parseDate_(b); });
}

function validate_(d) {
  var p = {
    date: String(d.date || '').trim(),
    fio: String(d.fio || '').replace(/\s+/g, ' ').trim(),
    uin: String(d.uin || '').trim(),
    stage: parseInt(d.stage, 10),
    gender: String(d.gender || '').trim(),
    grade: parseInt(d.grade, 10),
    letter: String(d.letter || '').trim().toUpperCase(),
  };
  if (p.fio.split(' ').length < 2) throw new Error('Укажите фамилию и имя.');
  if (!UIN_RE.test(p.uin)) throw new Error('УИН должен быть в формате 00-00-0000000.');
  if (!(p.stage >= 1 && p.stage <= 7)) throw new Error('Неверная ступень.');
  if (p.gender !== 'м' && p.gender !== 'ж') throw new Error('Укажите пол.');
  if (!(p.grade >= 1 && p.grade <= 11)) throw new Error('Неверный класс.');
  if (!/^[А-ЯЁ]$/.test(p.letter)) throw new Error('Буква класса — одна русская буква.');
  return p;
}

function appendRow_(sheet, p) {
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADER);
  var number = sheet.getLastRow(); // строка 1 — заголовок
  sheet.appendRow([number, p.fio, p.uin, p.stage, p.gender, p.grade, p.letter]);
  // УИН хранится как текст, чтобы таблица не превратила его в число/дату.
  sheet.getRange(sheet.getLastRow(), 3).setNumberFormat('@').setValue(p.uin);
  return number;
}

function findUin_(sheet, uin) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var values = sheet.getRange(2, 3, last - 1, 1).getDisplayValues();
  return values.some(function (r) { return r[0].trim() === uin; });
}

function parseDate_(name) {
  var m = name.split('.');
  return new Date(2000 + Number(m[2]), Number(m[1]) - 1, Number(m[0]));
}

function today_() {
  var d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
