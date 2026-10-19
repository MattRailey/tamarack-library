// Friends service tests: node --test worker/test   (no Cloudflare or Dropbox needed — both are faked here)
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _test } from '../src/index.js';

const ADMIN = 'admin-secret-0123456789';
const ORIGIN = 'https://mattrailey.github.io';
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);   // the start of a real JPEG

function fakeKV() {
  const m = new Map();
  return { m,
    async get(k) { const v = m.get(k); if (!v) return null; if (v.exp && v.exp * 1000 < Date.now()) { m.delete(k); return null; } return v.val; },
    async put(k, val, o = {}) { m.set(k, { val, exp: o.expiration }); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
}
// Fake Dropbox: files by full path, with revisions; token endpoint counts refreshes.
function fakeDropbox() {
  const files = new Map(); let rev = 0; const calls = [];
  globalThis.fetch = async (url, opt) => {
    calls.push(url);
    if (url.includes('oauth2/token')) return new Response(JSON.stringify({ access_token: 'acc', expires_in: 14400 }));
    if (url.includes('/files/move_v2')) {
      const { from_path, to_path } = JSON.parse(opt.body); const from = from_path.toLowerCase() + '/';
      const keys = [...files.keys()].filter(k => k.startsWith(from)); if (!keys.length) return new Response('{}', { status: 409 });
      for (const k of keys) { files.set(to_path.toLowerCase() + '/' + k.slice(from.length), files.get(k)); files.delete(k); }
      return new Response(JSON.stringify({ metadata: { path_display: to_path } }));
    }
    const arg = JSON.parse(opt.headers['Dropbox-API-Arg']);
    if (url.includes('/files/download')) {
      const f = files.get(arg.path.toLowerCase());
      if (!f) return new Response('{}', { status: 409 });
      return new Response(f.body, { headers: { 'Dropbox-API-Result': JSON.stringify({ rev: f.rev }) } });
    }
    if (url.includes('/files/upload')) {
      let path = arg.path; const cur = files.get(path.toLowerCase());
      if (arg.mode === 'add' && cur) {
        if (!arg.autorename) return new Response('{}', { status: 409 });
        let i = 1; while (files.get(path.replace(/(\.\w+)$/, ` (${i})$1`).toLowerCase())) i++; path = path.replace(/(\.\w+)$/, ` (${i})$1`);
      }
      if (arg.mode['.tag'] === 'update' && (!cur || cur.rev !== arg.mode.update)) return new Response('{}', { status: 409 });
      const f = { body: Buffer.from(opt.body), rev: 'r' + (++rev) };
      files.set(path.toLowerCase(), f);
      return new Response(JSON.stringify({ path_display: path, rev: f.rev }));
    }
    return new Response('?', { status: 404 });
  };
  return { files, calls };
}
function setup(extra = {}) {
  _test.resetToken();
  const env = Object.assign({ LIBS: fakeKV(), ADMIN_SECRET: ADMIN, DBX_APP_KEY: 'k', DBX_REFRESH_TOKEN: 'rt', ALLOWED_ORIGINS: ORIGIN,
    DBX_ROOT: '', APP_URL: 'https://mattrailey.github.io/tamarack-library/tamarack-library' }, extra);
  const dbx = fakeDropbox();
  const bg = [], ctx = { waitUntil: p => bg.push(p) };
  const call = async (path, { body, headers = {}, token, admin, origin = ORIGIN, method = 'POST' } = {}) => {
    const h = Object.assign({ Origin: origin }, headers);
    if (token) h.Authorization = 'Bearer ' + token;
    if (admin) h['X-Admin'] = admin;
    const isJson = body && !(body instanceof Uint8Array) && typeof body !== 'string';
    const res = await worker.fetch(new Request('https://friends.example' + path, { method, headers: h, body: isJson ? JSON.stringify(body) : body }), env, ctx);
    await Promise.all(bg.splice(0));
    return res;
  };
  return { env, dbx, call };
}
async function adminInvite(call, lib, extra = {}) { const r = await call('/admin/invite', { admin: ADMIN, body: Object.assign({ lib }, extra) }); assert.equal(r.status, 200); return r.json(); }
async function joinLib(call, code, device = 'Test phone') { const r = await call('/join', { body: { code, device } }); return { status: r.status, j: await r.json() }; }
const catalog = books => JSON.stringify({ format: 'tamarack-library', version: 1, books });

test('admin makes an invite; a phone joins with it and gets the library', async () => {
  const { call } = setup();
  const inv = await adminInvite(call, 'Smith Library', { title: 'The Smiths’ Books' });
  assert.match(inv.code, /^\d{5}$/);
  assert.match(inv.link, /\?join=\d{5}$/);
  const { status, j } = await joinLib(call, inv.code.toLowerCase());
  assert.equal(status, 200); assert.equal(j.lib, 'Smith Library'); assert.equal(j.title, 'The Smiths’ Books'); assert.ok(j.token.length > 30);
});

test('invite codes run out, and a wrong code is refused', async () => {
  const { call } = setup();
  const inv = await adminInvite(call, 'Smith Library', { uses: 2 });
  assert.equal((await joinLib(call, inv.code)).status, 200);
  assert.equal((await joinLib(call, inv.code)).status, 200);
  assert.equal((await joinLib(call, inv.code)).status, 404);
  assert.equal((await joinLib(call, 'ZZZZ-ZZZZ')).status, 404);
  assert.equal((await joinLib(call, '00000')).status === 404 || inv.code === '00000', true);
});

test('husband and wife: "add another phone" gives a one-time code for the same library', async () => {
  const { call } = setup();
  const a = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  const r = await call('/invite', { token: a.token }); assert.equal(r.status, 200);
  const inv = await r.json();
  const b = (await joinLib(call, inv.code, 'Her phone')).j;
  assert.equal(b.lib, 'Smith Library'); assert.notEqual(b.token, a.token);
  assert.equal((await joinLib(call, inv.code)).status, 404);   // used up
  // both phones save to the same catalog, guarded by revision
  let up = await call('/files/upload', { token: a.token, headers: { 'X-Path': '/Smith Library/tamarack-library.json', 'X-Mode': 'add' }, body: catalog([{ id: 'b1' }]) });
  assert.equal(up.status, 200); const rev1 = (await up.json()).rev;
  const dl = await call('/files/download', { token: b.token, headers: { 'X-Path': '/Smith Library/tamarack-library.json' } });
  assert.equal(dl.status, 200); assert.equal(dl.headers.get('X-Rev'), rev1);
  up = await call('/files/upload', { token: b.token, headers: { 'X-Path': '/Smith Library/tamarack-library.json', 'X-Mode': 'update:' + rev1 }, body: catalog([{ id: 'b1' }, { id: 'b2' }]) });
  assert.equal(up.status, 200);
  // the other phone, still holding the old revision, is told to re-merge instead of overwriting
  up = await call('/files/upload', { token: a.token, headers: { 'X-Path': '/Smith Library/tamarack-library.json', 'X-Mode': 'update:' + rev1 }, body: catalog([{ id: 'b1' }]) });
  assert.equal(up.status, 409);
});

test('a device can only reach its own library, and only the allowed files in it', async () => {
  const { call, dbx } = setup();
  const s = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  await joinLib(call, (await adminInvite(call, 'Jones Library')).code);
  const up = (p, body = JPG, mode = 'add') => call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent(p), 'X-Mode': mode }, body });
  assert.equal((await up('/Jones Library/tamarack-library.json', catalog([]))).status, 403);
  assert.equal((await up('/Railey Library/tamarack-library.json', catalog([]))).status, 403);
  assert.equal((await up('/Smith Library/../Jones Library/tamarack-library.json', catalog([]))).status, 400);
  assert.equal((await up('/Smith Library/photos/inbox/../../x.jpg')).status, 400);
  assert.equal((await up('/Smith Library/photos/inbox/sub/x.jpg')).status, 403);
  assert.equal((await up('/Smith Library/secret.txt')).status, 403);
  assert.equal((await up('/Smith Library/tamarack-library.json', 'not json')).status, 400);
  assert.equal((await up('/Smith Library/photos/inbox/2026-10-19 Den N1 shelf-1 shelf 01.jpg')).status, 200);
  assert.equal((await up('/Smith Library/photos/identify/Den N1 shelf-1 pos-3 b1.jpg')).status, 200);
  assert.equal((await up('/Smith Library/covers/b1-abc.jpg')).status, 200);
  // photos can be sent, never read back through the service
  const dl = await call('/files/download', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/photos/inbox/2026-10-19 Den N1 shelf-1 shelf 01.jpg') } });
  assert.equal(dl.status, 403);
  assert.equal([...dbx.files.keys()].every(k => k.startsWith('/smith library/')), true);
});

