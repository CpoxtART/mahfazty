# Tests

The app itself has **no build step** — it ships as the plain static files in the
repo root. This folder only holds the test suite and never affects what's served.

## Unit tests (fast, no dependencies)

Pure financial/format/parse helpers (`round2`, `fmt`, `parseAmount`, `escHtml`,
`monthRange`, …) tested directly. They run via Node's built-in test runner; no
`npm install` required.

```bash
node --test "tests/*.test.js"     # or: npm run test:unit
```

`sandbox.js` loads the real production source into a Node `vm` with no-op browser
stubs, so the functions are tested exactly as they behave in the browser —
**without modifying the source**.

### Coverage

```bash
node tests/coverage.js            # or: npm run coverage (also gates on a 30% floor)
```

`node --test --experimental-test-coverage` can't report on the app.*.js files —
they run inside `sandbox.js`'s `vm` context under one synthetic filename
(`mahfazty-bundle.js`), not as real on-disk modules the built-in reporter can
map results back to. `tests/coverage.js` reconstructs a real per-file line
coverage % from raw V8 coverage data instead (see the file's header comment for
how). **This only measures the unit-test path above** — it can't see what the
Playwright e2e suite below covers, since that drives a separate browser
process. Expect the number to look low in isolation; it's a regression guard
for the fast unit-test path, not a claim about the app's overall test coverage.

## End-to-end tests (Playwright)

Real-browser flows: boot, language/RTL↔LTR switching, the hero-amount alignment
fix, and the income-distribution money-conservation invariant.

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

A local `python3 -m http.server` is started automatically (see
`playwright.config.js`).

CI runs both on every push — see `.github/workflows/ci.yml`.
