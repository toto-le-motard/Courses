// app.js — interface et navigation (stories 1.2 à 1.4).
import { initDb, demanderStockagePersistant, lireReglage, ecrireReglage, compter, STORES, VERSION_SCHEMA } from './db.js';

const vue = document.getElementById('vue');
const titre = document.getElementById('titre-ecran');
const pastille = document.getElementById('offline-pill');
const onglets = document.querySelectorAll('.tabs a');

let versionAppli = '…';
let diagnostic = { base: 'ouverture…', persistant: '…', lancements: '…', comptes: '' };

// ---- Pastille « Hors ligne » -------------------------------------------------------------
function majReseau() { pastille.hidden = navigator.onLine; }
window.addEventListener('online', majReseau);
window.addEventListener('offline', majReseau);
majReseau();

// ---- Écrans (contenus réels dans les épics suivants) --------------------------------------
function carte(titreCarte, ...paragraphes) {
  const c = document.createElement('section');
  c.className = 'carte';
  const h = document.createElement('h2');
  h.textContent = titreCarte;
  c.appendChild(h);
  for (const t of paragraphes) {
    const p = document.createElement('p');
    p.textContent = t;
    c.appendChild(p);
  }
  return c;
}

function vueReglages() {
  const d = document.createElement('div');
  d.appendChild(carte('Réglages', 'Seuil, sauvegarde et installation arrivent avec l\u2019épic E8.'));
  const c = carte('À propos et diagnostic');
  const p = document.createElement('p');
  p.className = 'diag';
  const lignes = [
    ['Version de l\u2019appli', versionAppli],
    ['Base de données', diagnostic.base],
    ['Stockage persistant', diagnostic.persistant],
    ['Lancements enregistrés', diagnostic.lancements],
    ['Contenu', diagnostic.comptes]
  ];
  lignes.forEach(([k, v], i) => {
    if (i) p.appendChild(document.createElement('br'));
    const s = document.createElement('strong');
    s.textContent = k + ' : ';
    p.appendChild(s);
    p.appendChild(document.createTextNode(v));
  });
  c.appendChild(p);
  d.appendChild(c);
  return d;
}

const ROUTES = {
  magasin: { titre: 'Magasin', vue: () => carte('Relevé et verdict', 'Cet écran arrive avec l\u2019épic E3.') },
  liste:   { titre: 'Liste', vue: () => carte('Avant les courses', 'Cet écran arrive avec l\u2019épic E5.') },
  types:   { titre: 'Types', vue: () => carte('Types de produits', 'Cet écran arrive avec l\u2019épic E2.') },
  bilan:   { titre: 'Bilan', vue: () => carte('Économies réalisées', 'Cet écran arrive avec l\u2019épic E7.') },
  reglages: { titre: 'Réglages', vue: vueReglages }
};

function afficher() {
  const nom = location.hash.replace('#/', '') || 'magasin';
  const r = ROUTES[nom] || ROUTES.magasin;
  titre.textContent = r.titre;
  document.title = r.titre + ' · Appli Courses';
  vue.replaceChildren(r.vue());
  vue.style.animation = 'none'; void vue.offsetWidth; vue.style.animation = '';
  onglets.forEach((a) => {
    if (a.dataset.route === nom) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

if (!location.hash) history.replaceState(null, '', '#/magasin');
window.addEventListener('hashchange', afficher); // le retour arrière Android suit l'historique des écrans
afficher();

// ---- Base de données (story 1.4) -----------------------------------------------------------
(async () => {
  try {
    await initDb();
    diagnostic.base = 'ouverte (schéma v' + VERSION_SCHEMA + ')';
    const ok = await demanderStockagePersistant();
    diagnostic.persistant = ok === null ? 'non géré par ce navigateur' : (ok ? 'oui' : 'non (pensez à exporter régulièrement)');
    const n = (await lireReglage('lancements', 0)) + 1;
    await ecrireReglage('lancements', n);
    diagnostic.lancements = String(n);
    const parts = [];
    for (const s of STORES) parts.push(s + ' ' + (await compter(s)));
    diagnostic.comptes = parts.join(' · ');
  } catch (e) {
    diagnostic.base = 'ERREUR : ' + (e && e.message ? e.message : e);
  }
  if ((location.hash || '') === '#/reglages') afficher();
})();

// ---- Service worker et version -------------------------------------------------------------
function demanderVersion() {
  const ctrl = navigator.serviceWorker.controller;
  if (ctrl) ctrl.postMessage({ type: 'GET_VERSION' });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'VERSION') {
      versionAppli = e.data.version;
      if (location.hash === '#/reglages') afficher();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', demanderVersion);
  navigator.serviceWorker.register('sw.js').then(demanderVersion).catch(() => { versionAppli = 'service worker indisponible'; });
} else {
  versionAppli = 'service worker non disponible';
}
