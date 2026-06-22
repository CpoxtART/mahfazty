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

test('RTL/LTR layout fix: hero amount mirrors with the page direction', async ({ page }) => {
  await gotoApp(page);
  const align = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero .amount')).textAlign);

  await page.evaluate(() => window.setLang('ar'));
  expect(await align(), 'Arabic/RTL → right-aligned').toBe('right');

  await page.evaluate(() => window.setLang('en'));
  expect(await align(), 'English/LTR → left-aligned (the v47.18 fix)').toBe('left');
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
