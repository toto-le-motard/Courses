// app.js — interface et navigation (stories 1.2 à 3-2).
import { initDb, dbPrete, listerTypes, lireDernierReleve, lireObservations, ajouterObservations, demanderStockagePersistant, lireReglage, ecrireReglage, compter, STORES, VERSION_SCHEMA } from './db.js';
import { MAGASIN, UNITES, LIBELLE_UNITE, VERDICT, analyserPrixSaisie, verifierFormat, prixNormalise, formaterPrixEuros, formaterPrixNormalise, calculerVerdict, prixHabituel } from './domain.js';
import { accueilVide, vueTypes, vueTypeForm } from './types-ui.js';

const vue = document.getElementById('vue');
const titre = document.getElementById('titre-ecran');
const pastille = document.getElementById('offline-pill');
const onglets = document.querySelectorAll('.tabs a');

let versionAppli = '…';
let diagnostic = { base: 'ouverture…', persistant: '…', lancements: '…', comptes: '' };
let magasinCourant = MAGASIN.LECLERC;

function el(tag, attrs = {}, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = Boolean(v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) if (e != null) n.append(e.nodeType ? e : document.createTextNode(e));
  return n;
}

function carte(titreCarte, ...paragraphes) {
  const c = el('section', { class: 'carte' }, el('h2', { text: titreCarte }));
  for (const t of paragraphes) c.append(el('p', { text: t }));
  return c;
}

function aujourdHui() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateAffichee(s) {
  if (!s) return '';
  const [a,m,j] = s.split('-');
  return j + '/' + m + '/' + a;
}
function libelleMagasin(m) { return m === MAGASIN.LECLERC ? 'Leclerc' : 'Intermarché'; }
function classeMagasin(m) { return m === MAGASIN.LECLERC ? 'magasin-leclerc' : 'magasin-intermarche'; }

function majReseau() { pastille.hidden = navigator.onLine; }
window.addEventListener('online', majReseau);
window.addEventListener('offline', majReseau);
majReseau();

function vueReglages() {
  const d = document.createElement('div');
  d.appendChild(carte('Réglages', 'Seuil, sauvegarde et installation arrivent avec l’épic E8.'));
  const c = carte('À propos et diagnostic');
  const p = el('p', { class: 'diag' });
  const lignes = [
    ['Version de l’appli', versionAppli], ['Base de données', diagnostic.base],
    ['Stockage persistant', diagnostic.persistant], ['Lancements enregistrés', diagnostic.lancements],
    ['Contenu', diagnostic.comptes]
  ];
  lignes.forEach(([k,v], i) => { if (i) p.append(document.createElement('br')); p.append(el('strong', { text: k + ' : ' }), document.createTextNode(v)); });
  c.appendChild(p); d.appendChild(c); return d;
}

async function lireTypesAvecDerniers() {
  const types = (await listerTypes()).filter((t) => !t.archive);
  const enrichis = await Promise.all(types.map(async (t) => ({ type: t, dernier: await lireDernierReleve(t.id, magasinCourant) })));
  return enrichis.sort((a,b) => {
    if (!!a.dernier !== !!b.dernier) return a.dernier ? -1 : 1;
    if (a.dernier && b.dernier && a.dernier.date !== b.dernier.date) return a.dernier.date < b.dernier.date ? 1 : -1;
    return a.type.nom.localeCompare(b.type.nom, 'fr');
  });
}

