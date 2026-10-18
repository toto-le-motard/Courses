// app.js — interface et navigation (stories 1.2 à 3-2).
import { initDb, dbPrete, listerTypes, creerTypeEtArticle, annulerCreationTypeEtArticle, lireDernierReleve, lireObservations, dernierReleve, trouverDoublon, enregistrerReleves, analyserDoublons, annulerEnregistrement, listerReleves, modifierReleve, supprimerReleve, enregistrerAchat, listerAchats, modifierAchat, supprimerAchat, demanderStockagePersistant, lireReglage, ecrireReglage, compter, STORES, VERSION_SCHEMA, exporterCollections, remplacerCollections, lire, mettre, toutLire, supprimer, listerMagasins, lireMagasin, creerMagasin, modifierMagasin, archiverMagasin, restaurerMagasin, supprimerMagasin } from './db.js';
import { UNITES, LIBELLE_UNITE, VERDICT, analyserPrixSaisie, verifierFormat, prixNormalise, formaterPrixEuros, formaterPrixNormalise, calculerEconomieRealisee, estPrixIncoherent, unitesCompatibles, formatAffichage, calculerPositionDock, modeSaisieActif, positionDefilement, frequencePromos, deduireUniteComparaison, normaliserNom, calculerVerdictMagasins, prixHabituelMagasin, listeAvantCoursesMagasins } from './domain.js';
import { accueilVide, vueTypes, vueTypeForm } from './types-ui.js';
import { creerSauvegarde, validerSauvegarde, etatRappelExport } from './backup.js';

const vue = document.getElementById('vue');
const titre = document.getElementById('titre-ecran');
const pastille = document.getElementById('offline-pill');
const onglets = document.querySelectorAll('.tabs a');

let versionAppli = '…';
let diagnostic = { base: 'ouverture…', persistant: '…', lancements: '…', comptes: '' };
let magasinCourant = '';
let magasinsTous = [];
let magasinsDisponibles = [];
const ongletsFicheActifs = new Map();
async function actualiserMagasins() { magasinsTous = await listerMagasins(); magasinsDisponibles = magasinsTous.filter(m => !m.archive); return magasinsTous; }
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

