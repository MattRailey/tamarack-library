/* Tamarack Library — friends service (Cloudflare Worker)

   Lets friends keep their library in Matt's Dropbox without a Dropbox account of their own.
   The Worker holds the only Dropbox sign-in. Each phone gets its own device key, and a device key
   opens exactly one library folder — nothing above it, nothing beside it.

   Storage (Cloudflare KV, binding LIBS):
     code:<CODE>   → { lib, title, uses, by, exp, handoff? }  join code (invite from Matt, "add another phone", or the
                                                    Safari → Home Screen hand-over); expires on its own
     dev:<sha256>  → { id, lib, name, at, seen?, moved? }    a device; only the hash of its key is stored
     inv:<device>  → code                           that phone's one open "add another phone" code
     lib:<name>    → { title, at, lastUpload? }     a library
     jn:<nonce>    → { code, res }                  a join answered in the last 10 minutes (a retry gets the same answer)
     snap:<lib>    → YYYY-MM-DD                     the day of the last catalog snapshot
     note:<lib|signin> (1 h)                        a notice was sent: at most one an hour

   Secrets / vars (wrangler.toml and `wrangler secret put`):
     DBX_APP_KEY, DBX_REFRESH_TOKEN   the Dropbox app and Matt's sign-in for it (use an "App folder" app)
     ADMIN_SECRET                     for Matt's admin commands (worker/admin.mjs)
     ALLOWED_ORIGINS                  comma list, e.g. https://mattrailey.github.io
     DBX_ROOT                         folder that holds all friend libraries ('' = the app folder itself)
     APP_URL                          the app's address, used to build join links
     PAUSED                           "1" = everything but /admin/* answers 503 (maintenance, or to stop the service)
     NTFY_TOPIC (secret, optional)    ntfy.sh topic: a phone notice when photos arrive (≤ 1 an hour per library)
                                      and when the Dropbox sign-in fails
     JOIN_LIMIT (binding, optional)   Cloudflare rate limiter for /join (wrangler.toml [[ratelimits]])

   Endpoints (all POST):
     /join                 { code, device }            → { token, lib, title, device }
     /files/download       X-Path                      → file bytes, X-Rev header        (catalog, recipes.json, covers/, recipes/)
     /files/upload         X-Path, X-Mode, X-Autorename, body → { path, rev }            (catalog, recipes.json, covers/, photos/…)
     /recipe/fetch         { url }  (device key optional; the app's own web address only)  → { recipe } | { none }
                                                   reads the recipe a web page carries for search engines (schema.org Recipe, JSON-LD)
     FETCH_LIMIT, FETCH_ALL (bindings, optional)  rate limiters for /recipe/fetch: per address, and in all
     /invite               (device) { handoff? }       → { code, link, expires }         "add another phone"; handoff:
                                                         the Home Screen app takes this phone's place when it joins
     /leave                (device)                    → { left }                        "Remove this phone"
     /whoami               (device)                    → { lib, name, id }
     /admin/invite         { lib, title, uses, days }  → { code, link }
     /admin/list                                       → { devices, codes, libs }
     /admin/revoke         { id } | { lib }            → { revoked, codes }
     /admin/rename         { lib, title }              → { title }      the name shown (not the folder)
     /admin/remove         { lib }                     → { removed, phones, codes, movedTo }   folder → _removed/
*/

