// Active le mode strict de JavaScript
"use strict";

/** Hash déterministe d'une chaîne (djb2). */
// Calcule un hash numérique déterministe à partir d'une chaîne
function hashString(str) {
  // Initialise la valeur de hachage avec la graine djb2
  let h = 5381;
  // Parcourt chaque caractère de la chaîne
  for (let i = 0; i < str.length; i++) {
    // Applique la formule djb2 en forçant un entier non signé
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    // Ferme la boucle for
  }
  // Retourne le hash final en entier non signé
  return h >>> 0;
  // Ferme la fonction hashString
}

/** Sélection déterministe d'un élément dans une liste à partir d'une graine. */
// Choisit un élément de la liste de façon déterministe selon une graine
function pick(list, seed) {
  // Retourne null si la liste est vide ou absente
  if (!list || !list.length) return null;
  // Retourne l'élément à l'index obtenu à partir de la graine
  return list[Math.abs(seed) % list.length];
  // Ferme la fonction pick
}

/** Retire les balises HTML et compte les mots approximatifs. */
// Compte approximativement les mots après suppression du HTML
function wordCount(html) {
  // Convertit en texte et retire les balises puis normalise les espaces
  const text = String(html || "")
    // Remplace chaque balise HTML par un espace
    .replace(/<[^>]*>/g, " ")
    // Remplace les entités HTML par un espace
    .replace(/&[a-z]+;/gi, " ")
    // Réduit les suites d'espaces à un seul espace
    .replace(/\s+/g, " ")
    // Retire les espaces en début et fin de chaîne
    .trim();
  // Retourne 0 si le texte est vide
  if (!text) return 0;
  // Sépare sur les espaces et retourne le nombre de mots
  return text.split(" ").length;
  // Ferme la fonction wordCount
}

/** Normalise une chaîne pour la comparer (accents, casse). */
// Normalise une chaîne en minuscules sans accents
function normalize(str) {
  // Convertit en chaîne puis applique les normalisations successives
  return String(str || "")
    // Met la chaîne en minuscules
    .toLowerCase()
    // Décompose les caractères accentués (forme NFD)
    .normalize("NFD")
    // Supprime les marques diacritiques (accents)
    .replace(/[\u0300-\u036f]/g, "");
  // Ferme la fonction normalize
}

/** Sécurise un titre pour en faire un nom de fichier. */
// Transforme un titre en identifiant adapté à un nom de fichier
function slugify(str) {
  // Construit le slug à partir de la chaîne fournie
  return (
    // Utilise la chaîne fournie ou une valeur par défaut
    String(str || "sans-titre")
      // Décompose les caractères accentués
      .normalize("NFD")
      // Supprime les accents
      .replace(/[\u0300-\u036f]/g, "")
      // Remplace tout caractère non alphanumérique par un tiret
      .replace(/[^a-zA-Z0-9]+/g, "-")
      // Retire les tirets en début et fin
      .replace(/^-+|-+$/g, "")
      // Met le résultat en minuscules
      .toLowerCase()
      // Limite la longueur du slug à 60 caractères
      .slice(0, 60) || "sans-titre"
    // Ferme l'expression du slug
  );
  // Ferme la fonction slugify
}

/** Erreur HTTP utilitaire. */
// Crée une erreur portant un code de statut HTTP
function httpError(status, message) {
  // Instancie une erreur avec le message fourni
  const err = new Error(message);
  // Attache le code de statut HTTP à l'erreur
  err.status = status;
  // Retourne l'erreur
  return err;
  // Ferme la fonction httpError
}

// Exporte les utilitaires du module
module.exports = { hashString, pick, wordCount, normalize, slugify, httpError };
