self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.matchAll({ type: 'window' });
    }).then((clients) => {
      for (const client of clients) {
        if (client.url && 'navigate' in client) {
          try {
            client.navigate(client.url);
          } catch (err) {
            console.error("Client reload failed:", err);
          }
        }
      }
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Bypass caching entirely and retrieve directly from network
  e.respondWith(fetch(e.request));
});