function afficherAnnulation(jeton, magasin, options = {}) {
  annulationActive = jeton;
  if (annulationTimer) clearTimeout(annulationTimer);
  document.getElementById('bandeau-annulation')?.remove();
  const b = el('div', { id: 'bandeau-annulation', class: 'bandeau-annulation', role: 'status' },
    el('span', { text: options.message || ('Enregistré chez ' + libelleMagasin(magasin)), style:'color:'+couleurMagasin(magasin) }),
    el('button', { type: 'button', class: 'btn-annuler-enregistrement', text: 'Annuler', onclick: async () => {
      if (!annulationActive) return;
      const a = annulationActive; annulationActive = null; clearTimeout(annulationTimer); b.remove();
      try {
        if (options.annuler) await options.annuler(a);
        else await annulerEnregistrement(a);
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
function libelleMagasin(m) { const magasin = magasinsTous.find(s => s.id === m); return magasin ? magasin.nom + (magasin.archive ? ' (archivé)' : '') : String(m || 'Magasin'); }
function classeMagasin(m) { return 'magasin-' + String(m || 'inconnu').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-'); }
function couleurMagasin(id) { return magasinsTous.find(s => s.id === id)?.couleur || '#8FA3C7'; }

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
    if (!dialogue.isConnected) document.body.append(dialogue);
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

  // E9 / stories 9-3 et 9-4 — gestion locale des magasins.
  await actualiserMagasins();
  const carteMagasins = el('section',{class:'carte carte-magasins',id:'reglages-magasins'},
    el('h2',{text:'Magasins'}),
    el('p',{text:'Configurez les magasins comparés. Les prix constatés et achats déjà enregistrés restent conservés.'})
  );
  const messageMagasins = el('p',{class:'message-sauvegarde',role:'status',hidden:true});
  function afficherMessageMagasins(texte) { messageMagasins.textContent=texte; messageMagasins.hidden=!texte; }
  function boutonCouleur(m, petit=false) { return el('span',{class:'pastille-magasin'+(petit?' petite':''),style:'background:'+m.couleur,'aria-label':'Couleur '+m.nom}); }
  function ouvrirFormulaireMagasin(magasin=null) {
    const existants=magasinsTous.filter(m=>m.id!==magasin?.id);
    const couleurs=['#5B8CFF','#FF6B5E','#3DDC97','#B07CFF','#2EC4D6','#FF8FC7','#D9A066','#8FA3C7'];
    const couleurChoisie={value:magasin?.couleur || couleurs.find(c=>!existants.some(m=>m.couleur===c)) || couleurs[0]};
    const nom=el('input',{class:'champ',type:'text',required:true,maxlength:'60',value:magasin?.nom||'',placeholder:'Nom du magasin','aria-label':'Nom du magasin'});
    const enseigne=el('input',{class:'champ',type:'text',value:magasin?.enseigne||'',placeholder:'Enseigne','aria-label':'Enseigne'});
    const localisation=el('input',{class:'champ',type:'text',value:magasin?.localisation||'',placeholder:'Ville ou adresse facultative','aria-label':'Localisation'});
    const modeChoisi={value:magasin?.modePrixHabituel||'dernier'};
    const aide=el('p',{class:'aide-magasin',text:modeChoisi.value==='mediane'?'Médiane des relevés hors promo des 8 dernières semaines (3 minimum).':'Dernier relevé hors promo, avec sa date.'});
    const modeDernier=el('button',{type:'button',class:'btn btn-secondaire','aria-pressed':modeChoisi.value==='dernier',text:'Dernier relevé',onclick:()=>{modeChoisi.value='dernier';actualiserMode();}});
    const modeMediane=el('button',{type:'button',class:'btn btn-secondaire','aria-pressed':modeChoisi.value==='mediane',text:'Médiane 8 semaines',onclick:()=>{modeChoisi.value='mediane';actualiserMode();}});
    const mode=el('div',{class:'choix-mode-prix'},modeDernier,modeMediane);
    function actualiserMode(){modeDernier.setAttribute('aria-pressed',String(modeChoisi.value==='dernier'));modeMediane.setAttribute('aria-pressed',String(modeChoisi.value==='mediane'));aide.textContent=modeChoisi.value==='mediane'?'Médiane des relevés hors promo des 8 dernières semaines (3 minimum).':'Dernier relevé hors promo, avec sa date.';}
    const comparable=el('input',{type:'checkbox',checked:magasin?magasin.comparable:true,'aria-label':'Participe aux comparaisons'});
    const palette=el('div',{class:'palette-couleurs'},...couleurs.map(c=>el('button',{type:'button',class:'choix-couleur','aria-label':'Choisir '+c,'aria-pressed':c===couleurChoisie.value,style:'background:'+c,onclick:()=>{couleurChoisie.value=c;palette.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute('aria-label')==='Choisir '+c)));}})));
    const erreur=el('p',{class:'erreur',role:'alert',hidden:true});
    const dialogue=el('dialog',{class:'feuille formulaire-magasin'},
      el('h2',{text:magasin?'Modifier le magasin':'Nouveau magasin'}),
      el('label',{text:'Nom *'},nom),el('label',{text:'Enseigne'},enseigne),el('label',{text:'Localisation'},localisation),
      el('label',{text:'Couleur'}),palette,el('label',{text:'Prix habituel'}),mode,aide,
      el('label',{class:'option-comparable'},comparable,el('span',{text:'Participe aux comparaisons'})),
      erreur,
      el('div',{class:'feuille-actions'},
        el('button',{type:'button',class:'btn btn-primaire',text:'Enregistrer',onclick:async()=>{try{const champs={nom:nom.value,enseigne:enseigne.value,localisation:localisation.value,couleur:couleurChoisie.value,modePrixHabituel:modeChoisi.value,comparable:comparable.checked};if(magasin)await modifierMagasin(magasin.id,champs);else await creerMagasin(champs);dialogue.close();await actualiserMagasins();magasinCourant=await lireReglage('magasinCourant',magasinsDisponibles[0]?.id||'');await afficher();}catch(e){erreur.textContent=e.message||'Enregistrement impossible.';erreur.hidden=false;}}}),
        el('button',{type:'button',class:'btn btn-secondaire',text:'Annuler',onclick:()=>dialogue.close()})
      )
    );
    dialogue.addEventListener('close',()=>dialogue.remove());document.body.append(dialogue);dialogue.showModal();nom.focus();
  }
  async function actionMagasin(magasin,action) {
    try {
      if(action==='modifier'){ouvrirFormulaireMagasin(magasin);return;}
      if(action==='archiver') await archiverMagasin(magasin.id);
      if(action==='restaurer') await restaurerMagasin(magasin.id);
      if(action==='supprimer') await supprimerMagasin(magasin.id);
      await actualiserMagasins();
      magasinCourant=await lireReglage('magasinCourant',magasinsDisponibles[0]?.id||'');
      await afficher();
    } catch(e) { afficherMessageMagasins(e.message||'Action impossible.'); }
  }
  function ligneMagasin(m,archive=false) {
    const texte=el('div',{class:'magasin-details'},el('strong',{text:m.nom}),el('span',{text:[m.enseigne,m.localisation].filter(Boolean).join(' · ')}));
    const ligne=el('div',{class:'ligne-magasin'},boutonCouleur(m),texte);
    if(archive) ligne.append(el('button',{type:'button',class:'btn btn-secondaire',text:'Restaurer',onclick:()=>actionMagasin(m,'restaurer')}));
    else ligne.append(el('button',{type:'button',class:'btn btn-secondaire bouton-menu-magasin','aria-label':'Options '+m.nom,text:'⋯',onclick:()=>{const menu=el('dialog',{class:'feuille menu-magasin'},el('h2',{text:m.nom}),el('button',{type:'button',class:'btn btn-secondaire btn-bloc',text:'Modifier',onclick:()=>{menu.close();actionMagasin(m,'modifier');}}),el('button',{type:'button',class:'btn btn-secondaire btn-bloc',text:'Archiver',onclick:()=>{menu.close();actionMagasin(m,'archiver');}}),el('button',{type:'button',class:'btn btn-secondaire btn-bloc',text:'Supprimer',onclick:()=>{menu.close();actionMagasin(m,'supprimer');}}),el('button',{type:'button',class:'btn btn-secondaire btn-bloc',text:'Fermer',onclick:()=>menu.close()}));menu.addEventListener('close',()=>menu.remove());document.body.append(menu);menu.showModal();}}));
    return ligne;
  }
  const actifsStores=magasinsTous.filter(m=>!m.archive);
  carteMagasins.append(el('div',{class:'liste-magasins'},...actifsStores.map(m=>ligneMagasin(m))));
  carteMagasins.append(el('button',{type:'button',class:'btn btn-primaire btn-bloc',text:'+ Nouveau magasin',onclick:()=>ouvrirFormulaireMagasin()}));
  const archivesStores=magasinsTous.filter(m=>m.archive);
  if(archivesStores.length) carteMagasins.append(el('details',{class:'magasins-archives'},el('summary',{text:'Archivés'}),el('div',{class:'liste-magasins'},...archivesStores.map(m=>ligneMagasin(m,true)))));
  carteMagasins.append(messageMagasins);
  d.append(carteMagasins);
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
async function vueMagasin() {
  await dbPrete;
  await actualiserMagasins();
  if (!magasinsDisponibles.length) throw new Error('Ajoutez un magasin actif dans Réglages.');
  if (!magasinsDisponibles.some(m => m.id === magasinCourant)) {
    magasinCourant = (await lireReglage('magasinCourant', magasinsDisponibles[0].id));
    if (!magasinsDisponibles.some(m => m.id === magasinCourant)) magasinCourant = magasinsDisponibles[0].id;
  }
  document.getElementById('dock-magasin')?.remove(); dockResizeObserver?.disconnect();
  const racine = el('div', { class: 'ecran-magasin' });
  const entete = el('div', { class: 'selecteur-magasin ' + classeMagasin(magasinCourant) });
  const boutonSelectionMagasin = el('button', { type:'button', class:'selecteur-magasin-bouton', 'aria-label':'Changer de magasin', text:libelleMagasin(magasinCourant)+' ▾', onclick:ouvrirFeuilleMagasins });
  function actualiserEnteteMagasin() {
    entete.className = 'selecteur-magasin ' + classeMagasin(magasinCourant);
    entete.style.background = couleurMagasin(magasinCourant) + '20';
    entete.style.borderColor = couleurMagasin(magasinCourant);
    entete.style.boxShadow = '0 0 22px ' + couleurMagasin(magasinCourant) + '33';
    boutonSelectionMagasin.textContent = libelleMagasin(magasinCourant) + ' ▾';
  }
  function ouvrirFeuilleMagasins() {
    const feuille = el('dialog', { class:'feuille feuille-magasins' },
      el('h2',{text:'Choisir un magasin'}),
      el('div',{class:'liste-magasins-choix'},...magasinsDisponibles.map(m=>el('button',{type:'button',class:'magasin-btn','aria-pressed':m.id===magasinCourant,style:'--couleur-magasin:'+m.couleur,text:m.nom+(m.localisation?' · '+m.localisation:''),onclick:async()=>{magasinCourant=m.id;await ecrireReglage('magasinCourant',m.id);feuille.close();actualiserEnteteMagasin();await chargerFormulaire();}}))),
      el('button',{type:'button',class:'btn btn-secondaire btn-bloc',text:'Gérer les magasins',onclick:()=>{feuille.close();location.hash='#/reglages/magasins';}})
    );
    feuille.addEventListener('close',()=>feuille.remove());
    document.body.append(feuille);feuille.showModal();
  }
  entete.append(boutonSelectionMagasin);
  actualiserEnteteMagasin();
  racine.append(entete);

  const formulaire = el('section', { id: 'formulaire-releve', class: 'carte formulaire-releve' });
  racine.append(formulaire);

  let types = [];
  let typeChoisi = null;
  let dernier = null;
  let date = aujourdHui();
  let calculVerdictToken = 0;
  let quantiteAchat = 1;
  let prixPayeAchat = null;
  let formatPayeAchat = null;
  let enregistrementEnCours = false;
  let formulaireModifie = false;
  let dockActions = null;

  function erreur(msg) { message.textContent = msg || ''; message.hidden = !msg; }
  function prixValide() { return analyserPrixSaisie(prix.value); }

  const boutonScanner = el('button', { type: 'button', class: 'btn btn-secondaire btn-scanner', id: 'btn-scanner', text: 'Scanner un code-barres', onclick: () => ouvrirScanner() });
  const recherche = el('input', { type: 'search', class: 'champ', id: 'champ-type', enterkeyhint: 'next', placeholder: 'Type de produit', autocomplete: 'off', 'aria-label': 'Type de produit' });
  const suggestions = el('div', { class: 'suggestions', id: 'suggestions-types' });
  const rappelType = el('div', { class:'rappel-type', id:'rappel-type', hidden:true, 'aria-label':'Derniers prix et achats du type' });
  async function actualiserRappelType(){
    const type=typeChoisi;
    if(!type){rappelType.replaceChildren();rappelType.hidden=true;return;}
    try{
      const [observations,achats]=await Promise.all([lireObservations(type.id),toutLire('Purchase')]);
      const dernierPrix=[...observations].sort((a,b)=>a.date!==b.date?(a.date<b.date?1:-1):(b.id||0)-(a.id||0))[0]||null;
      const dernierAchat=achats.filter(a=>Number(a.type)===Number(type.id)&&(a.achete===1||a.achete===true)).sort((a,b)=>a.date!==b.date?(a.date<b.date?1:-1):(b.id||0)-(a.id||0))[0]||null;
      const parties=[];
      if(dernierPrix){const n=prixNormalise(dernierPrix.prixCentimes,dernierPrix.format,type.unite);const texte='Dernier prix constaté '+(n.ok?formaterPrixNormalise(n.centimesParUnite,type.unite):'indisponible')+' · '+libelleMagasin(dernierPrix.magasin)+', '+dateAffichee(dernierPrix.date).slice(0,5);parties.push(el('button',{type:'button',class:'rappel-type-partie',title:texte,'aria-label':texte,text:texte,onclick:()=>{location.hash='#/fiche/'+type.id+'/prix/'+dernierPrix.id;}}));}
      if(dernierAchat){const texte='Dernier achat '+dateAffichee(dernierAchat.date).slice(0,5);if(parties.length)parties.push(el('span',{class:'rappel-type-separateur',text:' · '}));parties.push(el('button',{type:'button',class:'rappel-type-partie',title:texte,'aria-label':texte,text:texte,onclick:()=>{location.hash='#/fiche/'+type.id+'/achats';}}));}
      rappelType.replaceChildren(...parties);rappelType.hidden=!parties.length;
    }catch{rappelType.replaceChildren();rappelType.hidden=true;}
  }
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
    formulaireModifie = false;
    prix.value = '';
    recherche.value = typeChoisi ? typeChoisi.nom : '';
    suggestions.replaceChildren();
    void actualiserRappelType();
    chargerDernierEtFormat();
    verifier();
  });

  recherche.addEventListener('input', () => {
    typeChoisi = null; void actualiserRappelType();
    const q = recherche.value.trim() ? recherche.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';
    const visibles = types.filter((x) => x.type.nomNormalise.includes(q)).slice(0, 8);
    suggestions.replaceChildren(...visibles.map((x) => el('button', { type: 'button', class: 'suggestion-type', 'data-id': x.type.id, text: x.type.nom })));
    verifier();
  });
  valeurFormat.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valeurFormat.blur(); } });
  prix.addEventListener('input', verifier);
  valeurFormat.addEventListener('input', verifier);
  uniteFormat.addEventListener('change', verifier);
  prix.addEventListener('focus', () => { formulaireModifie = true; });
  valeurFormat.addEventListener('focus', () => { formulaireModifie = true; });
  uniteFormat.addEventListener('focus', () => { formulaireModifie = true; });
  prix.addEventListener('input', () => { formulaireModifie = true; });
  valeurFormat.addEventListener('input', () => { formulaireModifie = true; });
  uniteFormat.addEventListener('change', () => { formulaireModifie = true; });
  dateInput.addEventListener('change', () => { date = dateInput.value || aujourdHui(); dateTexte.textContent = dateAffichee(date); void actualiserVerdict(); });
  promo.addEventListener('change', () => { prixHorsPromoBloc.hidden = !promo.checked; if (!promo.checked) prixHorsPromo.value = ''; verifier(); });
  prixHorsPromo.addEventListener('input', verifier);
  async function enregistrerReleve(statutAchat = null, achatPersonnalise = null) {
    if (enregistrementEnCours) return;
    const prixCentimes = prixValide();
    if (!typeChoisi || !prixCentimes) return;
    const format = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    if (!format.ok) return;
    const quantite = Number(quantiteAchat);
    if (statutAchat !== null && (!Number.isInteger(quantite) || quantite < 1 || quantite > 999)) {
      erreur('Saisissez une quantité entière entre 1 et 999.');
      return;
    }
    enregistrementEnCours = true;
    bouton.disabled = true;
    try {
      const observations = [{ type: typeChoisi.id, magasin: magasinCourant, date, prixCentimes, format: format.formatBase, promo: promo.checked }];
      const horsPromoCentimes = prixHorsPromo.value.trim() ? analyserPrixSaisie(prixHorsPromo.value) : null;
      if (promo.checked && prixHorsPromo.value.trim() && !horsPromoCentimes) throw new Error('Le prix hors promo doit être supérieur à 0.');
      if (promo.checked && horsPromoCentimes) {
        if (horsPromoCentimes < prixCentimes) horsPromoAvertissement.hidden = false;
        observations.push({ type: typeChoisi.id, magasin: magasinCourant, date, prixCentimes: horsPromoCentimes, format: format.formatBase, promo: false });
      }
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
      const analyses = await analyserDoublons(observations);
      const remplacements = analyses.map(() => false);
      for (let i = 0; i < analyses.length; i++) {
        const analyse = analyses[i];
        if (analyse.decision !== 'conserver') continue;
        const remplacer = await demanderRemplacement(formaterPrixNormalise(analyse.nExistant, typeChoisi.unite), observations[i].promo);
        if (!remplacer) return;
        remplacements[i] = true;
      }
      let verdictAchat = null;
      if (statutAchat === 1) {
        const historiqueAvant = await lireObservations(typeChoisi.id);
        const seuilPct = await lireReglage('seuilIndifference', 5);
        verdictAchat = calculerVerdictMagasins({ prixCentimes, formatBase:format.formatBase, typeUnit:typeChoisi.unite, magasinCourant, magasins:magasinsTous, observations:historiqueAvant, aujourdhui:date, seuilPct, promo:promo.checked });
      }
      const jeton = await enregistrerReleves(observations, { remplacements });
      if (statutAchat === 1) {
        const observationId = jeton.ajoutes[0];
        if (!observationId) throw new Error('Le relevé n’a pas été créé : achat non enregistré.');
        const historiqueAvant = await lireObservations(typeChoisi.id);
        const habituelMemeMagasin = prixHabituelMagasin(historiqueAvant.filter(o=>o.id!==observationId),magasinsTous.find(m=>m.id===magasinCourant),typeChoisi.unite,date);
        const achatId = await enregistrerAchat({
          type:typeChoisi.id, observation:observationId, magasin:magasinCourant, date,
          achete:statutAchat, quantite, prixPayeCentimes:prixPayeAchat ?? prixCentimes, format:formatPayeAchat ?? format.formatBase,
          prixComparaisonCentimes:verdictAchat?.habituelComparaison?.valeur ?? verdictAchat?.habituelAutre?.valeur ?? null,
          magasinComparaison:verdictAchat?.magasinComparaison ?? '',
          prixHabituelMemeMagasinCentimes:habituelMemeMagasin.ok ? habituelMemeMagasin.valeur : null
        });
        jeton.achats = [achatId];
      }
      recherche.value = ''; typeChoisi = null; dernier = null; prix.value = ''; valeurFormat.value = ''; date = aujourdHui(); dateInput.value = date; dateTexte.textContent = dateAffichee(date); promo.checked = false;
      suggestions.replaceChildren(); prixHorsPromoBloc.hidden = true; prixHorsPromo.value = ''; horsPromoAvertissement.hidden = true;
      quantiteAchat = 1;
      formulaireModifie = false;
      prixPayeAchat = null; formatPayeAchat = null;
      await chargerFormulaire();
      if (jeton.ajoutes.length > 0) afficherAnnulation(jeton, magasinCourant);
      message.textContent = statutAchat === null ? '' : (statutAchat ? 'Achat enregistré.' : 'Non-achat enregistré.');
      message.hidden = statutAchat === null;
      document.activeElement?.blur();
    } catch (e) { erreur(e.message || 'Enregistrement impossible.'); }
    finally {
      enregistrementEnCours = false;
      bouton.disabled = !estFormulaireValide();
      const actions=document.getElementById('achat-actions');
      if(actions) actions.querySelectorAll('button').forEach(b=>b.disabled=false);
    }
  }
  async function ouvrirPrixAchatDifferent() {
    if (!typeChoisi || !prixValide()) return;
    const dialogue = el('dialog', { class:'feuille dialog-prix-achat' },
      el('h2', { text:'Prix réellement payé' }),
      el('p', { text:'Le relevé en rayon reste inchangé. Indiquez le prix et le format effectivement achetés.' }),
      el('label', { class:'etiquette', for:'prix-achat-paye', text:'Prix payé' }),
      el('input', { id:'prix-achat-paye', class:'champ', inputmode:'decimal', value:prix.value, autocomplete:'off', required:true }),
      el('label', { class:'etiquette', for:'format-achat-paye', text:'Format acheté' }),
      el('input', { id:'format-achat-paye', class:'champ', inputmode:'decimal', value:valeurFormat.value, required:true }),
      el('label', { class:'etiquette', for:'unite-achat', text:'Unité du format acheté' }),
      el('select', { id:'unite-achat', class:'champ', 'aria-label':'Unité du format acheté' },
        ...UNITES.filter(u=>unitesCompatibles(typeChoisi.unite).includes(u)).map(u=>el('option',{value:u,text:LIBELLE_UNITE[u]}))),
      el('p', { class:'erreur', id:'erreur-prix-achat', role:'alert', hidden:true }),
      el('div', { class:'feuille-actions' },
        el('button', { type:'button', class:'btn btn-secondaire', text:'Annuler', onclick:()=>dialogue.close() }),
        el('button', { type:'button', class:'btn btn-primaire', text:'Confirmer', onclick:async()=>{
          const p=analyserPrixSaisie(dialogue.querySelector('#prix-achat-paye').value);
          const f=verifierFormat(typeChoisi.unite,Number(dialogue.querySelector('#format-achat-paye').value),dialogue.querySelector('#unite-achat').value);
          const e=dialogue.querySelector('#erreur-prix-achat');
          if(!p||!f.ok){e.textContent='Saisissez un prix et un format valides.';e.hidden=false;return;}
          dialogue.close(); dialogue.remove();
          await enregistrerReleve(1,{prixPayeCentimes:p,format:f.formatBase});
        }})
      )
    );
    dialogue.addEventListener('close',()=>dialogue.remove());
    document.body.append(dialogue); dialogue.showModal();
  }

  bouton.addEventListener('click', () => { void enregistrerReleve(0); });


  async function ouvrirScanner() {
    function garderChampScannerVisible() {
      requestAnimationFrame(() => {
        const dialogActif = champCode.closest('dialog');
        if (!dialogActif || !champCode.isConnected) return;
        const champRect = champCode.getBoundingClientRect();
        const label = dialogActif.querySelector('label[for="scan-code-manuel"]');
        const labelRect = label?.getBoundingClientRect();
        const dialogRect = dialogActif.getBoundingClientRect();
        const haut = Math.min(champRect.top, labelRect?.top ?? champRect.top);
        const bas = Math.max(champRect.bottom, labelRect?.bottom ?? champRect.bottom);
        const hautVisible = dialogRect.top + 12, basVisible = dialogRect.bottom - 12;
        if (haut < hautVisible) dialogActif.scrollTop -= hautVisible - haut;
        else if (bas > basVisible) dialogActif.scrollTop += bas - basVisible;
      });
    }
    function actualiserBoutonCompleter() {
      const visible = Boolean(navigator.onLine && champCode.value.trim());
      boutonCompleter.hidden = !visible;
      // Les règles d’affichage des boutons peuvent supplanter le style natif [hidden] : imposer aussi display.
      boutonCompleter.style.display = visible ? '' : 'none';
      boutonCompleter.disabled = !visible;
    }
    let requeteOpenFoodFacts = null, delaiOpenFoodFacts = null;
    const champCode = el('input', { id: 'scan-code-manuel', class: 'champ', inputmode: 'numeric', enterkeyhint: 'search', autocomplete: 'off', placeholder: 'EAN-13 ou autre code', oninput: actualiserBoutonCompleter, onfocus: garderChampScannerVisible, onkeydown: event => { if (event.key === 'Enter') { event.preventDefault(); void traiterCode(champCode.value); } } });
    const boutonCompleter = el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Compléter', hidden: true, disabled: true, onclick: async () => {
      const code = String(champCode.value || '').trim();
      const message = dialogue.querySelector('#scan-message');
      if (!navigator.onLine) { actualiserBoutonCompleter(); message.textContent = 'Connexion indisponible. Vous pouvez saisir ou rattacher le code manuellement.'; message.hidden = false; return; }
      if (!code) { actualiserBoutonCompleter(); return; }
      boutonCompleter.disabled = true;
      message.hidden = true;
      requeteOpenFoodFacts?.abort();
      requeteOpenFoodFacts = new AbortController();
      delaiOpenFoodFacts = setTimeout(() => requeteOpenFoodFacts?.abort(), 8000);
      try {
        // Seul le code-barres est transmis. Aucun compte, historique ou réglage n'est envoyé.
        const reponse = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json', { signal: requeteOpenFoodFacts.signal });
        if (!dialogue.open) return;
        if (!reponse.ok) throw new Error('Service indisponible');
        const donnees = await reponse.json();
        if (!dialogue.open) return;
        if (donnees?.status !== 1 || !donnees.product) {
          message.textContent = 'Aucune fiche trouvée. Vous pouvez rattacher le code manuellement.';
          message.hidden = false;
          return;
        }
        const produit = donnees.product;
        const articleActuel = await lire('Article', code);
        if (!dialogue.open) return;
        const nom = String(produit.product_name || '').trim() || articleActuel?.nom || '';
        const marque = String(produit.brands || '').split(',')[0].trim() || articleActuel?.marque || '';
        const quantiteTexte = String(produit.product_quantity ?? '').trim();
        const correspondanceQuantite = quantiteTexte.match(/(\d+(?:[.,]\d+)?)/);
        let unite = String(produit.product_quantity_unit || '').trim().toLowerCase();
        if (!unite) unite = (quantiteTexte.match(/(?:^|\s)(kg|g|ml|l|units?|unité|unités|pcs|pieces?)\b/i) || [])[1]?.toLowerCase() || '';
        const quantite = correspondanceQuantite ? Number(correspondanceQuantite[1].replace(',', '.')) : NaN;
        if (['unité', 'unités', 'units', 'unit', 'piece', 'pieces', 'pcs'].includes(unite)) unite = 'unit';
        const facteur = unite === 'kg' || unite === 'l' ? 1000 : ['g', 'ml', 'unit'].includes(unite) ? 1 : NaN;
        const formatOff = Number.isFinite(quantite) && quantite > 0 && Number.isFinite(facteur) ? Math.round(quantite * facteur) : null;
        const articlePrefill = {
          ...(articleActuel || {}),
          nom,
          marque,
          format: articleActuel?.format || formatOff || undefined
        };
        dialogue.close();
        await ouvrirRattachement(code, articlePrefill);
      } catch {
        if (!dialogue.open) return;
        message.textContent = 'Open Food Facts est indisponible. Vous pouvez rattacher le code manuellement.';
        message.hidden = false;
      } finally {
        if (delaiOpenFoodFacts) clearTimeout(delaiOpenFoodFacts);
        delaiOpenFoodFacts = null;
        requeteOpenFoodFacts = null;
        if (dialogue.isConnected) actualiserBoutonCompleter();
      }
    }});
    const dialogue = el('dialog', { class: 'feuille dialog-scan' },
      el('h2', { text: 'Scanner un code-barres' }),
      el('p', { text: 'Placez le code dans le cadre ou saisissez-le manuellement.' }),
      el('video', { id: 'scan-video', autoplay: true, playsinline: true, 'aria-label': 'Aperçu caméra' }),
      el('label', { class: 'etiquette', for: 'scan-code-manuel', text: 'Code-barres' }),
      champCode,
      el('p', { id: 'scan-message', class: 'erreur', role: 'status', hidden: true }),
      el('div', { class: 'feuille-actions' },
        el('button', { type: 'button', class: 'btn btn-primaire', text: 'Rechercher', onclick: async () => traiterCode(champCode.value) }),
        boutonCompleter,
        el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Fermer', onclick: () => dialogue.close() })
      )
    );
    let stream = null;
    let actif = true;
    let fermee = false;
    const fermer = () => {
      if (fermee) return;
      fermee = true;
      actif = false;
      requeteOpenFoodFacts?.abort();
      requeteOpenFoodFacts = null;
      if (delaiOpenFoodFacts) clearTimeout(delaiOpenFoodFacts);
      delaiOpenFoodFacts = null;
      stream?.getTracks?.().forEach(piste => { try { piste.stop(); } catch {} });
      window.removeEventListener('online', actualiserBoutonCompleter);
      window.removeEventListener('offline', actualiserBoutonCompleter);
      window.visualViewport?.removeEventListener('resize', garderChampScannerVisible);
      window.visualViewport?.removeEventListener('scroll', garderChampScannerVisible);
      window.removeEventListener('pagehide', fermerSurSortie);
      window.removeEventListener('hashchange', fermerSurSortie);
      window.removeEventListener('popstate', fermerSurSortie);
      document.removeEventListener('visibilitychange', fermerSiMasque);
      dialogue.remove();
    };
    function fermerSurSortie() {
      if (dialogue.open) dialogue.close();
      fermer();
    }
    function fermerSiMasque() {
      if (document.hidden) fermerSurSortie();
    }
    dialogue.addEventListener('close', fermer, { once: true });
    window.addEventListener('pagehide', fermerSurSortie);
    document.addEventListener('visibilitychange', fermerSiMasque);
    window.addEventListener('hashchange', fermerSurSortie);
    window.addEventListener('popstate', fermerSurSortie);
    async function traiterCode(valeur) {
      const code = String(valeur || '').trim();
      if (!code) { const m=dialogue.querySelector('#scan-message'); m.textContent='Saisissez un code-barres.'; m.hidden=false; return; }
      try {
        const article = await lire('Article', code);
        dialogue.close();
        if (article) {
          const entree = types.find(x => String(x.type.id) === String(article.type));
          if (!entree) { await ouvrirRattachement(code, article); return; }
          typeChoisi = entree.type; prix.value = ''; recherche.value = entree.type.nom;
          suggestions.replaceChildren(); chargerDernierEtFormat();
          if (Number.isFinite(Number(article.format)) && Number(article.format) > 0) {
            const affichage = formatAffichage(Number(article.format), typeChoisi.unite);
            valeurFormat.value = String(affichage.valeur).replace(',', '.');
            uniteFormat.value = affichage.unite || uniteFormat.value;
          }
          verifier(); recherche.focus(); garderChampVisible(recherche);
        } else {
          await ouvrirRattachement(code, null);
        }
      } catch {
        const m=dialogue.querySelector('#scan-message'); m.textContent='Lecture impossible. Réessayez ou saisissez le code.'; m.hidden=false;
      }
    }
    champCode.addEventListener('input', actualiserBoutonCompleter);
    window.addEventListener('online', actualiserBoutonCompleter);
    window.addEventListener('offline', actualiserBoutonCompleter);
    window.visualViewport?.addEventListener('resize', garderChampScannerVisible);
    window.visualViewport?.addEventListener('scroll', garderChampScannerVisible);
    actualiserBoutonCompleter();
    if (!dialogue.isConnected) document.body.append(dialogue);
    dialogue.showModal();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra indisponible');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!actif || fermee || !dialogue.isConnected) {
        stream?.getTracks?.().forEach(piste => { try { piste.stop(); } catch {} });
        return;
      }
      const video = dialogue.querySelector('#scan-video'); video.srcObject = stream;
      await video.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128'] });
        while (actif && dialogue.open) {
          const codes = await detector.detect(video);
          if (!actif || !dialogue.open) break;
          if (codes?.[0]?.rawValue) {
            await traiterCode(codes[0].rawValue);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      } else {
        const m=dialogue.querySelector('#scan-message'); m.textContent='Détection automatique indisponible sur ce navigateur. Saisissez le code manuellement.'; m.hidden=false;
      }
    } catch {
      if (actif) {
        const m=dialogue.querySelector('#scan-message'); m.textContent='Caméra indisponible ou accès refusé. Vous pouvez saisir le code manuellement.'; m.hidden=false;
      }
    }
  }
  async function ouvrirRattachement(code, articleExistant) {
    const tousLesTypes = await listerTypes();
    const dialogue = el('dialog', { class: 'feuille dialog-rattachement dialog-rattacher' },
      el('h2', { text: 'Rattacher ce code' }),
      el('p', { text: 'Associez ce code-barres à un type existant ou créez un type.' }),
      el('label', { class: 'etiquette', for: 'scan-type-search', text: 'Type de produit' }),
      el('input', { id: 'scan-type-search', class: 'champ', type: 'search', placeholder: 'Rechercher ou créer un type', autocomplete: 'off' }),
      el('div', { id: 'scan-suggestions', class: 'suggestions' }),
      el('p', { id: 'scan-nouveau-type', role: 'status', hidden: true }),
      el('label', { class: 'etiquette', for: 'scan-format', text: 'Format' }),
      el('input', { id: 'scan-format', class: 'champ', type: 'number', min: '0', step: 'any', value: articleExistant?.format ? String(articleExistant.format) : '' }),
      el('label', { class: 'etiquette', for: 'scan-unite', text: 'Unité' }),
      el('select', { id: 'scan-unite', class: 'champ' },
        el('option', { value: 'g', text: 'g' }), el('option', { value: 'kg', text: 'kg' }),
        el('option', { value: 'ml', text: 'ml' }), el('option', { value: 'l', text: 'l' }),
        el('option', { value: 'unit', text: 'unités' })
      ),
      el('label', { class: 'etiquette', for: 'scan-marque', text: 'Marque (facultatif)' }),
      el('input', { id: 'scan-marque', class: 'champ', value: articleExistant?.marque || '' }),
      el('label', { class: 'etiquette', for: 'scan-nom', text: 'Nom de l’article (facultatif)' }),
      el('input', { id: 'scan-nom', class: 'champ', value: articleExistant?.nom || '' }),
      el('p', { id: 'scan-rattacher-message', class: 'erreur', role: 'alert', hidden: true }),
      el('div', { class: 'feuille-actions' },
        el('button', { type: 'button', class: 'btn btn-primaire', text: 'Rattacher ce code', onclick: async () => {
          const champ = dialogue.querySelector('#scan-type-search'), nom = champ.value.trim();
          const uniteSaisie = dialogue.querySelector('#scan-unite').value;
          const format = Number(dialogue.querySelector('#scan-format').value);
          const formatBase = format * (uniteSaisie === 'kg' || uniteSaisie === 'l' ? 1000 : 1);
          const uniteCompare = deduireUniteComparaison(uniteSaisie);
          const marque = dialogue.querySelector('#scan-marque').value.trim(), nomArticle = dialogue.querySelector('#scan-nom').value.trim();
          const message = dialogue.querySelector('#scan-rattacher-message');
          const existant = tousLesTypes.find(t => t.nomNormalise === normaliserNom(nom));
          if (!nom) { message.textContent='Saisissez un type de produit.'; message.hidden=false; return; }
          if (!uniteCompare || !Number.isFinite(formatBase) || formatBase <= 0 || !Number.isSafeInteger(Math.round(formatBase))) {
            message.textContent='Saisissez un format valide.'; message.hidden=false; return;
          }
          if (existant && existant.unite !== uniteCompare) {
            message.textContent='Ce type se compare en ' + existant.unite + '.'; message.hidden=false; return;
          }
          try {
            const resultat = await creerTypeEtArticle({ nom, unite: uniteCompare, codeBarres: code, format: Math.round(formatBase), marque, nomArticle });
            const type = tousLesTypes.find(t => t.id === resultat.type) || { id: resultat.type, nom, nomNormalise: normaliserNom(nom), unite: uniteCompare, archive: 0 };
            type.archive = 0;
            if (!types.some(x => x.type.id === type.id)) types.push({ type, dernier: null });
            dialogue.close(); typeChoisi = type; recherche.value = type.nom; suggestions.replaceChildren();
            chargerDernierEtFormat();
            const affichage = formatAffichage(formatBase, type.unite);
            valeurFormat.value = String(affichage.valeur).replace(',', '.');
            uniteFormat.value = affichage.unite || uniteFormat.value;
            verifier(); recherche.focus(); garderChampVisible(recherche);
            if (resultat.typeCree || resultat.typeRestaure) afficherAnnulation(resultat.jeton, magasinCourant, {
              message: 'Type « ' + type.nom + ' » ' + (resultat.typeCree ? 'créé' : 'restauré') + ' · Annuler',
              annuler: async jeton => {
                await annulerCreationTypeEtArticle(jeton);
                const indexTypeAnnule = types.findIndex(x => x.type.id === jeton.typeId);
                if (indexTypeAnnule >= 0) types.splice(indexTypeAnnule, 1);
                typeChoisi = null; recherche.value = ''; valeurFormat.value = ''; prix.value = '';
                formulaireModifie = false; verifier();
              }
            });
            prix.focus();
          } catch (e) { message.textContent = e?.message || 'Impossible d’enregistrer ce rattachement.'; message.hidden = false; }
        }}),
        el('button', { type: 'button', class: 'btn btn-secondaire', text: 'Annuler', onclick: () => dialogue.close() })
      )
    );
    dialogue.querySelector('#scan-marque').value = String(articleExistant?.marque || '');
    dialogue.querySelector('#scan-nom').value = String(articleExistant?.nom || '');
    dialogue.addEventListener('close', () => dialogue.remove(), { once: true });
    const champ = dialogue.querySelector('#scan-type-search'), zone = dialogue.querySelector('#scan-suggestions');
    const ligneNouveau = dialogue.querySelector('#scan-nouveau-type'), message = dialogue.querySelector('#scan-rattacher-message');
    const actualiserAide = () => {
      const nom = champ.value.trim(), existant = tousLesTypes.find(t => t.nomNormalise === normaliserNom(nom));
      const unite = deduireUniteComparaison(dialogue.querySelector('#scan-unite').value);
      ligneNouveau.hidden = !nom || Boolean(existant) || !unite;
      ligneNouveau.textContent = nom && unite ? 'Nouveau type « ' + nom + ' », se compare en ' + unite : '';
      if (existant && unite && existant.unite !== unite) { message.textContent = 'Ce type se compare en ' + existant.unite + '.'; message.hidden = false; }
      else message.hidden = true;
    };
    const afficherSuggestions = () => {
      const q = normaliserNom(champ.value), candidats = tousLesTypes.filter(t => t.nomNormalise.includes(q)).slice(0, 8);
      zone.replaceChildren(...candidats.map(t => el('button', {
        type: 'button', class: 'suggestion-rattacher', text: t.nom + (t.archive ? ' (archivé)' : ''),
        onclick: () => {
          champ.value = t.nom; zone.replaceChildren();
          const compatibles = unitesCompatibles(t.unite);
          dialogue.querySelector('#scan-unite').replaceChildren(...compatibles.map(u => el('option', { value: u, text: LIBELLE_UNITE[u] })));
          actualiserAide();
        }
      })));
      actualiserAide();
    };
    champ.addEventListener('input', afficherSuggestions);
    dialogue.querySelector('#scan-unite').addEventListener('change', actualiserAide);
    dialogue.querySelector('#scan-format').addEventListener('input', actualiserAide);
    if (!dialogue.isConnected) document.body.append(dialogue);
    dialogue.showModal();
  }

  function chargerDernierEtFormat() {
    if (!typeChoisi || formulaireModifie) return;
    dernier = types.find((x) => x.type.id === typeChoisi.id)?.dernier || null;
    const compatibles = unitesCompatibles(typeChoisi.unite);
    uniteFormat.replaceChildren(...compatibles.map((u) => el('option', { value: u, text: LIBELLE_UNITE[u] })));
    const affichage = dernier ? formatAffichage(Number(dernier.format), typeChoisi.unite) : { valeur: '', unite: compatibles[0] || '' };
    valeurFormat.value = affichage.valeur === '' ? '' : affichage.valeur.replace(',', '.');
    uniteFormat.value = compatibles.includes(affichage.unite) ? affichage.unite : (compatibles[0] || '');
    if (uniteFormat.options.length && !uniteFormat.value) uniteFormat.selectedIndex = 0;
    if (dernier && !prix.value.trim()) {
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
    if (!typeChoisi || !estFormulaireValide()) { verdictCarte.hidden = true; bouton.textContent='Enregistrer'; dockActions?.replaceChildren(bouton); return; }
    const p = prixValide();
    const f = verifierFormat(typeChoisi.unite, Number(valeurFormat.value), uniteFormat.value);
    if (!p || !f.ok) { verdictCarte.hidden = true; bouton.textContent='Enregistrer'; dockActions?.replaceChildren(bouton); return; }
    try {
      const observations = await lireObservations(typeChoisi.id);
      const seuilPct = await lireReglage('seuilIndifference', 5);
      if (jetonCalcul !== calculVerdictToken || !typeChoisi || !estFormulaireValide()) { verdictCarte.hidden = true; return; }
      const v = calculerVerdictMagasins({ prixCentimes:p, formatBase:f.formatBase, typeUnit:typeChoisi.unite, magasinCourant, magasins:magasinsTous, observations, aujourdhui:date, seuilPct, promo:promo.checked });
      dessinerVerdict(v, observations);
    } catch { verdictCarte.hidden = true; bouton.textContent='Enregistrer'; dockActions?.replaceChildren(bouton); }
  }

  function dessinerVerdict(v, observations) {
    verdictCarte.hidden = false;
    const classe = v.resultat === VERDICT.ACHETER_ICI ? 'acheter' : v.resultat === VERDICT.ATTENDRE ? 'attendre' : v.resultat === VERDICT.INDIFFERENT ? 'indifferent' : 'insuffisant';
    verdictCarte.className = 'carte verdict-carte verdict-' + classe;
    verdictCarte.replaceChildren();
    const autre = v.magasinComparaison ? libelleMagasin(v.magasinComparaison) : (v.autreMagasin ? libelleMagasin(v.autreMagasin) : 'Aucun magasin comparable');
    let libelle='Données insuffisantes', icone='?';
    if(v.resultat===VERDICT.ACHETER_ICI){libelle='Acheter ici';icone='✓';}
    else if(v.resultat===VERDICT.ATTENDRE){libelle='Attendre '+autre;icone='…';}
    else if(v.resultat===VERDICT.INDIFFERENT){libelle='Indifférent';icone='=';}
    verdictCarte.append(el('div',{class:'verdict-ligne1'},el('span',{class:'verdict-icone',text:icone}),el('strong',{text:libelle})));
    if(v.resultat!==VERDICT.INSUFFISANT){
      const signe=v.differenceFormatCentimes<0?'−':v.differenceFormatCentimes>0?'+':'';
      const uniteTexte=typeChoisi.unite==='unit'?'par unité':'le '+LIBELLE_UNITE[typeChoisi.unite];
      verdictCarte.append(el('p',{class:'verdict-economie',text:signe+formaterPrixEuros(Math.abs(v.differenceUniteCentimes))+' '+uniteTexte+' · '+signe+formaterPrixEuros(Math.abs(v.differenceFormatCentimes))+' pour ce paquet'}));
      const h=v.habituelComparaison || v.habituelAutre;
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
    const habituel = prixHabituelMagasin(observations,magasinsTous.find(m=>m.id===magasinCourant),typeChoisi.unite,date);
    if(habituel.ok) verdictCarte.append(el('p',{class:'verdict-habituel',text:'Habituel chez '+libelleMagasin(magasinCourant)+' : '+formaterPrixNormalise(habituel.valeur,typeChoisi.unite)}));
    const quantite = el('input', { id:'quantite-achat', class:'champ quantite-achat', type:'number', min:'1', max:'999', step:'1', value:String(quantiteAchat), inputmode:'numeric', 'aria-label':'Quantité achetée', onchange:e=>{ const n=Number(e.target.value); if(Number.isInteger(n)&&n>=1&&n<=999) quantiteAchat=n; else {quantiteAchat=1;e.target.value='1';} } });
    bouton.textContent = 'Je n’achète pas';
    const actionsAchat = el('div', { id:'achat-actions', class:'achat-actions' },
      el('div', { class:'quantite-achat-controles' },
        el('button', { id:'btn-achat-moins', type:'button', class:'btn btn-secondaire btn-quantite', text:'−', 'aria-label':'Diminuer la quantité', onclick:()=>{quantiteAchat=Math.max(1,quantiteAchat-1);quantite.value=String(quantiteAchat);} }),
        quantite,
        el('button', { id:'btn-achat-plus', type:'button', class:'btn btn-secondaire btn-quantite', text:'+', 'aria-label':'Augmenter la quantité', onclick:()=>{quantiteAchat=Math.min(999,quantiteAchat+1);quantite.value=String(quantiteAchat);} })
      ),
      el('button', { id:'btn-achat-confirme', type:'button', class:'btn btn-primaire', text:'J’achète', disabled:enregistrementEnCours, onclick:()=>enregistrerReleve(1) }),
      bouton
    );
    dockActions?.replaceChildren(actionsAchat);
  }

  async function ouvrirPrixPaye(formatBaseCourant) {
    if (!typeChoisi) return;
    const d = el('dialog', { class:'feuille dialog-prix-achat' });
    const prixPaye = el('input', { id:'prix-paye-achat', class:'champ', type:'text', inputmode:'decimal', value:prix.value, 'aria-label':'Prix payé', enterkeyhint:'next' });
    const formatPaye = el('input', { id:'format-paye-achat', class:'champ', type:'number', min:'0', step:'any', value:String(Number(valeurFormat.value)||formatBaseCourant), 'aria-label':'Format acheté', enterkeyhint:'done' });
    const unitePaye = el('select', { id:'unite-achat', class:'champ', 'aria-label':'Unité du format acheté' });
    const uniteDefaut = typeChoisi.unite === 'kg' ? 'g' : typeChoisi.unite === 'l' ? 'ml' : 'unit';
    for (const [value,label] of [['g','g'],['kg','kg'],['ml','ml'],['l','l'],['unit','unité(s)']]) {
      if ((typeChoisi.unite==='kg'&&['g','kg'].includes(value))||(typeChoisi.unite==='l'&&['ml','l'].includes(value))||(typeChoisi.unite==='unit'&&value==='unit')) unitePaye.append(el('option',{value,text:label}));
    }
    unitePaye.value = uniteDefaut;
    const messagePrix = el('p',{class:'erreur',role:'alert',hidden:true});
    const fermer = () => { if(d.open)d.close(); d.remove(); };
    const confirmer = el('button',{type:'button',class:'btn btn-primaire',text:'Confirmer',onclick:()=>{
      const p=analyserPrixSaisie(prixPaye.value);
      const f=verifierFormat(typeChoisi.unite,Number(formatPaye.value),unitePaye.value);
      if(!p||!f.ok){messagePrix.textContent=!p?'Saisissez un prix payé supérieur à 0.':(f.erreur==='format-incompatible'?'Format incompatible avec le type.':'Saisissez un format acheté valide.');messagePrix.hidden=false;return;}
      prixPayeAchat=p; formatPayeAchat=f.formatBase; fermer();
    }});
    d.append(el('h2',{text:'Prix et format réellement achetés'}),el('label',{for:'prix-paye-achat',class:'etiquette',text:'Prix payé (€)'}),prixPaye,el('label',{for:'format-paye-achat',class:'etiquette',text:'Format acheté'}),formatPaye,unitePaye,messagePrix,el('div',{class:'feuille-actions'},confirmer));
    d.addEventListener('close',()=>d.remove(),{once:true});
    document.body.append(d); d.showModal();
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
    el('div', { class: 'type-entete' }, el('label', { class: 'etiquette', for: 'champ-type', text: 'Type' }), boutonScanner), recherche, suggestions, rappelType,
    el('label', { class: 'etiquette', for: 'champ-prix', text: 'Prix' }), prixZone,
    el('label', { class: 'etiquette', for: 'champ-format', text: 'Format' }), formatBloc, formatErreur, prixNormaliseAffiche,
    el('div', { class: 'date-promo-ligne' },
      el('div', { class: 'date-ligne' }, dateLien, dateTexte, dateInput),
      el('label', { class: 'promo-ligne' }, promo, el('span', { text: 'Promo' }))
    ),
    prixHorsPromoBloc, horsPromoAvertissement, message
  );
  const actionsDock = el('div', { class: 'dock-actions', id: 'dock-actions' }, bouton);
  dockActions = actionsDock;
  const dock = el('div', { id: 'dock-magasin', class: 'dock-magasin' },
    el('div', { class: 'dock-verdict-zone', id: 'dock-verdict-zone' }, verdictCarte),
    actionsDock
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
      actualiserEnteteMagasin();
      suggestions.replaceChildren();
      if (typeChoisi && !formulaireModifie) chargerDernierEtFormat();
      verifier();
    }
  }
  chargerFormulaire().catch(() => { formulaire.replaceChildren(carte('Magasin', 'Base de données indisponible.')); });
  return racine;
}


