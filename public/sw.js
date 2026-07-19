/* PokyPlane service worker — cache shell + Web Push notifications */
const CACHE = 'pokyplane-v2';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache API / peer signaling
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/peerjs')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {
    title: 'PokyPlane',
    body: '',
    icon: '/icon-192.png',
    badge: '/favicon.png',
    image: '/logo.png',
    url: '/',
    tag: 'pokyplane',
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch {
    try {
      const text = event.data?.text();
      if (text) data.body = text;
    } catch {
      /* */
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'PokyPlane', {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/favicon.png',
      image: data.image || '/logo.png',
      tag: data.tag || 'pokyplane',
      renotify: true,
      data: { url: data.url || '/' },
      dir: 'auto',
      lang: 'fa',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || '/';
  const abs = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate?.(abs);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(abs);
      return undefined;
    })
  );
});
