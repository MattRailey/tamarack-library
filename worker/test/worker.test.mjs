// Friends service tests: node --test worker/test   (no Cloudflare or Dropbox needed — both are faked here)
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _test } from '../src/index.js';

const ADMIN = 'admin-secret-0123456789';
const ORIGIN = 'https://mattrailey.github.io';

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
  const call = async (path, { body, headers = {}, token, admin, origin = ORIGIN, method = 'POST' } = {}) => {
    const h = Object.assign({ Origin: origin }, headers);
    if (token) h.Authorization = 'Bearer ' + token;
    if (admin) h['X-Admin'] = admin;
    const isJson = body && !(body instanceof Uint8Array) && typeof body !== 'string';
    const res = await worker.fetch(new Request('https://friends.example' + path, { method, headers: h, body: isJson ? JSON.stringify(body) : body }), env, {});
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
  assert.match(inv.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(inv.link, /\?join=[A-Z2-9]{8}$/);
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
  const up = (p, body = new Uint8Array([1, 2, 3]), mode = 'add') => call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent(p), 'X-Mode': mode }, body });
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
  assert.equal((await call('/files/upload', { token: s.token, headers: { 'X-Path': p, 'X-Mode': 'add' }, body: new Uint8Array([1]) })).status, 200);
  assert.equal((await call('/files/upload', { token: s.token, headers: { 'X-Path': p, 'X-Mode': 'add' }, body: new Uint8Array([1]) })).status, 409);
  assert.equal(dbx.files.size, 1);
});

test('files land under DBX_ROOT, and the app sees paths without it', async () => {
  const { call, dbx } = setup({ DBX_ROOT: '/Tamarack Friends' });
  const s = (await joinLib(call, (await adminInvite(call, 'Smith Library')).code)).j;
  const r = await call('/files/upload', { token: s.token, headers: { 'X-Path': encodeURIComponent('/Smith Library/covers/b1.jpg'), 'X-Mode': 'add', 'X-Autorename': '1' }, body: new Uint8Array([1]) });
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
