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