test('a retried photo is not stored twice', async () => {
  const { call, dbx } = setup();
  const s = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  const p = encodeURIComponent('/Smith Library/photos/inbox/a 01.jpg');
  assert.equal((await call('/files/upload', { token: s.token, headers: { 'X-Path': p, 'X-Mode': 'add' }, body: JPG })).status, 200);
  assert.equal((await call('/files/upload', { token: s.token, headers: { 'X-Path': p, 'X-Mode': 'add' }, body: JPG })).status, 409);
  assert.equal(dbx.files.size, 1);
});

test('files land under DBX_ROOT, and the app sees paths without it', async () => {
  const { call, dbx } = setup({ DBX_ROOT: '/Tamarack Friends' });
  const s = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  const r = await call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/covers/b1.jpg'), 'X-Mode': 'add', 'X-Autorename': '1' }, body: JPG });
  assert.equal((await r.json()).path, '/Smith Library/covers/b1.jpg');
  assert.ok(dbx.files.has('/tamarack friends/smith library/covers/b1.jpg'));
});

test('revoking a phone shuts it out; other phones keep working', async () => {
  const { call } = setup();
  const inv = await adminInvite(call, 'Smith Library', { uses: 2 });
  const a = (await joinLib(call, inv.code, 'Lost phone')).j, b = (await joinLib(call, inv.code)).j;
  const list = await (await call('/admin/list', { admin: ADMIN })).json();
  assert.equal(list.devices.length, 2);
  assert.equal((await (await call('/admin/revoke', { admin: ADMIN, body: { id: a.device } })).json()).revoked, 1);
  assert.equal((await call('/whoami', { token: a.token })).status, 401);
  assert.equal((await call('/whoami', { token: b.token })).status, 200);
});