// ---- Historique des relevés (FR8 / FR9) -----------------------------------------------------
function vueHistorique(typeId, integre = false, observationInitiale = null) {
  const racine=el('div',{class:'historique'});
  const liste=el('div',{class:'liste-historique'});
  if (integre) racine.append(liste); else racine.append(el('a',{href:'#/types',class:'btn btn-secondaire btn-bloc'},'← Retour aux types'),liste);
  async function charger(){
    const type=await dbPrete.then(()=>lireTypeSafe(typeId));
    if(!type) { liste.replaceChildren(carte('Prix constatés','Type introuvable.')); return; }
    async function dessiner(){
    const rows=await listerReleves(typeId); const achats=await toutLire('Purchase'); const compteParReleve=new Map(); for(const a of achats)if(Number(a.type)===Number(typeId)&&(a.achete===1||a.achete===true)&&a.observation!=null)compteParReleve.set(Number(a.observation),(compteParReleve.get(Number(a.observation))||0)+1); liste.replaceChildren();
    if(!rows.length){
      liste.append(carte('Aucun relevé','Aucun relevé pour ce type.'),
        el('a',{href:'#/magasin',class:'btn btn-primaire btn-bloc'},'Saisir un relevé'));
      return;
    }
    for(const o of rows) liste.append(ligneHistorique(o,compteParReleve.get(Number(o.id))||0));
    if(observationInitiale){const ligne=liste.querySelector('[data-id="'+observationInitiale+'"]');if(ligne)ligne.classList.add('ligne-releve-highlight');}
  }
  function ligneHistorique(o, nombreAchats=0){
    const row=el('div',{class:'ligne ligne-releve'+(Number(observationInitiale)===Number(o.id)?' ligne-releve-highlight':''),'data-id':o.id},
      el('div',{class:'ligne-releve-contenu'},
        el('div',{class:'ligne-releve-haut'},
          el('span',{class:'puce '+classeMagasin(o.magasin),text:libelleMagasin(o.magasin),style:'border-color:'+couleurMagasin(o.magasin)+';color:'+couleurMagasin(o.magasin)}),
          el('span',{class:'releve-date',text:dateAffichee(o.date)})),
        el('div',{class:'ligne-releve-bas'},
          el('strong',{text:formaterPrixNormalise(prixNormalise(o.prixCentimes,o.format,type.unite).centimesParUnite,type.unite)}),
          o.promo?el('span',{class:'badge-promo',text:'Promo'}):null,
          nombreAchats?el('a',{class:'achat-associe',href:'#/fiche/'+typeId+'/achats',text:'Acheté × '+nombreAchats}):null)),
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
    const magasin=el('select',{class:'champ'}); magasin.append(...magasinsTous.map(m=>el('option',{value:m.id,text:m.nom+(m.archive?' (archivé)':'')})));magasin.value=o.magasin;
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
  charger().catch((e) => { console.error('Chargement impossible', e); liste.replaceChildren(carte('Prix constatés', 'Chargement impossible')); });
  return racine;
}

// ---- Relevé mensuel enchaîné (FR7 / E5.1 / E5.2) --------------------------------------------
async function vueListeCourses() {
  await dbPrete; await actualiserMagasins();
  const racine=el('div',{class:'liste-avant-courses'});
  const titreListe=el('h2',{text:'Avant les courses'});
  const aide=el('p',{class:'aide',text:'Comparaison des prix habituels, sans dépendance au réseau.'});
  const recherche=el('input',{type:'search',class:'champ',placeholder:'Rechercher un type','aria-label':'Rechercher un type',autocomplete:'off'});
  const contenu=el('div',{class:'groupes-liste-courses'});
  racine.append(titreListe,aide,recherche,contenu);
  async function dessiner(){
    const q=recherche.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const tousTypes=(await listerTypes()).filter(t=>!t.archive);
    const types=tousTypes.filter(t=>t.nomNormalise.includes(q)).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
    const tousReleves=[]; for(const type of tousTypes)tousReleves.push(...await lireObservations(type.id));
    const seuilPct=Number(await lireReglage('seuilIndifference',5)),dateDuJour=aujourdHui();
    const comparaisons=listeAvantCoursesMagasins(tousTypes,tousReleves,magasinsTous,seuilPct,dateDuJour);
    const analyses=types.map(type=>{
      const c=comparaisons.find(r=>r.typeId===type.id);
      let details='Aucun prix connu.';
      if(c?.resultat==='donnees-insuffisantes'){
        if(c.dateDernierPrix) details='Dernier prix connu : '+dateAffichee(c.dateDernierPrix)+(c.prixNormaliseCentimes!=null?' · '+formaterPrixNormalise(c.prixNormaliseCentimes,type.unite):'');
      } else {
        details='Prix normalisé le moins cher : '+formaterPrixNormalise(c.prixNormaliseCentimes,type.unite);
        if(c.economiePourcent!=null)details+=' · écart '+String(c.economiePourcent).replace('.',',')+' %';
      }
      return {type,resultat:c?.resultat||'donnees-insuffisantes',details};
    });
    contenu.replaceChildren();
    const groupes=[
      ...magasinsDisponibles.filter(m=>m.comparable).map(m=>({id:m.id,titre:m.nom,couleur:m.couleur})),
      {id:'indifferent',titre:'Indifférent'},
      {id:'donnees-insuffisantes',titre:'Données insuffisantes'}
    ];
    for(const groupe of groupes){
      const lignes=analyses.filter(a=>a.resultat===groupe.id);
      if(groupe.id!== 'indifferent' && groupe.id!=='donnees-insuffisantes' && !lignes.length)continue;
      const liste=el('div',{class:'lignes-groupe'});
      if(lignes.length)liste.append(...lignes.map(a=>el('a',{class:'ligne-liste-course',href:'#/fiche/'+a.type.id},
        el('strong',{text:a.type.nom}),el('span',{class:'puce',text:LIBELLE_UNITE[a.type.unite]}),el('span',{class:'detail-prix-liste',text:a.details}))));
      else liste.append(el('p',{class:'aide',text:'Aucun type dans ce groupe.'}));
      contenu.append(el('details',{class:'carte groupe-liste-courses',open:true},el('summary',{text:groupe.titre+' ('+lignes.length+')'}),liste));
    }
    if(!types.length)contenu.prepend(el('section',{class:'carte',text:q?'Aucun type ne correspond à cette recherche.':'Aucun type actif. Créez un type ou restaurez-en un depuis la liste Types.'}));
  }
  recherche.addEventListener('input',()=>{void dessiner().catch(()=>contenu.replaceChildren(carte('Liste indisponible','Impossible de calculer la liste.')));});
  await dessiner(); return racine;
}
async function vueReleveMensuel() {
  await dbPrete; await actualiserMagasins();
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
  let magasinMensuel = await lireReglage('magasinReleveMensuel', magasinsDisponibles[0]?.id || '');
  if (!magasinsDisponibles.some(m=>m.id===magasinMensuel)) magasinMensuel=magasinsDisponibles[0]?.id || '';
  let feuilleChoixMagasin = null;
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
      const v = calculerVerdictMagasins({ prixCentimes:prix, formatBase:f.formatBase, typeUnit:typeActuel.unite, magasinCourant:magasinMensuel, magasins:magasinsTous, observations, aujourdhui:date, seuilPct, promo:promo.checked });
      const label = v.resultat === VERDICT.ACHETER_ICI ? 'Acheter ici' : v.resultat === VERDICT.ATTENDRE ? 'Attendre '+libelleMagasin(v.magasinComparaison) : v.resultat === VERDICT.INDIFFERENT ? 'Indifférent' : 'Données insuffisantes';
      const ecart = Number.isFinite(v.ecart) ? ' · ' + (v.ecart>0?'+':'') + Math.round(v.ecart*100) + ' %' : '';
      zoneMiniVerdict.textContent = label + ecart; zoneMiniVerdict.hidden = false; boutonSuivant.disabled = false;
    } catch { zoneMiniVerdict.textContent = 'Données insuffisantes'; zoneMiniVerdict.hidden = false; boutonSuivant.disabled = false; }
  }
  async function chargerCarte() {
    message.hidden = true; erreur.hidden = true; zoneMiniVerdict.hidden = true;
    if (!types.length) {
      progression.textContent = '0 / 0';
      contenu.replaceChildren(el('h2',{text:'Aucun type actif'}),el('p',{text:'Créez un type ou restaurez-en un depuis la liste Types avant de lancer le relevé mensuel.'}));
      actions.hidden = true; return;
    }
    if (index >= types.length) {
      progression.textContent = 'Relevé terminé';
      contenu.replaceChildren(el('h2',{text:'Relevé mensuel terminé'}),el('p',{text:saisis+' saisi'+(saisis>1?'s':'')+', '+passes+' passé'+(passes>1?'s':'')+'.'}));
      actions.hidden = true; return;
    }
    typeActuel = types[index]; dernier = await lireDernierReleve(typeActuel.id, magasinMensuel);
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
    requestAnimationFrame(()=>{ if(racine.isConnected) champPrix.focus(); });
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
    const observation={type:typeActuel.id,magasin:magasinMensuel,date,prixCentimes,format:f.formatBase,promo:promo.checked};
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
  window.__releveMensuelCleanup=()=>{window.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport);delete window.__actualiserModeMensuel;document.body.classList.remove('mode-saisie');if(feuilleChoixMagasin?.open)feuilleChoixMagasin.close();};
  champPrix.addEventListener('focus',modeMensuel); champFormat.addEventListener('focus',modeMensuel);
  champPrix.addEventListener('input',()=>void actualiserMiniVerdict()); champFormat.addEventListener('input',()=>void actualiserMiniVerdict()); champUnite.addEventListener('change',()=>void actualiserMiniVerdict());promo.addEventListener('change',()=>void actualiserMiniVerdict());
  champFormat.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();champFormat.blur();}});
  await chargerCarte();
  if(types.length) requestAnimationFrame(()=>champPrix.focus());
  feuilleChoixMagasin=el('dialog',{class:'feuille feuille-mensuel-magasin'},
    el('h2',{text:'Quel magasin relevez-vous ?'}),
    el('p',{text:'Ce choix est mémorisé pour le prochain relevé mensuel.'}),
    el('div',{class:'liste-magasins-choix'},...magasinsDisponibles.map(m=>el('button',{type:'button',class:'magasin-btn','aria-pressed':m.id===magasinMensuel,style:'--couleur-magasin:'+m.couleur,text:m.nom+(m.localisation?' · '+m.localisation:''),onclick:async()=>{magasinMensuel=m.id;await ecrireReglage('magasinReleveMensuel',m.id);feuilleChoixMagasin.close();await chargerCarte();}}))),
    el('button',{type:'button',class:'btn btn-secondaire btn-bloc',text:'Gérer les magasins',onclick:()=>{feuilleChoixMagasin.close();location.hash='#/reglages/magasins';}})
  );
  feuilleChoixMagasin.addEventListener('close',()=>feuilleChoixMagasin.remove());document.body.append(feuilleChoixMagasin);feuilleChoixMagasin.showModal();
  return racine;
}

