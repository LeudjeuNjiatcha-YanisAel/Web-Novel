// Active le mode strict de JavaScript.
"use strict";

// Importe le framework Express.
const express = require("express");
// Importe le module système de fichiers.
const fs = require("fs");
// Importe le module de gestion des chemins.
const path = require("path");

// Importe le registre des extensions/sources.
const registry = require("../extension/registry");
// Importe les fonctions de téléchargement et de création CBZ.
const { downloadChapter, buildCbz } = require("../extension/cbz");
// Importe l'utilitaire de proxy d'images.
const images = require("../extension/images");
// Importe les utilitaires slugify et httpError.
const { slugify, httpError } = require("../extension/utils");
// Importe la base de données légère.
const db = require("../data/db");
// Importe le cache applicatif.
const cache = require("./cache");
// Importe la gestion des tâches asynchrones.
const jobs = require("./jobs");

// Crée le routeur Express de ce module.
const router = express.Router();

// Définit la racine du projet.
const ROOT = path.join(__dirname, "..");
// Détermine le dossier des téléchargements (CBZ).
const DOWNLOADS_DIR = process.env.OPTIMANGA_DOWNLOADS_DIR || process.env.NOVELHUB_DOWNLOADS_DIR || path.join(ROOT, "downloads");
// Liste des clés d'état utilisateur autorisées.
const STATE_KEYS = ["favorites", "history", "progress"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Déclare la fonction qui garantit l'existence du dossier de téléchargements.
function ensureDownloadsDir() {
  // Crée le dossier s'il n'existe pas déjà.
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
// Ferme la fonction.
}

// Déclare la fonction de recherche sur une source, avec cache.
async function searchSource(source, query, options) {
  // Construit la clé de cache unique de la recherche.
  const key = `s:${source.id}:${query}:${options.genre}:${options.status}:${options.sort}:${options.limit}:${options.offset}`;
  // Met en cache la recherche pendant 60 secondes.
  return cache.wrap(key, 60_000, () => source.search(query, options));
// Ferme la fonction.
}

// Déclare la fonction de récupération des infos manga, avec cache.
async function mangaInfo(source, mangaId) {
  // Met en cache les infos manga pendant 5 minutes.
  return cache.wrap(`i:${source.id}:${mangaId}`, 300_000, () => source.getMangaInfo(mangaId));
// Ferme la fonction.
}

// Déclare la fonction de récupération des pages d'un chapitre, avec cache.
async function chapterPages(source, mangaId, chapterId) {
  // Met en cache les pages du chapitre pendant 15 minutes.
  return cache.wrap(`c:${source.id}:${mangaId}:${chapterId}`, 900_000, () =>
    // Récupère les pages auprès de la source.
    source.getChapterPages(mangaId, chapterId)
  // Ferme l'appel de fonction ouvert.
  );
// Ferme la fonction.
}

/** Uniformise le retour d'un search : { results, total }. */
// Déclare la fonction qui uniformise le retour d'une recherche.
function normalizeSearch(out, fallbackTotal) {
  // Uniformise les résultats en un tableau.
  const results = Array.isArray(out) ? out : out && Array.isArray(out.results) ? out.results : [];
  // Uniformise la valeur totale de résultats.
  const total = out && Number.isFinite(out.total) ? Number(out.total) : fallbackTotal;
  // Renvoie un couple résultats/total uniformisé.
  return { results, total };
// Ferme la fonction.
}

// Déclare la fonction qui récupère tous les mangas de toutes les sources.
async function allMangas() {
  // Met en cache la liste complète des mangas pendant 60 secondes.
  return cache.wrap("all:mangas", 60_000, async () => {
    // Lance les recherches de toutes les sources en parallèle.
    const perSource = await Promise.all(
      // Ouvre un nouveau bloc de code.
      registry.enabled().map(async (s) => {
        // Interroge la source sans filtre (catalogue complet).
        const out = await s.search("", {});
        // Normalise et annote chaque résultat avec l'identifiant de sa source.
        return normalizeSearch(out, 0).results.map((n) => ({ ...n, sourceId: s.id }));
      // Ferme la fonction fléchée (callback) et l'appel associé.
      })
    // Ferme l'appel de fonction ouvert.
    );
    // Aplatit les listes de résultats de toutes les sources.
    return perSource.flat();
  // Ferme la fonction fléchée (callback) et l'appel associé.
  });
// Ferme la fonction.
}

// ---------------------------------------------------------------------------
// Proxy d'images (CDN exigeant un Referer émis par leur domaine)
// ---------------------------------------------------------------------------

// En-tête de cache des images proxifiées (1 semaine).
const IMAGE_CACHE_CONTROL = "public, max-age=604800, immutable";
// Nombre maximum de téléchargements d'images simultanés.
const IMAGE_MAX_CONCURRENT = 12;
// Nombre maximum d'entrées dans le cache d'images.
const IMAGE_MAX_ENTRIES = 120;
// Taille maximale totale du cache d'images (64 Mo).
const IMAGE_MAX_BYTES = 64 * 1024 * 1024;
// Taille maximale d'une image proxifiée (15 Mo).
const IMAGE_MAX_SIZE = 15 * 1024 * 1024;

// Cache mémoire des images (clé : URL).
const imageCache = new Map(); // url -> { buf, type, bytes }
// Compteur d'octets actuellement en cache.
let imageCacheBytes = 0;
// Compteur de téléchargements d'images en cours.
let imageActive = 0;
// File d'attente des requêtes d'images en attente.
const imageWaiters = [];

// Déclare la fonction qui insère une image dans le cache.
function imageCachePut(url, entry) {
  // Ignore la mise en cache d'une image trop grande.
  if (entry.bytes > IMAGE_MAX_BYTES) return;
  // Retire l'ancienne position de l'image dans le cache.
  imageCache.delete(url);
  // Insère la nouvelle image dans le cache.
  imageCache.set(url, entry);
  // Ajoute la taille de l'image au compteur du cache.
  imageCacheBytes += entry.bytes;
  // Évince les entrées jusqu'à respecter les limites.
  while (imageCache.size > IMAGE_MAX_ENTRIES || imageCacheBytes > IMAGE_MAX_BYTES) {
    // Récupère la plus ancienne entrée du cache pour l'évincer.
    const oldest = imageCache.keys().next().value;
    // Retire la taille de l'entrée évincée du compteur.
    imageCacheBytes -= imageCache.get(oldest).bytes;
    // Supprime l'entrée évincée du cache.
    imageCache.delete(oldest);
  // Ferme la boucle while.
  }
// Ferme la fonction.
}

// Déclare la fonction qui réserve un emplacement de téléchargement d'image.
function acquireImageSlot() {
  // Vérifie qu'un emplacement d'image est disponible.
  if (imageActive < IMAGE_MAX_CONCURRENT) {
    // Réserve un emplacement d'image.
    imageActive++;
    // Autorise immédiatement la poursuite.
    return Promise.resolve();
  // Ferme le bloc conditionnel if.
  }
  // Met la requête en file d'attente.
  return new Promise((resolve) => imageWaiters.push(resolve));
// Ferme la fonction.
}

// Déclare la fonction qui libère un emplacement de téléchargement d'image.
function releaseImageSlot() {
  // Retire le premier emplacement en attente.
  const next = imageWaiters.shift();
  // Réveille la prochaine requête d'image en attente.
  if (next) next();
  // Sinon décrémente le compteur d'images actives.
  else imageActive--;
// Ferme la fonction.
}

// Définit la route GET /image qui proxifie les images.
router.get("/image", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Résout l'URL de l'image demandée.
    const url = images.resolve(String(req.query.url || ""));
    // Refuse une URL d'image non autorisée.
    if (!images.isProxiable(url)) throw httpError(400, "URL d'image non autorisée");

    // Cherche l'image dans le cache.
    const hit = imageCache.get(url);
    // Ouvre un nouveau bloc de code.
    if (hit) {
      // Retire l'ancienne position de l'image dans le cache.
      imageCache.delete(url);
      // Replace l'image en tête du cache (ordre d'utilisation).
      imageCache.set(url, hit);
      // Renseigne les en-têtes puis renvoie l'image mise en cache.
      res.set("Content-Type", hit.type).set("Cache-Control", IMAGE_CACHE_CONTROL).send(hit.buf);
      // Termine la requête (la réponse a déjà été envoyée).
      return;
    // Ferme le bloc conditionnel if.
    }

    // Attend un emplacement de téléchargement d'image.
    await acquireImageSlot();
    // Ouvre un nouveau bloc de code.
    try {
      // Crée un contrôleur d'annulation pour la requête amont.
      const ctrl = new AbortController();
      // Programme l'abandon de la requête après 20 secondes.
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      // Variable destinée à la réponse HTTP amont.
      let upstream;
      // Ouvre un nouveau bloc de code.
      try {
        // Télécharge l'image depuis l'URL amont.
        upstream = await fetch(url, { signal: ctrl.signal, headers: images.headersFor(req.originalUrl || url) });
      // Ferme le bloc try puis ouvre le bloc finally.
      } finally {
        // Annule le minuteur d'abandon.
        clearTimeout(timer);
      // Ferme le bloc finally.
      }
      // Vérifie que la réponse amont est valide.
      if (!upstream.ok) throw httpError(502, `Image indisponible (${upstream.status})`);

      // Décode ou retraite l'image reçue.
      const buf = images.decodePage(Buffer.from(await upstream.arrayBuffer()), images.kOf(req.originalUrl || ""));
      // Rejette une image trop volumineuse.
      if (buf.length > IMAGE_MAX_SIZE) throw httpError(502, "Image trop volumineuse");
      // Détermine le type MIME de l'image.
      const type = (upstream.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      // Place l'image téléchargée dans le cache.
      imageCachePut(url, { buf, type, bytes: buf.length });
      // Renseigne les en-têtes puis renvoie l'image.
      res.set("Content-Type", type).set("Cache-Control", IMAGE_CACHE_CONTROL).send(buf);
    // Ferme le bloc try puis ouvre le bloc finally.
    } finally {
      // Libère l'emplacement d'image utilisé.
      releaseImageSlot();
    // Ferme le bloc finally.
    }
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// Santé / statistiques
// ---------------------------------------------------------------------------

// Définit la route GET /health de contrôle de santé.
router.get("/health", (req, res) => {
  // Renvoie l'état de santé du serveur.
  res.json({ ok: true, uptime: process.uptime(), time: new Date().toISOString() });
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route GET /stats des statistiques.
router.get("/stats", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Récupère tous les mangas (avec cache).
    const mangas = await allMangas();
    // Calcule le nombre total de chapitres.
    const chapters = mangas.reduce((sum, n) => sum + (n.chapterCount || 0), 0);
    // Récupère les données de progression.
    const progress = db.get("progress") || {};
    // Compteur du nombre de chapitres lus.
    let readChapters = 0;
    // Parcourt chaque entrée de progression.
    for (const entry of Object.values(progress)) {
      // Additionne les chapitres lus.
      readChapters += (entry.read || []).length;
    // Ferme la boucle for.
    }
    // Compte les favoris.
    const favorites = (db.get("favorites") || []).length;
    // Compte les entrées de la bibliothèque.
    const library = (db.get("library") || []).length;
    // Renvoie un objet JSON en réponse.
    res.json({
      // Nombre de sources activées.
      sources: registry.enabled().length,
      // Nombre total de mangas.
      mangas: mangas.length,
      // Nombre total de chapitres.
      chapters,
      // Nombre de favoris.
      favorites,
      // Nombre d'entrées de bibliothèque.
      library,
      // Nombre de chapitres lus.
      readChapters,
      // Nombre de téléchargements effectués.
      downloads: db.get("stats").downloads || 0,
    // Ferme le bloc (callback) et l'appel associé.
    });
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// Extensions (découverte automatique : scan de extension/sources/*.js)
// ---------------------------------------------------------------------------

// Définit la route GET /extensions listant les extensions.
router.get("/extensions", (req, res) => {
  // Renvoie la liste des extensions installées.
  res.json({ installed: registry.list() });
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route PATCH /extensions/:id pour activer/désactiver une extension.
router.patch("/extensions/:id", (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Extrait le drapeau enabled du corps.
    const { enabled } = req.body || {};
    // Valide que enabled est un booléen.
    if (typeof enabled !== "boolean") throw httpError(400, "Champ « enabled » attendu (booléen)");
    // Active ou désactive l'extension demandée.
    const ext = registry.setEnabled(req.params.id, enabled);
    // Vide le cache applicatif.
    cache.clear();
    // Renvoie l'extension mise à jour.
    res.json(ext);
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route GET /genres listant les genres.
router.get("/genres", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Renvoie les genres disponibles.
    res.json(await registry.genres());
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// Recherche / catalogue
// ---------------------------------------------------------------------------

// Définit la route GET /search de recherche.
router.get("/search", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Extrait les paramètres de recherche de la requête.
    const { q = "", source = "all", genre = "all", status = "all", sort = "relevance" } = req.query;
    // Borne la limite de résultats entre 1 et 100.
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    // Calcule le décalage de pagination.
    const offset = Math.max(0, Number(req.query.offset) || 0);
    // Regroupe les options de recherche.
    const options = { genre, status, sort, limit, offset };
    // Liste des critères de tri autorisés.
    const allowedSorts = ["relevance", "popularity", "rating", "recent", "chapters", "title"];
    // Rejette un critère de tri non autorisé.
    if (!allowedSorts.includes(sort)) throw httpError(400, "Tri invalide");

    // Variable destinée aux résultats de recherche.
    let results;
    // Variable destinée au total de résultats.
    let total;
    // Indique si la source gère la pagination.
    let paginated = false;

    // Cas d'une recherche sur toutes les sources.
    if (source === "all") {
      // Récupère les sources actuellement activées.
      const sources = registry.enabled();
      // Une seule source active => on délègue (permet la pagination du catalogue).
      // Si une seule source est active, elle gère la pagination.
      if (sources.length === 1) {
        // Lance la recherche sur l'unique source.
        const out = await searchSource(sources[0], String(q), options);
        // Normalise le résultat brut de recherche.
        const norm = normalizeSearch(out, 0);
        // Affecte la liste des résultats normalisés.
        results = norm.results;
        // Affecte le total normalisé.
        total = norm.total;
        // Indique que la pagination est prise en charge.
        paginated = true;
      // Ferme le bloc conditionnel if puis ouvre le bloc else.
      } else {
        // Interroge toutes les sources en parallèle.
        const perSource = await Promise.all(sources.map((s) => searchSource(s, String(q), options)));
        // Concatène les résultats de toutes les sources.
        results = perSource.flatMap((out) => normalizeSearch(out, 0).results);
        // Le total correspond au nombre de résultats obtenus.
        total = results.length;
        // Table des fonctions de tri selon le critère demandé.
        const sorters = {
          // Tri par pertinence (popularité décroissante).
          relevance: (a, b) => b.popularity - a.popularity,
          // Tri par popularité décroissante.
          popularity: (a, b) => b.popularity - a.popularity,
          // Tri par note décroissante.
          rating: (a, b) => b.rating - a.rating,
          // Tri par année décroissante.
          recent: (a, b) => b.year - a.year,
          // Tri par nombre de chapitres décroissant.
          chapters: (a, b) => b.chapterCount - a.chapterCount,
          // Tri alphabétique des titres (français).
          title: (a, b) => a.title.localeCompare(b.title, "fr"),
        // Ferme le bloc (objet ou littéral).
        };
        // Applique le tri choisi aux résultats agrégés.
        results.sort(sorters[sort]);
      // Ferme le bloc else.
      }
    // Ferme le bloc conditionnel if puis ouvre le bloc else.
    } else {
      // Récupère la source désignée par le paramètre.
      const src = registry.get(String(source));
      // Lance la recherche sur la source désignée.
      const out = await searchSource(src, String(q), options);
      // Normalise le résultat brut de recherche.
      const norm = normalizeSearch(out, 0);
      // Affecte la liste des résultats normalisés.
      results = norm.results;
      // Affecte le total normalisé.
      total = norm.total;
      // Indique que la pagination est prise en charge.
      paginated = true;
    // Ferme le bloc else.
    }

    // Renvoie un objet JSON en réponse.
    res.json({ count: results.length, total, paginated, results });
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

// Définit la route GET donnant les infos d'un manga.
router.get("/sources/:sourceId/mangas/:mangaId", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Récupère la source indiquée dans l'URL.
    const source = registry.get(req.params.sourceId);
    // Renvoie les infos du manga demandé.
    res.json(await mangaInfo(source, req.params.mangaId));
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route GET donnant les pages d'un chapitre.
router.get("/sources/:sourceId/mangas/:mangaId/chapters/:chapterId", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Récupère la source indiquée dans l'URL.
    const source = registry.get(req.params.sourceId);
    // Extrait les identifiants manga et chapitre de l'URL.
    const { mangaId, chapterId } = req.params;
    // Variable destinée à contenir le chapitre récupéré.
    let chapter;
    // Ouvre un nouveau bloc de code.
    try {
      // Récupère les pages du chapitre (avec cache).
      chapter = await chapterPages(source, mangaId, chapterId);
    // Ferme le bloc try puis ouvre le bloc catch (erreur).
    } catch (err) {
      // Chapitre non hébergé (lecture chez l'éditeur) : on renvoie les
      // métadonnées (externalUrl) pour l'affichage embarqué dans le lecteur.
      // Ne traite que les chapitres absents (404).
      if (err.status !== 404) throw err;
      // Récupère les métadonnées du manga.
      const info = await mangaInfo(source, mangaId);
      // Cherche les métadonnées du chapitre dans la fiche manga.
      const meta = (info.chapters || []).find((c) => c.id === chapterId);
      // Propage l'erreur si le chapitre est introuvable.
      if (!meta) throw err;
      // Construit une fiche minimale pour un chapitre hébergé en externe.
      chapter = {
        // Définit la propriété « id » de l'objet.
        id: chapterId,
        // Définit la propriété « title » de l'objet.
        title: meta.title || null,
        // Définit la propriété « order » de l'objet.
        order: meta.order ?? null,
        // Définit la propriété « pages » de l'objet.
        pages: [],
        // Définit la propriété « pagesLow » de l'objet.
        pagesLow: [],
        // Définit la propriété « externalUrl » de l'objet.
        externalUrl: meta.externalUrl || null,
      // Ferme le bloc (objet ou littéral).
      };
    // Ferme le bloc catch.
    }
    // Complète le titre / l'ordre depuis la fiche (mis en cache par le lecteur).
    // Ouvre un nouveau bloc de code.
    try {
      // Récupère les métadonnées du manga.
      const info = await mangaInfo(source, mangaId);
      // Cherche les métadonnées du chapitre dans la fiche manga.
      const meta = (info.chapters || []).find((c) => c.id === chapterId);
      // Ouvre un nouveau bloc de code.
      if (meta) {
        // Complète le titre du chapitre si absent.
        chapter.title = chapter.title || meta.title;
        // Complète l'ordre du chapitre si absent.
        chapter.order = chapter.order ?? meta.order;
        // Complète l'URL externe si absente.
        if (chapter.externalUrl == null) chapter.externalUrl = meta.externalUrl || null;
      // Ferme le bloc conditionnel if.
      }
    // Ferme le bloc try puis ouvre le bloc catch (sans variable).
    } catch {
    // Ferme le bloc catch.
    }
    // Renvoie les données du chapitre.
    res.json(chapter);
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// Export CBZ (job asynchrone avec progression)
// ---------------------------------------------------------------------------

// Définit la route POST lançant l'export CBZ d'une plage de chapitres.
router.post("/sources/:sourceId/mangas/:mangaId/download", async (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Récupère la source indiquée dans l'URL.
    const source = registry.get(req.params.sourceId);
    // Extrait l'identifiant du manga de l'URL.
    const { mangaId } = req.params;
    // Extrait la plage de chapitres demandée.
    const { from, to } = req.body || {};

    // Récupère les métadonnées du manga.
    const info = await mangaInfo(source, mangaId);
    // Récupère la liste des chapitres du manga.
    let chapters = info.chapters || [];
    // Rejette si aucun chapitre n'existe.
    if (!chapters.length) throw httpError(400, "Aucun chapitre à exporter");

    // Extrait les numéros d'ordre des chapitres.
    const orders = chapters.map((c) => c.order);
    // Détermine le numéro du premier chapitre de la plage.
    const fromN = Number.isFinite(Number(from)) ? Math.floor(Number(from)) : orders[0];
    // Détermine le numéro du dernier chapitre de la plage.
    const toN = Number.isFinite(Number(to)) ? Math.floor(Number(to)) : orders[orders.length - 1];
    // Rejette une plage de chapitres incohérente.
    if (fromN > toN) throw httpError(400, "Plage de chapitres invalide");
    // Ne garde que les chapitres dans la plage demandée.
    chapters = chapters.filter((c) => c.order >= fromN && c.order <= toN);
    // Rejette si la plage ne contient aucun chapitre.
    if (!chapters.length) throw httpError(400, "Aucun chapitre dans cette plage");

    // Crée une tâche asynchrone pour l'export CBZ.
    const job = jobs.create({ type: "cbz", title: info.title });
    // Initialise le total de la tâche.
    jobs.update(job.id, { total: chapters.length, message: "Récupération des chapitres…" });

    // Démarre le traitement asynchrone de téléchargement et d'empaquetage.
    (async () => {
      // Définit un dossier temporaire propre à la tâche.
      const tmpRoot = path.join(DOWNLOADS_DIR, `.tmp-${job.id}`);
      // Compteur de chapitres téléchargés.
      let downloaded = 0;
      // Compteur de chapitres ignorés.
      let skipped = 0;
      // Ouvre un nouveau bloc de code.
      try {
        // Crée le dossier temporaire.
        fs.mkdirSync(tmpRoot, { recursive: true });
        // Parcourt chaque chapitre à télécharger.
        for (let i = 0; i < chapters.length; i++) {
          // Récupère le chapitre courant.
          const meta = chapters[i];
          // Met à jour la progression de la tâche.
          jobs.update(job.id, { progress: downloaded + skipped, message: `Chapitre ${i + 1} / ${chapters.length} : ${meta.title || meta.order}` });
          // Détecte un chapitre hébergé en externe.
          if (meta.externalUrl) {
            // Incrémente le nombre de chapitres ignorés.
            skipped++;
            // Passe au chapitre suivant de la boucle.
            continue;
          // Ferme le bloc conditionnel if.
          }
          // Variable destinée à contenir les pages du chapitre.
          let pages;
          // Ouvre un nouveau bloc de code.
          try {
            // Récupère les pages du chapitre courant.
            pages = await chapterPages(source, mangaId, meta.id);
          // Ferme le bloc try puis ouvre le bloc catch (sans variable).
          } catch {
            // Incrémente le nombre de chapitres ignorés.
            skipped++;
            // Passe au chapitre suivant de la boucle.
            continue;
          // Ferme le bloc catch.
          }
          // Ignore le chapitre s'il n'a aucune page.
          if (!pages.pages || !pages.pages.length) {
            // Incrémente le nombre de chapitres ignorés.
            skipped++;
            // Passe au chapitre suivant de la boucle.
            continue;
          // Ferme le bloc conditionnel if.
          }
          // Télécharge les images du chapitre dans le dossier temporaire.
          await downloadChapter({ ...meta, pages: pages.pages }, tmpRoot, { concurrency: 3 });
          // Incrémente le nombre de chapitres téléchargés.
          downloaded++;
        // Ferme la boucle for.
        }

        // Rejette si aucun chapitre hébergé n'a pu être téléchargé.
        if (!downloaded) throw httpError(400, "Aucun chapitre hébergé dans cette plage (liens externes uniquement).");

        // Signale l'étape d'empaquetage CBZ.
        jobs.update(job.id, { message: "Empaquetage du CBZ…" });
        // Construit l'archive CBZ à partir du dossier temporaire.
        const buffer = buildCbz(tmpRoot);

        // S'assure que le dossier de téléchargements existe.
        ensureDownloadsDir();
        // Construit un nom de fichier CBZ unique.
        const filename = `${slugify(info.title)}-${source.id}-${Date.now().toString(36)}.cbz`;
        // Écrit l'archive CBZ sur le disque.
        fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), buffer);

        // Construit l'entrée de bibliothèque du CBZ généré.
        const entry = {
          // Définit la propriété « id » de l'objet.
          id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          // Définit la propriété « title » de l'objet.
          title: info.title,
          // Définit la propriété « author » de l'objet.
          author: info.author,
          // Définit la propriété « cover » de l'objet.
          cover: info.cover,
          // Définit la propriété « sourceId » de l'objet.
          sourceId: source.id,
          // Définit la propriété « sourceName » de l'objet.
          sourceName: source.name,
          // Utilise la variable « mangaId » comme propriété raccourcie.
          mangaId,
          // Utilise la variable « filename » comme propriété raccourcie.
          filename,
          // Définit la propriété « chapterCount » de l'objet.
          chapterCount: downloaded,
          // Utilise la variable « skipped » comme propriété raccourcie.
          skipped,
          // Définit la propriété « range » de l'objet.
          range: [fromN, toN],
          // Définit la propriété « size » de l'objet.
          size: buffer.length,
          // Définit la propriété « downloadedAt » de l'objet.
          downloadedAt: new Date().toISOString(),
        // Ferme le bloc (objet ou littéral).
        };

        // Ajoute l'entrée en tête de la bibliothèque.
        db.update("library", (list) => [entry, ...list.filter((e) => e.filename !== filename)]);
        // Incrémente le compteur de téléchargements.
        db.update("stats", (s) => ({ ...s, downloads: (s.downloads || 0) + 1 }));

        // Met à jour la tâche avec le résultat final.
        jobs.update(job.id, {
          // Marque la tâche comme terminée.
          status: "done",
          // Fixe la progression à la fin.
          progress: chapters.length,
          // Construit le message de fin selon les chapitres ignorés.
          message: skipped ? `Terminé (${skipped} chapitre(s) externe(s) ignoré(s))` : "Terminé",
          // Fournit le résultat et l'URL du fichier.
          result: { ...entry, url: `/files/${filename}` },
        // Ferme le bloc (callback) et l'appel associé.
        });
      // Ferme le bloc try puis ouvre le bloc catch (erreur).
      } catch (err) {
        // Journalise l'échec du téléchargement.
        console.error("[download] échec :", err.message);
        // Marque la tâche en erreur.
        jobs.update(job.id, { status: "error", message: err.message, error: err.message });
      // Ferme le bloc catch puis ouvre le bloc finally.
      } finally {
        // Supprime le dossier temporaire.
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      // Ferme le bloc finally.
      }
    // Ferme la fonction fléchée puis l'exécute immédiatement (IIFE).
    })();

    // Répond 202 avec l'identifiant de la tâche.
    res.status(202).json({ jobId: job.id });
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route GET /jobs/:id donnant l'état d'une tâche.
router.get("/jobs/:id", (req, res) => {
  // Récupère la tâche par son identifiant.
  const job = jobs.get(req.params.id);
  // Répond 404 si la tâche est introuvable.
  if (!job) return res.status(404).json({ error: "Tâche introuvable" });
  // Renvoie l'état de la tâche.
  res.json(job);
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// Bibliothèque (CBZ générés)
// ---------------------------------------------------------------------------

// Définit la route GET /library listant les CBZ générés.
router.get("/library", (req, res) => {
  // Prépare la liste de la bibliothèque avec les URLs.
  const list = (db.get("library") || []).map((e) => ({
    // Étale les propriétés de l'entrée existante.
    ...e,
    // Ajoute l'URL si le fichier existe encore.
    url: fs.existsSync(path.join(DOWNLOADS_DIR, e.filename)) ? `/files/${e.filename}` : null,
  // Ferme le bloc (callback) et l'appel associé.
  }));
  // Renvoie la bibliothèque.
  res.json(list);
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route DELETE /library/:id supprimant un CBZ.
router.delete("/library/:id", (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Variable destinée à l'entrée supprimée.
    let removed = null;
    // Met à jour la bibliothèque via un callback.
    db.update("library", (list) => {
      // Repère l'entrée à supprimer.
      removed = list.find((e) => e.id === req.params.id) || null;
      // Renvoie la liste sans l'entrée supprimée.
      return list.filter((e) => e.id !== req.params.id);
    // Ferme la fonction fléchée (callback) et l'appel associé.
    });
    // Répond 404 si l'entrée n'existe pas.
    if (!removed) throw httpError(404, "Entrée introuvable");
    // Calcule le chemin du fichier CBZ à supprimer.
    const filePath = path.join(DOWNLOADS_DIR, path.basename(removed.filename));
    // Supprime le fichier s'il existe.
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    // Confirme la suppression.
    res.json({ ok: true, id: removed.id });
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// ---------------------------------------------------------------------------
// État utilisateur (favoris / historique / progression)
// ---------------------------------------------------------------------------

// Définit la route GET /state renvoyant l'état utilisateur.
router.get("/state", (req, res) => {
  // Renvoie un objet JSON en réponse.
  res.json({
    // Inclut les favoris dans la réponse.
    favorites: db.get("favorites"),
    // Inclut l'historique dans la réponse.
    history: db.get("history"),
    // Inclut la progression dans la réponse.
    progress: db.get("progress"),
  // Ferme le bloc (callback) et l'appel associé.
  });
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route PUT /state mettant à jour l'état utilisateur.
router.put("/state", (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Récupère le corps de la requête.
    const body = req.body || {};
    // Objet accumulant les résultats de mise à jour.
    const result = {};
    // Parcourt les clés d'état autorisées.
    for (const key of STATE_KEYS) {
      // Ignore les clés absentes du corps.
      if (!(key in body)) continue;
      // Récupère la valeur correspondant à la clé.
      const value = body[key];
      // Traitement spécifique de la progression.
      if (key === "progress") {
        // Vérifie que la progression est un objet.
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          // Rejette une progression qui n'est pas un objet.
          throw httpError(400, "progress doit être un objet");
        // Ferme le bloc conditionnel if.
        }
        // Objet destiné à la progression nettoyée.
        const clean = {};
        // Parcourt au plus 500 entrées de progression.
        for (const [k, v] of Object.entries(value).slice(0, 500)) {
          // Ignore les entrées de progression invalides.
          if (typeof v !== "object" || !v) continue;
          // Construit une entrée de progression nettoyée.
          clean[k] = {
            // Nettoie et borne la liste des chapitres lus.
            read: Array.isArray(v.read) ? v.read.slice(0, 500).map(String) : [],
            // Nettoie le nombre de mots lus.
            words: Number.isFinite(v.words) ? Math.max(0, Math.floor(v.words)) : 0,
            // Nettoie la dernière position de lecture.
            last: v.last && typeof v.last === "object" ? v.last : null,
            // Horodate la mise à jour de la progression.
            updatedAt: v.updatedAt || new Date().toISOString(),
          // Ferme le bloc (objet ou littéral).
          };
        // Ferme la boucle for.
        }
        // Enregistre la progression nettoyée.
        result[key] = db.set(key, clean);
      // Ferme le bloc conditionnel if puis ouvre le bloc else.
      } else {
        // Vérifie que la valeur est un tableau.
        if (!Array.isArray(value)) throw httpError(400, `${key} doit être un tableau`);
        // Limite le tableau à 500 éléments.
        const capped = value.slice(0, 500);
        // Valide chaque élément du tableau.
        for (const item of capped) {
          // Rejette un élément invalide.
          if (typeof item !== "object" || item === null) throw httpError(400, "Élément invalide");
        // Ferme la boucle for.
        }
        // Enregistre le tableau nettoyé.
        result[key] = db.set(key, capped);
      // Ferme le bloc else.
      }
    // Ferme la boucle for.
    }
    // Renvoie le résultat de la mise à jour d'état.
    res.json(result);
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Définit la route DELETE /state réinitialisant l'état utilisateur.
router.delete("/state", (req, res, next) => {
  // Ouvre un nouveau bloc de code.
  try {
    // Réinitialise complètement la base d'état utilisateur.
    db.reset();
    // Vide le cache applicatif.
    cache.clear();
    // Renvoie un accusé de réussite.
    res.json({ ok: true });
  // Ferme le bloc try puis ouvre le bloc catch (erreur).
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs.
    next(err);
  // Ferme le bloc catch.
  }
// Ferme la fonction fléchée (callback) et l'appel associé.
});

// Exporte le routeur pour l'application.
module.exports = router;