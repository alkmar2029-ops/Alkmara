// Teacher portal service worker — installable PWA with offline browsing.
//
// Strategy:
//   • Static assets (chunks, icons, manifest)  → stale-while-revalidate
//   • HTML navigations                          → network-first w/ offline fallback
//   • API calls                                 → network-only (data must be fresh)
//
// Cache versioning: bump CACHE_VERSION whenever the offline shell changes.

const CACHE_VERSION = 'v3';
const SHELL_CACHE = `attendance-shell-${CACHE_VERSION}`;
const ASSETS_CACHE = `attendance-assets-${CACHE_VERSION}`;

const SHELL_URLS = [
  '/teacher/login',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
];

// ===== Install =====
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_URLS).catch(() => {});
    } catch { /* ignore */ }
    self.skipWaiting();
  })());
});

// ===== Activate — clean up old caches =====
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('attendance-') && !k.endsWith(CACHE_VERSION))
        .map((k) => caches.delete(k))
    );
    self.clients.claim();
  })());
});

// ===== Fetch =====
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only — don't intercept third-party requests.
  if (url.origin !== self.location.origin) return;

  // API calls — network only, never cached (data must be live).
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (HTML pages) — network-first with offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Static assets — stale-while-revalidate (instant load + bg refresh).
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico' ||
    /\.(?:js|css|woff2?|svg|png|jpg|jpeg|webp|gif)$/.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: try network, fall back to cache.
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// Network-first for HTML navigations.
async function networkFirstNavigation(req) {
  try {
    const fresh = await fetch(req);
    // Cache successful HTML responses for offline fallback.
    if (fresh.ok && req.method === 'GET') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    // Try cached version of this URL first, then login shell.
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const fallback = await cache.match('/teacher/login');
    if (fallback) return fallback;
    return new Response(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>غير متصل</title>
       <style>body{font-family:Cairo,sans-serif;margin:0;padding:2rem;text-align:center;background:#f9fafb}
       .card{max-width:400px;margin:4rem auto;background:#fff;padding:2rem;border-radius:1rem;box-shadow:0 4px 12px rgba(0,0,0,.08)}
       h1{color:#dc2626;margin-top:0}p{color:#4b5563}button{margin-top:1rem;padding:.5rem 1.5rem;background:#2563eb;color:#fff;border:0;border-radius:.5rem;font-size:1rem;cursor:pointer}</style>
       </head><body><div class="card"><h1>📵 غير متصل</h1><p>لا يوجد اتصال بالإنترنت. سيعود التطبيق للعمل تلقائياً عند عودة الاتصال.</p><button onclick="location.reload()">إعادة المحاولة</button></div></body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

// Stale-while-revalidate for assets.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// Listen for SKIP_WAITING messages from clients (used by update prompts).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
