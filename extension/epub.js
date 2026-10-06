"use strict";

const epub = require("epub-gen-memory").default;

/**
 * Génère un EPUB en mémoire (Buffer) à partir des métadonnées d'un novel
 * et de la liste de ses chapitres (title + content HTML).
 *
 * @param {{title: string, author?: string, description?: string, lang?: string}} info
 * @param {Array<{title: string, content: string}>} chapters
 * @returns {Promise<Buffer>}
 */
async function buildEpub(info, chapters) {
  const options = {
    title: info.title,
    author: info.author || "Auteur inconnu",
    description: info.description || "",
    lang: info.lang || "fr",
    tocTitle: "Table des matières",
    fetchTimeout: 20000,
    appendChapterTitles: true,
  };

  const content = chapters.map((ch) => ({
    title: ch.title,
    content: ch.content,
  }));

  return epub(options, content);
}

module.exports = { buildEpub };
