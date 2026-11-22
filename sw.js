// Offline shell + network-first data. Bump VERSION when shell files change.
const VERSION = 'gta6-v1';
const SHELL = ['./', 'index.html', 'app/styles.css', 'app/ui.js', 'app/logic.js', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // never touch third-party thumbnails/links
  const isData = url.pathname.includes('/data/');
  e.respondWith(
    isData
      ? fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req.url.split('?')[0], copy)); return r; }).catch(() => caches.match(req.url.split('?')[0]))
      : caches.match(req, { ignoreSearch: true }).then((hit) => {
          const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; });
          return hit || net;
        }).catch(() => caches.match('index.html'))
  );
});
