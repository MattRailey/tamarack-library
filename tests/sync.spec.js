// Dropbox sync, merging, offline behaviour, and the readable JSON file.
const { test, expect } = require('@playwright/test');
const { FIXTURE, mockNet, openApp, click, search, openFirstResult } = require('./helpers');

test('first sync uploads a neatly indented catalog, title and author first', async ({ page }) => {
  const net = await mockNet(page);
  await openApp(page, { dropbox: true });
  await expect.poll(() => net.uploads.filter(u => u.path === '/Railey Library/tamarack-library.json').length, { timeout: 10000 }).toBeGreaterThan(0);
  const body = net.uploads.find(u => u.path.endsWith('.json')).body;
  expect(body.startsWith('{\n  "format"')).toBeTruthy();
  const book = JSON.parse(body).books.find(b => !b.deleted);
  expect(Object.keys(book).slice(0, 3)).toEqual(['id', 'title', 'author']);
});

test('edits on two devices to different fields of one book both survive', async ({ page }) => {
  const id = FIXTURE.books.find(b => b.title === 'The Hobbit').id;
  // the other device fixed the author a moment ago
  const remote = JSON.parse(JSON.stringify(FIXTURE));
  const rb = remote.books.find(b => b.id === id);
  const t = Date.now() + 5000;
  rb.author = 'J.R.R. Tolkien (fixed elsewhere)'; rb.updatedAt = t; rb.ft = { author: t };
  const net = await mockNet(page, { remote });
  await openApp(page);
  // this device lends it out (no Dropbox yet)
  await search(page, 'hobbit'); await openFirstResult(page); await click(page, '#btn-edit');
  await page.fill('#e-loanedTo', 'Grandpa'); await click(page, '#btn-save'); await page.waitForTimeout(400);
  // now connect and sync
  await page.evaluate(() => localStorage.setItem('tamarack_library_dropbox_tokens', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3600e3 })));
  await page.reload();
  await expect.poll(() => { const r = net.remote.books.find(b => b.id === id); return r.loanedTo + '|' + r.author; }, { timeout: 10000 })
    .toBe('Grandpa|J.R.R. Tolkien (fixed elsewhere)');
});

test('saving the edit form only claims the fields actually changed', async ({ page }) => {
  // The other device added a note a minute ago; this device (which hadn't synced yet) lends the book out now.
  const id = FIXTURE.books.find(b => b.title === 'The Hobbit').id;
  const remote = JSON.parse(JSON.stringify(FIXTURE));
  const rb = remote.books.find(b => b.id === id);
  const t = Date.now() - 60000;
  rb.notes = 'Signed copy'; rb.updatedAt = t; rb.ft = { notes: t };
  const net = await mockNet(page, { remote });
  await openApp(page);
  await search(page, 'hobbit'); await openFirstResult(page); await click(page, '#btn-edit');
  await page.fill('#e-loanedTo', 'Grandpa'); await click(page, '#btn-save'); await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.setItem('tamarack_library_dropbox_tokens', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3600e3 })));
  await page.reload();
  await expect.poll(() => { const r = net.remote.books.find(b => b.id === id); return r.loanedTo + '|' + r.notes; }, { timeout: 10000 })
    .toBe('Grandpa|Signed copy');
});

test('changes made offline are kept and the status says offline', async ({ page, context }) => {
  const net = await mockNet(page);
  await openApp(page, { dropbox: true });
  net.offline = true; await context.setOffline(true);
  await search(page, 'hobbit'); await openFirstResult(page); await click(page, '#btn-edit');
  await page.fill('#e-notes', 'offline note'); await click(page, '#btn-save'); await page.waitForTimeout(2500);
  await expect(page.locator('#sync-text')).toContainText(/Offline|Unsynced/);
  net.offline = false; await context.setOffline(false);
  await expect.poll(() => { const r = net.remote && net.remote.books.find(b => b.title === 'The Hobbit'); return r && r.notes; }, { timeout: 12000 }).toBe('offline note');
});

test('a damaged saved copy falls back to the previous save', async ({ page }) => {
  await mockNet(page);
  await openApp(page);
  await search(page, 'hobbit'); await openFirstResult(page); await click(page, '#btn-edit');
  await page.fill('#e-notes', 'x'); await click(page, '#btn-save'); await page.waitForTimeout(900);
  await page.fill('#f-q', '');
  await page.evaluate(() => new Promise(r => { const i = indexedDB.open('tamarack_library'); i.onsuccess = () => { const t = i.result.transaction('kv', 'readwrite'); t.objectStore('kv').put('{broken', 'tamarack_library_store_v1'); t.oncomplete = r; }; }));
  await page.evaluate(() => localStorage.removeItem('tamarack_library_store_v1'));
  await page.reload();
  await page.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
  expect(await page.textContent('#summary')).not.toContain('of 0 books');
});
