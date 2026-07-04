/*
 * Pie-chart compute (_computePieData) — mainly the largest-remainder
 * percentage-rounding algorithm, a classic off-by-one breeding ground that was
 * previously untestable because it was fused to canvas/DOM calls inside
 * renderPieChart. Extracted in v47.78 specifically so this could be tested
 * directly in the Node sandbox.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./sandbox');

const app = loadApp();

const TX = (id, cat, amount, over) => ({
  id, type: 'expense', wallet: 'core', amount, ts: Date.now(),
  category: cat, desc: id, ...over,
});

function stage(txs, { filter, wallet } = {}){
  app.setTransactions(txs);
  app.setCurrentFilter(filter || 'all');
  app.setWalletFilter(wallet ?? null);
}

test('_computePieData — percentages always sum to exactly 100 (largest-remainder rounding)', () => {
  // 1/3, 1/3, 1/3 of the total — naive toFixed(0) rounding gives 33/33/33 = 99
  stage([TX('a','food',100), TX('b','transport',100), TX('c','shopping',100)]);
  const data = app._computePieData();
  const sum = Object.values(data.pctMap).reduce((s,p)=>s+p,0);
  assert.strictEqual(sum, 100, `pctMap values ${JSON.stringify(data.pctMap)} must sum to 100`);
  // exactly one of the three categories absorbs the extra 1% (largest fractional remainder)
  assert.deepStrictEqual([...new Set(Object.values(data.pctMap))].sort(), [33, 34]);
});

test('_computePieData — an uneven split still sums to exactly 100', () => {
  stage([TX('a','food',7), TX('b','transport',13), TX('c','shopping',5), TX('d','bills',1)]);
  const data = app._computePieData();
  const sum = Object.values(data.pctMap).reduce((s,p)=>s+p,0);
  assert.strictEqual(sum, 100);
});

test('_computePieData — single category is trivially 100%', () => {
  stage([TX('a','food',50)]);
  const data = app._computePieData();
  assert.strictEqual(data.pctMap.food, 100);
  assert.strictEqual(data.total, 50);
});

test('_computePieData — excludes transfers and adjustments (isSystemCategory)', () => {
  stage([
    TX('a','food',100),
    TX('b','transfer',9999),
    TX('c','adjustment',9999),
  ]);
  const data = app._computePieData();
  assert.strictEqual(data.total, 100, 'system-category amounts must not inflate the total');
  assert.deepStrictEqual(Object.keys(data.pctMap), ['food']);
});

test('_computePieData — income transactions are excluded (pie is expenses only)', () => {
  stage([TX('a','food',100), { ...TX('b','salary',500), type:'income' }]);
  const data = app._computePieData();
  assert.strictEqual(data.total, 100);
});

test('_computePieData — all-zero-amount set does not produce NaN (total=0 guard)', () => {
  // amount must be >0 to be a valid tx elsewhere, but _computePieData itself
  // just sums whatever it's given — guard against a total of exactly 0
  stage([]);
  const data = app._computePieData();
  assert.strictEqual(data.total, 0);
  assert.strictEqual(data.filteredLen, 0);
  assert.deepStrictEqual([...data.entries], []);
});

test('_computePieData — respects an active walletFilter', () => {
  stage([TX('a','food',100,{wallet:'core'}), TX('b','food',50,{wallet:'wishlist'})], { wallet: 'core' });
  const data = app._computePieData();
  assert.strictEqual(data.total, 100);
});

test('_computePieData — prevTotals only computed when filter is "month"', () => {
  stage([TX('a','food',100)], { filter: 'all' });
  assert.strictEqual(app._computePieData().prevTotals, null, 'no last-month comparison outside month view');
  stage([TX('a','food',100)], { filter: 'month' });
  assert.notStrictEqual(app._computePieData().prevTotals, null, 'month view computes prevTotals');
});
