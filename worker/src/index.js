/* Tamarack Library — friends service (Cloudflare Worker)

   Lets friends keep their library in Matt's Dropbox without a Dropbox account of their own.
   The Worker holds the only Dropbox sign-in. Each phone gets its own device key, and a device key
   opens exactly one library folder — nothing above it, nothing beside it.

   Storage (Cloudflare KV, binding LIBS):
     code:<CODE>   → { lib, title, uses, by }       join code (invite from Matt, or "add another phone"); expires on its own
     dev:<sha256>  → { id, lib, name, at }          a device; only the hash of its key is stored

   Secrets / vars (wrangler.toml and `wrangler secret put`):
     DBX_APP_KEY, DBX_REFRESH_TOKEN   the Dropbox app and Matt's sign-in for it (use an "App folder" app)
     ADMIN_SECRET                     for Matt's admin commands (worker/admin.mjs)
     ALLOWED_ORIGINS                  comma list, e.g. https://mattrailey.github.io
     DBX_ROOT                         folder that holds all friend libraries ('' = the app folder itself)
     APP_URL                          the app's address, used to build join links

   Endpoints (all POST):
     /join                 { code, device }            → { token, lib, title, device }
     /files/download       X-Path                      → file bytes, X-Rev header        (catalog, covers/)
     /files/upload         X-Path, X-Mode, X-Autorename, body → { path, rev }            (catalog, covers/, photos/…)
     /invite               (device)                    → { code, link, expires }         "add another phone"
     /whoami               (device)                    → { lib, name, id }
     /admin/invite         { lib, title, uses, days }  → { code, link }
     /admin/list                                       → { devices, codes }
     /admin/revoke         { id }                      → { revoked }
*/

const CATALOG = 'tamarack-library.json';
const UPLOAD_DIRS = ['photos/inbox/', 'photos/identify/', 'covers/'];
const DOWNLOAD_DIRS = ['covers/'];
const MAX_PHOTO = 15 * 1024 * 1024;     // one photo
const MAX_CATALOG = 25 * 1024 * 1024;   // the catalog JSON
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (origin && !cors) return json({ error: 'origin not allowed' }, 403);
    try {
      const res = await route(req, env);
      for (const [k, v] of Object.entries(cors || {})) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      const res = json({ error: e.message || 'error' }, status);
      for (const [k, v] of Object.entries(cors || {})) res.headers.set(k, v);
      return res;
    }
  },
};

async function route(req, env) {
  const p = new URL(req.url).pathname.replace(/\/+$/, '');
  if (req.method !== 'POST') throw err(405, 'POST only');
  if (p === '/join') return join(req, env);
  if (p.startsWith('/admin/')) { await adminAuth(req, env); return admin(p, req, env); }
  const dev = await deviceAuth(req, env);
  if (p === '/whoami') return json({ lib: dev.lib, name: dev.name, id: dev.id });
  if (p === '/invite') return invite(env, dev.lib, (await libTitle(env, dev.lib)), 1, 14, dev.id);
  if (p === '/files/download') return download(req, env, dev);
  if (p === '/files/upload') return upload(req, env, dev);
  throw err(404, 'not found');
}

