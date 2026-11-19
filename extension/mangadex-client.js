// Active le mode strict de JavaScript.
"use strict";

// Importe le helper httpError depuis utils.
const { httpError } = require("./utils");
// Importe le proxy d'images pour contourner le bot challenge du CDN MangaDex.
const images = require("./images");

/**
 * Client minimal de l'API publique MangaDex (api.mangadex.org).
 * - throttle global (~5 requêtes / seconde)
 * - retry sur 429 / 5xx et timeouts
 * - helpers de mapping (titre, couverture, relations…)
 */

// URL de base de l'API MangaDex.
const API = "https://api.mangadex.org";
// URL de base du CDN des couvertures.
const COVER_CDN = "https://uploads.mangadex.org/covers";
// User-Agent envoyé à l'API MangaDex.
const UA = "OptiManga/2.0 (lecteur auto-hébergé; node-fetch)";

// Intervalle minimal (ms) entre deux requêtes.
const MIN_INTERVAL = 220;
// Horodatage de la dernière requête effectuée.
let lastRequest = 0;
// File d'attente sérialisant les requêtes (promesse chaînée).
let queue = Promise.resolve();

// Enveloppe une fonction pour la throttle et la sérialiser.
function throttle(fn) {
  // Chaîne l'exécution après la requête précédente.
  const run = queue.then(async () => {
    // Calcule le temps d'attente restant depuis la dernière requête.
    const wait = Math.max(0, MIN_INTERVAL - (Date.now() - lastRequest));
    // Attend si nécessaire avant d'émettre la requête.
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Enregistre l'instant de la requête courante.
    lastRequest = Date.now();
    // Exécute la fonction fournie et retourne son résultat.
    return fn();
  // Fermeture du callback exécuté dans la file.
  });
  // Met à jour la file en absorbant les erreurs pour ne pas la bloquer.
  queue = run.then(() => {}, () => {});
  // Retourne la promesse de l'exécution courante.
  return run;
// Fermeture de la fonction throttle.
}

// Effectue une requête HTTP avec retry et timeout.
async function _fetch(path, { timeout = 20000 } = {}) {
  // Conserve la dernière erreur rencontrée.
  let lastErr = null;
  // Tente jusqu'à 3 fois la requête.
  for (let attempt = 0; attempt < 3; attempt++) {
    // Contrôleur permettant d'annuler la requête.
    const ctrl = new AbortController();
    // Minuteur déclenchant l'annulation au bout du délai.
    const timer = setTimeout(() => ctrl.abort(), timeout);
    // Bloc principal de la tentative.
    try {
      // Lance la requête GET vers l'API.
      const res = await fetch(API + path, {
        // En-têtes HTTP demandés par l'API.
        headers: { "User-Agent": UA, Accept: "application/json" },
        // Signal d'annulation lié au minuteur.
        signal: ctrl.signal,
      // Fermeture de l'objet options du fetch.
      });
      // Annule le minuteur dès la réponse reçue.
      clearTimeout(timer);
      // En cas de limitation ou d'erreur serveur, réessaie.
      if (res.status === 429 || res.status >= 500) {
        // Mémorise l'erreur HTTP.
        lastErr = new Error(`MangaDex HTTP ${res.status}`);
        // Attend un délai croissant avant le nouvel essai.
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        // Passe à la tentative suivante.
        continue;
      // Fermeture du bloc if (429 / 5xx).
      }
      // Pour les autres erreurs HTTP (4xx), échoue immédiatement.
      if (!res.ok) {
        // Lit le corps de la réponse, sans échouer si vide.
        const text = await res.text().catch(() => "");
        // Lève une erreur HTTP enrichie du corps tronqué.
        throw httpError(res.status, `MangaDex HTTP ${res.status}${text ? ` : ${text.slice(0, 140)}` : ""}`);
      // Fermeture du bloc if (réponse non OK).
      }
      // Retourne le corps JSON de la réponse.
      return await res.json();
    // Capture les erreurs réseau ou les exceptions levées.
    } catch (err) {
      // Annule le minuteur.
      clearTimeout(timer);
      // Mémorise l'erreur.
      lastErr = err;
      // Une erreur métier (avec status) est relancée immédiatement.
      if (err.status) throw err;
      // Sinon, attend un délai croissant avant le nouvel essai.
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    // Fermeture du bloc try/catch.
    }
  // Fermeture de la boucle for des tentatives.
  }
  // Après 3 échecs, lève une erreur "injoignable".
  throw httpError(502, `MangaDex injoignable : ${lastErr.message || "timeout"}`);
// Fermeture de la fonction _fetch.
}

/** Requête GET JSON (throttlée + retry). */
// Effectue une requête GET throttlée vers l'API.
function get(path) {
  // Enveloppe _fetch dans le throttle.
  return throttle(() => _fetch(path));
// Fermeture de la fonction get.
}

// ---- Helpers de mapping ----------------------------------------------------