async function vueFicheType(typeId, ongletInitial = null, observationInitiale = null) {
  await dbPrete; await actualiserMagasins();
  const type = await lireTypeSafe(typeId);
  if (!type) return carte('Fiche du type', 'Type introuvable.');
  const racine = el('div', { class: 'fiche-type' });
  racine.append(el('a', { href: '#/types', class: 'btn btn-secondaire btn-bloc', text: '← Retour aux types' }));
  const observations = await lireObservations(typeId), dateDuJour = aujourdHui();
  const dernierPromo = magasin => observations.filter(o => o.magasin === magasin && Boolean(o.promo)).sort((a,b) => a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.id||0)-(a.id||0))[0] || null;
  const promoTexte = (magasin, m) => { const o=dernierPromo(magasin); if(!o)return 'Aucun relevé promo.'; const p=prixNormalise(o.prixCentimes,o.format,type.unite); return 'Dernier prix promo : '+(p.ok?formaterPrixNormalise(p.centimesParUnite,type.unite):'indisponible')+' · '+dateAffichee(o.date); };
  const freqTexte = f => f.ok ? f.nbPromos+' relevé'+(f.nbPromos>1?'s':'')+' sur '+f.nbReleves+' en promo ('+String(f.pourcentage).replace('.',',')+' %)' : 'Fréquence indisponible (aucun relevé).';
  async function carteMagasin(m) {
    const habituel=prixHabituelMagasin(observations,m,type.unite,dateDuJour), freq=frequencePromos(observations,m.id);
    const cartePrix=el('section',{class:'carte carte-prix',style:'border-color:'+m.couleur},
      el('h3',{text:m.nom+(m.archive?' (archivé)':'')}),
      el('p',{text:habituel.ok?(habituel.type==='mediane'?'Prix habituel : '+formaterPrixNormalise(habituel.valeur,type.unite)+' · médiane de '+habituel.nbReleves+' relevés hors promo sur 8 semaines':'Prix habituel : '+formaterPrixNormalise(habituel.valeur,type.unite)+' · relevé du '+dateAffichee(habituel.date)):'Prix habituel : données insuffisantes'+(m.modePrixHabituel==='mediane'?' ('+habituel.nbReleves+' relevés hors promo sur 8 semaines).':'.')}),
      el('p',{text:promoTexte(m.id,m)}),el('p',{text:'Fréquence : '+freqTexte(freq)}));
    return {magasin:m,habituel,carte:cartePrix};
  }
  const actives=magasinsDisponibles, cartes=await Promise.all(actives.map(carteMagasin));
  const archives=magasinsTous.filter(m=>m.archive&&observations.some(o=>o.magasin===m.id));
  const cartesArchive=await Promise.all(archives.map(carteMagasin));
  const valeurs=cartes.filter(x=>x.magasin.comparable&&x.habituel.ok).map(x=>x.habituel.valeur), max=valeurs.length?Math.max(...valeurs):0;
  const barres=el('section',{class:'carte'},el('h3',{text:'Comparaison des prix habituels'}));
  const zoneBarres=el('div',{class:'barres-comparaison'});
  for(const x of cartes.filter(x=>x.magasin.comparable)){
    const valeur=x.habituel.ok?x.habituel.valeur:null, largeur=valeur!=null&&max>0?Math.max(0,Math.min(100,valeur/max*100)):0;
    zoneBarres.append(el('div',{class:'barre-comparaison'},el('span',{text:x.magasin.nom}),el('div',{class:'barre-fond',role:'img','aria-label':x.magasin.nom+' : '+(valeur==null?'données insuffisantes':formaterPrixNormalise(valeur,type.unite))},el('div',{class:'barre-remplissage',style:'width:'+largeur+'%;background:'+x.magasin.couleur})),el('strong',{text:valeur==null?'—':formaterPrixNormalise(valeur,type.unite)})));
  }
  if(!zoneBarres.childElementCount)zoneBarres.append(el('p',{class:'aide',text:'Aucun magasin comparable avec un prix habituel disponible.'}));
  barres.append(zoneBarres);
  const sectionCodes = el('section',{class:'carte codes-barres'},el('h3',{text:'Codes-barres rattachés'}));
  const listeCodes = el('div',{class:'liste-codes-barres'});
  const actualiserCodes = async () => {
    const codes = (await toutLire('Article')).filter(a => Number(a.type) === Number(typeId)).sort((a,b)=>String(a.codeBarres).localeCompare(String(b.codeBarres)));
    listeCodes.replaceChildren();
    if (!codes.length) { listeCodes.append(el('p',{class:'aide',text:'Aucun code-barres rattaché.'})); return; }
    for (const article of codes) {
      const details = [article.nom,article.marque].filter(Boolean).join(' · ');
      const format = Number(article.format)>0 ? formatAffichage(Number(article.format),type.unite) : null;
      const formatTexte = format ? ' · '+String(format.valeur).replace('.',',')+' '+(format.unite||LIBELLE_UNITE[type.unite]) : '';
      listeCodes.append(el('div',{class:'ligne-code-barres'},el('div',{class:'code-barres-infos'},el('strong',{text:String(article.codeBarres)}),el('span',{text:(details||'Article sans nom')+formatTexte})),el('button',{type:'button',class:'btn btn-secondaire btn-supprimer-code',text:'Supprimer',onclick:async()=>{try{await supprimer('Article',article.codeBarres);await actualiserCodes();}catch{afficherErreur('Impossible de supprimer ce code-barres.');}}})));
    }
  };
  sectionCodes.append(listeCodes); await actualiserCodes();
  const relevesType=await listerReleves(typeId);
  const achatsType=(await toutLire('Purchase')).filter(a=>Number(a.type)===Number(typeId)&&(a.achete===1||a.achete===true));
  const onglets=el('div',{class:'onglets-fiche',role:'tablist','aria-label':'Prix constatés et achats'});
  const boutonPrix=el('button',{type:'button',class:'onglet-fiche','role':'tab','aria-selected':'false',text:'Prix constatés ('+relevesType.length+')'});
  const boutonAchats=el('button',{type:'button',class:'onglet-fiche','role':'tab','aria-selected':'false',text:'Achats ('+achatsType.length+')'});
  const definition=el('p',{class:'definition-onglet',id:'definition-onglet'});
  const contenuOnglet=el('div',{class:'contenu-onglet-fiche'});
  let ongletActif=observationInitiale?'prix':(ongletInitial||ongletsFicheActifs.get(Number(typeId))||'prix');
  async function afficherOnglet(onglet){
    ongletActif=onglet;ongletsFicheActifs.set(Number(typeId),onglet);
    boutonPrix.setAttribute('aria-selected',String(onglet==='prix'));boutonAchats.setAttribute('aria-selected',String(onglet==='achats'));
    definition.textContent=onglet==='prix'?'Prix vus en rayon, achetés ou non':'Ce que j’ai acheté et payé';
    contenuOnglet.replaceChildren();
    if(onglet==='prix')contenuOnglet.append(vueHistorique(typeId,true,observationInitiale));
    else contenuOnglet.append(await vueHistoriqueAchats(typeId,true));
  }
  boutonPrix.addEventListener('click',()=>{void afficherOnglet('prix');});
  boutonAchats.addEventListener('click',()=>{void afficherOnglet('achats');});
  onglets.append(boutonPrix,boutonAchats);
  racine.append(el('h2',{text:type.nom}),...cartes.map(x=>x.carte),onglets,definition,contenuOnglet,barres);
  if(cartesArchive.length)racine.append(el('details',{class:'carte magasins-archives'},el('summary',{text:'Magasins archivés ('+cartesArchive.length+')'}),...cartesArchive.map(x=>x.carte)));
  racine.append(el('p',{class:'aide note-biais-promo',text:'Attention : si vos relevés sont surtout effectués en promotion, la fréquence affichée peut être biaisée.'}),sectionCodes);
  await afficherOnglet(ongletActif);
  return racine;
}

