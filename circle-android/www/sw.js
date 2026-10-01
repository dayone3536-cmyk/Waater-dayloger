// sw.js — Waater service worker
// Lives at the site root (https://yoursite.com/sw.js) so its scope covers
// the whole app. Registered from index.html with:
//   navigator.serviceWorker.register('/sw.js')

// ---- push: fires when a push message arrives from the push service ----
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // fall back to plain text if the payload wasn't JSON
    data = { title: 'Waater', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Waater';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',      // your app icon, add one at this path
    badge: data.badge || '/badge-72.png',    // small monochrome icon for status bar
    data: {
      url: data.url || '/',                  // where to go when the notification is clicked
    },
    tag: data.tag || undefined,              // same tag = new notif replaces old one (e.g. group by post)
    renotify: !!data.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- notificationclick: fires when the user taps the notification ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // if a tab is already open on this site, focus it and navigate
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      // otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ---- optional: keep subscription fresh if the browser rotates it ----
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((newSub) => {
        // send newSub to your backend the same way you did the first subscribe
        return fetch('/api/push-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSub),
        });
      })
  );
});