/*
 * Voice input / Quick Notes shared keyword-guessing (v47.78 unification).
 * Before this round, voice input was hardcoded to Arabic (both the
 * SpeechRecognition lang and its category/number-word parsers), while Quick
 * Notes had its own separate bilingual, normalizeSearch-folded tables.
 * Pins: English number-word parsing, the unified category/income guessers,
 * and that both entry points now agree on the same guesses.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./sandbox');

const app = loadApp();

test('parseArabicNumber — English number words parse (voiceRecognition.lang now follows app language)', () => {
  assert.equal(app.parseArabicNumber('fifty'), 50);
  assert.equal(app.parseArabicNumber('one hundred'), 100);
  assert.equal(app.parseArabicNumber('one hundred fifty'), 150);
  assert.equal(app.parseArabicNumber('two thousand'), 2000);
  assert.equal(app.parseArabicNumber('twenty five'), 25);
  assert.equal(app.parseArabicNumber('spent fifty on lunch'), 50);
});

test('parseArabicNumber — English words do not interfere with Arabic parsing', () => {
  assert.equal(app.parseArabicNumber('صرفت خمسين على عشاء'), 50);
  assert.equal(app.parseArabicNumber('مية وخمسين'), 150);
});

test('parseArabicNumber — digits still work regardless of language (unchanged)', () => {
  assert.equal(app.parseArabicNumber('50'), 50);
  assert.equal(app.parseArabicNumber('paid 75 dollars for lunch'), 75);
});

test('guessCategoryShared — bilingual keyword matching with orthographic folding', () => {
  assert.equal(app.guessCategoryShared('قهوه في المقهى'), 'food'); // "قهوه" without teh-marbuta
  assert.equal(app.guessCategoryShared('coffee at the cafe'), 'food');
  assert.equal(app.guessCategoryShared('paid for uber'), 'transport');
  assert.equal(app.guessCategoryShared('اوبر للمطار'), 'transport');
});

test('guessCategoryShared — salary keyword only applies when type is income', () => {
  assert.equal(app.guessCategoryShared('راتب هذا الشهر', 'income'), 'salary');
  assert.equal(app.guessCategoryShared('راتب هذا الشهر', 'expense'), null,
    'salary group must not match an expense-typed row');
  assert.equal(app.guessCategoryShared('راتب هذا الشهر'), null, 'no type passed = no salary match');
});

test('guessCategoryShared — no match returns null (caller decides the fallback)', () => {
  assert.equal(app.guessCategoryShared('xyz something unrelated'), null);
});

test('isIncomeTextShared — bilingual income-word detection', () => {
  assert.ok(app.isIncomeTextShared('استلمت راتبي'));
  assert.ok(app.isIncomeTextShared('received my salary'));
  assert.ok(app.isIncomeTextShared('hozzoli 1000 هدية'));
  assert.ok(!app.isIncomeTextShared('اشتريت قهوة'));
});

test('guessType/guessCategory (voice) — English transcript end-to-end', () => {
  assert.equal(app.guessType('I received my salary'), 'income');
  assert.equal(app.guessType('bought coffee'), 'expense');
  const type = app.guessType('spent fifty on coffee');
  assert.equal(app.guessCategory('spent fifty on coffee', type), 'food');
});

test('_qnGuessCategory (Quick Notes) — falls back to salary/other, matches voice guesses', () => {
  assert.equal(app._qnGuessCategory('قهوه 20', 'expense'), 'food');
  assert.equal(app._qnGuessCategory('راتب 5000', 'income'), 'salary');
  assert.equal(app._qnGuessCategory('xyz 20', 'expense'), 'other', 'no-match expense falls back to other');
  assert.equal(app._qnGuessCategory('xyz 20', 'income'), 'salary', 'no-match income falls back to salary');
});

test('voice and Quick Notes agree on the same category for the same text (shared table)', () => {
  const text = 'اشتريت قهوة بالمطعم';
  const voiceCat = app.guessCategory(text, 'expense');
  const qnCat = app._qnGuessCategory(text, 'expense');
  assert.equal(voiceCat, qnCat);
  assert.equal(voiceCat, 'food');
});
