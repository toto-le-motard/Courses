// domain.js — fonctions pures du domaine (aucune dépendance à la base ni au navigateur).
// Stories 3-1 (unités, prix normalisé), 3-3 (références), 3-4 (verdict).
// Conventions : prix en centimes ; formats en unités de base entières (g, ml, unit) ;
// dates AAAA-MM-JJ ; prix normalisé calculé, jamais stocké.

export const MAGASIN = Object.freeze({ LECLERC: 'leclerc', INTERMARCHE: 'intermarche' });
export const VERDICT = Object.freeze({ ACHETER_ICI: 'acheter ici', ATTENDRE: 'attendre', INDIFFERENT: 'indifférent', INSUFFISANT: 'données insuffisantes' });
export const SEUIL_DEFAUT_PCT = 5;
/**
 * Calcule les positions du dock et du bandeau d'annulation dans le viewport.
 * hauteurFenetre : hauteur du layout viewport ; hauteurVisible / offsetTop : visualViewport.
 */
export function calculerPositionDock({ hauteurFenetre, offsetTop = 0, hauteurVisible, hauteurDock, hauteurOnglets, zoneSecurite = 12 }) {
  const hFenetre = Number.isFinite(hauteurFenetre) && hauteurFenetre > 0 ? hauteurFenetre : 0;
  const hVisible = Number.isFinite(hauteurVisible) && hauteurVisible > 0 ? hauteurVisible : hFenetre;
  const topVisible = Math.max(0, Number.isFinite(offsetTop) ? offsetTop : 0);
  const inset = Math.max(0, hFenetre - (topVisible + hVisible));
  const hDock = Math.max(0, Number.isFinite(hauteurDock) ? hauteurDock : 0);
  const hOnglets = Math.max(0, Number.isFinite(hauteurOnglets) ? hauteurOnglets : 0);
  const marge = Math.max(0, Number.isFinite(zoneSecurite) ? zoneSecurite : 0);
  const bottomDock = inset + hOnglets + marge * 2;
  return {
    clavierInset: inset,
    bottomDock,
    topDock: hFenetre - bottomDock - hDock,
    bottomAnnulation: bottomDock + hDock + 28,
  };
}

export const FENETRE_JOURS = 56;
export const MIN_RELEVES_REFERENCE = 3;
const EPSILON = 1e-9;

// Fonctions E2 conservées lors de la fusion avec le lot C.
export const UNITES = ['kg', 'l', 'unit'];
export const LIBELLE_UNITE = Object.freeze({ g: 'g', kg: 'kg', ml: 'ml', l: 'l', unit: 'unités' });
export function normaliserNom(texte) {
  return String(texte == null ? '' : texte).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
export function nomTypeValide(nom) {
  const n = String(nom == null ? '' : nom).trim();
  return n.length >= 1 && n.length <= 60;
}

const UNITES_DETAIL = Object.freeze({
  g: { type: 'kg', versBase: 1 }, kg: { type: 'kg', versBase: 1000 },
  ml: { type: 'l', versBase: 1 }, l: { type: 'l', versBase: 1000 },
  unit: { type: 'unit', versBase: 1 },
});
const DIVISEUR = Object.freeze({ kg: 1000, l: 1000, unit: 1 });

export function formatAffichage(valeurBase, uniteType) {
  const petiteUnite = uniteType === 'kg' ? 'g' : uniteType === 'l' ? 'ml' : uniteType === 'unit' ? 'unit' : null;
  if (!petiteUnite || typeof valeurBase !== 'number' || !Number.isFinite(valeurBase) || valeurBase <= 0) {
    return { valeur: '', unite: petiteUnite };
  }
  const base = Math.round(valeurBase);
  const enGrandeUnite = (uniteType === 'kg' || uniteType === 'l') && base >= 1000;
  const unite = enGrandeUnite ? uniteType : petiteUnite;
  const valeur = enGrandeUnite ? base / 1000 : base;
  return { valeur: valeur.toLocaleString('fr-FR', { maximumFractionDigits: 3 }), unite };
}

export function unitesCompatibles(typeUnit) {
  switch (typeUnit) {
    case 'kg': return ['g', 'kg'];
    case 'l': return ['ml', 'l'];
    case 'unit': return ['unit'];
    default: return [];
  }
}
export function estCompatible(typeUnit, unite) { return unitesCompatibles(typeUnit).includes(unite); }
export function versUniteDeBase(valeur, unite) {
  const u = UNITES_DETAIL[unite];
  if (!u || typeof valeur !== 'number' || !Number.isFinite(valeur) || valeur <= 0) return null;
  const base = Math.round(valeur * u.versBase);
  return base >= 1 ? base : null;
}
export function convertir(valeur, de, vers) {
  const a = UNITES_DETAIL[de], b = UNITES_DETAIL[vers];
  if (!a || !b || a.type !== b.type || typeof valeur !== 'number' || !Number.isFinite(valeur)) return null;
  return (valeur * a.versBase) / b.versBase;
}
export function verifierFormat(typeUnit, valeur, unite) {
  if (!UNITES_DETAIL[unite]) return { ok: false, erreur: 'format-invalide', uniteAttendue: typeUnit };
  if (!estCompatible(typeUnit, unite)) return { ok: false, erreur: 'format-incompatible', uniteAttendue: typeUnit };
  const formatBase = versUniteDeBase(valeur, unite);
  if (formatBase === null) return { ok: false, erreur: 'format-invalide', uniteAttendue: typeUnit };
  return { ok: true, formatBase };
}
export function arrondirCentimes(x) { return Math.sign(x) * Math.round(Math.abs(x)); }

export function trierReleves(releves) {
  return [...(Array.isArray(releves) ? releves : [])].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id || 0) - (a.id || 0)
  );
}

