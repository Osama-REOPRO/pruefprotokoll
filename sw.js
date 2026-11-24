// Offline: App-Dateien beim ersten Öffnen zwischenspeichern.
// Bei jeder neuen Version VERSION erhöhen, damit Handys das Update laden.
const VERSION = 'v32';
const FILES = ['./', './index.html', './styles.css', './desk.css', './app.js', './db.js', './template-tore.js', './print-tore.js', './print-tuer.js', './template-tuer.js', './print.css', './i18n.js', './sync.js', './manifest.webmanifest', './icon.svg', './logo-hotz.jpg', './fonts/carlito-regular.woff2', './fonts/carlito-bold.woff2',
  './guide-view.js', './guide-match.js', './guide/data.js', './guide/img/Abb-01-Rolltor.webp', './guide/img/Abb-02-Sektionaltor-Innenansicht.webp', './guide/img/Abb-03-Sektionaltor-Seitenschnitt.webp', './guide/img/Abb-04-Schiebetor-Zahnstange.webp', './guide/img/Abb-05-Feuerschutz-Rolltor.webp', './guide/img/Abb-06-Feuerschutz-Schiebetor.webp', './guide/img/Abb-07-Fangvorrichtung.webp', './guide/img/Abb-08-Federn.webp', './guide/img/Abb-09-Seile.webp', './guide/img/Abb-10-Kette-Zahnriemen.webp', './guide/img/Abb-11-Steuerung.webp', './guide/img/Abb-12-Endschalter-NES-DES.webp', './guide/img/Abb-13-Nothandbedienung.webp', './guide/img/Abb-14-Schliesskantensicherung-Kraftmessung.webp', './guide/img/Abb-15-Fuehrungen-Rollen-Daempfer.webp', './guide/img/Abb-16-Feststellanlage-Aufbau.webp', './guide/img/Abb-17-Rauchschalter-Anordnung.webp', './guide/img/Abb-18-Brandschutztuer-1-fluegelig.webp', './guide/img/Abb-19-Brandschutztuer-2-fluegelig.webp', './guide/img/Abb-20-Tuer-Details.webp', './guide/img/Abb-21-Dichtungen-Luftspalt.webp', './guide/img/Abb-22-Rohrrahmentuer-Glas-Elektro.webp', './guide/img/IMG_3595.webp', './guide/img/IMG_3618.webp', './guide/img/IMG_3755.webp', './guide/img/IMG_3762.webp'];

self.addEventListener('install', e => {
  // cache: 'reload' umgeht den Browser-Cache, damit wirklich die neuen Dateien gespeichert werden
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Mit Netz: immer die neueste Fassung holen (und für offline merken). Ohne Netz oder bei sehr
// langsamer Verbindung (> 3 s): die gespeicherte Fassung. So kommen Updates sofort an.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const net = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const cached = await cache.match(req, { ignoreSearch: true });
    if (!cached) return net.catch(() => caches.match('./index.html'));
    const timeout = new Promise(r => setTimeout(() => r(cached), 3000));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
