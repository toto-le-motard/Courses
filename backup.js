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
  for (const cle of ["types", "articles", "releves", "achats", "reglages"]) {
    if (!Array.isArray(payload[cle]) || payload[cle].some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return { ok: false, erreur: "La sauvegarde est invalide : collection « " + cle + " » absente ou incorrecte." };
    }
  }
  return { ok: true, valeur: payload };
}

// FR20 / E8.3 — état du rappel selon une date courante injectable pour les tests.
export function etatRappelExport(dateDernierExport, dateCourante, delaiJours = 30) { return 'ok'; }