export function estPrixIncoherent(nouveauNormalise, dernierNormalise) {
  if (dernierNormalise == null) return false;
  if (!(nouveauNormalise > 0) || !(dernierNormalise > 0)) return false;
  return Math.abs(nouveauNormalise - dernierNormalise) / dernierNormalise > 0.5;
}
export function cleDoublon(o) {
  return [o.type, o.magasin, o.date, o.promo ? 1 : 0];
}

export function analyserDoublon(existant, nouveau, unite) {
  if (!existant) return { existant: null, decision: 'ajouter', nExistant: null, nNouveau: prixNormalise(nouveau.prixCentimes, nouveau.format, unite).centimesParUnite ?? null };
  const nExistantResult = prixNormalise(existant.prixCentimes, existant.format, unite);
  const nNouveauResult = prixNormalise(nouveau.prixCentimes, nouveau.format, unite);
  const nExistant = nExistantResult.ok ? nExistantResult.centimesParUnite : null;
  const nNouveau = nNouveauResult.ok ? nNouveauResult.centimesParUnite : null;
  return { existant, decision: decisionDoublon(nExistant, nNouveau), nExistant, nNouveau };
}

export function decisionDoublon(existantNormalise, nouveauNormalise) {
  if (existantNormalise == null) return 'ajouter';
  if (!(nouveauNormalise > 0)) return 'conserver';
  return nouveauNormalise <= existantNormalise ? 'remplacer' : 'conserver';
}

export function analyserPrixSaisie(saisie) {
  const brut = String(saisie == null ? '' : saisie).trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(brut)) return null;
  const valeur = Number(brut);
  if (!Number.isFinite(valeur) || valeur <= 0) return null;
  const centimes = arrondirCentimes(valeur * 100);
  return centimes > 0 ? centimes : null;
}

