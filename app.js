// app.js — interface et navigation (stories 1.2 à 3-2).
import { initDb, dbPrete, listerTypes, lireDernierReleve, lireObservations, dernierReleve, trouverDoublon, enregistrerReleves, analyserDoublons, annulerEnregistrement, listerReleves, modifierReleve, supprimerReleve, demanderStockagePersistant, lireReglage, ecrireReglage, compter, STORES, VERSION_SCHEMA, exporterCollections, remplacerCollections } from './db.js';
import { MAGASIN, UNITES, LIBELLE_UNITE, VERDICT, analyserPrixSaisie, verifierFormat, prixNormalise, formaterPrixEuros, formaterPrixNormalise, calculerVerdict, prixHabituel, estPrixIncoherent, unitesCompatibles, formatAffichage, calculerPositionDock, modeSaisieActif, positionDefilement, frequencePromos } from './domain.js';
import { accueilVide, vueTypes, vueTypeForm } from './types-ui.js';
import { creerSauvegarde, validerSauvegarde, etatRappelExport } from './backup.js';

const vue = document.getElementById('vue');
const titre = document.getElementById('titre-ecran');
const pastille = document.getElementById('offline-pill');
const onglets = document.querySelectorAll('.tabs a');

let versionAppli = '…';
let diagnostic = { base: 'ouverture…', persistant: '…', lancements: '…', comptes: '' };
let magasinCourant = MAGASIN.LECLERC;
let annulationActive = null;
let annulationTimer = null;
let rappelMasqueSession = false;
let sequenceAffichage = 0;
let evenementInstallation = null;

let dockResizeObserver = null;
let modeSaisieForce = null;
window.__forcerModeSaisie = (actif) => { modeSaisieForce = Boolean(actif); actualiserPositionDock(); window.__actualiserModeMensuel?.(); };
function actualiserPositionDock() {
  const dock = document.getElementById('dock-magasin');
  if (!dock) return;
  const vv = window.visualViewport;
  const hauteurVisible = vv ? vv.height : window.innerHeight;
  const actif = modeSaisieForce === null ? modeSaisieActif(window.innerHeight, hauteurVisible) : modeSaisieForce;
  document.body.classList.toggle('mode-saisie', actif);
  const position = calculerPositionDock({
    hauteurFenetre: window.innerHeight,
    offsetTop: vv ? vv.offsetTop : 0,
    hauteurVisible,
    hauteurDock: dock.getBoundingClientRect().height,
    hauteurOnglets: actif ? 0 : (document.querySelector('.tabs')?.getBoundingClientRect().height || 76),
    zoneSecurite: 12
  });
  document.documentElement.style.setProperty('--clavier-inset', position.clavierInset + 'px');
  document.documentElement.style.setProperty('--dock-bottom', position.bottomDock + 'px');
  document.documentElement.style.setProperty('--annulation-bottom', position.bottomAnnulation + 'px');
  document.documentElement.style.setProperty('--hauteur-visible', (vv ? vv.height : window.innerHeight) + 'px');
  document.documentElement.style.setProperty('--dock-hauteur', dock.getBoundingClientRect().height + 'px');
  const actifFormulaire = document.activeElement;
  if (actifFormulaire?.matches?.('#champ-type, #champ-prix, #champ-format, #champ-prix-hors-promo')) garderChampVisible(actifFormulaire);
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  evenementInstallation = event;
  if (location.hash === '#/reglages') void afficher();
});
window.addEventListener('resize', actualiserPositionDock);
window.visualViewport?.addEventListener('resize', actualiserPositionDock);
window.visualViewport?.addEventListener('scroll', actualiserPositionDock);

function garderChampVisible(champ) {
  requestAnimationFrame(() => {
    const dock = document.getElementById('dock-magasin');
    if (!dock || !champ.isConnected) return;
    const vv = window.visualViewport;
    const hautVisible = vv ? vv.offsetTop : 0;
    const basVisible = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const dockTop = dock.getBoundingClientRect().top;
    if (!document.body.classList.contains('mode-saisie')) {
      const r = champ.getBoundingClientRect();
      const limiteBasse = Math.min(basVisible, dockTop) - 8;
      const suivant = champ.id === 'champ-prix' ? document.getElementById('champ-format') : null;
      const basNecessaire = suivant ? Math.max(r.bottom, suivant.getBoundingClientRect().bottom) : r.bottom;
      if (basNecessaire > limiteBasse) window.scrollBy({ top: basNecessaire - limiteBasse, behavior: 'auto' });
      else if (r.top < hautVisible + 8) window.scrollBy({ top: r.top - hautVisible - 8, behavior: 'auto' });
      return;
    }
    const label = document.querySelector('label[for="' + champ.id + '"]');
    const rChamp = champ.getBoundingClientRect();
    const rLabel = label?.getBoundingClientRect();
    const rect = rLabel ? { top: Math.min(rLabel.top, rChamp.top), bottom: Math.max(rLabel.bottom, rChamp.bottom) } : { top: rChamp.top, bottom: rChamp.bottom };
    const hautZone = Math.max(hautVisible, document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0);
    const basZone = Math.min(basVisible, dockTop);
    const delta = positionDefilement(rect, hautZone, basZone, 12);
    if (delta) window.scrollBy({ top: delta, behavior: 'auto' });
  });
}


function afficherErreur(msg) {
  const zone = document.querySelector('.message-succes');
  if (zone) { zone.textContent = msg || ''; zone.hidden = !msg; }
}

function afficherAnnulation(jeton, magasin) {
  annulationActive = jeton;
  if (annulationTimer) clearTimeout(annulationTimer);
  document.getElementById('bandeau-annulation')?.remove();
  const b = el('div', { id: 'bandeau-annulation', class: 'bandeau-annulation', role: 'status' },
    el('span', { text: 'Enregistré chez ' + libelleMagasin(magasin) }),
    el('button', { type: 'button', class: 'btn-annuler-enregistrement', text: 'Annuler', onclick: async () => {
      if (!annulationActive) return;
      const a = annulationActive; annulationActive = null; clearTimeout(annulationTimer); b.remove();
      try {
        await annulerEnregistrement(a);
        if (location.hash.startsWith('#/historique/')) void afficher();
      } catch {
        afficherErreur('Annulation impossible.');
      }
    }})
  );
  document.body.append(b);
  annulationTimer = setTimeout(() => { if (annulationActive === jeton) { annulationActive = null; b.remove(); } }, 5000);
}

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
  for (const e of enfants.flat()) { if (e == null || e === false) continue; if (typeof e === 'object' && typeof e.then === 'function') { console.error('el : Promise reçue'); n.append(document.createTextNode("Erreur d’affichage")); continue; } n.append(e.nodeType ? e : document.createTextNode(e)); }
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

