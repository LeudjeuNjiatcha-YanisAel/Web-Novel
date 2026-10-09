"use strict";

const { httpError } = require("./utils");

/**
 * BaseSource — contrat de toute extension placée dans extension/sources/.
 *
 * Une extension représente une source (site/API) et sait :
 *   - chercher des mangas            -> search(query, options)
 *   - décrire un manga + ses chapitres -> getMangaInfo(mangaId)
 *   - fournir les pages d'un chapitre  -> getChapterPages(mangaId, chapterId)
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
    author = "OptiManga",
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
    this.installed = true;
    this.enabled = true;
  }

  /**
   * @param {string} query
   * @param {{genre?: string, status?: string, sort?: string, limit?: number, offset?: number}} options
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
   * @param {string} mangaId
   * @returns {Promise<{
   *   id: string, title: string, author?: string, description?: string,
   *   cover?: string, status?: string, genre?: string, tags?: string[],
   *   rating?: number, popularity?: number, year?: number,
   *   chapters: Array<{id: string, title: string, order: number, externalUrl?: string}>
   * }>}
   */
  async getMangaInfo(mangaId) {
    throw httpError(501, `${this.name}: getMangaInfo() non implémentée`);
  }

  async getNovelInfo() {
    throw httpError(501, `${this.name}: getNovelInfo() est remplacé par getMangaInfo() dans cette version`);
  }

  /**
   * @param {string} mangaId
   * @param {string} chapterId
   * @returns {Promise<{id: string, title: string, pages: string[], pagesLow?: string[], order: number, externalUrl?: string}>}
   */
  async getChapterPages(mangaId, chapterId) {
    throw httpError(501, `${this.name}: getChapterPages() non implémentée`);
  }

  async getChapterContent() {
    throw httpError(501, `${this.name}: getChapterContent() est remplacé par getChapterPages() dans cette version`);
  }

  /** Genres proposés par la source (peut être surchargé en asynchrone). */
  async getGenres() {
    return this.genres || [];
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
      installed: this.installed,
      enabled: this.enabled,
    };
  }
}

module.exports = BaseSource;
