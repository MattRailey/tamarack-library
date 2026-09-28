// "Send shelf photos": pictures go to <library folder>/photos/inbox, labeled with where they were taken.
const { test, expect } = require('@playwright/test');
const { mockNet, openApp, click } = require('./helpers');

test('photos are named with date, room, bookcase, shelf and kind; notes go alongside', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await click(page, '#btn-photos'); await page.waitForSelector('#ph-bg.open');
  await page.fill('#ph-room', 'Living Room'); await page.fill('#ph-case', 'Tall bookcase'); await page.fill('#ph-shelf', '2');
  await page.fill('#ph-note', 'left half');
  await page.setInputFiles('#ph-file', ['tests/fixtures/shelf.jpg', 'tests/fixtures/shelf.jpg']);
  await expect(page.locator('#ph-status')).toContainText('2 photos sent', { timeout: 10000 });
  const paths = net.uploads.map(u => u.path).filter(p => p.includes('/photos/inbox/'));
  expect(paths.filter(p => p.endsWith('.jpg'))).toHaveLength(2);
  expect(paths[0]).toMatch(/^\/Railey Library\/photos\/inbox\/\d{4}-\d\d-\d\d \d{6} Living-Room Tall-bookcase shelf-2 shelf left-half 1\.jpg$/);
  expect(paths.some(p => p.endsWith('NOTE.txt'))).toBeTruthy();
});

test('without Dropbox the app asks you to connect first', async ({ page }) => {
  const net = await mockNet(page); await openApp(page);
  await click(page, '#btn-photos'); await click(page, '#ph-take');
  await expect(page.locator('#toast')).toContainText('Connect Dropbox first');
  expect(net.uploads).toHaveLength(0);
});

test('the scanner can send a shelf photo too', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await click(page, '#btn-scan'); await page.waitForSelector('#scan-bg.open');
  await page.fill('#sc-room', 'Den'); await page.fill('#sc-case', 'Oak bookcase'); await page.fill('#sc-shelf', '3');
  await page.setInputFiles('#sc-file', 'tests/fixtures/shelf.jpg');
  await expect(page.locator('#sc-phstatus')).toContainText('Shelf photo sent', { timeout: 10000 });
  expect(net.uploads.map(u => u.path).find(p => p.includes('/photos/inbox/'))).toMatch(/Den Oak-bookcase shelf-3 shelf\.jpg$/);
});
