// Active le mode strict de JavaScript
"use strict";

/** File d'attente légère pour les tâches longues (export CBZ). */

// Stockage en mémoire des tâches (id -> tâche)
const jobs = new Map();
// Durée de conservation maximale d'une tâche (45 minutes)
const MAX_AGE = 45 * 60 * 1000;

// Crée une nouvelle tâche et l'enregistre
function create({ type, title }) {
  // Génère un identifiant unique pour la tâche
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // Construit l'objet décrivant la tâche
  const job = {
    // Identifiant unique de la tâche
    id,
    // Type de la tâche
    type,
    // Titre lisible de la tâche
    title,
    // Statut initial de la tâche
    status: "running",
    // Progression actuelle (0 au départ)
    progress: 0,
    // Nombre total d'éléments à traiter
    total: 0,
    // Message de statut affiché à l'utilisateur
    message: "Démarrage…",
    // Résultat de la tâche (vide au départ)
    result: null,
    // Erreur éventuelle (vide au départ)
    error: null,
    // Date de création de la tâche
    createdAt: Date.now(),
    // Ferme l'objet job
  };
  // Enregistre la tâche dans la Map
  jobs.set(id, job);
  // Nettoie les tâches trop anciennes
  _gc();
  // Retourne la tâche créée
  return job;
  // Ferme la fonction create
}

// Récupère une tâche par son identifiant
function get(id) {
  // Retourne la tâche ou null si elle n'existe pas
  return jobs.get(id) || null;
  // Ferme la fonction get
}

// Met à jour partiellement une tâche existante
function update(id, patch) {
  // Récupère la tâche à modifier
  const job = jobs.get(id);
  // Abandonne si la tâche n'existe pas
  if (!job) return null;
  // Applique les modifications sur la tâche
  Object.assign(job, patch);
  // Retourne la tâche mise à jour
  return job;
  // Ferme la fonction update
}

// Supprime les tâches trop anciennes (garbage collector)
function _gc() {
  // Récupère l'horodatage actuel
  const now = Date.now();
  // Parcourt toutes les tâches enregistrées
  for (const [id, job] of jobs) {
    // Supprime la tâche si elle a dépassé l'âge maximal
    if (now - job.createdAt > MAX_AGE) jobs.delete(id);
    // Ferme la boucle for
  }
  // Ferme la fonction _gc
}

// Exporte les fonctions publiques du module de tâches
module.exports = { create, get, update };
