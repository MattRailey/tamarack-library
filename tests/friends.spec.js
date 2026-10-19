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
  await expect(page.locator('#wz-body')).toContainText('Photograph your shelves', { timeout: 20000 });
  await page.click('#wz-photos-done');
  await expect(page.locator('#wz-body')).toContainText('Books Claude can’t read');
  await page.click('#wz-next');
  await expect(page.locator('#wz-body')).toContainText('home screen');
  await page.click('#wz-done');
  await expect(page.locator('#wz-bg')).not.toHaveClass(/open/);
}

test('a brand-new phone gets the setup wizard; an existing library does not', async ({ page }) => {
  const svc = await startService(); await connect(page, svc);
  await freshPhone(page);
  await expect(page.locator('#wz-bg')).toHaveClass(/open/);
  await expect(page.locator('#wz-body')).toContainText('I have a code');
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
  // build-library mode: the first bookcase is photographed right in the wizard, through the service
  await page.click('#wz-shoot');
  await expect(page.locator('#wz-err')).toContainText('room and the bookcase');
  await page.fill('#wz-room', 'Den'); await page.fill('#wz-case', 'N1');
  await page.setInputFiles('#wz-file', ['tests/fixtures/shelf.jpg', 'tests/fixtures/shelf.jpg']);
  await expect(page.locator('#wz-phstatus')).toContainText('2 photos of N1 sent', { timeout: 15000 });
  // more of the same bookcase, then on to the next one: the name counts up and the finished one is listed
  await expect(page.locator('#wz-shoot')).toContainText('More photos of N1');
  await expect(page.locator('#wz-nextcase')).toHaveText('Finished with N1 →');
  await page.click('#wz-nextcase');
  await expect(page.locator('#wz-case')).toHaveValue('N2');
  await expect(page.locator('#wz-room')).toHaveValue('Den');
  await expect(page.locator('.wz-done-list')).toContainText('N1 · 2 photos');
  await expect(page.locator('#wz-photos-done')).toHaveText('Finished adding to library');
  expect([...svc.files.keys()].filter(k => k.startsWith('/Smith Library/photos/inbox/') && / Den N1 shelf 0[12]\.jpg$/.test(k))).toHaveLength(2);
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
  await expect(page.locator('#adm-card')).toBeHidden();
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
  expect(link).toMatch(/\?join=\d{5}$/);
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

test('Invite a friend (Matt’s devices): secret saved once, invite made, phones listed and switched off; hidden on friends', async ({ page }) => {
  const svc = await startService(); await connect(page, svc);
  page.on('dialog', d => d.accept());
  await openApp(page, { dropbox: true, extra: { tamarack_library_friend_server: SERVER } });
  await epilogue(page, 'data');
  await expect(page.locator('#adm-card')).toBeVisible();
  await page.click('#adm-card summary');
  // a wrong secret is refused and not kept
  await page.fill('#adm-secret', 'not-the-secret-at-all'); await page.click('#adm-login button[type=submit]');
  await expect(page.locator('#adm-msg')).toContainText('didn’t accept that password');
  expect(await page.evaluate(() => localStorage.getItem('tamarack_library_admin'))).toBeNull();
  await page.fill('#adm-secret', ADMIN); await page.click('#adm-login button[type=submit]');
  await expect(page.locator('#adm-tools')).toBeVisible();
  // make an invite: code + link, and the library shows with its open invite
  await page.fill('#adm-lib', 'Jones Library'); await page.click('#adm-invite');
  await expect(page.locator('#adm-invite-out .wz-code')).toHaveText(/^\d{5}$/);
  await expect(page.locator('#adm-link')).toHaveValue(/\?join=\d{5}$/);
  await expect(page.locator('#adm-list .sr-item', { hasText: 'Jones Library' })).toContainText('Open invite');
  // a phone joins with it, shows up in the list, and is switched off from here
  const code = (await page.locator('#adm-invite-out .wz-code').textContent()).replace('-', '');
  const joined = await (await svc.worker.fetch(new Request(SERVER + '/join', { method: 'POST', body: JSON.stringify({ code, device: 'iPhone' }) }), svc.env, {})).json();
  expect(joined.lib).toBe('Jones Library');
  await page.click('#adm-refresh');
  const item = page.locator('#adm-list .sr-item', { hasText: 'Jones Library' });
  await expect(item).toContainText('1 phone');
  await item.locator('.adm-off').click();
  await expect(item).toContainText('0 phones');
  const res = await svc.worker.fetch(new Request(SERVER + '/whoami', { method: 'POST', headers: { Authorization: 'Bearer ' + joined.token } }), svc.env, {});
  expect(res.status).toBe(401);
  // the secret stays on this device until forgotten
  await page.reload(); await epilogue(page, 'data'); await page.click('#adm-card summary');
  await expect(page.locator('#adm-tools')).toBeVisible();
  await page.click('#adm-forget');
  await expect(page.locator('#adm-login')).toBeVisible();
});

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('iPhone Safari: after joining, Home Screen first with a code; the icon joins with it and Safari steps aside', async ({ browser }) => {
  const svc = await startService();
  const safari = await (await browser.newContext({ userAgent: IPHONE_UA })).newPage(); await connect(safari, svc);
  const inv = await svc.invite('Lee Library', 'The Lee Library');
  await freshPhone(safari, '?join=' + inv.code.replace('-', ''));
  await expect(safari.locator('#wz-body')).toContainText('Good to know');
  await safari.click('#wz-join');
  await expect(safari.locator('#wz-body')).toContainText('First, put it on your Home Screen', { timeout: 20000 });
  await expect(safari.locator('#wz-hcode')).toHaveText(/^\d{5}$/, { timeout: 10000 });
  const code = (await safari.locator('#wz-hcode').textContent()).replace('-', '');
  // the Home Screen copy (its own storage): types the code and lands in the same library
  const icon = await (await browser.newContext({ userAgent: IPHONE_UA })).newPage(); await connect(icon, svc);
  await freshPhone(icon);
  await icon.click('#wz-body [data-go="code"]');
  await icon.fill('#wz-code', code); await icon.click('#wz-join');
  await expect(icon.locator('#wz-body')).toContainText(/Home Screen|Photograph your shelves/, { timeout: 20000 });
  await expect(icon.locator('#lib-name')).toHaveText('The Lee Library');
  // the Safari copy is told where the library lives now
  await safari.evaluate(() => syncNow());
  await expect(safari.locator('#sync-text')).toContainText('icon on your Home Screen', { timeout: 10000 });
});

test('Remove this phone switches its key off at the service', async ({ page }) => {
  const svc = await startService(); await connect(page, svc);
  page.on('dialog', d => d.accept());
  const inv = await svc.invite('Park Library', 'Park Library');
  await freshPhone(page, '?join=' + inv.code.replace('-', ''));
  await page.click('#wz-join'); await finishWizard(page);
  const devs = () => [...svc.kv.keys()].filter(k => k.startsWith('dev:')).length;
  expect(devs()).toBe(1);
  await epilogue(page, 'data');
  await click(page, '#btn-disconnect');
  await expect.poll(devs, { timeout: 10000 }).toBe(0);
});

test('when the service is down, the phone says so in plain words', async ({ page }) => {
  const svc = await startService(); await connect(page, svc);
  const inv = await svc.invite('Fox Library', 'Fox Library');
  await freshPhone(page, '?join=' + inv.code.replace('-', ''));
  await page.click('#wz-join'); await finishWizard(page);
  svc.env.PAUSED = '1';
  await page.evaluate(() => { store.books.push({ id: 'f1', title: 'Paused Book', updatedAt: Date.now() }); commit(); syncNow(); });
  await expect(page.locator('#sync-text')).toContainText('paused', { timeout: 10000 });
  await expect(page.locator('#sync-text')).not.toContainText('HTTP');
  svc.env.PAUSED = '0';
});