async function vueBilan() {
  await dbPrete;
  const [achats,types] = await Promise.all([toutLire('Purchase'),toutLire('ProductType')]);
  const parType = new Map();
  let totalCentimes = 0, gainsPromoCentimes = 0, achatsExclus = 0, achatsComptes = 0;
  for (const achat of achats) {
    if (achat.achete !== 1 && achat.achete !== true) continue;
    const type = types.find(t => t.id === achat.type);
    if (!type) continue;
    const calcul = calculerEconomieRealisee(achat,type.unite);
    if (!calcul.ok) { console.error('Achat ignoré : données invalides',achat.id); continue; }
    if (calcul.exclu) { achatsExclus++; continue; }
    if (!calcul.compte) continue;
    totalCentimes += calcul.economieCentimes;
    if (calcul.gainPromoCentimes !== null) gainsPromoCentimes += calcul.gainPromoCentimes;
    achatsComptes++;
    const entree = parType.get(type.id) || {type,cumul:0,nombre:0};
    entree.cumul += calcul.economieCentimes;
    entree.nombre++;
    parType.set(type.id,entree);
  }
  const progression = Math.max(0,Math.min(100,Math.round(totalCentimes/10000*100)));
  const racine = el('div',{class:'bilan-economies'});
  racine.append(el('section',{class:'carte carte-bilan-total'},
    el('h2',{text:'Économies réalisées'}),
    el('p',{class:'bilan-total',text:formaterPrixEuros(totalCentimes)}),
    el('div',{class:'anneau-progression',role:'img','aria-label':'Progression vers la cible de 100 € : '+progression+' %','style':'--progression:'+progression+'%'},
      el('div',{class:'anneau-interieur'},el('strong',{text:progression+' %'}),el('span',{text:'de la cible'}))),
    el('p',{class:'aide',text:'Objectif : 100 € sur 12 mois.'}),
    el('p',{class:'bilan-gains-promo',text:'Dont gains liés aux promos : '+formaterPrixEuros(gainsPromoCentimes)}),
    el('p',{class:'bilan-achats-exclus',text:achatsExclus+' achat'+(achatsExclus===1?'':'s')+' exclu'+(achatsExclus===1?'':'s')+' (données insuffisantes à l’époque).'})
  ));
  racine.append(el('a',{href:'#/tous-achats',class:'btn btn-secondaire btn-bloc',text:'Tous mes achats'}));
  if (!achatsComptes) {
    racine.append(el('p',{class:'aide',text:achatsExclus ? 'Aucun achat avec comparaison disponible pour le moment.' : 'Aucun achat enregistré. En magasin, utilisez « J’achète » pour commencer.'}),
      el('a',{href:'#/magasin',class:'btn btn-primaire btn-bloc',text:'Aller en magasin'}));
    return racine;
  }
  const liste = el('section',{class:'liste-bilan-types'},el('h2',{text:'Par type de produit'}));
  const entrees=[...parType.values()].sort((a,b)=>a.type.nom.localeCompare(b.type.nom,'fr'));
  for(const entree of entrees) {
    liste.append(el('a',{href:'#/fiche/'+entree.type.id+'/achats',class:'ligne-bilan-type'},
      el('strong',{text:entree.type.nom}),
      el('span',{text:'Cumul : '+formaterPrixEuros(entree.cumul)}),
      el('span',{text:entree.nombre+' achat'+(entree.nombre===1?'':'s')})
    ));
  }
  racine.append(liste);
  return racine;
}