test('no admin secret, no device key, or a strange website: refused', async () => {
  const { call } = setup();
  assert.equal((await call('/admin/invite', { admin: 'wrong-secret-xxxxxxxx', body: { lib: 'X' } })).status, 401);
  assert.equal((await call('/admin/list', {})).status, 401);
  assert.equal((await call('/whoami', { token: 'nope' })).status, 401);
  assert.equal((await call('/join', { origin: 'https://evil.example', body: { code: 'x' } })).status, 403);
  const pre = await worker.fetch(new Request('https://friends.example/join', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), setup().env, {});
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('library names cannot climb out of their folder', () => {
  assert.equal(_test.cleanLib('../Railey Library'), '.. Railey Library');
  assert.equal(_test.cleanLib('..'), '');
  assert.equal(_test.cleanLib('  Smith   Library '), 'Smith Library');
});

test('switching off a phone also cancels the invite links it made; one open link per phone', async () => {
  const { call } = setup();
  const a = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  const first = await (await call('/invite', { token: a.token })).json();
  const second = await (await call('/invite', { token: a.token })).json();
  assert.equal((await joinLib(call, first.code)).status, 404);          // replaced by the second
  await call('/admin/revoke', { admin: ADMIN, body: { id: a.device } });
  assert.equal((await joinLib(call, second.code)).status, 404);         // cancelled with the phone
});

test('names Dropbox would treat as the same, and odd file names, are refused', async () => {
  const { call } = setup();
  await adminInvite(call, 'Smith Library');
  assert.equal((await call('/admin/invite', { admin: ADMIN, body: { lib: 'smith library' } })).status, 409);
  const s = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  for (const p of ['/Smith Library/covers/x.jpg ', '/Smith Library/covers/x.', '/Smith Library/covers//x.jpg', '/Smith Library/covers/x／..', '/Smith Library/covers/ü.jpg'])
    assert.equal((await call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent(p), 'X-Mode': 'add' }, body: new Uint8Array([1]) })).status, 400, p);
});