function confirmerRemplacementSauvegarde() {
  return new Promise(resolve => {
    const dialogue = el('dialog', { class: 'feuille' },
      el('h2', { text: 'Remplace toutes les données actuelles ?' }),
      el('p', { text: 'La sauvegarde validée remplacera les types, relevés, achats, codes-barres et réglages. Cette opération ne peut pas être annulée.' }),
      el('div', { class: 'feuille-actions' },
        el('button', { type: 'button', class: 'btn btn-primaire', text: 'Remplacer toutes les données', onclick: () => { dialogue.close(); resolve(true); } }),
        el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Annuler', onclick: () => { dialogue.close(); resolve(false); } })
      )
    );
    dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });
    dialogue.addEventListener('close', () => { dialogue.remove(); resolve(false); });
    document.body.append(dialogue);
    dialogue.showModal();
  });
}

async function vueReglages() {
  await dbPrete;
  const d = document.createElement('div');
  const sauvegarde = carte('Sauvegarde', 'Exportez toutes vos données dans un fichier JSON versionné. Conservez ce fichier en lieu sûr.');
  const message = el('p', { class: 'message-sauvegarde', role: 'status', hidden: true });
  const boutonExport = el('button', { type: 'button', class: 'btn btn-primaire', text: 'Exporter une sauvegarde', onclick: async () => {
    boutonExport.disabled = true;
    message.hidden = true;
    try {
      const collections = await exporterCollections();
      const dateExport = aujourdHui();
      const payload = creerSauvegarde({ schemaVersion: VERSION_SCHEMA, ...collections, dateExport });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = 'appli-courses-' + dateExport + '.json';
      document.body.append(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await ecrireReglage('dernierExport', dateExport);
      message.textContent = 'Sauvegarde téléchargée le ' + dateAffichee(dateExport) + '.';
      message.hidden = false;
    } catch (e) {
      message.textContent = 'Export impossible. Vérifiez que le navigateur autorise le téléchargement.';
      message.hidden = false;
      console.error('Export de sauvegarde impossible', e);
    } finally { boutonExport.disabled = false; }
  }});
  const fichierImport = el('input', { id: 'fichier-sauvegarde', type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
    const fichier = fichierImport.files?.[0];
    if (!fichier) return;
    message.hidden = true;
    try {
      let payload;
      try { payload = JSON.parse(await fichier.text()); }
      catch { throw new Error('Le fichier ne contient pas un JSON lisible.'); }
      const validation = validerSauvegarde(payload, VERSION_SCHEMA);
      if (!validation.ok) throw new Error(validation.erreur);
      const confirmer = await confirmerRemplacementSauvegarde();
      if (!confirmer) {
        message.textContent = 'Restauration annulée. Aucune donnée modifiée.';
        message.hidden = false;
        return;
      }
      await remplacerCollections(validation.valeur);
      message.textContent = 'Sauvegarde restaurée. Toutes les données ont été remplacées.';
      message.hidden = false;
      diagnostic.comptes = (await Promise.all(STORES.map(async s => s + ' ' + (await compter(s))))).join(' · ');
    } catch (e) {
      message.textContent = e.message || 'Import impossible. Aucune donnée modifiée.';
      message.hidden = false;
    } finally { fichierImport.value = ''; }
  }});
  const boutonImport = el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Importer une sauvegarde', onclick: () => fichierImport.click() });
  if (diagnostic.persistant !== 'oui') {
    sauvegarde.prepend(el('p', { class: 'avertissement-stockage', role: 'alert', text: 'Le navigateur n’a pas confirmé la protection du stockage. Exportez régulièrement une sauvegarde pour éviter une perte de données.' }));
  }
  sauvegarde.append(boutonExport, boutonImport, fichierImport, message);
  d.append(sauvegarde);
  const seuilInitial = Number(await lireReglage('seuilIndifference', 5));
  const libelleSeuil = el('label', { for: 'seuil-indifference', id: 'libelle-seuil-indifference', text: 'Seuil : ' + seuilInitial + ' %' });
  const exempleSeuil = el('p', { text: 'Exemple : avec un prix habituel de 2,00 €, un seuil de 5 % considère comme indifférents les prix entre 1,90 € et 2,10 €.' });
  const seuilMessage = el('p', { class: 'message-sauvegarde', role: 'status', hidden: true });
  const curseurSeuil = el('input', { id: 'seuil-indifference', type: 'range', min: 0, max: 20, step: 1, value: String(seuilInitial),
    oninput: e => { libelleSeuil.textContent = 'Seuil : ' + e.target.value + ' %'; },
    onchange: async e => {
      const valeur = Number(e.target.value);
      libelleSeuil.textContent = 'Seuil : ' + valeur + ' %';
      try { await ecrireReglage('seuilIndifference', valeur); seuilMessage.textContent = 'Seuil enregistré : ' + valeur + ' %.'; seuilMessage.hidden = false; }
      catch { seuilMessage.textContent = 'Impossible d’enregistrer le seuil.'; seuilMessage.hidden = false; }
    }
  });
  const carteSeuil = carte('Seuil « indifférent »');
  carteSeuil.classList.add('reglage-seuil');
  carteSeuil.append(libelleSeuil, curseurSeuil, exempleSeuil, seuilMessage);
  d.append(carteSeuil);
  if (evenementInstallation) {
    const boutonInstaller = el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Installer l’appli', onclick: async () => {
      const event = evenementInstallation;
      try { await event.prompt(); await event.userChoice; }
      catch (e) { console.error('Installation de la PWA impossible', e); }
      evenementInstallation = null;
      await afficher();
    }});
    const carteInstallation = carte('Installation');
    carteInstallation.append(el('p', { text: 'Ajoutez Appli Courses à l’écran d’accueil.' }), boutonInstaller);
    d.append(carteInstallation);
  }
  const aPropos = carte('À propos');
  aPropos.append(el('p', { text: 'Appli Courses conserve vos données sur cet appareil. L’export JSON permet de les sauvegarder et de les restaurer.' }));
  d.append(aPropos);
  const diagnosticCarte = carte('Diagnostic');
  const p = el('p', { class: 'diag' });
  const lignes = [
    ['Version du cache', versionAppli === '…' ? 'inconnue' : versionAppli], ['Version de l’appli', versionAppli], ['Base de données', diagnostic.base],
    ['Stockage persistant', diagnostic.persistant], ['Lancements enregistrés', diagnostic.lancements],
    ['Contenu', diagnostic.comptes]
  ];
  lignes.forEach(([k,v], i) => { if (i) p.append(document.createElement('br')); p.append(el('strong', { text: k + ' : ' }), document.createTextNode(v)); });
  diagnosticCarte.appendChild(p); d.appendChild(diagnosticCarte); return d;
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

