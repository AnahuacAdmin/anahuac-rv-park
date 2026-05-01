/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Service Worker — Offline & Caching
 */
const CACHE_NAME = 'rvpark-v61';

const APP_SHELL = [
  // NOTE: '/' intentionally excluded — handled separately as network-first to prevent caching stale HTML
  '/css/styles.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/js/chart.min.js',
  '/js/api.js',
  '/js/app.js',
  '/js/offline.js',
  '/emergency-form.html',
  '/park_Logo.png',
  '/manifest.json',
  // Page scripts
  '/js/pages/dashboard.js',
  '/js/pages/sitemap.js',
  '/js/pages/tenants.js',
  '/js/pages/meters.js',
  '/js/pages/billing.js',
  '/js/pages/payments.js',
  '/js/pages/checkins.js',
  '/js/pages/messages.js',
  '/js/pages/reservations.js',
  '/js/pages/electric.js',
  '/js/pages/reports.js',
  '/js/pages/waitlist.js',
  '/js/pages/users.js',
  '/js/pages/admin.js',
  '/js/pages/lotmgmt.js',
  '/js/pages/vendors.js',
  '/js/pages/community.js',
  '/js/pages/documents.js',
  '/js/pages/maintenance.js',
  '/js/pages/expenses.js',
  '/js/pages/inspections.js',
  '/js/pages/branding.js',
  '/js/pages/setup-wizard.js',
  '/js/pages/water-meters.js',
  '/js/pages/water-analytics.js',
  '/js/pages/lost-found.js',
  '/js/pages/birding.js',
  '/js/pages/hunting-fishing.js',
];

const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[sw] some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // HTML pages: network-first to prevent caching stale HTML
  if ((url.pathname === '/' || url.pathname === '/portal.html' || url.pathname === '/pay.html') && url.hostname === self.location.hostname) {
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
    return;
  }

  // API: try network, cache GET responses for offline fallback
  if (url.pathname.startsWith('/api/')) {
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
    return;
  }

  // Public standalone pages — always network
  if (['/privacy', '/privacy.html', '/terms', '/terms.html'].includes(url.pathname)) return;

  // App shell & CDN: stale-while-revalidate
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

  // Everything else: network-first with cache fallback
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
