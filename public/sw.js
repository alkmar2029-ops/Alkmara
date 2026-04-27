// Minimal service worker — installable PWA + basic offline shell.
// We intentionally don't cache API responses because attendance data must
// stay fresh; if offline support for save is needed later, queue requests
// in IndexedDB and replay on online (Background Sync API).

const CACHE = 'attendance-shell-v1';
const SHELL = ['/teacher/login', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Network-first for HTML, cache-fallback for shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match('/teacher/login');
        return cached || new Response('غير متصل بالإنترنت', { status: 503 });
      }
    })());
  }
});