function demanderConfirmationPrix(prixDernier) {
  return new Promise(resolve => {
    const d = el('dialog', { class: 'feuille' },
      el('h2', { text: 'Prix très différent du dernier relevé (' + prixDernier + '). Confirmer ?' }),
      el('div', { class: 'feuille-actions' },
        el('button', { type:'button', class:'btn btn-primaire', text:'Confirmer', onclick:()=>{d.close();resolve(true);} })
      )
    );
    d.addEventListener('close',()=>{d.remove(); if (!d.dataset.done) resolve(false);});
    document.body.append(d); d.showModal();
  });
}
function demanderRemplacement(prixExistant, promo) {
  return new Promise(resolve => {
    const d = el('dialog', { class:'feuille' },
      el('h2', { text:'Relevé ' + (promo ? 'promo' : 'hors promo') + ' du jour déjà saisi à ' + prixExistant + ', conservé' }),
      el('div', { class:'feuille-actions' },
        el('button',{type:'button',class:'btn btn-primaire',text:'Remplacer quand même',onclick:()=>{d.dataset.done='1';d.close();resolve(true);}})
      )
    );
    d.addEventListener('close',()=>{d.remove(); if(!d.dataset.done) resolve(false);});
    document.body.append(d); d.showModal();
  });
}
function vueMagasin() {
  document.getElementById('dock-magasin')?.remove(); dockResizeObserver?.disconnect();
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
  let calculVerdictToken = 0;

  function erreur(msg) { message.textContent = msg || ''; message.hidden = !msg; }
  function prixValide() { return analyserPrixSaisie(prix.value); }

  const recherche = el('input', { type: 'search', class: 'champ', id: 'champ-type', enterkeyhint: 'next', placeholder: 'Type de produit', autocomplete: 'off', 'aria-label': 'Type de produit' });
  const suggestions = el('div', { class: 'suggestions', id: 'suggestions-types' });
  const prix = el('input', { type: 'text', class: 'champ champ-prix', id: 'champ-prix', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Prix en euros', placeholder: '0,00', enterkeyhint: 'next' });
  const prixSuffixe = el('span', { class: 'suffixe-euro', text: '€' });
  const prixZone = el('div', { class: 'prix-zone' }, prix, prixSuffixe);
  const valeurFormat = el('input', { type: 'number', class: 'champ', id: 'champ-format', enterkeyhint: 'done', inputmode: 'decimal', min: '0', step: 'any', 'aria-label': 'Valeur du format' });
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
  valeurFormat.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valeurFormat.blur(); } });
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
      // Contrôle 1 : format incompatible déjà effectué ci-dessus.
      const nNouveau = prixNormalise(prixCentimes, format.formatBase, typeChoisi.unite).centimesParUnite;
      const dernierPourAlerte = await dernierReleve(typeChoisi.id, magasinCourant);
      if (dernierPourAlerte) {
        const nDernier = prixNormalise(dernierPourAlerte.prixCentimes, dernierPourAlerte.format, typeChoisi.unite).centimesParUnite;
        if (estPrixIncoherent(nNouveau, nDernier) && !bouton.dataset.prixConfirme) {
          bouton.dataset.prixConfirme = '1';
          const ok = await demanderConfirmationPrix(formaterPrixNormalise(nDernier, typeChoisi.unite));
          delete bouton.dataset.prixConfirme;
          if (!ok) return;
        }
      }
      // Contrôle 2 : doublon du jour. L'analyse est centralisée et propre à chaque observation.
      const analyses = await analyserDoublons(observations);
      const remplacements = analyses.map(() => false);
      for (let i = 0; i < analyses.length; i++) {
        const analyse = analyses[i];
        if (analyse.decision !== 'conserver') continue;
        const remplacer = await demanderRemplacement(formaterPrixNormalise(analyse.nExistant, typeChoisi.unite), observations[i].promo);
        if (!remplacer) return;
        remplacements[i] = true;
      }
      const jeton = await enregistrerReleves(observations, { remplacements });
      recherche.value = ''; typeChoisi = null; dernier = null; prix.value = ''; valeurFormat.value = ''; date = aujourdHui(); dateInput.value = date; dateTexte.textContent = dateAffichee(date); promo.checked = false;
      suggestions.replaceChildren(); prixHorsPromoBloc.hidden = true; prixHorsPromo.value = ''; horsPromoAvertissement.hidden = true; chargerFormulaire();
      message.hidden = true;
      if (jeton.ajoutes.length > 0) afficherAnnulation(jeton, magasinCourant);
      document.activeElement?.blur();
    } catch (e) { erreur(e.message || 'Enregistrement impossible.'); }
    finally { bouton.disabled = !estFormulaireValide(); }
  });

  function chargerDernierEtFormat() {
    if (!typeChoisi) return;
    dernier = types.find((x) => x.type.id === typeChoisi.id)?.dernier || null;
    const compatibles = unitesCompatibles(typeChoisi.unite);
    uniteFormat.replaceChildren(...compatibles.map((u) => el('option', { value: u, text: LIBELLE_UNITE[u] })));
    const affichage = dernier ? formatAffichage(Number(dernier.format), typeChoisi.unite) : { valeur: '', unite: compatibles[0] || '' };
    valeurFormat.value = affichage.valeur === '' ? '' : affichage.valeur.replace(',', '.');
    uniteFormat.value = compatibles.includes(affichage.unite) ? affichage.unite : (compatibles[0] || '');
    if (uniteFormat.options.length && !uniteFormat.value) uniteFormat.selectedIndex = 0;
    if (dernier) {
      prix.value = dernier.prixCentimes ? String((dernier.prixCentimes / 100).toFixed(2)).replace('.', ',') : '';
    }
  }

  function estFormulaireValide() {
    if (!typeChoisi) return false;
    const p = prixValide();
    const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    return Boolean(p && valeurFormat.value.trim() && uniteFormat.value && f.ok);
  }

  async function actualiserVerdict() {
    const jetonCalcul = ++calculVerdictToken;
    if (!typeChoisi || !estFormulaireValide()) { verdictCarte.hidden = true; return; }
    const p = prixValide();
    const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    if (!p || !f.ok) { verdictCarte.hidden = true; return; }
    try {
      const observations = await lireObservations(typeChoisi.id);
      const seuilPct = await lireReglage('seuilIndifference', 5);
      if (jetonCalcul !== calculVerdictToken || !typeChoisi || !estFormulaireValide()) { verdictCarte.hidden = true; return; }
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
      const uniteTexte=typeChoisi.unite==='unit'?'par unité':'le '+LIBELLE_UNITE[typeChoisi.unite];
      verdictCarte.append(el('p',{class:'verdict-economie',text:signe+formaterPrixEuros(Math.abs(v.differenceUniteCentimes))+' '+uniteTexte+' · '+signe+formaterPrixEuros(Math.abs(v.differenceFormatCentimes))+' pour ce paquet'}));
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
    if(promo.checked) verdictCarte.append(el('span',{class:'badge-promo',text:'Promo'}));
    const habituel = prixHabituel(observations,magasinCourant,typeChoisi.unite,date);
    if(habituel.ok) verdictCarte.append(el('p',{class:'verdict-habituel',text:'Habituel chez '+libelleMagasin(magasinCourant)+' : '+formaterPrixNormalise(habituel.valeur,typeChoisi.unite)}));
  }

  function verifier() {
    erreur('');
    formatErreur.hidden = true;
    const p = prixValide();
    const pHorsPromo = promo.checked && prixHorsPromo.value.trim() ? analyserPrixSaisie(prixHorsPromo.value) : null;
    horsPromoAvertissement.hidden = !(promo.checked && pHorsPromo && p && pHorsPromo < p);
    if (typeChoisi) {
      const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
      if (!f.ok) {
        formatErreur.textContent = f.erreur === 'format-incompatible' ? 'Ce type se compare en ' + LIBELLE_UNITE[typeChoisi.unite] : 'Saisissez un format valide.';
        formatErreur.hidden = false;
      }
      const n = f.ok && p ? prixNormalise(p, f.formatBase, typeChoisi.unite) : null;
      prixNormaliseAffiche.textContent = n?.ok ? formaterPrixNormalise(n.centimesParUnite, typeChoisi.unite) : '';
      bouton.disabled = !(p && valeurFormat.value.trim() && uniteFormat.value && f.ok);
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
    el('label', { class: 'etiquette', for: 'champ-format', text: 'Format' }), formatBloc, formatErreur, prixNormaliseAffiche,
    el('div', { class: 'date-promo-ligne' },
      el('div', { class: 'date-ligne' }, dateLien, dateTexte, dateInput),
      el('label', { class: 'promo-ligne' }, promo, el('span', { text: 'Promo' }))
    ),
    prixHorsPromoBloc, horsPromoAvertissement, message
  );
  const dock = el('div', { id: 'dock-magasin', class: 'dock-magasin' },
    el('div', { class: 'dock-verdict-zone', id: 'dock-verdict-zone' }, verdictCarte),
    el('div', { class: 'dock-actions', id: 'dock-actions' }, bouton)
  );
  document.body.append(dock);
  actualiserPositionDock();
  if (typeof ResizeObserver !== 'undefined') {
    dockResizeObserver = new ResizeObserver(actualiserPositionDock);
    dockResizeObserver.observe(dock);
  }
  [recherche, prix, valeurFormat, prixHorsPromo].forEach(champ => champ.addEventListener('focus', () => garderChampVisible(champ)));

  async function chargerFormulaire() {
    types = await lireTypesAvecDerniers();
    if (racine.isConnected) {
      if (!types.length) {
        entete.hidden = true;
        formulaire.replaceChildren(accueilVide());
        return;
      }
      entete.hidden = false;
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


// ---- Historique des relevés (FR8 / FR9) -----------------------------------------------------
function vueHistorique(typeId, integre = false) {
  const racine=el('div',{class:'historique'});
  const liste=el('div',{class:'liste-historique'});
  if (integre) racine.append(liste); else racine.append(el('a',{href:'#/types',class:'btn btn-secondaire btn-bloc'},'← Retour aux types'),liste);
  async function charger(){
    const type=await dbPrete.then(()=>lireTypeSafe(typeId));
    if(!type) { liste.replaceChildren(carte('Historique','Type introuvable.')); return; }
    async function dessiner(){
    const rows=await listerReleves(typeId); liste.replaceChildren();
    if(!rows.length){
      liste.append(carte('Aucun relevé','Aucun relevé pour ce type.'),
        el('a',{href:'#/magasin',class:'btn btn-primaire btn-bloc'},'Saisir un relevé'));
      return;
    }
    for(const o of rows) liste.append(ligneHistorique(o));
  }
  function ligneHistorique(o){
    const row=el('div',{class:'ligne ligne-releve','data-id':o.id},
      el('div',{class:'ligne-releve-contenu'},
        el('div',{class:'ligne-releve-haut'},
          el('span',{class:'puce '+classeMagasin(o.magasin),text:libelleMagasin(o.magasin)}),
          el('span',{class:'releve-date',text:dateAffichee(o.date)})),
        el('div',{class:'ligne-releve-bas'},
          el('strong',{text:formaterPrixNormalise(prixNormalise(o.prixCentimes,o.format,type.unite).centimesParUnite,type.unite)}),
          o.promo?el('span',{class:'badge-promo',text:'Promo'}):null)),
      el('button',{type:'button',class:'btn-icone',text:'⋯','aria-label':'Actions du relevé',onclick:()=>menuReleve(o)})
    );
    let x=0,timer=null;
    row.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){x=e.clientX;timer=setTimeout(()=>menuReleve(o),550);}});
    row.addEventListener('pointerup',e=>{if(timer)clearTimeout(timer); if(e.pointerType==='touch'&&Math.abs(e.clientX-x)>60)menuReleve(o);});
    row.addEventListener('pointercancel',()=>{if(timer)clearTimeout(timer);});
    return row;
  }
  function menuReleve(o){
    const d=el('dialog',{class:'feuille'},el('h2',{text:'Relevé du '+dateAffichee(o.date)}),
      el('div',{class:'feuille-actions'},
        el('button',{type:'button',class:'btn btn-primaire',text:'Modifier',onclick:()=>{d.close();d.remove();afficherEdition(o);}}),
        el('button',{type:'button',class:'btn btn-danger',text:'Supprimer',onclick:()=>{d.close();d.remove();confirmerSuppressionReleve(o);}}),
        el('button',{type:'button',class:'btn btn-secondaire',text:'Fermer',onclick:()=>d.close()})));
    d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();
  }
  function confirmerSuppressionReleve(o){
    const d=el('dialog',{class:'feuille'},el('h2',{text:'Supprimer ce relevé ?'}),
      el('div',{class:'feuille-actions'},
        el('button',{type:'button',class:'btn btn-danger',text:'Supprimer',onclick:async()=>{d.close();await supprimerReleve(o.id);await dessiner();}}),
        el('button',{type:'button',class:'btn btn-secondaire',text:'Annuler',onclick:()=>d.close()})));
    d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();
  }
  function afficherEdition(o){
    const d=el('dialog',{class:'feuille feuille-edition'});
    const magasin=el('select',{class:'champ'}); magasin.append(...[MAGASIN.LECLERC,MAGASIN.INTERMARCHE].map(m=>el('option',{value:m,text:libelleMagasin(m)})));magasin.value=o.magasin;
    const prix=el('input',{class:'champ',inputmode:'decimal',value:String((o.prixCentimes/100).toFixed(2)).replace('.',',')});
    const format=el('input',{class:'champ',type:'number',inputmode:'decimal'});
    const unite=el('select',{class:'champ'}), compatibles=unitesCompatibles(type.unite);
    unite.replaceChildren(...compatibles.map(u=>el('option',{value:u,text:LIBELLE_UNITE[u]})));
    const affichage=formatAffichage(Number(o.format),type.unite); format.value=affichage.valeur.replace(',','.');
    unite.value=compatibles.includes(affichage.unite)?affichage.unite:(compatibles[0]||'');
    if(unite.options.length&&!unite.value)unite.selectedIndex=0;
    const date=el('input',{class:'champ',type:'date',value:o.date}), promo=el('input',{type:'checkbox',checked:o.promo});
    const msg=el('p',{class:'erreur',role:'alert',hidden:true}), prixNormaliseEdition=el('p',{class:'prix-normalise'});
    const boutonEdition=el('button',{type:'submit',class:'btn btn-primaire',text:'Enregistrer',disabled:true});
    const form=el('form',{novalidate:true},el('label',{class:'etiquette',text:'Magasin'}),magasin,el('label',{class:'etiquette',text:'Prix'}),prix,el('label',{class:'etiquette',text:'Format'}),format,unite,prixNormaliseEdition,el('label',{class:'promo-ligne'},promo,' Promo'),el('label',{class:'etiquette',text:'Date'}),date,msg,
      el('div',{class:'feuille-actions'},boutonEdition,el('button',{type:'button',class:'btn btn-secondaire',text:'Annuler',onclick:()=>d.close()})));
    function verifierEdition(){const p=analyserPrixSaisie(prix.value),f=verifierFormat(type.unite,Number(format.value),unite.value);prixNormaliseEdition.textContent=p&&f.ok?formaterPrixNormalise(prixNormalise(p,f.formatBase,type.unite).centimesParUnite,type.unite):'';boutonEdition.disabled=!(p&&format.value.trim()&&unite.value&&f.ok);}
    prix.addEventListener('input',verifierEdition);format.addEventListener('input',verifierEdition);unite.addEventListener('change',verifierEdition);verifierEdition();
    form.addEventListener('submit',async e=>{e.preventDefault();msg.hidden=true;const p=analyserPrixSaisie(prix.value),f=verifierFormat(type.unite,Number(format.value),unite.value);if(!p||!format.value.trim()||!unite.value||!f.ok){msg.textContent='Saisissez un prix et un format compatibles.';msg.hidden=false;return;}try{await modifierReleve(o.id,{magasin:magasin.value,prixCentimes:p,format:f.formatBase,date:date.value,promo:promo.checked});d.close();await dessiner();}catch(err){msg.textContent=err.message;msg.hidden=false;}});
    d.append(form);
    d.addEventListener('click',e=>{if(e.target===d)d.close();});
    d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();
  }
    await dessiner();
  }
  charger().catch((e) => { console.error('Chargement impossible', e); liste.replaceChildren(carte('Historique', 'Chargement impossible')); });
  return racine;
}

// ---- Relevé mensuel enchaîné (FR7 / E5.1 / E5.2) --------------------------------------------
async function vueListeCourses() {
  await dbPrete;
  const racine=el('div',{class:'liste-avant-courses'});
  const titreListe=el('h2',{text:'Avant les courses'});
  const aide=el('p',{class:'aide',text:'Comparaison des prix habituels, sans dépendance au réseau.'});
  const choix=el('div',{class:'selecteur-magasin'});
  const contenu=el('div',{class:'groupes-liste-courses'});
  let magasinListe=await lireReglage('magasinCourant',MAGASIN.LECLERC);
  const boutons=[MAGASIN.LECLERC,MAGASIN.INTERMARCHE].map(m=>el('button',{type:'button',class:'magasin-btn','aria-pressed':m===magasinListe,text:libelleMagasin(m),onclick:async()=>{magasinListe=m;magasinCourant=m;await ecrireReglage('magasinCourant',m);boutons.forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===libelleMagasin(m))));await dessiner();}}));
  choix.append(...boutons);
  racine.append(titreListe,aide,choix,contenu);
  const groupes=[[VERDICT.ACHETER_ICI,'Acheter ici'],[VERDICT.ATTENDRE,'Attendre l’autre magasin'],[VERDICT.INDIFFERENT,'Indifférent'],[VERDICT.INSUFFISANT,'Données insuffisantes']];
  async function dessiner(){
    const types=(await listerTypes()).filter(t=>!t.archive).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
    const seuilPct=Number(await lireReglage('seuilIndifference',5)), dateDuJour=aujourdHui();
    const analyses=await Promise.all(types.map(async type=>{
      const observations=await lireObservations(type.id);
      const courant=prixHabituel(observations,magasinListe,type.unite,dateDuJour);
      let resultat=VERDICT.INSUFFISANT, details='Aucun prix habituel exploitable.';
      if(courant.ok){
        const formatBase=type.unite==='unit'?1:1000;
        const verdict=calculerVerdict({prixCentimes:Math.round(courant.valeur),formatBase,typeUnit:type.unite,magasin:magasinListe,observations,aujourdhui:dateDuJour,seuilPct});
        resultat=verdict.resultat;
        details='Prix habituel ici : '+formaterPrixNormalise(courant.valeur,type.unite);
        if(Number.isFinite(verdict.differenceUniteCentimes)) details+=' · écart : '+formaterPrixEuros(Math.abs(verdict.differenceUniteCentimes))+(verdict.differenceUniteCentimes<0?' moins cher':verdict.differenceUniteCentimes>0?' plus cher':'');
      }
      return {type,resultat,details};
    }));
    contenu.replaceChildren();
    for(const [resultat,titreGroupe] of groupes){
      const lignes=analyses.filter(a=>a.resultat===resultat),liste=el('div',{class:'lignes-groupe'});
      if(lignes.length) liste.append(...lignes.map(a=>el('a',{class:'ligne-liste-course',href:'#/fiche/'+a.type.id},
        el('strong',{text:a.type.nom}),el('span',{class:'puce',text:LIBELLE_UNITE[a.type.unite]}),el('span',{class:'detail-prix-liste',text:a.details}))));
      else liste.append(el('p',{class:'aide',text:'Aucun type dans ce groupe.'}));
      contenu.append(el('section',{class:'carte groupe-liste-courses'},el('h3',{text:titreGroupe+' ('+lignes.length+')'}),liste));
    }
    if(!types.length) contenu.prepend(el('section',{class:'carte',text:'Aucun type actif. Créez un type ou restaurez-en un depuis la liste Types.'}));
  }
  await dessiner();
  return racine;
}
async function vueReleveMensuel() {
  await dbPrete;
  const racine = el('div', { class: 'releve-mensuel' });
  const types = (await listerTypes()).filter(t => !t.archive).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
  const contenu = el('section', { class: 'carte carte-mensuelle' });
  const progression = el('p', { class: 'progression-mensuelle', 'aria-live': 'polite' });
  const message = el('p', { class: 'message-succes', role: 'status', hidden: true });
  const zoneMiniVerdict = el('p', { class: 'mini-verdict-mensuel', 'aria-live': 'polite', hidden: true });
  const actions = el('div', { class: 'actions-mensuelles' });
  const boutonPasser = el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Passer', onclick: () => avancer(true) });
  const boutonSuivant = el('button', { type: 'button', class: 'btn btn-primaire', text: 'Suivant', disabled: true, onclick: enregistrerEtAvancer });
  const boutonQuitter = el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Quitter', onclick: () => { location.hash = '#/types'; } });
  actions.append(boutonPasser, boutonSuivant);
  racine.append(boutonQuitter, progression, contenu, zoneMiniVerdict, message, actions);
  let index = 0, saisis = 0, passes = 0, date = aujourdHui(), typeActuel = null, tokenVerdict = 0;
  let dernier = null;
  const champPrix = el('input', { id:'mensuel-prix', class:'champ champ-prix', inputmode:'decimal', enterkeyhint:'next', autocomplete:'off', placeholder:'0,00', 'aria-label':'Prix en euros' });
  const champFormat = el('input', { id:'mensuel-format', class:'champ', type:'number', inputmode:'decimal', enterkeyhint:'done', min:'0', step:'any', 'aria-label':'Valeur du format' });
  const champUnite = el('select', { id:'mensuel-unite', class:'champ', 'aria-label':'Unité du format' });
  const promo = el('input', { id:'mensuel-promo', type:'checkbox' });
  const libellePromo = el('label', { class:'promo-ligne', for:'mensuel-promo' }, promo, ' Promo');
  const erreur = el('p', { class:'erreur', role:'alert', hidden:true });
  function valide() {
    if (!typeActuel) return false;
    const prix = analyserPrixSaisie(champPrix.value);
    const f = verifierFormat(typeActuel.unite, Number(champFormat.value), champUnite.value);
    return Boolean(prix && champFormat.value.trim() && champUnite.value && f.ok);
  }
  async function actualiserMiniVerdict() {
    const token = ++tokenVerdict;
    if (!valide()) { zoneMiniVerdict.hidden = true; boutonSuivant.disabled = true; return; }
    const prix = analyserPrixSaisie(champPrix.value), f = verifierFormat(typeActuel.unite, Number(champFormat.value), champUnite.value);
    try {
      const observations = await lireObservations(typeActuel.id), seuilPct = await lireReglage('seuilIndifference', 5);
      if (token !== tokenVerdict || !valide()) return;
      const v = calculerVerdict({ prixCentimes:prix, formatBase:f.formatBase, typeUnit:typeActuel.unite, magasin:MAGASIN.INTERMARCHE, observations, aujourdhui:date, seuilPct, promo:promo.checked });
      const label = v.resultat === VERDICT.ACHETER_ICI ? 'Acheter ici' : v.resultat === VERDICT.ATTENDRE ? 'Attendre Leclerc' : v.resultat === VERDICT.INDIFFERENT ? 'Indifférent' : 'Données insuffisantes';
      const ecart = Number.isFinite(v.ecart) ? ' · ' + (v.ecart>0?'+':'') + Math.round(v.ecart*100) + ' %' : '';
      zoneMiniVerdict.textContent = label + ecart; zoneMiniVerdict.hidden = false; boutonSuivant.disabled = false;
    } catch { zoneMiniVerdict.textContent = 'Données insuffisantes'; zoneMiniVerdict.hidden = false; boutonSuivant.disabled = false; }
  }
  async function chargerCarte() {
    message.hidden = true; erreur.hidden = true; zoneMiniVerdict.hidden = true;
    if (index >= types.length) {
      progression.textContent = 'Relevé terminé';
      contenu.replaceChildren(el('h2',{text:'Relevé mensuel terminé'}),el('p',{text:saisis+' saisi'+(saisis>1?'s':'')+', '+passes+' passé'+(passes>1?'s':'')+'.'}));
      actions.hidden = true; return;
    }
    typeActuel = types[index]; dernier = await lireDernierReleve(typeActuel.id, MAGASIN.INTERMARCHE);
    progression.textContent = (index+1)+' / '+types.length;
    const compatibles = unitesCompatibles(typeActuel.unite), aff = dernier ? formatAffichage(Number(dernier.format),typeActuel.unite) : {valeur:'',unite:compatibles[0]||''};
    champPrix.value = ''; champFormat.value = aff.valeur===''?'':String(aff.valeur).replace(',','.');
    champUnite.replaceChildren(...compatibles.map(u=>el('option',{value:u,text:LIBELLE_UNITE[u]})));
    champUnite.value = compatibles.includes(aff.unite)?aff.unite:(compatibles[0]||'');
    if(champUnite.options.length&&!champUnite.value)champUnite.selectedIndex=0;
    promo.checked = false;
    contenu.replaceChildren(el('h2',{text:typeActuel.nom}),el('label',{class:'etiquette',for:'mensuel-prix',text:'Prix'}),champPrix,
      el('label',{class:'etiquette',for:'mensuel-format',text:'Format'}),champFormat,champUnite,libellePromo,erreur);
    boutonSuivant.disabled = true; boutonPasser.disabled = false; void actualiserMiniVerdict();
  }
  async function avancer(estPasse=false) {
    if (estPasse) passes++;
    index++;
    if (index < types.length) await chargerCarte();
    else {
      await chargerCarte();
      const fin = el('section',{class:'carte'},el('h2',{text:'Relevé mensuel terminé'}),el('p',{text:saisis+' saisi'+(saisis>1?'s':'')+', '+passes+' passé'+(passes>1?'s':'')+'.'}));
      contenu.replaceChildren(fin); progression.textContent='Relevé terminé'; actions.hidden=true;
    }
  }
  async function enregistrerEtAvancer() {
    if (!valide()) return;
    const prixCentimes=analyserPrixSaisie(champPrix.value),f=verifierFormat(typeActuel.unite,Number(champFormat.value),champUnite.value);
    const observation={type:typeActuel.id,magasin:MAGASIN.INTERMARCHE,date,prixCentimes,format:f.formatBase,promo:promo.checked};
    boutonSuivant.disabled=true;
    try {
      const nNouveau=prixNormalise(prixCentimes,f.formatBase,typeActuel.unite).centimesParUnite;
      if (dernier) {
        const nDernier=prixNormalise(dernier.prixCentimes,dernier.format,typeActuel.unite).centimesParUnite;
        if (estPrixIncoherent(nNouveau,nDernier) && !await demanderConfirmationPrix(formaterPrixNormalise(nDernier,typeActuel.unite))) { boutonSuivant.disabled=false; return; }
      }
      const analyse=(await analyserDoublons([observation]))[0]; let remplace=false;
      if(analyse.decision==='conserver') remplace=await demanderRemplacement(formaterPrixNormalise(analyse.nExistant,typeActuel.unite),observation.promo);
      if(analyse.decision==='conserver'&&!remplace){boutonSuivant.disabled=false;return;}
      const jeton=await enregistrerReleves([observation],{remplacements:[remplace]});
      if(jeton.ajoutes.length) saisis++;
      await avancer(false);
    } catch(e) { erreur.textContent=e.message||'Enregistrement impossible.'; erreur.hidden=false; boutonSuivant.disabled=false; }
  }
  function modeMensuel() {
    if(!racine.isConnected)return;
    const vv=window.visualViewport, hauteur=vv?vv.height:window.innerHeight;
    const actif=modeSaisieForce===null?modeSaisieActif(window.innerHeight,hauteur):modeSaisieForce;
    document.body.classList.toggle('mode-saisie',actif);
    const champ=document.activeElement;
    if(actif&&champ?.matches?.('#mensuel-prix,#mensuel-format')) requestAnimationFrame(()=>{
      const label=contenu.querySelector('label[for="'+champ.id+'"]'),rc=champ.getBoundingClientRect(),rl=label?.getBoundingClientRect();
      const rect={top:Math.min(rc.top,rl?.top??rc.top),bottom:Math.max(rc.bottom,rl?.bottom??rc.bottom)};
      const haut=Math.max(vv?.offsetTop||0,document.querySelector('.topbar')?.getBoundingClientRect().bottom||0);
      const bas=(vv?.offsetTop||0)+(vv?.height||window.innerHeight)-12;
      const delta=positionDefilement(rect,haut,bas,12); if(delta)window.scrollBy({top:delta,behavior:'auto'});
    });
  }
  const viewport=()=>modeMensuel();
  window.addEventListener('resize',viewport); window.visualViewport?.addEventListener('resize',viewport); window.visualViewport?.addEventListener('scroll',viewport);
  window.__actualiserModeMensuel=modeMensuel;
  window.__releveMensuelCleanup=()=>{window.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport);delete window.__actualiserModeMensuel;document.body.classList.remove('mode-saisie');};
  champPrix.addEventListener('focus',modeMensuel); champFormat.addEventListener('focus',modeMensuel);
  champPrix.addEventListener('input',()=>void actualiserMiniVerdict()); champFormat.addEventListener('input',()=>void actualiserMiniVerdict()); champUnite.addEventListener('change',()=>void actualiserMiniVerdict());promo.addEventListener('change',()=>void actualiserMiniVerdict());
  champFormat.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();champFormat.blur();}});
  await chargerCarte();
  return racine;
}

