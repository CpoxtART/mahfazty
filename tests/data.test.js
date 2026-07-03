/*
 * Data-integrity tests: the import/sanitization layer (the gate every untrusted
 * backup/cloud blob passes through) and the balance-reconciliation math. A bug
 * here can silently corrupt a user's money or brick a screen, so these get the
 * same direct coverage as the core arithmetic. Run with: node --test "tests/*.test.js"
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./sandbox.js');

const app = loadApp();

test('sanitizeWalletDefs — rejects unusable blobs, cleans valid ones', () => {
  assert.equal(app.sanitizeWalletDefs(null), null);
  assert.equal(app.sanitizeWalletDefs([]), null);
  // a blob with ONLY track wallets would brick every spendable-wallet picker
  assert.equal(app.sanitizeWalletDefs([{ id: 'cash', name: 'Cash', track: true }]), null);

  const clean = app.sanitizeWalletDefs([
    { id: 'core', name: 'Core', track: false },
    { id: 'core', name: 'Dup', track: false }, // duplicate id dropped
    { id: '', name: 'NoId' },                   // missing id dropped
    { id: 'x', name: 'a‮b' },                   // bidi control stripped from name
  ]);
  assert.equal(clean.length, 2);
  assert.equal(clean[0].id, 'core');
  assert.equal(clean[0].initial, 0);             // always reset to 0 per the app model
  assert.equal(clean[1].name, 'ab');             // RLO override removed
});

test('sanitizeDistribution — clamps pct, drops track/unknown, falls back', () => {
  const ok = app.sanitizeDistribution([{ id: 'growth', pct: 150 }]);
  assert.equal(ok[0].pct, 100);                  // clamped to 100
  const neg = app.sanitizeDistribution([{ id: 'growth', pct: -20 }]);
  assert.equal(neg[0].pct, 0);                   // clamped to 0
  // only track/unknown ids → nothing valid → defaults
  assert.ok(app.sanitizeDistribution([{ id: 'cash', pct: 50 }]).length > 1);
  assert.ok(app.sanitizeDistribution('not-an-array').length > 1);
});

test('sanitizeBudgets — keeps only positive budgets for known wallets', () => {
  const out = app.sanitizeBudgets({ core: 100, growth: -5, growth2: 0, bogus: 50 });
  assert.equal(out.core, 100);
  assert.equal('growth' in out, false);  // negative dropped
  assert.equal('bogus' in out, false);   // unknown wallet dropped
});

test('sanitizeOrder — keeps valid keys, appends missing, dedupes', () => {
  const def = ['a', 'b', 'c'];
  // spread into a host-realm array — values returned from the vm sandbox carry
  // the sandbox's Array.prototype, which deepStrictEqual treats as unequal.
  assert.deepEqual([...app.sanitizeOrder(['c', 'a'], def)], ['c', 'a', 'b']);
  // 'b' is present; 'a' (no earlier default neighbor present) inserts before the
  // nearest later present key ('b'); 'c' (whose earlier neighbor 'b' is now
  // present) inserts right after it — 'a','b','c'. This value was corrected
  // alongside a real bug in sanitizeOrder() itself: the old code used
  // `insertAt === valid.length` to mean "the backward loop found nothing", but a
  // legitimate backward-loop result can coincide numerically with valid.length,
  // wrongly re-running the forward loop and silently overwriting a correct
  // position (see app.layout.js).
  assert.deepEqual([...app.sanitizeOrder(['z', 'b', 'b'], def)], ['a', 'b', 'c']);
  assert.deepEqual([...app.sanitizeOrder(null, def)], ['a', 'b', 'c']);
});

test('sanitizeTrackLinkMode — only valid track ids with valid modes survive', () => {
  const out = app.sanitizeTrackLinkMode({ uber: 'debit', cards: 'bad', core: 'debit' });
  assert.equal(out.uber, 'debit');
  assert.equal('cards' in out, false); // invalid mode
  assert.equal('core' in out, false);  // not a track wallet
});

test('buildTxTs — never future-dates, honours the chosen day', () => {
  const ts = app.buildTxTs('2020-01-15');
  const d = new Date(ts);
  assert.equal(d.getFullYear(), 2020);
  assert.equal(d.getMonth(), 0);
  assert.ok(ts <= Date.now(), 'never in the future');
  // garbage falls back to "now", not NaN
  assert.ok(Number.isFinite(app.buildTxTs('not-a-date')));
});

test('parseArabicNumber — digits, Arabic numerals, separators, non-numbers', () => {
  assert.equal(app.parseArabicNumber('5000'), 5000);
  assert.equal(app.parseArabicNumber('٥٠٠٠'), 5000);   // Arabic-Indic digits
  assert.equal(app.parseArabicNumber('1,500'), 1500);  // thousands separator
  assert.equal(app.parseArabicNumber('كلام بدون رقم'), null);
});

test('reconcileBalances — recomputes balances from tx history, reports drift', () => {
  app.state.transactions = [
    { wallet: 'core', type: 'income', amount: 100, ts: 1 },
    { wallet: 'core', type: 'expense', amount: 30, ts: 2 },
    { wallet: 'growth', type: 'income', amount: 50, ts: 3 },
    { wallet: 'cash', type: 'income', amount: 999, ts: 4 }, // track wallet: ignored
  ];
  // seed a deliberately WRONG core balance, but a CORRECT growth balance, to
  // prove reconcile fixes (and reports) only the one that actually drifted.
  app.state.wallets = { core: 9999, growth: 50 };
  app.WALLET_DEFS.forEach(w => { if (app.state.wallets[w.id] === undefined) app.state.wallets[w.id] = 0; });

  const diff = app.reconcileBalances();

  assert.equal(app.state.wallets.core, 70);     // 100 - 30
  assert.equal(app.state.wallets.growth, 50);   // unchanged
  assert.equal(diff.core, 70 - 9999);           // drift reported for the wrong one
  assert.equal('growth' in diff, false);        // growth was already correct → not reported
});

test('sumExpenses — sums expenses in window, excludes transfers & by category', () => {
  app.state.transactions = [
    { wallet: 'core', type: 'expense', category: 'food', amount: 30, ts: 1000 },
    { wallet: 'core', type: 'expense', category: 'transport', amount: 20, ts: 1500 },
    { wallet: 'core', type: 'income', category: 'salary', amount: 500, ts: 1200 }, // not expense
    { wallet: 'core', type: 'expense', category: 'transfer', amount: 99, ts: 1100 }, // excluded
    { wallet: 'core', type: 'expense', category: 'food', amount: 7, ts: 9999 },     // out of window
  ];
  assert.equal(app.sumExpenses(0, 2000), 50);          // 30 + 20
  assert.equal(app.sumExpenses(0, 2000, 'food'), 30);  // category filter
});
