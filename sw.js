// sw.js — service worker de l'Appli Courses.
// À CHAQUE PUBLICATION : augmenter CACHE_VERSION (DoD1).
const CACHE_VERSION = 'v22';
const CACHE_NAME = 'appli-courses-' + CACHE_VERSION;

const FICHIERS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'db.js',
  'domain.js',
  'tests.html',
  'types-ui.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

const FICHIERS_OPTIONNELS = [
  'bricolage-grotesque.woff2',
  'dm-sans.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(FICHIERS);
    await Promise.all(FICHIERS_OPTIONNELS.map((f) => cache.add(f).catch(() => {})));
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((noms) => Promise.all(noms.filter((n) => n.startsWith('appli-courses-') && n !== CACHE_NAME).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req=event.request;
  if(req.method!=='GET')return;
  event.respondWith(caches.match(req,{ignoreSearch:true}).then((enCache)=>{if(enCache)return enCache;return fetch(req).catch(()=>{if(req.mode==='navigate')return caches.match('index.html');return Response.error();});}));
});
self.addEventListener('message',(event)=>{if(event.data&&event.data.type==='GET_VERSION'&&event.source)event.source.postMessage({type:'VERSION',version:CACHE_VERSION});});