// Active le mode strict de JavaScript.
"use strict";

// Importe le module de système de fichiers.
const fs = require("fs");
// Importe le module de gestion des chemins.
const path = require("path");
// Importe la bibliothèque de création d'archives ZIP.
const AdmZip = require("adm-zip");
// Importe le module de gestion des images distantes.
const images = require("./images");

/**
 * Export CBZ : télécharge les pages d'un chapitre et les regroupe en archive
 * (zip) compatible avec les lecteurs de mangas (Tachiyomi, Mihon…).
 */

// User-Agent utilisé pour télécharger les images.
const UA = "OptiManga/2.0 (lecteur auto-hébergé; node-fetch)";

/** Exécute fn sur une liste avec une borne de concurrence. */
// Exécute fn sur chaque élément avec une limite de tâches simultanées.
async function mapPool(items, concurrency, fn) {
  // Tableau de résultats conservant l'ordre des éléments.
  const out = new Array(items.length);
  // Curseur partagé indiquant le prochain élément à traiter.
  let cursor = 0;
  // Fonction worker qui consomme les éléments jusqu'à épuisement.
  async function worker() {
    // Tant qu'il reste des éléments à traiter.
    while (cursor < items.length) {
      // Réserve le prochain index de façon atomique.
      const i = cursor++;
      // Traite l'élément et stocke le résultat à sa position.
      out[i] = await fn(items[i], i);
    // Fermeture de la boucle while.
    }
  // Fermeture de la fonction worker.
  }
  // Démarre autant de workers que la concurrence autorisée.
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  // Retourne les résultats dans l'ordre initial.
  return out;
// Fermeture de la fonction mapPool.
}

// Télécharge une image (avec proxy/déchiffrement si nécessaire).
async function fetchImage(url, { timeout = 30000 } = {}) {
  // Résout l'URL réelle à requêter.
  const target = images.resolve(url);
  // Choisit les en-têtes selon que le proxy est requis ou non.
  const headers = images.needsProxy(target) ? images.headersFor(url) : { "User-Agent": UA };
  // Contrôleur permettant d'annuler la requête.
  const ctrl = new AbortController();
  // Minuteur déclenchant l'annulation au bout du délai.
  const timer = setTimeout(() => ctrl.abort(), timeout);
  // Bloc principal de la requête.
  try {
    // Lance la requête HTTP vers l'image.
    const res = await fetch(target, {
      // Signal d'annulation lié au minuteur.
      signal: ctrl.signal,
      // En-têtes calculés plus haut.
      headers,
    // Fermeture de l'objet options du fetch.
    });
    // Échoue si la réponse n'est pas OK.
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    // Lit les octets, les déchiffre si nécessaire et les retourne.
    return images.decodePage(Buffer.from(await res.arrayBuffer()), images.kOf(url));
  // Bloc exécuté dans tous les cas.
  } finally {
    // Annule le minuteur pour éviter une fuite.
    clearTimeout(timer);
  // Fermeture du bloc finally.
  }
// Fermeture de la fonction fetchImage.
}

// Déduit l'extension de fichier image depuis son URL.
function imageExt(url) {
  // Résout l'URL réelle pour analyser son extension.
  const target = images.resolve(url);
  // Cherche l'extension parmi les formats connus.
  const m = /\.(jpe?g|png|webp|gif|avif)(?:\?|%|$)/i.exec(target || "");
  // Retourne l'extension normalisée, ou "jpg" par défaut.
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
// Fermeture de la fonction imageExt.
}

/**
 * Télécharge les pages d'un chapitre dans un dossier temporaire.
 * @returns {Promise<{dir: string, files: string[]}>}
 */
// Télécharge les pages d'un chapitre dans un dossier.
async function downloadChapter(chapter, chapterDir, { concurrency = 5 } = {}) {
  // Délègue l'écriture des pages et récupère le dossier et les fichiers.
  const dirs = await _writeChapter(chapterDir, chapter);
  // Retourne le résultat.
  return dirs;
// Fermeture de la fonction downloadChapter.
}

// Écrit réellement les pages du chapitre dans un dossier structuré.
async function _writeChapter(chapterDir, chapter) {
  // Nom du dossier de volume (ou volume-1 par défaut).
  const volume = chapter.volume ? `volume-${chapter.volume}` : "volume-1";
  // Étiquette du chapitre (numéro ou ordre).
  const chapterLabel = chapter.chapterNum ? `chapitre-${chapter.chapterNum}` : `chapitre-${chapter.order || 1}`;
  // Chemin cible du dossier du chapitre.
  const target = path.join(chapterDir, volume, chapterLabel);
  // Crée le dossier cible (et ses parents) s'il n'existe pas.
  fs.mkdirSync(target, { recursive: true });
  // Récupère la liste des URLs des pages.
  const urls = chapter.pages;
  // Télécharge les pages en parallèle (5 à la fois).
  const files = await mapPool(urls, 5, async (url, i) => {
    // Télécharge le contenu binaire de la page.
    const buf = await fetchImage(url);
    // Construit un nom de fichier numéroté sur 3 chiffres.
    const filename = `${String(i + 1).padStart(3, "0")}.${imageExt(url)}`;
    // Chemin complet du fichier à écrire.
    const filePath = path.join(target, filename);
    // Écrit le fichier image sur le disque.
    fs.writeFileSync(filePath, buf);
    // Retourne le nom du fichier créé.
    return filename;
  // Fermeture de la fonction de traitement de chaque page.
  });
  // Retourne le dossier et les fichiers créés.
  return { dir: target, files };
// Fermeture de la fonction _writeChapter.
}

/** Construit une archive CBZ (Buffer) depuis un dossier. */
// Crée une archive ZIP (CBZ) à partir d'un dossier.
function buildCbz(dir) {
  // Instancie une nouvelle archive ZIP.
  const zip = new AdmZip();
  // Ajoute récursivement le contenu du dossier.
  zip.addLocalFolder(dir);
  // Retourne l'archive sous forme de Buffer.
  return zip.toBuffer();
// Fermeture de la fonction buildCbz.
}

// Exporte les fonctions utilitaires du module.
module.exports = { downloadChapter, buildCbz, mapPool };
