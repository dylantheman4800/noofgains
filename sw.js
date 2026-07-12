/* NoofGains service worker — cache-first app shell, versioned. */
const CACHE = 'noofgains-v5';
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/store.js',
  'js/charts.js',
  'js/fuel.js',
  'js/plan.js',
  'js/coach.js',
  'js/app.js',
  'manifest.webmanifest',
  'fonts/InterVariable.woff2',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // let API calls pass through
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return; // dev: always fresh
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
