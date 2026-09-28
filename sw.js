/* Railey Library — keeps the app usable with no signal.
   The page itself: always tries the network first (so updates show up right away), and falls back
   to the last copy saved on the phone. The barcode reader and fonts: saved once, then used offline.
   Dropbox, book-lookup and cover requests are never touched here. */
const CACHE = 'railey-library-v1';
const SHELL = 'app-shell';
const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([
    fetch('tamarack-library.html', {cache:'no-cache'}).then(r => r.ok && c.put(SHELL, r)).catch(()=>{}),
    fetch(ZXING, {mode:'cors'}).then(r => r.ok && c.put(ZXING, r)).catch(()=>{})
  ])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the app page
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const net = await Promise.race([
          fetch(req, {cache:'no-cache'}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))
        ]);
        if (net && net.ok) { c.put(SHELL, net.clone()); return net; }
        throw new Error('bad response');
      } catch (err) {
        return (await c.match(SHELL)) || (await c.match(req)) || new Response('Offline — open the library once with a connection first.', {status:503, headers:{'Content-Type':'text/plain'}});
      }
    })());
    return;
  }
  // barcode reader + fonts: cache first
  if (url.href === ZXING || url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try { const net = await fetch(req); if (net && (net.ok || net.type === 'opaque')) c.put(req, net.clone()); return net; }
      catch (err) { return hit || Response.error(); }
    })());
  }
});
