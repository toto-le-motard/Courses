// app.js — squelette (story 1.2) : service worker, pastille « Hors ligne », version.

const pastille = document.getElementById('offline-pill');
const versionEl = document.getElementById('app-version');

function majReseau() {
  pastille.hidden = navigator.onLine;
}
window.addEventListener('online', majReseau);
window.addEventListener('offline', majReseau);
majReseau();

function demanderVersion() {
  const ctrl = navigator.serviceWorker.controller;
  if (ctrl) ctrl.postMessage({ type: 'GET_VERSION' });
  else versionEl.textContent = 'version : en cours d\u2019installation';
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'VERSION') {
      versionEl.textContent = 'version ' + e.data.version;
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', demanderVersion);
  navigator.serviceWorker.register('sw.js').then(demanderVersion).catch(() => {
    versionEl.textContent = 'version : hors service worker';
  });
} else {
  versionEl.textContent = 'version : service worker non disponible';
}
