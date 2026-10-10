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

import { normaliserNom, prixNormalise, decisionDoublon, analyserDoublon, cleDoublon, verifierFormat, MAGASIN, trierReleves } from './domain.js';

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
let _ok, _ko;
// Résolue quand la base est ouverte ; les écrans l'attendent avant de lire.
export const dbPrete = new Promise((a, b) => { _ok = a; _ko = b; });
dbPrete.catch(() => {});

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
    let echec = null;
    if (r) r.onerror = () => { echec = r.error; };
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(echec || t.error);
    t.onabort = () => reject(echec || t.error);
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
  try {
    _db = await ouvrir();
    try { await nettoyerChampsParasites(); } catch (e) { console.error('Nettoyage des champs parasites impossible.', e); }
    await reglagesParDefaut();
    _ok(_db);
    return _db;
  } catch (e) { _ko(e); throw e; }
}

// ---- Types de produits (FR1, FR2) ------------------------------------------------------------
const ERREUR_DOUBLON = 'Un type porte déjà ce nom.';

export const listerTypes = () => toutLire('ProductType');
export const lireType = (id) => lire('ProductType', id);
export const compterReleves = (typeId) => requete('Observation', 'readonly', (s) => s.index('type').count(typeId));

export async function ajouterType({ nom, unite, marque = '', nomArticle = '' }) {
  const n = String(nom).trim();
  try {
    return await ajouter('ProductType', { nom: n, nomNormalise: normaliserNom(n), unite, marque: marque.trim(), nomArticle: nomArticle.trim(), archive: 0 });
  } catch (e) {
    if (e && e.name === 'ConstraintError') throw new Error(ERREUR_DOUBLON);
    throw e;
  }
}

// Le changement d'unité de comparaison est refusé si des relevés existent (prix normalisés cohérents).
export async function modifierType(id, { nom, unite, marque = '', nomArticle = '' }) {
  const actuel = await lireType(id);
  if (!actuel) throw new Error('Type introuvable.');
  if (unite !== actuel.unite && (await compterReleves(id)) > 0) {
    throw new Error('Changement d\u2019unité impossible : des relevés existent pour ce type.');
  }
  const n = String(nom).trim();
  try {
    await mettre('ProductType', { ...actuel, nom: n, nomNormalise: normaliserNom(n), unite, marque: marque.trim(), nomArticle: nomArticle.trim() });
  } catch (e) {
    if (e && e.name === 'ConstraintError') throw new Error(ERREUR_DOUBLON);
    throw e;
  }
}

export async function archiverType(id, archive) {
  const t = await lireType(id);
  if (t) await mettre('ProductType', { ...t, archive: archive ? 1 : 0 });
}

