// Old service worker — self-destruct: delete all caches and unregister
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(k => Promise.all(k.map(c => caches.delete(c))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});
