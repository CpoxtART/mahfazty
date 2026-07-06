/*
 * Every Intl.DateTimeFormat/toLocaleDateString call keyed on _dateLocale()
 * must pin calendar:'gregory' explicitly. Without it, a device whose OS-level
 * calendar preference is set to Hijri/Umm-al-Qura can make these calls
 * silently render Hijri month/day names, even though every date computation
 * elsewhere in the app (todayISO, monthRange, subscription billing-day
 * matching) is Gregorian/epoch-based — producing a displayed date that
 * doesn't match what was actually computed. Round-12 fix.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = ['app.ui.js', 'app.engage.js'];

test('every _dateLocale()-keyed date formatter pins calendar:\'gregory\'', () => {
  files.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // Match each `new Intl.DateTimeFormat(_dateLocale(), {...})` or
    // `.toLocaleDateString(_dateLocale(), {...})` call's options object.
    const calls = [...src.matchAll(/(?:new Intl\.DateTimeFormat|\.toLocaleDateString)\(_dateLocale\(\),\s*(\{[^}]*\})/g)];
    assert.ok(calls.length > 0, `${f}: expected at least one _dateLocale()-keyed date formatter`);
    calls.forEach((m, i) => {
      assert.match(m[1], /calendar:\s*'gregory'/,
        `${f}: _dateLocale() date formatter #${i+1} missing calendar:'gregory' — options was: ${m[1]}`);
    });
  });
});
