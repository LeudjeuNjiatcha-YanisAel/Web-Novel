// Active le mode strict de JavaScript
"use strict";

// Importe le framework web Express
const express = require("express");
// Importe le middleware CORS pour autoriser les requêtes cross-origin
const cors = require("cors");
// Importe le module natif de gestion des fichiers
const fs = require("fs");
// Importe le module natif de gestion des chemins
const path = require("path");

// Importe le routeur de l'API
const routes = require("./routes");
// Importe le limiteur de débit depuis le module rateLimit
const { limiter } = require("./rateLimit");
// Importe la couche de persistance de la base de données
const db = require("../data/db");
// Importe l'utilitaire de création d'erreur HTTP
const { httpError } = require("../extension/utils");

// Racine du projet (dossier parent de src)
const ROOT = path.join(__dirname, "..");
// Dossier contenant les fichiers statiques publics
const PUBLIC_DIR = path.join(ROOT, "public");
// Dossier de téléchargement, configurable par variable d'environnement
const DOWNLOADS_DIR = process.env.OPTIMANGA_DOWNLOADS_DIR || process.env.NOVELHUB_DOWNLOADS_DIR || path.join(ROOT, "downloads");

// Crée le dossier de téléchargements s'il n'existe pas
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Nettoie les dossiers temporaires d'export laissés par un arrêt brutal.
try {
  // Parcourt chaque entrée du dossier de téléchargements
  for (const entry of fs.readdirSync(DOWNLOADS_DIR)) {
    // Vérifie si le nom commence par le préfixe temporaire
    if (entry.startsWith(".tmp-")) {
      // Supprime récursivement le dossier temporaire
      fs.rmSync(path.join(DOWNLOADS_DIR, entry), { recursive: true, force: true });
    }
    // Ferme le bloc if
  }
  // Ferme la boucle for
} catch (err) {
  // Affiche un avertissement si le nettoyage échoue
  console.warn("[downloads] nettoyage des dossiers temporaires impossible :", err.message);
  // Ferme le bloc catch
}

// Téléchargement d'un CBZ généré
// Gestionnaire de route pour le téléchargement d'un fichier
function downloadRoute(req, res, next) {
  // Démarre un bloc de gestion d'erreur
  try {
    // Récupère uniquement le nom de fichier, sans chemin (sécurité)
    const filename = path.basename(req.params.filename);
    // Construit le chemin absolu du fichier à télécharger
    const filePath = path.join(DOWNLOADS_DIR, filename);
    // Vérifie l'existence du fichier sinon lève une erreur 404
    if (!fs.existsSync(filePath)) throw httpError(404, "Fichier introuvable");
    // Envoie le fichier au client en téléchargement
    res.download(filePath, filename, (err) => {
      // Transmet l'erreur au middleware suivant si les en-têtes ne sont pas envoyés
      if (err && !res.headersSent) next(err);
      // Ferme le callback de téléchargement
    });
    // Ferme le bloc try
  } catch (err) {
    // Transmet l'erreur au middleware de gestion d'erreurs
    next(err);
    // Ferme le bloc catch
  }
  // Ferme la fonction downloadRoute
}

// Crée et configure l'application Express
function createApp() {
  // Instancie une application Express
  const app = express();

  // Fait confiance au proxy pour déterminer l'IP réelle du client
  app.set("trust proxy", true);
  // Active le middleware CORS
  app.use(cors());
  // Active le parseur JSON avec une limite de taille de 1 Mo
  app.use(express.json({ limit: "1mb" }));
  // Applique le limiteur de débit (1200 requêtes par minute)
  app.use(limiter({ windowMs: 60_000, max: 1200 }));

  // Middleware personnalisé ajoutant un en-tête de sécurité
  app.use((req, res, next) => {
    // Empêche le navigateur de deviner le type MIME
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Passe au middleware suivant
    next();
    // Ferme le middleware
  });

  // Monte le routeur de l'API sous le préfixe /api
  app.use("/api", routes);
  // Déclare la route de téléchargement des fichiers générés
  app.get("/files/:filename", downloadRoute);

  // Sert les fichiers statiques du dossier public
  app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: "0", etag: true }));

  // SPA : toute route non-API renvoie l'application
  // Route attrape-tout pour renvoyer l'application monopage
  app.get("*", (req, res, next) => {
    // Ignore les routes API et fichiers (laisse passer au middleware suivant)
    if (req.path.startsWith("/api") || req.path.startsWith("/files")) return next();
    // Ignore les méthodes autres que GET
    if (req.method !== "GET") return next();
    // Renvoie le fichier index.html de l'application
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
    // Ferme la route attrape-tout
  });

  // Middleware final renvoyant une erreur 404 en JSON
  app.use((req, res) => {
    // Répond avec le statut 404 et un message d'erreur
    res.status(404).json({ error: "Ressource introuvable" });
    // Ferme le middleware 404
  });

  // eslint-disable-next-line no-unused-vars
  // Middleware de gestion centralisée des erreurs
  app.use((err, req, res, next) => {
    // Détermine le code de statut (500 par défaut)
    const status = err.status || 500;
    // Journalise l'erreur côté serveur si elle est grave
    if (status >= 500) console.error("[api]", err);
    // Répond au client avec le statut et le message d'erreur
    res.status(status).json({ error: err.message || "Erreur serveur" });
    // Ferme le middleware d'erreurs
  });

  // Retourne l'application configurée
  return app;
  // Ferme la fonction createApp
}

// Démarre le serveur HTTP
function start() {
  // Détermine le port d'écoute (3000 par défaut)
  const PORT = process.env.PORT || 3000;
  // Crée l'application Express
  const app = createApp();
  // Démarre l'écoute sur le port et affiche l'adresse
  const server = app.listen(PORT, () => {
    // Affiche l'URL de démarrage dans la console
    console.log(`\n  OptiManga · Anime & Manga Premium → http://localhost:${PORT}\n`);
    // Ferme le callback de démarrage
  });

  // Définit la procédure d'arrêt propre du serveur
  const shutdown = () => {
    // Vide le tampon de la base de données sur le disque
    db.flush();
    // Ferme le serveur puis quitte le processus
    server.close(() => process.exit(0));
    // Force la sortie après 2 secondes si le serveur ne se ferme pas
    setTimeout(() => process.exit(0), 2000).unref();
    // Ferme la fonction shutdown
  };
  // Enregistre shutdown sur le signal SIGINT (Ctrl+C)
  process.on("SIGINT", shutdown);
  // Enregistre shutdown sur le signal SIGTERM
  process.on("SIGTERM", shutdown);

  // Retourne l'instance du serveur
  return server;
  // Ferme la fonction start
}

// Exporte les fonctions createApp et start
module.exports = { createApp, start };
