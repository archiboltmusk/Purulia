/* Purulia Kasa service worker
   - keeps the page usable offline (reports queue and upload later)
   - shows "new report near you" alerts and opens the report when tapped */

const VERSION = 'kasa-v2-10';
const SHELL = ['kasa.html', 'kasa.css', 'kasa.js', 'kasa-i18n.js', 'kasa-photo-meta.js', 'config.js', 'purulia_wards.geojson',
  'manifest.webmanifest', 'kasa-icon-192.png'];
// Versioned CDN files never change, so they can be served straight from cache.
const IMMUTABLE_CDN = /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.+@\d+\.\d+\.\d+\//;
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (IMMUTABLE_CDN.test(req.url)) return e.respondWith(cacheFirst(req));
  // Supabase, map tiles and fonts go straight to the network.
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

// Fresh when the network answers quickly; the cached copy when it's slow or offline.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  return cached || network;
}

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Purulia Kasa', {
    body: data.body || '',
    icon: 'kasa-icon-192.png',
    badge: 'kasa-icon-192.png',
    tag: data.tag,
    data: { url: data.url || 'kasa.html' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || 'kasa.html', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) {
        c.navigate(url);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
