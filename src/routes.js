"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");

const registry = require("../extension/registry");
const { downloadChapter, buildCbz } = require("../extension/cbz");
const images = require("../extension/images");
const { slugify, httpError } = require("../extension/utils");
const db = require("../data/db");
const cache = require("./cache");
const jobs = require("./jobs");

const router = express.Router();

const ROOT = path.join(__dirname, "..");
const DOWNLOADS_DIR = process.env.OPTIMANGA_DOWNLOADS_DIR || process.env.NOVELHUB_DOWNLOADS_DIR || path.join(ROOT, "downloads");
const STATE_KEYS = ["favorites", "history", "progress"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDownloadsDir() {
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

async function searchSource(source, query, options) {
  const key = `s:${source.id}:${query}:${options.genre}:${options.status}:${options.sort}:${options.limit}:${options.offset}`;
  return cache.wrap(key, 60_000, () => source.search(query, options));
}

async function mangaInfo(source, mangaId) {
  return cache.wrap(`i:${source.id}:${mangaId}`, 300_000, () => source.getMangaInfo(mangaId));
}

async function chapterPages(source, mangaId, chapterId) {
  return cache.wrap(`c:${source.id}:${mangaId}:${chapterId}`, 900_000, () =>
    source.getChapterPages(mangaId, chapterId)
  );
}

/** Uniformise le retour d'un search : { results, total }. */
function normalizeSearch(out, fallbackTotal) {
  const results = Array.isArray(out) ? out : out && Array.isArray(out.results) ? out.results : [];
  const total = out && Number.isFinite(out.total) ? Number(out.total) : fallbackTotal;
  return { results, total };
}

async function allMangas() {
  return cache.wrap("all:mangas", 60_000, async () => {
    const perSource = await Promise.all(
      registry.enabled().map(async (s) => {
        const out = await s.search("", {});
        return normalizeSearch(out, 0).results.map((n) => ({ ...n, sourceId: s.id }));
      })
    );
    return perSource.flat();
  });
}

// ---------------------------------------------------------------------------
// Proxy d'images (CDN exigeant un Referer émis par leur domaine)
// ---------------------------------------------------------------------------

const IMAGE_CACHE_CONTROL = "public, max-age=604800, immutable";
const IMAGE_MAX_CONCURRENT = 12;
const IMAGE_MAX_ENTRIES = 120;
const IMAGE_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_MAX_SIZE = 15 * 1024 * 1024;

const imageCache = new Map(); // url -> { buf, type, bytes }
let imageCacheBytes = 0;
let imageActive = 0;
const imageWaiters = [];

function imageCachePut(url, entry) {
  if (entry.bytes > IMAGE_MAX_BYTES) return;
  imageCache.delete(url);
  imageCache.set(url, entry);
  imageCacheBytes += entry.bytes;
  while (imageCache.size > IMAGE_MAX_ENTRIES || imageCacheBytes > IMAGE_MAX_BYTES) {
    const oldest = imageCache.keys().next().value;
    imageCacheBytes -= imageCache.get(oldest).bytes;
    imageCache.delete(oldest);
  }
}

function acquireImageSlot() {
  if (imageActive < IMAGE_MAX_CONCURRENT) {
    imageActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => imageWaiters.push(resolve));
}

function releaseImageSlot() {
  const next = imageWaiters.shift();
  if (next) next();
  else imageActive--;
}

router.get("/image", async (req, res, next) => {
  try {
    const url = images.resolve(String(req.query.url || ""));
    if (!images.isProxiable(url)) throw httpError(400, "URL d'image non autorisée");

    const hit = imageCache.get(url);
    if (hit) {
      imageCache.delete(url);
      imageCache.set(url, hit);
      res.set("Content-Type", hit.type).set("Cache-Control", IMAGE_CACHE_CONTROL).send(hit.buf);
      return;
    }

    await acquireImageSlot();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      let upstream;
      try {
        upstream = await fetch(url, { signal: ctrl.signal, headers: images.headersFor(req.originalUrl || url) });
      } finally {
        clearTimeout(timer);
      }
      if (!upstream.ok) throw httpError(502, `Image indisponible (${upstream.status})`);

      const buf = images.decodePage(Buffer.from(await upstream.arrayBuffer()), images.kOf(req.originalUrl || ""));
      if (buf.length > IMAGE_MAX_SIZE) throw httpError(502, "Image trop volumineuse");
      const type = (upstream.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      imageCachePut(url, { buf, type, bytes: buf.length });
      res.set("Content-Type", type).set("Cache-Control", IMAGE_CACHE_CONTROL).send(buf);
    } finally {
      releaseImageSlot();
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Santé / statistiques
// ---------------------------------------------------------------------------

router.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), time: new Date().toISOString() });
});

router.get("/stats", async (req, res, next) => {
  try {
    const mangas = await allMangas();
    const chapters = mangas.reduce((sum, n) => sum + (n.chapterCount || 0), 0);
    const progress = db.get("progress") || {};
    let readChapters = 0;
    for (const entry of Object.values(progress)) {
      readChapters += (entry.read || []).length;
    }
    const favorites = (db.get("favorites") || []).length;
    const library = (db.get("library") || []).length;
    res.json({
      sources: registry.enabled().length,
      mangas: mangas.length,
      chapters,
      favorites,
      library,
      readChapters,
      downloads: db.get("stats").downloads || 0,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Extensions (découverte automatique : scan de extension/sources/*.js)
// ---------------------------------------------------------------------------

router.get("/extensions", (req, res) => {
  res.json({ installed: registry.list() });
});

router.patch("/extensions/:id", (req, res, next) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") throw httpError(400, "Champ « enabled » attendu (booléen)");
    const ext = registry.setEnabled(req.params.id, enabled);
    cache.clear();
    res.json(ext);
  } catch (err) {
    next(err);
  }
});

router.get("/genres", async (req, res, next) => {
  try {
    res.json(await registry.genres());
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Recherche / catalogue
// ---------------------------------------------------------------------------

router.get("/search", async (req, res, next) => {
  try {
    const { q = "", source = "all", genre = "all", status = "all", sort = "relevance" } = req.query;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const options = { genre, status, sort, limit, offset };
    const allowedSorts = ["relevance", "popularity", "rating", "recent", "chapters", "title"];
    if (!allowedSorts.includes(sort)) throw httpError(400, "Tri invalide");

    let results;
    let total;
    let paginated = false;

    if (source === "all") {
      const sources = registry.enabled();
      // Une seule source active => on délègue (permet la pagination du catalogue).
      if (sources.length === 1) {
        const out = await searchSource(sources[0], String(q), options);
        const norm = normalizeSearch(out, 0);
        results = norm.results;
        total = norm.total;
        paginated = true;
      } else {
        const perSource = await Promise.all(sources.map((s) => searchSource(s, String(q), options)));
        results = perSource.flatMap((out) => normalizeSearch(out, 0).results);
        total = results.length;
        const sorters = {
          relevance: (a, b) => b.popularity - a.popularity,
          popularity: (a, b) => b.popularity - a.popularity,
          rating: (a, b) => b.rating - a.rating,
          recent: (a, b) => b.year - a.year,
          chapters: (a, b) => b.chapterCount - a.chapterCount,
          title: (a, b) => a.title.localeCompare(b.title, "fr"),
        };
        results.sort(sorters[sort]);
      }
    } else {
      const src = registry.get(String(source));
      const out = await searchSource(src, String(q), options);
      const norm = normalizeSearch(out, 0);
      results = norm.results;
      total = norm.total;
      paginated = true;
    }

    res.json({ count: results.length, total, paginated, results });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

router.get("/sources/:sourceId/mangas/:mangaId", async (req, res, next) => {
  try {
    const source = registry.get(req.params.sourceId);
    res.json(await mangaInfo(source, req.params.mangaId));
  } catch (err) {
    next(err);
  }
});

router.get("/sources/:sourceId/mangas/:mangaId/chapters/:chapterId", async (req, res, next) => {
  try {
    const source = registry.get(req.params.sourceId);
    const { mangaId, chapterId } = req.params;
    let chapter;
    try {
      chapter = await chapterPages(source, mangaId, chapterId);
    } catch (err) {
      // Chapitre non hébergé (lecture chez l'éditeur) : on renvoie les
      // métadonnées (externalUrl) pour l'affichage embarqué dans le lecteur.
      if (err.status !== 404) throw err;
      const info = await mangaInfo(source, mangaId);
      const meta = (info.chapters || []).find((c) => c.id === chapterId);
      if (!meta) throw err;
      chapter = {
        id: chapterId,
        title: meta.title || null,
        order: meta.order ?? null,
        pages: [],
        pagesLow: [],
        externalUrl: meta.externalUrl || null,
      };
    }
    // Complète le titre / l'ordre depuis la fiche (mis en cache par le lecteur).
    try {
      const info = await mangaInfo(source, mangaId);
      const meta = (info.chapters || []).find((c) => c.id === chapterId);
      if (meta) {
        chapter.title = chapter.title || meta.title;
        chapter.order = chapter.order ?? meta.order;
        if (chapter.externalUrl == null) chapter.externalUrl = meta.externalUrl || null;
      }
    } catch {
    }
    res.json(chapter);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Export CBZ (job asynchrone avec progression)
// ---------------------------------------------------------------------------

router.post("/sources/:sourceId/mangas/:mangaId/download", async (req, res, next) => {
  try {
    const source = registry.get(req.params.sourceId);
    const { mangaId } = req.params;
    const { from, to } = req.body || {};

    const info = await mangaInfo(source, mangaId);
    let chapters = info.chapters || [];
    if (!chapters.length) throw httpError(400, "Aucun chapitre à exporter");

    const orders = chapters.map((c) => c.order);
    const fromN = Number.isFinite(Number(from)) ? Math.floor(Number(from)) : orders[0];
    const toN = Number.isFinite(Number(to)) ? Math.floor(Number(to)) : orders[orders.length - 1];
    if (fromN > toN) throw httpError(400, "Plage de chapitres invalide");
    chapters = chapters.filter((c) => c.order >= fromN && c.order <= toN);
    if (!chapters.length) throw httpError(400, "Aucun chapitre dans cette plage");

    const job = jobs.create({ type: "cbz", title: info.title });
    jobs.update(job.id, { total: chapters.length, message: "Récupération des chapitres…" });

    (async () => {
      const tmpRoot = path.join(DOWNLOADS_DIR, `.tmp-${job.id}`);
      let downloaded = 0;
      let skipped = 0;
      try {
        fs.mkdirSync(tmpRoot, { recursive: true });
        for (let i = 0; i < chapters.length; i++) {
          const meta = chapters[i];
          jobs.update(job.id, { progress: downloaded + skipped, message: `Chapitre ${i + 1} / ${chapters.length} : ${meta.title || meta.order}` });
          if (meta.externalUrl) {
            skipped++;
            continue;
          }
          let pages;
          try {
            pages = await chapterPages(source, mangaId, meta.id);
          } catch {
            skipped++;
            continue;
          }
          if (!pages.pages || !pages.pages.length) {
            skipped++;
            continue;
          }
          await downloadChapter({ ...meta, pages: pages.pages }, tmpRoot, { concurrency: 3 });
          downloaded++;
        }

        if (!downloaded) throw httpError(400, "Aucun chapitre hébergé dans cette plage (liens externes uniquement).");

        jobs.update(job.id, { message: "Empaquetage du CBZ…" });
        const buffer = buildCbz(tmpRoot);

        ensureDownloadsDir();
        const filename = `${slugify(info.title)}-${source.id}-${Date.now().toString(36)}.cbz`;
        fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), buffer);

        const entry = {
          id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          title: info.title,
          author: info.author,
          cover: info.cover,
          sourceId: source.id,
          sourceName: source.name,
          mangaId,
          filename,
          chapterCount: downloaded,
          skipped,
          range: [fromN, toN],
          size: buffer.length,
          downloadedAt: new Date().toISOString(),
        };

        db.update("library", (list) => [entry, ...list.filter((e) => e.filename !== filename)]);
        db.update("stats", (s) => ({ ...s, downloads: (s.downloads || 0) + 1 }));

        jobs.update(job.id, {
          status: "done",
          progress: chapters.length,
          message: skipped ? `Terminé (${skipped} chapitre(s) externe(s) ignoré(s))` : "Terminé",
          result: { ...entry, url: `/files/${filename}` },
        });
      } catch (err) {
        console.error("[download] échec :", err.message);
        jobs.update(job.id, { status: "error", message: err.message, error: err.message });
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    })();

    res.status(202).json({ jobId: job.id });
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Tâche introuvable" });
  res.json(job);
});

// ---------------------------------------------------------------------------
// Bibliothèque (CBZ générés)
// ---------------------------------------------------------------------------

router.get("/library", (req, res) => {
  const list = (db.get("library") || []).map((e) => ({
    ...e,
    url: fs.existsSync(path.join(DOWNLOADS_DIR, e.filename)) ? `/files/${e.filename}` : null,
  }));
  res.json(list);
});

router.delete("/library/:id", (req, res, next) => {
  try {
    let removed = null;
    db.update("library", (list) => {
      removed = list.find((e) => e.id === req.params.id) || null;
      return list.filter((e) => e.id !== req.params.id);
    });
    if (!removed) throw httpError(404, "Entrée introuvable");
    const filePath = path.join(DOWNLOADS_DIR, path.basename(removed.filename));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true, id: removed.id });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// État utilisateur (favoris / historique / progression)
// ---------------------------------------------------------------------------

router.get("/state", (req, res) => {
  res.json({
    favorites: db.get("favorites"),
    history: db.get("history"),
    progress: db.get("progress"),
  });
});

router.put("/state", (req, res, next) => {
  try {
    const body = req.body || {};
    const result = {};
    for (const key of STATE_KEYS) {
      if (!(key in body)) continue;
      const value = body[key];
      if (key === "progress") {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw httpError(400, "progress doit être un objet");
        }
        const clean = {};
        for (const [k, v] of Object.entries(value).slice(0, 500)) {
          if (typeof v !== "object" || !v) continue;
          clean[k] = {
            read: Array.isArray(v.read) ? v.read.slice(0, 500).map(String) : [],
            words: Number.isFinite(v.words) ? Math.max(0, Math.floor(v.words)) : 0,
            last: v.last && typeof v.last === "object" ? v.last : null,
            updatedAt: v.updatedAt || new Date().toISOString(),
          };
        }
        result[key] = db.set(key, clean);
      } else {
        if (!Array.isArray(value)) throw httpError(400, `${key} doit être un tableau`);
        const capped = value.slice(0, 500);
        for (const item of capped) {
          if (typeof item !== "object" || item === null) throw httpError(400, "Élément invalide");
        }
        result[key] = db.set(key, capped);
      }
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete("/state", (req, res, next) => {
  try {
    db.reset();
    cache.clear();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;