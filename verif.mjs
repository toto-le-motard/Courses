// verif.mjs — validation automatique de l'Appli Courses (story 1.6).
// Lancé par GitHub Actions à chaque dépôt (.github/workflows/verif.yml), ou à la main : node verif.mjs
// Contrôles : syntaxe, liste de sw.js, version du cache, tests du domaine (tests.html), parcours de l'appli
// dans un vrai Chromium (navigation, base, hors ligne). Code de sortie 1 s'il y a un échec.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { extname, join } from 'node:path';

const lignes = [];
let echecs = 0;
function ok(msg) { lignes.push('OK     ' + msg); }
function ko(msg) { lignes.push('ECHEC  ' + msg); echecs++; console.log('::error title=Vérification::' + String(msg).replace(/\n/g, ' ')); }
function info(msg) { lignes.push('INFO   ' + msg); }

const racine = process.cwd();
const EXCLUS = new Set(['sw.js', 'verif.mjs', 'tests.html', 'scan-test.html', 'package.json', 'package-lock.json']);
const EXT_APPLI = new Set(['.html', '.css', '.js', '.png', '.webmanifest', '.woff2']);

// ---- 1. Fichiers du projet et liste de sw.js ---------------------------------------------
const swTexte = readFileSync(join(racine, 'sw.js'), 'utf8');
function listeSw(nom) {
  const m = swTexte.match(new RegExp('const ' + nom + ' = \\[([\\s\\S]*?)\\];'));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const principaux = listeSw('FICHIERS');
const optionnels = listeSw('FICHIERS_OPTIONNELS') || [];
if (!principaux) {
  ko('sw.js : liste FICHIERS introuvable');
} else {
  const presents = readdirSync(racine, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.') && !EXCLUS.has(d.name) && EXT_APPLI.has(extname(d.name)))
    .map((d) => d.name);
  const inscrits = new Set([...principaux, ...optionnels]);
  const manquantsDansSw = presents.filter((f) => !inscrits.has(f));
  const absents = principaux.filter((f) => f !== './' && !existsSync(join(racine, f)));
  if (manquantsDansSw.length) ko('fichiers du projet absents de la liste de sw.js : ' + manquantsDansSw.join(', '));
  if (absents.length) ko('fichiers listés dans sw.js mais absents du dépôt : ' + absents.join(', '));
  if (!manquantsDansSw.length && !absents.length) ok('liste de sw.js complète (' + principaux.length + ' fichiers, ' + optionnels.length + ' optionnels)');
}

// ---- 2. Syntaxe des scripts ----------------------------------------------------------------
const scripts = readdirSync(racine).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
for (const f of scripts) {
  try { execSync('node --check ' + JSON.stringify(f), { stdio: 'pipe' }); }
  catch (e) { ko('syntaxe ' + f + ' : ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')); }
}
if (!lignes.some((l) => l.startsWith('ECHEC') && l.includes('syntaxe'))) ok('syntaxe des scripts (' + scripts.join(', ') + ')');

// ---- 3. Version du cache -------------------------------------------------------------------
const versionDe = (t) => { const m = t.match(/const CACHE_VERSION = 'v(\d+)'/); return m ? Number(m[1]) : null; };
const versionActuelle = versionDe(swTexte);
if (versionActuelle === null) ko("sw.js : CACHE_VERSION doit être de la forme 'v<nombre>'");
else {
  let precedent = null, modifies = [];
  try {
    precedent = versionDe(execSync('git show HEAD~1:sw.js', { stdio: 'pipe' }).toString());
    modifies = execSync('git diff --name-only HEAD~1 HEAD', { stdio: 'pipe' }).toString().split('\n').filter(Boolean);
  } catch { /* pas de commit précédent : contrôle sauté */ }
  if (precedent === null) info('version du cache v' + versionActuelle + ' (pas de commit précédent à comparer)');
  else {
    const touches = modifies.filter((f) => new Set([...(principaux || []), ...optionnels, 'sw.js']).has(f) && f !== 'sw.js');
    if (touches.length && versionActuelle <= precedent) ko('fichiers mis en cache modifiés (' + touches.join(', ') + ') mais CACHE_VERSION non augmentée (v' + precedent + ' -> v' + versionActuelle + ')');
    else if (versionActuelle < precedent) ko('CACHE_VERSION a diminué (v' + precedent + ' -> v' + versionActuelle + ')');
    else ok('version du cache v' + versionActuelle + ' (précédente : v' + precedent + ')');
  }
}

// ---- 4 et 5. Navigateur : tests du domaine et parcours de l'appli --------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const serveur = createServer((req, rep) => {
  let chemin = decodeURIComponent(req.url.split('?')[0]);
  if (chemin.endsWith('/')) chemin += 'index.html';
  const f = join(racine, chemin);
  if (!f.startsWith(racine) || !existsSync(f)) { rep.writeHead(404); rep.end('introuvable'); return; }
  rep.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
  rep.end(readFileSync(f));
});
await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + serveur.address().port + '/';

