"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");

const registry = require("../extension/registry");
const { buildEpub } = require("../extension/epub");
const { slugify, httpError } = require("../extension/utils");
const db = require("../data/db");
const cache = require("./cache");
const jobs = require("./jobs");

const router = express.Router();

const ROOT = path.join(__dirname, "..");
const DOWNLOADS_DIR = process.env.NOVELHUB_DOWNLOADS_DIR || path.join(ROOT, "downloads");
const STATE_KEYS = ["favorites", "history", "progress"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDownloadsDir() {
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

async function searchSource(source, query, options) {
  const key = `s:${source.id}:${query}:${options.genre}:${options.status}:${options.sort}`;
  return cache.wrap(key, 60_000, () => source.search(query, options));
}

async function novelInfo(source, novelId) {
  return cache.wrap(`i:${source.id}:${novelId}`, 300_000, () => source.getNovelInfo(novelId));
}

async function chapterContent(source, novelId, chapterId) {
  return cache.wrap(
    `c:${source.id}:${novelId}:${chapterId}`,
    300_000,
    () => source.getChapterContent(novelId, chapterId)
  );
}

async function allNovels() {
  return cache.wrap("all:novels", 60_000, async () => {
    const perSource = await Promise.all(
      registry.enabled().map(async (s) => (await s.search("", {})).map((n) => ({ ...n, sourceId: s.id })))
    );
    return perSource.flat();
  });
}

// ---------------------------------------------------------------------------
// Santé / statistiques
// ---------------------------------------------------------------------------

router.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), time: new Date().toISOString() });
});

router.get("/stats", async (req, res, next) => {
  try {
    const novels = await allNovels();
    const chapters = novels.reduce((sum, n) => sum + (n.chapterCount || 0), 0);
    const progress = db.get("progress") || {};
    let readChapters = 0;
    let words = 0;
    for (const entry of Object.values(progress)) {
      readChapters += (entry.read || []).length;
      words += entry.words || 0;
    }
    const favs = (db.get("favorites") || []).length;
    const library = (db.get("library") || []).length;
    res.json({
      sources: registry.enabled().length,
      novels: novels.length,
      chapters,
      favorites: favs,
      library,
      readChapters,
      minutesRead: Math.round(words / 220) || 0,
      exports: db.get("stats").exports || 0,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

router.get("/extensions", (req, res) => {
  res.json({ installed: registry.list(), available: registry.available() });
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

router.get("/genres", (req, res) => {
  res.json(registry.genres());
});

// ---------------------------------------------------------------------------
// Recherche / catalogue
// ---------------------------------------------------------------------------

router.get("/search", async (req, res, next) => {
  try {
    const { q = "", source = "all", genre = "all", status = "all", sort = "relevance" } = req.query;
    const options = { genre, status, sort };
    const allowedSorts = ["relevance", "popularity", "rating", "recent", "chapters", "title"];
    if (!allowedSorts.includes(sort)) throw httpError(400, "Tri invalide");

    let results;
    if (source === "all") {
      const sources = registry.enabled();
      const perSource = await Promise.all(sources.map((s) => searchSource(s, String(q), options)));
      results = perSource.flat();
      const sorters = {
        relevance: (a, b) => b.popularity - a.popularity,
        popularity: (a, b) => b.popularity - a.popularity,
        rating: (a, b) => b.rating - a.rating,
        recent: (a, b) => b.year - a.year,
        chapters: (a, b) => b.chapterCount - a.chapterCount,
        title: (a, b) => a.title.localeCompare(b.title, "fr"),
      };
      results.sort(sorters[sort]);
    } else {
      const src = registry.get(String(source));
      results = await searchSource(src, String(q), options);
    }
    res.json({ count: results.length, results });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

router.get("/sources/:sourceId/novels/:novelId", async (req, res, next) => {
  try {
    const source = registry.get(req.params.sourceId);
    res.json(await novelInfo(source, req.params.novelId));
  } catch (err) {
    next(err);
  }
});

router.get("/sources/:sourceId/novels/:novelId/chapters/:chapterId", async (req, res, next) => {
  try {
    const source = registry.get(req.params.sourceId);
    const chapter = await chapterContent(source, req.params.novelId, req.params.chapterId);
    res.json(chapter);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Export EPUB (job asynchrone avec progression)
// ---------------------------------------------------------------------------

router.post("/sources/:sourceId/novels/:novelId/export", async (req, res, next) => {
  try {
    const source = registry.get(req.params.sourceId);
    const { novelId } = req.params;
    const { from, to } = req.body || {};

    const info = await novelInfo(source, novelId);
    let chaptersMeta = info.chapters;

    const fromN = Number.isFinite(Number(from)) ? Math.floor(Number(from)) : chaptersMeta[0].order;
    const toN = Number.isFinite(Number(to)) ? Math.floor(Number(to)) : chaptersMeta[chaptersMeta.length - 1].order;
    if (fromN < 1 || toN > chaptersMeta.length || fromN > toN) {
      throw httpError(400, "Plage de chapitres invalide");
    }
    chaptersMeta = chaptersMeta.filter((c) => c.order >= fromN && c.order <= toN);
    if (!chaptersMeta.length) throw httpError(400, "Aucun chapitre à exporter");

    const job = jobs.create({ type: "export", title: info.title });
    jobs.update(job.id, { total: chaptersMeta.length, message: "Récupération des chapitres…" });

    // Exécution en arrière-plan : le client poll /api/jobs/:id
    (async () => {
      try {
        const chapters = [];
        for (let i = 0; i < chaptersMeta.length; i++) {
          const meta = chaptersMeta[i];
          const content = await chapterContent(source, novelId, meta.id);
          chapters.push({ title: content.title, content: content.content });
          jobs.update(job.id, {
            progress: i + 1,
            message: `Chapitre ${i + 1} / ${chaptersMeta.length}`,
          });
        }

        jobs.update(job.id, { message: "Génération de l'EPUB…" });
        const buffer = await buildEpub(
          { ...info, lang: "fr" },
          chapters
        );

        ensureDownloadsDir();
        const filename = `${slugify(info.title)}-${source.id}-${Date.now().toString(36)}.epub`;
        fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), buffer);

        const entry = {
          id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          title: info.title,
          author: info.author,
          cover: info.cover,
          sourceId: source.id,
          sourceName: source.name,
          novelId,
          filename,
          chapterCount: chapters.length,
          range: [fromN, toN],
          size: buffer.length,
          downloadedAt: new Date().toISOString(),
        };

        db.update("library", (list) => [entry, ...list.filter((e) => e.filename !== filename)]);
        db.update("stats", (s) => ({ ...s, exports: (s.exports || 0) + 1 }));

        jobs.update(job.id, {
          status: "done",
          progress: chaptersMeta.length,
          message: "Terminé",
          result: { ...entry, url: `/files/${filename}` },
        });
      } catch (err) {
        console.error("[export] échec :", err);
        jobs.update(job.id, { status: "error", message: err.message, error: err.message });
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
// Bibliothèque (EPUB générés)
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
