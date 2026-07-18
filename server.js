const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const extensions = require("./extension/index");
const { buildEpub } = require("./extension/epubBuilder");
const libraryStore = require("./data/libraryStore");

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(DOWNLOADS_DIR));

// ---- Extensions ----------------------------------------------------------

// Liste des extensions (sources) disponibles
app.get("/api/extensions", (req, res) => {
  res.json(extensions.list());
});

// Recherche de novels sur une source donnée
app.get("/api/sources/:sourceId/search", async (req, res, next) => {
  try {
    const source = extensions.get(req.params.sourceId);
    const query = req.query.q || "";
    const results = await source.search(query);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// Détails d'un novel + liste des chapitres
app.get("/api/sources/:sourceId/novels/:novelId", async (req, res, next) => {
  try {
    const source = extensions.get(req.params.sourceId);
    const info = await source.getNovelInfo(req.params.novelId);
    res.json(info);
  } catch (err) {
    next(err);
  }
});

// Contenu d'un chapitre (pour lecture en ligne)
app.get(
  "/api/sources/:sourceId/novels/:novelId/chapters/:chapterId",
  async (req, res, next) => {
    try {
      const source = extensions.get(req.params.sourceId);
      const chapter = await source.getChapterContent(
        req.params.novelId,
        req.params.chapterId
      );
      res.json(chapter);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Téléchargement EPUB --------------------------------------------------

// Génère un EPUB pour un novel (tous les chapitres, ou une plage donnée)
app.post("/api/sources/:sourceId/novels/:novelId/download", async (req, res, next) => {
  try {
    const source = extensions.get(req.params.sourceId);
    const { novelId } = req.params;
    const { fromChapter, toChapter } = req.body || {};

    const info = await source.getNovelInfo(novelId);
    let chaptersMeta = info.chapters;

    if (fromChapter || toChapter) {
      const from = fromChapter ?? chaptersMeta[0].order;
      const to = toChapter ?? chaptersMeta[chaptersMeta.length - 1].order;
      chaptersMeta = chaptersMeta.filter((c) => c.order >= from && c.order <= to);
    }

    if (chaptersMeta.length === 0) {
      return res.status(400).json({ error: "Aucun chapitre à télécharger" });
    }

    // Récupère le contenu de chaque chapitre séquentiellement
    const chapters = [];
    for (const meta of chaptersMeta) {
      const content = await source.getChapterContent(novelId, meta.id);
      chapters.push(content);
    }

    const epubBuffer = await buildEpub(info, chapters);

    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    const safeTitle = info.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const filename = `${safeTitle}_${source.id}_${Date.now()}.epub`;
    const filePath = path.join(DOWNLOADS_DIR, filename);
    fs.writeFileSync(filePath, epubBuffer);

    const entry = {
      title: info.title,
      author: info.author,
      sourceId: source.id,
      novelId,
      filename,
      chapterCount: chapters.length,
    };
    libraryStore.addEntry(entry);

    res.json({ ...entry, url: `/downloads/${filename}` });
  } catch (err) {
    next(err);
  }
});

// ---- Bibliothèque locale --------------------------------------------------

app.get("/api/library", (req, res) => {
  res.json(libraryStore.listEntries());
});

// ---- Erreurs ---------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Erreur serveur" });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