const CATALOG = 'tamarack-library.json';
const RECIPES = 'recipes.json';         // the library's recipes: private to the library, like its catalog
const UPLOAD_DIRS = ['photos/inbox/', 'photos/identify/', 'covers/'];
const DOWNLOAD_DIRS = ['covers/', 'recipes/'];   // recipes/: the original card / page photos (Claude puts them there)
const MAX_PHOTO = 8 * 1024 * 1024;      // one photo (the app sends 3600 px JPEGs, about 2-4 MB)
const MAX_COVER = 1.5 * 1024 * 1024;    // one cover photo
const MAX_NOTE = 64 * 1024;             // a NOTE.txt beside photos
const MAX_CATALOG = 25 * 1024 * 1024;   // the catalog JSON
// file names: letters, digits, space, _ . - only (they sync to a Windows PC); images by extension AND by their first bytes
const NAME_RE = /^[A-Za-z0-9 _.-]+$/;
const IMAGE_EXT = /\.(jpe?g|png|heic)$/i;
const BACKUP_SLOTS = 14;
// Codes are 5 digits (Matt, 2026-10-19: easy to type). Only 100,000 of them, so guessing is held back three ways: they
// expire, one address gets 10 tries a minute (JOIN_LIMIT), and more than 30 wrong codes a minute from anywhere
// (JOIN_FAIL) closes joining for 10 minutes and tells Matt. Older 8-letter codes still work until they expire.
const CODE_DIGITS = 5;
const LOCK_MINUTES = 10;

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (origin && !cors) return json({ error: 'origin not allowed' }, 403);
    try {
      // maintenance switch: the books stay on the phones; only Matt's admin commands work
      if (env.PAUSED === '1' && !new URL(req.url).pathname.startsWith('/admin/'))
        throw err(503, 'The library service is paused for a little while. Your books are safe on this phone.');
      const res = await route(req, env, ctx || { waitUntil() {} });
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

async function route(req, env, ctx) {
  const p = new URL(req.url).pathname.replace(/\/+$/, '');
  if (req.method !== 'POST') throw err(405, 'POST only');
  if (p === '/join') {
    if (env.JOIN_LIMIT) {   // junk traffic can't burn the free plan's daily requests
      const { success } = await env.JOIN_LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') || 'none' });
      if (!success) throw err(429, 'Too many tries. Wait a minute and try again.');
    }
    return join(req, env);
  }
  if (p.startsWith('/admin/')) { await adminAuth(req, env); return admin(p, req, env); }
  if (p === '/recipe/fetch') return recipeFetch(req, env);
  const dev = await deviceAuth(req, env, ctx);
  if (p === '/whoami') return json({ lib: dev.lib, name: dev.name, id: dev.id });
  if (p === '/invite') {   // one open "add another phone" code per phone: a new one replaces the last
    const body = await req.json().catch(() => ({}));
    const prev = await env.LIBS.get('inv:' + dev.id); if (prev) await env.LIBS.delete('code:' + prev);
    const res = await invite(env, dev.lib, (await libTitle(env, dev.lib)), 1, body.handoff ? 2 : 14, dev.id, !!body.handoff);
    const j = await res.clone().json(); await env.LIBS.put('inv:' + dev.id, j.code.replace('-', ''), { expirationTtl: 14 * 86400 });
    return res;
  }
  if (p === '/leave') return leave(req, env, dev);
  if (p === '/files/download') return download(req, env, dev);
  if (p === '/files/upload') return upload(req, env, dev, ctx);
  throw err(404, 'not found');
}

/* ---------------- devices and codes ---------------- */
async function join(req, env) {
  const body = await req.json().catch(() => ({}));
  const code = normCode(body.code);
  if (!code) throw err(400, 'Type the invite code');
  // the same join tried again (the answer got lost on a weak signal): same answer, the code isn't used twice
  const nonce = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.nonce || '')) ? String(body.nonce) : '';
  if (nonce) { const done = await kvGet(env, 'jn:' + nonce); if (done && done.code === code) return json(done.res); }
  if (await env.LIBS.get('joinlock')) throw err(429, 'Too many wrong codes were tried just now. Wait 10 minutes and try again.');
  const rec = await kvGet(env, 'code:' + code);
  if (!rec || (rec.exp && rec.exp < Date.now())) {
    if (env.JOIN_FAIL) {
      const { success } = await env.JOIN_FAIL.limit({ key: 'all' });
      if (!success) {
        await env.LIBS.put('joinlock', '1', { expirationTtl: LOCK_MINUTES * 60 });
        await notify(env, 'Library service: joining paused', 'Lots of wrong invite codes were tried, so joining is closed for ' + LOCK_MINUTES + ' minutes. If it keeps happening, set PAUSED = "1" and redeploy.');
      }
    }
    throw err(404, 'That code didn’t work. Check it, or ask for a new link.');
  }
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = 'd' + b64url(crypto.getRandomValues(new Uint8Array(6)));
  const name = String(body.device || 'Phone').slice(0, 60);
  await env.LIBS.put('dev:' + await sha256(token), JSON.stringify({ id, lib: rec.lib, name, at: Date.now() }));
  const uses = (rec.uses || 1) - 1;
  if (uses > 0) await env.LIBS.put('code:' + code, JSON.stringify(Object.assign({}, rec, { uses })), rec.exp ? { expiration: Math.floor(rec.exp / 1000) } : {});
  else await env.LIBS.delete('code:' + code);
  // the hand-over from Safari to the Home Screen app: the Safari copy steps aside (kept, marked moved)
  if (rec.handoff && rec.by) await markMoved(env, rec.by);
  const res = { token, lib: rec.lib, title: rec.title || rec.lib, device: id };
  if (nonce) await env.LIBS.put('jn:' + nonce, JSON.stringify({ code, res }), { expirationTtl: 600 });
  return json(res);
}
async function eachKey(env, prefix, fn) {
  let cursor;
  do {
    const r = await env.LIBS.list({ prefix, cursor });
    for (const k of r.keys) { const v = await kvGet(env, k.name); if (v) await fn(k.name, v); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
}
async function markMoved(env, id) {
  await eachKey(env, 'dev:', async (k, v) => { if (v.id === id) await env.LIBS.put(k, JSON.stringify(Object.assign({}, v, { moved: Date.now() }))); });
}
// "Remove this phone": its key stops working, and so do the invite codes it made
async function leave(req, env, dev) {
  await env.LIBS.delete(dev.key);
  const inv = await env.LIBS.get('inv:' + dev.id); if (inv) await env.LIBS.delete('code:' + inv);
  await env.LIBS.delete('inv:' + dev.id);
  await eachKey(env, 'code:', async (k, v) => { if (v.by === dev.id) await env.LIBS.delete(k); });
  return json({ left: true });
}
async function invite(env, lib, title, uses, days, by, handoff) {
  let code;
  for (let i = 0; i < 5; i++) { code = makeCode(); if (!(await env.LIBS.get('code:' + code))) break; }
  const exp = Date.now() + days * 864e5;
  await env.LIBS.put('code:' + code, JSON.stringify(Object.assign({ lib, title, uses, by, exp }, handoff ? { handoff: true } : {})), { expiration: Math.floor(exp / 1000) });
  const link = (env.APP_URL || '') + '?join=' + code;
  return json({ code: fmtCode(code), link, expires: exp });
}
async function libTitle(env, lib) { const v = await kvGet(env, 'lib:' + lib); return (v && v.title) || lib; }
async function deviceAuth(req, env, ctx) {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw err(401, 'no device key');
  const key = 'dev:' + await sha256(token);
  const dev = await kvGet(env, key);
  if (!dev) throw err(401, 'This phone was disconnected from the library. Ask for a new invite.');
  if (dev.moved) throw err(401, 'This library now opens from its icon on your Home Screen.');
  // last seen, written at most once a day per phone (KV's free plan allows 1,000 writes a day)
  if (!dev.seen || Date.now() - dev.seen > 864e5) {
    const upd = env.LIBS.put(key, JSON.stringify(Object.assign({}, dev, { seen: Date.now() })));
    if (ctx && ctx.waitUntil) ctx.waitUntil(upd); else await upd;
  }
  return Object.assign({ key }, dev);
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
    // Dropbox folder names ignore case: "smith library" and "Smith Library" would be the same folder
    const fold = x => x.normalize('NFC').toLowerCase();
    const same = (await env.LIBS.list({ prefix: 'lib:' })).keys.map(k => k.name.slice(4)).find(n => n !== lib && fold(n) === fold(lib));
    if (same) throw err(409, 'A library named "' + same + '" already exists — use exactly that name');
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
    const libs = []; await eachKey(env, 'lib:', async (k, v) => libs.push(Object.assign({ lib: k.slice(4) }, v)));
    return json({ devices, codes, libs });
  }
  if (p === '/admin/revoke') {
    let cursor, n = 0;
    do {
      const r = await env.LIBS.list({ prefix: 'dev:', cursor });
      for (const k of r.keys) { const v = await kvGet(env, k.name); if (v && (v.id === body.id || (body.lib && v.lib === body.lib))) { await env.LIBS.delete(k.name); n++; } }
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    // and any invite codes that phone (or that library) handed out, so a lost phone can't let itself back in
    let codes = 0; cursor = undefined;
    do {
      const r = await env.LIBS.list({ prefix: 'code:', cursor });
      for (const k of r.keys) { const v = await kvGet(env, k.name); if (v && ((body.id && v.by === body.id) || (body.lib && v.lib === body.lib))) { await env.LIBS.delete(k.name); codes++; } }
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    if (body.id) await env.LIBS.delete('inv:' + body.id);
    return json({ revoked: n, codes });
  }
  if (p === '/admin/rename') {
    const lib = cleanLib(body.lib), title = String(body.title || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 80);
    if (!lib || !title) throw err(400, 'library and new name needed');
    const L = await kvGet(env, 'lib:' + lib); if (!L) throw err(404, 'No library named "' + lib + '"');
    await env.LIBS.put('lib:' + lib, JSON.stringify(Object.assign({}, L, { title })));
    await eachKey(env, 'code:', async (k, v) => { if (v.lib === lib) await env.LIBS.put(k, JSON.stringify(Object.assign({}, v, { title })), v.exp ? { expiration: Math.floor(v.exp / 1000) } : {}); });
    // the name the phones show lives in the catalog: change it there (rev-guarded, merged by the phones like any edit)
    await setCatalogTitle(env, lib, title);
    return json({ title });
  }
  if (p === '/admin/remove') {
    const lib = cleanLib(body.lib);
    if (!lib || !(await env.LIBS.get('lib:' + lib))) throw err(404, 'No library named "' + lib + '"');
    let phones = 0, codes = 0;
    await eachKey(env, 'dev:', async (k, v) => { if (v.lib === lib) { await env.LIBS.delete(k); await env.LIBS.delete('inv:' + v.id); phones++; } });
    await eachKey(env, 'code:', async (k, v) => { if (v.lib === lib) { await env.LIBS.delete(k); codes++; } });
    for (const k of ['lib:', 'snap:', 'note:']) await env.LIBS.delete(k + lib);
    // never deleted: the folder moves to _removed/ (move it back to undo; delete it in Dropbox to remove it for good)
    const to = root(env) + '/_removed/' + lib + ' ' + new Date().toISOString().slice(0, 10);
    const r = await dbx(env, 'https://api.dropboxapi.com/2/files/move_v2', { 'Content-Type': 'application/json' },
      JSON.stringify({ from_path: root(env) + '/' + lib, to_path: to, autorename: true }));
    let movedTo = null;
    if (r.ok) { const j = await r.json().catch(() => ({})); movedTo = ((j.metadata || {}).path_display) || to; }
    else if (r.status !== 409) throw err(502, 'The phones are switched off, but Dropbox didn’t move the folder (' + r.status + '). Move it by hand.');
    return json({ removed: lib, phones, codes, movedTo });
  }
  throw err(404, 'not found');
}
async function setCatalogTitle(env, lib, title) {
  const path = root(env) + '/' + lib + '/' + CATALOG;
  for (let i = 0; i < 3; i++) {
    const r = await dbx(env, 'https://content.dropboxapi.com/2/files/download', { 'Dropbox-API-Arg': dbxArg({ path }) });
    if (!r.ok) return;   // no catalog yet: the first phone's sync uses the new title from the invite
    let rev = null; try { rev = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}').rev; } catch (e) {}
    let s; try { s = JSON.parse(await r.text()); } catch (e) { return; }
    if (!s || !Array.isArray(s.books)) return;
    const now = Date.now();
    s.settings = Object.assign({}, s.settings, { library: Object.assign({}, (s.settings || {}).library, { title }), updatedAt: now });
    s.updatedAt = now;
    const u = await dbx(env, 'https://content.dropboxapi.com/2/files/upload',
      { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path, mode: { '.tag': 'update', update: rev }, autorename: false, mute: true }) }, JSON.stringify(s, null, 2));
    if (u.ok || u.status !== 409) return;   // 409: a phone saved in between; read it again
  }
}

/* ---------------- files ---------------- */
// The app sends paths as "/<library>/<rest>". The library must be this device's; <rest> must be an allowed file.
function checkPath(env, raw, dev, dirs, allowCatalog) {
  let path;
  try { path = decodeURIComponent(String(raw || '')); } catch (e) { throw err(400, 'bad path'); }
  const pre = '/' + dev.lib + '/';
  if (!path.startsWith(pre)) throw err(403, 'not your library');
  const rest = path.slice(pre.length);
  // plain printable ASCII only, and no name part that is "." / ".." or ends in a dot or space (Windows/Dropbox trim those)
  if (!rest || rest.length > 200 || !/^[\x20-\x7e]+$/.test(rest) || /\\/.test(rest) || rest.split('/').some(seg => !seg || /[. ]$/.test(seg))) throw err(400, 'bad path');
  if (allowCatalog && rest === CATALOG) return { path, real: root(env) + path, rest, kind: 'catalog' };
  if (allowCatalog && rest === RECIPES) return { path, real: root(env) + path, rest, kind: 'recipes' };
  const dir = dirs.find(d => rest.startsWith(d) && rest.length > d.length && !rest.slice(d.length).includes('/'));
  if (!dir) throw err(403, 'that file is off-limits');
  const name = rest.slice(dir.length);
  // names that sync to Windows, and only pictures (plus a NOTE .txt beside photos)
  if (!NAME_RE.test(name)) throw err(400, 'bad file name');
  const photoDir = dir.startsWith('photos/');
  const kind = IMAGE_EXT.test(name) ? (photoDir ? 'photo' : 'cover') : (photoDir && /\.txt$/i.test(name) ? 'note' : '');
  if (!kind) throw err(415, 'Only photos can be sent here');
  return { path, real: root(env) + path, rest, kind };
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
async function upload(req, env, dev, ctx) {
  const { real, rest, kind } = checkPath(env, req.headers.get('X-Path'), dev, UPLOAD_DIRS, true);
  const isCatalog = kind === 'catalog' || kind === 'recipes';
  const limit = { catalog: MAX_CATALOG, recipes: MAX_CATALOG, photo: MAX_PHOTO, cover: MAX_COVER, note: MAX_NOTE }[kind];
  if (+(req.headers.get('Content-Length') || 0) > limit) throw err(413, 'That file is too big to send.');   // refuse before reading it
  if (!isCatalog && !allowUpload(dev.lib)) throw err(429, 'Too many photos today. Try again tomorrow, or ask Matt.');
  const body = await req.arrayBuffer();
  if (body.byteLength > limit) throw err(413, 'That file is too big to send.');
  if (isCatalog) {
    const list = kind === 'recipes' ? 'recipes' : 'books';
    try { const s = JSON.parse(new TextDecoder().decode(body)); if (!s || !Array.isArray(s[list])) throw 0; }
    catch (e) { throw err(400, kind === 'recipes' ? 'not a recipe file' : 'not a library file'); }
    // once a day, before the first save: a copy of the file as it was (backups/, which no phone can reach)
    try { await snapshot(env, dev.lib, kind === 'recipes' ? RECIPES : CATALOG); } catch (e) {}
  } else if (kind === 'note') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(body); } catch (e) { throw err(415, 'Only photos can be sent here'); }
  } else if (!isImage(new Uint8Array(body))) throw err(415, 'Only photos can be sent here');
  // mode: "add" (fail if it exists) or "update:<rev>" (fail if someone saved in between). Never a blind overwrite.
  const m = String(req.headers.get('X-Mode') || 'add');
  const mode = m.startsWith('update:') ? { '.tag': 'update', update: m.slice(7) } : 'add';
  const autorename = !isCatalog && req.headers.get('X-Autorename') === '1';
  const r = await dbx(env, 'https://content.dropboxapi.com/2/files/upload',
    { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path: real, mode, autorename, mute: true }) }, body);
  if (r.status === 409) return json({ error: 'conflict' }, 409);
  if (!r.ok) throw err(502, 'Dropbox upload failed (' + r.status + ')');
  if (kind === 'photo' && ctx && ctx.waitUntil) ctx.waitUntil(photosArrived(env, dev.lib).catch(() => {}));
  const j = await r.json();
  const shown = String(j.path_display || real);
  const rt = root(env);
  return json({ path: rt && shown.toLowerCase().startsWith(rt.toLowerCase() + '/') ? shown.slice(rt.length) : shown, rev: j.rev || null });
}