test('oversized uploads are refused before being read', async () => {
  const { call } = setup();
  const s = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  const r = await call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/covers/x.jpg'), 'X-Mode': 'add', 'Content-Length': String(16 * 1024 * 1024) }, body: new Uint8Array([1]) });
  assert.equal(r.status, 413);
});

/* ---------- review hardening (2026-10-19) ---------- */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HEIC = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
async function friend(call, lib = 'Smith Library') { return (await joinLib(call, (await adminInvite(call, lib)).code)).j; }
const upAs = (call, s) => (p, body = JPG, extra = {}) => call('/files/upload', { token: s.token, headers: Object.assign({ 'X-Path': encodeURIComponent(p), 'X-Mode': 'add' }, extra), body });

test('"Remove this phone" (/leave): the key stops working and its invite codes are cancelled', async () => {
  const { call } = setup();
  const a = await friend(call);
  const inv = await (await call('/invite', { token: a.token })).json();
  assert.equal((await call('/leave', { token: a.token })).status, 200);
  assert.equal((await call('/whoami', { token: a.token })).status, 401);
  assert.equal((await joinLib(call, inv.code)).status, 404);
});

test('Safari → Home Screen hand-over: the new copy joins with a handoff code and the Safari copy steps aside', async () => {
  const { call } = setup();
  const safari = await friend(call);
  const h = await (await call('/invite', { token: safari.token, body: { handoff: true } })).json();
  const icon = await joinLib(call, h.code, 'iPhone (Home Screen)');
  assert.equal(icon.status, 200); assert.equal(icon.j.lib, 'Smith Library');
  const r = await call('/whoami', { token: safari.token });
  assert.equal(r.status, 401); assert.match((await r.json()).error, /Home Screen/);
  assert.equal((await call('/whoami', { token: icon.j.token })).status, 200);
});

test('a join retried with the same nonce gets the same answer, and the code is not used up twice', async () => {
  const { call } = setup();
  const inv = await adminInvite(call, 'Smith Library', { uses: 1 });
  const once = await (await call('/join', { body: { code: inv.code, device: 'p', nonce: 'nonce-12345678' } })).json();
  const again = await call('/join', { body: { code: inv.code, device: 'p', nonce: 'nonce-12345678' } });
  assert.equal(again.status, 200); assert.equal((await again.json()).token, once.token);
  const other = await call('/join', { body: { code: inv.code, device: 'q', nonce: 'nonce-other999' } });
  assert.equal(other.status, 404); assert.match((await other.json()).error, /new link/);
});

