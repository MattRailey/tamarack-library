// The app loads with no script errors, on an empty device and with a library.
const { test, expect } = require('@playwright/test');
const { APP, mockNet, openApp } = require('./helpers');

for (const store of [null, undefined]) {
  test(`starts cleanly ${store === null ? 'on a new device' : 'with a library'}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Service Worker/.test(m.text())) errors.push(m.text()); });
    await mockNet(page);
    if (store === null) { await page.goto(APP); await page.waitForTimeout(1500); }
    else await openApp(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
}
