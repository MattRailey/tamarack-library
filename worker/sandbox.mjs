// Try the friends service on this computer before setting up Cloudflare or Dropbox.
//   node worker/sandbox.mjs        (from the main folder, or: npm run sandbox)
// Runs the REAL service code (src/index.js). Only Dropbox and Cloudflare's storage are pretend:
//   Dropbox  -> worker/.sandbox/Dropbox/Apps/Tamarack Friends/<Library>/   (open it in Explorer to see what arrives)
//   storage  -> worker/.sandbox/kv.json                                      (invite codes and phone keys)
// The app is served at http://localhost:4173 with the service address built in, as a release would have it.
// Phones on the same Wi-Fi can use the http://<this PC's address>:4173 link it prints.
// Type in this window: invite "<Library>" | list | revoke <phone id> | down | up | reset | quit
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');
const DATA = path.join(HERE, '.sandbox');
const DBX = path.join(DATA, 'Dropbox', 'Apps', 'Tamarack Friends');
const KV_FILE = path.join(DATA, 'kv.json');
const APP_PORT = 4173, SVC_PORT = 8787, ADMIN = 'sandbox-admin-secret-0000';
const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address));
const HOST = lan ? lan.address : 'localhost';

/* ---------------- pretend Cloudflare storage (KV), kept in a file ---------------- */
fs.mkdirSync(DBX, { recursive: true });
let kv = new Map(); try { kv = new Map(Object.entries(JSON.parse(fs.readFileSync(KV_FILE, 'utf8')))); } catch (e) {}
const saveKv = () => fs.writeFileSync(KV_FILE, JSON.stringify(Object.fromEntries(kv), null, 2));
const LIBS = {
  async get(k) { return kv.get(k) ?? null; },
  async put(k, v) { kv.set(k, String(v)); saveKv(); },
  async delete(k) { kv.delete(k); saveKv(); },
  async list({ prefix = '' } = {}) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
};

/* ---------------- pretend Dropbox, kept in a folder ---------------- */
let dropboxDown = false;
const realFetch = globalThis.fetch;
const onDisk = p => path.join(DBX, ...p.split('/').filter(Boolean));
const revOf = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (!url.includes('dropboxapi.com/')) return realFetch(url, opt);
  if (dropboxDown) return new Response('{"error":"sandbox: Dropbox is down"}', { status: 503 });
  if (url.includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'sandbox', expires_in: 14400 }));
  if (url.includes('/files/move_v2')) {
    const { from_path, to_path } = JSON.parse(opt.body);
    if (!fs.existsSync(onDisk(from_path))) return new Response('{}', { status: 409 });
    fs.mkdirSync(path.dirname(onDisk(to_path)), { recursive: true }); fs.renameSync(onDisk(from_path), onDisk(to_path));
    log('Dropbox  moved  ' + from_path + ' -> ' + to_path);
    return new Response(JSON.stringify({ metadata: { path_display: to_path } }));
  }
  const arg = JSON.parse(opt.headers['Dropbox-API-Arg']);
  const file = onDisk(arg.path);
  const cur = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (url.includes('/files/download')) {
    log('Dropbox  read   ' + arg.path + (cur ? '' : '  (not there yet)'));
    return cur ? new Response(cur, { headers: { 'Dropbox-API-Result': JSON.stringify({ rev: revOf(cur) }) } }) : new Response('{}', { status: 409 });
  }
  const body = Buffer.from(await new Response(opt.body).arrayBuffer());
  const mode = arg.mode;
  let target = arg.path;
  if (mode === 'add' && cur) {
    if (!arg.autorename) { log('Dropbox  REFUSED ' + arg.path + '  (already there)'); return new Response('{}', { status: 409 }); }
    const m = target.match(/^(.*?)(\.[^./]+)?$/);
    for (let n = 1; fs.existsSync(onDisk(target)); n++) target = m[1] + ' (' + n + ')' + (m[2] || '');
  }
  if (mode && mode['.tag'] === 'update' && (!cur || revOf(cur) !== mode.update)) {
    log('Dropbox  REFUSED ' + arg.path + '  (someone saved in between: the app should reload and merge)');
    return new Response('{}', { status: 409 });
  }
  fs.mkdirSync(path.dirname(onDisk(target)), { recursive: true });
  fs.writeFileSync(onDisk(target), body);
  log('Dropbox  wrote  ' + target + '  (' + (body.length / 1024).toFixed(1) + ' KB)');
  return new Response(JSON.stringify({ path_display: target, rev: revOf(body) }));
};

