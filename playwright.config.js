// Tests: npm test                    (serves this folder on http://localhost:4173)
//        APP_DIR=../old npm test     (run the same tests against another copy of the app)
const { defineConfig } = require('@playwright/test');
const dir = process.env.APP_DIR || '.';
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',   // tests/*.test.mjs run with node --test
  timeout: 45_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],   // on GitHub, failures show up as annotations
  // PW_CHANNEL=chrome npm test runs on the installed Chrome (no Playwright browser download needed)
  use: { baseURL: 'http://localhost:4173', viewport: { width: 400, height: 860 }, serviceWorkers: 'block', ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
  webServer: { command: `python3 -m http.server 4173 --directory "${dir}"`, port: 4173, reuseExistingServer: !process.env.CI, stdout: 'ignore', stderr: 'ignore' },
});
