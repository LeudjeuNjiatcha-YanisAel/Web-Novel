// Active le mode strict de JavaScript.
"use strict";

// Importe le module de système de fichiers.
const fs = require("fs");
// Importe le module de gestion des chemins.
const path = require("path");
// Importe la couche d'accès à la base de données.
const db = require("../data/db");

/**
 * Registre des extensions : découverte automatique au démarrage.
 *
 * Le dossier extension/sources/ est scanné (readdir) et chaque fichier *.js
 * est require(), instancié puis exposé. Aucune liste codée en dur : ajouter
 * une source = déposer un fichier puis redémarrer le serveur.
 *
 * Gère l'activation/désactivation persistée en base (id, enabled).
 * Une extension = une source de mangas (API ou site de scans).
 */

// Classe gérant le registre de toutes les extensions (sources).
class ExtensionRegistry {
  // Constructeur : initialise la table des sources puis les charge.
  constructor() {
    // Table associant id de source -> instance.
    this.sources = new Map();
    // Lance la découverte et le chargement de toutes les sources.
    this._loadAll();
  // Fermeture du constructeur.
  }

  // Scanne le dossier sources/ et instancie chaque extension trouvée.
  _loadAll() {
    // Chemin absolu du dossier contenant les fichiers de sources.
    const dir = path.join(__dirname, "sources");
    // Si le dossier n'existe pas, avertit puis arrête le chargement.
    if (!fs.existsSync(dir)) {
      // Message d'avertissement en console.
      console.warn("[extensions] dossier extension/sources/ introuvable");
      // Arrête l'exécution de _loadAll.
      return;
    // Fermeture du bloc if (dossier absent).
    }
    // Liste des fichiers .js du dossier, triés par nom.
    const files = fs
      // Lit le contenu du dossier.
      .readdirSync(dir)
      // Ne conserve que les fichiers se terminant par ".js".
      .filter((f) => f.endsWith(".js"))
      // Trie les noms par ordre alphabétique.
      .sort();
    // Parcourt chaque fichier de source.
    for (const file of files) {
      // Isole le chargement d'un fichier pour qu'une erreur n'arrête pas le reste.
      try {
        // Requiert le module et récupère la classe de la source.
        const SourceClass = require(path.join(dir, file));
        // Instancie la source.
        const instance = new SourceClass();
        // Si un id identique est déjà enregistré, ignore cette source.
        if (this.sources.has(instance.id)) {
          // Avertit d'un id en doublon.
          console.warn(`[extensions] id en doublon ignoré : ${instance.id}`);
          // Passe au fichier suivant.
          continue;
        // Fermeture du bloc if (id en doublon).
        }
        // Lit les préférences d'extensions stockées en base.
        const prefs = db.get("extensions") || {};
        // Récupère la préférence propre à cette source.
        const pref = prefs[instance.id];
        // Si l'utilisateur a explicitement défini l'activation.
        if (pref && typeof pref.enabled === "boolean") {
          // Préférence utilisateur explicite : elle prime sur le défaut de la source.
          instance.enabled = pref.enabled;
        // Sinon (aucune préférence explicite).
        } else {
          // Utilise la valeur par défaut de la source.
          instance.enabled = instance.defaultEnabled !== false;
        // Fermeture du bloc alternatif.
        }
        // Enregistre l'instance dans la table des sources.
        this.sources.set(instance.id, instance);
        // Journalise le chargement réussi de la source.
        console.log(`[extensions] chargée : ${instance.name} (${instance.id})`);
      // Capture les erreurs de chargement d'un fichier.
      } catch (err) {
        // Journalise l'échec et le message d'erreur.
        console.error(`[extensions] échec de ${file} :`, err.message);
      // Fermeture du bloc try/catch.
      }
    // Fermeture de la boucle for sur les fichiers.
    }
    // Journalise le bilan du scan.
    console.log(`[extensions] scan de ${files.length} fichier(s) → ${this.sources.size} source(s) chargée(s)`);
  // Fermeture de la méthode _loadAll.
  }

