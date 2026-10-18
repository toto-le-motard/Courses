// domain.js — fonctions pures du domaine (aucune dépendance à la base ni au navigateur).
// Stories 3-1 (unités, prix normalisé), 3-3 (références), 3-4 (verdict).
// Conventions : prix en centimes ; formats en unités de base entières (g, ml, unit) ;
// dates AAAA-MM-JJ ; prix normalisé calculé, jamais stocké.

export const VERDICT = Object.freeze({ ACHETER_ICI: 'acheter ici', ATTENDRE: 'attendre', INDIFFERENT: 'indifférent', INSUFFISANT: 'données insuffisantes' });
export const SEUIL_DEFAUT_PCT = 5;
/**
 * Calcule les positions du dock et du bandeau d'annulation dans le viewport.
 * hauteurFenetre : hauteur du layout viewport ; hauteurVisible / offsetTop : visualViewport.
 */
export function modeSaisieActif(hauteurFenetre, hauteurVisible) {
  return Number.isFinite(hauteurFenetre) && hauteurFenetre > 0
    && Number.isFinite(hauteurVisible) && hauteurVisible > 0
    && hauteurFenetre - hauteurVisible > 150;
}
export function positionDefilement(rectChamp, hautZone, basZone, marge = 12) {
  if (!rectChamp || !Number.isFinite(rectChamp.top) || !Number.isFinite(rectChamp.bottom)
    || !Number.isFinite(hautZone) || !Number.isFinite(basZone) || basZone <= hautZone) return 0;
  const m = Number.isFinite(marge) && marge >= 0 ? marge : 12;
  if (rectChamp.top < hautZone + m) return rectChamp.top - (hautZone + m);
  if (rectChamp.bottom > basZone - m) return rectChamp.bottom - (basZone - m);
  return 0;
}
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
export function deduireUniteComparaison(uniteFormat) {
  const unite = UNITES_DETAIL[uniteFormat];
  return unite ? unite.type : null;
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
function seuilFraction(seuilPct) {
  const s = typeof seuilPct === 'number' && Number.isFinite(seuilPct) && seuilPct >= 0 ? seuilPct : SEUIL_DEFAUT_PCT;
  return s / 100;
}
// FR26 / E7.4 — économie estimée à partir des prix figés dans l’achat, sans relire l’historique courant.
export function calculerEconomieRealisee(achat, typeUnit) {
  const base = { ok: false, compte: false, exclu: false, raison: 'donnees-invalides', economieCentimes: null, gainPromoCentimes: null };
  if (!achat || typeof achat !== 'object' || !(typeUnit in DIVISEUR)) return base;
  if (!(achat.achete === 1 || achat.achete === true)) {
    return { ok: true, compte: false, exclu: false, raison: 'non-achat', economieCentimes: 0, gainPromoCentimes: 0 };
  }
  if (!Number.isInteger(achat.quantite) || achat.quantite < 1 || achat.quantite > 999 ||
      !Number.isInteger(achat.prixPayeCentimes) || achat.prixPayeCentimes <= 0 ||
      !Number.isInteger(achat.format) || achat.format <= 0) return base;
  for (const prix of [achat.prixComparaisonCentimes, achat.prixHabituelMemeMagasinCentimes]) {
    if (prix !== null && prix !== undefined && (!Number.isInteger(prix) || prix <= 0)) return base;
  }
  if (Object.prototype.hasOwnProperty.call(achat, 'magasinComparaison') && !achat.magasinComparaison) {
    return { ok: true, compte: false, exclu: true, raison: 'comparaison-indisponible', economieCentimes: 0, gainPromoCentimes: null };
  }
  if (achat.prixComparaisonCentimes === null || achat.prixComparaisonCentimes === undefined) {
    return { ok: true, compte: false, exclu: true, raison: 'comparaison-indisponible', economieCentimes: 0, gainPromoCentimes: null };
  }
  const paye = prixNormalise(achat.prixPayeCentimes, achat.format, typeUnit);
  if (!paye.ok) return base;
  const facteurFormat = achat.format / DIVISEUR[typeUnit] * achat.quantite;
  const economieCentimes = arrondirCentimes((achat.prixComparaisonCentimes - paye.centimesParUnite) * facteurFormat);
  const gainPromoCentimes = achat.prixHabituelMemeMagasinCentimes == null
    ? null
    : arrondirCentimes((achat.prixHabituelMemeMagasinCentimes - paye.centimesParUnite) * facteurFormat);
  return { ok: true, compte: true, exclu: false, raison: null, economieCentimes, gainPromoCentimes };
}


export function dateMoinsDouzeMois(date) {
  if (Number.isNaN(parserDate(date))) return null;
  const [annee, mois, jour] = date.split('-').map(Number);
  const cibleMoisIndex = annee * 12 + (mois - 1) - 12;
  const cibleAnnee = Math.floor(cibleMoisIndex / 12);
  const cibleMois = cibleMoisIndex - cibleAnnee * 12;
  const dernierJour = new Date(Date.UTC(cibleAnnee, cibleMois + 1, 0)).getUTCDate();
  return String(cibleAnnee).padStart(4, '0') + '-' + String(cibleMois + 1).padStart(2, '0') + '-' + String(Math.min(jour, dernierJour)).padStart(2, '0');
}

// FR26 / FR33 — cumul fondé uniquement sur les valeurs figées dans chaque achat.
export function calculerCumulEconomieAchats(achats, types, {
  dateDebut = null, dateFin = null, debutStrict = false, magasinReference = null, typeId = null
} = {}) {
  const typesParId = new Map((Array.isArray(types) ? types : []).map(t => [t.id, t]));
  const resultat = { economieCentimes: 0, gainPromoCentimes: 0, achatsExclus: 0, achatsComptes: 0, achatsAutreMagasinReference: 0, parType: [] };
  const parType = new Map();
  for (const achat of Array.isArray(achats) ? achats : []) {
    if (!achat || !(achat.achete === 1 || achat.achete === true)) continue;
    if (typeId != null && Number(achat.type) !== Number(typeId)) continue;
    if (Number.isNaN(parserDate(achat.date))) continue;
    if (dateDebut && (debutStrict ? achat.date <= dateDebut : achat.date < dateDebut)) continue;
    if (dateFin && achat.date > dateFin) continue;
    const type = typesParId.get(achat.type) || typesParId.get(Number(achat.type));
    if (!type || !(type.unite in DIVISEUR)) continue;
    const calcul = calculerEconomieRealisee(achat, type.unite);
    if (!calcul.ok) continue;
    if (calcul.exclu) { resultat.achatsExclus++; continue; }
    if (!calcul.compte) continue;
    resultat.economieCentimes += calcul.economieCentimes;
    if (calcul.gainPromoCentimes !== null) resultat.gainPromoCentimes += calcul.gainPromoCentimes;
    resultat.achatsComptes++;
    if (magasinReference && achat.magasinComparaison && achat.magasinComparaison !== magasinReference) resultat.achatsAutreMagasinReference++;
    const entree = parType.get(type.id) || { typeId: type.id, type, economieCentimes: 0, gainPromoCentimes: 0, nombreAchats: 0, achatsExclus: 0 };
    entree.economieCentimes += calcul.economieCentimes;
    if (calcul.gainPromoCentimes !== null) entree.gainPromoCentimes += calcul.gainPromoCentimes;
    entree.nombreAchats++;
    parType.set(type.id, entree);
  }
  resultat.parType = [...parType.values()];
  return resultat;
}

export function calculerEconomieSur12Mois(achats, types, dateCourante, magasinReference = null) {
  const debut = dateMoinsDouzeMois(dateCourante);
  if (!debut) return { economieCentimes: 0, gainPromoCentimes: 0, achatsExclus: 0, achatsComptes: 0, achatsAutreMagasinReference: 0, parType: [] };
  return calculerCumulEconomieAchats(achats, types, { dateDebut: debut, debutStrict: true, dateFin: dateCourante, magasinReference });
}

export function calculerEconomieDepuisDebut(achats, types, dateCourante, magasinReference = null) {
  return calculerCumulEconomieAchats(achats, types, { dateFin: dateCourante || null, magasinReference });
}

export function calculerEconomieParType(achats, types, typeId, dateDebut = null, dateFin = null, magasinReference = null) {
  return calculerCumulEconomieAchats(achats, types, { typeId, dateDebut, dateFin, magasinReference });
}

export function compterAchatsExclus(achats, types, options = {}) {
  return calculerCumulEconomieAchats(achats, types, options).achatsExclus;
}

export function compterAchatsAutreMagasinReference(achats, types, magasinReference, options = {}) {
  return calculerCumulEconomieAchats(achats, types, { ...options, magasinReference }).achatsAutreMagasinReference;
}

// FR12 / E4.1 — fréquence des relevés promo par type et par magasin.
export function frequencePromos(observations, magasin) {
  if (!Array.isArray(observations)) return { ok: false, raison: 'donnees-invalides', nbPromos: 0, nbReleves: 0, pourcentage: null };
  
  const retenus = observations.filter(o => o && o.magasin === magasin);
  if (!retenus.length) return { ok: false, raison: 'aucun-releve', nbPromos: 0, nbReleves: 0, pourcentage: null };
  const nbPromos = retenus.filter(o => o.promo === true || o.promo === 1).length;
  return { ok: true, nbPromos, nbReleves: retenus.length, pourcentage: Math.round(nbPromos * 1000 / retenus.length) / 10 };
}


// FR22 / Story 5.3 — liste comparative avant les courses.
// FR10 / FR11 / FR14 / FR18 — prix habituels et comparaison pour des magasins configurables.
// Cette API reçoit les magasins depuis l'appelant ; aucun identifiant de magasin n'y est codé en dur.
export function prixHabituelMagasin(observations, magasin, typeUnit, aujourdhui) {
  if (!magasin || typeof magasin.id !== 'string' || !['mediane', 'dernier'].includes(magasin.modePrixHabituel)) {
    return { ok: false, raison: 'magasin-invalide', nbReleves: 0, dernierConnu: null };
  }
  const tous = normaliserTous(observations, typeUnit, magasin.id);
  const horsPromo = tous.filter(o => !o.promo);
  if (magasin.modePrixHabituel === 'dernier') {
    const d = [...horsPromo].sort((a,b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id || 0) - (a.id || 0))[0];
    if (!d) return { ok: false, raison: 'aucun-releve-hors-promo', nbReleves: 0, dernierConnu: dernierConnu(tous) };
    return { ok: true, magasin: magasin.id, type: 'dernier', valeur: d.valeur, date: d.date, nbReleves: horsPromo.length, dernierConnu: dernierConnu(tous) };
  }
  const retenus = horsPromo.filter(o => { const j = joursEntre(o.date, aujourdhui); return j >= 0 && j <= FENETRE_JOURS; });
  if (retenus.length < MIN_RELEVES_REFERENCE) return { ok: false, raison: 'releves-insuffisants', nbReleves: retenus.length, dernierConnu: dernierConnu(tous) };
  return { ok: true, magasin: magasin.id, type: 'mediane', valeur: mediane(retenus.map(o => o.valeur)), nbReleves: retenus.length, fenetreJours: FENETRE_JOURS, dernierConnu: dernierConnu(tous) };
}

export function trouverMagasinComparaison({ observations, magasins, magasinCourant, typeUnit, aujourdhui }) {
  const candidats = (Array.isArray(magasins) ? magasins : [])
    .filter(m => m && !m.archive && m.id !== magasinCourant)
    .map(m => ({ magasin: m, habituel: prixHabituelMagasin(observations, m, typeUnit, aujourdhui) }))
    .filter(x => x.habituel.ok && x.habituel.valeur > 0)
    .sort((a,b) => a.habituel.valeur - b.habituel.valeur || (a.magasin.ordre || 0) - (b.magasin.ordre || 0));
  return candidats.length ? { ok: true, magasin: candidats[0].magasin, habituel: candidats[0].habituel, candidats } : { ok: false, raison: 'aucun-magasin-de-comparaison', magasin: null, habituel: null, candidats: [] };
}

export function calculerVerdictMagasins({ prixCentimes, formatBase, typeUnit, magasinCourant, magasins, observations, aujourdhui, seuilPct, promo = false }) {
  const jour = prixNormalise(prixCentimes, formatBase, typeUnit);
  const base = { magasin: magasinCourant, magasinComparaison: null, promo: Boolean(promo) };
  if (!jour.ok) return { ...base, resultat: VERDICT.INSUFFISANT, raison: 'saisie-invalide', erreur: jour.erreur, dernierConnu: null };
  const comparaison = trouverMagasinComparaison({ observations, magasins, magasinCourant, typeUnit, aujourdhui });
  if (!comparaison.ok) {
    const connus = (Array.isArray(observations) ? observations : [])
      .filter(o => o && magasins?.some(m => m.id === o.magasin))
      .map(o => ({ date: o.date, magasin: o.magasin }))
      .filter(o => typeof o.date === 'string').sort((a,b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : 0);
    return { ...base, resultat: VERDICT.INSUFFISANT, raison: 'aucun-magasin-de-comparaison', dernierConnu: connus[0] || null };
  }
  const habituel = comparaison.habituel;
  const seuil = seuilFraction(seuilPct), ecart = (jour.centimesParUnite - habituel.valeur) / habituel.valeur;
  let resultat = VERDICT.INDIFFERENT;
  if (ecart <= -seuil + EPSILON) resultat = VERDICT.ACHETER_ICI;
  else if (ecart >= seuil - EPSILON) resultat = VERDICT.ATTENDRE;
  const diffUnite = jour.centimesParUnite - habituel.valeur;
  const diffFormat = (diffUnite * formatBase) / DIVISEUR[typeUnit];
  return { ...base, magasinComparaison: comparaison.magasin.id, resultat, ecart, seuil, prixJourNormalise: jour.centimesParUnite, habituelComparaison: habituel, differenceUniteCentimes: arrondirCentimes(diffUnite), differenceFormatCentimes: arrondirCentimes(diffFormat) };
}

export function listeAvantCoursesMagasins(types, observations, magasins, seuil, dateCourante) {
  const actifs = (Array.isArray(types) ? types : []).filter(type => type && !type.archive);
  const releves = Array.isArray(observations) ? observations : [];
  const magasinsActifs = (Array.isArray(magasins) ? magasins : []).filter(m => m && !m.archive);
  return actifs.map(type => {
    const parMagasin = magasinsActifs.map(m => ({ magasin: m, habituel: prixHabituelMagasin(releves.filter(o => o && o.type === type.id), m, type.unite, dateCourante) }))
      .filter(x => x.habituel.ok && x.habituel.valeur > 0)
      .sort((a,b) => a.habituel.valeur - b.habituel.valeur || (a.magasin.ordre || 0) - (b.magasin.ordre || 0));
    const tousType = releves.filter(o => o && o.type === type.id);
    const dates = tousType.map(o => o.date).filter(Boolean).sort();
    const dateDernierPrix = dates.length ? dates[dates.length - 1] : null;
    if (parMagasin.length < 2) return { typeId: type.id, resultat: 'donnees-insuffisantes', magasin: null, prixNormaliseCentimes: parMagasin[0] ? arrondirCentimes(parMagasin[0].habituel.valeur) : null, economiePourcent: null, dateDernierPrix };
    const moinsCher = parMagasin[0], deuxieme = parMagasin[1], ecart = (moinsCher.habituel.valeur - deuxieme.habituel.valeur) / deuxieme.habituel.valeur;
    const resultat = ecart <= -seuilFraction(seuil) + EPSILON ? moinsCher.magasin.id : 'indifferent';
    return { typeId: type.id, resultat, magasin: resultat === 'indifferent' ? null : moinsCher.magasin.id, prixNormaliseCentimes: arrondirCentimes(moinsCher.habituel.valeur), economiePourcent: deuxieme.habituel.valeur > 0 ? Math.round(((deuxieme.habituel.valeur - moinsCher.habituel.valeur) / deuxieme.habituel.valeur) * 10000) / 100 : null, dateDernierPrix: null, magasinsDisponibles: parMagasin.map(x => ({ id: x.magasin.id, valeur: x.habituel.valeur, date: x.habituel.date || null, nbReleves: x.habituel.nbReleves })) };
  });
}
