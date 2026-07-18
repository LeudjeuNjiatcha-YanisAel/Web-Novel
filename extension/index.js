const fs = require("fs");
const path = require("path");

/**
 * Charge dynamiquement toutes les extensions présentes dans ./sources
 * et les expose via un registre indexé par leur id.
 */
class ExtensionRegistry {
  constructor() {
    this.sources = new Map();
    this._loadAll();
  }

  _loadAll() {
    const sourcesDir = path.join(__dirname, "sources");
    if (!fs.existsSync(sourcesDir)) return;

    const files = fs.readdirSync(sourcesDir).filter((f) => f.endsWith(".js"));

    for (const file of files) {
      try {
        const SourceClass = require(path.join(sourcesDir, file));
        const instance = new SourceClass();
        if (this.sources.has(instance.id)) {
          console.warn(`[extensions] id en doublon ignoré : ${instance.id} (${file})`);
          continue;
        }
        this.sources.set(instance.id, instance);
        console.log(`[extensions] chargée : ${instance.name} (${instance.id})`);
      } catch (err) {
        console.error(`[extensions] échec du chargement de ${file} :`, err.message);
      }
    }
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
    return source;
  }
}

module.exports = new ExtensionRegistry();
