// Offline: App-Dateien beim ersten Öffnen zwischenspeichern.
// Bei jeder neuen Version VERSION erhöhen, damit Handys das Update laden.
const VERSION = 'v2';
const FILES = ['./', './index.html', './styles.css', './app.js', './db.js', './template-tore.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