  // Retourne la liste JSON de toutes les sources.
  list() {
    // Convertit les instances en objets JSON.
    return [...this.sources.values()].map((s) => s.toJSON());
  // Fermeture de la méthode list.
  }

  // Retourne une source donnée, en refusant si absente ou désactivée.
  get(id) {
    // Recherche la source par son id.
    const source = this.sources.get(id);
    // Si la source est introuvable.
    if (!source) {
      // Crée une erreur "inconnue".
      const err = new Error(`Extension inconnue : ${id}`);
      // Associe le code HTTP 404 à l'erreur.
      err.status = 404;
      // Lève l'erreur.
      throw err;
    // Fermeture du bloc if (source absente).
    }
    // Si la source existe mais est désactivée.
    if (!source.enabled) {
      // Crée une erreur "désactivée".
      const err = new Error(`Extension désactivée : ${id}`);
      // Associe le code HTTP 403 à l'erreur.
      err.status = 403;
      // Lève l'erreur.
      throw err;
    // Fermeture du bloc if (source désactivée).
    }
    // Retourne l'instance de la source.
    return source;
  // Fermeture de la méthode get.
  }

  // Active ou désactive une source et persiste le choix en base.
  setEnabled(id, enabled) {
    // Recherche la source par son id.
    const source = this.sources.get(id);
    // Si la source est introuvable.
    if (!source) {
      // Crée une erreur "inconnue".
      const err = new Error(`Extension inconnue : ${id}`);
      // Associe le code HTTP 404 à l'erreur.
      err.status = 404;
      // Lève l'erreur.
      throw err;
    // Fermeture du bloc if (source absente).
    }
    // Met à jour l'état activé sur l'instance (forcé en booléen).
    source.enabled = !!enabled;
    // Persiste la préférence dans la clé "extensions" de la base.
    db.update("extensions", (prefs) => ({
      // Conserve les préférences existantes.
      ...prefs,
      // Écrit/écrase l'entrée de cette source avec l'état et la date.
      [id]: { ...(prefs[id] || {}), enabled: !!enabled, updatedAt: new Date().toISOString() },
    // Fermeture de l'objet de mise à jour retourné par le callback.
    }));
    // Retourne la représentation JSON de la source mise à jour.
    return source.toJSON();
  // Fermeture de la méthode setEnabled.
  }

  /** Sources actives, pour la recherche multi-sources. */
  // Retourne uniquement les sources activées.
  enabled() {
    // Filtre les instances pour ne garder que celles activées.
    return [...this.sources.values()].filter((s) => s.enabled);
  // Fermeture de la méthode enabled.
  }

  // Agrège les genres de toutes les sources actives (sans doublons).
  async genres() {
    // Ensemble des genres uniques.
    const set = new Set();
    // Parcourt chaque source active.
    for (const s of this.enabled()) {
      // Si la source expose une méthode getGenres().
      if (typeof s.getGenres === "function") {
        // Ajoute chaque genre retourné par getGenres().
        for (const g of (await s.getGenres()) || []) set.add(g);
      // Sinon, si la source expose une méthode genres().
      } else if (typeof s.genres === "function") {
        // Ajoute chaque genre retourné par genres().
        for (const g of (await s.genres()) || []) set.add(g);
      // Sinon (genres est un simple tableau).
      } else {
        // Ajoute chaque genre du tableau s.genres.
        for (const g of s.genres || []) set.add(g);
      // Fermeture du bloc alternatif.
      }
    // Fermeture de la boucle for sur les sources.
    }
    // Trie les genres par ordre alphabétique français.
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  // Fermeture de la méthode genres.
  }
// Fermeture de la classe ExtensionRegistry.
}

// Exporte une instance unique (singleton) du registre.
module.exports = new ExtensionRegistry();