async function vueFicheType(typeId) {
  await dbPrete;
  const type = await lireTypeSafe(typeId);
  if (!type) return carte('Fiche du type', 'Type introuvable.');
  const racine = el('div', { class: 'fiche-type' });
  racine.append(el('a', { href: '#/types', class: 'btn btn-secondaire btn-bloc', text: '← Retour aux types' }));
  const observations = await lireObservations(typeId), dateDuJour = aujourdHui();
  const leclerc = prixHabituel(observations, MAGASIN.LECLERC, type.unite, dateDuJour);
  const inter = prixHabituel(observations, MAGASIN.INTERMARCHE, type.unite, dateDuJour);
  const freqLeclerc = frequencePromos(observations, MAGASIN.LECLERC), freqInter = frequencePromos(observations, MAGASIN.INTERMARCHE);
  const dernierPromo = magasin => observations.filter(o => o.magasin === magasin && Boolean(o.promo)).sort((a,b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id||0)-(a.id||0))[0] || null;
  const promoTexte = magasin => { const o=dernierPromo(magasin); if(!o)return 'Aucun relevé promo.'; const p=prixNormalise(o.prixCentimes,o.format,type.unite); return 'Dernier prix promo : '+(p.ok?formaterPrixNormalise(p.centimesParUnite,type.unite):'indisponible')+' · '+dateAffichee(o.date); };
  const freqTexte = f => f.ok ? f.nbPromos+' relevé'+(f.nbPromos>1?'s':'')+' sur '+f.nbReleves+' en promo ('+String(f.pourcentage).replace('.',',')+' %)' : 'Fréquence indisponible (aucun relevé).';
  const leclercCarte=el('section',{class:'carte carte-prix'},el('h3',{text:'Leclerc'}),
    el('p',{text:leclerc.ok?'Prix habituel : '+formaterPrixNormalise(leclerc.valeur,type.unite)+' · médiane de '+leclerc.nbReleves+' relevés hors promo sur 8 semaines':'Prix habituel : données insuffisantes ('+leclerc.nbReleves+' relevés hors promo sur 8 semaines).'}),
    el('p',{text:promoTexte(MAGASIN.LECLERC)}),el('p',{text:'Fréquence : '+freqTexte(freqLeclerc)}));
  const interCarte=el('section',{class:'carte carte-prix'},el('h3',{text:'Intermarché'}),
    el('p',{text:inter.ok?'Prix habituel : '+formaterPrixNormalise(inter.valeur,type.unite)+' · relevé du '+dateAffichee(inter.date):'Prix habituel : données insuffisantes.'}),
    el('p',{text:promoTexte(MAGASIN.INTERMARCHE)}),el('p',{text:'Fréquence : '+freqTexte(freqInter)}));
  const vals=[leclerc.ok?leclerc.valeur:null,inter.ok?inter.valeur:null].filter(Number.isFinite),max=vals.length?Math.max(...vals):0;
  const barre=(nom,r,magasin)=>{const valeur=r.ok?r.valeur:null,largeur=valeur!=null&&max>0?Math.max(0,Math.min(100,valeur/max*100)):0;return el('div',{class:'barre-comparaison'},el('span',{text:nom}),el('div',{class:'barre-fond',role:'img','aria-label':nom+' : '+(valeur==null?'données insuffisantes':formaterPrixNormalise(valeur,type.unite))},el('div',{class:'barre-remplissage '+(magasin===MAGASIN.LECLERC?'barre-leclerc':'barre-intermarche'),style:'width:'+largeur+'%'})),el('strong',{text:valeur==null?'—':formaterPrixNormalise(valeur,type.unite)}));};
  const barres=el('section',{class:'carte'},el('h3',{text:'Comparaison des prix habituels'}),el('div',{class:'barres-comparaison'},barre('Leclerc',leclerc,MAGASIN.LECLERC),barre('Intermarché',inter,MAGASIN.INTERMARCHE)));
  racine.append(el('h2',{text:type.nom}),leclercCarte,interCarte,barres,
    el('p',{class:'aide note-biais-promo',text:'Attention : si vos relevés sont surtout effectués en promotion, la fréquence affichée peut être biaisée.'}),
    el('h3',{text:'Historique des relevés'}),vueHistorique(typeId,true));
  return racine;
}

