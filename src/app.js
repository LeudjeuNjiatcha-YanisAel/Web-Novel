"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const routes = require("./routes");
const { limiter } = require("./rateLimit");
const db = require("../data/db");
const { httpError } = require("../extension/utils");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DOWNLOADS_DIR = path.join(ROOT, "downloads");

// Téléchargement d'un EPUB généré
function downloadRoute(req, res, next) {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(DOWNLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) throw httpError(404, "Fichier introuvable");
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
}

function createApp() {
  const app = express();

  app.set("trust proxy", true);
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(limiter({ windowMs: 60_000, max: 1200 }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use("/api", routes);
  app.get("/files/:filename", downloadRoute);

  app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: "1h" }));

  // SPA : toute route non-API renvoie l'application
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/files")) return next();
    if (req.method !== "GET") return next();
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Ressource introuvable" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ error: err.message || "Erreur serveur" });
  });

  return app;
}

function start() {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`\n  NovelHub → http://localhost:${PORT}\n`);
  });

  const shutdown = () => {
    db.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

module.exports = { createApp, start };
