// Shows a held decision pushed by the engine, and opens the deck on it when tapped. No offline cache: answers need the engine.
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : { title: "TRACON", body: "A session needs you" };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.id, data: { id: d.id }, icon: "/icon-192.png", requireInteraction: true }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = `/#d=${e.notification.data?.id ?? ""}`;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const w = wins[0];
      if (!w) return self.clients.openWindow(url);
      w.postMessage({ decision: e.notification.data?.id });
      return w.focus();
    }),
  );
});
