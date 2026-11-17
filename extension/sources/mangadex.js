"use strict";
// Force l'exécution en mode strict JavaScript pour intercepter erreurs silencieuses.

const BaseSource = require("../BaseSource");
// Importe la classe de base des sources pour hériter de l'interface commune (recherche, info, chapitres, pages).
const md = require("../mangadex-client");
// Client HTTP MangaDex : gestion des requêtes, helpers d'URL, mapping des relations et normalisation.
const { httpError } = require("../utils");
// Utilitaire de création d'erreur HTTP pour remonter 404/erreurs réseau de façon cohérente.

/**
 * Source MangaDex — API publique api.mangadex.org.
 * Catalogue mondial (scans hébergés + chapitres externes vers l'éditeur),
 * recherche par titre, filtres genre (tags), statut, tris, pagination.
 */

const GENRE_KEYS = [
// Liste de tags « genre » privilégiés pour composer le filtre Genres dans l'interface.
  "Action",
// Tag officiel MangaDex « Action » exposé dans les filtres.
  "Adventure",
// Tag officiel MangaDex « Aventure » exposé dans les filtres.
  "Comedy",
// Tag officiel MangaDex « Comédie » exposé dans les filtres.
  "Drama",
// Tag officiel MangaDex « Drame » exposé dans les filtres.
  "Fantasy",
// Tag officiel MangaDex « Fantastique » exposé dans les filtres.
  "Horror",
// Tag officiel MangaDex « Horreur » exposé dans les filtres.
  "Mystery",
// Tag officiel MangaDex « Mystère » exposé dans les filtres.
  "Romance",
// Tag officiel MangaDex « Romance » exposé dans les filtres.
  "Sci-Fi",
// Tag officiel MangaDex « Science-Fiction » exposé dans les filtres.
  "Slice of Life",
// Tag officiel MangaDex « Tranche de vie » exposé dans les filtres.
  "Sports",
// Tag officiel MangaDex « Sports » exposé dans les filtres.
  "Supernatural",
// Tag officiel MangaDex « Surnaturel » exposé dans les filtres.
  "Thriller",
// Tag officiel MangaDex « Thriller » exposé dans les filtres.
  "Psychological",
// Tag officiel MangaDex « Psychologique » exposé dans les filtres.
  "Tragedy",
// Tag officiel MangaDex « Tragédie » exposé dans les filtres.
  "Historical",
// Tag officiel MangaDex « Historique » exposé dans les filtres.
  "Mecha",
// Tag officiel MangaDex « Mecha » exposé dans les filtres.
  "Medical",
// Tag officiel MangaDex « Médical » exposé dans les filtres.
  "Martial Arts",
// Tag officiel MangaDex « Arts martiaux » exposé dans les filtres.
  "Military",
// Tag officiel MangaDex « Militaire » exposé dans les filtres.
  "Detective",
// Tag officiel MangaDex « Détective » exposé dans les filtres.
  "Police",
// Tag officiel MangaDex « Police » exposé dans les filtres.
  "School Life",
// Tag officiel MangaDex « Vie scolaire » exposé dans les filtres.
  "Gore",
// Tag officiel MangaDex « Gore » exposé dans les filtres.
  "Music",
// Tag officiel MangaDex « Musique » exposé dans les filtres.
  "Parody",
// Tag officiel MangaDex « Parodie » exposé dans les filtres.
];
// Termine la liste des tags « genre » sélectionnés.

const FALLBACK_TAGS = {
// Mapping de secours des UUIDs MangaDex pour les tags « genre » si l'API « /manga/tag » est injoignable.
  Action: "391b0423-d847-456f-aff0-8b0cfc03066b",
// UUID de secours pour le tag « Action ».
  Adventure: "87cc87cd-a395-47af-b27a-93258283bbc6",
// UUID de secours pour le tag « Aventure ».
  Comedy: "4d32cc48-9f00-4cca-9b5a-a839f0764984",
// UUID de secours pour le tag « Comédie ».
  Drama: "b9af3a63-f058-46de-a9a0-e0c13906197a",
// UUID de secours pour le tag « Drame ».
  Fantasy: "cdc58593-87dd-415e-bbc0-2ec27bf404cc",
// UUID de secours pour le tag « Fantastique ».
  Horror: "cdad7e68-1419-41dd-bdce-27753074a640",
// UUID de secours pour le tag « Horreur ».
  Mystery: "ee968100-4191-4968-93d3-f82d72be7e46",
// UUID de secours pour le tag « Mystère ».
  Romance: "423e2eae-a7a2-4a8b-ac03-a8351462d71d",
// UUID de secours pour le tag « Romance ».
  "Sci-Fi": "256c8bd9-4904-4360-bf4f-508a76d67183",
// UUID de secours pour le tag « Science-Fiction ».
  "Slice of Life": "e5301a23-ebd9-49dd-a0cb-2add944c7fe9",
// UUID de secours pour le tag « Tranche de vie ».
  Sports: "69964a64-2f90-4d33-beeb-f3ed2875eb4c",
// UUID de secours pour le tag « Sports ».
  Thriller: "07251805-a27e-4d59-b488-f0bfbec15168",
// UUID de secours pour le tag « Thriller ».
  Psychological: "3b60b75c-a2d7-4860-ab56-05f391bb889c",
// UUID de secours pour le tag « Psychologique ».
  Tragedy: "f8f62932-27da-4fe4-8ee1-6779a8c5edba",
// UUID de secours pour le tag « Tragédie ».
  Historical: "33771934-028e-4cb3-8744-691e866a923e",
// UUID de secours pour le tag « Historique ».
  Mecha: "50880a9d-5440-4732-9afb-8f457127e836",
// UUID de secours pour le tag « Mecha ».
  Medical: "c8cbe35b-1b2b-4a3f-9c37-db84c4514856",
// UUID de secours pour le tag « Médical ».
};
// Termine le mapping de secours des UUIDs de tags « genre ».