test('only pictures with Windows-safe names, within size caps; NOTE text beside photos only', async () => {
  const { call } = setup();
  const up = upAs(call, await friend(call));
  assert.equal((await up('/Smith Library/photos/inbox/a 01.jpg')).status, 200);
  assert.equal((await up('/Smith Library/photos/inbox/a 02.png', PNG)).status, 200);
  assert.equal((await up('/Smith Library/photos/inbox/a 03.heic', HEIC)).status, 200);
  assert.equal((await up('/Smith Library/photos/inbox/a NOTE.txt', new TextEncoder().encode('left half'))).status, 200);
  assert.equal((await up('/Smith Library/photos/inbox/fake.jpg', new TextEncoder().encode('<html>hello</html>'))).status, 415);
  assert.equal((await up('/Smith Library/photos/inbox/run.exe')).status, 415);
  assert.equal((await up('/Smith Library/covers/note.txt', new TextEncoder().encode('x'))).status, 415);
  for (const bad of ['a:b.jpg', 'a?.jpg', 'a*b.jpg', 'a"b.jpg', 'a<b>.jpg', 'a|b.jpg', 'a(1).jpg'])
    assert.equal((await up('/Smith Library/photos/inbox/' + bad)).status, 400, bad);
  assert.equal((await up('/Smith Library/covers/big.jpg', JPG, { 'Content-Length': String(2 * 1024 * 1024) })).status, 413);
  assert.equal((await up('/Smith Library/photos/inbox/big.jpg', JPG, { 'Content-Length': String(9 * 1024 * 1024) })).status, 413);
  assert.equal(_test.isImage(HEIC), true);
});

test('one catalog snapshot a day, before the first save, in a slot no phone can reach', async () => {
  const { call, dbx } = setup();
  const s = await friend(call);
  const save = (books, rev) => call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/tamarack-library.json'), 'X-Mode': rev ? 'update:' + rev : 'add' }, body: catalog(books) });
  const r1 = await (await save([{ id: 'a', title: 'First' }])).json();
  const r2 = await (await save([{ id: 'a', title: 'Second' }], r1.rev)).json();
  await save([{ id: 'a', title: 'Third' }], r2.rev);
  const backups = [...dbx.files.keys()].filter(k => k.includes('/backups/'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^\/smith library\/backups\/tamarack-library-slot-\d\d\.json$/);
  assert.match(dbx.files.get(backups[0]).body.toString(), /First/);
  const dl = await call('/files/download', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/backups/tamarack-library-slot-00.json') } });
  assert.equal(dl.status, 403);
});

test('PAUSED: phones get a plain 503, admin still works', async () => {
  const { call } = setup({ PAUSED: '1' });
  assert.equal((await call('/admin/list', { admin: ADMIN })).status, 200);
  const r = await call('/join', { body: { code: 'ABCDEFGH' } });
  assert.equal(r.status, 503); assert.match((await r.json()).error, /safe on this phone/);
});

test('JOIN_LIMIT: too many joins from one address are turned away', async () => {
  let n = 0;
  const { call } = setup({ JOIN_LIMIT: { limit: async () => ({ success: ++n <= 2 }) } });
  for (let i = 0; i < 2; i++) assert.equal((await call('/join', { body: { code: 'ZZZZZZZZ' } })).status, 404);
  assert.equal((await call('/join', { body: { code: 'ZZZZZZZZ' } })).status, 429);
});

test('photos arriving: one notice an hour per library, last upload and last seen in the admin list', async () => {
  const { call, dbx } = setup({ NTFY_TOPIC: 'test-topic' });
  const s = await friend(call);
  const up = upAs(call, s);
  await up('/Smith Library/photos/inbox/a 01.jpg'); await up('/Smith Library/photos/inbox/a 02.jpg');
  assert.equal(dbx.calls.filter(u => String(u).startsWith('https://ntfy.sh/test-topic')).length, 1);
  const list = await (await call('/admin/list', { admin: ADMIN })).json();
  assert.ok(list.libs.find(l => l.lib === 'Smith Library').lastUpload);
  assert.ok(list.devices[0].seen);
});

test('a Dropbox sign-in failure tells Matt once and gives phones a 502', async () => {
  const { call, dbx } = setup({ NTFY_TOPIC: 'test-topic' });
  const s = await friend(call);
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, opt) => { if (String(url).includes('oauth2/token')) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }); return fake(url, opt); };
  _test.resetToken();
  assert.equal((await upAs(call, s)('/Smith Library/photos/inbox/x 01.jpg')).status, 502);
  await upAs(call, s)('/Smith Library/photos/inbox/x 02.jpg');
  assert.equal(dbx.calls.filter(u => String(u).startsWith('https://ntfy.sh/')).length, 1);
});

