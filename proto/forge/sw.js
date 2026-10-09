// FORGE offline shell.
// Network-first: a live network always wins, so an edited build is never masked by the cache.
// The cache is the fallback that makes the app work on a range with no signal.
const CACHE = 'forge-v3';
const SHELL = ['./FORGE.dc.html', './support.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // Individually, so one uncacheable URL cannot void the whole precache.
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---- Practice nudge -------------------------------------------------------
// The app posts the next due time; we hold it and fire a notification when the
// worker next wakes (push, sync, or any fetch) after that moment. This is the
// best a PWA can do without a push server — the handoff spec calls for real
// Web Push (VAPID) so the nudge lands reliably with the app fully closed.
let nudge = null;

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'forge-nudge') { nudge = d; maybeNudge(); }
  if (d.type === 'forge-nudge-cancel') nudge = null;
});

async function maybeNudge() {
  if (!nudge || Date.now() < nudge.due) return;
  if (self.Notification && Notification.permission !== 'granted') return;
  const due = nudge;
  nudge = null;
  try {
    await self.registration.showNotification(due.title || 'FORGE', {
      body: due.body || 'Time to log a session.',
      tag: 'forge-checkin',
      badge: './icon-192.png',
      icon: './icon-192.png',
      data: { url: './FORGE.dc.html' },
      actions: [{ action: 'open', title: 'Log now' }]
    });
  } catch (err) {}
}

// Real push, once a server exists: payload replaces the locally held nudge.
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(p.title || 'FORGE', {
    body: p.body || 'Time to log a session.',
    tag: 'forge-checkin', icon: './icon-192.png', badge: './icon-192.png',
    data: { url: './FORGE.dc.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './FORGE.dc.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const hit = cs.find(c => c.url.indexOf('FORGE') >= 0);
    if (hit) return hit.focus();
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', e => {
  maybeNudge();
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        // Query strings are cache-busting noise; match the file regardless.
        caches.match(req, { ignoreSearch: true })
          .then(hit => hit || caches.match('./FORGE.dc.html', { ignoreSearch: true }))
          .then(hit => hit || new Response('Offline', { status: 503, statusText: 'Offline' }))
      )
  );
});