// JPEG (FF D8 FF), PNG (89 P N G), HEIC / HEIF (an ISO box: "ftyp" at byte 4)
function isImage(b) {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
}
// Daily snapshot: 14 rotating slots (backups/tamarack-library-slot-NN.json), overwritten in turn, so nothing needs
// deleting (the Dropbox app only needs files.content.write). The slot is the day number mod 14; its Dropbox date says when.
async function snapshot(env, lib, file = CATALOG) {
  const day = new Date().toISOString().slice(0, 10);
  const key = (file === CATALOG ? 'snap:' : 'snaprc:') + lib, stem = file.replace(/\.json$/, '');
  if ((await env.LIBS.get(key)) === day) return;
  const base = root(env) + '/' + lib + '/';
  const cur = await dbx(env, 'https://content.dropboxapi.com/2/files/download', { 'Dropbox-API-Arg': dbxArg({ path: base + file }) });
  if (!cur.ok) return;   // no catalog yet: nothing to keep; the next save today tries again
  const slot = String(Math.floor(Date.now() / 864e5) % BACKUP_SLOTS).padStart(2, '0');
  const up = await dbx(env, 'https://content.dropboxapi.com/2/files/upload',
    { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path: base + 'backups/' + stem + '-slot-' + slot + '.json', mode: { '.tag': 'overwrite' }, autorename: false, mute: true }) },
    await cur.arrayBuffer());
  if (up.ok) await env.LIBS.put(key, day, { expirationTtl: 3 * 86400 });
}
// Photos arrived: tell Matt (ntfy), at most once an hour per library, and note the time for the admin list
async function photosArrived(env, lib) {
  if (await env.LIBS.get('note:' + lib)) return;
  await env.LIBS.put('note:' + lib, '1', { expirationTtl: 3600 });
  const L = (await kvGet(env, 'lib:' + lib)) || { title: lib, at: Date.now() };
  await env.LIBS.put('lib:' + lib, JSON.stringify(Object.assign({}, L, { lastUpload: Date.now() })));
  await notify(env, 'New photos for ' + lib, 'Photos are arriving in ' + lib + '/photos/inbox. Ask Claude to check the photo inbox for the ' + lib + '.');
}
async function notify(env, title, text) {
  if (!env.NTFY_TOPIC) return;
  await fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), { method: 'POST', headers: { Title: title }, body: text }).catch(() => {});
}
// A brake on a lost or misused phone filling Matt's Dropbox: photos/covers per library per day, counted in memory
// (per Worker instance — rough, but free; a whole shed is ~200 photos). Switching the phone off is the real remedy.
const DAILY_FILES = 600;
const _count = new Map();
function allowUpload(lib) {
  const day = new Date().toISOString().slice(0, 10), k = day + '|' + lib;
  if (_count.size > 500) for (const key of _count.keys()) if (!key.startsWith(day)) _count.delete(key);
  const n = (_count.get(k) || 0) + 1; _count.set(k, n);
  return n <= DAILY_FILES;
}

