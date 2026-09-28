// Browsing: search, filters, views, collections, the book window.
const { test, expect } = require('@playwright/test');
const { FIXTURE, mockNet, openApp, click, summary, search, openFirstResult } = require('./helpers');
const liveCount = FIXTURE.books.filter(b => !b.deleted && b.saleStatus !== 'sold').length;

test.beforeEach(async ({ page }) => { await mockNet(page); await openApp(page); });

test('shows the whole library, sold books left out', async ({ page }) => {
  expect(await summary(page)).toContain(`of ${liveCount.toLocaleString()} books`);
  await expect(page.locator('#lib-name')).toHaveText('Railey Library');
});

test('search matches whole-word starts, not the middle of words', async ({ page }) => {
  const b = FIXTURE.books.find(x => x.title && !x.title.startsWith('(') && x.title.split(' ').length > 2);
  const word = b.title.split(/\s+/).find(w => w.length > 4).replace(/[^\w]/g, '');
  await search(page, word.slice(0, 5));
  await expect(page.locator('#results')).toContainText(b.title);
  await search(page, 'zzqqxx');
  expect(await summary(page)).toMatch(/Showing 0|No books/);
});

test('one-letter typo still finds a title', async ({ page }) => {
  await search(page, 'hobbitt');
  await expect(page.locator('#results')).toContainText('The Hobbit');
});

test('clear-search button empties the box', async ({ page }) => {
  await search(page, 'hobbit');
  await page.click('#btn-clear-q');
  await expect(page.locator('#f-q')).toHaveValue('');
});

test('genre filter narrows the list', async ({ page }) => {
  const genre = FIXTURE.books.find(b => b.genre).genre;
  const n = FIXTURE.books.filter(b => b.genre === genre && b.saleStatus !== 'sold').length;
  await page.selectOption('#f-genre', genre);
  await page.waitForTimeout(200);
  expect(await summary(page)).toContain(`Showing ${n} of`);
});

test('feed, cards and list views all render', async ({ page }) => {
  for (const v of ['feed', 'grid', 'list']) {
    await click(page, `#view-seg [data-view="${v}"]`);
    await expect(page.locator('#results [data-id]').first()).toBeVisible();
  }
});

test('book window: view, edit, save, survives reload', async ({ page }) => {
  await search(page, 'hobbit');
  await openFirstResult(page);
  await expect(page.locator('#modal')).toHaveClass(/viewing/);
  await click(page, '#btn-edit');
  await expect(page.locator('#modal')).not.toHaveClass(/viewing/);
  await page.fill('#e-notes', 'first edition?');
  await click(page, '#btn-save');
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
  await search(page, 'hobbit');
  await openFirstResult(page);
  await expect(page.locator('#m-view')).toContainText('first edition?');
});

test('flipping between books keeps the window the same height', async ({ page }) => {
  await openFirstResult(page);
  const hs = [];
  for (let i = 0; i < 4; i++) {
    hs.push(Math.round((await page.locator('#modal').boundingBox()).height));
    await click(page, '#m-next'); await page.waitForTimeout(800);
  }
  expect(new Set(hs).size).toBe(1);
});

test('collections: add in the book window, filter by pill, rename, remove', async ({ page }) => {
  await search(page, 'hobbit'); await openFirstResult(page);
  await click(page, '#btn-edit');
  await page.evaluate(() => { const i = document.getElementById('e-coll-in'); i.value = 'Fantasy picks'; document.getElementById('e-coll-add').click(); });
  await click(page, '#btn-save'); await page.waitForTimeout(300);
  await page.click('#btn-clear-q');
  await page.click('.coll-pill[data-coll="Fantasy picks"]');
  expect(await summary(page)).toContain('Showing 1 of');
  page.on('dialog', d => d.accept('Tolkien shelf'));
  await page.click('.coll-pill[data-act="rename"]');
  await expect(page.locator('.coll-pill[data-coll="Tolkien shelf"]')).toBeVisible();
  await page.click('.coll-pill[data-act="remove"]');
  await expect(page.locator('.coll-pill[data-coll="Tolkien shelf"]')).toHaveCount(0);
});

test('select multiple → add to a collection', async ({ page }) => {
  await search(page, 'the');
  await click(page, '#btn-more-filters'); await click(page, '#btn-select'); await click(page, '#btn-batch-all');
  await click(page, '#btn-batch-edit');
  await page.fill('#b-coll-add', 'Batch test');
  await click(page, '#b-apply'); await page.waitForTimeout(300);
  await expect(page.locator('.coll-pill[data-coll="Batch test"]')).toBeVisible();
});

test('shelf positions ignore sold books', async ({ page }) => {
  // the fixture has one sold book; its shelf-mates must count as if it were gone
  const sold = FIXTURE.books.find(b => b.saleStatus === 'sold');
  const mates = FIXTURE.books.filter(b => b.room === sold.room && b.bookcase === sold.bookcase && b.shelf === sold.shelf && b.id !== sold.id && /^\d+$/.test(b.position))
    .sort((a, b) => a.position - b.position);
  const first = mates[0];
  await search(page, first.title);
  await expect(page.locator('#results')).toContainText('#1 from left');
});

test('shelves tab lists every room', async ({ page }) => {
  await page.click('nav [data-panel="shelves"]');
  const rooms = [...new Set(FIXTURE.books.filter(b => b.room).map(b => b.room))];
  for (const r of rooms) await expect(page.locator('#shelves')).toContainText(r);
});
