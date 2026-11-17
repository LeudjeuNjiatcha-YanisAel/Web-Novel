"use strict";

const BaseSource = require("../BaseSource");
const { httpError, normalize } = require("../utils");
const images = require("../images");

const API_BASES = ["https://api.comick.fun", "https://api.comick.io"];
const SITE = "https://comick.io";
const IMAGE_BASE = "https://meo.comick.pictures";
const TIMEOUT_MS = 8_000;

const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Historical",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "School Life",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
  "Webtoon",
];

const STATUSES = { 1: "ongoing", 2: "completed", 3: "hiatus", 4: "cancelled", 5: "upcoming" };

class ComicKSource extends BaseSource {
  constructor() {
    super({
      id: "comick",
      name: "ComicK",
      baseUrl: SITE,
      lang: "en",
      version: "1.0.0",
      description:
        "Catalogue international ComicK : mangas, manhwa et webtoons. Chapitres francophones en priorité, avec repli automatique sur l'anglais lorsque la traduction FR n'existe pas.",
      genres: GENRES,
      mediaType: "manga",
      color: "#7b6cf6",
      defaultEnabled: true,
    });
  }

  async _get(rawPath) {
    let lastError = null;
    for (const base of API_BASES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(base + rawPath, {
          signal: controller.signal,
          headers: {
            "User-Agent": images.USER_AGENT,
            Accept: "application/json, text/plain, */*",
            Origin: SITE,
            Referer: `${SITE}/`,
          },
        });
        if (res.status === 404) throw httpError(404, "Introuvable sur ComicK");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastError = err;
        if (err.status === 404) throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw httpError(502, `ComicK indisponible (${lastError?.message || "réseau"})`);
  }

  _imageUrl(key) {
    if (!key) return null;
    const str = String(key);
    if (/^https?:\/\//i.test(str)) return str;
    return `${IMAGE_BASE}${str.startsWith("/") ? "" : "/"}${str}`;
  }

  _cover(item) {
    const key = typeof item === "string" ? item : item?.b2key;
    return images.proxied(this._imageUrl(key));
  }

  _brief(m) {
    const genres = (m.md_comic_md_genres || []).map((g) => g.md_genres?.name).filter(Boolean);
    const author = Array.isArray(m.authors) ? m.authors.map((a) => a.name).filter(Boolean).join(", ") : null;
    return {
      id: m.hid || m.slug,
      title: m.title || m.slug || "Sans titre",
      author: author || "Auteur inconnu",
      cover: this._cover(m.md_covers?.[0]),
      status: STATUSES[m.status] || "ongoing",
      genre: genres[0] || "",
      tags: genres,
      rating: Number(m.bayesian_rating) || null,
      popularity: Number(m.follow_count ?? m.user_follow_count) || null,
      year: Number(m.year) || null,
      chapterCount: Number(m.chapter_count) || null,
      description: m.desc || null,
      sourceId: this.id,
      sourceName: this.name,
      mediaType: "manga",
    };
  }

  async getGenres() {
    return GENRES;
  }

  async search(query = "", options = {}) {
    const { genre = "all", status = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    const size = Math.min(100, Math.max(1, Number(limit) || 24));
    const page = Math.floor(Math.max(0, Number(offset) || 0) / size) + 1;
    const params = new URLSearchParams({
      q: String(query || "").trim(),
      limit: String(size),
      page: String(page),
      tachiyomi: "true",
    });
    const data = await this._get(`/v1.0/search?${params}`);
    let results = (Array.isArray(data) ? data : data?.results || []).map((m) => this._brief(m));

    if (genre && genre !== "all") {
      const wanted = normalize(genre);
      results = results.filter((r) => r.tags.some((t) => normalize(t) === wanted));
    }
    if (status && status !== "all") {
      results = results.filter((r) => r.status === status);
    }

    const sorters = {
      relevance: (a, b) => (b.popularity || 0) - (a.popularity || 0),
      popularity: (a, b) => (b.popularity || 0) - (a.popularity || 0),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0),
      recent: (a, b) => (b.year || 0) - (a.year || 0),
      chapters: (a, b) => (b.chapterCount || 0) - (a.chapterCount || 0),
      title: (a, b) => a.title.localeCompare(b.title, "fr"),
    };
    results.sort(sorters[sort] || sorters.relevance);
    return { results, total: Number(data?.total) || results.length };
  }

  async _chapters(hid) {
    let all = [];
    for (const lang of ["fr", "en"]) {
      const chapters = [];
      for (let page = 1; page <= 20; page++) {
        const params = new URLSearchParams({
          lang,
          page: String(page),
          limit: "500",
          "chap-order": "1",
          tachiyomi: "true",
        });
        const data = await this._get(`/comic/${encodeURIComponent(hid)}/chapters?${params}`);
        const batch = data?.chapters || [];
        chapters.push(...batch);
        const total = Number(data?.total) || chapters.length;
        if (batch.length < 500 || chapters.length >= total) break;
      }
      if (chapters.length) {
        all = chapters;
        break;
      }
    }
    return all.map((c, i) => {
      const number = Number(c.chap);
      const title = [`Ch. ${c.chap ?? i + 1}`, c.title].filter(Boolean).join(" - ");
      const groups = c.group_name || c.md_chapters_groups?.map((g) => g.md_groups?.title).filter(Boolean) || [];
      return {
        id: c.hid,
        title: groups.length ? `${title} [${groups.join(", ")}]` : title,
        order: Number.isFinite(number) ? number : i + 1,
        externalUrl: null,
        pages: Number(c.page_count) || 0,
      };
    });
  }

  async getMangaInfo(mangaId) {
    const data = await this._get(`/comic/${encodeURIComponent(mangaId)}`);
    const comic = data?.comic || data?.data;
    if (!comic) throw httpError(404, "Manga introuvable sur ComicK");
    const brief = this._brief(comic);
    const authors = comic.md_authors?.map((a) => a.name).filter(Boolean) || [];
    const artists = comic.md_artists?.map((a) => a.name).filter(Boolean) || [];
    if (authors.length) brief.author = authors.join(", ");
    else if (artists.length) brief.author = artists.join(", ");
    const chapters = await this._chapters(brief.id);
    return { ...brief, chapterCount: chapters.length, chapters };
  }

  async getChapterPages(mangaId, chapterId) {
    const data = await this._get(`/chapter/${encodeURIComponent(chapterId)}?tachiyomi=true`);
    const chapter = data?.chapter || (Array.isArray(data) ? { md_images: data } : data);
    const raw = chapter?.images || chapter?.md_images || [];
    const urls = raw
      .map((img) => (typeof img === "string" ? this._imageUrl(img) : img?.url || this._imageUrl(img?.b2key)))
      .filter(Boolean)
      .map((url) => images.proxied(url));
    if (!urls.length) throw httpError(404, "Aucune page pour ce chapitre");
    return {
      id: String(chapterId),
      title: chapter?.title || null,
      order: Number(chapter?.chap) || null,
      pages: urls,
      pagesLow: [],
      externalUrl: null,
    };
  }
}

module.exports = ComicKSource;
