// Active le mode strict de JavaScript.
"use strict";

// Importe le helper httpError depuis utils.
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
// Déclare la classe de base dont héritent toutes les extensions.
class BaseSource {
  // Constructeur : reçoit la configuration de la source via un objet déstructuré.
  constructor({
    // Identifiant unique de la source (obligatoire).
    id,
    // Nom affiché de la source (obligatoire).
    name,
    // URL de base du site/API, ou null par défaut.
    baseUrl = null,
    // Langue principale de la source ("fr" par défaut).
    lang = "fr",
    // Version de l'extension.
    version = "1.0.0",
    // Description textuelle de la source.
    description = "",
    // Liste des genres proposés.
    genres = [],
    // Auteur de l'extension.
    author = "OptiManga",
    // Type de média géré ("manga" par défaut).
    mediaType = "manga",
    // Couleur d'accent optionnelle.
    color = null,
    // Indique si la source est activée par défaut.
    defaultEnabled = true,
  // Fermeture de la déstructuration des paramètres du constructeur.
  }) {
    // Vérifie la présence des champs obligatoires, sinon lève une erreur.
    if (!id || !name) throw new Error("Une extension doit avoir un id et un name");
    // Stocke l'identifiant sur l'instance.
    this.id = id;
    // Stocke le nom sur l'instance.
    this.name = name;
    // Stocke l'URL de base sur l'instance.
    this.baseUrl = baseUrl;
    // Stocke la langue sur l'instance.
    this.lang = lang;
    // Stocke la version sur l'instance.
    this.version = version;
    // Stocke la description sur l'instance.
    this.description = description;
    // Stocke les genres sur l'instance.
    this.genres = genres;
    // Stocke l'auteur sur l'instance.
    this.author = author;
    // Stocke le type de média sur l'instance.
    this.mediaType = mediaType;
    // Stocke la couleur sur l'instance.
    this.color = color;
    // Conserve defaultEnabled en le forçant en booléen.
    this.defaultEnabled = defaultEnabled !== false;
    // Marque la source comme installée.
    this.installed = true;
    // Initialise l'état activé à partir de la valeur par défaut.
    this.enabled = this.defaultEnabled;
  // Fermeture du constructeur.
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
  // Méthode de recherche (à implémenter par les sous-classes).
  async search(query, options = {}) {
    // Rejette l'appel : méthode non implémentée dans la classe de base.
    throw httpError(501, `${this.name}: search() non implémentée`);
  // Fermeture de la méthode search.
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
  // Récupère les informations d'un manga et la liste de ses chapitres.
  async getMangaInfo(mangaId) {
    // Rejette l'appel : méthode non implémentée dans la classe de base.
    throw httpError(501, `${this.name}: getMangaInfo() non implémentée`);
  // Fermeture de la méthode getMangaInfo.
  }

  // Ancien nom de getMangaInfo, conservé pour compatibilité.
  async getNovelInfo() {
    // Signale que cette méthode est remplacée par getMangaInfo().
    throw httpError(501, `${this.name}: getNovelInfo() est remplacé par getMangaInfo() dans cette version`);
  // Fermeture de la méthode getNovelInfo.
  }

  /**
   * @param {string} mangaId
   * @param {string} chapterId
   * @returns {Promise<{id: string, title: string, pages: string[], pagesLow?: string[], order: number, externalUrl?: string}>}
   */
  // Récupère la liste des pages d'un chapitre.
  async getChapterPages(mangaId, chapterId) {
    // Rejette l'appel : méthode non implémentée dans la classe de base.
    throw httpError(501, `${this.name}: getChapterPages() non implémentée`);
  // Fermeture de la méthode getChapterPages.
  }

  // Ancien nom de getChapterPages, conservé pour compatibilité.
  async getChapterContent() {
    // Signale que cette méthode est remplacée par getChapterPages().
    throw httpError(501, `${this.name}: getChapterContent() est remplacé par getChapterPages() dans cette version`);
  // Fermeture de la méthode getChapterContent.
  }

  /** Genres proposés par la source (peut être surchargé en asynchrone). */
  // Retourne les genres de la source (surchargeable en asynchrone).
  async getGenres() {
    // Renvoie le tableau des genres, ou un tableau vide.
    return this.genres || [];
  // Fermeture de la méthode getGenres.
  }

  /** Métadonnées publiques exposées à l'API. */
  // Sérialise la source en objet JSON exposé à l'API.
  toJSON() {
    // Construit l'objet des métadonnées publiques.
    return {
      // Identifiant de la source.
      id: this.id,
      // Nom de la source.
      name: this.name,
      // URL de base.
      baseUrl: this.baseUrl,
      // Langue.
      lang: this.lang,
      // Version.
      version: this.version,
      // Description.
      description: this.description,
      // Genres.
      genres: this.genres,
      // Auteur.
      author: this.author,
      // Type de média.
      mediaType: this.mediaType,
      // Couleur.
      color: this.color,
      // Statut d'installation.
      installed: this.installed,
      // Statut d'activation.
      enabled: this.enabled,
    // Fermeture de l'objet retourné.
    };
  // Fermeture de la méthode toJSON.
  }
// Fermeture de la classe BaseSource.
}

// Exporte la classe pour les autres modules.
module.exports = BaseSource;
