// ╔══════════════════════════════════════════════════════════╗
// ║  XREZZKY CHAT — Service Worker                           ║
// ║  Upload file ini ke root repo (sama dengan index.html)   ║
// ║  Nama file: sw.js                                        ║
// ╚══════════════════════════════════════════════════════════╝

const CACHE_NAME = 'xrezzky-chat-v2';
const CACHE_URLS = ['/'];

// Install — cache halaman utama
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
});

// Activate — hapus cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback cache
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push notification dari server
self.addEventListener('push', event => {
  if(!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch(e) { data = {title:'XREZZKY Chat', body: event.data.text()}; }

  const title   = data.title || 'XREZZKY Chat';
  const options = {
    body:    data.body    || 'Ada pesan baru',
    icon:    data.icon    || '/icon-192.png',
    badge:   '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag:     data.tag     || 'xrezzky-msg',
    renotify: true,
    data: {
      url: data.url || '/',
      convoId: data.convoId || null
    },
    actions: [
      { action: 'open',    title: '💬 Buka Chat' },
      { action: 'dismiss', title: '❌ Tutup' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Klik notifikasi → buka/fokus app
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if(event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(clientList => {
      // Cari tab yang sudah buka app
      const existing = clientList.find(c => c.url.includes(self.location.origin));
      if(existing) {
        existing.focus();
        existing.postMessage({type:'NOTIF_CLICK', convoId: event.notification.data?.convoId});
        return;
      }
      // Buka tab baru
      return clients.openWindow(url);
    })
  );
});