function vueMagasin() {
  const racine = el('div', { class: 'ecran-magasin' });
  const entete = el('div', { class: 'selecteur-magasin ' + classeMagasin(magasinCourant) });
  const boutonsMagasin = [MAGASIN.LECLERC, MAGASIN.INTERMARCHE].map((m) =>
    el('button', { type: 'button', class: 'magasin-btn', 'aria-pressed': m === magasinCourant, text: libelleMagasin(m), onclick: async () => {
      magasinCourant = m;
      await ecrireReglage('magasinCourant', m);
      await chargerFormulaire();
    }})
  );
  entete.append(...boutonsMagasin);
  racine.append(entete);

  const formulaire = el('section', { id: 'formulaire-releve', class: 'carte formulaire-releve' });
  racine.append(formulaire);

  let types = [];
  let typeChoisi = null;
  let dernier = null;
  let date = aujourdHui();

  function erreur(msg) { message.textContent = msg || ''; message.hidden = !msg; }
  function prixValide() { return analyserPrixSaisie(prix.value); }

  const recherche = el('input', { type: 'search', class: 'champ', id: 'champ-type', placeholder: 'Type de produit', autocomplete: 'off', 'aria-label': 'Type de produit' });
  const suggestions = el('div', { class: 'suggestions', id: 'suggestions-types' });
  const prix = el('input', { type: 'text', class: 'champ champ-prix', id: 'champ-prix', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Prix en euros', placeholder: '0,00', enterkeyhint: 'next' });
  const prixSuffixe = el('span', { class: 'suffixe-euro', text: '€' });
  const prixZone = el('div', { class: 'prix-zone' }, prix, prixSuffixe);
  const valeurFormat = el('input', { type: 'number', class: 'champ', id: 'champ-format', inputmode: 'decimal', min: '0', step: 'any', 'aria-label': 'Valeur du format' });
  const uniteFormat = el('select', { class: 'champ', id: 'champ-unite', 'aria-label': 'Unité du format' });
  const formatErreur = el('p', { class: 'erreur', role: 'alert', hidden: true });
  const dateLien = el('button', { type: 'button', class: 'lien-date', text: 'Aujourd’hui', onclick: () => dateInput.showPicker ? dateInput.showPicker() : dateInput.click() });
  const dateInput = el('input', { type: 'date', class: 'date-cache', value: date, 'aria-label': 'Date du relevé' });
  const dateTexte = el('span', { class: 'date-texte', text: dateAffichee(date) });
  const promo = el('input', { type: 'checkbox', class: 'interrupteur', id: 'champ-promo' });
  const prixHorsPromo = el('input', { type: 'text', class: 'champ', id: 'champ-prix-hors-promo', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Prix hors promo en rayon', placeholder: '0,00' });
  const prixHorsPromoBloc = el('div', { class: 'hors-promo-bloc', hidden: true },
    el('label', { class: 'etiquette', for: 'champ-prix-hors-promo', text: 'Prix hors promo en rayon' }),
    prixHorsPromo
  );

  const message = el('p', { class: 'message-succes', role: 'status', hidden: true });
  const bouton = el('button', { type: 'button', class: 'btn btn-primaire btn-bloc btn-enregistrer', id: 'btn-enregistrer', text: 'Enregistrer', disabled: true });

  racine.addEventListener('click', (e) => {
    const b = e.target.closest('.suggestion-type');
    if (!b) return;
    typeChoisi = types.find((x) => String(x.type.id) === b.dataset.id)?.type || null;
    recherche.value = typeChoisi ? typeChoisi.nom : '';
    suggestions.replaceChildren();
    chargerDernierEtFormat();
    verifier();
  });

  recherche.addEventListener('input', () => {
    typeChoisi = null;
    const q = recherche.value.trim() ? recherche.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';
    const visibles = types.filter((x) => x.type.nomNormalise.includes(q)).slice(0, 8);
    suggestions.replaceChildren(...visibles.map((x) => el('button', { type: 'button', class: 'suggestion-type', 'data-id': x.type.id, text: x.type.nom })));
    verifier();
  });
  prix.addEventListener('input', verifier);
  valeurFormat.addEventListener('input', verifier);
  uniteFormat.addEventListener('change', verifier);
  dateInput.addEventListener('change', () => { date = dateInput.value || aujourdHui(); dateTexte.textContent = dateAffichee(date); void actualiserVerdict(); });
  promo.addEventListener('change', () => { prixHorsPromoBloc.hidden = !promo.checked; if (!promo.checked) prixHorsPromo.value = ''; verifier(); });
  prixHorsPromo.addEventListener('input', verifier);
  bouton.addEventListener('click', async () => {
    const prixCentimes = prixValide();
    const format = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    if (!typeChoisi || !prixCentimes || !format.ok) return;
    bouton.disabled = true;
    try {
      const observations = [{ type: typeChoisi.id, magasin: magasinCourant, date, prixCentimes, format: format.formatBase, promo: promo.checked }];
      const horsPromoCentimes = prixHorsPromo.value.trim() ? analyserPrixSaisie(prixHorsPromo.value) : null;
      if (promo.checked && prixHorsPromo.value.trim() && !horsPromoCentimes) {
        throw new Error('Le prix hors promo doit être supérieur à 0.');
      }
      if (promo.checked && horsPromoCentimes) {
        if (horsPromoCentimes < prixCentimes) horsPromoAvertissement.hidden = false;
        observations.push({ type: typeChoisi.id, magasin: magasinCourant, date, prixCentimes: horsPromoCentimes, format: format.formatBase, promo: false });
      }
      await ajouterObservations(observations);
      recherche.value = ''; typeChoisi = null; dernier = null; prix.value = ''; valeurFormat.value = ''; date = aujourdHui(); dateInput.value = date; dateTexte.textContent = dateAffichee(date); promo.checked = false;
      suggestions.replaceChildren(); prixHorsPromoBloc.hidden = true; prixHorsPromo.value = ''; horsPromoAvertissement.hidden = true; chargerFormulaire();
      message.textContent = 'Enregistré chez ' + libelleMagasin(magasinCourant);
      message.hidden = false;
      recherche.focus();
    } catch (e) { erreur(e.message || 'Enregistrement impossible.'); }
    finally { bouton.disabled = !estFormulaireValide(); }
  });

  function chargerDernierEtFormat() {
    if (!typeChoisi) return;
    dernier = types.find((x) => x.type.id === typeChoisi.id)?.dernier || null;
    const compatibles = UNITES.includes(typeChoisi.unite) ? (typeChoisi.unite === 'kg' ? ['g','kg'] : typeChoisi.unite === 'l' ? ['ml','l'] : ['unit']) : [];
    uniteFormat.replaceChildren(...compatibles.map((u) => el('option', { value: u, text: LIBELLE_UNITE[u] })));
    let valeur = '';
    let unite = compatibles[0];
    if (dernier) {
      const base = Number(dernier.format);
      if (typeChoisi.unite === 'kg' && base % 1000 === 0) { valeur = base / 1000; unite = 'kg'; }
      else if (typeChoisi.unite === 'l' && base % 1000 === 0) { valeur = base / 1000; unite = 'l'; }
      else { valeur = base; unite = typeChoisi.unite === 'kg' ? 'g' : typeChoisi.unite === 'l' ? 'ml' : 'unit'; }
      prix.value = dernier.prixCentimes ? String((dernier.prixCentimes / 100).toFixed(2)).replace('.', ',') : '';
    }
    valeurFormat.value = valeur;
    uniteFormat.value = unite;
  }

  function estFormulaireValide() {
    if (!typeChoisi) return false;
    const p = prixValide();
    const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    return Boolean(p && f.ok);
  }

  async function actualiserVerdict() {
    if (!typeChoisi || !estFormulaireValide()) { verdictCarte.hidden = true; return; }
    const p = prixValide();
    const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    if (!p || !f.ok) { verdictCarte.hidden = true; return; }
    try {
      const observations = await lireObservations(typeChoisi.id);
      const seuilPct = await lireReglage('seuilIndifference', 5);
      const v = calculerVerdict({ prixCentimes:p, formatBase:f.formatBase, typeUnit:typeChoisi.unite, magasin:magasinCourant, observations, aujourdhui:date, seuilPct, promo:promo.checked });
      dessinerVerdict(v, observations);
    } catch { verdictCarte.hidden = true; }
  }

  function dessinerVerdict(v, observations) {
    verdictCarte.hidden = false;
    const classe = v.resultat === VERDICT.ACHETER_ICI ? 'acheter' : v.resultat === VERDICT.ATTENDRE ? 'attendre' : v.resultat === VERDICT.INDIFFERENT ? 'indifferent' : 'insuffisant';
    verdictCarte.className = 'carte verdict-carte verdict-' + classe;
    verdictCarte.replaceChildren();
    const autre = libelleMagasin(v.autreMagasin);
    let libelle='Données insuffisantes', icone='?';
    if(v.resultat===VERDICT.ACHETER_ICI){libelle='Acheter ici';icone='✓';}
    else if(v.resultat===VERDICT.ATTENDRE){libelle='Attendre '+autre;icone='…';}
    else if(v.resultat===VERDICT.INDIFFERENT){libelle='Indifférent';icone='=';}
    verdictCarte.append(el('div',{class:'verdict-ligne1'},el('span',{class:'verdict-icone',text:icone}),el('strong',{text:libelle})));
    if(v.resultat!==VERDICT.INSUFFISANT){
      const signe=v.differenceFormatCentimes<0?'−':v.differenceFormatCentimes>0?'+':'';
      const uniteTexte=typeChoisi.unite==='unit'?'pour cette unité':'le '+LIBELLE_UNITE[typeChoisi.unite];
      verdictCarte.append(el('p',{class:'verdict-economie',text:signe+formaterPrixEuros(Math.abs(v.differenceUniteCentimes))+' '+uniteTexte+' · '+signe+formaterPrixEuros(Math.abs(v.differenceFormatCentimes))+' pour ce format'}));
      const h=v.habituelAutre;
      if(h){
        const prixRef=formaterPrixNormalise(h.valeur,typeChoisi.unite);
        const rappel=h.type==='mediane'?prixRef+', médiane de '+h.nbReleves+' relevé'+(h.nbReleves>1?'s':'')+' sur 8 semaines':prixRef+', relevé le '+dateAffichee(h.date);
        verdictCarte.append(el('p',{class:'verdict-rappel',text:autre+' : '+rappel}));
      }
    } else {
      const d=v.dernierConnu;
      verdictCarte.append(el('p',{class:'verdict-rappel',text:autre+' : '+(d?'dernier prix connu le '+dateAffichee(d.date):'aucun relevé')}));
    }
    if(promo.checked){
      verdictCarte.append(el('span',{class:'badge-promo',text:'Promo'}));
      const h=prixHabituel(observations,magasinCourant,typeChoisi.unite,date);
      if(h.ok) verdictCarte.append(el('p',{class:'verdict-habituel',text:'Habituel chez '+libelleMagasin(magasinCourant)+' : '+formaterPrixNormalise(h.valeur,typeChoisi.unite)}));
    }
  }

  function verifier() {
    erreur('');
    formatErreur.hidden = true;
    const p = prixValide();
    if (typeChoisi) {
      const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
      if (!f.ok) {
        formatErreur.textContent = f.erreur === 'format-incompatible' ? 'Ce type se compare en ' + LIBELLE_UNITE[typeChoisi.unite] : 'Saisissez un format valide.';
        formatErreur.hidden = false;
      }
      const n = f.ok && p ? prixNormalise(p, f.formatBase, typeChoisi.unite) : null;
      prixNormaliseAffiche.textContent = n?.ok ? formaterPrixNormalise(n.centimesParUnite, typeChoisi.unite) : '';
      bouton.disabled = !(p && f.ok);
      void actualiserVerdict();
    } else {
      prixNormaliseAffiche.textContent = '';
      bouton.disabled = true;
      verdictCarte.hidden = true;
    }
  }

  const horsPromoAvertissement = el('p', { class: 'erreur', text: 'Prix hors promo inférieur au prix promo', hidden: true });
  const verdictCarte = el('section', { class: 'carte verdict-carte verdict-insuffisant', id: 'carte-verdict', hidden: true, 'aria-live': 'polite' });
  const prixNormaliseAffiche = el('p', { class: 'prix-normalise' });
  const formatBloc = el('div', { class: 'format-ligne' }, valeurFormat, uniteFormat);
  formulaire.append(
    el('label', { class: 'etiquette', for: 'champ-type', text: 'Type' }), recherche, suggestions,
    el('label', { class: 'etiquette', for: 'champ-prix', text: 'Prix' }), prixZone,
    el('label', { class: 'etiquette', text: 'Format' }), formatBloc, formatErreur, prixNormaliseAffiche,
    el('div', { class: 'date-ligne' }, dateLien, dateTexte, dateInput),
    el('label', { class: 'promo-ligne' }, promo, el('span', { text: 'Promo' })),
    prixHorsPromoBloc, horsPromoAvertissement, verdictCarte, message, bouton
  );

  async function chargerFormulaire() {
    types = await lireTypesAvecDerniers();
    if (racine.isConnected) {
      entete.className = 'selecteur-magasin ' + classeMagasin(magasinCourant);
      boutonsMagasin.forEach((b) => { b.setAttribute('aria-pressed', String(b.textContent === libelleMagasin(magasinCourant))); });
      suggestions.replaceChildren();
      if (typeChoisi) chargerDernierEtFormat();
      verifier();
    }
  }
  chargerFormulaire().catch(() => { formulaire.replaceChildren(carte('Magasin', 'Base de données indisponible.')); });
  return racine;
}

const ROUTES = {
  magasin: { titre: 'Magasin', onglet: 'magasin', vue: vueMagasin },
  liste: { titre: 'Liste', onglet: 'liste', vue: () => carte('Avant les courses', 'Cet écran arrive avec l’épic E5.') },
  types: { titre: 'Types', onglet: 'types', vue: vueTypes },
  'type-nouveau': { titre: 'Nouveau type', onglet: 'types', vue: () => vueTypeForm(null) },
  'type-edit': { titre: 'Modifier le type', onglet: 'types', vue: (p) => vueTypeForm(Number(p)) },
  bilan: { titre: 'Bilan', onglet: 'bilan', vue: () => carte('Économies réalisées', 'Cet écran arrive avec l’épic E7.') },
  reglages: { titre: 'Réglages', onglet: null, vue: vueReglages }
};

function afficher() {
  const [nom, param] = (location.hash.replace('#/', '') || 'magasin').split('/');
  const r = ROUTES[nom] || ROUTES.magasin;
  titre.textContent = r.titre; document.title = r.titre + ' · Appli Courses';
  vue.replaceChildren(r.vue(param));
  vue.style.animation = 'none'; void vue.offsetWidth; vue.style.animation = '';
  onglets.forEach((a) => a.dataset.route === r.onglet ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  window.scrollTo(0, 0);
}
if (!location.hash) history.replaceState(null, '', '#/magasin');
window.addEventListener('hashchange', afficher); afficher();

(async () => {
  try {
    await initDb();
    magasinCourant = await lireReglage('magasinCourant', MAGASIN.LECLERC);
    diagnostic.base = 'ouverte (schéma v' + VERSION_SCHEMA + ')';
    const ok = await demanderStockagePersistant();
    diagnostic.persistant = ok === null ? 'non géré par ce navigateur' : (ok ? 'oui' : 'non (pensez à exporter régulièrement)');
    const n = (await lireReglage('lancements', 0)) + 1; await ecrireReglage('lancements', n); diagnostic.lancements = String(n);
    const parts = []; for (const s of STORES) parts.push(s + ' ' + (await compter(s))); diagnostic.comptes = parts.join(' · ');
    if (location.hash === '#/magasin') afficher();
  } catch (e) { diagnostic.base = 'ERREUR : ' + (e && e.message ? e.message : e); if (location.hash === '#/reglages') afficher(); }
})();

function demanderVersion() { const ctrl = navigator.serviceWorker.controller; if (ctrl) ctrl.postMessage({ type: 'GET_VERSION' }); }
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'VERSION') { versionAppli = e.data.version; if (location.hash === '#/reglages') afficher(); }});
  navigator.serviceWorker.addEventListener('controllerchange', demanderVersion);
  navigator.serviceWorker.register('sw.js').then(demanderVersion).catch(() => { versionAppli = 'service worker indisponible'; });
} else versionAppli = 'service worker non disponible';
