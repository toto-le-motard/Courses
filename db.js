// db.js — base IndexedDB de l'Appli Courses (story 1.4).
// Les données sont indépendantes du cache du service worker : une mise à jour de l'appli ne les efface pas.
//
// Modèle (architecture section 3). Prix en centimes entiers, formats en unités de base entières
// (g, ml, unités), dates AAAA-MM-JJ, booléens stockés en 0/1 (un booléen n'est pas une clé valide).
//   ProductType : { id, nom, nomNormalise, unite: 'kg'|'l'|'unit', marque?, nomArticle?, archive: 0|1 }
//   Article     : { codeBarres (clé), type, marque?, nom?, format }
//   Observation : { id, type, magasin: Store.id, date, prixCentimes, format, promo: 0|1 }
//   Purchase    : { id, type, observation, magasin, date, achete: 0|1, quantite, prixPayeCentimes, format,
//                   prixComparaisonCentimes|null  (prix habituel hors promo de l'AUTRE magasin, figé à la date),
//                   prixHabituelMemeMagasinCentimes|null (prix habituel hors promo du MÊME magasin, figé à la date) }
//   Settings    : { cle (clé), valeur }

import { normaliserNom, prixNormalise, decisionDoublon, analyserDoublon, cleDoublon, verifierFormat, trierReleves } from './domain.js';

export const NOM_BASE = 'appli-courses';
export const VERSION_SCHEMA = 2;
export const STORES = ['ProductType', 'Article', 'Observation', 'Purchase', 'Settings', 'Store'];

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
  },
  2(db, transaction) {
    const stores = db.createObjectStore('Store', { keyPath: 'id' });
    stores.createIndex('nomNormalise', 'nomNormalise', { unique: true });
    stores.add({ id: 'leclerc', nom: 'Leclerc', nomNormalise: 'leclerc', enseigne: 'Leclerc', localisation: '', couleur: '#5B8CFF', modePrixHabituel: 'mediane', comparable: true, archive: false, ordre: 1 });
    stores.add({ id: 'intermarche', nom: 'Intermarché', nomNormalise: 'intermarche', enseigne: 'Intermarché', localisation: '', couleur: '#FF6B5E', modePrixHabituel: 'dernier', comparable: true, archive: false, ordre: 2 });
    const settings = transaction.objectStore('Settings');
    for (const [cle, valeur] of [['magasinCourant', MAGASINS_INITIAUX[0].id], ['magasinReleveMensuel', MAGASINS_INITIAUX[1].id]]) {
      const rq = settings.get(cle);
      rq.onsuccess = () => { if (!rq.result) settings.put({ cle, valeur }); };
    }
    const achats = transaction.objectStore('Purchase');
    const cursor = achats.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const achat = c.value;
      if (!Object.prototype.hasOwnProperty.call(achat, 'magasinComparaison')) c.update({ ...achat, magasinComparaison: '' });
      c.continue();
    };
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
      for (let v = e.oldVersion + 1; v <= e.newVersion; v++) MIGRATIONS[v](rq.result, rq.transaction);
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
  if ((await lire('Settings', 'seuilIndifference')) === undefined) await ecrireReglage('seuilIndifference', 5);
  if ((await lire('Settings', 'magasinCourant')) === undefined) await ecrireReglage('magasinCourant', MAGASINS_INITIAUX[0].id);
  if ((await lire('Settings', 'magasinReleveMensuel')) === undefined) await ecrireReglage('magasinReleveMensuel', MAGASINS_INITIAUX[1].id);
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
    await initialiserMagasinsParDefaut();
    _ok(_db);
    return _db;
  } catch (e) { _ko(e); throw e; }
}


