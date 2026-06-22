// @ts-check
const { test, expect } = require('@playwright/test');

// Skip the first-run welcome modal so it never covers the elements under test.
async function gotoApp(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('walletTracker_welcomeSeen', '1'); } catch (e) {}
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.setLang === 'function');
}

test('boots in Arabic/RTL without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await gotoApp(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.hero .amount')).toBeVisible();
  expect(errors, 'no uncaught page errors on boot').toEqual([]);
  // guards the app.drive.js split: its declarations must be in scope across files
  expect(await page.evaluate(() => typeof driveSignIn)).toBe('function');
});

test('language switch flips direction and content to English/LTR', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.setLang('en'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  // a label that's Arabic-only by default must now read English
  await expect(page.locator('.hero .label')).toContainText(/available/i);
});

test('onboarding bullets (data-i18n-html) translate to English', async ({ page }) => {
  // Locks the v47.22 fix: the static translator used to match only [data-i18n]
  // and treat data-i18n-html as a boolean, so every onboarding bullet — whose
  // key lives in data-i18n-html="key" — silently stayed Arabic in English mode.
  await page.addInitScript(() => {
    // do NOT mark welcome as seen here — we need the onboarding markup present
    // (it's translated even while hidden, which is exactly what we're asserting).
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.setLang === 'function');

  await page.evaluate(() => window.setLang('en'));

  // A known English bullet must be present...
  await expect(page.locator('.onb-slide [data-i18n-html="onb.s7Li1"]'))
    .toContainText(/Two languages/i);

  // ...and NO onboarding bullet may still contain Arabic-script characters.
  const arabicLeftovers = await page.evaluate(() => {
    const arabic = /[؀-ۿ]/;
    return Array.from(document.querySelectorAll('.onb-slide [data-i18n-html]'))
      .filter((el) => arabic.test(el.textContent || ''))
      .map((el) => el.getAttribute('data-i18n-html'));
  });
  expect(arabicLeftovers, 'all onboarding bullets render English in EN mode').toEqual([]);

  // round-trips back to Arabic
  await page.evaluate(() => window.setLang('ar'));
  await expect(page.locator('.onb-slide [data-i18n-html="onb.s7Li1"]'))
    .toContainText(/لغتان/);
});

test('RTL/LTR layout fix: hero amount mirrors with the page direction', async ({ page }) => {
  await gotoApp(page);
  const align = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero .amount')).textAlign);

  await page.evaluate(() => window.setLang('ar'));
  expect(await align(), 'Arabic/RTL → right-aligned').toBe('right');

  await page.evaluate(() => window.setLang('en'));
  expect(await align(), 'English/LTR → left-aligned (the v47.18 fix)').toBe('left');
});

test('analytics & reports tabs render charts without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await gotoApp(page);

  // seed a little history so the charts/reports have something to draw
  await page.evaluate(() => {
    const now = Date.now();
    state.transactions = [
      { id: 't1', wallet: 'core', type: 'income', category: 'salary', amount: 1000, ts: now - 86400000 },
      { id: 't2', wallet: 'core', type: 'expense', category: 'food', amount: 120, ts: now - 3600000 },
      { id: 't3', wallet: 'core', type: 'expense', category: 'transport', amount: 40, ts: now - 1800000 },
    ];
    state.wallets.core = 840;
    if (typeof render === 'function') render();
  });

  await page.evaluate(() => window.switchTab('analytics'));
  await expect(page.locator('#pieCanvas')).toBeVisible();

  await page.evaluate(() => window.switchTab('reports'));
  await expect(page.locator('#chartCanvas')).toBeVisible();

  expect(errors, 'no errors while rendering analytics/reports').toEqual([]);
});

test('income distribution conserves money exactly (no rounding drift)', async ({ page }) => {
  await gotoApp(page);

  const result = await page.evaluate(async () => {
    // controlled scenario: 100.01 (odd cents) split across a few wallets so the
    // round2 + "last leg absorbs the residual" logic is actually exercised.
    state.wallets = { core: 100.01, growth: 0, joy: 0, giving: 0 };
    const ts = Date.now();
    const src = { id: 'tx_src', wallet: 'core', desc: 'income', amount: 100.01,
                  type: 'income', category: 'salary', ts };
    state.transactions = [src];
    DISTRIBUTION = [
      { id: 'growth', pct: 33 },
      { id: 'joy', pct: 33 },
      { id: 'giving', pct: 34 },
    ];
    await runDistribution(src, 100.01);

    const legsIn = state.transactions.filter(t => t.link && t.type === 'income' && t.category === 'transfer');
    const legOut = state.transactions.find(t => t.link && t.type === 'expense' && t.category === 'transfer');
    const sumIn = legsIn.reduce((s, t) => s + t.amount, 0);
    return { sumIn: Math.round(sumIn * 100) / 100, out: legOut ? legOut.amount : null, legCount: legsIn.length };
  });

  // every distributed riyal that left the source wallet must land in a target —
  // total in === total out, to the cent.
  expect(result.legCount).toBe(3);
  expect(result.sumIn).toBe(result.out);
  expect(result.out).toBe(100.01); // 33+33+34 = 100% of 100.01
});
