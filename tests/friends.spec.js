// Friends' libraries and the setup wizard. The app talks to the REAL friends service code (worker/src/index.js),
// run inside the test; only Dropbox behind it is faked. Also: photos that fail to send wait on the phone and retry.
const { test, expect } = require('@playwright/test');
const { FIXTURE, APP, mockNet, openApp, click, epilogue } = require('./helpers');

const SERVER = 'https://friends.test';
const ADMIN = 'admin-secret-0123456789';

// One service shared by every phone in a test: KV in memory, Dropbox in memory.
async function startService() {
  const { default: worker } = await import('../worker/src/index.js');
  const kv = new Map();
  const files = new Map(); let rev = 0;
  const env = { ADMIN_SECRET: ADMIN, DBX_APP_KEY: 'k', DBX_REFRESH_TOKEN: 'rt', ALLOWED_ORIGINS: 'http://localhost:4173', DBX_ROOT: '', APP_URL: 'http://localhost:4173' + APP,
    LIBS: { async get(k) { return kv.get(k) ?? null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); },
      async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
  // Dropbox as the service sees it
  globalThis.fetch = async (url, opt) => {
    if (url.includes('oauth2/token')) return new Response(JSON.stringify({ access_token: 'acc', expires_in: 14400 }));
    const arg = JSON.parse(opt.headers['Dropbox-API-Arg']);
    const cur = files.get(arg.path);
    if (url.includes('/files/download')) return cur ? new Response(cur.body, { headers: { 'Dropbox-API-Result': JSON.stringify({ rev: cur.rev }) } }) : new Response('{}', { status: 409 });
    if (arg.mode === 'add' && cur && !arg.autorename) return new Response('{}', { status: 409 });
    if (arg.mode['.tag'] === 'update' && (!cur || cur.rev !== arg.mode.update)) return new Response('{}', { status: 409 });
    let path = arg.path; if (arg.mode === 'add' && cur) path = path.replace(/(\.\w+)$/, ' (1)$1');
    const f = { body: Buffer.from(await new Response(opt.body).arrayBuffer()), rev: 'r' + (++rev) }; files.set(path, f);
    return new Response(JSON.stringify({ path_display: path, rev: f.rev }));
  };
  const call = async (path, body) => (await worker.fetch(new Request(SERVER + path, { method: 'POST', headers: { 'X-Admin': ADMIN }, body: JSON.stringify(body || {}) }), env, {})).json();
  return { worker, env, files, kv,
    invite: (lib, title, uses = 2) => call('/admin/invite', { lib, title, uses }),
    catalog: lib => { const f = files.get('/' + lib + '/tamarack-library.json'); return f ? JSON.parse(f.body.toString('utf8')) : null; } };
}
// Route the phone's requests to the service; everything else goes to the usual fake network.
async function connect(page, svc) {
  const net = await mockNet(page);
  await page.context().route(SERVER + '/**', async route => {
    const r = route.request();
    const res = await svc.worker.fetch(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.method() === 'POST' ? r.postDataBuffer() : undefined }), svc.env, {});
    const headers = {}; res.headers.forEach((v, k) => headers[k] = v);
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
  return net;
}
// A phone that has never opened the app (the service address set the way a release build has it built in).
async function freshPhone(page, query = '') {
  await page.goto(APP + '?t=blank');
  await page.evaluate(async server => {
    localStorage.clear();
    await new Promise(r => { const q = indexedDB.deleteDatabase('tamarack_library'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    localStorage.setItem('tamarack_library_friend_server', server);
  }, SERVER);
  await page.goto(APP + query);
}
async function finishWizard(page) {
  await expect(page.locator('#wz-body')).toContainText('Adding books', { timeout: 20000 });
  await page.click('#wz-next');
  await expect(page.locator('#wz-body')).toContainText('home screen');
  await page.click('#wz-done');
  await expect(page.locator('#wz-bg')).not.toHaveClass(/open/);
}

test('a brand-new phone gets the setup wizard; an existing library does not', async ({ page }) => {
  const svc = await startService(); await connect(page, svc);
  await freshPhone(page);
  await expect(page.locator('#wz-bg')).toHaveClass(/open/);
  await expect(page.locator('#wz-body')).toContainText('I have an invite code');
  await expect(page.locator('#wz-body')).toContainText('Use my own Dropbox');
  // "just try it" closes it for good on this device
  await page.click('[data-go="local"]');
  await expect(page.locator('#wz-bg')).not.toHaveClass(/open/);
  await page.reload(); await page.waitForTimeout(800);
  await expect(page.locator('#wz-bg')).not.toHaveClass(/open/);
  // a device that already has a library never sees it
  await openApp(page, { dropbox: true });
  await page.waitForTimeout(800);
  await expect(page.locator('#wz-bg')).not.toHaveClass(/open/);
});

test('a friend taps an invite link: joins, the library is named, and books sync through the service only', async ({ page }) => {
  const svc = await startService(); const net = await connect(page, svc);
  const inv = await svc.invite('Smith Library', 'The Smith Library');
  await freshPhone(page, '?join=' + inv.code.replace('-', ''));
  await expect(page.locator('#wz-code')).toHaveValue(inv.code.replace('-', ''));
  await page.click('#wz-join');
  await expect(page.locator('#wz-body')).toContainText('Your library is ready', { timeout: 20000 });
  await finishWizard(page);
  await expect(page.locator('#lib-name')).toHaveText('The Smith Library');
  // add a book by hand; it lands in the Smith folder via the service, and nothing talks to Dropbox directly
  await page.evaluate(() => { store.books.push({ id: 'bk1', title: 'Watership Down', author: 'Richard Adams', updatedAt: Date.now() }); commit(); });
  await expect.poll(() => (svc.catalog('Smith Library') || { books: [] }).books.map(b => b.title), { timeout: 10000 }).toContain('Watership Down');
  expect(svc.catalog('Smith Library').settings.library.title).toBe('The Smith Library');
  expect(net.uploads).toHaveLength(0);
  // Data & Sync reads as a friend's library: no Dropbox folder or app key, an "Add another phone" button
  await epilogue(page, 'data');
  await expect(page.locator('#btn-addphone')).toBeVisible();
  await expect(page.locator('#dbx-appkey-row')).toBeHidden();
  await expect(page.locator('#cfg-folder')).toBeHidden();
});

test('husband and wife: "Add another phone" brings the second phone into the same library', async ({ browser }) => {
  const svc = await startService();
  const his = await (await browser.newContext()).newPage(); await connect(his, svc);
  const inv = await svc.invite('Jones Library', 'Jones Family Books', 1);
  await freshPhone(his, '?join=' + inv.code);
  await his.click('#wz-join'); await finishWizard(his);
  await his.evaluate(() => { for (let i = 0; i < 3; i++) store.books.push({ id: 'j' + i, title: 'Book ' + i, room: 'Den', updatedAt: Date.now() }); commit(); });
  await expect.poll(() => (svc.catalog('Jones Library') || { books: [] }).books.length, { timeout: 10000 }).toBe(3);
  // his phone makes a one-time link
  await epilogue(his, 'data');
  await click(his, '#btn-addphone');
  const link = await his.locator('#addphone-link').inputValue({ timeout: 10000 });
  expect(link).toMatch(/\?join=[A-Z2-9]{8}$/);
  // her phone opens it
  const her = await (await browser.newContext()).newPage(); await connect(her, svc);
  await freshPhone(her, '?join=' + new URL(link).searchParams.get('join'));
  await her.click('#wz-join');
  await expect(her.locator('#wz-body')).toContainText('has 3 books', { timeout: 20000 });
  await finishWizard(her);
  await expect(her.locator('#lib-name')).toHaveText('Jones Family Books');
  // both edit; both edits end up in the one catalog
  await her.evaluate(() => { const b = store.books.find(x => x.id === 'j0'); b.loanedTo = 'Aunt May'; b.updatedAt = Date.now(); commit(); });
  await expect.poll(() => svc.catalog('Jones Library').books.find(b => b.id === 'j0').loanedTo, { timeout: 10000 }).toBe('Aunt May');
  await his.evaluate(() => syncNow());
  await expect.poll(() => his.evaluate(() => store.books.find(x => x.id === 'j0').loanedTo), { timeout: 10000 }).toBe('Aunt May');
  // the invite was single-use: a third phone can't reuse it
  const third = await (await browser.newContext()).newPage(); await connect(third, svc);
  await freshPhone(third, '?join=' + inv.code);
  await third.click('#wz-join');
  await expect(third.locator('#wz-err')).toContainText('didn’t work');
});

test('photos that fail to send wait on the phone and go later, under the same name, without duplicates', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  let failing = true;
  await page.context().route('**/content.dropboxapi.com/2/files/upload', async (route, req) => {
    const arg = JSON.parse(req.headers()['dropbox-api-arg']);
    if (failing && arg.path.includes('/photos/inbox/')) return route.abort('internetdisconnected');
    return route.fallback();
  });
  await click(page, '#btn-photos'); await page.waitForSelector('#ph-bg.open');
  await page.fill('#ph-room', 'Shed'); await page.fill('#ph-case', 'N1'); await page.fill('#ph-shelf', '1');
  await page.setInputFiles('#ph-file', Array(3).fill('tests/fixtures/shelf.jpg'));
  await expect(page.locator('#ph-status')).toContainText('didn’t go through', { timeout: 10000 });
  await expect(page.locator('#ph-retry')).toBeVisible();
  await expect(page.locator('#ph-retry-n')).toHaveText('3 photos waiting to send');
  failing = false;
  await click(page, '#ph-retry-btn');
  await expect(page.locator('#ph-retry')).toBeHidden({ timeout: 10000 });
  const sent = net.uploads.map(u => u.path).filter(p => p.includes('/photos/inbox/'));
  expect(sent).toHaveLength(3);
  expect(sent.map(p => p.match(/ (\d\d)\.jpg$/)[1]).sort()).toEqual(['01', '02', '03']);
  expect(sent.every(p => / Shed N1 shelf-1 shelf \d\d\.jpg$/.test(p))).toBe(true);
});