// ---- Magasins configurables (E9) --------------------------------------------------------------
const MAGASINS_INITIAUX = [
  { id: 'leclerc', nom: 'Leclerc', nomNormalise: 'leclerc', enseigne: 'Leclerc', localisation: '', couleur: '#5B8CFF', modePrixHabituel: 'mediane', comparable: true, archive: false, ordre: 1 },
  { id: 'intermarche', nom: 'Intermarché', nomNormalise: 'intermarche', enseigne: 'Intermarché', localisation: '', couleur: '#FF6B5E', modePrixHabituel: 'dernier', comparable: true, archive: false, ordre: 2 }
];
export const magasinsParDefaut = () => MAGASINS_INITIAUX.map(m => ({ ...m }));

async function initialiserMagasinsParDefaut() {
  const stores = await toutLire('Store');
  if (!stores.length) {
    for (const magasin of MAGASINS_INITIAUX) await ajouter('Store', { ...magasin });
  }
  if ((await lireReglage('magasinCourant')) === undefined) await ecrireReglage('magasinCourant', 'leclerc');
  if ((await lireReglage('magasinReleveMensuel')) === undefined) await ecrireReglage('magasinReleveMensuel', 'intermarche');
}

function normaliserNomMagasin(nom) {
  return String(nom ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim().replace(/\s+/g, ' ');
}
function idMagasinDepuisNom(nom, existants) {
  const base = String(nom ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'magasin';
  let id = base, suffixe = 2;
  while (existants.some(m => m.id === id)) id = base + '-' + suffixe++;
  return id;
}
function validerChampsMagasin(champs, existants, id = null) {
  const nom = String(champs.nom ?? '').trim();
  if (!nom) throw new Error('Le nom du magasin est obligatoire.');
  if (existants.some(m => m.id !== id && normaliserNomMagasin(m.nom) === normaliserNomMagasin(nom))) throw new Error('Un magasin porte déjà ce nom.');
  if (champs.couleur != null && !/^#[0-9a-f]{6}$/i.test(champs.couleur)) throw new Error('Couleur invalide.');
  if (champs.modePrixHabituel != null && !['mediane', 'dernier'].includes(champs.modePrixHabituel)) throw new Error('Mode de prix habituel invalide.');
  if (champs.comparable != null && typeof champs.comparable !== 'boolean') throw new Error('Le réglage de comparaison est invalide.');
  return { nom, nomNormalise: normaliserNomMagasin(nom), enseigne: String(champs.enseigne ?? '').trim(), localisation: String(champs.localisation ?? '').trim() };
}
export async function listerMagasins({ inclureArchives = true } = {}) {
  const magasins = await toutLire('Store');
  return magasins.filter(m => inclureArchives || !m.archive).sort((a,b) => (a.ordre || 0) - (b.ordre || 0) || a.nom.localeCompare(b.nom, 'fr'));
}
export const lireMagasin = (id) => lire('Store', id);
export async function creerMagasin(champs = {}) {
  const existants = await listerMagasins();
  const champsValides = validerChampsMagasin(champs, existants);
  const couleurs = ['#5B8CFF','#FF6B5E','#3DDC97','#B07CFF','#2EC4D6','#FF8FC7','#D9A066','#8FA3C7'];
  const couleur = champs.couleur || couleurs.find(c => !existants.some(m => m.couleur === c)) || couleurs[0];
  const magasin = { ...champsValides, id: idMagasinDepuisNom(champsValides.nom, existants), couleur,
    modePrixHabituel: champs.modePrixHabituel || 'dernier', comparable: champs.comparable !== false,
    archive: false, ordre: existants.reduce((max,m) => Math.max(max, Number(m.ordre) || 0), 0) + 1 };
  await ajouter('Store', magasin);
  return magasin;
}
export async function modifierMagasin(id, champs = {}) {
  const actuel = await lireMagasin(id);
  if (!actuel) throw new Error('Magasin introuvable.');
  const existants = await listerMagasins();
  const champsValides = validerChampsMagasin({ ...actuel, ...champs }, existants, id);
  const prochain = { ...actuel, ...champsValides };
  if (champs.couleur !== undefined) prochain.couleur = champs.couleur;
  if (champs.modePrixHabituel !== undefined) prochain.modePrixHabituel = champs.modePrixHabituel;
  if (champs.comparable !== undefined) prochain.comparable = champs.comparable;
  await mettre('Store', prochain);
  return prochain;
}
export async function archiverMagasin(id) {
  const magasin = await lireMagasin(id);
  if (!magasin) throw new Error('Magasin introuvable.');
  if (magasin.archive) return magasin;
  const actifs = await listerMagasins({ inclureArchives: false });
  if (actifs.length <= 1) throw new Error('Impossible d’archiver le dernier magasin actif.');
  const prochain = actifs.find(m => m.id !== id);
  const resultat = { ...magasin, archive: true };
  await mettre('Store', resultat);
  if (await lireReglage('magasinCourant', 'leclerc') === id) await ecrireReglage('magasinCourant', prochain.id);
  if (await lireReglage('magasinReleveMensuel', 'intermarche') === id) await ecrireReglage('magasinReleveMensuel', prochain.id);
  return resultat;
}
export async function restaurerMagasin(id) {
  const magasin = await lireMagasin(id);
  if (!magasin) throw new Error('Magasin introuvable.');
  const resultat = { ...magasin, archive: false };
  await mettre('Store', resultat);
  return resultat;
}
export async function supprimerMagasin(id) {
  const magasin = await lireMagasin(id);
  if (!magasin) throw new Error('Magasin introuvable.');
  const [releves, achats, actifs] = await Promise.all([toutLire('Observation'), toutLire('Purchase'), listerMagasins({ inclureArchives: false })]);
  if (releves.some(o => o.magasin === id) || achats.some(a => a.magasin === id)) throw new Error('Ce magasin a des prix constatés ou des achats : archivez-le pour le retirer');
  if (!magasin.archive && actifs.length <= 1) throw new Error('Impossible de supprimer le dernier magasin actif.');
  await supprimer('Store', id);
  if (!magasin.archive && await lireReglage('magasinCourant', 'leclerc') === id) await ecrireReglage('magasinCourant', actifs.find(m => m.id !== id)?.id || '');
  if (!magasin.archive && await lireReglage('magasinReleveMensuel', 'intermarche') === id) await ecrireReglage('magasinReleveMensuel', actifs.find(m => m.id !== id)?.id || '');
  return true;
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


// Création/restauration d'un type et rattachement d'un code dans une transaction atomique.
export async function creerTypeEtArticle({ nom, unite, codeBarres, format, marque = '', nomArticle = '' }) {
  const n = String(nom ?? '').trim(), normalise = normaliserNom(n);
  if (!n || !normalise) throw new Error('Saisissez un nom de type.');
  if (!['kg', 'l', 'unit'].includes(unite)) throw new Error('Unité de comparaison invalide.');
  if (!String(codeBarres ?? '').trim()) throw new Error('Code-barres absent.');
  if (!Number.isSafeInteger(format) || format <= 0) throw new Error('Format invalide.');
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(['ProductType', 'Article'], 'readwrite');
    const types = tx.objectStore('ProductType'), articles = tx.objectStore('Article');
    let jeton = null, echec = null;
    const rq = types.index('nomNormalise').get(normalise);
    rq.onsuccess = () => {
      let type = rq.result;
      if (type && type.unite !== unite) { echec = new Error('Ce type se compare en ' + type.unite + '.'); tx.abort(); return; }
      const ajouterArticle = (t, cree, restaure) => {
        jeton = { codeBarres: String(codeBarres).trim(), typeId: t.id, typeCree: cree, typeRestaure: restaure };
        articles.put({ codeBarres: jeton.codeBarres, type: t.id, format, marque: String(marque).trim(), nom: String(nomArticle).trim() });
      };
      if (!type) {
        const nouveau = { nom: n, nomNormalise: normalise, unite, marque: String(marque).trim(), nomArticle: String(nomArticle).trim(), archive: 0 };
        const ajout = types.add(nouveau);
        ajout.onsuccess = () => ajouterArticle({ ...nouveau, id: ajout.result }, true, false);
        ajout.onerror = () => { echec = ajout.error; };
      } else {
        const restaure = Boolean(type.archive);
        if (restaure) { type = { ...type, archive: 0 }; types.put(type); }
        ajouterArticle(type, false, restaure);
      }
    };
    rq.onerror = () => { echec = rq.error; };
    tx.oncomplete = () => resolve({ type: jeton && jeton.typeId, jeton, typeCree: Boolean(jeton?.typeCree), typeRestaure: Boolean(jeton?.typeRestaure), nom: n });
    tx.onerror = () => reject(echec || tx.error);
    tx.onabort = () => reject(echec || tx.error || new Error('Création du rattachement annulée.'));
  });
}

export function annulerCreationTypeEtArticle(jeton) {
  if (!jeton || !jeton.codeBarres || !Number.isSafeInteger(jeton.typeId)) return Promise.reject(new Error('Jeton d’annulation invalide.'));
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(['ProductType', 'Article'], 'readwrite');
    tx.objectStore('Article').delete(jeton.codeBarres);
    const types = tx.objectStore('ProductType');
    if (jeton.typeCree) types.delete(jeton.typeId);
    else if (jeton.typeRestaure) {
      const rq = types.get(jeton.typeId);
      rq.onsuccess = () => { if (rq.result) types.put({ ...rq.result, archive: 1 }); };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Annulation impossible.'));
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
  if (!Array.isArray(liste) || !liste.length) return Promise.resolve({ ajoutes: [], remplaces: [], achatsDelies: [] });
  return (async () => {
    const analyses = await analyserDoublons(liste);
    return new Promise((resolve, reject) => {
      const t = _db.transaction(['Observation', 'Purchase'], 'readwrite');
      const store = t.objectStore('Observation');
      const achats = t.objectStore('Purchase');
      const ajoutes = [], remplaces = [], achatsDelies = [];
      for (let i = 0; i < liste.length; i++) {
        const analyse = analyses[i];
        if (analyse.decision === 'conserver' && !remplacements[i]) continue;
        const existant = analyse.existant;
        if (existant) {
          remplaces.push(structuredClone(existant));
          const lies = achats.index('observation').getAll(existant.id);
          lies.onsuccess = () => {
            for (const achat of lies.result) {
              achatsDelies.push(structuredClone(achat));
              achats.put({ ...achat, observation: null });
            }
          };
          lies.onerror = () => { try { t.abort(); } catch {} };
          store.delete(existant.id);
        }
        const add = store.add(observationPropre(liste[i]));
        add.onsuccess = () => ajoutes.push(add.result);
      }
      t.oncomplete = () => resolve({ ajoutes, remplaces, achatsDelies });
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Enregistrement impossible'));
    });
  })();
}

export function annulerEnregistrement(jeton) {
  return new Promise((resolve, reject) => {
    if (!jeton) return resolve();
    const t = _db.transaction(['Observation', 'Purchase'], 'readwrite');
    const s = t.objectStore('Observation');
    for (const id of jeton.ajoutes || []) s.delete(id);
    for (const original of jeton.remplaces || []) s.put(original);
    for (const achat of jeton.achatsDelies || []) t.objectStore('Purchase').put(achat);
    for (const id of jeton.achats || []) t.objectStore('Purchase').delete(id);
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
  if (typeof prochain.magasin !== 'string' || !(await lireMagasin(prochain.magasin))) throw new Error('Magasin invalide.');
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

// E7 / FR26 — l'achat conserve ses prix figés même si son relevé est supprimé.
export function supprimerReleve(id) {
  return new Promise((resolve, reject) => {
    const t = _db.transaction(['Observation', 'Purchase'], 'readwrite');
    const observations = t.objectStore('Observation');
    const achats = t.objectStore('Purchase');
    const lies = achats.index('observation').getAll(id);
    lies.onsuccess = () => {
      for (const achat of lies.result) achats.put({ ...achat, observation: null });
      observations.delete(id);
    };
    lies.onerror = () => { try { t.abort(); } catch {} };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('Suppression du relevé impossible'));
    t.onabort = () => reject(t.error || new Error('Suppression du relevé annulée'));
  });
}

// FR23 / E7.1 — achat associé au relevé enregistré, sans dépendance réseau.
export async function enregistrerAchat({ type, observation, magasin, date, achete, quantite = 1, prixPayeCentimes, format, prixComparaisonCentimes = null, prixHabituelMemeMagasinCentimes = null, magasinComparaison = '' }) {
  if (!Number.isInteger(type) || type <= 0 || !Number.isInteger(observation) || observation <= 0) {
    throw new Error('Type ou relevé invalide pour cet achat.');
  }
  if (typeof magasin !== 'string' || !(await lireMagasin(magasin))) throw new Error('Magasin invalide.');
  if (magasinComparaison && !(await lireMagasin(magasinComparaison))) throw new Error('Magasin de comparaison invalide.');
  if (!dateValide(date)) throw new Error('Date invalide.');
  if (!Number.isInteger(prixPayeCentimes) || prixPayeCentimes <= 0) throw new Error('Prix payé invalide.');
  if (!Number.isInteger(format) || format <= 0) throw new Error('Format invalide.');
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > 999) throw new Error('Quantité invalide.');
  for (const valeur of [prixComparaisonCentimes, prixHabituelMemeMagasinCentimes]) {
    if (valeur !== null && (!Number.isInteger(valeur) || valeur <= 0)) throw new Error('Prix de comparaison invalide.');
  }
  return ajouter('Purchase', {
    type, observation, magasin, date, achete: achete ? 1 : 0, quantite,
    prixPayeCentimes, format, prixComparaisonCentimes, prixHabituelMemeMagasinCentimes, magasinComparaison: magasinComparaison || ''
  });
}

// FR20 / E8.1 — lecture cohérente des collections pour l'export JSON.
export function exporterCollections() {
  return new Promise((resolve, reject) => {
    const resultat = {};
    const correspondances = [
      ['ProductType', 'types'], ['Article', 'articles'], ['Observation', 'releves'],
      ['Purchase', 'achats'], ['Settings', 'reglages'], ['Store', 'magasins']
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
    ['Purchase', payload.achats], ['Settings', payload.reglages], ['Store', Array.isArray(payload.magasins) ? payload.magasins : MAGASINS_INITIAUX]
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


// FR24 / FR25 — historique, modification et suppression d'un achat.
export async function listerAchats(typeId) {
  if (!Number.isInteger(Number(typeId)) || Number(typeId) <= 0) return [];
  return (await toutLire('Purchase')).filter(a => a.type === Number(typeId))
    .sort((a,b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id || 0) - (a.id || 0));
}

export async function modifierAchat(id, champs = {}) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw new Error('Achat invalide.');
  const actuel = await lire('Purchase', Number(id));
  if (!actuel) throw new Error('Achat introuvable.');
  const prochain = { ...actuel };
  if (Object.prototype.hasOwnProperty.call(champs,'prixPayeCentimes')) prochain.prixPayeCentimes = champs.prixPayeCentimes;
  if (Object.prototype.hasOwnProperty.call(champs,'format')) prochain.format = champs.format;
  if (Object.prototype.hasOwnProperty.call(champs,'quantite')) prochain.quantite = champs.quantite;
  if (Object.prototype.hasOwnProperty.call(champs,'date')) prochain.date = champs.date;
  if (!dateValide(prochain.date)) throw new Error('Date d’achat invalide.');
  if (!Number.isInteger(prochain.prixPayeCentimes) || prochain.prixPayeCentimes <= 0) throw new Error('Prix payé invalide.');
  if (!Number.isInteger(prochain.format) || prochain.format <= 0) throw new Error('Format acheté invalide.');
  if (!Number.isInteger(prochain.quantite) || prochain.quantite < 1 || prochain.quantite > 999) throw new Error('Quantité invalide.');
  await mettre('Purchase', prochain);
  return prochain;
}

export async function supprimerAchat(id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw new Error('Achat invalide.');
  return supprimer('Purchase', Number(id));
}
