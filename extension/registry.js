"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../data/db");

/**
 * Registre des extensions : charge automatiquement extension/sources/*.js,
 * gère l'activation/désactivation persistée, et expose le catalogue des
 * extensions disponibles (non installées).
 */

const AVAILABLE = [
  {
    id: "mangadex",
    name: "MangaDex",
    domain: "mangadex.org",
    version: "—",
    lang: "fr",
    description: "Catalogue de mangas (Dragon Ball, One Piece, Naruto...). À ajouter pour apparaître dans le catalogue.",
  },
  {
    id: "royalroad",
    name: "RoyalRoad",
    domain: "royalroad.com",
    version: "—",
    lang: "en",
    description: "Fiction en ligne anglophone. Nécessite une extension de scraping dédiée et le respect de ses CGU.",
  },
  {
    id: "webnovel",
    name: "WebNovel",
    domain: "webnovel.com",
    version: "—",
    lang: "multi",
    description: "Plateforme de web fiction. Source non installée : le module d'accès doit être écrit et maintenu séparément.",
  },
  {
    id: "scribblehub",
    name: "ScribbleHub",
    domain: "scribblehub.com",
    version: "—",
    lang: "en",
    description: "Catalogue communautaire. Disponible dans le magasin d'extensions, installation manuelle.",
  },
  {
    id: "syosetu",
    name: "Shōsetsuka ni Narō",
    domain: "syosetu.com",
    version: "—",
    lang: "ja",
    description: "Source japonaise de serialized fiction. Packaging requis avant activation.",
  },
];

class ExtensionRegistry {
  constructor() {
    this.sources = new Map();
    this._loadAll();
  }

  _loadAll() {
    const dir = path.join(__dirname, "sources");
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
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
  }

  list() {
    return [...this.sources.values()].map((s) => s.toJSON());
  }

  available() {
    return AVAILABLE;
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

  genres() {
    const set = new Set();
    for (const s of this.enabled()) for (const g of s.genres || []) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }
}

module.exports = new ExtensionRegistry();