/* ---------------- Dropbox sign-in (Matt's, kept here only) ---------------- */
let _tok = null;   // { access, exp } — lives as long as this Worker instance
async function dbxAccess(env, force) {
  if (!force && _tok && _tok.exp - 60000 > Date.now()) return _tok.access;
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.DBX_REFRESH_TOKEN, client_id: env.DBX_APP_KEY }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    // every friend's sync stops until this is fixed: tell Matt (once an hour)
    try { if (!(await env.LIBS.get('note:signin'))) { await env.LIBS.put('note:signin', '1', { expirationTtl: 3600 });
      await notify(env, 'Library service: Dropbox sign-in failed', 'The friends service can’t sign in to Dropbox (' + (j.error || r.status) + '). Make a new refresh token (worker/get-token.mjs) and store it with wrangler secret put DBX_REFRESH_TOKEN.'); } } catch (e) {}
    throw err(502, 'Dropbox sign-in on the server failed');
  }
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
function makeCode() { const r = crypto.getRandomValues(new Uint32Array(1))[0]; return String(r % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0'); }
// typed codes: ignore case, spaces and dashes (5 digits now; older codes are 8 letters/digits)
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }
function fmtCode(c) { return /^\d+$/.test(c) ? c : c.slice(0, 4) + '-' + c.slice(4); }
function cleanLib(s) { const v = String(s || '').replace(/[\\/\x00-\x1f:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); return v && v !== '.' && v !== '..' ? v : ''; }
function dbxArg(o) { return JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)); }