async function lireTypeSafe(id){ const r=await listerTypes(); return r.find(t=>t.id===Number(id))||null; }

const ROUTES = {
  magasin: { titre: 'Magasin', onglet: 'magasin', vue: vueMagasin },
  liste: { titre: 'Liste', onglet: 'liste', vue: vueListeCourses },
  types: { titre: 'Types', onglet: 'types', vue: vueTypes },
  'type-nouveau': { titre: 'Nouveau type', onglet: 'types', vue: () => vueTypeForm(null) },
  'type-edit': { titre: 'Modifier le type', onglet: 'types', vue: (p) => vueTypeForm(Number(p)) },
  bilan: { titre: 'Bilan', onglet: 'bilan', vue: () => carte('Économies réalisées', 'Cet écran arrive avec l’épic E7.') },
  reglages: { titre: 'Réglages', onglet: null, vue: vueReglages },
  historique: { titre: 'Historique', onglet: 'types', vue: (p) => vueHistorique(Number(p)) },
  fiche: { titre: 'Fiche du type', onglet: 'types', vue: (p) => vueFicheType(Number(p)) },
  'releve-mensuel': { titre: 'Relevé mensuel', onglet: 'types', vue: vueReleveMensuel }
};

async function afficher() {
  const sequence = ++sequenceAffichage;
  const [nom, param] = (location.hash.replace('#/', '') || 'magasin').split('/');
  if (nom !== 'releve-mensuel') { window.__releveMensuelCleanup?.(); window.__releveMensuelCleanup=null; }
  if (nom !== 'magasin') { document.getElementById('dock-magasin')?.remove(); dockResizeObserver?.disconnect(); document.documentElement.style.setProperty('--dock-hauteur', '0px'); }
  const r = ROUTES[nom] || ROUTES.magasin;
  titre.textContent = r.titre; document.title = r.titre + ' · Appli Courses';
  const contenu = await r.vue(param);
  if (sequence !== sequenceAffichage) return;
  vue.replaceChildren(contenu);
  if (nom === 'magasin' && !rappelMasqueSession) {
    try {
      await dbPrete;
      if (sequence !== sequenceAffichage) return;
      const dateExport = await lireReglage('dernierExport', null);
      if (sequence !== sequenceAffichage) return;
      const etatRappel = etatRappelExport(dateExport, aujourdHui(), 30);
      if (etatRappel !== 'ok') {
        const texte = etatRappel === 'jamais'
          ? 'Aucune sauvegarde enregistrée. Exportez vos données pour éviter de les perdre.'
          : 'Votre dernière sauvegarde date du ' + dateAffichee(dateExport) + '. Pensez à exporter vos données.';
        let bandeau;
        bandeau = el('aside', { class: 'bandeau-rappel-export', role: 'status' },
          el('span', { text: texte }),
          el('button', { type: 'button', class: 'btn-fermer-rappel', text: 'Fermer', onclick: () => { rappelMasqueSession = true; bandeau.remove(); } })
        );
        vue.prepend(bandeau);
      }
    } catch (e) { console.error('Lecture du rappel de sauvegarde impossible', e); }
  }
  vue.style.animation = 'none'; void vue.offsetWidth; vue.style.animation = '';
  onglets.forEach((a) => a.dataset.route === r.onglet ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  window.scrollTo(0, 0);
  window.__routeAffichee = location.hash;
}
if (!location.hash) history.replaceState(null, '', '#/magasin');
window.addEventListener('hashchange', () => { void afficher(); }); void afficher();

(async () => {
  try {
    await initDb();
    magasinCourant = await lireReglage('magasinCourant', MAGASIN.LECLERC);
    diagnostic.base = 'ouverte (schéma v' + VERSION_SCHEMA + ')';
    const ok = await demanderStockagePersistant();
    diagnostic.persistant = ok === null ? 'non géré par ce navigateur' : (ok ? 'oui' : 'non (pensez à exporter régulièrement)');
    const n = (await lireReglage('lancements', 0)) + 1; await ecrireReglage('lancements', n); diagnostic.lancements = String(n);
    const parts = []; for (const s of STORES) parts.push(s + ' ' + (await compter(s))); diagnostic.comptes = parts.join(' · ');
    if (location.hash === '#/magasin') void afficher();
  } catch (e) { diagnostic.base = 'ERREUR : ' + (e && e.message ? e.message : e); if (location.hash === '#/reglages') void afficher(); }
})();

function demanderVersion() { const ctrl = navigator.serviceWorker.controller; if (ctrl) ctrl.postMessage({ type: 'GET_VERSION' }); }
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'VERSION') { versionAppli = e.data.version; if (location.hash === '#/reglages') void afficher(); }});
  navigator.serviceWorker.addEventListener('controllerchange', demanderVersion);
  navigator.serviceWorker.register('sw.js').then(demanderVersion).catch(() => { versionAppli = 'service worker indisponible'; });
} else versionAppli = 'service worker non disponible';
