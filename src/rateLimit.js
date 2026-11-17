// Active le mode strict de JavaScript
"use strict";

/** Limitation de débit simple, en mémoire, par identifiant (IP). */

// Stockage en mémoire des compteurs par identifiant (IP)
const buckets = new Map();

// Crée un middleware de limitation de débit configurable
function limiter({ windowMs = 60_000, max = 600 } = {}) {
  // Retourne le middleware Express de limitation
  return function rateLimit(req, res, next) {
    // Récupère l'horodatage actuel
    const now = Date.now();
    // Détermine la clé d'identification du client
    const key = req.ip || req.socket.remoteAddress || "anon";
    // Récupère le compteur existant pour cette clé
    let bucket = buckets.get(key);
    // Réinitialise le compteur si absent ou si la fenêtre est écoulée
    if (!bucket || now - bucket.start >= windowMs) {
      // Crée un nouveau compteur avec le décompte à zéro
      bucket = { start: now, count: 0 };
      // Enregistre le compteur dans la Map
      buckets.set(key, bucket);
      // Ferme le bloc de réinitialisation
    }
    // Incrémente le nombre de requêtes du client
    bucket.count++;
    // Vérifie si la Map devient trop volumineuse
    if (buckets.size > 2000) {
      // Supprime les compteurs dont la fenêtre est expirée
      for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
      // Ferme le bloc de nettoyage
    }
    // Vérifie si la limite de requêtes est dépassée
    if (bucket.count > max) {
      // Renvoie une erreur 429 (trop de requêtes)
      return res.status(429).json({ error: "Trop de requêtes, réessayez dans un instant." });
      // Ferme le bloc de dépassement
    }
    // Autorise la poursuite du traitement de la requête
    next();
    // Ferme le middleware rateLimit
  };
  // Ferme la fonction limiter
}

// Exporte la fonction limiter
module.exports = { limiter };
