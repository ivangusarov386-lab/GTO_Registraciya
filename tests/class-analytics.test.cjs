const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../apps-script/Code.gs'), 'utf8'), context);
  return context;
}
const headers = ['№', 'ФИО', 'УИН', 'Класс', 'Буква', 'Пол', 'Ступень', 'Email', 'Правила'];
function sheet(name, occupied = false, owned = false) {
  const calls = [];
  return {
    calls,
    getName: () => name,
    getMaxColumns: () => 11,
    getMaxRows: () => 100,
    getLastColumn: () => 11,
    getLastRow: () => 3,
    getRange(row, col, rows = 1, cols = 1) {
      const range = {
        getDisplayValues: () => row === 1 ? [headers.slice(col - 1, col - 1 + cols)] : [Array(cols).fill(''), Array(cols).fill('')],
        getValues: () => [Array(cols).fill('')],
        getNote: () => owned ? 'gto-class-analytics-v1' : '',
        isBlank: () => !occupied,
        setFormula(f) { calls.push({ type: 'formula', row, col, f }); return range; },
        setNote() { owned = true; return range; },
        setFontWeight() { return range; },
        setBackground() { return range; },
        setNumberFormat() { return range; },
        setValues(values) { calls.push({ type: 'values', col, cols, values }); return range; },
      };
      return range;
    },
    setColumnWidth() {},
  };
}
function attach(context, sheets) {
  context.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => sheets, toast() {} }) };
  context.clearCache_ = () => {};
}
test('formula groups local grade + letter and counts nonempty UIN', () => {
  const c = load();
  const f = c.classAnalyticsFormula_(headers);
  assert.ok(f.includes('TRIM(TO_TEXT(D2:D)&UPPER(TRIM(E2:E)))'));
  assert.ok(f.includes(',C2:C)'));
  assert.ok(f.includes("where Col2 is not null and Col1 <> '' group by Col1"));
  assert.ok(f.endsWith('HSTACK("Класс","Количество зарегистрированных"))'));
  assert.ok(!f.includes('Основной!'));
});
test('supports grade without letter and FIO instead of UIN; rejects missing class', () => {
  const c = load();
  const f = c.classAnalyticsFormula_(['ФИО', 'Класс']);
  assert.ok(f.includes('TO_TEXT(B2:B)'));
  assert.ok(f.includes(',A2:A)'));
  assert.throws(() => c.classAnalyticsFormula_(['ФИО']), /Класс/);
});
test('sets template and both dates, leaves rules alone, can run twice', () => {
  const c = load();
  const sheets = ['Основной', '23.11.26 (3-4 классы)', '20.01.27 (5-6 классы)', 'Правила'].map(n => sheet(n));
  attach(c, sheets);
  c.setupClassAnalytics();
  c.setupClassAnalytics();
  for (const s of sheets.slice(0, 3)) {
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].col, 10);
    assert.equal(s.calls[0].f, s.calls[1].f);
  }
  assert.equal(sheets[3].calls.length, 0);
});
test('occupied analytics area stops all writes in preflight', () => {
  const c = load();
  const sheets = [sheet('Основной'), sheet('23.11.26', true)];
  attach(c, sheets);
  assert.throws(() => c.setupClassAnalytics(), /J:K заняты/);
  assert.ok(sheets.every(s => s.calls.length === 0));
});
test('analytics cannot become form headers, append phantom registrations or be overwritten by registration', () => {
  const c = load();
  const s = sheet('23.11.26');
  assert.equal(c.getHeaders_(s).length, 9);
  assert.equal(c.nextRow_(s), 2);
  c.writeRecord_(s, 2, { 'ФИО': 'Иванов Иван', 'Класс': '3' });
  const write = s.calls.find(call => call.type === 'values');
  assert.equal(write.col, 1);
  assert.equal(write.cols, 9);
  assert.equal(write.values[0][1], 'Иванов Иван');
});
