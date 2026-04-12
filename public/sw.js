const CACHE_NAME = 'rvpark-v4';

// App shell: files needed for the UI to render offline.
const APP_SHELL = [
  '/',
  '/css/styles.css',
  '/js/api.js',
  '/js/app.js',
  '/js/pages/dashboard.js',
  '/js/pages/sitemap.js',
  '/js/pages/tenants.js',
  '/js/pages/meters.js',
  '/js/pages/billing.js',
  '/js/pages/payments.js',
  '/js/pages/checkins.js',
  '/js/pages/messages.js',
  '/js/pages/reservations.js',
  '/js/pages/waitlist.js',
  '/js/pages/users.js',
  '/js/pages/admin.js',
  '/park_Logo.png',
  '/manifest.json',
];

// CDN libs to cache on first use.
const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// Install: pre-cache the app shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[sw] some app shell assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
//  - API calls (/api/*): network-only (always need fresh data, fail gracefully).
//  - App shell & CDN: stale-while-revalidate (serve cached, update in background).
//  - Everything else: network-first with cache fallback.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST/PUT/PATCH/DELETE go straight to network).
  if (event.request.method !== 'GET') return;

  // API calls: network only.
  if (url.pathname.startsWith('/api/')) return;

  // App shell and CDN libs: stale-while-revalidate.
  const isAppShell = APP_SHELL.includes(url.pathname) || CDN_LIBS.some((lib) => event.request.url.startsWith(lib));
  if (isAppShell) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Everything else: network-first.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