async function vueHistoriqueAchats(typeId, integre = false) {
  await dbPrete;
  const type = typeId==null?null:await lireTypeSafe(typeId);
  if (typeId!=null&&!type) return carte('Achats', 'Type introuvable.');
  const racine = el('div', { class:'historique-achats' });
  if(!integre)racine.append(el('a',{href:typeId==null?'#/bilan':'#/fiche/'+typeId,class:'btn btn-secondaire btn-bloc',text:typeId==null?'← Retour au bilan':'← Retour à la fiche'},),...(type?[el('h2',{text:type.nom})]:[]));
  const achats = (await toutLire('Purchase')).filter(achat => (typeId==null||Number(achat.type)===Number(typeId))&&(achat.achete === 1 || achat.achete === true)).sort((a,b)=>a.date!==b.date?(a.date<b.date?1:-1):(b.id||0)-(a.id||0));
  if (!achats.length) {
    racine.append(el('p',{class:'aide',text:typeId==null?'Aucun achat enregistré. En magasin, utilisez « J’achète » pour commencer.':'Aucun achat enregistré pour ce type.'}));
    if(!integre)racine.append(el('a',{href:'#/magasin',class:'btn btn-primaire btn-bloc',text:'Aller en magasin'}));
    return racine;
  }
  const typesConnus=await listerTypes();
  for (const achat of achats) {
    const typeAchat=type||typesConnus.find(t=>Number(t.id)===Number(achat.type)); if(!typeAchat)continue;
    const uniteBase = typeAchat.unite === 'kg' ? 'g' : typeAchat.unite === 'l' ? 'ml' : 'unités';
    const ligne = el('article',{class:'ligne-achat', 'data-achat-id':String(achat.id)},
      el('div',{class:'ligne-achat-infos'},
        el('strong',{text:dateAffichee(achat.date)}),
        typeId==null?el('a',{href:'#/fiche/'+typeAchat.id+'/achats',class:'type-achat-lien',text:typeAchat.nom}):null,
        el('span',{text:libelleMagasin(achat.magasin),style:'color:'+couleurMagasin(achat.magasin)}),
        el('div',{class:'achat-resume-valeurs'},
          el('span',{class:'achat-valeur achat-quantite',text:'× '+achat.quantite}),
          el('span',{class:'achat-valeur achat-prix',text:'Prix payé : '+formaterPrixEuros(achat.prixPayeCentimes)}),
          el('span',{class:'achat-valeur achat-format',text:'Format unitaire : '+achat.format+' '+uniteBase})
        )
      ),
      el('div',{class:'ligne-achat-actions'},
        achat.observation!=null?el('a',{class:'btn btn-secondaire',href:'#/fiche/'+typeAchat.id+'/prix/'+achat.observation,text:'Voir le prix constaté'}):null,
        el('button',{type:'button',class:'btn btn-secondaire',text:'Corriger l’achat', 'aria-label':'Corriger le prix, la quantité ou le format de cet achat',onclick:()=>ouvrirEditionAchat(achat,type)}),
        el('button',{type:'button',class:'btn btn-secondaire',text:'Supprimer','aria-label':'Supprimer cet achat',onclick:()=>confirmerSuppressionAchat(achat,typeAchat.id)})
      )
    );
    racine.append(ligne);
  }
  return racine;
}