/* ---------------- the service (real code) ---------------- */
const { default: worker } = await import('./src/index.js');
const env = {
  LIBS, ADMIN_SECRET: ADMIN, DBX_APP_KEY: 'sandbox', DBX_REFRESH_TOKEN: 'sandbox', DBX_ROOT: '',
  ALLOWED_ORIGINS: `http://localhost:${APP_PORT},http://${HOST}:${APP_PORT}`, ALLOW_LOCALHOST: '1',
  APP_URL: `http://${HOST}:${APP_PORT}/tamarack-library.html`,
};
const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const r = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }), env, { waitUntil() {} });
    if (req.method !== 'OPTIONS') log(`Service  ${req.method} ${req.url} -> ${r.status}${r.status >= 400 ? '  ' + (await r.clone().text()).slice(0, 120) : ''}`);
    const out = {}; r.headers.forEach((v, k) => out[k] = v);
    res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { log('Service  CRASH ' + e.stack); res.writeHead(500); res.end(String(e)); }
}).listen(SVC_PORT, '0.0.0.0');

/* ---------------- the app, with the service address built in ---------------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') { res.writeHead(302, { Location: '/tamarack-library.html' }); return res.end(); }
  // no offline copy in the sandbox, so every reload shows the files as they are now
  if (rel === '/sw.js') { res.writeHead(404); return res.end(); }
  const file = path.join(APP_DIR, rel);
  if (!file.startsWith(APP_DIR + path.sep) || /[\\/](\.|node_modules|worker)/.test(rel) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let data = fs.readFileSync(file);
  if (rel === '/js/core.js') {
    const host = (req.headers.host || 'localhost').split(':')[0];
    data = Buffer.from(String(data).replace(/const DEFAULT_FRIEND_SERVER = '[^']*';/, `const DEFAULT_FRIEND_SERVER = 'http://${host}:${SVC_PORT}';`));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}).listen(APP_PORT, '0.0.0.0');

/* ---------------- Matt's commands, typed in this window ---------------- */
const admin = async (p, b) => (await worker.fetch(new Request(`http://localhost:${SVC_PORT}/admin/${p}`, { method: 'POST', headers: { 'X-Admin': ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }), env, {})).json();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'sandbox> ' });
function log(s) { process.stdout.write('\r' + new Date().toTimeString().slice(0, 8) + '  ' + s + '\n'); rl && rl.prompt(true); }
async function invite(lib) {
  const j = await admin('invite', { lib, title: lib, uses: 2, days: 30 });
  if (!j.code) return console.log('  ' + (j.error || JSON.stringify(j)));
  console.log(`\n  Invite for ${lib}: code ${j.code}\n  This PC:        ${j.link.replace(HOST, 'localhost')}\n  Phone on Wi-Fi: ${j.link}\n  Good for two phones.\n`);
}
rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().match(/"[^"]*"|\S+/g) || [];
  const arg = rest.join(' ').replace(/^"|"$/g, '');
  try {
    if (cmd === 'invite' && arg) await invite(arg);
    else if (cmd === 'list') {
      const j = await admin('list');
      if (!j.devices.length && !j.codes.length) console.log('  nothing yet');
      for (const d of j.devices) console.log(`  phone ${d.id}  ${d.lib}  "${d.name}"`);
      for (const c of j.codes) console.log(`  code  ${c.code}  ${c.lib}  ${c.uses} use(s) left`);
    }
    else if (cmd === 'revoke' && arg) console.log('  phones shut out:', (await admin('revoke', { id: arg })).revoked);
    else if (cmd === 'revoke-library' && arg) console.log('  phones shut out:', (await admin('revoke', { lib: arg })).revoked);
    else if (cmd === 'down') { dropboxDown = true; console.log('  Dropbox is now DOWN: uploads and syncs fail until you type up'); }
    else if (cmd === 'up') { dropboxDown = false; console.log('  Dropbox is back up'); }
    else if (cmd === 'reset') { kv = new Map(); saveKv(); fs.rmSync(path.join(DATA, 'Dropbox'), { recursive: true, force: true }); fs.mkdirSync(DBX, { recursive: true }); console.log('  wiped: no libraries, no phones, empty Dropbox (phones still hold their old keys: clear the browser data)'); }
    else if (cmd === 'quit' || cmd === 'exit') process.exit(0);
    else if (cmd) console.log('  commands: invite "<Library>" | list | revoke <phone id> | revoke-library "<Library>" | down | up | reset | quit');
  } catch (e) { console.log('  ' + e.message); }
  rl.prompt();
});

console.log(`
Tamarack Library sandbox: the real friends service, pretend Dropbox. Nothing leaves this PC.
  App:      http://localhost:${APP_PORT}     (phones on Wi-Fi: http://${HOST}:${APP_PORT})
  Service:  http://localhost:${SVC_PORT}
  Dropbox:  ${DBX}
`);
if (![...kv.keys()].some(k => k.startsWith('dev:') || k.startsWith('code:'))) await invite('Test Library');
rl.prompt();
