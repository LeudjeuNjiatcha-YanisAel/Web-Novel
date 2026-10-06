"use strict";

/** Hash déterministe d'une chaîne (djb2). */
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** Sélection déterministe d'un élément dans une liste à partir d'une graine. */
function pick(list, seed) {
  if (!list || !list.length) return null;
  return list[Math.abs(seed) % list.length];
}

/** Retire les balises HTML et compte les mots approximatifs. */
function wordCount(html) {
  const text = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(" ").length;
}

/** Normalise une chaîne pour la comparer (accents, casse). */
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Sécurise un titre pour en faire un nom de fichier. */
function slugify(str) {
  return (
    String(str || "sans-titre")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "sans-titre"
  );
}

/** Erreur HTTP utilitaire. */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { hashString, pick, wordCount, normalize, slugify, httpError };
