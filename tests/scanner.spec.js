// Barcode scanner: add mode, "Do I own this?" mode, offline save-for-later.
// The camera isn't available in tests, so ISBNs are typed into the box under the camera, which runs the same code.
const { test, expect } = require('@playwright/test');
const { FIXTURE, mockNet, openApp, click, summary } = require('./helpers');

async function scan(page, isbn) {
  await page.fill('#sc-isbn', isbn);
  await click(page, '#sc-go');
  await page.waitForSelector('#sc-result .sc-st');
  return (await page.textContent('#sc-result .sc-st')).trim();
}
async function openScanner(page, mode) {
  await click(page, '#btn-scan');
  await page.waitForSelector('#scan-bg.open');
  if (mode) await click(page, `#sc-modes [data-k="${mode}"]`);
}

test('a barcode already in the library says so', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await openScanner(page, 'add');
  const hobbit = FIXTURE.books.find(b => b.isbn === '9780547928227');
  expect(await scan(page, hobbit.isbn)).toContain('Already in the library');
});

test('a new barcode is looked up and added to the shelf typed in', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const before = await summary(page);
  await openScanner(page, 'add');
  await page.fill('#sc-room', 'Den'); await page.fill('#sc-case', 'Low bookcase'); await page.fill('#sc-shelf', '1'); await page.fill('#sc-pos', '3');
  expect(await scan(page, '9780316769488')).toContain('Not in the library yet');
  await expect(page.locator('#sc-result')).toContainText('The Catcher in the Rye');
  await click(page, '#sc-add');
  await expect(page.locator('#sc-result')).toContainText('Added');
  await expect(page.locator('#sc-pos')).toHaveValue('4');          // next spot along
  await click(page, '#sc-close');
  expect(await summary(page)).not.toBe(before);
  await page.fill('#f-q', 'catcher rye'); await page.waitForTimeout(250);
  await expect(page.locator('#results')).toContainText('Den');
});

test('a scan can identify a partly identified book', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await openScanner(page, 'add');
  expect(await scan(page, '9780143039433')).toContain('Possibly a partly identified book');   // Siddhartha vs "(Hermann Hesse — title not visible)"
  await click(page, '#sc-result [data-kind="partial"]');
  await expect(page.locator('#sc-result')).toContainText('Identified');
  await click(page, '#sc-close');
  await page.fill('#f-q', 'siddhartha'); await page.waitForTimeout(250);
  await expect(page.locator('#results')).toContainText('Siddhartha');
});

test('"Do I own this?" checks without adding, by barcode or by title', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const before = await summary(page);
  await openScanner(page, 'check');
  expect(await scan(page, '9780316769488')).toContain('Not in the library');
  await expect(page.locator('#sc-add')).toHaveCount(0);
  await click(page, '#sc-again');
  expect(await scan(page, 'driftwood valley')).toContain('✓ Found one');
  await click(page, '#sc-close');
  expect(await summary(page)).toBe(before);
});

test('offline: the scan is saved for later and fills in once back online', async ({ page, context }) => {
  const net = await mockNet(page); await openApp(page);
  await context.setOffline(true); net.offline = true;
  await openScanner(page, 'add');
  await page.fill('#sc-room', 'Den'); await page.fill('#sc-case', 'Low bookcase'); await page.fill('#sc-shelf', '1');
  await scan(page, '9780141182636');
  await click(page, '#sc-later');
  await expect(page.locator('#sc-result')).toContainText('Saved ISBN');
  await click(page, '#sc-close');
  await page.fill('#f-q', '9780141182636'); await page.waitForTimeout(250);
  await expect(page.locator('#results')).toContainText('details to fill in');
  await context.setOffline(false); net.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.fill('#f-q', 'watership'); 
  await expect(page.locator('#results')).toContainText('Watership Down', { timeout: 15000 });
});

test('one at a time: the camera keeps reading after a result, and a second book replaces the first (no tap needed)', async ({ page }) => {
  await mockNet(page); await openApp(page);
  await openScanner(page, 'add');
  await page.evaluate(() => gotCode('9780316769488'));
  await expect(page.locator('#sc-result')).toContainText('The Catcher in the Rye');
  // the same barcode still in front of the camera is ignored
  await page.evaluate(() => gotCode('9780316769488'));
  await expect(page.locator('#sc-result')).toContainText('The Catcher in the Rye');
  // the next book, without tapping anything
  await page.evaluate(() => gotCode('9780141182636'));
  await expect(page.locator('#sc-result')).toContainText('Watership Down');
  await click(page, '#sc-add');
  await expect(page.locator('#sc-result')).toContainText('Added');
  await page.evaluate(() => gotCode('9780316769488'));
  await expect(page.locator('#sc-result')).toContainText('The Catcher in the Rye');
});

test('scan a stack: each barcode goes in by itself, owned books are flagged, repeats ignored, undo works, no shelf needed', async ({ page }) => {
  await mockNet(page); await openApp(page);
  const n0 = await page.evaluate(() => live().length);
  await openScanner(page, 'many');
  await page.fill('#sc-room', ''); await page.fill('#sc-case', ''); await page.fill('#sc-shelf', ''); await page.fill('#sc-pos', '');
  await expect(page.locator('#sc-title')).toHaveText('Scan a stack of books');
  await page.evaluate(() => { gotCode('9780316769488'); gotCode('9780141182636'); gotCode('9780547928227'); });
  await expect(page.locator('#sc-batch .sc-bh')).toContainText('2 added', { timeout: 10000 });
  await expect(page.locator('#sc-batch .sc-bh')).toContainText('1 already had');
  await expect(page.locator('#sc-batch')).toContainText('The Catcher in the Rye');
  await expect(page.locator('#sc-batch')).toContainText('Watership Down');
  await expect(page.locator('#sc-batch')).toContainText('No shelf yet');
  expect(await page.evaluate(() => live().length)).toBe(n0 + 2);
  // the same book scanned again (typed, after the 4 s) is not added twice
  await page.fill('#sc-isbn', '9780316769488'); await click(page, '#sc-go');
  await expect(page.locator('#sc-hint')).toContainText('Already scanned');
  expect(await page.evaluate(() => live().length)).toBe(n0 + 2);
  // undo the Catcher
  await page.locator('#sc-batch .sc-m', { hasText: 'Catcher' }).locator('[data-bu]').click();
  await expect(page.locator('#sc-batch .sc-bh')).toContainText('1 added');
  expect(await page.evaluate(() => live().length)).toBe(n0 + 1);
  const w = await page.evaluate(() => live().find(b => b.isbn === '9780141182636'));
  expect(w.room || '').toBe('');
  await click(page, '#sc-done');
  await expect(page.locator('#scan-bg')).not.toHaveClass(/open/);
  await expect(page.locator('#toast')).toContainText('1 book added');
});

test('scan a stack offline: books go in with their ISBN and fill in later', async ({ page, context }) => {
  const net = await mockNet(page); await openApp(page);
  await context.setOffline(true); net.offline = true;
  await openScanner(page, 'many');
  await page.evaluate(() => { gotCode('9780316769488'); gotCode('9780141182636'); });
  await expect(page.locator('#sc-batch .sc-bh')).toContainText('2 added');
  await expect(page.locator('#sc-batch')).toContainText('title fills in when online');
  expect(await page.evaluate(() => live().filter(b => b.pendingIsbn).length)).toBe(2);
});
