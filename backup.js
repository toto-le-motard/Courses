// Sauvegarde JSON versionnée — FR20 (E8.1/E8.2).
// Ce module est pur : il ne lit ni le navigateur ni IndexedDB.

function dateIsoValide(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [a, m, j] = date.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

export function creerSauvegarde({ schemaVersion, types, articles, releves, achats, reglages, dateExport }) {
  return { schemaVersion, dateExport, types, articles, releves, achats, reglages };
}

export function validerSauvegarde(payload, schemaVersionAttendu) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, erreur: "Le fichier ne contient pas une sauvegarde JSON valide." };
  }
  if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion !== schemaVersionAttendu) {
    return { ok: false, erreur: "Version de sauvegarde inconnue ou incompatible." };
  }
  if (!dateIsoValide(payload.dateExport)) {
    return { ok: false, erreur: "La date de sauvegarde est absente ou invalide." };
  }
  const entierPositif = (v) => Number.isSafeInteger(v) && v > 0;
  const prixValide = (v) => v === null || (Number.isSafeInteger(v) && v > 0);
  const dateValide = (v) => dateIsoValide(v);
  const magasinValide = (v) => v === "leclerc" || v === "intermarche";
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
      && (v.promo === 0 || v.promo === 1 || typeof v.promo === "boolean"),
    achats: (v) => entierPositif(v.id) && entierPositif(v.type)
      && (v.observation === null || entierPositif(v.observation))
      && magasinValide(v.magasin) && dateValide(v.date)
      && (v.achete === 0 || v.achete === 1 || typeof v.achete === "boolean")
      && Number.isSafeInteger(v.quantite) && v.quantite >= 1 && v.quantite <= 999
      && Number.isSafeInteger(v.prixPayeCentimes) && v.prixPayeCentimes > 0
      && entierPositif(v.format) && prixValide(v.prixComparaisonCentimes)
      && prixValide(v.prixHabituelMemeMagasinCentimes),
    reglages: (v) => typeof v.cle === "string" && !!v.cle.trim()
      && Object.prototype.hasOwnProperty.call(v, "valeur")
  };
  for (const cle of Object.keys(valideurs)) {
    if (!Array.isArray(payload[cle]) || payload[cle].some((item) =>
      !item || typeof item !== "object" || Array.isArray(item) || !valideurs[cle](item))) {
      return { ok: false, erreur: "La sauvegarde est invalide : collection « " + cle + " » absente ou contenant un enregistrement incorrect." };
    }
  }
  const uniques = [
    ["types", "id"], ["types", "nomNormalise"], ["articles", "codeBarres"],
    ["releves", "id"], ["achats", "id"], ["reglages", "cle"]
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
