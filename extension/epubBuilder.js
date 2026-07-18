const epub = require("epub-gen-memory").default;

/**
 * Génère un EPUB en mémoire (Buffer) à partir des infos d'un novel
 * et d'une liste de chapitres déjà récupérés (title + content en HTML).
 *
 * @param {{title: string, author?: string, description?: string}} novelInfo
 * @param {Array<{title: string, content: string}>} chapters
 * @returns {Promise<Buffer>}
 */
async function buildEpub(novelInfo, chapters) {
  const options = {
    title: novelInfo.title,
    author: novelInfo.author || "Auteur inconnu",
    description: novelInfo.description || "",
    lang: "fr",
    tocTitle: "Table des matières",
    fetchTimeout: 20000,
  };

  const content = chapters.map((ch) => ({
    title: ch.title,
    content: ch.content,
  }));

  return epub(options, content);
}

module.exports = { buildEpub };