export function formaterPrixEuros(centimes) {
  if (typeof centimes !== 'number' || !Number.isFinite(centimes)) return '';
  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function formaterPrixNormalise(centimesParUnite, typeUnit) {
  if (typeof centimesParUnite !== 'number' || !Number.isFinite(centimesParUnite) || centimesParUnite <= 0) return '';
  return formaterPrixEuros(arrondirCentimes(centimesParUnite)) + '/' + (LIBELLE_UNITE[typeUnit] || typeUnit); 
}
export function prixNormalise(prixCentimes, formatBase, typeUnit) {
  if (!(typeUnit in DIVISEUR)) return { ok: false, erreur: 'type-inconnu' };
  if (typeof prixCentimes !== 'number' || !Number.isFinite(prixCentimes) || prixCentimes <= 0) return { ok: false, erreur: 'prix-invalide' };
  if (typeof formatBase !== 'number' || !Number.isFinite(formatBase) || formatBase <= 0) return { ok: false, erreur: 'format-invalide' };
  return { ok: true, centimesParUnite: (prixCentimes * DIVISEUR[typeUnit]) / formatBase };
}
function parserDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const [a, m, j] = s.split('-').map(Number), t = Date.UTC(a, m - 1, j), d = new Date(t);
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j ? t : NaN;
}
export function joursEntre(debut, fin) {
  const a = parserDate(debut), b = parserDate(fin);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

// Seul point d'adaptation aux champs de db.js. db.js utilise format et promo: 0|1.
function normaliserObservation(o, typeUnit) {
  if (!o) return null;
  const n = prixNormalise(o.prixCentimes ?? o.prix ?? o.priceCents, o.formatBase ?? o.format, typeUnit);
  if (!n.ok || Number.isNaN(parserDate(o.date))) return null;
  return { magasin: o.magasin ?? o.store, date: o.date, promo: Boolean(o.promo ?? o.isPromo), valeur: n.centimesParUnite };
}
function normaliserTous(observations, typeUnit, magasin) {
  return (Array.isArray(observations) ? observations : []).map((o) => normaliserObservation(o, typeUnit)).filter((o) => o && o.magasin === magasin);
}
export function mediane(valeurs) {
  if (!valeurs.length) return null;
  const t = [...valeurs].sort((x, y) => x - y), m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}
function dernierConnu(normalises) {
  if (!normalises.length) return null;
  const tri = [...normalises].sort((x, y) => {
    if (x.date !== y.date) return x.date < y.date ? 1 : -1;
    if (x.promo !== y.promo) return x.promo ? 1 : -1;
    return x.valeur - y.valeur;
  });
  const d = tri[0];
  return { date: d.date, valeur: d.valeur, promo: d.promo };
}
export function referenceLeclerc(observations, typeUnit, aujourdhui) {
  const tous = normaliserTous(observations, typeUnit, MAGASIN.LECLERC);
  const retenus = tous.filter((o) => !o.promo && (() => { const j = joursEntre(o.date, aujourdhui); return j >= 0 && j <= FENETRE_JOURS; })());
  if (retenus.length < MIN_RELEVES_REFERENCE) return { ok: false, raison: 'releves-insuffisants', nbReleves: retenus.length, dernierConnu: dernierConnu(tous) };
  return { ok: true, magasin: MAGASIN.LECLERC, type: 'mediane', valeur: mediane(retenus.map((o) => o.valeur)), nbReleves: retenus.length, fenetreJours: FENETRE_JOURS };
}
export function habituelIntermarche(observations, typeUnit) {
  const tous = normaliserTous(observations, typeUnit, MAGASIN.INTERMARCHE), horsPromo = tous.filter((o) => !o.promo);
  if (!horsPromo.length) return { ok: false, raison: 'aucun-releve-hors-promo', nbReleves: 0, dernierConnu: dernierConnu(tous) };
  const d = [...horsPromo].sort((x, y) => x.date !== y.date ? (x.date < y.date ? 1 : -1) : x.valeur - y.valeur)[0];
  return { ok: true, magasin: MAGASIN.INTERMARCHE, type: 'dernier', valeur: d.valeur, date: d.date };
}
export function autreMagasin(magasin) {
  if (magasin === MAGASIN.LECLERC) return MAGASIN.INTERMARCHE;
  if (magasin === MAGASIN.INTERMARCHE) return MAGASIN.LECLERC;
  return null;
}
export function prixHabituel(observations, magasin, typeUnit, aujourdhui) {
  if (magasin === MAGASIN.LECLERC) return referenceLeclerc(observations, typeUnit, aujourdhui);
  if (magasin === MAGASIN.INTERMARCHE) return habituelIntermarche(observations, typeUnit);
  return { ok: false, raison: 'magasin-inconnu', nbReleves: 0, dernierConnu: null };
}
export function prixHabituelAutreMagasin(observations, magasinCourant, typeUnit, aujourdhui) {
  return prixHabituel(observations, autreMagasin(magasinCourant), typeUnit, aujourdhui);
}
function seuilFraction(seuilPct) {
  const s = typeof seuilPct === 'number' && Number.isFinite(seuilPct) && seuilPct >= 0 ? seuilPct : SEUIL_DEFAUT_PCT;
  return s / 100;
}
export function calculerVerdict({ prixCentimes, formatBase, typeUnit, magasin, observations, aujourdhui, seuilPct, promo = false }) {
  const autre = autreMagasin(magasin), base = { magasin, autreMagasin: autre, promo: Boolean(promo) };
  const jour = prixNormalise(prixCentimes, formatBase, typeUnit);
  if (!autre || !jour.ok) return { ...base, resultat: VERDICT.INSUFFISANT, raison: autre ? 'saisie-invalide' : 'magasin-inconnu', erreur: jour.ok ? null : jour.erreur, dernierConnu: null };
  const habituel = prixHabituel(observations, autre, typeUnit, aujourdhui);
  if (!habituel.ok || !(habituel.valeur > 0)) return { ...base, resultat: VERDICT.INSUFFISANT, raison: habituel.raison ?? 'releves-insuffisants', nbReleves: habituel.nbReleves ?? 0, dernierConnu: habituel.dernierConnu ?? null };
  const seuil = seuilFraction(seuilPct), ecart = (jour.centimesParUnite - habituel.valeur) / habituel.valeur;
  let resultat = VERDICT.INDIFFERENT;
  if (ecart <= -seuil + EPSILON) resultat = VERDICT.ACHETER_ICI;
  else if (ecart >= seuil - EPSILON) resultat = VERDICT.ATTENDRE;
  const diffUnite = jour.centimesParUnite - habituel.valeur;
  const diffFormat = (diffUnite * formatBase) / DIVISEUR[typeUnit];
  return { ...base, resultat, ecart, seuil, prixJourNormalise: jour.centimesParUnite, habituelAutre: habituel, differenceUniteCentimes: arrondirCentimes(diffUnite), differenceFormatCentimes: arrondirCentimes(diffFormat) };
}