async function vueTousAchats(){
  await dbPrete;
  const racine=el('div',{class:'tous-achats'});
  const filtre=el('select',{class:'champ','aria-label':'Filtrer les achats par type'},el('option',{value:'',text:'Tous les types'}));
  const types=(await listerTypes()).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
  filtre.append(...types.map(t=>el('option',{value:String(t.id),text:t.nom+(t.archive?' (archivé)':'')})));
  const liste=el('div',{class:'liste-achats-chronologique'});
  racine.append(el('h2',{text:'Tous mes achats'}),filtre,liste);
  async function dessiner(){const choix=filtre.value;const achats=(await toutLire('Purchase')).filter(a=>(a.achete===1||a.achete===true)&&(!choix||Number(a.type)===Number(choix))).sort((a,b)=>a.date!==b.date?(a.date<b.date?1:-1):(b.id||0)-(a.id||0));liste.replaceChildren();if(!achats.length){liste.append(el('p',{class:'aide',text:choix?'Aucun achat pour ce type.':'Aucun achat enregistré. En magasin, utilisez « J’achète » pour commencer.'}));return;}for(const achat of achats){const type=types.find(t=>Number(t.id)===Number(achat.type));if(!type)continue;const uniteBase=type.unite==='kg'?'g':type.unite==='l'?'ml':'unités';liste.append(el('article',{class:'ligne-achat','data-achat-id':String(achat.id)},el('div',{class:'ligne-achat-infos'},el('strong',{text:dateAffichee(achat.date)}),el('a',{class:'type-achat-lien',href:'#/fiche/'+type.id+'/achats',text:type.nom}),el('span',{text:libelleMagasin(achat.magasin),style:'color:'+couleurMagasin(achat.magasin)}),el('div',{class:'achat-resume-valeurs'},el('span',{class:'achat-valeur achat-quantite',text:'× '+achat.quantite}),el('span',{class:'achat-valeur achat-prix',text:'Prix payé : '+formaterPrixEuros(achat.prixPayeCentimes)}),el('span',{class:'achat-valeur achat-format',text:'Format unitaire : '+achat.format+' '+uniteBase})),el('div',{class:'ligne-achat-actions'},achat.observation!=null?el('a',{class:'btn btn-secondaire',href:'#/fiche/'+type.id+'/prix/'+achat.observation,text:'Voir le prix constaté'}):null,el('button',{type:'button',class:'btn btn-secondaire',text:'Corriger l’achat',onclick:()=>ouvrirEditionAchat(achat,type)}),el('button',{type:'button',class:'btn btn-secondaire',text:'Supprimer',onclick:()=>confirmerSuppressionAchat(achat,type.id)}))));}}
  filtre.addEventListener('change',()=>{void dessiner();});await dessiner();return racine;
}

function ouvrirEditionAchat(achat,type) {
  const d=el('dialog',{class:'feuille dialog-edition-achat'});
  const prix=el('input',{id:'achat-prix-edition',class:'champ',inputmode:'decimal',value:(achat.prixPayeCentimes/100).toFixed(2).replace('.',','),'aria-label':'Prix payé',enterkeyhint:'next'});
  const format=el('input',{id:'achat-format-edition',class:'champ',type:'number',min:'1',step:'1',value:String(achat.format),'aria-label':'Format acheté',enterkeyhint:'next'});
  const quantite=el('input',{id:'achat-quantite-edition',class:'champ',type:'number',min:'1',max:'999',step:'1',value:String(achat.quantite),'aria-label':'Quantité',enterkeyhint:'next'});
  const date=el('input',{id:'achat-date-edition',class:'champ',type:'date',value:achat.date,'aria-label':'Date de l’achat',enterkeyhint:'done'});
  const erreurChamp=el('p',{class:'erreur',role:'alert',hidden:true});
  const fermer=()=>{if(d.open)d.close();d.remove();};
  const enregistrer=el('button',{type:'button',class:'btn btn-primaire',text:'Enregistrer',onclick:async()=>{
    const p=analyserPrixSaisie(prix.value), f=Number(format.value), q=Number(quantite.value), jour=date.value;
    if(!p||!Number.isInteger(f)||f<=0||!Number.isInteger(q)||q<1||q>999||!/^\d{4}-\d{2}-\d{2}$/.test(jour)){erreurChamp.textContent='Saisissez une date, un prix, un format et une quantité valides.';erreurChamp.hidden=false;return;}
    try{await modifierAchat(achat.id,{prixPayeCentimes:p,format:f,quantite:q,date:jour});fermer();await afficher();}
    catch(e){erreurChamp.textContent=e.message||'Modification impossible.';erreurChamp.hidden=false;}
  }});
  d.append(el('h2',{text:'Modifier cet achat'}),el('label',{for:'achat-date-edition',class:'etiquette',text:'Date'}),date,el('label',{for:'achat-prix-edition',class:'etiquette',text:'Prix payé (€)'}),prix,el('label',{for:'achat-format-edition',class:'etiquette',text:'Format acheté ('+(type.unite==='kg'?'g':type.unite==='l'?'ml':'unités')+')'}),format,el('label',{for:'achat-quantite-edition',class:'etiquette',text:'Quantité'}),quantite,erreurChamp,el('div',{class:'feuille-actions'},el('button',{type:'button',class:'btn btn-secondaire',text:'Annuler',onclick:fermer}),enregistrer));
  d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();
}

function confirmerSuppressionAchat(achat,typeId) {
  const d=el('dialog',{class:'feuille dialog-suppression-achat'},
    el('h2',{text:'Supprimer cet achat ?'}),
    el('p',{text:'Cette action est définitive. Le relevé de prix associé est conservé.'}),
    el('div',{class:'feuille-actions'},
      el('button',{type:'button',class:'btn btn-secondaire',text:'Annuler',onclick:()=>d.close()}),
      el('button',{type:'button',class:'btn btn-primaire',text:'Supprimer',onclick:async()=>{try{await supprimerAchat(achat.id);d.close();await afficher();}catch(e){console.error('Suppression achat impossible',e);}}})
    )
  );
  d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();
}

async function lireTypeSafe(id){ const r=await listerTypes(); return r.find(t=>t.id===Number(id))||null; }

const ROUTES = {
  magasin: { titre: 'Magasin', onglet: 'magasin', vue: vueMagasin },
  liste: { titre: 'Liste', onglet: 'liste', vue: vueListeCourses },
  types: { titre: 'Types', onglet: 'types', vue: vueTypes },
  'type-nouveau': { titre: 'Nouveau type', onglet: 'types', vue: () => vueTypeForm(null) },
  'type-edit': { titre: 'Modifier le type', onglet: 'types', vue: (p) => vueTypeForm(Number(p)) },
  bilan: { titre: 'Bilan', onglet: 'bilan', vue: vueBilan },
  achats: { titre: 'Achats', onglet: 'types', vue: (p) => vueHistoriqueAchats(Number(p)) },
  'tous-achats': { titre: 'Tous mes achats', onglet: 'bilan', vue: vueTousAchats },
  reglages: { titre: 'Réglages', onglet: null, vue: vueReglages },
  historique: { titre: 'Prix constatés', onglet: 'types', vue: (p) => vueHistorique(Number(p)) },
  fiche: { titre: 'Fiche du type', onglet: 'types', vue: (p,tab,obs) => vueFicheType(Number(p),tab,obs==null?null:Number(obs)) },
  'releve-mensuel': { titre: 'Relevé mensuel', onglet: 'types', vue: vueReleveMensuel }
};

async function afficher() {
  const sequence = ++sequenceAffichage;
  const [nom, param, sousParam, detailParam] = (location.hash.replace('#/', '') || 'magasin').split('/');
  if (nom !== 'releve-mensuel') { window.__releveMensuelCleanup?.(); window.__releveMensuelCleanup=null; }
  if (nom !== 'magasin') { document.getElementById('dock-magasin')?.remove(); dockResizeObserver?.disconnect(); document.documentElement.style.setProperty('--dock-hauteur', '0px'); }
  const r = ROUTES[nom] || ROUTES.magasin;
  titre.textContent = r.titre; document.title = r.titre + ' · Appli Courses';
  const contenu = await r.vue(param,sousParam,detailParam);
  if (sequence !== sequenceAffichage) return;
  vue.replaceChildren(contenu);
  if(nom==='fiche'&&detailParam)requestAnimationFrame(()=>document.querySelector('.ligne-releve-highlight')?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
  if (nom === 'reglages' && param === 'magasins') requestAnimationFrame(() => document.getElementById('reglages-magasins')?.scrollIntoView({block:'start'}));
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
    await actualiserMagasins();
    magasinCourant = await lireReglage('magasinCourant', magasinsDisponibles[0]?.id || '');
    if (!magasinsDisponibles.some(m => m.id === magasinCourant)) magasinCourant = magasinsDisponibles[0]?.id || '';
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
