// verif.mjs — validation automatique de l'Appli Courses (story 1.6).
// Lancé par GitHub Actions à chaque dépôt (.github/workflows/verif.yml), ou à la main : node verif.mjs
// Contrôles : syntaxe, liste de sw.js, version du cache, tests du domaine (tests.html), parcours de l'appli
// dans un vrai Chromium (navigation, base, hors ligne). Code de sortie 1 s'il y a un échec.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, appendFileSync, writeFileSync, unlinkSync } from 'node:fs';
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
  try { execSync('node --experimental-default-type=module --check ' + JSON.stringify(f), { stdio: 'pipe' }); }
  catch (e) { ko('syntaxe ' + f + ' : ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')); }
}
if (!lignes.some((l) => l.startsWith('ECHEC') && l.includes('syntaxe'))) ok('syntaxe des scripts (' + scripts.join(', ') + ')');
const sondeSyntaxe = join(racine, '.verif-sonde-syntaxe.mjs');
try {
  writeFileSync(sondeSyntaxe, "const phrase = 'aujourd'hui';\\n", 'utf8');
  let rejetee = false;
  try { execSync('node --experimental-default-type=module --check ' + JSON.stringify(sondeSyntaxe), { stdio: 'pipe' }); }
  catch { rejetee = true; }
  if (rejetee) ok('auto-test syntaxe : Node ' + process.versions.node + ' rejette une apostrophe non échappée dans une chaîne temporaire');
  else ko('auto-test syntaxe : Node accepte à tort une apostrophe non échappée');
} finally { try { unlinkSync(sondeSyntaxe); } catch {} }

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
  const navigateur = await playwright.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    // Compatibilité avec une base historique v1 : les données existantes doivent survivre à l'ouverture.
    {
      const ancienCtx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
      const anciennePage = await ancienCtx.newPage();
      await anciennePage.goto(base + 'tests.html');
      await anciennePage.evaluate(() => new Promise((resolve, reject) => {
        const req = indexedDB.open('appli-courses', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          const types = db.createObjectStore('ProductType', { keyPath: 'id', autoIncrement: true });
          types.createIndex('nomNormalise', 'nomNormalise', { unique: true });
          const articles = db.createObjectStore('Article', { keyPath: 'codeBarres' }); articles.createIndex('type', 'type');
          const obs = db.createObjectStore('Observation', { keyPath: 'id', autoIncrement: true });
          obs.createIndex('type', 'type'); obs.createIndex('cleJour', ['type', 'magasin', 'date', 'promo']);
          const achats = db.createObjectStore('Purchase', { keyPath: 'id', autoIncrement: true });
          achats.createIndex('type', 'type'); achats.createIndex('observation', 'observation');
          db.createObjectStore('Settings', { keyPath: 'cle' });
          types.add({ id: 42, nom: 'Type historique', nomNormalise: 'type historique', unite: 'kg', archive: 0 });
        };
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
      }));
      await anciennePage.goto(base);
      await anciennePage.waitForFunction(() => document.querySelector('#titre-ecran')?.textContent === 'Magasin', null, { timeout: 10000 });
      const typeHistorique = await anciennePage.evaluate(() => new Promise((resolve, reject) => {
        const req = indexedDB.open('appli-courses', 1);
        req.onsuccess = () => { const db = req.result, q = db.transaction('ProductType').objectStore('ProductType').get(42);
          q.onsuccess = () => { resolve(q.result || null); db.close(); }; q.onerror = () => reject(q.error); };
        req.onerror = () => reject(req.error);
      }));
      if (!typeHistorique || typeHistorique.nom !== 'Type historique' || typeHistorique.unite !== 'kg') throw new Error('base historique v1 : type existant perdu ou modifié');
      ok('compatibilité base IndexedDB historique v1 : données préservées à l’ouverture');
      await ancienCtx.close();
    }

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
    const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const erreurs = [];
    const requetesExternes = [];
    const requetesOpenFoodFacts = [];
    let autoriserRequeteOpenFoodFacts = false;
    page.on('request', req => { const u=new URL(req.url()); if(u.origin===new URL(base).origin || ['data:','blob:'].includes(u.protocol)) return; if(autoriserRequeteOpenFoodFacts && u.origin==='https://world.openfoodfacts.org' && /^\/api\/v2\/product\/\d+\.json$/.test(u.pathname)) requetesOpenFoodFacts.push(u.href); else requetesExternes.push(req.url()); });
    const verifierEcran = async (nom) => { const texte=await page.locator('body').innerText(); if(texte.includes('[object Promise]')) throw new Error(nom+' : [object Promise] présent'); if(texte.includes('Erreur d’affichage')) throw new Error(nom+' : Erreur d’affichage présente'); if(/\bundefined\b/.test(texte)) throw new Error(nom+' : texte undefined visible'); if(erreurs.length) throw new Error(nom+' : erreur console/pageerror : '+erreurs[0]); };
    const verifierOptionsNonVides = async (nom) => { const v=await page.locator('select option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent.trim()})).filter(e=>!e.text)); if(v.length) throw new Error(nom+' : option sans texte '+JSON.stringify(v)); };
    page.on('pageerror', (e) => erreurs.push('exception : ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console : ' + m.text()); });
    let etapeParcours = 'chargement initial';
    try {
      await page.goto(base);
      if (erreurs.length) throw new Error('chargement de l’appli : ' + erreurs[0]);
      await page.waitForSelector('#vue .carte', { timeout: 10000 });
      ok('l\u2019appli s\u2019affiche');
      for (const [route, titre] of [['liste', 'Liste'], ['types', 'Types'], ['bilan', 'Bilan'], ['magasin', 'Magasin']]) {
        await page.click('.tabs a[data-route="' + route + '"]');
        await page.waitForFunction((t) => (document.getElementById('titre-ecran')?.textContent || '') === t, titre, { timeout: 3000 });
        await verifierEcran(titre); await verifierOptionsNonVides(titre);
      }
      ok('navigation par les 4 onglets');
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#/bilan', null, { timeout: 3000 });
      ok('retour arrière : revient à l\u2019écran précédent');
      await page.click('#btn-reglages');
      await page.waitForFunction(() => /ouverte/.test((document.getElementById('vue')?.textContent || '')), null, { timeout: 8000 });
      const diag = await page.evaluate(() => (document.getElementById('vue')?.textContent || ''));
      ok('base IndexedDB ouverte (' + (diag.match(/Lancements enregistrés : (\d+)/) || [])[0] + ')');

      // ---- Épic E2 : catalogue de types de produits (FR1, FR2) ----
      const aller = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x)=>window.__routeAffichee===x,h,{timeout:8000}); };
      await aller('#/magasin');
      await page.waitForFunction(() => /Ajouter mon premier type/.test((document.getElementById('vue')?.textContent || '')), null, { timeout: 8000 });
      ok('E2 premier lancement : bouton « Ajouter mon premier type »');
      const creer = async (nomType, unite) => {
        await aller('#/type-nouveau');
        await page.waitForSelector('#champ-nom');
        const libellesType=await page.locator('.segment').evaluateAll(es=>es.map(e=>e.textContent.trim()));if(JSON.stringify(libellesType)!==JSON.stringify(['kg','l','unités']))throw new Error('libellés de création de type incorrects '+JSON.stringify(libellesType));await verifierEcran('Création de type');
        await page.fill('#champ-nom', nomType);
        await page.click('.segment[data-unite="' + unite + '"]');
        await page.click('button[type="submit"]');
      };
      await creer('Café moulu', 'kg');
      await page.waitForFunction(() => location.hash === '#/types' && /Café moulu/.test((document.getElementById('vue')?.textContent || '')), null, { timeout: 5000 });
      ok('E2 création d\u2019un type et affichage dans la liste');
      await creer('cafe  MOULU', 'kg');
      await page.waitForFunction(() => /porte déjà ce nom/.test(document.querySelector('.erreur')?.textContent || ''), null, { timeout: 5000 });
      ok('E2 nom en double refusé (casse, accents et espaces ignorés)');
      await creer('Lessive liquide', 'l');
      await page.waitForFunction(() => location.hash === '#/types' && /Lessive liquide/.test((document.getElementById('vue')?.textContent || '')), null, { timeout: 5000 });
      await page.fill('input[type="search"]', 'cafe');
      await page.waitForFunction(() => document.querySelectorAll('#liste-types .ligne').length === 1 && /Café moulu/.test((document.getElementById('liste-types')?.textContent || '')), null, { timeout: 3000 });
      await page.fill('input[type="search"]', '');
      ok('E2 recherche sans accents ni casse');
      await page.click('button[aria-label="Actions pour Café moulu"]');
      await page.click('dialog button:has-text("Archiver")');
      await page.waitForFunction(() => !/Café moulu/.test((document.getElementById('liste-types')?.textContent || '')) && /Café moulu/.test((document.getElementById('types-archives')?.textContent || '')), null, { timeout: 5000 });
      ok('E2 archivage : le type quitte la liste et apparaît dans « Archivés »');
      await page.click('#types-archives summary');
      await page.click('#types-archives button:has-text("Restaurer")');
      await page.waitForFunction(() => /Café moulu/.test((document.getElementById('liste-types')?.textContent || '')), null, { timeout: 5000 });
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
      const choisirType=async n=>{await page.fill('#champ-type',n);await page.waitForSelector('#suggestions-types .suggestion-type');await page.click('#suggestions-types .suggestion-type');};
      const verifierUnites=async a=>{const options=await page.locator('#champ-unite option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent.trim()})));const v=options.map(e=>e.value);if(JSON.stringify(v)!==JSON.stringify(a))throw new Error('unités incorrectes '+JSON.stringify(v));if(options.some(e=>!e.text))throw new Error('option sans texte visible '+JSON.stringify(options));const attendus=a.map(u=>u==='unit'?'unités':u);if(JSON.stringify(options.map(e=>e.text))!==JSON.stringify(attendus))throw new Error('libellés d’unités incorrects '+JSON.stringify(options));if(!await page.$eval('#champ-unite',e=>!!e.value))throw new Error('unité non sélectionnée');};
      await aller('#/magasin');await page.waitForSelector('#champ-type');await choisirType('Café moulu');await verifierUnites(['g','kg']);await page.fill('#champ-prix','11,00');await page.fill('#champ-format','500');await page.selectOption('#champ-unite','g');await page.waitForFunction(()=>/22,00\s*€\/kg/.test(document.querySelector('.prix-normalise')?.textContent||''),null,{timeout:3000});await page.evaluate(()=>{const e=document.querySelector('#champ-unite');e.value='';e.dispatchEvent(new Event('change',{bubbles:true}));});if(!await page.$eval('#btn-enregistrer',e=>e.disabled))throw new Error('Enregistrer actif sans unité');await page.selectOption('#champ-unite','g');await page.waitForSelector('#carte-verdict:not([hidden])',{timeout:5000});
      await page.fill('#champ-prix','0');await page.waitForTimeout(60);if(await page.locator('#carte-verdict:not([hidden])').count()||!await page.$eval('#btn-enregistrer',e=>e.disabled))throw new Error('prix invalide : verdict visible ou Enregistrer actif');await page.fill('#champ-prix','11,00');
      await page.fill('#champ-format','0');await page.waitForTimeout(60);if(await page.locator('#carte-verdict:not([hidden])').count()||!await page.$eval('#btn-enregistrer',e=>e.disabled))throw new Error('format invalide : verdict visible ou Enregistrer actif');await page.fill('#champ-format','500');await page.selectOption('#champ-unite','g');await page.waitForSelector('#carte-verdict:not([hidden])',{timeout:5000});
      const mesurer=async()=>page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),height:Math.round(b.height)};};return {scrollY:Math.round(scrollY),type:r('#champ-type'),prix:r('#champ-prix'),format:r('#champ-format'),verdict:r('#carte-verdict'),bouton:r('#btn-enregistrer'),tabs:r('.tabs'),dock:r('#dock-magasin')};});
      await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(50);
      const apres844=await mesurer();info('MESURES APRES dock 390x844 '+JSON.stringify(apres844));
      if(!apres844.dock||apres844.scrollY!==0||apres844.type.top<0||apres844.prix.bottom>apres844.dock.top||apres844.format.bottom>apres844.dock.top||apres844.dock.bottom>apres844.tabs.top||apres844.verdict.top<apres844.dock.top||apres844.verdict.bottom>apres844.dock.bottom||apres844.bouton.top<apres844.dock.top||apres844.bouton.bottom>apres844.dock.bottom)throw new Error('dock ou champs hors zone visible à 390x844 : '+JSON.stringify(apres844));
      const datePromo=await page.evaluate(()=>{const a=document.querySelector('.date-ligne').getBoundingClientRect(),b=document.querySelector('.promo-ligne').getBoundingClientRect();return {dateTop:Math.round(a.top),promoTop:Math.round(b.top),dateBottom:Math.round(a.bottom),promoBottom:Math.round(b.bottom)};});if(Math.abs(datePromo.dateTop-datePromo.promoTop)>4)throw new Error('Date et Promo ne sont pas sur une seule ligne : '+JSON.stringify(datePromo));
      await page.setViewportSize({width:390,height:500});await page.locator('#champ-prix').focus();await page.waitForTimeout(100);
      const apres500=await mesurer();info('MESURES APRES dock 390x500 '+JSON.stringify(apres500));
      if(!apres500.dock||apres500.type.top<0||apres500.prix.top<0||apres500.prix.bottom>apres500.dock.top||apres500.format.bottom>apres500.dock.top||apres500.dock.top<0||apres500.dock.bottom>apres500.tabs.top||apres500.dock.bottom>500)throw new Error('champ prix ou dock masqué à 390x500 : '+JSON.stringify(apres500));
      // UX 3.1 / story 3.8 : simulation du clavier, car Playwright ne l'ouvre pas réellement.
      await page.locator('#champ-prix').fill('11,00');
      const debutFrappe=Date.now();await page.locator('#champ-prix').press('End');await page.keyboard.type('1');
      await page.waitForFunction(()=>{const e=document.querySelector('#carte-verdict');return e&&!e.hidden;},null,{timeout:2000});
      if(Date.now()-debutFrappe>=2000)throw new Error('verdict après frappe du prix en 2 secondes ou plus');
            await page.evaluate(()=>window.__forcerModeSaisie?.(true));
      const mesurerModeSaisie=async()=>page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),height:Math.round(b.height)};};return {labelType:r('label[for="champ-type"]'),labelPrix:r('label[for="champ-prix"]'),labelFormat:r('label[for="champ-format"]'),labelHorsPromo:r('label[for="champ-prix-hors-promo"]'),prixHorsPromo:r('#champ-prix-hors-promo'),titre:r('.topbar'),prix:r('#champ-prix'),type:r('#champ-type'),format:r('#champ-format'),dock:r('#dock-magasin'),tabs:r('.tabs'),mode:document.body.classList.contains('mode-saisie'),verdict:!!document.querySelector('#carte-verdict:not([hidden])')};});
      await page.locator('#champ-prix').focus();await page.waitForTimeout(80);
      let clavier=await mesurerModeSaisie();info('MESURES MODE SAISIE focus Prix 390x500 '+JSON.stringify(clavier));
      if(!clavier.mode||clavier.tabs&&clavier.tabs.height>0||!clavier.titre||clavier.titre.height>44||!clavier.dock||clavier.dock.height>130||!clavier.prix||clavier.prix.top<clavier.titre.bottom+12||clavier.prix.bottom>clavier.dock.top-12||!clavier.labelPrix||clavier.labelPrix.top<clavier.titre.bottom+12||clavier.labelPrix.bottom>clavier.dock.top-12||!clavier.verdict)throw new Error('mode saisie / champ Prix : '+JSON.stringify(clavier));
      await page.evaluate(()=>{const e=document.querySelector('#champ-promo');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.locator('#champ-prix-hors-promo').focus();await page.waitForTimeout(80);clavier=await mesurerModeSaisie();info('MESURES MODE SAISIE focus Prix hors promo 390x500 '+JSON.stringify(clavier));
      if(!clavier.prixHorsPromo||clavier.prixHorsPromo.top<clavier.titre.bottom+12||clavier.prixHorsPromo.bottom>clavier.dock.top-12||!clavier.labelHorsPromo||clavier.labelHorsPromo.top<clavier.titre.bottom+12||clavier.labelHorsPromo.bottom>clavier.dock.top-12)throw new Error('champ Prix hors promo hors zone : '+JSON.stringify(clavier));
      await page.evaluate(()=>{const e=document.querySelector('#champ-promo');e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.locator('#champ-type').focus();await page.waitForTimeout(80);clavier=await mesurerModeSaisie();info('MESURES MODE SAISIE focus Type 390x500 '+JSON.stringify(clavier));
      if(!clavier.type||clavier.type.top<clavier.titre.bottom+12||clavier.type.bottom>clavier.dock.top-12||!clavier.labelType||clavier.labelType.top<clavier.titre.bottom+12||clavier.labelType.bottom>clavier.dock.top-12)throw new Error('champ Type hors zone en mode saisie : '+JSON.stringify(clavier));
      if(await page.getAttribute('#champ-type','enterkeyhint')!=='next'||await page.getAttribute('#champ-prix','enterkeyhint')!=='next'||await page.getAttribute('#champ-format','enterkeyhint')!=='done')throw new Error('enterkeyhint incorrect');
      await page.locator('#champ-format').focus();await page.waitForTimeout(80);clavier=await mesurerModeSaisie();info('MESURES MODE SAISIE focus Format 390x500 '+JSON.stringify(clavier));
      if(!clavier.format||clavier.format.top<clavier.titre.bottom+12||clavier.format.bottom>clavier.dock.top-12||!clavier.labelFormat||clavier.labelFormat.top<clavier.titre.bottom+12||clavier.labelFormat.bottom>clavier.dock.top-12)throw new Error('champ Format hors zone en mode saisie : '+JSON.stringify(clavier));
      await page.locator('#champ-format').press('Enter');await page.waitForFunction(()=>document.activeElement===document.body,null,{timeout:2000});
      await page.evaluate(()=>window.__forcerModeSaisie?.(false));await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);
      clavier=await mesurerModeSaisie();info('MESURES MODE NORMAL 390x844 '+JSON.stringify(clavier));
      if(clavier.mode||!clavier.tabs||clavier.tabs.height===0||!clavier.dock||clavier.dock.bottom>clavier.tabs.top)throw new Error('régression mode normal 390x844 : '+JSON.stringify(clavier));
      const fondTitre=await page.locator('.topbar').evaluate(e=>getComputedStyle(e).backgroundColor);
      if(fondTitre!=='rgb(11, 13, 18)')throw new Error('fond du titre non opaque : '+fondTitre);
      const rappelsVisibles=await page.locator('#dock-magasin .verdict-rappel, #dock-magasin .verdict-habituel').evaluateAll(es=>es.filter(e=>getComputedStyle(e).display!=='none').length);
      if(!rappelsVisibles)throw new Error('lignes de rappel absentes du dock en mode normal');
      ok('UX 3.1 / story 3.8 mode saisie : Type, Prix et Format visibles, dock compact, onglets masqués');

      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(50);
      ok('3-8 dock fixe : verdict et Enregistrer visibles sans chevauchement à 390x844 et 390x500');const observationsAvantSauvegarde=await page.evaluate(()=>new Promise(res=>{const q=indexedDB.open('appli-courses');q.onsuccess=()=>{const db=q.result;const r=db.transaction('Observation').objectStore('Observation').count();r.onsuccess=()=>{db.close();res(r.result);};};}));
      await page.click('#btn-enregistrer');await page.waitForSelector('#bandeau-annulation',{timeout:3000});await page.waitForFunction(()=>document.activeElement===document.body,null,{timeout:3000});

      await choisirType('Café moulu');if(await page.inputValue('#champ-format')!=='500'||await page.inputValue('#champ-unite')!=='g')throw new Error('pré-remplissage 500 g incorrect');ok('B5 Magasin kg');
      await page.setViewportSize({width:390,height:500});await page.waitForTimeout(80);
      const annulation500=await page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom)};};return {annulation:r('#bandeau-annulation'),dock:r('#dock-magasin'),tabs:r('.tabs')};});
      info('MESURES APRES bandeau Annuler 390x500 '+JSON.stringify(annulation500));
      if(!annulation500.annulation||annulation500.annulation.top<0||annulation500.annulation.bottom>annulation500.dock.top||annulation500.dock.bottom>annulation500.tabs.top)throw new Error('bandeau Annuler masqué à 390x500 : '+JSON.stringify(annulation500));
      await page.click('#bandeau-annulation button');await page.waitForTimeout(100);
      const observationsApresAnnulation=await page.evaluate(()=>new Promise(res=>{const q=indexedDB.open('appli-courses');q.onsuccess=()=>{const db=q.result;const r=db.transaction('Observation').objectStore('Observation').count();r.onsuccess=()=>{db.close();res(r.result);};};}));
      if(observationsApresAnnulation!==observationsAvantSauvegarde)throw new Error('Annuler ne restaure pas les relevés : '+observationsAvantSauvegarde+' -> '+observationsApresAnnulation);
      ok('3-8 bandeau Annuler visible au-dessus du dock à 390x500 et restauration confirmée');
      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
      await aller('#/types');await creer('Lait liquide','l');await page.waitForFunction(()=>/Lait liquide/.test((document.getElementById('liste-types')?.textContent || '')),null,{timeout:5000});await aller('#/magasin');await choisirType('Lait liquide');await verifierUnites(['ml','l']);await page.fill('#champ-prix','2,00');await page.fill('#champ-format','250');await page.selectOption('#champ-unite','ml');await page.waitForFunction(()=>/8,00\s*€\/l/.test(document.querySelector('.prix-normalise')?.textContent||''),null,{timeout:3000});ok('B5 Magasin l');
      await aller('#/types');await creer('Pain unitaire','unit');await page.waitForFunction(()=>/Pain unitaire/.test((document.getElementById('liste-types')?.textContent || '')),null,{timeout:5000});await aller('#/magasin');await choisirType('Pain unitaire');await verifierUnites(['unit']);await page.fill('#champ-prix','1,50');await page.fill('#champ-format','1');await page.evaluate(()=>{const e=document.querySelector('#champ-unite');e.value='';e.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#carte-verdict')?.hidden===true,null,{timeout:2000});const debutVerdictUnitaire=Date.now();await page.selectOption('#champ-unite','unit');await page.waitForSelector('#carte-verdict:not([hidden])',{timeout:2000});if(Date.now()-debutVerdictUnitaire>2000)throw new Error('verdict calculé en plus de 2 secondes');const texteVerdictUnit=await page.locator('#carte-verdict').innerText();if(!/Données insuffisantes|Acheter ici|Attendre|Indifférent/.test(texteVerdictUnit)||/\bundefined\b/.test(texteVerdictUnit))throw new Error('verdict type unitaire avec libellé vide ou undefined : '+texteVerdictUnit);const debutPromo=Date.now();await page.check('#champ-promo');await page.waitForSelector('#dock-magasin .badge-promo',{timeout:2000});if(Date.now()-debutPromo>2000)throw new Error('verdict promo actualisé en plus de 2 secondes');if(!await page.$eval('#champ-prix-hors-promo',e=>!e.closest('.hors-promo-bloc').hidden))throw new Error('champ prix hors promo non affiché sous la ligne Date/Promo');await page.uncheck('#champ-promo');ok('B5 Magasin unit : option « unités », verdict en moins de 2 s et badge Promo');
      await aller('#/types');await creer('Historique kg','kg');await page.waitForFunction(()=>/Historique kg/.test((document.getElementById('liste-types')?.textContent || '')),null,{timeout:5000});const idHistorique=await page.evaluate(()=>new Promise((res,rej)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const q=db.transaction('ProductType').objectStore('ProductType').getAll();q.onsuccess=()=>res(q.result.find(x=>x.nom==='Historique kg')?.id)};rq.onerror=()=>rej(rq.error)}));await aller('#/magasin');await choisirType('Historique kg');await verifierUnites(['g','kg']);await page.fill('#champ-prix','11,00');await page.fill('#champ-format','500');await page.selectOption('#champ-unite','g');await page.fill('input[type="date"]','2026-10-06');await page.check('#champ-promo');await page.click('#btn-enregistrer');await page.waitForTimeout(150);await choisirType('Historique kg');await page.fill('#champ-prix','12,00');await page.fill('#champ-format','500');await page.selectOption('#champ-unite','g');await page.fill('input[type="date"]','2026-10-07');await page.uncheck('#champ-promo');await page.click('#btn-enregistrer');await page.waitForTimeout(150);
      await page.setViewportSize({width:390,height:500});await aller('#/types');await page.click('#liste-types a[href="#/historique/'+idHistorique+'"]');await page.waitForFunction(()=>(document.getElementById('titre-ecran')?.textContent || '')==='Historique',null,{timeout:5000});await page.waitForFunction(()=>document.querySelectorAll('.ligne-releve').length===2,null,{timeout:5000});await verifierEcran('Historique');const h=await page.$$eval('.ligne-releve',rs=>rs.map(r=>({d:r.querySelector('.releve-date')?.textContent,p:!!r.querySelector('.badge-promo')})));if(h[0].d!=='07/10/2026'||h[1].d!=='06/10/2026'||!h[1].p||h[0].p)throw new Error('tri/badge Historique incorrect');
      const verifierDialogue=async(nom,attendus,boutons)=>{const d=page.locator('dialog[open]:visible');if(await d.count()!==1)throw new Error(nom+' : un seul dialogue ouvert attendu (trouvés : '+await d.count()+')');if(!await d.evaluate(e=>e.open&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0))throw new Error(nom+' : dialogue fermé ou sans dimensions');const actions=d.locator('.feuille-actions').last();if(await actions.count())await actions.scrollIntoViewIfNeeded();const texte=await d.innerText();for(const mot of attendus)if(!texte.includes(mot))throw new Error(nom+' : texte absent « '+mot+' »');for(const libelle of boutons){const btn=d.getByRole('button',{name:libelle,exact:true});if(await btn.count()!==1||!await btn.isVisible()||!await btn.isEnabled())throw new Error(nom+' : bouton absent/inactif « '+libelle+' »');const box=await btn.boundingBox();if(!box||box.width<=0||box.height<=0||box.x<0||box.y<0||box.x+box.width>390||box.y+box.height>(page.viewportSize()?.height||844))throw new Error(nom+' : bouton hors écran « '+libelle+' »');}await verifierEcran(nom);};
      const ouvrirActions=async()=>{await page.locator('.ligne-releve').first().locator('button[aria-label="Actions du relevé"]').click();await verifierDialogue('menu actions relevé',['Relevé du','Modifier','Supprimer','Fermer'],['Modifier','Supprimer','Fermer']);};
      await ouvrirActions();await page.click('dialog button:has-text("Modifier")');await verifierDialogue('édition relevé',['Magasin','Prix','Format','Promo','Date','Enregistrer','Annuler'],['Enregistrer','Annuler']);if(await page.locator('dialog input').count()<4||await page.locator('dialog select').count()!==2)throw new Error('édition historique : champs attendus absents');if((await page.locator('dialog select').nth(1).locator('option').evaluateAll(es=>es.some(e=>!e.textContent.trim())))||await page.locator('dialog select').nth(1).locator('option').count()!==2||await page.locator('dialog select').nth(1).inputValue()!=='g')throw new Error('édition historique kg : unité g incorrecte');if(await page.locator('dialog input[type="date"]').count()!==1||await page.locator('dialog input[type="checkbox"]').count()!==1)throw new Error('édition historique : date ou promotion absente');
      await page.click('dialog button:has-text("Annuler")');await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===0,null,{timeout:3000});await ouvrirActions();await page.click('dialog button:has-text("Modifier")');await verifierDialogue('édition avant retour arrière',['Enregistrer','Annuler'],['Enregistrer','Annuler']);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===0,null,{timeout:3000});await ouvrirActions();await page.click('dialog button:has-text("Modifier")');await verifierDialogue('édition avant backdrop',['Enregistrer','Annuler'],['Enregistrer','Annuler']);await page.mouse.click(2,2);await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===0,null,{timeout:3000});ok('B2 modales historique : contenu, dimensions, boutons visibles, annulation, touche retour/Escape et backdrop');
      await ouvrirActions();await page.click('dialog button:has-text("Modifier")');await verifierDialogue('édition relevé kg',['Magasin','Prix','Format','Promo','Date'],['Enregistrer','Annuler']);await page.locator('dialog select').nth(1).evaluate(e=>{e.value='';e.dispatchEvent(new Event('change',{bubbles:true}))});if(!await page.locator('dialog button[type="submit"]').isDisabled())throw new Error('édition historique : Enregistrer actif sans unité');await page.locator('dialog select').nth(1).selectOption('g');await page.locator('dialog input').nth(0).fill('13,00');await page.click('dialog button[type="submit"]');await page.waitForFunction(()=>document.querySelector('.ligne-releve')?.textContent.includes('26,00 €/kg'),null,{timeout:5000});await verifierEcran('Historique après modification kg');ok('B2 Historique modification kg : prix enregistré et affichage €/kg');
      await page.locator('.ligne-releve').last().locator('button[aria-label="Actions du relevé"]').click();await verifierDialogue('menu avant suppression',['Modifier','Supprimer','Fermer'],['Modifier','Supprimer','Fermer']);await page.click('dialog button:has-text("Supprimer")');await verifierDialogue('confirmation suppression relevé',['Supprimer ce relevé ?','Supprimer','Annuler'],['Supprimer','Annuler']);await page.click('dialog button:has-text("Supprimer")');await page.waitForFunction(()=>document.querySelectorAll('.ligne-releve').length===1,null,{timeout:5000});await verifierEcran('Historique après suppression');ok('B2 Historique suppression : confirmation visible puis ligne supprimée');
      // Parcours équivalent pour un type en litres : 250 ml puis affichage et modification au litre.
      await aller('#/magasin');await choisirType('Lait liquide');await page.fill('#champ-prix','2,00');await page.fill('#champ-format','250');await page.selectOption('#champ-unite','ml');await page.fill('input[type="date"]','2026-10-08');await page.click('#btn-enregistrer');await page.waitForTimeout(150);
      const idLaitPourEdition=await page.evaluate(()=>new Promise((res,rej)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const q=rq.result.transaction('ProductType').objectStore('ProductType').getAll();q.onsuccess=()=>res(q.result.find(x=>x.nom==='Lait liquide')?.id);q.onerror=()=>rej(q.error)};rq.onerror=()=>rej(rq.error)}));await aller('#/types');await page.click('#liste-types a[href="#/historique/'+idLaitPourEdition+'"]');await page.waitForFunction(()=>document.querySelectorAll('.ligne-releve').length===1,null,{timeout:5000});if(!(await page.locator('.ligne-releve').first().innerText()).includes('8,00 €/l'))throw new Error('historique type litre : prix/unité €/l incorrect');await page.locator('.ligne-releve').first().locator('button[aria-label="Actions du relevé"]').click();await verifierDialogue('menu actions type litre',['Modifier','Supprimer','Fermer'],['Modifier','Supprimer','Fermer']);await page.click('dialog button:has-text("Modifier")');await verifierDialogue('édition relevé litre',['Magasin','Prix','Format','Promo','Date'],['Enregistrer','Annuler']);if(await page.locator('dialog select').nth(1).inputValue()!=='ml'||await page.locator('dialog select').nth(1).locator('option').count()!==2)throw new Error('édition historique litre : unité ml/options incorrectes');await page.locator('dialog input').nth(0).fill('3,00');await page.click('dialog button[type="submit"]');await page.waitForFunction(()=>document.querySelector('.ligne-releve')?.textContent.includes('12,00 €/l'),null,{timeout:5000});await verifierEcran('Historique après modification litre');ok('B2 Historique type litre : options ml/l, édition et affichage €/l');
      const idPain=await page.evaluate(()=>new Promise((res,rej)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const q=db.transaction('ProductType').objectStore('ProductType').getAll();q.onsuccess=()=>res(q.result.find(x=>x.nom==='Pain unitaire')?.id)};rq.onerror=()=>rej(rq.error)}));await aller('#/historique/'+idPain);await page.waitForFunction(()=>/Aucun relevé/.test((document.getElementById('vue')?.textContent || '')),null,{timeout:5000});await verifierEcran('Historique vide');ok('B2 Historique vide');
      await aller('#/types');await page.click('button[aria-label="Actions pour Lait liquide"]');await page.click('dialog button:has-text("Archiver")');await page.waitForFunction(()=>/Lait liquide/.test((document.getElementById('types-archives')?.textContent || '')),null,{timeout:5000});const idLait=await page.evaluate(()=>new Promise((res,rej)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const q=db.transaction('ProductType').objectStore('ProductType').getAll();q.onsuccess=()=>res(q.result.find(x=>x.nom==='Lait liquide')?.id)};rq.onerror=()=>rej(rq.error)}));await page.click('#types-archives summary');await page.click('#types-archives a[href="#/historique/'+idLait+'"]');await page.waitForFunction(()=>(document.getElementById('titre-ecran')?.textContent || '')==='Historique',null,{timeout:5000});await verifierEcran('Historique archivé');ok('B2 Historique archivé');
      await page.setViewportSize({width:390,height:844});await aller('#/type-edit/'+idCafe);
      await page.waitForFunction(() => document.querySelectorAll('.segment:disabled').length === 3, null, { timeout: 5000 });
      ok('E2 changement d\u2019unité refusé quand des relevés existent');
      await aller('#/types');
      await page.waitForSelector('button[aria-label="Actions pour Café moulu"]');
      await page.click('button[aria-label="Actions pour Café moulu"]');
      await page.click('dialog button:has-text("Supprimer")');
      await page.waitForFunction(() => /définitivement/.test(document.querySelector('dialog')?.textContent || ''), null, { timeout: 5000 });
      await page.click('dialog button:has-text("Supprimer")');
      await page.waitForFunction(() => !/Café moulu/.test((document.getElementById('vue')?.textContent || '')), null, { timeout: 5000 });
      const restants = await page.evaluate(() => new Promise((res) => {
        const rq = indexedDB.open('appli-courses');
        rq.onsuccess = () => { const c = rq.result.transaction('Observation').objectStore('Observation').getAll(); c.onsuccess = () => res(c.result.filter(o => Number(o.type) === Number(window.__idCafe)).length); };
      }));
      if (restants === 0) ok('E2 suppression d\u2019un type et de son historique'); else ko('E2 suppression : ' + restants + ' relevé(s) orphelin(s)');
      await page.click('button[aria-label="Actions pour Lessive liquide"]');
      await page.click('dialog button:has-text("Supprimer")');
      await page.waitForSelector('dialog:has-text("définitive")');
      await page.click('dialog button:has-text("Supprimer")');      await page.waitForFunction(() => !/Lessive liquide/.test((document.getElementById('vue')?.textContent || '')), null, { timeout: 5000 });
      ok('E2 suppression de Lessive liquide : le type supprimé disparaît sans affecter les autres');
      const idFicheE4 = 9991;
      await page.evaluate(id=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction(['ProductType','Observation','Article'],'readwrite');const t=tx.objectStore('ProductType'),s=tx.objectStore('Observation'),a=tx.objectStore('Article');
          t.put({id,nom:'Comparaison E4',nomNormalise:'comparaison e4',unite:'kg',marque:'',nomArticle:'',archive:0});
          s.put({id:9901,type:id,magasin:'leclerc',date:'2026-10-05',prixCentimes:1000,format:1000,promo:0});
          s.put({id:9902,type:id,magasin:'leclerc',date:'2026-10-06',prixCentimes:1200,format:1000,promo:0});
          s.put({id:9903,type:id,magasin:'leclerc',date:'2026-10-07',prixCentimes:1400,format:1000,promo:0});
          s.put({id:9904,type:id,magasin:'intermarche',date:'2026-10-08',prixCentimes:2400,format:1000,promo:0});
          s.put({id:9905,type:id,magasin:'leclerc',date:'2026-10-09',prixCentimes:900,format:1000,promo:1});
          a.put({codeBarres:'9876543210987',type:id,format:500,marque:'Test fiche',nom:'Article lié'});
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        };rq.onerror=()=>reject(rq.error);
      }),idFicheE4);
      await aller('#/magasin'); await aller('#/types');
      await page.waitForSelector('#liste-types');
      await page.waitForSelector('a[href="#/fiche/'+idFicheE4+'"]',{timeout:5000});
      const lienFiche = page.locator('a[href="#/fiche/'+idFicheE4+'"]');
      if (!(await lienFiche.count())) throw new Error('lien Fiche absent dans la liste des types');
      await lienFiche.click();
      await page.waitForFunction(()=>(document.getElementById('titre-ecran')?.textContent||'')==='Fiche du type',null,{timeout:5000});
      await page.waitForSelector('.fiche-type',{timeout:5000});
      const texteFiche = await page.locator('.fiche-type').innerText();
      for (const texte of ['Leclerc','Intermarché','fréquence','biais','Historique des relevés']) if(!texteFiche.toLowerCase().includes(texte.toLowerCase())) throw new Error('fiche type incomplète : '+texte);
      if (!(await page.locator('.barre-comparaison').count()>=2)) throw new Error('barres comparatives à échelle commune absentes');
      const largeursBarres = await page.locator('.fiche-type .barres-comparaison .barre-remplissage').evaluateAll(es=>es.map(e=>e.style.width));
      if (largeursBarres.length!==2 || largeursBarres[0]!=='50%' || largeursBarres[1]!=='100%') throw new Error('barres de fiche non normalisées sur une échelle commune : '+JSON.stringify(largeursBarres));
      await page.waitForFunction(()=>document.querySelectorAll('.fiche-type .historique .ligne-releve').length>=1,null,{timeout:5000});
      if (!(await page.locator('.fiche-type .historique .ligne-releve').count()>=1)) throw new Error('historique non intégré à la fiche');
      await page.setViewportSize({width:390,height:500});
      await verifierEcran('Fiche du type 390x500');
      await page.setViewportSize({width:390,height:844});
      const codesFiche=page.locator('.fiche-type .codes-barres');
       if (!(await codesFiche.count())) throw new Error('section des codes-barres absente de la fiche');
       if (!(await codesFiche.getByText('9876543210987',{exact:true}).count())) throw new Error('code-barres lié au type absent de la fiche');
       await codesFiche.getByRole('button',{name:/supprimer/i}).click();
       await page.waitForFunction(()=>document.querySelector('.fiche-type .codes-barres')?.innerText.includes('Aucun code-barres'),null,{timeout:5000});
       const codeSupprime=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('appli-courses');r.onsuccess=()=>{const q=r.result.transaction('Article').objectStore('Article').get('9876543210987');q.onsuccess=()=>resolve(!q.result);q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}));
       if(!codeSupprime) throw new Error('le code-barres n’a pas été supprimé du catalogue');
       ok('E6.5 fiche type : codes rattachés listés et supprimables');
       ok('E4.2 fiche type : prix habituels, promos, fréquence, biais, barres et historique intégrés');
      await aller('#/types');
      await page.waitForSelector('#liste-types .verdict-liste',{timeout:5000});
      if ((await page.locator('#liste-types .barre-comparaison').count()) < 2) throw new Error('barres comparatives absentes de la liste Types');
      ok('E4.2 liste Types : verdict-liste et barres comparatives visibles');
      await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction(['ProductType','Observation'],'readwrite');const t=tx.objectStore('ProductType'),s=tx.objectStore('Observation');
          t.put({id:9992,nom:'ZZ mensuel test',nomNormalise:'zz mensuel test',unite:'kg',marque:'',nomArticle:'',archive:0});
          t.put({id:9993,nom:'Archive mensuel test',nomNormalise:'archive mensuel test',unite:'kg',marque:'',nomArticle:'',archive:1});
          s.put({id:9921,type:9992,magasin:'leclerc',date:'2026-10-01',prixCentimes:1000,format:1000,promo:0});
          s.put({id:9922,type:9992,magasin:'leclerc',date:'2026-10-02',prixCentimes:1200,format:1000,promo:0});
          s.put({id:9923,type:9992,magasin:'leclerc',date:'2026-10-03',prixCentimes:1400,format:1000,promo:0});
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        };rq.onerror=()=>reject(rq.error);
      }));
      await aller('#/types');
      await page.waitForSelector('a[href="#/releve-mensuel"]',{timeout:5000});
      await page.setViewportSize({width:390,height:500});
      await page.click('a[href="#/releve-mensuel"]');
      await page.waitForFunction(()=>(document.getElementById('titre-ecran')?.textContent||'')==='Relevé mensuel',null,{timeout:5000});
      await page.waitForSelector('.releve-mensuel',{timeout:5000});
      const progressionMensuelle = await page.locator('.progression-mensuelle').innerText();
      const actifCount = await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,q=db.transaction('ProductType').objectStore('ProductType').getAll();q.onsuccess=()=>resolve(q.result.filter(t=>!t.archive).length);q.onerror=()=>reject(q.error)};rq.onerror=()=>reject(rq.error)}));
      const nTotalMensuel = Number(progressionMensuelle.split('/')[1]?.trim());
      if (!/^1\s*\/\s*\d+/.test(progressionMensuelle) || nTotalMensuel!==actifCount) throw new Error('progression mensuelle ou exclusion des types archivés incorrecte : '+progressionMensuelle);
      if (!(await page.locator('button:has-text("Passer")').count()) || !(await page.locator('button:has-text("Suivant")').count())) throw new Error('actions Passer/Suivant absentes');
      await page.locator('#mensuel-prix').focus();
      await page.evaluate(()=>window.__forcerModeSaisie(true));
      await page.waitForFunction(()=>document.body.classList.contains('mode-saisie'),null,{timeout:3000});
      const mesuresMensuel=await page.evaluate(()=>({tabs:getComputedStyle(document.querySelector('.tabs')).display,prix:document.querySelector('#mensuel-prix').getBoundingClientRect().toJSON()}));
      if (mesuresMensuel.tabs!=='none' || mesuresMensuel.prix.top<0 || mesuresMensuel.prix.bottom>500) throw new Error('mode saisie mensuel : onglets visibles ou champ hors écran '+JSON.stringify(mesuresMensuel));
      await page.evaluate(()=>window.__forcerModeSaisie(false));
      await page.setViewportSize({width:390,height:844});
      await page.click('button:has-text("Passer")');
      await page.waitForFunction(()=>/^2\s*\/\s*\d+/.test(document.querySelector('.progression-mensuelle')?.textContent||''),null,{timeout:5000});
      for(let i=2;i<nTotalMensuel;i++){
        await page.click('button:has-text("Passer")');
        await page.waitForFunction((n)=>new RegExp('^'+n+'\\s*\\/').test(document.querySelector('.progression-mensuelle')?.textContent||''),i+1,{timeout:5000});
      }
      if (!(await page.locator('#mensuel-prix').count())) throw new Error('dernière carte mensuelle absente');
      await page.fill('#mensuel-prix','1,00'); await page.fill('#mensuel-format','1'); await page.selectOption('#mensuel-unite','kg');
      await page.waitForFunction(()=>/Acheter ici/.test(document.querySelector('.mini-verdict-mensuel')?.textContent||''),null,{timeout:5000});
      await page.click('button:has-text("Suivant")');
      await page.waitForFunction(()=>/1 saisi/.test(document.querySelector('.carte-mensuelle')?.textContent||''),null,{timeout:5000});
      const achatMensuelEnregistre=await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,q=db.transaction('Observation').objectStore('Observation').getAll();q.onsuccess=()=>resolve(q.result.some(o=>o.type===9992&&o.magasin==='intermarche'&&o.prixCentimes===100&&o.format===1000&&!o.promo));q.onerror=()=>reject(q.error)};rq.onerror=()=>reject(rq.error)}));
      if(!achatMensuelEnregistre)throw new Error('le relevé mensuel validé n’a pas été enregistré');
      await page.click('button:has-text("Quitter")'); await aller('#/types');
      ok('E5.1/E5.2 relevé mensuel : archivés exclus, progression, Passer, mini-verdict partagé, sauvegarde et sortie');

      await aller('#/liste');
      await page.waitForSelector('.liste-avant-courses',{timeout:5000});
      const texteListeCourses=await page.locator('.liste-avant-courses').innerText();
      for(const groupe of ['Leclerc','Intermarché','Indifférent','Données insuffisantes']) if(!texteListeCourses.includes(groupe)) throw new Error('groupe absent de la liste avant courses : '+groupe);
      if(/undefined|>\s*<\/h[23]>/.test(await page.locator('.liste-avant-courses').innerHTML())) throw new Error('libellé vide ou undefined dans la liste avant courses');
      if(await page.locator('.liste-avant-courses').getByText('Archive mensuel test',{exact:true}).count()) throw new Error('type archivé présent dans la liste avant courses');
      await page.setViewportSize({width:390,height:500}); await verifierEcran('Avant les courses 390x500'); await page.setViewportSize({width:390,height:844});
      await aller('#/types');
      ok('E5.3 liste avant courses : quatre groupes, types archivés exclus et affichage mobile');
      await aller('#/magasin');
      await page.waitForSelector('#btn-scanner',{timeout:5000});
      await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('Article','readwrite');tx.objectStore('Article').put({codeBarres:'1234567890123',type:9992,format:500,marque:'Test',nom:'Produit connu'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)};rq.onerror=()=>reject(rq.error);
      }));
      await page.evaluate(()=>{window.__barcodeTestCode='1234567890123';window.__barcodeDetectCalls=0;window.__barcodeTestSequence=[[],[{rawValue:window.__barcodeTestCode}]];window.BarcodeDetector=class{async detect(){window.__barcodeDetectCalls++;return window.__barcodeTestSequence?.shift()??[{rawValue:window.__barcodeTestCode}]}};});
      await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>new MediaStream()});HTMLMediaElement.prototype.play=async function(){return undefined};});
      await page.click('#btn-scanner');
      await page.waitForSelector('dialog.dialog-scan[open]',{timeout:5000});
      await page.waitForFunction(()=>document.querySelector('#champ-type')?.value==='ZZ mensuel test'&&document.querySelector('#champ-format')?.value!=='',null,{timeout:8000});
      if(await page.evaluate(()=>window.__barcodeDetectCalls)<2)throw new Error('E6.1 : le scanner ne réessaie pas après une image sans code');
      ok('E6.1 code connu après une image vide : BarcodeDetector réessaie et remplit type/format hors ligne');
      await page.evaluate(()=>{window.__barcodeTestCode='9999999999999'});
      await page.click('#btn-scanner');
      await page.waitForSelector('dialog.dialog-scan[open]',{timeout:5000});
      await page.waitForSelector('dialog.dialog-rattacher[open]',{timeout:8000});
      if(!await page.locator('dialog.dialog-rattacher').getByText('Rattacher ce code',{exact:true}).count()) throw new Error('feuille de rattachement absente');
       etapeParcours = 'E6.2 recherche du type';
      await page.fill('#scan-type-search','ZZ mensuel test');
      await page.click('button.suggestion-rattacher');
      await page.fill('#scan-format','500'); await page.selectOption('#scan-unite','g');
       etapeParcours = 'E6.2 enregistrement du rattachement';
      await page.click('dialog.dialog-rattacher button:has-text("Rattacher ce code")');
      await page.waitForFunction(()=>document.querySelector('#champ-type')?.value==='ZZ mensuel test',null,{timeout:5000});
      const codeRattache=await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,q=db.transaction('Article').objectStore('Article').get('9999999999999');q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error)};rq.onerror=()=>reject(rq.error)}));
      if(!codeRattache||codeRattache.type!==9992||codeRattache.format!==500) throw new Error('code inconnu non rattaché au type et format choisis');
      ok('E6.2 code inconnu rattaché avec type et format');
      await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>Promise.reject(Object.assign(new Error('refus caméra'),{name:'NotAllowedError'}))})});
      await page.click('#btn-scanner');
      await page.waitForSelector('dialog.dialog-scan[open]',{timeout:5000});
      await page.waitForSelector('#scan-code-manuel',{timeout:5000});
      await page.fill('#scan-code-manuel','1234567890123');
      await page.click('dialog.dialog-scan button:has-text("Rechercher")');
      await page.waitForFunction(()=>document.querySelector('#champ-type')?.value==='ZZ mensuel test',null,{timeout:5000});
      ok('E6.3 caméra refusée : saisie manuelle retrouve le code connu');

      // ---- E6.4 : complément Open Food Facts strictement déclenché par l'utilisateur ----
      etapeParcours = 'E6.4 complément Open Food Facts';
      await ctx.setOffline(true);
      // Le mode offline de Chromium coupe le réseau mais ne met pas toujours navigator.onLine à false ; simuler aussi le signal du navigateur.
      await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
      await page.click('#btn-scanner');
      await page.waitForSelector('dialog.dialog-scan[open]',{timeout:5000});
      info('E6.4 : dialogue scanner ouvert hors ligne');
      await page.fill('#scan-code-manuel','1234567890124');
      if(await page.locator('dialog.dialog-scan button:has-text("Compléter")').isVisible()) throw new Error('E6.4 : bouton Compléter visible hors ligne');
      await page.click('dialog.dialog-scan button:has-text("Fermer")');
      info('E6.4 : bouton Compléter masqué hors ligne');
      await ctx.setOffline(false);
      await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
      const codeOpenFoodFacts = '1234567890124';
      let urlOpenFoodFacts = null;
      await page.route('https://world.openfoodfacts.org/api/v2/product/' + codeOpenFoodFacts + '.json', async route => {
        urlOpenFoodFacts = route.request().url();
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:1,product:{product_name:'Produit test OFF',brands:'Marque test OFF',product_quantity:'500',product_quantity_unit:'g'}})});
      });
      await page.click('#btn-scanner');
      await page.waitForSelector('dialog.dialog-scan[open]',{timeout:5000});
      info('E6.4 : dialogue scanner ouvert en ligne');
      await page.fill('#scan-code-manuel',codeOpenFoodFacts);
      await page.waitForSelector('dialog.dialog-scan button:has-text("Compléter"):visible',{timeout:3000});
      autoriserRequeteOpenFoodFacts = true;
      await page.click('dialog.dialog-scan button:has-text("Compléter")');
      info('E6.4 : action utilisateur Compléter déclenchée');
      await page.waitForSelector('dialog.dialog-rattachement[open]',{timeout:5000});
      info('E6.4 : fiche de rattachement ouverte');
      autoriserRequeteOpenFoodFacts = false;
      if(requetesOpenFoodFacts.length!==1 || !urlOpenFoodFacts) throw new Error('E6.4 : la requête Open Food Facts n’a pas été déclenchée une seule fois par action');
      const urlOff = new URL(urlOpenFoodFacts);
      if(urlOff.pathname!=='/api/v2/product/'+codeOpenFoodFacts+'.json') throw new Error('E6.4 : seule le code-barres doit être envoyé, chemin inattendu '+urlOff.pathname);
      const champsOff = await page.evaluate(()=>({nom:document.querySelector('#scan-nom')?.value,marque:document.querySelector('#scan-marque')?.value,format:document.querySelector('#scan-format')?.value,unite:document.querySelector('#scan-unite')?.value}));
      if(champsOff.nom!=='Produit test OFF'||champsOff.marque!=='Marque test OFF'||champsOff.format!=='500'||champsOff.unite!=='g') throw new Error('E6.4 : les données Open Food Facts ne sont pas proposées dans le rattachement '+JSON.stringify(champsOff));
      await page.click('dialog.dialog-rattachement button:has-text("Annuler")');
      ok('E6.4 complément Open Food Facts : masqué hors ligne, action explicite, code seul et données facultatives proposées');

      // ---- Épic E7 : achat en un geste et quantité par défaut ----
      etapeParcours = 'E7.1 achat en un geste';
      await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Observation','Purchase'],'readwrite'),os=tx.objectStore('Observation'),ps=tx.objectStore('Purchase');const o=os.getAll();o.onsuccess=()=>o.result.filter(x=>x.type===9992&&x.date==='2031-01-01').forEach(x=>os.delete(x.id));const p=ps.getAll();p.onsuccess=()=>p.result.filter(x=>x.type===9992&&x.date==='2031-01-01').forEach(x=>ps.delete(x.id));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);};rq.onerror=()=>reject(rq.error);}));
      await aller('#/magasin');
      await page.waitForFunction(()=>document.querySelector('#titre-ecran')?.textContent==='Magasin'&&document.querySelector('#champ-prix')?.isConnected,null,{timeout:5000});
      await page.waitForTimeout(150);
      if(await page.locator('#champ-type').inputValue()!=='ZZ mensuel test') throw new Error('le type de test n’est plus sélectionné après le scan');
      await page.fill('#champ-prix','6,00');
      if(await page.locator('#champ-prix').inputValue()!=='6,00') throw new Error('champ prix après saisie : '+await page.locator('#champ-prix').inputValue());
      await page.fill('#champ-format','500');
      await page.selectOption('#champ-unite','g');
      if(await page.locator('#champ-prix').inputValue()!=='6,00') throw new Error('champ prix après format/unité : '+await page.locator('#champ-prix').inputValue());
      await page.locator('input[type="date"]').evaluate(e=>{e.value='2031-01-01';e.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForTimeout(100);
      if(await page.locator('#champ-prix').inputValue()!=='6,00') throw new Error('champ prix après changement de date : '+await page.locator('#champ-prix').inputValue());
      await page.waitForSelector('#achat-actions',{timeout:5000});
      if(await page.locator('#quantite-achat').inputValue()!=='1') throw new Error('quantité initiale différente de 1');
      etapeParcours = 'E7.1 stepper quantité';
      await page.click('#btn-achat-plus');
      if(await page.locator('#quantite-achat').inputValue()!=='2') throw new Error('incrément de quantité incorrect');
      etapeParcours = 'E7.2 prix payé différent';
      await page.click('button:has-text("Prix ou format payé différent ?")');
      const dialoguePrixAchat=page.locator('dialog.dialog-prix-achat');
      await dialoguePrixAchat.waitFor({state:'visible',timeout:3000});
      if (!(await dialoguePrixAchat.getByLabel('Prix payé').isVisible()) || !(await dialoguePrixAchat.locator('#format-paye-achat').isVisible())) throw new Error('champs prix payé ou format acheté absents');
      const dimensionsPrixAchat=await dialoguePrixAchat.evaluate(d=>({height:d.getBoundingClientRect().height,text:d.innerText}));
      if(dimensionsPrixAchat.height<=0||!/Confirmer/.test(dimensionsPrixAchat.text)) throw new Error('dialogue prix payé vide ou sans action de confirmation');
      await dialoguePrixAchat.getByLabel('Prix payé').fill('5,00');
      await dialoguePrixAchat.locator('#format-paye-achat').fill('400');
      await dialoguePrixAchat.locator('#unite-achat').selectOption('g');
      await dialoguePrixAchat.getByRole('button',{name:'Confirmer'}).click();
      if(await page.locator('dialog.dialog-prix-achat').count()) throw new Error('dialogue prix payé non fermé après confirmation');
      etapeParcours = 'E7.1 clic J’achète';
      if(await page.locator('#champ-prix').inputValue()!=='6,00') throw new Error('prix en rayon avant achat inattendu: '+await page.locator('#champ-prix').inputValue());
      await page.click('#btn-achat-confirme');
      await page.waitForFunction(()=>/Achat enregistré/.test(document.querySelector('.message-succes')?.textContent||'')||Array.from(document.querySelectorAll('dialog')).some(d=>d.open&&/Prix très différent/.test(d.textContent||'')),null,{timeout:8000});
      const confirmationPrix=page.locator('dialog:visible').filter({hasText:'Prix très différent'});
      if(await confirmationPrix.count()){
        const texteConfirmation=await confirmationPrix.innerText();
        if(!/Confirmer \?/.test(texteConfirmation)||!(await confirmationPrix.getByRole('button',{name:'Confirmer'}).isVisible())) throw new Error('dialogue de prix incohérent incomplet ou invisible');
        await confirmationPrix.getByRole('button',{name:'Confirmer'}).click();
      }
      await page.waitForFunction(()=>/Achat enregistré/.test(document.querySelector('.message-succes')?.textContent||''),null,{timeout:8000});
      const achatE71 = await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');
        rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Purchase','Observation'],'readonly');
          const achats=tx.objectStore('Purchase').getAll(),releves=tx.objectStore('Observation').getAll();
          tx.oncomplete=()=>resolve({achats:achats.result,releves:releves.result});
          tx.onerror=()=>reject(tx.error);
        };
        rq.onerror=()=>reject(rq.error);
      }));
      const achatEnregistre=achatE71.achats.find(x=>x.type===9992&&x.date==='2031-01-01'&&x.quantite===2&&x.achete===1);
      if(!achatEnregistre||!achatE71.releves.some(x=>x.id===achatEnregistre.observation&&x.type===9992&&x.date==='2031-01-01')) throw new Error('achat non enregistré avec son relevé lié');
      if(achatEnregistre.prixPayeCentimes!==500||achatEnregistre.format!==400) throw new Error('prix payé ou format acheté différent non conservé');
      const releveLie=achatE71.releves.find(x=>x.id===achatEnregistre.observation); if(!releveLie||releveLie.prixCentimes!==600||releveLie.format!==500) throw new Error('le relevé en rayon a été écrasé par le prix payé : '+JSON.stringify({achat:achatEnregistre,releve:releveLie,relevesType:achatE71.releves.filter(x=>x.type===9992&&x.date==='2031-01-01')}));
      ok('E7.1 achat enregistré en un geste, quantité 2 et relevé lié');
      // E7.3 : historique des achats par type, avec actions de modification et suppression.
      etapeParcours = 'E7.3 historique achats';
       await page.setViewportSize({width:390,height:500});
      await aller('#/fiche/9992');
      await page.waitForFunction(()=>document.querySelector('#titre-ecran')?.textContent==='Fiche du type',null,{timeout:5000});
      if (!(await page.getByRole('link',{name:'Historique des achats'}).count())) throw new Error('E7.3 : accès à l’historique des achats absent de la fiche type');
      await page.getByRole('link',{name:'Historique des achats'}).click();
      await page.waitForFunction(()=>document.querySelector('#vue')?.textContent.includes('Historique des achats'),null,{timeout:5000});
      const historiqueAchatsE73=page.locator('.historique-achats');
      const texteHistoriqueE73=await historiqueAchatsE73.innerText(); if (!(await historiqueAchatsE73.isVisible()) || !texteHistoriqueE73.includes('01/01/2031')) throw new Error('E7.3 : historique achat absent ou date non formatée en français : '+texteHistoriqueE73);
      if (!(await historiqueAchatsE73.getByText('Leclerc').count()) || !(await historiqueAchatsE73.getByText('2').count()) || !(await historiqueAchatsE73.getByText('5,00 €').count())) throw new Error('E7.3 : magasin, quantité ou prix payé absent');
      if (!(await historiqueAchatsE73.getByRole('button',{name:'Modifier cet achat'}).count()) || !(await historiqueAchatsE73.getByRole('button',{name:'Supprimer cet achat'}).count())) throw new Error('E7.3 : actions de modification/suppression absentes');
      ok('E7.3 historique des achats par type : date, magasin, quantité, prix payé et actions');
      await historiqueAchatsE73.getByRole('button',{name:'Modifier cet achat'}).click();
      const editionAchatE73=page.locator('dialog.dialog-edition-achat');
      await editionAchatE73.waitFor({state:'visible',timeout:3000});
      await editionAchatE73.locator('#achat-prix-edition').fill('4,50');
      await editionAchatE73.locator('#achat-quantite-edition').fill('3');
      await editionAchatE73.locator('#achat-date-edition').fill('2031-01-02');
      await editionAchatE73.getByRole('button',{name:'Enregistrer'}).click();
      await page.waitForFunction(()=>{const r=document.querySelector('.ligne-achat');return r&&r.textContent.includes('4,50')&&r.textContent.includes('Quantité : 3')&&r.textContent.includes('02/01/2031');},null,{timeout:5000});
      ok('E7.3 modification achat : date, quantité et prix payé persistés et affichés');
      await page.locator('.historique-achats').getByRole('button',{name:'Supprimer cet achat'}).click();
      const suppressionAchatE73=page.locator('dialog.dialog-suppression-achat');
      await suppressionAchatE73.waitFor({state:'visible',timeout:3000});
      await suppressionAchatE73.getByRole('button',{name:'Supprimer'}).click();
      await page.waitForFunction(()=>!document.querySelector('.ligne-achat'),null,{timeout:5000});
      if(!/Aucun achat/.test(await page.locator('.historique-achats').innerText())) throw new Error('E7.3 : état vide après suppression absent');
      ok('E7.3 suppression achat : retrait persistant et état vide visible');
       await page.setViewportSize({width:390,height:844});

      // E7 / relecture adverse : remplacer un relevé doit délier l'achat et l'annulation doit restaurer les liens.
      etapeParcours = 'E7 relecture adverse : remplacement et annulation';
      await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Observation','Purchase'],'readwrite');
          tx.objectStore('Observation').put({id:9979,type:9992,magasin:'leclerc',date:'2031-03-02',prixCentimes:600,format:500,promo:0});
          tx.objectStore('Purchase').put({id:9979,type:9992,observation:9979,magasin:'leclerc',date:'2031-03-02',achete:1,quantite:1,prixPayeCentimes:550,format:500,prixComparaisonCentimes:700,prixHabituelMemeMagasinCentimes:650});
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        };rq.onerror=()=>reject(rq.error);
      }));
      const jetonRemplacement=await page.evaluate(async()=>{const dbmod=await import('./db.js');return await dbmod.enregistrerReleves([{type:9992,magasin:'leclerc',date:'2031-03-02',prixCentimes:610,format:500,promo:0}],{remplacements:[true]});});
      const achatDelie=await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('Purchase','readonly'),q=tx.objectStore('Purchase').get(9979);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);};rq.onerror=()=>reject(rq.error);}));
      if(achatDelie.observation!==null)throw new Error('E7 relecture adverse : remplacement du relevé a laissé un lien orphelin : '+JSON.stringify(achatDelie));
      await page.evaluate(async(jeton)=>{const dbmod=await import('./db.js');await dbmod.annulerEnregistrement(jeton);},jetonRemplacement);
      const etatAnnule=await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Observation','Purchase'],'readonly');let obs,achat;tx.objectStore('Observation').get(9979).onsuccess=e=>obs=e.target.result||null;tx.objectStore('Purchase').get(9979).onsuccess=e=>achat=e.target.result||null;tx.oncomplete=()=>resolve({obs,achat});tx.onerror=()=>reject(tx.error);};rq.onerror=()=>reject(rq.error);}));
      if(!etatAnnule.obs||etatAnnule.obs.prixCentimes!==600||!etatAnnule.achat||etatAnnule.achat.observation!==9979)throw new Error('E7 relecture adverse : annulation ne restaure pas le relevé et son lien : '+JSON.stringify(etatAnnule));
      ok('E7 relecture adverse : remplacement délient les achats, annulation restaure relevé et lien');
      await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Observation','Purchase'],'readwrite');tx.objectStore('Observation').delete(9979);tx.objectStore('Purchase').delete(9979);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);};rq.onerror=()=>reject(rq.error);}));
      
      // ---- E7.5 : bilan total, gains promo, exclusions, navigation et état vide ----
      etapeParcours = 'E7.5 écran Bilan';
      await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('Purchase','readwrite'),s=tx.objectStore('Purchase');
          for(const id of [9901,9902,9903,9904])s.delete(id);
          s.put({id:9901,type:9992,observation:9921,magasin:'leclerc',date:'2031-02-01',achete:1,quantite:2,prixPayeCentimes:200,format:500,prixComparaisonCentimes:500,prixHabituelMemeMagasinCentimes:600});
          s.put({id:9902,type:9992,observation:9922,magasin:'intermarche',date:'2031-02-02',achete:1,quantite:1,prixPayeCentimes:1500,format:1000,prixComparaisonCentimes:1000,prixHabituelMemeMagasinCentimes:null});
          s.put({id:9903,type:9992,observation:9923,magasin:'leclerc',date:'2031-02-03',achete:1,quantite:1,prixPayeCentimes:300,format:500,prixComparaisonCentimes:null,prixHabituelMemeMagasinCentimes:500});
          s.put({id:9904,type:9992,observation:9924,magasin:'leclerc',date:'2031-02-04',achete:0,quantite:5,prixPayeCentimes:100,format:1000,prixComparaisonCentimes:500,prixHabituelMemeMagasinCentimes:600});
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        };rq.onerror=()=>reject(rq.error);
      }));
      await aller('#/bilan');
      await page.waitForFunction(()=>document.querySelector('#vue')?.textContent.includes('Économies réalisées'),null,{timeout:5000});
      const bilanE75=page.locator('.bilan-economies');
      if(!(await bilanE75.isVisible()))throw new Error('écran Bilan absent');
      const texteBilanE75=await bilanE75.innerText();
      if(!/[-−]4,00/.test(texteBilanE75)||!/2,00/.test(texteBilanE75))throw new Error('Bilan : total négatif ou gains promo incorrects : '+texteBilanE75);
      if(!/100\s*€ sur 12 mois/.test(texteBilanE75)||!(await bilanE75.locator('.anneau-progression').count()))throw new Error('Bilan : cible annuelle ou anneau de progression absent');
      if(!/1 achat exclu/.test(texteBilanE75))throw new Error('Bilan : nombre d’achats exclus incorrect : '+texteBilanE75);
      const lienTypeBilan=bilanE75.getByRole('link',{name:'ZZ mensuel test'});
      if(!(await lienTypeBilan.count()))throw new Error('Bilan : ligne par type absente');
      await lienTypeBilan.click();
      await page.waitForFunction(()=>document.querySelector('#titre-ecran')?.textContent==='Historique des achats',null,{timeout:5000});
      if(!(await page.locator('.historique-achats').getByText('01/02/2031').count()))throw new Error('Bilan : touche sur le type n’ouvre pas son historique');
      await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('Purchase','readwrite'),s=tx.objectStore('Purchase');for(const id of [9901,9902,9903,9904])s.delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)};rq.onerror=()=>reject(rq.error)}));
      await aller('#/bilan');
      await page.waitForFunction(()=>document.querySelector('.bilan-economies')?.textContent.includes('Aucun achat'),null,{timeout:5000});
      await page.setViewportSize({width:390,height:500});
      await verifierEcran('Bilan E7 390x500');
      const mesuresBilanE7=await page.evaluate(()=>{const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right)}};return {titre:box('#titre-ecran'),contenu:box('.bilan-economies'),onglets:box('.tabs'),largeurDocument:document.documentElement.scrollWidth};});
      if(!mesuresBilanE7.titre||!mesuresBilanE7.contenu||!mesuresBilanE7.onglets||mesuresBilanE7.contenu.height<=0||mesuresBilanE7.onglets.bottom>500||mesuresBilanE7.largeurDocument>390||mesuresBilanE7.titre.bottom>mesuresBilanE7.contenu.y+2)throw new Error('E7 Bilan 390x500 : géométrie incorrecte '+JSON.stringify(mesuresBilanE7));
      ok('E7 Bilan 390x500 : titre/contenu/onglets mesurés '+JSON.stringify(mesuresBilanE7));
      await page.setViewportSize({width:390,height:844});
      ok('E7.5 Bilan : total négatif, cible 100 €, gains promo, exclusions, navigation et état vide');
      // Relecture adverse E7 : supprimer un relevé lié ne doit ni effacer ni laisser pointer l’achat vers rien.
      etapeParcours = 'E7 suppression relevé lié à achat';
      await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Observation','Purchase'],'readwrite');tx.objectStore('Observation').put({id:9931,type:9992,magasin:'leclerc',date:'2031-03-01',prixCentimes:250,format:500,promo:0});tx.objectStore('Purchase').put({id:9932,type:9992,observation:9931,magasin:'leclerc',date:'2031-03-01',achete:1,quantite:1,prixPayeCentimes:250,format:500,prixComparaisonCentimes:300,prixHabituelMemeMagasinCentimes:350});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)};rq.onerror=()=>reject(rq.error)}));
      await page.evaluate(async()=>{const db=await import('/db.js');await db.supprimerReleve(9931);});
      const apresSuppressionLiee=await page.evaluate(()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result,tx=db.transaction(['Observation','Purchase'],'readonly'),obs=tx.objectStore('Observation').get(9931),achat=tx.objectStore('Purchase').get(9932);tx.oncomplete=()=>resolve({observation:obs.result,achat:achat.result});tx.onerror=()=>reject(tx.error)};rq.onerror=()=>reject(rq.error)}));
      if(apresSuppressionLiee.observation)throw new Error('E7 : relevé lié non supprimé');
      if(!apresSuppressionLiee.achat)throw new Error('E7 : la suppression du relevé a supprimé l’achat');
      if(apresSuppressionLiee.achat.observation!==null)throw new Error('E7 : achat conservé mais lien relevé non vidé : '+JSON.stringify(apresSuppressionLiee.achat));
      ok('E7 relecture adverse : suppression relevé conserve l’achat et vide le lien');
      await aller('#/reglages');
      const versionCache = readFileSync(join(racine, 'sw.js'), 'utf8').match(/const CACHE_VERSION = '([^']+)'/)?.[1];
      await aller('#/reglages');await page.waitForFunction((v)=>(document.getElementById('vue')?.textContent || '').includes(v),versionCache,{timeout:5000});await verifierEcran('Réglages');ok('B6 Réglages : version '+versionCache+' visible');
      await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');
        rq.onsuccess=()=>{
          const db=rq.result, tx=db.transaction(['ProductType','Article','Observation','Purchase','Settings'],'readwrite');
          tx.objectStore('ProductType').put({id:9001,nom:'Sauvegarde test',nomNormalise:'sauvegarde test',unite:'kg',marque:'',nomArticle:'',archive:0});
          tx.objectStore('Article').put({codeBarres:'9990001112223',type:9001,marque:'Test',nom:'Produit sauvegarde',format:500});
          tx.objectStore('Observation').put({id:9001,type:9001,magasin:'leclerc',date:'2026-10-01',prixCentimes:250,format:500,promo:1});
          tx.objectStore('Observation').put({id:9002,type:9001,magasin:'intermarche',date:'2026-10-02',prixCentimes:300,format:500,promo:0});
          tx.objectStore('Purchase').put({id:9001,type:9001,observation:9001,magasin:'leclerc',date:'2026-10-01',achete:1,quantite:2,prixPayeCentimes:250,format:500,prixComparaisonCentimes:300,prixHabituelMemeMagasinCentimes:350});
          tx.objectStore('Settings').put({cle:'e8Fixture',valeur:'conserver'});
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        };
        rq.onerror=()=>reject(rq.error);
      }));
      const snapshotAvantExport = await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction(['ProductType','Article','Observation','Purchase','Settings'],'readonly');const noms=['ProductType','Article','Observation','Purchase','Settings'];Promise.all(noms.map(n=>new Promise((res,rej)=>{const q=tx.objectStore(n).getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}))).then(v=>resolve({types:v[0],articles:v[1],releves:v[2],achats:v[3],reglages:v[4]}),reject)};rq.onerror=()=>reject(rq.error);
      }));
      const [telechargement] = await Promise.all([page.waitForEvent('download'),page.click('button:has-text("Exporter une sauvegarde")')]);
      const cheminSauvegarde = await telechargement.path();
      if (!cheminSauvegarde) throw new Error('fichier de sauvegarde non disponible');
      const sauvegardeJson = JSON.parse(readFileSync(cheminSauvegarde,'utf8'));
      if (sauvegardeJson.schemaVersion !== 1 || !['types','articles','releves','achats','reglages'].every(k=>Array.isArray(sauvegardeJson[k]))) throw new Error('structure de sauvegarde incorrecte');
      ok('E8.1 export JSON téléchargé et collections présentes');
      for (const cle of ['types','articles','releves','achats','reglages']) {
        if (JSON.stringify(sauvegardeJson[cle])!==JSON.stringify(snapshotAvantExport[cle])) throw new Error('aller-retour export différent pour '+cle);
      }
      if (!sauvegardeJson.releves.some(o=>o.promo===1) || !sauvegardeJson.releves.some(o=>o.promo===0) || !sauvegardeJson.achats.some(a=>a.id===9001) || !sauvegardeJson.articles.some(a=>a.codeBarres==='9990001112223') || !sauvegardeJson.reglages.some(r=>r.cle==='e8Fixture')) throw new Error('export incomplet : promo/hors promo, achat, code-barres ou réglage absent');
      ok('E8.1 aller-retour complet : types, relevés promo/hors promo, achats, codes-barres et réglages');
      const avantImport = await page.evaluate(() => new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction(['ProductType','Observation','Purchase','Article','Settings'],'readonly');const r=Promise.all(['ProductType','Observation','Purchase','Article','Settings'].map(n=>new Promise((res,rej)=>{const q=tx.objectStore(n).count();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})));r.then(resolve,reject);};rq.onerror=()=>reject(rq.error)}));
      if (!await page.locator('button:has-text("Importer une sauvegarde")').count()) throw new Error('bouton import absent');
      await page.locator('#fichier-sauvegarde').setInputFiles({name:'invalide.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":99}')});
      await page.waitForFunction(()=>/invalide|inconnue|incompatible/i.test(document.querySelector('.message-sauvegarde')?.textContent||''),null,{timeout:5000});
      const apresImportInvalide = await page.evaluate(() => new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction(['ProductType','Observation','Purchase','Article','Settings'],'readonly');Promise.all(['ProductType','Observation','Purchase','Article','Settings'].map(n=>new Promise((res,rej)=>{const q=tx.objectStore(n).count();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}))).then(resolve,reject)};rq.onerror=()=>reject(rq.error)}));
      if (JSON.stringify(avantImport)!==JSON.stringify(apresImportInvalide)) throw new Error('le fichier invalide a modifié les données');
      ok('E8.2 import invalide refusé sans modifier la base');
      await page.setViewportSize({width:390,height:500});
       await page.locator('#fichier-sauvegarde').setInputFiles(cheminSauvegarde);
      await page.waitForSelector('dialog:has-text("Remplace toutes les données actuelles")',{timeout:5000});
       await page.locator('dialog[open] .feuille-actions').last().scrollIntoViewIfNeeded();
       await verifierDialogue('confirmation import 390x500',['Remplace toutes les données actuelles'],['Remplacer toutes les données','Annuler']);
      await page.click('dialog button:has-text("Remplacer toutes les données")');
      await page.waitForFunction(()=>/restaurée|importée/i.test(document.querySelector('.message-sauvegarde')?.textContent||''),null,{timeout:5000});
      ok('E8.2 import valide confirmé et terminé');
      const snapshotApresImport = await page.evaluate(()=>new Promise((resolve,reject)=>{
        const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction(['ProductType','Article','Observation','Purchase','Settings'],'readonly');const noms=['ProductType','Article','Observation','Purchase','Settings'];Promise.all(noms.map(n=>new Promise((res,rej)=>{const q=tx.objectStore(n).getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}))).then(v=>resolve({types:v[0],articles:v[1],releves:v[2],achats:v[3],reglages:v[4]}),reject)};rq.onerror=()=>reject(rq.error);
      }));
      for (const cle of ['types','articles','releves','achats','reglages']) if(JSON.stringify(snapshotApresImport[cle])!==JSON.stringify(snapshotAvantExport[cle])) throw new Error('import différent des données exportées pour '+cle);
      ok('E8.2 import restaure intégralement les cinq collections');
       await page.setViewportSize({width:390,height:844});
      const dateRetard = new Date(Date.now()-31*86400000).toISOString().slice(0,10);
      await page.evaluate(date=>new Promise((resolve,reject)=>{const rq=indexedDB.open('appli-courses');rq.onsuccess=()=>{const db=rq.result;const tx=db.transaction('Settings','readwrite');tx.objectStore('Settings').put({cle:'dernierExport',valeur:date});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)};rq.onerror=()=>reject(rq.error)}),dateRetard);
      await aller('#/magasin');
      await page.waitForSelector('.bandeau-rappel-export',{timeout:5000});
      ok('E8.3 rappel de sauvegarde affiché après plus de 30 jours');
      await page.click('.bandeau-rappel-export button:has-text("Fermer")');
      if (await page.locator('.bandeau-rappel-export').count()) throw new Error('rappel non fermé');
      await aller('#/reglages'); await aller('#/magasin');
      if (await page.locator('.bandeau-rappel-export').count()) throw new Error('rappel réapparu pendant la même session');
      await page.reload(); await page.waitForSelector('.bandeau-rappel-export',{timeout:5000});
      ok('E8.3 rappel fermé réapparaît au lancement suivant');
      await aller('#/reglages');
      await page.waitForSelector('#seuil-indifference',{timeout:5000});
      await page.locator('#seuil-indifference').evaluate(el=>{el.value='8';el.dispatchEvent(new Event('change',{bubbles:true}))});
      await page.waitForFunction(()=>/8\s*%/.test(document.querySelector('#libelle-seuil-indifference')?.textContent||''),null,{timeout:5000});
      await aller('#/magasin'); await aller('#/reglages'); await page.waitForSelector('#seuil-indifference',{timeout:5000});
      if (await page.locator('#seuil-indifference').inputValue()!=='8') throw new Error('seuil non mémorisé');
      if (await page.locator('button:has-text("Installer l’appli")').count()) throw new Error('bouton installation visible sans événement');
      await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e)});
      await page.waitForSelector('button:has-text("Installer l’appli")',{timeout:5000});
      await page.click('button:has-text("Installer l’appli")');
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Installer l’appli'),null,{timeout:5000});
      ok('E8.4 seuil mémorisé avec exemple et installation conditionnée à l’événement');
      // E8.3 : simuler un refus du stockage persistant avant le prochain démarrage.
      await page.addInitScript(() => { if (navigator.storage) Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => false }); });
      await page.reload();
      await page.waitForSelector('.avertissement-stockage', { timeout: 5000 });
      const avertissementStockage = await page.locator('.avertissement-stockage').innerText();
      if (!/Exportez régulièrement une sauvegarde/.test(avertissementStockage)) throw new Error('avertissement de refus du stockage persistant incomplet');
      ok('E8.3 refus du stockage persistant : avertissement visible dans Réglages');
      // Relecture adverse : chaque écran principal est ouvert aux deux hauteurs mobiles.
       // Le cache doit contrôler la page avant de couper le réseau pour les parcours de navigation.
       await page.evaluate(() => navigator.serviceWorker.ready);
       if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForSelector('#vue .carte', { timeout: 10000 }); }
       if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error('service worker absent avant le parcours hors ligne');
       await ctx.setOffline(true);
       const routesViewport=[
         ['#/magasin','Magasin'],['#/types','Types'],['#/liste','Liste'],['#/bilan','Bilan'],
         ['#/reglages','Réglages'],['#/releve-mensuel','Relevé mensuel'],['#/type-nouveau','Nouveau type'],
         ['#/type-edit/'+idCafe,'Modifier le type'],['#/fiche/'+idCafe,'Fiche du type'],
         ['#/historique/'+idCafe,'Historique'],['#/achats/'+idCafe,'Historique des achats']
       ];
       for(const hauteur of [844,500]){
         await page.setViewportSize({width:390,height:hauteur});
         for(const [route,titreAttendu] of routesViewport){
           await aller(route);await verifierEcran(titreAttendu+' '+hauteur);await verifierOptionsNonVides(titreAttendu+' '+hauteur);
           const geometrie=await page.evaluate(h=>{const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),height:Math.round(b.height)}};return {titre:r(document.getElementById('titre-ecran')),vue:r(document.getElementById('vue')),tabs:r(document.querySelector('.tabs')),dock:r(document.getElementById('dock-magasin')),h}},hauteur);
           if(!geometrie.titre||!geometrie.vue||geometrie.titre.height<=0||geometrie.vue.height<=0)throw new Error(titreAttendu+' '+hauteur+' : titre ou contenu sans dimensions '+JSON.stringify(geometrie));
           if(geometrie.tabs&&(geometrie.tabs.top<0||geometrie.tabs.bottom>hauteur||geometrie.titre.bottom>geometrie.tabs.top))throw new Error(titreAttendu+' '+hauteur+' : titre/onglets hors écran ou chevauchés '+JSON.stringify(geometrie));
           if(geometrie.dock&&geometrie.tabs&&geometrie.dock.bottom>geometrie.tabs.top)throw new Error(titreAttendu+' '+hauteur+' : dock chevauche les onglets '+JSON.stringify(geometrie));
         }
       }
       // Les deux dialogues de scan sont également contrôlés à 390x500.
       await page.setViewportSize({width:390,height:500});await aller('#/magasin');await page.click('#btn-scanner');
       await page.locator('dialog.dialog-scan .feuille-actions').scrollIntoViewIfNeeded();
       await verifierDialogue('scanner 390x500',['Scanner un code-barres','Code-barres'],['Rechercher','Fermer']);
       await page.fill('#scan-code-manuel','9876543210987');await page.click('dialog button:has-text("Rechercher")');
       await page.waitForSelector('dialog.dialog-rattachement:visible',{timeout:5000});
       await page.locator('dialog.dialog-rattachement .feuille-actions').scrollIntoViewIfNeeded();
       await verifierDialogue('rattachement code 390x500',['Rattacher ce code','Type de produit','Format'],['Rattacher ce code','Annuler']);
       await page.click('dialog button:has-text("Annuler")');await page.setViewportSize({width:390,height:844});await aller('#/magasin');
       ok('relecture adverse : 11 écrans aux viewports 390x844 et 390x500, scanner et rattachement à 390x500');
       
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
     } catch (e) { ko('parcours de l\u2019appli ['+etapeParcours+'] : ' + String(e.message).split('\n')[0]); }
    if (erreurs.length) ko('erreurs dans la page : ' + erreurs.slice(0, 3).join(' | '));
    else ok('aucune erreur dans la console de la page');
    if (requetesExternes.length) ko('appels réseau externes détectés : '+requetesExternes.slice(0,5).join(', ')); else ok('aucun appel réseau externe pendant le parcours IHM');
    await ctx.close();
  } finally { await navigateur.close(); }
}
serveur.close();

// ---- Compte rendu --------------------------------------------------------------------------
const titre = echecs ? 'ÉCHEC : ' + echecs + ' contrôle(s) en échec' : 'SUCCÈS : tous les contrôles passent';
const rapport = [titre, '', ...lignes].join('\n');
console.log(rapport);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Résultat de la vérification\n\n```text\n' + rapport + '\n```\n');
process.exit(echecs ? 1 : 0);