/* ---------------- devices and codes ---------------- */
async function join(req, env) {
  const body = await req.json().catch(() => ({}));
  const code = normCode(body.code);
  if (!code) throw err(400, 'Type the invite code');
  const rec = await kvGet(env, 'code:' + code);
  if (!rec) throw err(404, 'That code didn’t work. Check it, or ask for a new one.');
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = 'd' + b64url(crypto.getRandomValues(new Uint8Array(6)));
  const name = String(body.device || 'Phone').slice(0, 60);
  await env.LIBS.put('dev:' + await sha256(token), JSON.stringify({ id, lib: rec.lib, name, at: Date.now() }));
  const uses = (rec.uses || 1) - 1;
  if (uses > 0) await env.LIBS.put('code:' + code, JSON.stringify(Object.assign({}, rec, { uses })), rec.exp ? { expiration: Math.floor(rec.exp / 1000) } : {});
  else await env.LIBS.delete('code:' + code);
  return json({ token, lib: rec.lib, title: rec.title || rec.lib, device: id });
}
async function invite(env, lib, title, uses, days, by) {
  let code;
  for (let i = 0; i < 5; i++) { code = makeCode(); if (!(await env.LIBS.get('code:' + code))) break; }
  const exp = Date.now() + days * 864e5;
  await env.LIBS.put('code:' + code, JSON.stringify({ lib, title, uses, by, exp }), { expiration: Math.floor(exp / 1000) });
  const link = (env.APP_URL || '') + '?join=' + code;
  return json({ code: fmtCode(code), link, expires: exp });
}
async function libTitle(env, lib) { const v = await kvGet(env, 'lib:' + lib); return (v && v.title) || lib; }
async function deviceAuth(req, env) {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw err(401, 'no device key');
  const dev = await kvGet(env, 'dev:' + await sha256(token));
  if (!dev) throw err(401, 'This phone was disconnected from the library. Ask for a new invite.');
  return dev;
}
async function adminAuth(req, env) {
  const s = req.headers.get('X-Admin') || '';
  if (!env.ADMIN_SECRET || s.length < 16 || !(await safeEqual(s, env.ADMIN_SECRET))) throw err(401, 'not allowed');
}
async function admin(p, req, env) {
  const body = await req.json().catch(() => ({}));
  if (p === '/admin/invite') {
    const lib = cleanLib(body.lib);
    if (!lib) throw err(400, 'lib name needed, e.g. "Smith Library"');
    const title = String(body.title || lib).slice(0, 80);
    if (!(await env.LIBS.get('lib:' + lib))) await env.LIBS.put('lib:' + lib, JSON.stringify({ title, at: Date.now() }));
    return invite(env, lib, title, Math.max(1, Math.min(10, +body.uses || 2)), Math.max(1, Math.min(90, +body.days || 30)), 'admin');
  }
  if (p === '/admin/list') {
    const devices = [], codes = [];
    for (const prefix of ['dev:', 'code:']) {
      let cursor;
      do {
        const r = await env.LIBS.list({ prefix, cursor });
        for (const k of r.keys) {
          const v = await kvGet(env, k.name); if (!v) continue;
          if (prefix === 'dev:') devices.push(v); else codes.push(Object.assign({ code: fmtCode(k.name.slice(5)) }, v));
        }
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
    }
    return json({ devices, codes });
  }
  if (p === '/admin/revoke') {
    let cursor, n = 0;
    do {
      const r = await env.LIBS.list({ prefix: 'dev:', cursor });
      for (const k of r.keys) { const v = await kvGet(env, k.name); if (v && (v.id === body.id || (body.lib && v.lib === body.lib))) { await env.LIBS.delete(k.name); n++; } }
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    return json({ revoked: n });
  }
  throw err(404, 'not found');
}

/* ---------------- files ---------------- */
// The app sends paths as "/<library>/<rest>". The library must be this device's; <rest> must be an allowed file.
function checkPath(env, raw, dev, dirs, allowCatalog) {
  let path;
  try { path = decodeURIComponent(String(raw || '')); } catch (e) { throw err(400, 'bad path'); }
  const pre = '/' + dev.lib + '/';
  if (!path.startsWith(pre)) throw err(403, 'not your library');
  const rest = path.slice(pre.length);
  if (!rest || rest.length > 200 || /(^|\/)\.\.?(\/|$)/.test(rest) || /[\x00-\x1f\\]/.test(rest)) throw err(400, 'bad path');
  const ok = (allowCatalog && rest === CATALOG) || dirs.some(d => rest.startsWith(d) && rest.length > d.length && !rest.slice(d.length).includes('/'));
  if (!ok) throw err(403, 'that file is off-limits');
  return { path, real: root(env) + path, rest };
}
function root(env) { const r = String((env && env.DBX_ROOT) || '').replace(/\/+$/, ''); return r && !r.startsWith('/') ? '/' + r : r; }

async function download(req, env, dev) {
  const { real, path } = checkPath(env, req.headers.get('X-Path'), dev, DOWNLOAD_DIRS, true);
  const r = await dbx(env, 'https://content.dropboxapi.com/2/files/download', { 'Dropbox-API-Arg': dbxArg({ path: real }) });
  if (r.status === 409) return json({ error: 'not found', path }, 404);
  if (!r.ok) throw err(502, 'Dropbox download failed (' + r.status + ')');
  let rev = null; try { rev = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}').rev || null; } catch (e) {}
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'X-Rev': rev || '', 'Access-Control-Expose-Headers': 'X-Rev' } });
}
async function upload(req, env, dev) {
  const { real, rest } = checkPath(env, req.headers.get('X-Path'), dev, UPLOAD_DIRS, true);
  const isCatalog = rest === CATALOG;
  const len = +(req.headers.get('Content-Length') || 0);
  const body = await req.arrayBuffer();
  const size = body.byteLength || len;
  if (size > (isCatalog ? MAX_CATALOG : MAX_PHOTO)) throw err(413, 'file too large');
  if (isCatalog) {
    try { const s = JSON.parse(new TextDecoder().decode(body)); if (!s || !Array.isArray(s.books)) throw 0; }
    catch (e) { throw err(400, 'not a library file'); }
  }
  // mode: "add" (fail if it exists) or "update:<rev>" (fail if someone saved in between). Never a blind overwrite.
  const m = String(req.headers.get('X-Mode') || 'add');
  const mode = m.startsWith('update:') ? { '.tag': 'update', update: m.slice(7) } : 'add';
  const autorename = !isCatalog && req.headers.get('X-Autorename') === '1';
  const r = await dbx(env, 'https://content.dropboxapi.com/2/files/upload',
    { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path: real, mode, autorename, mute: true }) }, body);
  if (r.status === 409) return json({ error: 'conflict' }, 409);
  if (!r.ok) throw err(502, 'Dropbox upload failed (' + r.status + ')');
  const j = await r.json();
  const shown = String(j.path_display || real);
  const rt = root(env);
  return json({ path: rt && shown.toLowerCase().startsWith(rt.toLowerCase() + '/') ? shown.slice(rt.length) : shown, rev: j.rev || null });
}