const SORTS = {
// Mapping des critères de tri de l'interface vers les champs d'ordre MangaDex.
  relevance: { key: "followedCount", dir: "desc" },
// Tri par pertinence : utilise le nombre de followers (MangaDex) pour prioriser titres suivis.
  popularity: { key: "followedCount", dir: "desc" },
// Tri par popularité : basé sur le nombre de followers (ordre décroissant).
  rating: { key: "followedCount", dir: "desc" },
// Tri par note : mappé sur le critère suivi (conservé tel que dans le code d'origine).
  recent: { key: "latestUploadedChapter", dir: "desc" },
// Tri par récence : privilégie les mangas avec le dernier chapitre uploadé le plus récent.
  chapters: { key: "followedCount", dir: "desc" },
// Tri par nombre de chapitres : mappé sur le critère suivi (conservé tel que dans le code d'origine).
  title: { key: "title", dir: "asc" },
// Tri par titre : ordre alphabétique croissant sur le titre du manga.
};
// Termine la configuration des tris de recherche.

class MangadexSource extends BaseSource {
// Source principale MangaDex (multi-langues FR/EN) héritant du modèle commun.
  constructor() {
// Initialise la source MangaDex avec ses métadonnées et son état.
    super({
// Paramètres de base transmis à la classe mère pour enregistrer la source.
      id: "mangadex",
// Identifiant unique de la source.
      name: "MangaDex",
// Nom affiché dans l'interface.
      baseUrl: "https://mangadex.org",
// URL de base du site MangaDex (liens externes/affichage).
      lang: "fr",
// Langue par défaut de la source.
      version: "2.0.0",
// Version du sourceur.
      author: "OptiManga",
// Auteur/créateur du sourceur.
      description:
// Description affichée de la source.
        "Bibliothèque mondiale de scans (API officielle MangaDex). Chapitres FR/EN, liens externes vers les éditeurs pour les titres sous licence.",
// Texte de présentation (métadonnées de la source).
    });
    this.languages = ["fr", "en"];
// Langues de chapitres demandées à l'API (chapitres traduits FR ou EN).
    this.contentRating = ["safe", "suggestive"];
// Filtre de contenu autorisé (safe et suggestive) pour exclure mature/explicit selon politique de l'extension.
    this._tagIds = null;
// Cache des tags « genre » (Map nom -> {id,label}) ; null = non chargé.
    this._genreLabels = [];
// Cache des libellés de genres exposés à l'interface (déjà filtrés/uniques).
  }
// Termine le constructeur de MangadexSource.

  async _tagMap() {
// Charge et met en cache la carte des tags « genre » MangaDex (nom anglais -> {id, label}).
    if (this._tagIds) return this._tagIds;
// Retourne le cache s'il est déjà disponible (évite requêtes répétées).
    const map = new Map();
// Initialise la carte locale des tags mappés par nom.
    try {
      const data = await md.get("/manga/tag");
// Appelle l'endpoint officiel pour lister tous les tags (groupés).
      for (const t of data.data || []) {
        const attrs = t.attributes || {};
// Extrait les attributs du tag (nom, group, etc.).
        if (attrs.group !== "genre") continue;
// Ne conserve que les tags du groupe « genre ».
        const en = ((attrs.name || {}).en || "").trim();
// Récupère le nom anglais du tag (clé de normalisation).
        if (!en) continue;
// Ignore les tags sans libellé anglais.
        map.set(en, { id: t.id, label: (attrs.name.fr || en).trim() });
// Enregistre le mapping : clé = nom anglais, valeur = { id UUID, label affichable (FR si présent, sinon EN) }.
      }
    } catch {
      for (const [key, id] of Object.entries(FALLBACK_TAGS)) {
        map.set(key, { id, label: key });
// Enregistre chaque tag de secours avec label = clé.
      }
    }
    this._tagIds = map;
// Met en cache la carte des tags.
    return map;
// Retourne la carte des tags « genre ».
  }
// Termine la méthode de chargement/mapping des tags « genre ».

