"use strict";

const BaseSource = require("../BaseSource");
const md = require("../mangadex-client");
const { httpError } = require("../utils");

/**
 * Source MangaDex — API publique api.mangadex.org.
 * Catalogue mondial (scans hébergés + chapitres externes vers l'éditeur),
 * recherche par titre, filtres genre (tags), statut, tris, pagination.
 */

// Ordre d'affichage des genres proposés aux filtres.
const GENRE_KEYS = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
  "Psychological",
  "Tragedy",
  "Historical",
  "Mecha",
  "Medical",
  "Martial Arts",
  "Military",
  "Detective",
  "Police",
  "School Life",
  "Gore",
  "Music",
  "Parody",
];

// Filet de sécurité si GET /manga/tag échoue (ids vérifiés le 08/2026).
const FALLBACK_TAGS = {
  Action: "391b0423-d847-456f-aff0-8b0cfc03066b",
  Adventure: "87cc87cd-a395-47af-b27a-93258283bbc6",
  Comedy: "4d32cc48-9f00-4cca-9b5a-a839f0764984",
  Drama: "b9af3a63-f058-46de-a9a0-e0c13906197a",
  Fantasy: "cdc58593-87dd-415e-bbc0-2ec27bf404cc",
  Horror: "cdad7e68-1419-41dd-bdce-27753074a640",
  Mystery: "ee968100-4191-4968-93d3-f82d72be7e46",
  Romance: "423e2eae-a7a2-4a8b-ac03-a8351462d71d",
  "Sci-Fi": "256c8bd9-4904-4360-bf4f-508a76d67183",
  "Slice of Life": "e5301a23-ebd9-49dd-a0cb-2add944c7fe9",
  Sports: "69964a64-2f90-4d33-beeb-f3ed2875eb4c",
  Thriller: "07251805-a27e-4d59-b488-f0bfbec15168",
  Psychological: "3b60b75c-a2d7-4860-ab56-05f391bb889c",
  Tragedy: "f8f62932-27da-4fe4-8ee1-6779a8c5edba",
  Historical: "33771934-028e-4cb3-8744-691e866a923e",
  Mecha: "50880a9d-5440-4732-9afb-8f457127e836",
  Medical: "c8cbe35b-1b2b-4a3f-9c37-db84c4514856",
};

const SORTS = {
  relevance: { key: "followedCount", dir: "desc" },
  popularity: { key: "followedCount", dir: "desc" },
  rating: { key: "followedCount", dir: "desc" },
  recent: { key: "latestUploadedChapter", dir: "desc" },
  chapters: { key: "followedCount", dir: "desc" },
  title: { key: "title", dir: "asc" },
};

class MangadexSource extends BaseSource {
  constructor() {
    super({
      id: "mangadex",
      name: "MangaDex",
      baseUrl: "https://mangadex.org",
      lang: "fr",
      version: "2.0.0",
      author: "MangaHub",
      description:
        "Bibliothèque mondiale de scans (API officielle MangaDex). Chapitres FR/EN, liens externes vers les éditeurs pour les titres sous licence.",
    });
    this.languages = ["fr", "en"];
    this.contentRating = ["safe", "suggestive"];
    this._tagIds = null;
    this._genreLabels = [];
  }

  // ---- Genres (tags MangaDex, cache) -------------------------------------

  async _tagMap() {
    if (this._tagIds) return this._tagIds;
    const map = new Map();
    try {
      const data = await md.get("/manga/tag");
      for (const t of data.data || []) {
        const attrs = t.attributes || {};
        if (attrs.group !== "genre") continue;
        const en = ((attrs.name || {}).en || "").trim();
        if (!en) continue;
        map.set(en, { id: t.id, label: (attrs.name.fr || en).trim() });
      }
    } catch {
      // fallback hors-ligne
      for (const [key, id] of Object.entries(FALLBACK_TAGS)) {
        map.set(key, { id, label: key });
      }
    }
    this._tagIds = map;
    return map;
  }

  async getGenres() {
    if (this._genreLabels.length) return this._genreLabels;
    const map = await this._tagMap();
    const out = [];
    for (const key of GENRE_KEYS) {
      const tag = map.get(key);
      if (tag && !out.includes(tag.label)) out.push(tag.label);
    }
    for (const [, tag] of map) {
      if (GENRE_KEYS.includes(tag.label) || out.includes(tag.label)) continue;
      const isCurated = GENRE_KEYS.some((k) => tag.label.toLowerCase() === k.toLowerCase());
      if (!isCurated && out.length < 24) out.push(tag.label);
    }
    this._genreLabels = out;
    return out;
  }

  // ---- Recherche ----------------------------------------------------------

  async search(query = "", options = {}) {
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

    // Enrichissement rating / popularité en un seul appel groupé.
    const ids = items.map((m) => m.id);
    if (ids.length) {
      try {
        const stat = await md.get(`/statistics/manga?${ids.map((id) => `manga%5B%5D=${id}`).join("&")}`);
        const st = (stat && stat.statistics) || {};
        for (const r of results) {
          const s = st[r.id] || {};
          if (Number.isFinite(s.follows)) r.popularity = s.follows;
          if (s.rating && Number.isFinite(s.rating.bayesian)) r.rating = +Number(s.rating.bayesian).toFixed(2);
        }
      } catch {
        /* statistiques optionnelles */
      }
    }

    return { results, total: Number(data.total) || results.length };
  }

  // ---- Fiche manga --------------------------------------------------------

  async getMangaInfo(mangaId) {
    const data = await md.get(
      `/manga/${encodeURIComponent(mangaId)}?includes[]=cover_art&includes[]=author&includes[]=artist`
    );
    const m = data.data;
    if (!m) throw httpError(404, "Manga introuvable sur MangaDex");
    const chapters = await this._chapters(mangaId);
    return { ...this._brief(m), chapterCount: chapters.length, chapters };
  }

  async _chapters(mangaId) {
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
        // On ignore les en-têtes sans titre ni numéro (pages de garde de volume).
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

  _groupName(relationships) {
    const rel = (relationships || []).find((r) => r.type === "scanlation_group");
    const name = rel && rel.attributes ? rel.attributes.name : null;
    const siteId = rel && rel.attributes ? rel.attributes.siteId : null;
    if (name) return name;
    if (siteId) return "Scanlation officielle";
    return null;
  }

  // ---- Pages de chapitre --------------------------------------------------

  async getChapterPages(mangaId, chapterId) {
    const data = await md.get(`/at-home/server/${encodeURIComponent(chapterId)}`);
    const chapter = data && data.chapter;
    if (!chapter || !chapter.hash) throw httpError(404, "Chapitre non hébergé sur MangaDex");
    const base = data.baseUrl;
    const hash = chapter.hash;
    const pages = (chapter.data || []).map((f) => `${base}/data/${hash}/${f}`);
    const pagesLow = (chapter.dataSaver || []).map((f) => `${base}/data-saver/${hash}/${f}`);
    return { id: chapterId, title: null, order: null, pages, pagesLow, externalUrl: null };
  }

  // ---- Mapping ------------------------------------------------------------

  _brief(m) {
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
}

module.exports = MangadexSource;