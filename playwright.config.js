// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/*
 * The app is a set of static files — Playwright just needs them served over
 * HTTP. We start Python's built-in static server (present on CI runners and
 * locally) on port 8080 and point the tests at it. Mobile viewport because the
 * app is a phone-first PWA.
 */
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://127.0.0.1:8080/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
