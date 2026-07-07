/*
 * Migration + multi-device merge coverage — the logic that decides whose money
 * data survives a sync conflict and how default wallets migrate across
 * versions. These paths had zero automated coverage when two real bugs shipped
 * in them (v47.75's Reserve resurrection-on-delete; the longstanding tracked-
 * balance divergence fixed in v47.76) — each test below pins the exact
 * behavior those fixes established.
 *
 * All tests share one sandbox instance (loadApp is expensive), so each test
 * restores the state it touches. Tests run sequentially under node --test.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./sandbox');

const app = loadApp();

// Stage WALLET_DEFS/DISTRIBUTION/tombstones to a known scenario. applyWalletDefs
// mutates WALLET_DEFS in place, so staging through it mirrors production flow.
function stage({ defs, dist, wdTombs, txTombs, wallets, txs }) {
  app.setDeletedWalletDefIds(wdTombs || {});
  app.setDeletedTxIds(txTombs || {});
  app.applyWalletDefs(defs.map(d => ({ ...d })));
  app.setDistribution((dist || []).map(d => ({ ...d })));
  Object.keys(app.state.wallets).forEach(k => delete app.state.wallets[k]);
  app.WALLET_DEFS.forEach(w => { app.state.wallets[w.id] = 0; });
  Object.assign(app.state.wallets, wallets || {});
  app.setTransactions((txs || []).map(t => ({ ...t })));
}

const FACTORY_DEFS = [
  { id: 'core', name: 'Core Expenses', initial: 0, track: false, pct: '50%' },
  { id: 'wishlist', name: 'Wishlist', initial: 0, track: false, pct: '10%' },
  { id: 'giving', name: 'Giving', initial: 0, track: false, pct: '5%' },
  { id: 'uber', name: 'Uber', initial: 0, track: true, pct: 'track' },
];

test('applyWalletDefs — re-inserts missing reserve + crisis_fund defaults (migration)', () => {
  stage({ defs: FACTORY_DEFS, dist: [] });
  assert.ok(app.WALLET_DEFS.find(w => w.id === 'reserve'), 'reserve inserted');
  assert.ok(app.WALLET_DEFS.find(w => w.id === 'crisis_fund'), 'crisis_fund inserted');
  // reserve sits right after giving, before crisis_fund/track wallets
  const ids = app.WALLET_DEFS.map(w => w.id);
  assert.ok(ids.indexOf('reserve') > ids.indexOf('giving'), 'reserve after giving');
  assert.ok(ids.indexOf('reserve') < ids.indexOf('uber'), 'reserve before track wallets');
});

test('applyWalletDefs — does NOT resurrect a tombstoned default (delete stays deleted)', () => {
  stage({ defs: FACTORY_DEFS, dist: [], wdTombs: { reserve: Date.now(), crisis_fund: Date.now() } });
  assert.ok(!app.WALLET_DEFS.find(w => w.id === 'reserve'), 'tombstoned reserve NOT re-added');
  assert.ok(!app.WALLET_DEFS.find(w => w.id === 'crisis_fund'), 'tombstoned crisis_fund NOT re-added');
});

test('applyWalletDefs — deleteWalletDef flow: filter + tombstone in same call removes for good', () => {
  stage({ defs: FACTORY_DEFS, dist: [] });
  assert.ok(app.WALLET_DEFS.find(w => w.id === 'reserve'));
  // exactly what deleteWalletDef does: tombstone first, then applyWalletDefs(filtered)
  app.getDeletedWalletDefIds()['reserve'] = Date.now();
  app.applyWalletDefs(app.WALLET_DEFS.filter(w => w.id !== 'reserve'));
  assert.ok(!app.WALLET_DEFS.find(w => w.id === 'reserve'), 'the deletion is not self-defeating');
});

test('_ensureReserveShare — grants 5% and takes it from a default-shaped core (55→50)', () => {
  stage({
    defs: FACTORY_DEFS,
    dist: [{ id: 'core', pct: 55 }, { id: 'wishlist', pct: 10 }, { id: 'giving', pct: 5 }],
  });
  app._ensureReserveShare();
  const dist = app.getDistribution();
  assert.strictEqual(dist.find(d => d.id === 'reserve').pct, 5, 'reserve granted 5%');
  assert.strictEqual(dist.find(d => d.id === 'core').pct, 50, 'core shaved back to 50');
});

test('_ensureReserveShare — leaves a customized core alone (adds 5% without shaving)', () => {
  stage({
    defs: FACTORY_DEFS,
    dist: [{ id: 'core', pct: 70 }, { id: 'wishlist', pct: 20 }],
  });
  app._ensureReserveShare();
  const dist = app.getDistribution();
  assert.strictEqual(dist.find(d => d.id === 'reserve').pct, 5);
  assert.strictEqual(dist.find(d => d.id === 'core').pct, 70, 'custom core untouched');
});

test('_ensureReserveShare — repairs the orphaned (core:55, reserve:0) signature', () => {
  stage({
    defs: FACTORY_DEFS,
    dist: [{ id: 'core', pct: 55 }, { id: 'reserve', pct: 0 }, { id: 'giving', pct: 5 }],
  });
  app._ensureReserveShare();
  const dist = app.getDistribution();
  assert.strictEqual(dist.find(d => d.id === 'reserve').pct, 5, 'orphaned 0% repaired');
  assert.strictEqual(dist.find(d => d.id === 'core').pct, 50);
});

test('_ensureReserveShare — respects a deliberate post-v47.75 zero (core already 50)', () => {
  stage({
    defs: FACTORY_DEFS,
    dist: [{ id: 'core', pct: 50 }, { id: 'reserve', pct: 0 }],
  });
  app._ensureReserveShare();
  const dist = app.getDistribution();
  assert.strictEqual(dist.find(d => d.id === 'reserve').pct, 0, 'user choice preserved');
  assert.strictEqual(dist.find(d => d.id === 'core').pct, 50);
});

test('_ensureReserveShare — idempotent across repeated calls (no double-add/double-shave)', () => {
  stage({
    defs: FACTORY_DEFS,
    dist: [{ id: 'core', pct: 55 }, { id: 'wishlist', pct: 10 }],
  });
  app._ensureReserveShare();
  app._ensureReserveShare();
  app._ensureReserveShare();
  const dist = app.getDistribution();
  assert.strictEqual(dist.filter(d => d.id === 'reserve').length, 1, 'exactly one entry');
  assert.strictEqual(dist.find(d => d.id === 'core').pct, 50, 'core shaved exactly once');
});

// ── mergeCloudData ─────────────────────────────────────────────────────────

const TX = (id, over) => ({
  id, type: 'expense', wallet: 'core', amount: 10, ts: 1700000000000,
  category: 'other', desc: id, ...over,
});

test('mergeCloudData — union adds cloud-only txs and honors tombstones from both sides', () => {
  // tombstone stamps must be recent — mergeCloudData prunes tombstones older
  // than the 90-day TTL, which is itself behavior worth not accidentally hiding
  const now = Date.now();
  stage({
    defs: FACTORY_DEFS,
    dist: [],
    txTombs: { tx_localdel: now },
    txs: [TX('tx_a'), TX('tx_localdel')],
  });
  const res = app.mergeCloudData({
    transactions: [TX('tx_a'), TX('tx_b'), TX('tx_clouddel')],
    deletedTxIds: { tx_clouddel: now },
  }, false);
  // spread into a test-realm array — deepStrictEqual compares prototypes, and
  // the sandbox's Array constructor is a different realm's (see data.test.js)
  const ids = [...app.getTransactions().map(t => t.id)].sort();
  assert.deepStrictEqual(ids, ['tx_a', 'tx_b'], 'union minus both tombstone sides');
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.removed, 1);
});

test('mergeCloudData — clamps an overlong cloud-only desc, same as applyImport/adoptCloudSnapshot', () => {
  // isValidTx checks well-formedness, not length — unlike the other two
  // wholesale-adoption entry points, this incremental-sync path used to let
  // an oversized/tampered desc field ride into state.transactions unclamped.
  stage({ defs: FACTORY_DEFS, dist: [] });
  const longDesc = 'x'.repeat(500);
  app.mergeCloudData({ transactions: [TX('tx_long', { desc: longDesc })] }, false);
  const tx = app.getTransactions().find(t => t.id === 'tx_long');
  assert.ok(tx.desc.length <= 120, 'desc clamped to the same 120-codepoint cap as the other adoption paths');
});

test('mergeCloudData — newer editedAt wins, local link survives a stale-copy overwrite', () => {
  // the link needs a live partner in the ledger — stripOrphanLinks (correctly)
  // clears a link no other transaction shares
  stage({
    defs: FACTORY_DEFS, dist: [],
    txs: [
      TX('tx_e', { amount: 10, editedAt: 100, link: 'grp1' }),
      TX('tx_partner', { type: 'income', amount: 10, wallet: 'wishlist', link: 'grp1', category: 'transfer' }),
    ],
  });
  app.mergeCloudData({
    transactions: [TX('tx_e', { amount: 25, editedAt: 200 })], // newer, but lost the link
  }, false);
  const tx = app.getTransactions().find(t => t.id === 'tx_e');
  assert.strictEqual(tx.amount, 25, 'newer cloud copy won');
  assert.strictEqual(tx.link, 'grp1', 'local link preserved');
});

test('mergeCloudData — tracked-wallet balance converges when another device\'s adjustment merges in', () => {
  // Device B: uber shows 500. Device A set it to 450 via an adjustment income
  // of -50... modeled as the app does: an expense ON the track wallet.
  stage({
    defs: FACTORY_DEFS, dist: [],
    wallets: { uber: 500 },
    txs: [],
  });
  app.mergeCloudData({
    transactions: [TX('tx_adj', { wallet: 'uber', type: 'expense', amount: 50, category: 'adjustment' })],
  }, false);
  assert.strictEqual(app.state.wallets.uber, 450, 'displayed track balance moved with the merged adjustment');
});

test('mergeCloudData — tracked-wallet balance reverses when a remote deletion removes an adjustment', () => {
  stage({
    defs: FACTORY_DEFS, dist: [],
    wallets: { uber: 450 },
    txs: [TX('tx_adj2', { wallet: 'uber', type: 'expense', amount: 50, category: 'adjustment' })],
  });
  app.mergeCloudData({
    transactions: [],
    deletedTxIds: { tx_adj2: Date.now() },
  }, false);
  assert.strictEqual(app.state.wallets.uber, 500, 'track effect reversed on propagated delete');
});

test('mergeCloudData — track-LINKED expense (trackWallet/trackSign) moves the linked counter', () => {
  // expense on core linked to uber as a spending counter (credit: expense raises it)
  stage({
    defs: FACTORY_DEFS, dist: [],
    wallets: { core: 100, uber: 0 },
    txs: [],
  });
  app.mergeCloudData({
    transactions: [TX('tx_link', { wallet: 'core', amount: 30, trackWallet: 'uber', trackSign: +1 })],
  }, false);
  assert.strictEqual(app.state.wallets.uber, 30, 'linked counter moved');
  // core is ledger-derived: reconcileBalances rebuilt it from the merged ledger
  assert.strictEqual(app.state.wallets.core, -30, 'regular wallet rebuilt from ledger (0 - 30)');
});

test('mergeCloudData — regular wallets always reconcile from the merged ledger', () => {
  stage({
    defs: FACTORY_DEFS, dist: [],
    wallets: { core: 999 }, // stale/corrupt stored balance
    txs: [TX('tx_i', { type: 'income', amount: 100 })],
  });
  app.mergeCloudData({ transactions: [TX('tx_x', { type: 'expense', amount: 40 })] }, false);
  assert.strictEqual(app.state.wallets.core, 60, 'balance = 0 + Σledger, stale value healed');
});

test('mergeCloudData — budgets: non-overlapping per-wallet caps from both devices both survive', () => {
  // Device A (this one) capped 'core'; device B capped 'wishlist' independently
  // and happens to be the "newer" side overall — neither device ever touched
  // the OTHER wallet's cap, so both must survive a sync, not just one.
  stage({ defs: FACTORY_DEFS, dist: [] });
  app.setBudgets({ core: 500 });
  app.mergeCloudData({ transactions: [], budgets: { wishlist: 200 } }, true); // cloudNewer=true
  // spread into a test-realm object — deepStrictEqual compares prototypes, and
  // the sandbox's Object constructor is a different realm's (see the matching
  // note on the tx-id array comparison above)
  assert.deepStrictEqual({...app.getBudgets()}, { core: 500, wishlist: 200 },
    'local-only cap (core) and cloud-only cap (wishlist) both preserved');
});

test('mergeCloudData — budgets: a genuine same-wallet collision falls back to cloudNewer', () => {
  stage({ defs: FACTORY_DEFS, dist: [] });
  app.setBudgets({ core: 500 });
  app.mergeCloudData({ transactions: [], budgets: { core: 300 } }, true); // cloud is newer AND collides on 'core'
  assert.strictEqual(app.getBudgets().core, 300, 'cloudNewer wins the true collision, same as before');
});

test('isValidTx — shared rule rejects malformed txs at every boundary', () => {
  stage({ defs: FACTORY_DEFS, dist: [] });
  assert.ok(app.isValidTx(TX('tx_ok')));
  assert.ok(!app.isValidTx(TX('tx_bad1', { amount: -5 })), 'negative amount');
  assert.ok(!app.isValidTx(TX('tx_bad2', { wallet: 'nope' })), 'unknown wallet');
  assert.ok(!app.isValidTx({ ...TX('x'), id: 12345 }), 'non-string id');
  assert.ok(!app.isValidTx(TX('tx_bad3', { type: 'transfer' })), 'invalid type');
  assert.ok(!app.isValidTx(TX('tx_bad4', { ts: Infinity })), 'non-finite ts');
});

// ── shared snapshot-ingestion helpers (applyImport + adoptCloudSnapshot) ───

test('_ingestWalletDefs — replaces WALLET_DEFS and unions wallet-def tombstones', () => {
  stage({ defs: FACTORY_DEFS, dist: [] });
  app._ingestWalletDefs({
    walletDefs: [{ id: 'core', name: 'Core Expenses', initial: 0, track: false, pct: '100%' }],
    deletedWalletDefIds: { wishlist: Date.now() },
  });
  assert.deepStrictEqual([...app.WALLET_DEFS.map(w => w.id)].sort(), ['core', 'crisis_fund', 'reserve'].sort(),
    'wallet defs replaced (reserve/crisis_fund auto-restored by applyWalletDefs)');
  assert.ok(app.getDeletedWalletDefIds().wishlist, 'incoming tombstone unioned in');
});

test('_ingestWalletDefs — a snapshot with no walletDefs array is a no-op', () => {
  stage({ defs: FACTORY_DEFS, dist: [] });
  const before = [...app.WALLET_DEFS.map(w => w.id)];
  app._ingestWalletDefs({});
  assert.deepStrictEqual([...app.WALLET_DEFS.map(w => w.id)], before);
});

test('_ingestWalletBalances — restores balances for every known wallet, zeroing omitted ones', () => {
  stage({ defs: FACTORY_DEFS, dist: [], wallets: { core: 999, wishlist: 999 } });
  app._ingestWalletBalances({ wallets: { core: 50 } }); // wishlist omitted from the snapshot
  assert.strictEqual(app.state.wallets.core, 50);
  assert.strictEqual(app.state.wallets.wishlist, 0, 'omitted wallet zeroed, not left stale');
});

test('_ingestWalletBalances — rejects a crafted array `wallets` instead of silently zeroing everything', () => {
  // this is the exact gap adoptCloudSnapshot had before the v47.79 consolidation:
  // a bare truthy check let an array-shaped `wallets` pass, then every lookup
  // returned undefined and silently zeroed all balances with no restore/warning
  stage({ defs: FACTORY_DEFS, dist: [], wallets: { core: 42 } });
  app._ingestWalletBalances({ wallets: ['not', 'an', 'object'] });
  assert.strictEqual(app.state.wallets.core, 42, 'malformed wallets value left balances untouched');
});

test('_ingestWalletBalances — rejects NaN/Infinity values from a corrupt snapshot', () => {
  stage({ defs: FACTORY_DEFS, dist: [], wallets: { core: 42 } });
  app._ingestWalletBalances({ wallets: { core: 'not-a-number', wishlist: Infinity } });
  assert.strictEqual(app.state.wallets.core, 0, 'invalid value rejected, wallet zeroed not corrupted');
  assert.strictEqual(app.state.wallets.wishlist, 0);
});

test('_ingestWalletBalances — rejects a value beyond MAX_AMOUNT from a corrupt/tampered snapshot', () => {
  // isFinite alone (the pre-v48.10 check) passes anything up to ~1.8e308 — every
  // sibling numeric-ingestion path (isValidTx, sanitizeBudgets, parseAmount)
  // caps to MAX_AMOUNT, this one didn't. An unbounded balance surviving here
  // can later overflow to Infinity in a sum, which JSON.stringify serializes
  // as null, silently dropping the balance on the next load.
  stage({ defs: FACTORY_DEFS, dist: [], wallets: { core: 42 } });
  app._ingestWalletBalances({ wallets: { core: 1e250 } });
  assert.strictEqual(app.state.wallets.core, 0, 'out-of-range value rejected, wallet zeroed not corrupted');
});