export const _test = { extractRecipe, publicUrl,  checkPath, normCode, cleanLib, isImage, resetToken: () => { _tok = null; _count.clear(); _fetchCount.clear(); } };

/* ---------------- a recipe from a web page ----------------
   Most recipe sites put a clean copy of the recipe in the page for search engines (schema.org "Recipe", as JSON-LD).
   This reads only that, and sends back only the recipe (never the page). Who may ask: the app's own web address
   (ALLOWED_ORIGINS), with or without a device key, so Matt's own-Dropbox library can use it too. A script can fake
   the web address, so this is held back by limits rather than a key: FETCH_LIMIT (10 a minute per address) and
   FETCH_ALL (60 a minute in all) when set in wrangler.toml, else about 60 an hour per Worker instance. Only http(s)
   to a named public host, every redirect checked (3 at most); 10 s and 3 MB at most, read in pieces. Nothing stored. */
const FETCH_PER_HOUR = 60;
const _fetchCount = new Map();
function allowFetch(ip) {
  const hour = Math.floor(Date.now() / 3600e3), k = hour + '|' + ip;
  if (_fetchCount.size > 2000) for (const key of _fetchCount.keys()) if (!key.startsWith(hour + '|')) _fetchCount.delete(key);
  const n = (_fetchCount.get(k) || 0) + 1; _fetchCount.set(k, n); return n <= FETCH_PER_HOUR;
}
function publicUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/.test(h) || /(^|[.-])\d{1,3}[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3}([.-]|$)/.test(h)) return null;
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[') || /(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(h)) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  return u;
}
async function recipeFetch(req, env) {
  const origin = req.headers.get('Origin') || '';
  if (!origin || !corsHeaders(origin, env)) throw err(403, 'not allowed');
  const ip = req.headers.get('CF-Connecting-IP') || 'none';
  if (env.FETCH_LIMIT && !(await env.FETCH_LIMIT.limit({ key: ip })).success) throw err(429, 'Too many links just now. Try again in a minute.');
  if (env.FETCH_ALL && !(await env.FETCH_ALL.limit({ key: 'all' })).success) throw err(429, 'Too many links just now. Try again in a minute.');
  if (!allowFetch(ip)) throw err(429, 'Too many links just now. Try again in a while.');
  const body = await req.json().catch(() => ({}));
  let u = publicUrl(body.url);
  if (!u) throw err(400, 'That doesn’t look like a web page address.');
  let html = '';
  try {
    let r = null;
    for (let hop = 0; hop < 4; hop++) {   // follow redirects ourselves, checking each address
      r = await fetch(u.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TamarackLibrary/1.0; +https://mattrailey.github.io/tamarack-library/)', Accept: 'text/html,application/xhtml+xml' } });
      if (r.status < 300 || r.status > 399) break;
      const next = publicUrl(new URL(r.headers.get('Location') || '', u).toString());
      if (!next || hop === 3) return json({ none: true });
      u = next; r = null;
    }
    if (!r || !r.ok) return json({ none: true, why: r ? 'The site answered ' + r.status : '' });
    if (+(r.headers.get('Content-Length') || 0) > 5e6) return json({ none: true, why: 'That page is too big' });
    html = await readCapped(r, 3e6);
  } catch (e) { return json({ none: true, why: 'Couldn’t reach that page' }); }
  const recipe = extractRecipe(html);
  return json(recipe ? { recipe } : { none: true });
}
// read a response in pieces and stop at max bytes (a huge or endless page can't fill the Worker's memory)
async function readCapped(r, max) {
  if (!r.body || !r.body.getReader) return new TextDecoder().decode((await r.arrayBuffer()).slice(0, max));
  const reader = r.body.getReader(), parts = []; let n = 0;
  while (n < max) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  try { await reader.cancel(); } catch (e) {}
  const all = new Uint8Array(Math.min(n, max)); let o = 0;
  for (const p of parts) { const take = Math.min(p.length, all.length - o); all.set(p.subarray(0, take), o); o += take; if (o >= all.length) break; }
  return new TextDecoder().decode(all);
}
function extractRecipe(html) {
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let data; try { data = JSON.parse(m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '')); } catch (e) { continue; }
    const node = findRecipeNode(data, 0); if (node) { const r = mapRecipe(node); if (r.title && r.ingredients.length) return r; }
  }
  return null;
}
function isType(n, t) { const x = n && n['@type']; return Array.isArray(x) ? x.some(y => String(y).toLowerCase() === t) : String(x || '').toLowerCase() === t; }
function findRecipeNode(d, depth) {
  if (!d || typeof d !== 'object' || depth > 6) return null;
  if (Array.isArray(d)) { for (const x of d) { const f = findRecipeNode(x, depth + 1); if (f) return f; } return null; }
  if (isType(d, 'recipe')) return d;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) { const f = findRecipeNode(d[k], depth + 1); if (f) return f; }
  return null;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
