"use strict";

const BaseSource = require("../BaseSource");

const API_BASE = "https://api.mangadex.org";
const UPLOADS_BASE = "https://uploads.mangadex.org";

function parseCover(manga) {
  const rel = (manga.relationships || []).find((r) => r.type === "cover_art");
  if (!rel || !rel.attributes || !rel.attributes.fileName) return null;
  return `${UPLOADS_BASE}/covers/${manga.id}/${rel.attributes.fileName}.512.jpg`;
}

function parseAuthor(manga) {
  const rel = (manga.relationships || []).find((r) => r.type === "author");
  if (rel && rel.attributes) return rel.attributes.name || null;
  const artist = (manga.relationships || []).find((r) => r.type === "artist");
  if (artist && artist.attributes) return artist.attributes.name || null;
  return null;
}

function getTitle(manga) {
  const t = manga.attributes?.title || {};
  return t.fr || t.en || t.ja || t["ja-ro"] || Object.values(t)[0] || "Sans titre";
}

function getDescription(manga) {
  const d = manga.attributes?.description || {};
  return d.fr || d.en || d.pt || d.de || Object.values(d)[0] || "";
}

function toStatus(s) {
  if (s === "ongoing") return "ongoing";
  if (s === "completed") return "completed";
  if (s === "hiatus") return "hiatus";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "unknown";
}

function mapManga(manga) {
  const id = manga.id;
  const title = getTitle(manga);
  const desc = getDescription(manga);
  const cover = parseCover(manga);
  const author = parseAuthor(manga);
  const tags = (manga.attributes?.tags || []).map((t) => {
    const n = t.attributes?.name || {};
    return n.fr || n.en || Object.values(n)[0] || "";
  });
  const genres = tags;
  const contentRating = manga.attributes?.contentRating || "safe";
  const status = toStatus(manga.attributes?.status);
  const year = manga.attributes?.year || null;
  const lastChapter = manga.attributes?.lastChapter || null;

  return {
    id,
    title,
    description: desc,
    cover,
    author,
    genres,
    tags,
    status,
    year,
    contentRating,
    chapterCount: lastChapter ? Number(lastChapter) : undefined,
    popularity: undefined,
    rating: undefined,
  };
}

class MangaDexSource extends BaseSource {
  constructor() {
    super({
      id: "mangadex",
      name: "MangaDex",
      baseUrl: "https://mangadex.org",
      lang: "fr",
      version: "1.0.0",
      description: "Catalogue de mangas avec chapitres en français (Dragon Ball, One Piece, Naruto...).",
      genres: ["Action", "Aventure", "Comédie", "Drame", "Shōnen", "Seinen", "Shōjo"],
      author: "MangaDex",
      type: "manga",
    });
  }

  async search(query = "", options = {}) {
    const params = new URLSearchParams();
    params.set("includes[]", "cover_art");
    params.set("includes[]", "author");
    params.set("includes[]", "artist");
    params.set("includes[]", "tag");
    params.set("limit", "20");
    params.set("order[followedCount]", "desc");

    if (query && query.trim()) {
      params.set("title", query.trim());
    }

    if (options.status && options.status !== "all") {
      params.append("status[]", options.status);
    }

    params.append("contentRating[]", "safe");
    params.append("contentRating[]", "suggestive");

    if (options.sort === "latest") params.set("order[latestUploadedChapter]", "desc");
    if (options.sort === "title") params.set("order[title]", "asc");

    if (options.genre && options.genre !== "all") {
      // Pas de mapping direct simple ici, on filtre côté client léger si besoin
    }

    const url = `${API_BASE}/manga?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`MangaDex: ${res.status}`);
    const data = await res.json();
    const results = (data.data || []).map(mapManga);
    return results;
  }

  async getNovelInfo(novelId) {
    const params = new URLSearchParams();
    params.set("includes[]", "cover_art");
    params.set("includes[]", "author");
    params.set("includes[]", "artist");
    params.set("includes[]", "tag");

    const url = `${API_BASE}/manga/${novelId}?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`MangaDex: ${res.status}`);
    const json = await res.json();
    const base = mapManga(json.data);

    const chapters = await this._fetchChapters(novelId);
    return {
      ...base,
      chapters: chapters.map((c, i) => ({
        id: c.id,
        title: c.title ? `Chap. ${c.chapter || "?"} — ${c.title}` : `Chapitre ${c.chapter || i + 1}`,
        order: i + 1,
        volume: c.volume,
        chapter: c.chapter,
        pages: c.pages,
      })),
    };
  }

  async _fetchChapters(mangaId) {
    const all = [];
    let offset = 0;
    const limit = 500;
    while (true) {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      params.set("manga", mangaId);
      params.set("translatedLanguage[]", "fr");
      params.set("translatedLanguage[]", "en");
      params.append("order[chapter]", "asc");
      params.append("order[volume]", "asc");
      params.set("includeExternalUrl", "0");
      const url = `${API_BASE}/chapter?${params.toString()}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) break;
      const data = await res.json();
      const items = data.data || [];
      all.push(...items);
      offset += items.length;
      if (items.length < limit) break;
    }
    return all
      .map((ch) => {
        const attr = ch.attributes || {};
        let chapterNum = null;
        if (attr.chapter !== null && attr.chapter !== undefined && attr.chapter !== "") {
          const n = Number(attr.chapter);
          chapterNum = Number.isFinite(n) ? n : String(attr.chapter);
        }
        return {
          id: ch.id,
          title: attr.title || "",
          volume: attr.volume,
          chapter: chapterNum,
          pages: attr.pages || 0,
        };
      })
      .filter((c) => c.pages > 0)
      .sort((a, b) => {
        const va = a.volume === null ? 99999 : Number(a.volume) || 99999;
        const vb = b.volume === null ? 99999 : Number(b.volume) || 99999;
        if (va !== vb) return va - vb;
        const ca = a.chapter === null ? 99999 : (typeof a.chapter === "number" ? a.chapter : Number(a.chapter) || 99999);
        const cb = b.chapter === null ? 99999 : (typeof b.chapter === "number" ? b.chapter : Number(b.chapter) || 99999);
        if (ca !== cb) return ca - cb;
        return 0;
      });
  }

  async getChapterContent(novelId, chapterId) {
    return {
      id: chapterId,
      title: "",
      content: `<div data-manga-chapter="${chapterId}" data-manga-novel="${novelId}" data-manga-source="mangadex"></div>`,
      order: 0,
      wordCount: 0,
    };
  }
}

module.exports = MangaDexSource;