// Construit l'URL de la couverture d'un manga.
function coverUrl(mangaId, fileName, size = "512") {
  // Sans identifiant ni fichier, pas de couverture.
  if (!mangaId || !fileName) return null;
  // MangaDex conserve l'extension d'origine puis ajoute la taille : uuid.jpg.512.jpg.
  const base = String(fileName).replace(/\.(?:256|512)\.jpg$/i, "");
  // Demande une couverture redimensionnée : l'original pèse souvent plusieurs Mo.
  const direct = `${COVER_CDN}/${mangaId}/${base}.${size}.jpg`;
  // Passe par le proxy : le CDN refuse le User-Agent des navigateurs.
  return images.proxied(direct);
// Ferme la fonction coverUrl.
}

// Choisit le meilleur titre disponible selon la langue.
function titleOf(mangaAttrs) {
  // Récupère l'objet des titres (ou objet vide).
  const title = (mangaAttrs && mangaAttrs.title) || {};
  // Retourne le premier titre trouvé selon l'ordre de préférence.
  return (
    // Titre français.
    title.fr ||
    // Titre fr-fr.
    title["fr-fr"] ||
    // Titre fr-ca.
    title["fr-ca"] ||
    // Titre anglais.
    title.en ||
    // Titre en-gb.
    title["en-gb"] ||
    // Titre romanisé japonais.
    title["ja-ro"] ||
    // Titre japonais.
    title.ja ||
    // Sinon le premier titre de la liste.
    Object.values(title)[0] ||
    // Sinon une chaîne vide.
    ""
  // Fermeture du choix de titre.
  );
// Fermeture de la fonction titleOf.
}

// Choisit un titre alternatif selon la langue.
function altTitleOf(mangaAttrs) {
  // Sans liste de titres alternatifs, retourne null.
  if (!mangaAttrs || !Array.isArray(mangaAttrs.altTitles)) return null;
  // Parcourt chaque titre alternatif.
  for (const alt of mangaAttrs.altTitles) {
    // Ne traite que les entrées de type objet.
    if (alt && typeof alt === "object") {
      // Choisit la première valeur linguistique disponible.
      const v = alt.fr || alt["fr-fr"] || alt["fr-ca"] || alt.en || alt["ja-ro"];
      // Retourne la valeur si elle existe.
      if (v) return v;
    // Fermeture du bloc if (entrée objet).
    }
  // Fermeture de la boucle for.
  }
  // Aucun titre alternatif trouvé.
  return null;
// Fermeture de la fonction altTitleOf.
}

// Extrait la valeur d'une relation par type et attribut.
function relationshipOf(relationships, type, attrName = "name") {
  // Cherche la relation correspondant au type demandé.
  const rel = (relationships || []).find((r) => r.type === type);
  // Retourne l'attribut s'il existe, sinon null.
  return rel && rel.attributes && attrName in rel.attributes ? rel.attributes[attrName] : null;
// Fermeture de la fonction relationshipOf.
}

// Extrait une liste de noms de tags (dédupliqués, plafonnés).
function tagNames(mangaAttrs, max = 8) {
  // Tableau accumulant les libellés retenus.
  const out = [];
  // Parcourt les tags du manga.
  for (const t of (mangaAttrs && mangaAttrs.tags) || []) {
    // Récupère l'objet des noms du tag.
    const name = (t.attributes && t.attributes.name) || {};
    // Choisit le libellé français ou anglais.
    const label = name.fr || name.en;
    // Ajoute le libellé s'il est nouveau.
    if (label && !out.includes(label)) out.push(label);
    // Arrête une fois la limite atteinte.
    if (out.length >= max) break;
  // Fermeture de la boucle for.
  }
  // Retourne la liste des libellés.
  return out;
// Fermeture de la fonction tagNames.
}

// Normalise le statut d'un manga vers une valeur connue.
function statusOf(status) {
  // Table de correspondance des statuts.
  const map = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };
  // Retourne le statut mappé, ou "unknown".
  return map[status] || "unknown";
// Fermeture de la fonction statusOf.
}

// Choisit la meilleure description selon la langue.
function descriptionOf(mangaAttrs) {
  // Récupère l'objet des descriptions (ou objet vide).
  const desc = (mangaAttrs && mangaAttrs.description) || {};
  // Retourne la première description disponible.
  return (desc.fr || desc["fr-ca"] || desc.en || "") || "";
// Fermeture de la fonction descriptionOf.
}

// Objet exportant l'API publique du client MangaDex.
module.exports = {
  // Requête GET JSON.
  get,
  // Construit l'URL d'une couverture.
  coverUrl,
  // Meilleur titre.
  titleOf,
  // Titre alternatif.
  altTitleOf,
  // Attribut d'une relation.
  relationshipOf,
  // Noms de tags.
  tagNames,
  // Statut normalisé.
  statusOf,
  // Description.
  descriptionOf,
// Fermeture de l'objet module.exports.
};