// Supprime le type et tout son historique (relevés, achats, codes-barres) en une seule transaction.
export function supprimerType(id) {
  return new Promise((resolve, reject) => {
    const t = _db.transaction(['ProductType', 'Observation', 'Purchase', 'Article'], 'readwrite');
    t.objectStore('ProductType').delete(id);
    for (const nom of ['Observation', 'Purchase', 'Article']) {
      const rq = t.objectStore(nom).index('type').openCursor(IDBKeyRange.only(id));
      rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } };
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}


// ---- Observations (E3, stories 3-2 et suivantes) -------------------------------------------
export async function lireObservations(typeId) {
  return requete('Observation', 'readonly', (s) => s.index('type').getAll(typeId));
}

export async function lireDernierReleve(typeId, magasin) {
  const observations = await lireObservations(typeId);
  return observations
    .filter((o) => o.magasin === magasin)
    .sort((a, b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id || 0) - (a.id || 0))[0] || null;
}

export const ajouterObservation = (observation) => ajouter('Observation', {
  ...observation,
  promo: observation.promo ? 1 : 0
});

export function ajouterObservations(observations) {
  return new Promise((resolve, reject) => {
    const t = _db.transaction('Observation', 'readwrite');
    const ids = [];
    try {
      for (const observation of observations) {
        const rq = t.objectStore('Observation').add({ ...observation, promo: observation.promo ? 1 : 0 });
        rq.onsuccess = () => ids.push(rq.result);
      }
    } catch (e) {
      t.abort();
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(ids);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Enregistrement annulé'));
  });
}


// ---- Garde-fous et historique des relevés (stories 3-6 / 3-7) -------------------------------

export async function dernierReleve(typeId, magasin) {
  return lireDernierReleve(typeId, magasin);
}

export async function trouverDoublon(typeId, magasin, date, promo) {
  return requete('Observation', 'readonly', (s) =>
    s.index('cleJour').get(cleDoublon({ type: typeId, magasin, date, promo }))
  );
}

async function typeUnitePour(typeId) {
  const t = await lireType(typeId);
  if (!t) throw new Error('Type introuvable.');
  return t.unite;
}

export async function analyserDoublons(liste) {
  if (!Array.isArray(liste) || !liste.length) return [];
  const unites = new Map();
  for (const o of liste) unites.set(o.type, await typeUnitePour(o.type));
  const existants = await Promise.all(liste.map((o) => trouverDoublon(o.type, o.magasin, o.date, o.promo)));
  return liste.map((o, i) => analyserDoublon(existants[i], o, unites.get(o.type)));
}

function observationPropre(o) {
  return {
    type: o.type,
    magasin: o.magasin,
    date: o.date,
    prixCentimes: o.prixCentimes,
    format: o.format,
    promo: o.promo ? 1 : 0
  };
}

export function enregistrerReleves(liste, { remplacements = [] } = {}) {
  if (!Array.isArray(liste) || !liste.length) return Promise.resolve({ ajoutes: [], remplaces: [] });
  return (async () => {
    const analyses = await analyserDoublons(liste);
    return new Promise((resolve, reject) => {
      const t = _db.transaction('Observation', 'readwrite');
      const store = t.objectStore('Observation');
      const ajoutes = [], remplaces = [];
      for (let i = 0; i < liste.length; i++) {
        const analyse = analyses[i];
        if (analyse.decision === 'conserver' && !remplacements[i]) continue;
        const existant = analyse.existant;
        if (existant) {
          remplaces.push(structuredClone(existant));
          store.delete(existant.id);
        }
        const add = store.add(observationPropre(liste[i]));
        add.onsuccess = () => ajoutes.push(add.result);
      }
      t.oncomplete = () => resolve({ ajoutes, remplaces });
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Enregistrement impossible'));
    });
  })();
}

export function annulerEnregistrement(jeton) {
  return new Promise((resolve, reject) => {
    if (!jeton) return resolve();
    const t = _db.transaction('Observation', 'readwrite');
    const s = t.objectStore('Observation');
    for (const id of jeton.ajoutes || []) s.delete(id);
    for (const original of jeton.remplaces || []) s.put(original);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Annulation impossible'));
  });
}

export async function nettoyerChampsParasites() {
  return new Promise((resolve, reject) => {
    const t = _db.transaction('Observation', 'readwrite');
    const s = t.objectStore('Observation');
    const r = s.openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return;
      const o = c.value;
      const champs = Object.keys(o).filter((k) => k.startsWith('__'));
      if (champs.length) {
        for (const k of champs) delete o[k];
        c.update(o);
      }
      c.continue();
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Nettoyage impossible'));
  });
}

export async function listerReleves(typeId) {
  const observations = await lireObservations(typeId);
  return trierReleves(observations);
}

function dateValide(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [a, m, j] = date.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

export async function modifierReleve(id, champs) {
  const actuel = await lire('Observation', id);
  if (!actuel) throw new Error('Relevé introuvable.');
  const prochain = { ...actuel };
  for (const champ of ['magasin', 'date', 'prixCentimes', 'format', 'promo']) {
    if (Object.prototype.hasOwnProperty.call(champs || {}, champ)) prochain[champ] = champs[champ];
  }
  if (prochain.magasin !== MAGASIN.LECLERC && prochain.magasin !== MAGASIN.INTERMARCHE) {
    throw new Error('Magasin invalide.');
  }
  if (!Number.isInteger(prochain.prixCentimes) || prochain.prixCentimes <= 0) {
    throw new Error('Prix invalide.');
  }
  if (!dateValide(prochain.date)) throw new Error('Date invalide.');
  prochain.promo = prochain.promo ? 1 : 0;
  if (!Number.isInteger(prochain.format) || prochain.format <= 0) {
    throw new Error('Format invalide.');
  }
  const type = await lireType(prochain.type);
  if (!type) throw new Error('Type introuvable.');
  const uniteBase = type.unite === 'kg' ? 'g' : type.unite === 'l' ? 'ml' : 'unit';
  const formatOk = verifierFormat(type.unite, prochain.format, uniteBase);
  if (!formatOk.ok || !prixNormalise(prochain.prixCentimes, prochain.format, type.unite).ok) {
    throw new Error('Format incompatible avec l\'unité du type');
  }
  const doublon = await trouverDoublon(prochain.type, prochain.magasin, prochain.date, prochain.promo);
  if (doublon && doublon.id !== id) throw new Error('Un relevé existe déjà pour ce jour, ce magasin et ce statut');
  await mettre('Observation', prochain);
  return prochain;
}

export const supprimerReleve = (id) => supprimer('Observation', id);

// FR20 / E8.1 — lecture cohérente des collections pour l'export JSON.
export function exporterCollections() {
  return new Promise((resolve, reject) => {
    const resultat = {};
    const correspondances = [
      ['ProductType', 'types'], ['Article', 'articles'], ['Observation', 'releves'],
      ['Purchase', 'achats'], ['Settings', 'reglages']
    ];
    const transaction = _db.transaction(correspondances.map(([store]) => store), 'readonly');
    for (const [store, cle] of correspondances) {
      const requeteLecture = transaction.objectStore(store).getAll();
      requeteLecture.onsuccess = () => { resultat[cle] = requeteLecture.result; };
      requeteLecture.onerror = () => { try { transaction.abort(); } catch {} };
    }
    transaction.oncomplete = () => resolve(resultat);
    transaction.onerror = () => reject(transaction.error || new Error('Lecture de la sauvegarde impossible.'));
    transaction.onabort = () => reject(transaction.error || new Error('Lecture de la sauvegarde annulée.'));
  });
}


// FR20 / E8.2 — remplacement atomique des cinq collections après validation et confirmation UI.
export function remplacerCollections(payload) {
  const correspondances = [
    ['ProductType', payload.types], ['Article', payload.articles], ['Observation', payload.releves],
    ['Purchase', payload.achats], ['Settings', payload.reglages]
  ];
  if (correspondances.some(([, valeurs]) => !Array.isArray(valeurs))) {
    return Promise.reject(new Error('Sauvegarde invalide : collections manquantes.'));
  }
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = _db.transaction(correspondances.map(([nom]) => nom), 'readwrite');
      for (const [nom, valeurs] of correspondances) {
        const store = transaction.objectStore(nom);
        store.clear();
        for (const valeur of valeurs) store.add(valeur);
      }
    } catch (e) {
      try { transaction?.abort(); } catch {}
      reject(e);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Import impossible.'));
    transaction.onabort = () => reject(transaction.error || new Error('Import annulé : les données actuelles ont été conservées.'));
  });
}