let playwright;
try { playwright = await import('playwright'); } catch { ko('Playwright indisponible (npm install playwright)'); }

if (playwright) {
  const navigateur = await playwright.chromium.launch();
  try {
    // 4. Tests du domaine (tests.html expose window.__resultats = { reussis, echecs, details })
    if (existsSync(join(racine, 'tests.html'))) {
      const ctx = await navigateur.newContext();
      const page = await ctx.newPage();
      await page.goto(base + 'tests.html');
      try {
        await page.waitForFunction(() => window.__resultats, null, { timeout: 15000 });
        const r = await page.evaluate(() => window.__resultats);
        if (r.echecs === 0 && r.reussis > 0) ok('tests du domaine : ' + r.reussis + ' réussis');
        else ko('tests du domaine : ' + r.echecs + ' échec(s) sur ' + (r.reussis + r.echecs) + ' ' + JSON.stringify(r.details || []).slice(0, 600));
      } catch { ko('tests.html : window.__resultats absent après 15 s'); }
      await ctx.close();
    } else info('tests.html absent : tests du domaine sautés');

    // 5. Parcours de l'appli
    const ctx = await navigateur.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push('exception : ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console : ' + m.text()); });
    try {
      await page.goto(base);
      await page.waitForSelector('#vue .carte', { timeout: 10000 });
      ok('l\u2019appli s\u2019affiche');
      for (const [route, titre] of [['liste', 'Liste'], ['types', 'Types'], ['bilan', 'Bilan'], ['magasin', 'Magasin']]) {
        await page.click('.tabs a[data-route="' + route + '"]');
        await page.waitForFunction((t) => document.getElementById('titre-ecran').textContent === t, titre, { timeout: 3000 });
      }
      ok('navigation par les 4 onglets');
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#/bilan', null, { timeout: 3000 });
      ok('retour arrière : revient à l\u2019écran précédent');
      await page.click('#btn-reglages');
      await page.waitForFunction(() => /ouverte/.test(document.getElementById('vue').textContent), null, { timeout: 8000 });
      const diag = await page.evaluate(() => document.getElementById('vue').textContent);
      ok('base IndexedDB ouverte (' + (diag.match(/Lancements enregistrés : (\d+)/) || [])[0] + ')');

      // ---- Épic E2 : catalogue de types de produits (FR1, FR2) ----
      const aller = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); };
      await aller('#/magasin');
      await page.waitForFunction(() => /Ajouter mon premier type/.test(document.getElementById('vue').textContent), null, { timeout: 8000 });
      ok('E2 premier lancement : bouton « Ajouter mon premier type »');
      const creer = async (nomType, unite) => {
        await aller('#/type-nouveau');
        await page.waitForSelector('#champ-nom');
        await page.fill('#champ-nom', nomType);
        await page.click('.segment[data-unite="' + unite + '"]');
        await page.click('button[type="submit"]');
      };
      await creer('Café moulu', 'kg');
      await page.waitForFunction(() => location.hash === '#/types' && /Café moulu/.test(document.getElementById('vue').textContent), null, { timeout: 5000 });
      ok('E2 création d\u2019un type et affichage dans la liste');
      await creer('cafe  MOULU', 'kg');
      await page.waitForFunction(() => /porte déjà ce nom/.test(document.querySelector('.erreur')?.textContent || ''), null, { timeout: 5000 });
      ok('E2 nom en double refusé (casse, accents et espaces ignorés)');
      await creer('Lessive liquide', 'l');
      await page.waitForFunction(() => location.hash === '#/types' && /Lessive liquide/.test(document.getElementById('vue').textContent), null, { timeout: 5000 });
      await page.fill('input[type="search"]', 'cafe');
      await page.waitForFunction(() => document.querySelectorAll('#liste-types .ligne').length === 1 && /Café moulu/.test(document.getElementById('liste-types').textContent), null, { timeout: 3000 });
      await page.fill('input[type="search"]', '');
      ok('E2 recherche sans accents ni casse');
      await page.click('button[aria-label="Actions pour Café moulu"]');
      await page.click('dialog button:has-text("Archiver")');
      await page.waitForFunction(() => !/Café moulu/.test(document.getElementById('liste-types').textContent) && /Café moulu/.test(document.getElementById('types-archives').textContent), null, { timeout: 5000 });
      ok('E2 archivage : le type quitte la liste et apparaît dans « Archivés »');
      await page.click('#types-archives summary');
      await page.click('#types-archives button:has-text("Restaurer")');
      await page.waitForFunction(() => /Café moulu/.test(document.getElementById('liste-types').textContent), null, { timeout: 5000 });
      ok('E2 restauration d\u2019un type archivé');
      // Un relevé existe : le changement d'unité doit être refusé.
      await page.evaluate(() => new Promise((res, rej) => {
        const rq = indexedDB.open('appli-courses');
        rq.onsuccess = () => {
          const db = rq.result;
          const t = db.transaction(['ProductType', 'Observation'], 'readwrite');
          const g = t.objectStore('ProductType').getAll();
          g.onsuccess = () => {
            const cafe = g.result.find((x) => x.nomNormalise === 'cafe moulu');
            window.__idCafe = cafe.id;
            t.objectStore('Observation').add({ type: cafe.id, magasin: 'leclerc', date: '2026-10-01', prixCentimes: 500, format: 250, promo: 0 });
          };
          t.oncomplete = () => { db.close(); res(); };
          t.onerror = () => rej(t.error);
        };
        rq.onerror = () => rej(rq.error);
      }));
      const idCafe = await page.evaluate(() => window.__idCafe);
      await aller('#/type-edit/' + idCafe);
      await page.waitForFunction(() => document.querySelectorAll('.segment:disabled').length === 3, null, { timeout: 5000 });
      ok('E2 changement d\u2019unité refusé quand des relevés existent');
      await aller('#/types');
      await page.waitForSelector('button[aria-label="Actions pour Café moulu"]');
      await page.click('button[aria-label="Actions pour Café moulu"]');
      await page.click('dialog button:has-text("Supprimer")');
      await page.waitForFunction(() => /définitivement/.test(document.querySelector('dialog')?.textContent || ''), null, { timeout: 5000 });
      await page.click('dialog button:has-text("Supprimer")');
      await page.waitForFunction(() => !/Café moulu/.test(document.getElementById('vue').textContent), null, { timeout: 5000 });
      const restants = await page.evaluate(() => new Promise((res) => {
        const rq = indexedDB.open('appli-courses');
        rq.onsuccess = () => { const c = rq.result.transaction('Observation').objectStore('Observation').count(); c.onsuccess = () => res(c.result); };
      }));
      if (restants === 0) ok('E2 suppression d\u2019un type et de son historique'); else ko('E2 suppression : ' + restants + ' relevé(s) orphelin(s)');
      await page.click('button[aria-label="Actions pour Lessive liquide"]');
      await page.click('dialog button:has-text("Supprimer")');
      await page.waitForSelector('dialog:has-text("définitive")');
      await page.click('dialog button:has-text("Supprimer")');      await page.waitForFunction(() => /Aucun type pour/.test(document.getElementById('vue').textContent), null, { timeout: 5000 });
      ok('E2 liste vide : phrase d\u2019explication et lien d\u2019action');
      await aller('#/reglages');
      // service worker actif et page contrôlée, puis test hors ligne
      await page.evaluate(() => navigator.serviceWorker.ready);
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForSelector('#vue .carte'); }
      const controle = await page.evaluate(() => !!navigator.serviceWorker.controller);
      if (!controle) ko('le service worker ne contrôle pas la page');
      else {
        await ctx.setOffline(true);
        await page.reload();
        await page.waitForSelector('#vue .carte', { timeout: 10000 });
        const pastille = await page.evaluate(() => !document.getElementById('offline-pill').hidden);
        if (pastille) ok('hors ligne : l\u2019appli se lance depuis le cache, pastille « Hors ligne » visible');
        else ko('hors ligne : la pastille « Hors ligne » n\u2019apparaît pas');
        await ctx.setOffline(false);
      }
    } catch (e) { ko('parcours de l\u2019appli : ' + String(e.message).split('\n')[0]); }
    if (erreurs.length) ko('erreurs dans la page : ' + erreurs.slice(0, 3).join(' | '));
    else ok('aucune erreur dans la console de la page');
    await ctx.close();
  } finally { await navigateur.close(); }
}
serveur.close();

// ---- Compte rendu --------------------------------------------------------------------------
const titre = echecs ? 'ÉCHEC : ' + echecs + ' contrôle(s) en échec' : 'SUCCÈS : tous les contrôles passent';
const rapport = [titre, '', ...lignes].join('\n');
console.log(rapport);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + rapport + '\n```\n');
process.exit(echecs ? 1 : 0);