  async getGenres() {
// Retourne la liste des libellés de genres exposés au filtre de recherche.
    if (this._genreLabels.length) return this._genreLabels;
// Retourne le cache des genres s'il est déjà calculé.
    const map = await this._tagMap();
// Récupère la carte complète des tags « genre » (API ou secours).
    const out = [];
// Tableau des libellés uniques à exposer dans l'interface.
    for (const key of GENRE_KEYS) {
      const tag = map.get(key);
// Recherche le tag correspondant par nom anglais.
      if (tag && !out.includes(tag.label)) out.push(tag.label);
// Ajoute le libellé s'il n'est pas déjà présent.
    }
    for (const [, tag] of map) {
      if (GENRE_KEYS.includes(tag.label) || out.includes(tag.label)) continue;
// Ignore les tags déjà présents.
      const isCurated = GENRE_KEYS.some((k) => tag.label.toLowerCase() === k.toLowerCase());
// Vérifie correspondance insensitive casse avec curated.
      if (!isCurated && out.length < 24) out.push(tag.label);
// Ajoute jusqu'à 24 genres au total.
    }
    this._genreLabels = out;
// Met en cache la liste des genres exposés.
    return out;
// Retourne la liste finale des libellés de genres.
  }
// Termine la méthode de récupération des genres pour le filtre UI.

  async search(query = "", options = {}) {
// Recherche des mangas sur MangaDex selon titre, genre, statut, tri et pagination.
    const { genre = "all", status = "all", sort = "relevance", limit = 24, offset = 0 } = options;

    const params = new URLSearchParams();
    params.set("limit", String(Math.min(100, Math.max(1, Number(limit) || 24))));
    params.set("offset", String(Math.max(0, Number(offset) || 0)));
    params.set("hasAvailableChapters", "true");
    params.set("includes[]", "cover_art");
    params.set("includes[]", "author");
    params.set("includes[]", "artist");
    params.set("order[followedCount]", "desc");
    for (const lang of this.languages) params.append("availableTranslatedLanguage[]", lang);
    for (const cr of this.contentRating) params.append("contentRating[]", cr);

    const q = String(query || "").trim();
    if (q) params.set("title", q);

    if (genre && genre !== "all") {
      const map = await this._tagMap();
      const match = [...map.values()].find((t) => t.label === genre) || map.get(genre);
      if (match) params.append("includedTags[]", match.id);
    }
    if (status && status !== "all") {
      const valid = ["ongoing", "completed", "hiatus", "cancelled"];
      if (valid.includes(status)) params.append("status[]", status);
    }

    const s = SORTS[sort] || SORTS.relevance;
    params.delete("order[followedCount]");
    params.set(`order[${s.key}]`, s.dir);

    const data = await md.get(`/manga?${params}`);
    const items = data.data || [];
    const results = items.map((m) => this._brief(m));

    const ids = items.map((m) => m.id);
    if (ids.length) {
      try {
        const stat = await md.get(`/statistics/manga?${ids.map((id) => `manga%5B%5D=${id}`).join("&")}`);
        const st = (stat && stat.statistics) || {};
        for (const r of results) {
          const sstat = st[r.id] || {};
          if (Number.isFinite(sstat.follows)) r.popularity = sstat.follows;
          if (sstat.rating && Number.isFinite(sstat.rating.bayesian)) r.rating = +Number(sstat.rating.bayesian).toFixed(2);
        }
      } catch {
      }
    }

    const missingCovers = results.filter((r) => !r.cover);
    if (missingCovers.length && missingCovers.length <= 100) {
      try {
        const coverParams = new URLSearchParams();
        coverParams.set("limit", String(missingCovers.length));
        for (const r of missingCovers) coverParams.append("ids[]", r.id);
        coverParams.set("includes[]", "cover_art");
        const coverData = await md.get(`/manga?${coverParams}`);
        const byId = new Map(
          (coverData.data || []).map((m) => [
            m.id,
            md.coverUrl(m.id, md.relationshipOf(m.relationships, "cover_art", "fileName")),
          ])
        );
        for (const r of missingCovers) {
          const url = byId.get(r.id);
          if (url) r.cover = url;
        }
      } catch {
      }
    }

    return { results, total: Number(data.total) || results.length };
  }
// Termine la méthode de recherche.

