/*
 * Unit-test harness for the production source — WITHOUT a build step.
 *
 * The app ships as plain <script> files that assume a browser (document,
 * window, localStorage, …) and run a fair amount of init code on load. We
 * don't want to touch that source just to test it, so this harness loads the
 * real files into a Node `vm` sandbox seeded with universal no-op browser
 * stubs (a Proxy that absorbs any DOM/storage call without throwing). The init
 * storm runs harmlessly against the stubs, and the pure, dependency-free
 * helper functions (round2, fmt, parseAmount, escHtml, monthRange, …) are then
 * exposed for assertion exactly as they behave in the browser.
 *
 * Timers are no-op'd so the app's background intervals never register and the
 * test process exits cleanly.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Same order the browser loads them in (index.html) — top-level const/let are
// shared lexically only when run as ONE script, mirroring real <script> tags.
const FILES = ['i18n.js', 'app.core.js', 'app.ui.js', 'app.charts.js', 'app.drive.js', 'app.logic.js'];

const handler = {
  get(_t, prop) {
    // keep JS protocol checks sane so the loaded code doesn't misbehave
    if (prop === Symbol.toPrimitive) return () => 0;
    if (prop === Symbol.iterator) return undefined;     // not iterable
    if (prop === Symbol.toStringTag) return undefined;
    if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined; // not thenable
    if (prop === 'length') return 0;
    if (prop === 'nodeType') return 1;
    return makeProxy();
  },
  set() { return true; },
  apply() { return makeProxy(); },
  construct() { return makeProxy(); },
  has() { return true; },
  deleteProperty() { return true; },
};
function makeProxy() { return new Proxy(function () {}, handler); }

function loadApp() {
  const noop = () => 0;
  const ctx = {
    window: makeProxy(), document: makeProxy(), navigator: makeProxy(),
    localStorage: makeProxy(), sessionStorage: makeProxy(), indexedDB: makeProxy(),
    location: makeProxy(), matchMedia: () => makeProxy(),
    console, Date, Math, JSON, Intl, Promise, Array, Object, String, Number,
    Boolean, RegExp, Map, Set, Symbol, Error, isFinite, isNaN, parseFloat, parseInt,
    URL, Blob: makeProxy(),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    // no-op timers: the app's intervals/timeouts must not keep the test alive
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
  };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);

  let src = FILES
    .map((f) => `\n//==== ${f} ====\n` + fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
  // Capture the pure helpers (they're function-declared, so lexically in scope
  // here) onto the context so the test file can reach them.
  src += `
    globalThis.__exports = {
      // pure helpers
      round2, fmt, arPlural, normalizeDigits, parseAmount,
      escHtml, stripBidiControls, monthRange,
      // import/data-integrity sanitizers (arg-based, pure)
      sanitizeDistribution, sanitizeBudgets, sanitizeWalletDefs,
      sanitizeOrder, sanitizeTrackLinkMode, buildTxTs, parseArabicNumber,
      // state-dependent money/derivation functions, plus a live state ref and the
      // default WALLET_DEFS so tests can stage a scenario then assert.
      reconcileBalances, sumExpenses,
      state, WALLET_DEFS,
    };`;

  // The app's top-level loadState() may reject against the stubs — that's
  // expected and irrelevant to these pure-function tests; swallow it.
  const onRej = () => {};
  process.on('unhandledRejection', onRej);
  try {
    vm.runInContext(src, ctx, { filename: 'mahfazty-bundle.js' });
  } finally {
    process.removeListener('unhandledRejection', onRej);
  }
  return ctx.__exports;
}

module.exports = { loadApp };
