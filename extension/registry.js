"use strict";

const fs = require("fs");
const path = require("path");
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

class ExtensionRegistry {
  constructor() {
    this.sources = new Map();
    this._loadAll();
  }

  _loadAll() {
    const dir = path.join(__dirname, "sources");
    if (!fs.existsSync(dir)) {
      console.warn("[extensions] dossier extension/sources/ introuvable");
      return;
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .sort();
    for (const file of files) {
      try {
        const SourceClass = require(path.join(dir, file));
        const instance = new SourceClass();
        if (this.sources.has(instance.id)) {
          console.warn(`[extensions] id en doublon ignoré : ${instance.id}`);
          continue;
        }
        const prefs = db.get("extensions") || {};
        if (prefs[instance.id] && prefs[instance.id].enabled === false) {
          instance.enabled = false;
        }
        this.sources.set(instance.id, instance);
        console.log(`[extensions] chargée : ${instance.name} (${instance.id})`);
      } catch (err) {
        console.error(`[extensions] échec de ${file} :`, err.message);
      }
    }
    console.log(`[extensions] scan de ${files.length} fichier(s) → ${this.sources.size} source(s) chargée(s)`);
  }

  list() {
    return [...this.sources.values()].map((s) => s.toJSON());
  }

  get(id) {
    const source = this.sources.get(id);
    if (!source) {
      const err = new Error(`Extension inconnue : ${id}`);
      err.status = 404;
      throw err;
    }
    if (!source.enabled) {
      const err = new Error(`Extension désactivée : ${id}`);
      err.status = 403;
      throw err;
    }
    return source;
  }

  setEnabled(id, enabled) {
    const source = this.sources.get(id);
    if (!source) {
      const err = new Error(`Extension inconnue : ${id}`);
      err.status = 404;
      throw err;
    }
    source.enabled = !!enabled;
    db.update("extensions", (prefs) => ({
      ...prefs,
      [id]: { ...(prefs[id] || {}), enabled: !!enabled, updatedAt: new Date().toISOString() },
    }));
    return source.toJSON();
  }

  /** Sources actives, pour la recherche multi-sources. */
  enabled() {
    return [...this.sources.values()].filter((s) => s.enabled);
  }

  async genres() {
    const set = new Set();
    for (const s of this.enabled()) {
      if (typeof s.getGenres === "function") {
        for (const g of (await s.getGenres()) || []) set.add(g);
      } else if (typeof s.genres === "function") {
        for (const g of (await s.genres()) || []) set.add(g);
      } else {
        for (const g of s.genres || []) set.add(g);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }
}

module.exports = new ExtensionRegistry();