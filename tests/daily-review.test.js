/*
 * Daily-review subscription reminders — round 19's catch-up fix. The
 * "due today" check only ever matched an exact calendar-day equality, so a
 * billing day that fell on a day the user simply didn't open the app was
 * never surfaced, ever, for that cycle. buildDailyReviewContent(lastSeen) now
 * also scans the gap between the last time this ran and today.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./sandbox');

const app = loadApp();

function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

test('buildDailyReviewContent — surfaces a subscription due on a day within the gap since lastSeen (catch-up)', () => {
  const today = new Date();
  const missedDay = new Date(today); missedDay.setDate(today.getDate() - 1); // yesterday, inside the gap
  const lastSeen = new Date(today); lastSeen.setDate(today.getDate() - 3); // 3 days ago

  app.setSubscriptions([
    { id: 'sub_missed', name: 'Test Missed Sub', amount: 42, billingDay: missedDay.getDate(), active: true },
  ]);

  const html = app.buildDailyReviewContent(isoOf(lastSeen));
  assert.match(html, /استُحقت خلال غيابك/, 'catch-up line present');
  assert.match(html, /Test Missed Sub/, 'the missed subscription is named');
});

test('buildDailyReviewContent — normal daily use (lastSeen = yesterday) shows no catch-up line', () => {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  // a subscription due exactly today should still only hit the "due today"
  // path, not the catch-up path (no day strictly between yesterday and today)
  app.setSubscriptions([
    { id: 'sub_today', name: 'Today Sub', amount: 10, billingDay: today.getDate(), active: true },
  ]);

  const html = app.buildDailyReviewContent(isoOf(yesterday));
  assert.doesNotMatch(html, /استُحقت خلال غيابك/, 'no catch-up line for the normal one-day-gap case');
  assert.match(html, /تُحسم اليوم/, 'the "due today" line still fires normally');
});

test('buildDailyReviewContent — lastSeen null (first-ever review) skips the catch-up scan entirely', () => {
  const today = new Date();
  const missedDay = new Date(today); missedDay.setDate(today.getDate() - 1);
  app.setSubscriptions([
    { id: 'sub_missed2', name: 'Should Not Appear', amount: 5, billingDay: missedDay.getDate(), active: true },
  ]);
  const html = app.buildDailyReviewContent(null);
  // no other lines fire either (no history staged) — buildDailyReviewContent's
  // own "nothing worth showing" rule returns null outright, which itself
  // proves the catch-up scan didn't add a line.
  assert.strictEqual(html, null, 'no catch-up scan without a real lastSeen date');
});

test('buildDailyReviewContent — an inactive subscription is excluded from the catch-up scan', () => {
  const today = new Date();
  const missedDay = new Date(today); missedDay.setDate(today.getDate() - 1);
  const lastSeen = new Date(today); lastSeen.setDate(today.getDate() - 3);

  app.setSubscriptions([
    { id: 'sub_inactive', name: 'Inactive Sub', amount: 20, billingDay: missedDay.getDate(), active: false },
  ]);

  const html = app.buildDailyReviewContent(isoOf(lastSeen));
  assert.strictEqual(html, null, 'inactive subscription never surfaces, and nothing else fires either');
});
