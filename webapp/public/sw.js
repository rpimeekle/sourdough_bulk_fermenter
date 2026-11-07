/*
 * Minimal service worker. It exists so notifications work on mobile browsers
 * (which only allow them via a service worker) and so the app can be added to
 * the home screen. It deliberately does no caching, so a new deployment is
 * picked up on the next page load.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(self.registration.scope);
    }),
  );
});
