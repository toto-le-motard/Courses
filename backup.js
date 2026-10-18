// Sauvegarde JSON versionnée — FR20 (E8.1/E8.2).
// Ce module est pur : il ne lit ni le navigateur ni IndexedDB.

function dateIsoValide(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [a, m, j] = date.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

export function creerSauvegarde({ schemaVersion, types, articles, releves, achats, reglages, magasins = null, magasinReference = null, dateExport }) {
  const magasinsPropres = (Array.isArray(magasins) ? magasins : []).map(m => { const copie = { ...m }; delete copie.comparable; return copie; });
  const reference = magasinReference || reglages.find(r => r.cle === 'magasinReference')?.valeur || null;
  return { schemaVersion, dateExport, types, articles, releves, achats, reglages, magasins: magasinsPropres, magasinReference: reference };
}

export function validerSauvegarde(payload, schemaVersionAttendu) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, erreur: "Le fichier ne contient pas une sauvegarde JSON valide." };
  }
  const ancienneVersion = Number.isInteger(payload.schemaVersion) && payload.schemaVersion >= 1 && payload.schemaVersion < schemaVersionAttendu;
  const ancienneSansMagasins = ancienneVersion && !Array.isArray(payload.magasins);
  if (!Number.isInteger(payload.schemaVersion) || (payload.schemaVersion !== schemaVersionAttendu && !ancienneVersion)) {
    return { ok: false, erreur: "Version de sauvegarde inconnue ou incompatible." };
  }
  if (!dateIsoValide(payload.dateExport)) {
    return { ok: false, erreur: "La date de sauvegarde est absente ou invalide." };
  }
  const entierPositif = (v) => Number.isSafeInteger(v) && v > 0;
  const prixValide = (v) => v === null || (Number.isSafeInteger(v) && v > 0);
  const dateValide = (v) => dateIsoValide(v);
  const magasinValide = (v) => typeof v === 'string' && !!v.trim();
  const valideurs = {
    types: (v) => entierPositif(v.id) && typeof v.nom === "string" && !!v.nom.trim()
      && ["kg", "l", "unit"].includes(v.unite)
      && (v.nomNormalise === undefined || (typeof v.nomNormalise === "string" && !!v.nomNormalise.trim()))
      && (v.archive === undefined || v.archive === 0 || v.archive === 1)
      && (v.marque === undefined || typeof v.marque === "string")
      && (v.nomArticle === undefined || typeof v.nomArticle === "string"),
    articles: (v) => typeof v.codeBarres === "string" && !!v.codeBarres.trim()
      && entierPositif(v.type) && entierPositif(v.format)
      && (v.marque === undefined || typeof v.marque === "string")
      && (v.nom === undefined || typeof v.nom === "string")
      && (v.nomArticle === undefined || typeof v.nomArticle === "string"),
    releves: (v) => entierPositif(v.id) && entierPositif(v.type) && magasinValide(v.magasin)
      && dateValide(v.date) && Number.isSafeInteger(v.prixCentimes) && v.prixCentimes > 0
      && entierPositif(v.format ?? v.formatBase)
      && (v.promo === 0 || v.promo === 1),
    achats: (v) => entierPositif(v.id) && entierPositif(v.type)
      && (v.observation === null || entierPositif(v.observation))
      && magasinValide(v.magasin) && dateValide(v.date)
      && (v.achete === 0 || v.achete === 1)
      && Number.isSafeInteger(v.quantite) && v.quantite >= 1 && v.quantite <= 999
      && Number.isSafeInteger(v.prixPayeCentimes) && v.prixPayeCentimes > 0
      && entierPositif(v.format) && prixValide(v.prixComparaisonCentimes)
      && prixValide(v.prixHabituelMemeMagasinCentimes)
      && (v.magasinComparaison === undefined || typeof v.magasinComparaison === 'string'),
    reglages: (v) => typeof v.cle === "string" && !!v.cle.trim()
      && Object.prototype.hasOwnProperty.call(v, "valeur"),
    magasins: (v) => typeof v.id === 'string' && !!v.id.trim() && typeof v.nom === 'string' && !!v.nom.trim()
      && (v.enseigne === undefined || typeof v.enseigne === 'string')
      && (v.localisation === undefined || typeof v.localisation === 'string')
      && typeof v.couleur === 'string' && /^#[0-9a-f]{6}$/i.test(v.couleur)
      && ['mediane','dernier'].includes(v.modePrixHabituel)
      && typeof v.archive === 'boolean' && Number.isInteger(v.ordre) && v.ordre > 0
  };
  if (ancienneSansMagasins) {
    payload.magasins = [
      { id: 'leclerc', nom: 'Leclerc', nomNormalise: 'leclerc', enseigne: 'Leclerc', localisation: '', couleur: '#5B8CFF', modePrixHabituel: 'mediane', archive: false, ordre: 1 },
      { id: 'intermarche', nom: 'Intermarché', nomNormalise: 'intermarche', enseigne: 'Intermarché', localisation: '', couleur: '#FF6B5E', modePrixHabituel: 'dernier', archive: false, ordre: 2 }
    ];
    if (Array.isArray(payload.achats)) payload.achats = payload.achats.map(a => ({ ...a, magasinComparaison: '' }));
    payload.schemaVersion = schemaVersionAttendu;
  }
  if (Array.isArray(payload.magasins)) payload.magasins = payload.magasins.map(m => { const copie = { ...m }; delete copie.comparable; return copie; });
  for (const cle of Object.keys(valideurs)) {
    if (!Array.isArray(payload[cle]) || payload[cle].some((item) =>
      !item || typeof item !== "object" || Array.isArray(item) || !valideurs[cle](item))) {
      return { ok: false, erreur: "La sauvegarde est invalide : collection « " + cle + " » absente ou contenant un enregistrement incorrect." };
    }
  }
  const magasinsIds = new Set(payload.magasins.map(m => m.id));
  if (payload.magasins.some(m => !m || typeof m.id !== 'string') || payload.magasins.some((m,i) => payload.magasins.some((n,j) => j < i && n.id === m.id))) return { ok: false, erreur: 'La sauvegarde contient des identifiants de magasin en double ou invalides.' };
  const nomsMagasins = new Set();
  for (const m of payload.magasins) { const n = String(m.nom).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLocaleLowerCase('fr').trim().replace(/\\s+/g,' '); if (nomsMagasins.has(n)) return { ok:false, erreur:'La sauvegarde contient des noms de magasin en double.' }; nomsMagasins.add(n); }
  if (payload.releves.some(o => !magasinsIds.has(o.magasin)) || payload.achats.some(a => !magasinsIds.has(a.magasin))) return { ok:false, erreur:'La sauvegarde contient un relevé ou un achat rattaché à un magasin absent.' };
  payload.achats = payload.achats.map(a => ({ ...a, magasinComparaison: a.magasinComparaison ?? '' }));
  const actifs = payload.magasins.filter(m => !m.archive).sort((a,b) => (a.ordre || 0) - (b.ordre || 0) || a.nom.localeCompare(b.nom, 'fr'));
  const referenceDemandee = typeof payload.magasinReference === 'string' ? payload.magasinReference : '';
  const reference = actifs.find(m => m.id === referenceDemandee) || actifs.find(m => m.id === 'leclerc') || actifs[0];
  payload.magasinReference = reference?.id || '';
  const reglageReference = payload.reglages.findIndex(r => r.cle === 'magasinReference');
  if (reglageReference >= 0) payload.reglages[reglageReference] = { cle: 'magasinReference', valeur: payload.magasinReference };
  else payload.reglages.push({ cle: 'magasinReference', valeur: payload.magasinReference });
  payload.schemaVersion = schemaVersionAttendu;
  const typeIds = new Set(payload.types.map((item) => item.id));
  if (["articles", "releves", "achats"].some((cle) => payload[cle].some((item) => !typeIds.has(item.type)))) {
    return { ok: false, erreur: "La sauvegarde contient un article, un relevé ou un achat sans type existant." };
  }
  const releveIds = new Set(payload.releves.map((item) => item.id));
  if (payload.achats.some((item) => item.observation !== null && !releveIds.has(item.observation))) {
    return { ok: false, erreur: "La sauvegarde contient un achat lié à un relevé absent." };
  }
  const uniques = [
    ["types", "id"], ["types", "nomNormalise"], ["articles", "codeBarres"],
    ["releves", "id"], ["achats", "id"], ["reglages", "cle"], ["magasins", "id"]
  ];
  for (const [collection, cle] of uniques) {
    const vus = new Set();
    for (const item of payload[collection]) {
      const valeur = cle === "nomNormalise" ? (item.nomNormalise || item.nom.trim().toLocaleLowerCase("fr")) : item[cle];
      if (vus.has(valeur)) return { ok: false, erreur: "La sauvegarde contient un doublon dans « " + collection + " »." };
      vus.add(valeur);
    }
  }
  return { ok: true, valeur: payload };
}

// FR20 / E8.3 — état du rappel selon une date courante injectable pour les tests.
export function etatRappelExport(dateDernierExport, dateCourante, delaiJours = 30) {
  if (!dateDernierExport) return 'jamais';
  if (!dateIsoValide(dateDernierExport) || !dateIsoValide(dateCourante) || !Number.isInteger(delaiJours) || delaiJours < 0) return 'retard';
  const [a1,m1,j1] = dateDernierExport.split('-').map(Number);
  const [a2,m2,j2] = dateCourante.split('-').map(Number);
  const ecart = Math.floor((Date.UTC(a2,m2-1,j2)-Date.UTC(a1,m1-1,j1))/86400000);
  return ecart > delaiJours ? 'retard' : 'ok';
}
