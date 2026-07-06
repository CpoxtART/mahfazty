/*
 * Unit tests for Mahfazty's pure helper functions — the financial/format/parse
 * core where a regression is most dangerous and least visible. Run with:
 *   node --test tests/
 * No browser, no build step: the real source is loaded via tests/sandbox.js.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./sandbox.js');

const app = loadApp();

test('round2 — banker-safe money rounding', () => {
  // the whole reason round2 exists: 1.005*100 is 100.4999… in float, so a plain
  // Math.round misrounds it down to 1.00. The relative-epsilon nudge fixes that.
  assert.equal(app.round2(1.005), 1.01);
  assert.equal(app.round2(0.1 + 0.2), 0.3);
  assert.equal(app.round2(2.675), 2.68);
  assert.equal(app.round2(100), 100);
  assert.equal(app.round2(-1.005), -1.01); // symmetric: same magnitude correction as +1.005
  assert.equal(app.round2(0), 0);
  // A flat (additive, pre-scale) epsilon nudge is too small to survive once n
  // has 6+ significant digits — these regression-test the fix that made the
  // nudge scale with n itself instead.
  assert.equal(app.round2(35.855), 35.86);
  assert.equal(app.round2(1234567.005), 1234567.01);
});

test('fmt — display formatting', () => {
  assert.equal(app.fmt(1234.5), '1,234.50');       // thousands separator + 2dp
  assert.equal(app.fmt(0), '0.00');
  assert.equal(app.fmt(-0), '0.00');               // -0 must never render as "-0.00"
  assert.equal(app.fmt(-0.004), '0.00');           // sub-cent negative collapses to 0
  assert.equal(app.fmt(NaN), '0.00');              // never leak NaN into the UI
  assert.equal(app.fmt(Infinity), '0.00');
  assert.equal(app.fmt(1000000), '1,000,000.00');
});

test('normalizeDigits — Arabic/Persian numerals to ASCII', () => {
  assert.equal(app.normalizeDigits('١٢٣'), '123');     // Arabic-Indic
  assert.equal(app.normalizeDigits('۴۵۶'), '456');     // Persian
  assert.equal(app.normalizeDigits('1٫5'), '1.5');     // Arabic decimal separator
  assert.equal(app.normalizeDigits('1٬234'), '1234');  // Arabic thousands separator
  assert.equal(app.normalizeDigits('1,234'), '1234');  // Latin thousands separator
});

test('parseAmount — robust money parsing rejects junk', () => {
  assert.equal(app.parseAmount('1234'), 1234);
  assert.equal(app.parseAmount('١٢٣٤'), 1234);          // Arabic digits
  assert.equal(app.parseAmount('12.50'), 12.5);
  assert.ok(Number.isNaN(app.parseAmount('1e9')));      // scientific notation blocked
  assert.ok(Number.isNaN(app.parseAmount('0x10')));     // hex blocked
  assert.ok(Number.isNaN(app.parseAmount('abc')));      // letters blocked
  assert.ok(Number.isNaN(app.parseAmount('1e15')));     // beyond the trillion ceiling
});

test('groupThousandsDisplay — live-typing display matches what parseAmount() would save', () => {
  // Normal cases: display grouping must round-trip through parseAmount() unchanged.
  assert.equal(app.groupThousandsDisplay('1000'), '1,000');
  assert.equal(app.groupThousandsDisplay('1000.5'), '1,000.5');
  assert.equal(app.groupThousandsDisplay('-1234.5'), '-1,234.5');
  assert.equal(app.groupThousandsDisplay('$1,234.56'), '1,234.56'); // currency symbol stripped
  assert.equal(app.groupThousandsDisplay('1,5'), '1.5'); // trailing comma+1 digit = decimal, matches normalizeDigits
  // A pasted space-thousands/comma-decimal number ("1 234,56" = 1234.56 in
  // European convention) used to have its comma treated as a bare thousands
  // separator and silently stripped, producing 123456 (100x too large) with
  // no error — now correctly recognized as a decimal comma.
  assert.equal(app.groupThousandsDisplay('1 234,56'), '1,234.56');
  assert.equal(app.parseAmount(app.groupThousandsDisplay('1 234,56')), 1234.56);
  // A pasted dot-thousands/comma-decimal number ("1.234,56") is genuinely
  // ambiguous once regrouped (the dot looks like it could be a real decimal
  // point too) — rather than guessing and silently producing a wrong value,
  // this must resolve to something parseAmount() itself rejects (NaN), so the
  // user gets a "enter a valid amount" error instead of a silently wrong save.
  const ambiguous = app.groupThousandsDisplay('1.234,56');
  assert.ok(Number.isNaN(app.parseAmount(ambiguous)), `expected NaN for ambiguous "${ambiguous}"`);
});

test('stripBidiControls — neutralises Trojan-Source style bidi chars', () => {
  assert.equal(app.stripBidiControls('a‮b'), 'ab'); // RLO override removed
  assert.equal(app.stripBidiControls('x‏y'), 'xy'); // RLM removed
  assert.equal(app.stripBidiControls('﻿hi'), 'hi');  // zero-width BOM removed
  assert.equal(app.stripBidiControls('normal'), 'normal');
});

test('escHtml — HTML escaping (+ bidi stripping)', () => {
  assert.equal(app.escHtml('<b>'), '&lt;b&gt;');
  assert.equal(app.escHtml('a & b'), 'a &amp; b');
  assert.equal(app.escHtml('"q"'), '&quot;q&quot;');
  assert.equal(app.escHtml("o'k"), 'o&#x27;k');
  assert.equal(app.escHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;');
});

test('arPlural — Arabic count grammar', () => {
  assert.equal(app.arPlural(1, 'معاملة', 'معاملتان', 'معاملات'), 'معاملة واحدة');
  assert.equal(app.arPlural(2, 'معاملة', 'معاملتان', 'معاملات'), 'معاملتان');
  assert.equal(app.arPlural(5, 'معاملة', 'معاملتان', 'معاملات'), '5 معاملات');
  assert.equal(app.arPlural(11, 'معاملة', 'معاملتان', 'معاملات'), '11 معاملة');
  assert.equal(app.arPlural(1, 'معاملة', 'معاملتان', 'معاملات', 'مخصّص'), 'مخصّص');
});

test('monthRange — month window boundaries incl. year rollover', () => {
  const [s0, e0] = app.monthRange(0);
  assert.ok(s0 < e0, 'start before end');
  const startD = new Date(s0), endD = new Date(e0);
  assert.equal(startD.getDate(), 1, 'window starts on the 1st');
  assert.equal(endD.getDate(), 1, 'window ends on the 1st of next month');

  // crossing the year boundary backwards must roll the YEAR back, not produce a
  // bogus month — this guards the negative-month Date normalisation behaviour.
  const now = new Date();
  const [s13] = app.monthRange(13);
  const d13 = new Date(s13);
  assert.equal(d13.getFullYear(), now.getFullYear() - (now.getMonth() >= 1 ? 1 : 2),
    'going 13 months back lands in the correct earlier year');
});

test('cache-invalidation registry — invalidateOnTxCommit/invalidateOnRender run every registered callback', () => {
  // app.ui.js already registers _allTxSortedCache/_monthlyExpenseCache's own
  // clears at parse time — this just confirms a NEW registrant (as a future
  // cache would add) gets invoked too, without touching any existing entries.
  let txCommitCalls = 0, renderCalls = 0;
  app.invalidateOnTxCommit(() => { txCommitCalls++; });
  app.invalidateOnRender(() => { renderCalls++; });

  app.runTxCommitInvalidators();
  assert.equal(txCommitCalls, 1, 'a tx-commit invalidator fires on runTxCommitInvalidators()');
  assert.equal(renderCalls, 0, 'a tx-commit invalidator must not fire on the render trigger');

  app.runRenderInvalidators();
  assert.equal(renderCalls, 1, 'a render invalidator fires on runRenderInvalidators()');
  assert.equal(txCommitCalls, 1, 'a render invalidator must not fire on the tx-commit trigger');

  app.runTxCommitInvalidators();
  app.runRenderInvalidators();
  assert.equal(txCommitCalls, 2, 'invalidators run again on every subsequent trigger, not just once');
  assert.equal(renderCalls, 2);
});
