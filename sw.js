// Offline cache: serve instantly from cache, refresh in the background.
const CACHE = 'spendly-v13';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'icons.js', 'icons/icon.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Never cache the sync API; only the app shell.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const key = req.mode === 'navigate' ? './' : req;
  // no-cache: revalidate with the server, since GitHub Pages lets the HTTP cache keep files for 10 min and an update could re-cache stale ones.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});
