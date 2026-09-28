// The walk-through for unidentified books: pick a shelf, identify, move on shelf by shelf.
const { test, expect } = require('@playwright/test');
const { mockNet, openApp, click, epilogue } = require('./helpers');

async function openWalk(page) {
  await epilogue(page, 'import');
  await click(page, '#ie-seg [data-ie="unid"]');
  await click(page, '#un-walk');
  await page.waitForSelector('#walk-bg.open');
}

test('the picker lists shelves with mystery books, grouped by room', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await openWalk(page);
  await expect(page.locator('#wk-all')).toContainText('Whole house');
  const shelves = page.locator('#wk-body .wk-ps');
  expect(await shelves.count()).toBeGreaterThan(3);
  await expect(page.locator('#wk-body .wk-pr').first()).toBeVisible();
});

test('one shelf at a time: type a title, save, and the shelf finishes', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await openWalk(page);
  // pick the Bedroom white bookcase shelf 4 (five mystery books)
  const btn = page.locator('#wk-body .wk-ps[data-scope="Bedroom|White bookcase|4"]');
  const n = +(await btn.locator('.n').textContent());
  await btn.click();
  await expect(page.locator('#wk-count')).toHaveText(`1 of ${n}`);
  await expect(page.locator('.wk-where')).toContainText('Bedroom');
  await click(page, '#wk-type');
  await page.fill('#wk-title', 'The Fellowship of the Ring'); await page.fill('#wk-author', 'J. R. R. Tolkien');
  await click(page, '#wk-save');
  await expect(page.locator('#wk-count')).toHaveText(`2 of ${n}`);
  for (let i = 1; i < n; i++) await click(page, '#wk-skip');
  await expect(page.locator('.wk-done h3')).toHaveText('Shelf done');
  await expect(page.locator('#wk-nxt')).toBeVisible();
  await click(page, '#wk-pick');
  await expect(page.locator('#wk-all')).toBeVisible();
});

test('a title-page photo goes to photos/identify, named by where the book sits', async ({ page }) => {
  const net = await mockNet(page, { remote: null }); await openApp(page, { dropbox: true });
  await openWalk(page);
  await page.locator('#wk-body .wk-ps[data-scope="Bedroom|White bookcase|4"]').click();
  await page.setInputFiles('#wk-file', 'tests/fixtures/shelf.jpg');
  await expect.poll(() => net.uploads.map(u => u.path).find(p => p.includes('/photos/identify/')), { timeout: 10000 })
    .toMatch(/^\/Railey Library\/photos\/identify\/Bedroom White-bookcase shelf-4 pos-\S+ \S+\.jpg$/);
  await expect(page.locator('#wk-count')).toContainText('2 of');
});
