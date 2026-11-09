// Offline support: keeps a copy of the app's own files so it opens without a connection.
// Bump VERSION whenever any app file changes, so phones pick up the update.
const VERSION = 'bp-2.8.3';
const FILES = ['./', 'index.html', 'styles.css', 'whatsnew.js', 'sync.js', 'spending.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* Reminders. The text arrives encrypted with the household's reminder key, which the app saved in IndexedDB;
   if it can't be read, a plain "you have a reminder" is shown instead (a push must always show something). */
function idbGet(k) {
  return new Promise(res => {
    const r = indexedDB.open('billplanner-sw', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); };
    r.onerror = () => res(null);
  });
}
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function readNote(text) {
  const raw = await idbGet('noteKey');
  const [tag, iv, ct] = String(text).split('.');
  if (!raw || tag !== 'n1') throw new Error('no key');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, key, unb64u(ct))));
}
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let n = { title: 'Bill Planner', body: 'You have a reminder. Open the app to see it.', tag: 'bp' };
    try { if (e.data) n = await readNote(e.data.text()); } catch (x) { }
    // url: where tapping it should go inside the app (for example './?fix=1' opens the bank-fix steps).
    const url = typeof n.url === 'string' && n.url.startsWith('./') ? n.url : './';
    // must: a warning that has to be acknowledged. It stays on screen until tapped (where the phone allows it) and
    // alerts again each time it repeats, even though it replaces the previous one.
    const must = n.must === true;
    await self.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url }, requireInteraction: must, renotify: must && !!n.tag });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    if (!cs.length) return clients.openWindow(url);
    if (url !== './') cs[0].postMessage({ open: url }); // the app is already open: tell it where to go
    return cs[0].focus();
  }));
});

// Network first (so updates show up), falling back to the saved copy when offline.
// 'no-cache' makes the browser check with the server every time instead of reusing an old copy.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
