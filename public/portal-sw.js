/*
 * Anahuac RV Park — Portal Service Worker
 * Handles push notifications, notification clicks, and app badge updates.
 */

var CACHE_VERSION = 'portal-v2';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Delete ALL old caches on activation
      caches.keys().then(function(keys) {
        return Promise.all(keys.filter(function(k) { return k !== CACHE_VERSION; }).map(function(k) { return caches.delete(k); }));
      }),
      self.clients.claim()
    ])
  );
});

// Never cache HTML or API — always fetch fresh
self.addEventListener('fetch', (event) => {
  var url = new URL(event.request.url);
  if (url.pathname.endsWith('.html') || url.pathname.startsWith('/api/') || url.pathname === '/portal') {
    return; // Let the browser handle normally (network only)
  }
  // All other requests: default browser behavior (no custom caching)
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); } catch { return; }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/favicon-32x32.png',
    tag: data.tag || 'general',
    data: { url: data.url || '/portal' },
    requireInteraction: data.priority === 'critical',
    vibrate: data.priority === 'critical' ? [200, 100, 200, 100, 200] : [100],
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Anahuac RV Park', options)
  );

  // Update badge count on the app icon
  if (self.navigator && self.navigator.setAppBadge && data.badge_count != null) {
    try { self.navigator.setAppBadge(data.badge_count); } catch {}
  }
});

// Notification click handler — open or focus the portal
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/portal';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/portal') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
