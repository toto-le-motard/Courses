// types-ui.js — écrans du catalogue de types de produits (épic E2 : FR1, FR2).
import { dbPrete, listerTypes, lireType, ajouterType, modifierType, archiverType, supprimerType, compterReleves } from './db.js';
import { normaliserNom, nomTypeValide, UNITES, LIBELLE_UNITE } from './domain.js';

export function el(tag, attrs = {}, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) {
    if (e == null || e === false) continue;
    if (typeof e === 'object' && typeof e.then === 'function') { console.error('el : Promise reçue'); n.append(document.createTextNode('Erreur d'affichage')); continue; }
    n.append(e.nodeType ? e : document.createTextNode(e));
  }
  return n;
}

const parNom = (a, b) => a.nom.localeCompare(b.nom, 'fr');

// Feuille modale (menu d'actions, confirmation).
function feuille({ titre, texte, actions }) {
  const d = el('dialog', { class: 'feuille' },
    el('h2', { text: titre }),
    texte ? el('p', { text: texte }) : null,
    el('div', { class: 'feuille-actions' },
      actions.map((a) => el('button', {
        type: 'button', class: 'btn ' + (a.classe || 'btn-secondaire'),
        onclick: () => { d.close(); if (a.action) a.action(); }
      }, a.libelle))));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

// Story 2.1 : premier lancement (aucun type).
export function accueilVide() {
  return el('section', { class: 'carte' },
    el('h2', { text: 'Bienvenue' }),
    el('p', { text: 'Commencez par créer un type de produit à suivre, par exemple « café moulu ».' }),
    el('a', { href: '#/type-nouveau', class: 'btn btn-primaire btn-bloc' }, 'Ajouter mon premier type'));
}

// Stories 2.2 et 2.3 : liste, recherche, archivage, suppression.
export function vueTypes() {
  const racine = el('div');
  const recherche = el('input', { type: 'search', class: 'champ', placeholder: 'Rechercher un type', 'aria-label': 'Rechercher un type', autocomplete: 'off' });
  const liste = el('div', { id: 'liste-types' });
  const archives = el('details', { class: 'archives', id: 'types-archives' });
  racine.append(
    el('a', { href: '#/type-nouveau', class: 'btn btn-primaire btn-bloc' }, '+ Nouveau type'),
    recherche, liste, archives);
  let types = [];

  function ligne(t) {
    return el('div', { class: 'ligne' },
      el('div', { class: 'ligne-texte' }, el('strong', { text: t.nom }), el('span', { class: 'puce', text: LIBELLE_UNITE[t.unite] }), el('a', { href: '#/historique/' + t.id, class: 'btn btn-secondaire', text: 'Historique' })),
      t.archive ? el('button', { type: 'button', class: 'btn btn-secondaire', onclick: () => basculerArchive(t, false) }, 'Restaurer') : null,
      el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Actions pour ' + t.nom, onclick: () => menu(t) }, '\u22EF'));
  }

  function dessiner() {
    const q = normaliserNom(recherche.value);
    const actifs = types.filter((t) => !t.archive && t.nomNormalise.includes(q)).sort(parNom);
    const archives_ = types.filter((t) => t.archive && t.nomNormalise.includes(q)).sort(parNom);
    liste.replaceChildren();
    if (!types.length) {
      liste.append(el('section', { class: 'carte' },
        el('p', { text: 'Aucun type pour l\u2019instant.' }),
        el('a', { href: '#/type-nouveau', class: 'lien' }, 'Ajouter mon premier type')));
    } else if (!actifs.length) {
      liste.append(el('p', { class: 'aide', text: q ? 'Aucun type ne correspond à cette recherche.' : 'Tous vos types sont archivés.' }));
    } else {
      liste.append(...actifs.map(ligne));
    }
    const ouvert = archives.open;
    archives.replaceChildren(el('summary', { text: 'Archivés (' + archives_.length + ')' }), ...archives_.map(ligne));
    archives.hidden = !archives_.length;
    archives.open = ouvert;
  }

  async function charger() {
    await dbPrete;
    types = await listerTypes();
    if (racine.isConnected) dessiner();
  }

  async function basculerArchive(t, archive) { await archiverType(t.id, archive); await charger(); }

  function menu(t) {
    feuille({
      titre: t.nom,
      actions: [
        { libelle: 'Modifier', action: () => { location.hash = '#/type-edit/' + t.id; } },
        { libelle: t.archive ? 'Restaurer' : 'Archiver', action: () => basculerArchive(t, !t.archive) },
        { libelle: 'Supprimer', classe: 'btn-danger', action: () => confirmerSuppression(t) },
        { libelle: 'Fermer' }
      ]
    });
  }

  async function confirmerSuppression(t) {
    const n = await compterReleves(t.id);
    feuille({
      titre: 'Supprimer « ' + t.nom + ' » ?',
      texte: n ? 'Son historique (' + n + ' relevé' + (n > 1 ? 's' : '') + ') sera supprimé définitivement.' : 'Cette action est définitive.',
      actions: [
        { libelle: 'Supprimer', classe: 'btn-danger', action: async () => { await supprimerType(t.id); await charger(); } },
        { libelle: 'Annuler' }
      ]
    });
  }

  recherche.addEventListener('input', dessiner);
  charger().catch(() => { liste.replaceChildren(el('p', { class: 'aide erreur', text: 'Base de données indisponible.' })); });
  return racine;
}

// Stories 2.1 et 2.3 : création et modification d'un type.
export function vueTypeForm(id) {
  const racine = el('div');
  const message = el('p', { class: 'erreur', role: 'alert', hidden: true });
  const nom = el('input', { class: 'champ', id: 'champ-nom', name: 'nom', maxlength: '60', required: true, autocomplete: 'off', 'aria-label': 'Nom du type' });
  let unite = null;
  const boutons = UNITES.map((u) => el('button', {
    type: 'button', class: 'segment', 'data-unite': u, 'aria-pressed': 'false', onclick: () => choisir(u)
  }, LIBELLE_UNITE[u]));
  const noteUnite = el('p', { class: 'aide', hidden: true });
  const marque = el('input', { class: 'champ', name: 'marque', autocomplete: 'off', 'aria-label': 'Marque (facultatif)' });
  const nomArticle = el('input', { class: 'champ', name: 'nomArticle', autocomplete: 'off', 'aria-label': 'Nom de l\u2019article (facultatif)' });

  function choisir(u) {
    unite = u;
    boutons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unite === u)));
  }
  function erreur(texte) { message.textContent = texte; message.hidden = !texte; }

  const form = el('form', { novalidate: true },
    el('label', { for: 'champ-nom', class: 'etiquette', text: 'Nom du type' }), nom,
    el('p', { class: 'etiquette', text: 'Unité de comparaison' }),
    el('div', { class: 'segments', role: 'group', 'aria-label': 'Unité de comparaison' }, boutons),
    noteUnite,
    el('details', { class: 'plus' },
      el('summary', { text: 'Plus de détails' }),
      el('label', { class: 'etiquette', text: 'Marque (facultatif)' }, marque),
      el('label', { class: 'etiquette', text: 'Nom de l\u2019article (facultatif)' }, nomArticle)),
    message,
    el('button', { type: 'submit', class: 'btn btn-primaire btn-bloc' }, 'Enregistrer'),
    el('a', { href: '#/types', class: 'btn btn-secondaire btn-bloc' }, 'Annuler'));
  racine.append(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erreur('');
    if (!nomTypeValide(nom.value)) return erreur('Saisissez un nom (60 caractères au plus).');
    if (!unite) return erreur('Choisissez l\u2019unité de comparaison.');
    const donnees = { nom: nom.value, unite, marque: marque.value, nomArticle: nomArticle.value };
    try {
      if (id) await modifierType(id, donnees); else await ajouterType(donnees);
      location.hash = '#/types';
    } catch (err) { erreur(err.message); }
  });

  if (id) {
    (async () => {
      await dbPrete;
      const t = await lireType(id);
      if (!t) return erreur('Type introuvable.');
      nom.value = t.nom; marque.value = t.marque || ''; nomArticle.value = t.nomArticle || '';
      choisir(t.unite);
      if ((await compterReleves(id)) > 0) {
        boutons.forEach((b) => { b.disabled = true; });
        noteUnite.textContent = 'L\u2019unité ne peut plus changer : des relevés existent pour ce type.';
        noteUnite.hidden = false;
      }
    })().catch(() => erreur('Base de données indisponible.'));
  }
  return racine;
}
