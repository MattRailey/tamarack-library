// Library name, separate libraries on one device, set-up links, and the Epilogue appendix tabs.
const { test, expect } = require('@playwright/test');
const { FIXTURE, APP, mockNet, openApp, click, epilogue, summary } = require('./helpers');

test('library name and tagline are shown and saved into the catalog', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await epilogue(page, 'data');
  await page.fill('#cfg-title', 'Smith Family Books'); await page.fill('#cfg-tag', 'Upstairs and down');
  await click(page, '#cfg-save');
  await expect(page.locator('#lib-name')).toHaveText('Smith Family Books');
  await expect(page.locator('#lib-tag')).toHaveText('Upstairs and down');
  expect(await page.title()).toBe('Smith Family Books');
  await expect.poll(() => net.remote && net.remote.settings && net.remote.settings.library && net.remote.settings.library.title, { timeout: 10000 })
    .toBe('Smith Family Books');
});

test('a second library on the same device stays completely separate', async ({ page }) => {
  const net = await mockNet(page);
  await openApp(page, { dropbox: true });
  const railey = await summary(page);
  // open a set-up link for another household's library
  await page.goto(APP + '?folder=' + encodeURIComponent('/Smith Library') + '&appkey=abc123');
  await page.waitForFunction(() => /Showing|No books|empty/i.test(document.getElementById('summary').textContent) || document.getElementById('lib-name').textContent);
  await expect(page.locator('#lib-name')).toHaveText('Smith Library');
  expect(await summary(page)).not.toBe(railey);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('tamarack_library_folder');
  expect(await page.evaluate(() => localStorage.getItem('tamarack_library_folder'))).toBe('/Smith Library');
  // nothing it does touches the Railey folder
  const before = net.uploads.length;
  await page.waitForTimeout(2000);
  expect(net.uploads.slice(before).every(u => u.path.startsWith('/Smith Library/'))).toBeTruthy();
  // switch back from settings
  await epilogue(page, 'data');
  await expect(page.locator('#cfg-switch-row')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.selectOption('#cfg-libs', '/Railey Library');
  await click(page, '#cfg-switch');
  await page.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
  expect(await summary(page)).toBe(railey);
});

test('set-up link carries the folder typed in and the app key', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockNet(page); await openApp(page, { extra: { tamarack_library_dropbox_appkey: 'key123' } });
  await epilogue(page, 'data');
  await page.fill('#cfg-folder', '/Jones Library');
  await click(page, '#cfg-link');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const u = new URL(link);
  expect(u.searchParams.get('folder')).toBe('/Jones Library');
  expect(u.searchParams.get('appkey')).toBe('key123');
});

test('Epilogue opens straight to the appendix page and remembers the last tab', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await click(page, '#nav-epi');
  await expect(page.locator('.panel.active .appx-tabs')).toBeVisible();
  await click(page, '.panel.active .appx-tabs [data-go="help"]');
  await expect(page.locator('#help')).toHaveClass(/active/);
  await click(page, '.panel.active .back-link');
  await click(page, '#nav-epi');
  await expect(page.locator('#help')).toHaveClass(/active/);
});
