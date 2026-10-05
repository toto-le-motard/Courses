// domain.js — fonctions pures du domaine (aucune dépendance à la base ni au navigateur).
// Chaque fonction est couverte par tests.html (DoD2), avec le numéro d'exigence.

export const UNITES = ['kg', 'l', 'unit'];
export const LIBELLE_UNITE = { kg: 'kg', l: 'l', unit: 'unité' };

// FR1 : nom de type unique, insensible à la casse et aux accents.
export function normaliserNom(texte) {
  return String(texte == null ? '' : texte)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// FR1 : un nom de type est valide s'il n'est pas vide et fait au plus 60 caractères.
export function nomTypeValide(nom) {
  const n = String(nom == null ? '' : nom).trim();
  return n.length >= 1 && n.length <= 60;
}
