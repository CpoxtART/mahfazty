/*
 * Release-version pairing — three hand-edited values must stay in lockstep
 * every release, and nothing but this test enforces it:
 *   1. sw.js's CACHE constant ('mhfzty-vX.Y')
 *   2. app.core.js's CHANGELOG[0].version ('vX.Y') — drives the boot-time SW
 *      drift check (app.pwa.js compares 'mhfzty-' + CHANGELOG[0].version
 *      against the live SW's GET_VERSION reply) and the unseen-changelog badge
 *   3. the ?v=X.Y query on every <script>/<link rel=stylesheet> asset URL in
 *      index.html and every versioned PRECACHE entry in sw.js — per-release
 *      cache keys are what make the 13-file set update ATOMICALLY (see the
 *      comment above PRECACHE in sw.js)
 * A release that bumps one but not the others either spams spurious drift
 * re-checks every boot (harmless but wasteful) or, worse, serves a mixed
 * old/new file set after a deploy — the v47.74 fatal-error class.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const coreSrc = fs.readFileSync(path.join(ROOT, 'app.core.js'), 'utf8');

const cacheMatch = swSrc.match(/const CACHE = 'mhfzty-v([\d.]+)'/);
const changelogMatch = coreSrc.match(/version:\s*'v([\d.]+)'/); // first occurrence = CHANGELOG[0]

test('sw.js CACHE version matches CHANGELOG[0].version', () => {
  assert.ok(cacheMatch, 'sw.js CACHE constant found');
  assert.ok(changelogMatch, 'CHANGELOG[0].version found');
  assert.strictEqual(cacheMatch[1], changelogMatch[1],
    `sw.js CACHE (v${cacheMatch[1]}) and app.core.js CHANGELOG[0] (v${changelogMatch[1]}) must be bumped together`);
});

test('every ?v= asset version in index.html matches the CACHE version', () => {
  const versions = [...htmlSrc.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]);
  assert.ok(versions.length >= 14, `expected >=14 versioned asset URLs in index.html, found ${versions.length}`);
  const distinct = [...new Set(versions)];
  assert.deepStrictEqual(distinct, [cacheMatch[1]],
    `index.html ?v= values ${JSON.stringify(distinct)} must all equal the sw.js CACHE version ${cacheMatch[1]}`);
});

test('index.html versions every script tag and the local stylesheet', () => {
  // any local <script src> or local stylesheet without ?v= would keep a STALE
  // fixed cache key and silently reintroduce the mixed old/new file-set risk
  const locals = [...htmlSrc.matchAll(/<script src="((?!https?:)[^"]+)"|<link rel="stylesheet" href="((?!https?:)[^"]+)"/g)]
    .map(m => m[1] || m[2]).filter(Boolean);
  const unversioned = locals.filter(u => !/\?v=[\d.]+$/.test(u));
  assert.deepStrictEqual(unversioned, [],
    `local script/stylesheet URLs missing ?v=: ${JSON.stringify(unversioned)}`);
});

test('sw.js PRECACHE versioned entries agree with index.html URLs', () => {
  // PRECACHE builds its versioned keys from ASSET_V = CACHE version — verify a
  // representative sample resolves to exactly the URLs index.html references,
  // so precache keys and page requests hit the same cache entries.
  const v = cacheMatch[1];
  ['app.core.js', 'app.logic.js', 'i18n.js'].forEach(f => {
    assert.ok(htmlSrc.includes(`${f}?v=${v}`), `index.html references ${f}?v=${v}`);
  });
  assert.ok(htmlSrc.includes(`style.css?v=${v}`), `index.html references style.css?v=${v}`);
  assert.ok(swSrc.includes("`./${f}?v=${ASSET_V}`"), 'PRECACHE derives script keys from ASSET_V');
  assert.ok(swSrc.includes("`./style.css?v=${ASSET_V}`"), 'PRECACHE derives style.css key from ASSET_V');
});
