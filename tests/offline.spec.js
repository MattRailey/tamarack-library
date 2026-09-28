// Offline use: the service worker keeps every app file, so the library opens with no signal.
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const { APP, mockNet, openApp } = require('./helpers');
const DIR = process.env.APP_DIR || '.';

test.use({ serviceWorkers: 'allow' });

test('every file the page loads is in the service worker list', async () => {
  const html = fs.readFileSync(path.join(DIR, 'tamarack-library.html'), 'utf8');
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="((?:js\/|css\/|icons\/|manifest)[^"]+)"/g)].map(m => m[1]);
  expect(local.length).toBeGreaterThan(3);
  for (const f of local) expect(sw, f + ' missing from sw.js').toContain(`'${f}'`);
  for (const f of local) expect(fs.existsSync(path.join(DIR, f)), f + ' does not exist').toBeTruthy();
});

test('opens with no connection after one visit', async ({ page, context }) => {
  await mockNet(page); await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                                           // now controlled by the worker
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
  await expect(page.locator('#results [data-id]').first()).toBeVisible();
});
