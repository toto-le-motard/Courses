// db.js — base IndexedDB de l'Appli Courses (story 1.4).
// Les données sont indépendantes du cache du service worker : une mise à jour de l'appli ne les efface pas.
//
// Modèle (architecture section 3). Prix en centimes entiers, formats en unités de base entières
// (g, ml, unités), dates AAAA-MM-JJ, booléens stockés en 0/1 (un booléen n'est pas une clé valide).
//   ProductType : { id, nom, nomNormalise, unite: 'kg'|'l'|'unit', marque?, nomArticle?, archive: 0|1 }
//   Article     : { codeBarres (clé), type, marque?, nom?, format }
//   Observation : { id, type, magasin: 'leclerc'|'intermarche', date, prixCentimes, format, promo: 0|1 }
//   Purchase    : { id, type, observation, magasin, date, achete: 0|1, quantite, prixPayeCentimes, format,
//                   prixComparaisonCentimes|null  (prix habituel hors promo de l'AUTRE magasin, figé à la date),
//                   prixHabituelMemeMagasinCentimes|null (prix habituel hors promo du MÊME magasin, figé à la date) }
//   Settings    : { cle (clé), valeur }

export const NOM_BASE = 'appli-courses';
export const VERSION_SCHEMA = 1;
export const STORES = ['ProductType', 'Article', 'Observation', 'Purchase', 'Settings'];

// Migrations : une fonction par version de schéma, jouées dans l'ordre. Ne jamais modifier une
// migration déjà publiée : ajouter la suivante (VERSION_SCHEMA + 1).
const MIGRATIONS = {
  1(db) {
    const types = db.createObjectStore('ProductType', { keyPath: 'id', autoIncrement: true });
    types.createIndex('nomNormalise', 'nomNormalise', { unique: true });

    const articles = db.createObjectStore('Article', { keyPath: 'codeBarres' });
    articles.createIndex('type', 'type');

    const obs = db.createObjectStore('Observation', { keyPath: 'id', autoIncrement: true });
    obs.createIndex('type', 'type');
    obs.createIndex('cleJour', ['type', 'magasin', 'date', 'promo']);

    const achats = db.createObjectStore('Purchase', { keyPath: 'id', autoIncrement: true });
    achats.createIndex('type', 'type');
    achats.createIndex('observation', 'observation');

    db.createObjectStore('Settings', { keyPath: 'cle' });
  }
};

let _db = null;

function ouvrir() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(NOM_BASE, VERSION_SCHEMA);
    rq.onupgradeneeded = (e) => {
      for (let v = e.oldVersion + 1; v <= e.newVersion; v++) MIGRATIONS[v](rq.result);
    };
    rq.onsuccess = () => {
      const db = rq.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('Base bloquée par un autre onglet'));
  });
}

function requete(store, mode, action) {
  return new Promise((resolve, reject) => {
    const t = _db.transaction(store, mode);
    const r = action(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const ajouter = (store, valeur) => requete(store, 'readwrite', (s) => s.add(valeur));
export const mettre = (store, valeur) => requete(store, 'readwrite', (s) => s.put(valeur));
export const lire = (store, cle) => requete(store, 'readonly', (s) => s.get(cle));
export const toutLire = (store) => requete(store, 'readonly', (s) => s.getAll());
export const supprimer = (store, cle) => requete(store, 'readwrite', (s) => s.delete(cle));
export const compter = (store) => requete(store, 'readonly', (s) => s.count());

export async function lireReglage(cle, defaut) {
  const r = await lire('Settings', cle);
  return r ? r.valeur : defaut;
}
export const ecrireReglage = (cle, valeur) => mettre('Settings', { cle, valeur });

// Réglages par défaut (seuil « indifférent » : 5 %, FR16).
async function reglagesParDefaut() {
  if ((await lire('Settings', 'seuilIndifference')) === undefined) {
    await ecrireReglage('seuilIndifference', 5);
  }
}

// Demande le stockage persistant (NFR5) ; le résultat est conservé dans Settings.
export async function demanderStockagePersistant() {
  let ok = null;
  if (navigator.storage && navigator.storage.persist) {
    ok = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (!ok) ok = await navigator.storage.persist();
  }
  await ecrireReglage('stockagePersistant', ok);
  return ok;
}

export async function initDb() {
  _db = await ouvrir();
  await reglagesParDefaut();
  return _db;
}