function clean(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (a, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), /^#x/i.test(e) ? 16 : 10) || 32) : (ENT[e.toLowerCase()] || a))
    .replace(/\s+/g, ' ').trim();
}
function isoDur(s) {   // PT1H15M → "1 hr 15 min"
  const m = String(s || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i); if (!m) return clean(s);
  const h = (+m[1] || 0) * 24 + (+m[2] || 0), mi = +m[3] || 0; if (!h && !mi) return '';
  return [h ? h + ' hr' : '', mi ? mi + ' min' : ''].filter(Boolean).join(' ');
}
function steps(ins, out = []) {
  if (!ins) return out;
  if (typeof ins === 'string') { clean(ins).split(/\s*(?:\r?\n)+\s*|(?<=\.)\s+(?=\d+[.)]\s)/).map(x => x.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean).forEach(x => out.push(x)); return out; }
  if (Array.isArray(ins)) { ins.forEach(x => steps(x, out)); return out; }
  if (isType(ins, 'howtosection')) { const n = clean(ins.name); if (n) out.push('## ' + n); return steps(ins.itemListElement, out); }
  const t = clean(ins.text || ins.name || ''); if (t) out.push(t);
  return out;
}
function mapRecipe(n) {
  const str = v => clean(Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? v.name || '' : v));
  const img = (() => { let i = n.image; if (Array.isArray(i)) i = i[0]; if (i && typeof i === 'object') i = i.url || i['@id']; i = String(i || ''); return /^https:\/\//.test(i) ? i.slice(0, 500) : ''; })();
  let yieldTxt = n.recipeYield; if (Array.isArray(yieldTxt)) yieldTxt = yieldTxt.find(y => /\D/.test(String(y))) || yieldTxt[0];
  const kw = Array.isArray(n.keywords) ? n.keywords : String(n.keywords || '').split(',');
  const author = Array.isArray(n.author) ? n.author.map(a => str(a)).filter(Boolean).join(', ') : str(n.author);
  const out = {
    title: clean(n.name).slice(0, 200), author: author.slice(0, 120), about: clean(n.description).slice(0, 600),
    servings: clean(yieldTxt).slice(0, 60), prep: isoDur(n.prepTime), cook: isoDur(n.cookTime), total: isoDur(n.totalTime),
    category: str(n.recipeCategory).split(',')[0].trim().slice(0, 60), cuisine: str(n.recipeCuisine).split(',')[0].trim().slice(0, 60),
    tags: kw.map(clean).filter(Boolean).slice(0, 8),
    ingredients: (Array.isArray(n.recipeIngredient) ? n.recipeIngredient : Array.isArray(n.ingredients) ? n.ingredients : []).map(clean).filter(Boolean).slice(0, 120),
    steps: steps(n.recipeInstructions).slice(0, 120), image: img,
  };
  for (const k of Object.keys(out)) if (out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) delete out[k];
  if (!out.ingredients) out.ingredients = [];
  return out;
}
