"use strict";

const { httpError } = require("./utils");

/**
 * BaseSource — contrat de toute extension placée dans extension/sources/.
 *
 * Une extension représente un site / une bibliothèque et sait :
 *   - chercher des novels            -> search(query, options)
 *   - décrire un novel + ses chapitres -> getNovelInfo(novelId)
 *   - fournir le contenu d'un chapitre -> getChapterContent(novelId, chapterId)
 *
 * Toutes les méthodes sont asynchrones et peuvent lever httpError(status, msg).
 */
class BaseSource {
  constructor({
    id,
    name,
    baseUrl = null,
    lang = "fr",
    version = "1.0.0",
    description = "",
    genres = [],
    author = "NovelHub",
    type = "novel",
  }) {
    if (!id || !name) throw new Error("Une extension doit avoir un id et un name");
    this.id = id;
    this.name = name;
    this.baseUrl = baseUrl;
    this.lang = lang;
    this.version = version;
    this.description = description;
    this.genres = genres;
    this.author = author;
    this.type = type;
    this.installed = true;
    this.enabled = true;
  }

  /**
   * @param {string} query
   * @param {{genre?: string, status?: string, sort?: string}} options
   * @returns {Promise<Array<{
   *   id: string, title: string, author?: string, cover?: string,
   *   status?: string, genre?: string, tags?: string[], rating?: number,
   *   popularity?: number, year?: number, chapterCount?: number
   * }>>}
   */
  async search(query, options = {}) {
    throw httpError(501, `${this.name}: search() non implémentée`);
  }

  /**
   * @param {string} novelId
   * @returns {Promise<{
   *   id: string, title: string, author?: string, description?: string,
   *   cover?: string, status?: string, genre?: string, tags?: string[],
   *   rating?: number, popularity?: number, year?: number,
   *   chapters: Array<{id: string, title: string, order: number}>
   * }>}
   */
  async getNovelInfo(novelId) {
    throw httpError(501, `${this.name}: getNovelInfo() non implémentée`);
  }

  /**
   * @param {string} novelId
   * @param {string} chapterId
   * @returns {Promise<{id: string, title: string, content: string, order: number, wordCount: number}>}
   */
  async getChapterContent(novelId, chapterId) {
    throw httpError(501, `${this.name}: getChapterContent() non implémentée`);
  }

  /** Métadonnées publiques exposées à l'API. */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      baseUrl: this.baseUrl,
      lang: this.lang,
      version: this.version,
      description: this.description,
      genres: this.genres,
      author: this.author,
      type: this.type,
      installed: this.installed,
      enabled: this.enabled,
    };
  }
}

module.exports = BaseSource;
