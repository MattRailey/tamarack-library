/* Railey Library — service worker: keeps the app usable with no signal.

   App files (the page, css/, js/, icons/): network first, so an update shows up on the next open,
   falling back to the copy saved on the device. The barcode reader and fonts: saved once, then
   served from the device. Dropbox, book-lookup and cover requests are never touched here.

   When you add, rename or remove an app file, update APP_FILES and bump VERSION. */
const VERSION = 'railey-library-v2';
const APP_FILES = [
  'tamarack-library.html',
  'css/app.css',
  'js/core.js', 'js/dropbox.js', 'js/covers.js', 'js/search.js', 'js/library.js', 'js/book.js',
  'js/lookup.js', 'js/shelves.js', 'js/import.js', 'js/series.js', 'js/sell.js', 'js/data.js',
  'js/collections.js', 'js/scanner.js', 'js/mystery.js', 'js/photos.js', 'js/settings.js', 'js/app.js',
  'icons/icon-32.png', 'icons/icon-180.png', 'icons/icon-192.png', 'manifest.webmanifest',
];
const PAGE = 'tamarack-library.html';
const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const TIMEOUT_MS = 6000;   // on a weak signal, don't wait forever before using the saved copy

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(APP_FILES.map(f => fetch(f, { cache: 'no-cache' }).then(r => r.ok && c.put(f, r)).catch(() => {})));
    await fetch(ZXING, { mode: 'cors' }).then(r => r.ok && c.put(ZXING, r)).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page is requested as /tamarack-library or /tamarack-library.html (with or without ?query);
// every app file is stored under its plain relative path.
function appKey(url) {
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  let rel = url.pathname.slice(scope.pathname.length);
  if (rel === 'tamarack-library' || rel === '') rel = PAGE;
  return APP_FILES.includes(rel) ? rel : null;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const key = req.mode === 'navigate' && url.origin === location.origin ? PAGE : appKey(url);

  if (key) {                                   // app files: network first, saved copy as fallback
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const net = await Promise.race([
          fetch(req, { cache: 'no-cache' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), TIMEOUT_MS)),
        ]);
        if (net && net.ok) { c.put(key, net.clone()); return net; }
        throw new Error('bad response');
      } catch (err) {
        return (await c.match(key)) || new Response('Offline — open the library once with a connection first.',
          { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  if (url.href === ZXING || url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith((async () => {             // barcode reader + fonts: cache first
      const c = await caches.open(VERSION);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        if (net && (net.ok || net.type === 'opaque')) c.put(req, net.clone());
        return net;
      } catch (err) { return Response.error(); }
    })());
  }
});
