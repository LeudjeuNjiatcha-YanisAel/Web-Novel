// Active le mode strict de JavaScript
"use strict";

/** Cache mémoire TTL — évite de régénérer les métadonnées et contenus. */

// Stockage en mémoire des entrées du cache (clé -> valeur)
const store = new Map();

// Récupère une valeur du cache si elle n'a pas expiré
function get(key) {
  // Lit l'entrée correspondant à la clé
  const entry = store.get(key);
  // Retourne undefined si aucune entrée n'existe
  if (!entry) return undefined;
  // Vérifie si l'entrée a dépassé sa date d'expiration
  if (Date.now() > entry.expires) {
    // Supprime l'entrée expirée du cache
    store.delete(key);
    // Retourne undefined pour signaler l'absence de valeur valide
    return undefined;
  }
  // Retourne la valeur mise en cache
  return entry.value;
  // Ferme la fonction get
}

// Enregistre une valeur dans le cache avec une durée de vie
function set(key, value, ttlMs = 60_000) {
  // Stocke la valeur avec son horodatage d'expiration
  store.set(key, { value, expires: Date.now() + ttlMs });
  // Vérifie si le cache dépasse sa taille maximale
  if (store.size > 500) {
    // Récupère la première clé insérée (la plus ancienne)
    const firstKey = store.keys().next().value;
    // Supprime cette entrée la plus ancienne
    store.delete(firstKey);
    // Ferme le bloc de limitation de taille
  }
  // Retourne la valeur enregistrée
  return value;
  // Ferme la fonction set
}

// Renvoie une valeur du cache ou la calcule via un producteur
function wrap(key, ttlMs, producer) {
  // Tente de lire une valeur déjà en cache
  const cached = get(key);
  // Retourne la valeur en cache si elle existe
  if (cached !== undefined) return Promise.resolve(cached);
  // Sinon exécute le producteur puis met le résultat en cache
  return Promise.resolve(producer()).then((value) => set(key, value, ttlMs));
  // Ferme la fonction wrap
}

// Vide le cache, éventuellement filtré par préfixe de clé
function clear(prefix) {
  // Vide entièrement le cache s'il n'y a pas de préfixe
  if (!prefix) return store.clear();
  // Parcourt toutes les clés du cache
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
  // Ferme la fonction clear
}

// Exporte les fonctions publiques du module de cache
module.exports = { get, set, wrap, clear };
