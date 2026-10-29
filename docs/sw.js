// Offline support for the installed app.
// The page itself is fetched fresh whenever there's a connection, so updates show straight away,
// and the last copy is kept for offline use. The site's images and the pinned library and font
// files from the CDNs are kept after their first download. Account requests (Supabase) are left alone.
// Bump CACHE when the images change, so phones fetch the new ones.
const CACHE = 'deskcube-v1';
const CDN = ['https://cdnjs.cloudflare.com/', 'https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
        return res;
      })
      .catch(() => caches.match('/')));
    return;
  }
  const url = req.url;
  if (!url.startsWith(self.location.origin + '/') && !CDN.some(p => url.startsWith(p))) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