test('5-digit codes: typed with spaces works; lots of wrong codes from anywhere close joining for a while', async () => {
  let n = 0;
  const { call, env } = setup({ NTFY_TOPIC: 't', JOIN_FAIL: { limit: async () => ({ success: ++n <= 3 }) } });
  const inv = await adminInvite(call, 'Smith Library');
  assert.match(inv.code, /^\d{5}$/);
  assert.equal((await joinLib(call, inv.code.slice(0, 2) + ' ' + inv.code.slice(2))).status, 200);
  const wrong = String((+inv.code + 1) % 100000).padStart(5, '0');
  for (let i = 0; i < 4; i++) await joinLib(call, wrong);
  const r = await joinLib(call, inv.code);
  assert.equal(r.status, 429); assert.match(r.j.error, /Wait 10 minutes/);
  assert.ok(await env.LIBS.get('joinlock'));
});

test('an older 8-letter code still works', async () => {
  const { call, env } = setup();
  await env.LIBS.put('code:ABCDEFGH', JSON.stringify({ lib: 'Old Library', title: 'Old', uses: 1, exp: Date.now() + 864e5 }));
  const r = await joinLib(call, 'abcd-efgh');
  assert.equal(r.status, 200); assert.equal(r.j.lib, 'Old Library');
});

test('Edit name: new title in the list, open codes and the catalog the phones read', async () => {
  const { call, dbx } = setup();
  const s = await friend(call);
  await call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/tamarack-library.json'), 'X-Mode': 'add' }, body: catalog([{ id: 'a', title: 'A' }]) });
  const r = await call('/admin/rename', { admin: ADMIN, body: { lib: 'Smith Library', title: 'Smith Family Books' } });
  assert.equal(r.status, 200);
  const cat = JSON.parse(dbx.files.get('/smith library/tamarack-library.json').body.toString());
  assert.equal(cat.settings.library.title, 'Smith Family Books'); assert.equal(cat.books.length, 1);
  const list = await (await call('/admin/list', { admin: ADMIN })).json();
  assert.equal(list.libs.find(l => l.lib === 'Smith Library').title, 'Smith Family Books');
  assert.equal((await call('/admin/rename', { admin: ADMIN, body: { lib: 'Nobody', title: 'x' } })).status, 404);
  assert.equal((await call('/admin/rename', { body: { lib: 'Smith Library', title: 'x' } })).status, 401);
});

test('Remove library: phones off, codes gone, out of the list, folder moved to _removed (not deleted)', async () => {
  const { call, dbx } = setup();
  const s = await friend(call);
  const keep = await friend(call, 'Jones Library');
  await upAs(call, s)('/Smith Library/photos/inbox/a 01.jpg');
  await call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/tamarack-library.json'), 'X-Mode': 'add' }, body: catalog([{ id: 'a', title: 'A' }]) });
  await adminInvite(call, 'Smith Library');
  const r = await (await call('/admin/remove', { admin: ADMIN, body: { lib: 'Smith Library' } })).json();
  assert.equal(r.phones, 1); assert.ok(r.codes >= 1); assert.match(r.movedTo, /^\/_removed\/Smith Library \d{4}-\d\d-\d\d$/);
  assert.equal((await call('/whoami', { token: s.token })).status, 401);
  assert.equal((await call('/whoami', { token: keep.token })).status, 200);
  const list = await (await call('/admin/list', { admin: ADMIN })).json();
  assert.equal(list.libs.some(l => l.lib === 'Smith Library'), false);
  assert.equal([...dbx.files.keys()].some(k => k.startsWith('/smith library/')), false);
  assert.ok([...dbx.files.keys()].some(k => k.startsWith('/_removed/smith library ') && k.endsWith('/tamarack-library.json')));
  assert.equal((await call('/admin/remove', { admin: ADMIN, body: { lib: 'Smith Library' } })).status, 404);
});
