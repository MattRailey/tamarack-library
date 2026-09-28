// Shared test helpers: a fake network (Dropbox, Open Library, Google Books) and a seeded library.
const fs = require('fs');
const path = require('path');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'library.json'), 'utf8'));
const APP = '/tamarack-library.html';

// Books the fake catalogs know, by ISBN.
const CATALOG = {
  '9780316769488': { title: 'The Catcher in the Rye', author: 'J. D. Salinger' },
  '9780547928227': { title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  '9780141182636': { title: 'Watership Down', author: 'Richard Adams' },
  '9780143039433': { title: 'Siddhartha', author: 'Hermann Hesse' },
};

/** Fake network. Returns a log of Dropbox uploads ({path, body}). */
async function mockNet(page, opts = {}) {
  const net = { uploads: [], downloads: [], remote: opts.remote || null, offline: false };
  await page.context().route('**/*', async route => {
    const u = route.request().url();
    if (u.includes('localhost')) return route.continue();
    if (net.offline) return route.abort('internetdisconnected');
    if (u.includes('content.dropboxapi.com/2/files/download')) {
      const arg = JSON.parse(route.request().headers()['dropbox-api-arg']);
      net.downloads.push(arg.path);
      if (arg.path.endsWith('tamarack-library.json') && net.remote)
        return route.fulfill({ status: 200, body: JSON.stringify(net.remote), headers: { 'Dropbox-API-Result': JSON.stringify({ rev: 'r' + net.uploads.length }) } });
      const up = [...net.uploads].reverse().find(x => x.path === arg.path);
      if (up) return route.fulfill({ status: 200, body: up.raw });
      return route.fulfill({ status: 409, body: '{}' });
    }
    if (u.includes('content.dropboxapi.com/2/files/upload')) {
      const arg = JSON.parse(route.request().headers()['dropbox-api-arg']);
      const raw = route.request().postDataBuffer();
      net.uploads.push({ path: arg.path, raw, body: raw ? raw.toString('utf8') : '' });
      if (arg.path.endsWith('tamarack-library.json')) { try { net.remote = JSON.parse(raw.toString('utf8')); } catch (e) {} }
      return route.fulfill({ status: 200, body: JSON.stringify({ path_display: arg.path }) });
    }
    if (u.includes('openlibrary.org/search.json')) {
      const isbn = new URL(u).searchParams.get('isbn');
      const hit = isbn && CATALOG[isbn];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: hit ? [{ title: hit.title, author_name: [hit.author], isbn: [isbn] }] : [] }) });
    }
    if (u.includes('openlibrary.org') || u.includes('googleapis.com'))
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    return route.abort();
  });
  return net;
}

/** Open the app with a library already stored on the device. */
async function openApp(page, { store = FIXTURE, dropbox = false, folder = null, extra = {} } = {}) {
  await page.goto(APP + '?t=blank');
  await page.evaluate(async ({ store, dropbox, folder, extra }) => {
    localStorage.clear();
    await new Promise(r => { const q = indexedDB.deleteDatabase('tamarack_library'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    const ns = folder && folder !== '/Railey Library' ? '@' + folder : '';
    if (folder) localStorage.setItem('tamarack_library_folder', folder);
    if (store) localStorage.setItem('tamarack_library_store_v1' + ns, JSON.stringify(store));
    if (dropbox) localStorage.setItem('tamarack_library_dropbox_tokens' + ns, JSON.stringify({ access_token: 'test', expires_at: Date.now() + 3600e3 }));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, { store, dropbox, folder, extra });
  await page.goto(APP);
  await page.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
}

const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const summary = page => page.textContent('#summary');
async function search(page, q) { await page.fill('#f-q', q); await page.waitForTimeout(250); }
async function openFirstResult(page) { await page.click('#results [data-id]'); await page.waitForSelector('#modal-bg.open'); }
async function epilogue(page, tab) { await page.click('#nav-epi'); if (tab) await click(page, `.panel.active .appx-tabs [data-go="${tab}"]`); await page.waitForTimeout(150); }

module.exports = { FIXTURE, CATALOG, APP, mockNet, openApp, click, summary, search, openFirstResult, epilogue };
