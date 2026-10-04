// sw.js — service worker de l'Appli Courses.
// À CHAQUE PUBLICATION : augmenter CACHE_VERSION (DoD1).
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'appli-courses-' + CACHE_VERSION;

// Tout fichier ajouté au projet doit être inscrit ici (DoD1). Chemins relatifs.
const FICHIERS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (event) => {
  // Pas de skipWaiting : la nouvelle version s'active au lancement suivant.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(FICHIERS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms
          .filter((n) => n.startsWith('appli-courses-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((enCache) => {
      if (enCache) return enCache;
      return fetch(req).catch(() => {
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
