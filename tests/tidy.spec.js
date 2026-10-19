// Epilogue → Import & Export: duplicates, series split up, and recheck shelves (selling is gone).
const { test, expect } = require('@playwright/test');
const { mockNet, openApp, click, epilogue } = require('./helpers');

async function addBooks(page, books) {
  await page.evaluate(bs => { const now = Date.now(); for (const b of bs) store.books.push(Object.assign({ status: 'unread', addedAt: now, updatedAt: now }, b)); commit(); }, books);
}

test('the tabs are photos, unidentified, duplicates, series and recheck — nothing about selling', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await epilogue(page, 'import');
  await expect(page.locator('#ie-seg button')).toHaveText(['From photos', 'Unidentified', 'Duplicates', 'Series', 'Recheck shelves']);
  await expect(page.locator('#import')).not.toContainText(/sell|eBay|Etsy/i);
  await expect(page.locator('#btn-dups')).toHaveCount(0);
  await expect(page.locator('#btn-series')).toHaveCount(0);
});

test('duplicates lists every copy with where it is', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await addBooks(page, [
    { id: 'd1', title: 'Zebra Quest', author: 'Ann Tester', room: 'Den', bookcase: 'N1', shelf: '2', position: '4' },
    { id: 'd2', title: 'Zebra Quest', author: 'Ann Tester', room: 'Attic', bookcase: 'B3', shelf: '1', position: '1' },
  ]);
  await epilogue(page, 'import'); await click(page, '#ie-seg [data-ie="dups"]');
  const item = page.locator('#dp-list .sr-item', { hasText: 'Zebra Quest' });
  await expect(item).toContainText('2 copies');
  await expect(item.locator('.sr-loc')).toHaveCount(2);
  await expect(item).toContainText('Den'); await expect(item).toContainText('Attic');
});

test('series split up lists every book of the series under the place it sits, volumes in order', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await addBooks(page, [
    { id: 's1', title: 'Moon Saga One', author: 'Bo Writer', series: 'Moon Saga', seriesNo: '1', room: 'Den', bookcase: 'N1', shelf: '1', position: '1' },
    { id: 's3', title: 'Moon Saga Three', author: 'Bo Writer', series: 'Moon Saga', seriesNo: '3', room: 'Den', bookcase: 'N1', shelf: '1', position: '2' },
    { id: 's2', title: 'Moon Saga Two', author: 'Bo Writer', series: 'Moon Saga', seriesNo: '2', room: 'Bedroom', bookcase: 'Nightstand', shelf: '1', position: '1' },
  ]);
  await epilogue(page, 'import'); await click(page, '#ie-seg [data-ie="series"]');
  const item = page.locator('#sr-list .sr-item', { hasText: 'Moon Saga' });
  await expect(item).toContainText('3 books in 2 places');
  const places = item.locator('.sr-place');
  await expect(places).toHaveCount(2);
  await expect(places.nth(0).locator('.sr-where')).toContainText('Den → N1');
  await expect(places.nth(0).locator('.sr-loc')).toHaveText([/1 · Moon Saga One/, /3 · Moon Saga Three/]);
  await expect(places.nth(1)).toContainText('Moon Saga Two');
  // narrowing to a room keeps series that have a book there
  await page.selectOption('#sr-room', 'Bedroom');
  await expect(page.locator('#sr-list .sr-item', { hasText: 'Moon Saga' })).toHaveCount(1);
  await item.locator('.sr-loc', { hasText: 'Moon Saga Two' }).click();
  await expect(page.locator('#m-title')).toHaveText('Moon Saga Two');
});

test('recheck shelves: photos go to the inbox marked "recheck", and bookcases are listed oldest first', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await addBooks(page, [
    { id: 'r1', title: 'Old Shelf Book', author: 'C One', room: 'Zed Room', bookcase: 'Q9', shelf: '1', position: '1', addedAt: 1000 },
  ]);
  await epilogue(page, 'import'); await click(page, '#ie-seg [data-ie="recheck"]');
  await expect(page.locator('#rc-list .rc-row').first()).toContainText('Zed Room · Q9');
  await page.locator('#rc-list .rc-row').first().click();
  await expect(page.locator('#rc-case')).toHaveValue('Q9');
  await page.setInputFiles('#rc-file', ['tests/fixtures/shelf.jpg', 'tests/fixtures/shelf.jpg']);
  await expect(page.locator('#rc-status')).toContainText('2 recheck photos sent', { timeout: 10000 });
  const paths = net.uploads.map(u => u.path).filter(p => p.includes('/photos/inbox/'));
  expect(paths).toHaveLength(2);
  expect(paths[0]).toMatch(/ Zed-Room Q9 recheck 01\.jpg$/);
});

test('recheck needs a room and bookcase first', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await epilogue(page, 'import'); await click(page, '#ie-seg [data-ie="recheck"]');
  await page.fill('#rc-room', ''); await page.fill('#rc-case', '');
  await click(page, '#rc-take');
  await expect(page.locator('#toast')).toContainText('room and bookcase');
  expect(net.uploads.filter(u => u.path.includes('/photos/'))).toHaveLength(0);
});
