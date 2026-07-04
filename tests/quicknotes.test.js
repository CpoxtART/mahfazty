/*
 * parseQuickNotes — the app's most intricate free-text parser (trailing-
 * wallet-name peeling, glued-clitic number cutting, bilingual income/category
 * guessing) had zero automated coverage before this suite; every prior fix to
 * it (the "كاردز" wallet-alias fix, the glued-preposition cut) was verified
 * only by throwaway manual Playwright scripts. Pins the exact repro cases
 * from those fixes plus the core parsing contract.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./sandbox');

const app = loadApp();

const DEFS = [
  { id: 'core', name: 'Core Expenses', initial: 0, track: false, pct: '50%' },
  { id: 'joy', name: 'Joy of Life', initial: 0, track: false, pct: '10%' },
  { id: 'uber', name: 'Uber', initial: 0, track: true, pct: 'track' },
  { id: 'cards', name: 'Bank Cards', initial: 0, track: true, pct: 'track' },
  { id: 'cash', name: 'Cash', initial: 0, track: true, pct: 'track' },
];

function stage(){
  app.applyWalletDefs(DEFS.map(d => ({ ...d })));
  app.recomputeSelectableWallets();
}

test('parseQuickNotes — basic "description amount" line', () => {
  stage();
  const [row] = app.parseQuickNotes('قهوة 20');
  assert.strictEqual(row.valid, true);
  assert.strictEqual(row.amount, 20);
  assert.strictEqual(row.desc, 'قهوة');
  assert.strictEqual(row.type, 'expense');
});

test('parseQuickNotes — "+" marks a line as income', () => {
  stage();
  const [row] = app.parseQuickNotes('راتب 5000+');
  assert.strictEqual(row.type, 'income');
  assert.strictEqual(row.amount, 5000);
});

test('parseQuickNotes — income keyword alone (no "+") also marks income', () => {
  stage();
  const [row] = app.parseQuickNotes('استلمت هدية 200');
  assert.strictEqual(row.type, 'income');
});

test('parseQuickNotes — amount is the LAST number on the line (description comes first)', () => {
  stage();
  const [row] = app.parseQuickNotes('غرفة 101 فاتورة 250');
  assert.strictEqual(row.amount, 250);
});

test('parseQuickNotes — thousands separators and Arabic-Indic digits both parse', () => {
  stage();
  assert.strictEqual(app.parseQuickNotes('إيجار 1,500')[0].amount, 1500);
  assert.strictEqual(app.parseQuickNotes('قهوة ٥٠')[0].amount, 50);
});

test('parseQuickNotes — a line with no number is invalid but still produces a row', () => {
  stage();
  const [row] = app.parseQuickNotes('كلام بدون رقم');
  assert.strictEqual(row.valid, false);
  assert.ok(Number.isNaN(row.amount));
});

test('parseQuickNotes — empty lines are skipped, batch caps respected', () => {
  stage();
  const rows = app.parseQuickNotes('قهوة 20\n\n\nشاي 10');
  assert.strictEqual(rows.length, 2);
});

test('parseQuickNotes — glued preposition before the number is stripped from desc (not left orphaned)', () => {
  stage();
  // "ب500" = "for 500" with no space — regression case from the exact user
  // report this fix targeted: the trailing "ب" must not survive in the desc
  const [row] = app.parseQuickNotes('حب شمس مكسرات ب500');
  assert.strictEqual(row.amount, 500);
  assert.ok(!row.desc.endsWith('ب'), `desc "${row.desc}" must not end with an orphaned ب`);
});

test('parseQuickNotes — a glued preposition mid-word is NOT mistaken for the clitic (no over-stripping)', () => {
  stage();
  // "كتاب100" — trailing "ب" is part of the word "كتاب", not a standalone
  // preposition clitic; must not be stripped
  const [row] = app.parseQuickNotes('كتاب100');
  assert.strictEqual(row.amount, 100);
  assert.ok(row.desc.includes('كتاب'), `desc "${row.desc}" must keep the whole word "كتاب"`);
});

test('parseQuickNotes — trailing wallet name is peeled into row.wallet, not left in desc', () => {
  stage();
  const [row] = app.parseQuickNotes('قهوة 20 المتعة');
  assert.strictEqual(row.wallet, 'joy');
  assert.ok(!row.desc.includes('المتعة'), 'wallet name must be removed from desc once peeled');
});

test('parseQuickNotes — trailing track-wallet alias sets row.track (the reported bug\'s exact repro)', () => {
  stage();
  // the exact line from the user's bug report: wallet "joy" (متعة) + track "cards" (كاردز)
  const [row] = app.parseQuickNotes('حب شمس مكسرات ب500 المتعة كاردز');
  assert.strictEqual(row.amount, 500);
  assert.strictEqual(row.wallet, 'joy');
  assert.strictEqual(row.track, 'cards');
});

test('parseQuickNotes — a trailing word that matches no wallet alias is left as part of the description', () => {
  stage();
  const [row] = app.parseQuickNotes('قهوة 20 شيء_غريب');
  assert.strictEqual(row.wallet, null);
  assert.ok(row.desc.includes('شيء_غريب'));
});

test('parseQuickNotes — currency words are dropped from the trailing edge of desc', () => {
  stage();
  const [row] = app.parseQuickNotes('عشاء 100 ريال');
  assert.strictEqual(row.amount, 100);
  assert.ok(!row.desc.includes('ريال'));
});

test('parseQuickNotes — category guess flows through to each row', () => {
  stage();
  const [row] = app.parseQuickNotes('قهوة 20');
  assert.strictEqual(row.category, 'food');
});