/* ---------------- Dropbox sign-in (Matt's, kept here only) ---------------- */
let _tok = null;   // { access, exp } — lives as long as this Worker instance
async function dbxAccess(env, force) {
  if (!force && _tok && _tok.exp - 60000 > Date.now()) return _tok.access;
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.DBX_REFRESH_TOKEN, client_id: env.DBX_APP_KEY }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw err(502, 'Dropbox sign-in on the server failed');
  _tok = { access: j.access_token, exp: Date.now() + (j.expires_in || 14400) * 1000 };
  return _tok.access;
}
async function dbx(env, url, headers, body) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ Authorization: 'Bearer ' + await dbxAccess(env, i > 0) }, headers), body });
    if (r.status !== 401) return r;
  }
  throw err(502, 'Dropbox refused the server sign-in');
}

/* ---------------- helpers ---------------- */
function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin) return {};
  const local = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) && env.ALLOW_LOCALHOST === '1';
  if (!allowed.includes(origin) && !local) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Path, X-Mode, X-Autorename, X-Admin',
    'Access-Control-Expose-Headers': 'X-Rev', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } }); }
function err(status, message) { const e = new Error(message); e.status = status; return e; }
async function kvGet(env, k) { const v = await env.LIBS.get(k); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sha256(s) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
async function safeEqual(a, b) { return (await sha256(a)) === (await sha256(b)); }
function makeCode() { const r = crypto.getRandomValues(new Uint8Array(8)); return [...r].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join(''); }
// typed codes: ignore case, spaces and dashes (codes never use the look-alikes 0, O, 1, I or L)
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }
function fmtCode(c) { return c.slice(0, 4) + '-' + c.slice(4); }
function cleanLib(s) { const v = String(s || '').replace(/[\\/\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); return v && v !== '.' && v !== '..' ? v : ''; }
function dbxArg(o) { return JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)); }

export const _test = { checkPath, normCode, cleanLib, resetToken: () => { _tok = null; } };
