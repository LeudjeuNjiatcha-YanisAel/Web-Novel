/**
 * BaseSource
 * ----------
 * Contrat que doit respecter toute extension (source) ajoutée dans
 * extension/sources/. Chaque extension représente "un site" et sait
 * comment chercher, décrire et récupérer le contenu des novels qu'il propose.
 *
 * Pour créer une nouvelle extension :
 *   1. Créer un fichier dans extension/sources/mon-site.js
 *   2. Exporter une classe qui étend BaseSource
 *   3. Implémenter search(), getNovelInfo() et getChapterContent()
 *   4. Elle sera chargée automatiquement par extension/index.js
 */
class BaseSource {
  constructor({ id, name, baseUrl, lang = "fr" }) {
    if (!id || !name) {
      throw new Error("Une extension doit avoir au minimum un id et un name");
    }
    this.id = id;
    this.name = name;
    this.baseUrl = baseUrl || null;
    this.lang = lang;
  }

  /**
   * Recherche des novels par mot-clé.
   * @param {string} query
   * @returns {Promise<Array<{id: string, title: string, cover?: string, author?: string}>>}
   */
  async search(query) {
    throw new Error(`${this.name}: search() non implémentée`);
  }

  /**
   * Récupère les infos détaillées d'un novel + la liste (ordonnée) de ses chapitres.
   * @param {string} novelId
   * @returns {Promise<{
   *   id: string, title: string, author?: string, description?: string,
   *   cover?: string, status?: string,
   *   chapters: Array<{id: string, title: string, order: number}>
   * }>}
   */
  async getNovelInfo(novelId) {
    throw new Error(`${this.name}: getNovelInfo() non implémentée`);
  }

  /**
   * Récupère le contenu texte/html d'un chapitre précis.
   * @param {string} novelId
   * @param {string} chapterId
   * @returns {Promise<{title: string, content: string}>}
   */
  async getChapterContent(novelId, chapterId) {
    throw new Error(`${this.name}: getChapterContent() non implémentée`);
  }

  /** Métadonnées publiques exposées côté API (sans détails internes) */
  toJSON() {
    return { id: this.id, name: this.name, lang: this.lang };
  }
}

module.exports = BaseSource;