  async getMangaInfo(mangaId) {
// Récupère les métadonnées détaillées d'un manga (incl. chapitres) depuis MangaDex.
    const data = await md.get(
      `/manga/${encodeURIComponent(mangaId)}?includes[]=cover_art&includes[]=author&includes[]=artist`
    );
    const m = data.data;
    if (!m) throw httpError(404, "Manga introuvable sur MangaDex");
    const chapters = await this._chapters(mangaId);
    return { ...this._brief(m), chapterCount: chapters.length, chapters };
  }
// Termine la récupération des informations détaillées d'un manga.

  async _chapters(mangaId) {
// Récupère l'intégralité des chapitres du manga (pagination 100 par lot) en appliquant filtres de langues/contenu.
    const chapters = [];
    let offset = 0;
    let total = 1;
    for (;;) {
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.set("offset", String(offset));
      params.set("order[volume]", "asc");
      params.set("order[chapter]", "asc");
      params.set("includes[]", "scanlation_group");
      for (const lang of this.languages) params.append("translatedLanguage[]", lang);
      for (const cr of this.contentRating) params.append("contentRating[]", cr);

      const data = await md.get(`/manga/${encodeURIComponent(mangaId)}/feed?${params}`);
      const rows = data.data || [];
      total = Number(data.total) || rows.length;
      for (const c of rows) {
        const attrs = c.attributes || {};
        const hasId = Boolean(c.id) && String(attrs.chapter || "").trim() !== "" && attrs.title != null;
        if (!hasId) continue;
        const order = Number(attrs.chapter);
        chapters.push({
          id: c.id,
          title: attrs.title || `Chapitre ${attrs.chapter}`,
          chapterNum: String(attrs.chapter),
          volume: attrs.volume || null,
          order: Number.isFinite(order) ? order : chapters.length + 1,
          externalUrl: attrs.externalUrl || null,
          pages: attrs.pages || 0,
          group: this._groupName(c.relationships),
        });
      }
      if (!rows.length || chapters.length >= total || offset + rows.length >= total) break;
      offset += rows.length;
    }

    chapters.sort(
      (a, b) => a.order - b.order || String(a.chapterNum).localeCompare(b.chapterNum, "en", { numeric: true })
    );
    return chapters;
  }
// Termine la récupération paginée des chapitres.

  _groupName(relationships) {
// Extrait le nom du groupe de scanlation à partir des relations d'un chapitre MangaDex.
    const rel = (relationships || []).find((r) => r.type === "scanlation_group");
    const name = rel && rel.attributes ? rel.attributes.name : null;
    const siteId = rel && rel.attributes ? rel.attributes.siteId : null;
    if (name) return name;
    if (siteId) return "Scanlation officielle";
    return null;
  }
// Termine l'extraction du nom de groupe de scanlation.

  async getChapterPages(mangaId, chapterId) {
// Récupère les URLs des pages d'un chapitre hébergé sur MangaDex (@Home server).
    const data = await md.get(`/at-home/server/${encodeURIComponent(chapterId)}`);
    const chapter = data && data.chapter;
    if (!chapter || !chapter.hash) throw httpError(404, "Chapitre non hébergé sur MangaDex");
    const base = data.baseUrl;
    const hash = chapter.hash;
    const pages = (chapter.data || []).map((f) => `${base}/data/${hash}/${f}`);
    const pagesLow = (chapter.dataSaver || []).map((f) => `${base}/data-saver/${hash}/${f}`);
    return { id: chapterId, title: null, order: null, pages, pagesLow, externalUrl: null };
  }
// Termine la récupération des pages d'un chapitre.

  _brief(m) {
// Transforme un objet manga MangaDex (API v5) en résumé normalisé pour l'affichage/recherche.
    const attrs = m.attributes || {};
    const title = md.titleOf(attrs) || md.altTitleOf(attrs) || "Sans titre";
    const coverFile = md.relationshipOf(m.relationships, "cover_art", "fileName");
    const author =
      md.relationshipOf(m.relationships, "author", "name") ||
      md.relationshipOf(m.relationships, "artist", "name") ||
      "";
    const tags = md.tagNames(attrs);
    return {
      id: m.id,
      title,
      author: author ? author.replace(/ ?\(.*?\)$/, "").trim() : "Auteur inconnu",
      cover: md.coverUrl(m.id, coverFile),
      status: md.statusOf(attrs.status),
      genre: tags[0] || "",
      tags,
      rating: null,
      popularity: null,
      year: attrs.year || null,
      chapterCount: null,
      description: md.descriptionOf(attrs),
      sourceId: this.id,
      sourceName: this.name,
    };
  }
// Termine la transformation d'un manga en résumé normalisé.
}
// Termine la déclaration de la classe MangadexSource.

module.exports = MangadexSource;
// Exporte la classe MangadexSource pour enregistrement par le gestionnaire de sources.