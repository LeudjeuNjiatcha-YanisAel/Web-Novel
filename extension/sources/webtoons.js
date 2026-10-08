"use strict";

const BaseSource = require("../BaseSource");
const { httpError } = require("../utils");
const images = require("../images");

/**
 * Source WEBTOON — scraping de www.webtoons.com (officiel, Naver/Webtoon).
 *
 * Pages consultées :
 *   - /fr/search?keyword=…      recherche (sections ORIGINAL + CANVAS)
 *   - /fr/                      accueil (catalogue sans requête : tendances,
 *                               populaires, nouveautés, hebdo, CANVAS)
 *   - /fr/{genre}/{slug}/list…  fiche + liste des épisodes (paginée, 10/page)
 *   - …/viewer?title_no=…&episode_no=…  pages d'un épisode (HTML complet)
 *
 * Les images sont servies par pstatic.net avec hotlink protection (403 hors
 * Referer webtoons.com) : leurs URLs passent par le proxy /api/image.
 *
 * Un « titre » WEBTOON = un genre + un slug + un numéro de série (title_no) ;
 * les saisons longues sont découpées en plusieurs title_no côté éditeur.
 * id interne : `${genre}__${slug}__${titleNo}` (URL-safe).
 */

const BASE = "https://www.webtoons.com";

// Genres des classements WEBTOON : code -> libellé (aligné sur MangaDex pour
// que les filtres de genres restent communs entre les sources).
const GENRES = [
  ["ACTION", "Action"],
  ["COMEDY", "Comedy"],
  ["DRAMA", "Drama"],
  ["FANTASY", "Fantasy"],
  ["ROMANCE", "Romance"],
  ["SF", "Sci-Fi"],
  ["SLICE_OF_LIFE", "Slice of Life"],
  ["SUPER_HERO", "Super Hero"],
  ["THRILLER", "Thriller"],
  ["HISTORICAL", "Historical"],
  ["SPORTS", "Sports"],
];
const LABEL_BY_CODE = new Map(GENRES);
const CODE_BY_LABEL = new Map(GENRES.map(([code, label]) => [label.toLowerCase(), code]));
// Libellés affichés par WEBTOON FR, ramenés aux codes ci-dessus.
const CODE_BY_FR_LABEL = {
  action: "ACTION",
  comédie: "COMEDY",
  comedie: "COMEDY",
  drama: "DRAMA",
  fantastique: "FANTASY",
  fantasy: "FANTASY",
  historique: "HISTORICAL",
  romance: "ROMANCE",
  sf: "SF",
  "science-fiction": "SF",
  sport: "SPORTS",
  sports: "SPORTS",
  "tranche de vie": "SLICE_OF_LIFE",
  "superhéros": "SUPER_HERO",
  "superheros": "SUPER_HERO",
  "super-héros": "SUPER_HERO",
  "super-heros": "SUPER_HERO",
  thriller: "THRILLER",
};

// ---------------------------------------------------------------------------
// Utilitaires HTML (regex ciblées : le site est rendu côté serveur)
// ---------------------------------------------------------------------------

function decodeEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function textOf(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** "3,2M Vues" / "472K" / "841 848" -> nombre entier. */
function parseCount(str) {
  const cleaned = String(str || "").replace(/\s/g, "");
  const m = /([\d]+(?:[.,]\d+)?)\s*([kmb])?/i.exec(cleaned);
  if (!m) return null;
  let n = Number.parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") n *= 1e3;
  else if (suffix === "m") n *= 1e6;
  else if (suffix === "b") n *= 1e9;
  return Math.round(n);
}

function prettify(segment) {
  return String(segment || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function getHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": images.USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
      },
    });
  } catch (err) {
    throw httpError(502, `WEBTOON injoignable (${err.message})`);
  }
  if (res.status === 404) throw httpError(404, "Page WEBTOON introuvable");
  if (!res.ok) throw httpError(502, `WEBTOON : réponse HTTP ${res.status}`);
  return await res.text();
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Cartes de titre (recherche, classements, accueil). */
function parseCards(html) {
  const out = [];
  const re = /<a\s([^>]+)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const hrefM = /href="([^"]+)"/.exec(attrs);
    if (!hrefM || !/data-title-no="\d+"/.test(attrs)) continue;

    const pathM = /\/fr\/([a-z0-9%-]+)\/([a-z0-9%-]+)\/list(?:\?|$)/i.exec(hrefM[1]);
    if (!pathM) continue;
    const titleNoM = /[?&]title_no=(\d+)/.exec(hrefM[1]) || /data-title-no="(\d+)"/.exec(attrs);
    if (!titleNoM) continue;

    const titleM = /class="title">([\s\S]*?)<\/strong>/.exec(body);
    const authorM = /class="author">([\s\S]*?)<\/div>/.exec(body);
    const coverM = /<img[^>]*\bsrc="([^"]+)"/.exec(body);
    const viewsM = /class="view_count[^"]*">([\s\S]*?)<\/(?:div|span)>/.exec(body);
    const genreM = /class="genre[^"]*">([^<]+)</.exec(body);
    const dataGenreM = /data-genre="([A-Z_]+)"/.exec(attrs);

    const genrePath = pathM[1].toLowerCase();
    const genreLabel = genreM
      ? textOf(genreM[1])
      : LABEL_BY_CODE.get(genrePath.toUpperCase().replace(/-/g, "_")) ||
        (genrePath === "canvas" ? "CANVAS" : prettify(genrePath));
    // CANVAS regroupe tous les genres : on retombe sur le libellé affiché.
    const code = dataGenreM
      ? dataGenreM[1]
      : genrePath === "canvas"
        ? CODE_BY_FR_LABEL[genreLabel.toLowerCase()] || "CANVAS"
        : genrePath.toUpperCase().replace(/-/g, "_");

    const title = textOf(titleM ? titleM[1] : "") || textOf(/alt="([^"]+)"/.exec(body)?.[1] || "");
    if (!title) continue;

    out.push({
      titleNo: titleNoM[1],
      genrePath,
      slug: pathM[2],
      title,
      author: authorM ? textOf(authorM[1]) : "",
      cover: coverM ? decodeEntities(coverM[1]) : null,
      views: viewsM ? parseCount(viewsM[1]) : null,
      genreLabel,
      code,
    });
  }
  return out;
}

/** Épisodes d'une page de liste (10 par page, du plus récent au plus ancien). */
function parseEpisodes(html) {
  const out = [];
  const re = /<li[^>]*\bdata-episode-no="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html))) {
    const no = Number(m[1]);
    const body = m[2];
    const hrefM = /href="([^"]+)"/.exec(body);
    if (!hrefM || !Number.isFinite(no)) continue;
    const subjM = /class="subj">([\s\S]*?)<\/span>/.exec(body);
    const dateM = /class="date">([^<]*)</.exec(body);
    out.push({
      no,
      href: decodeEntities(hrefM[1]),
      title: subjM ? textOf(subjM[1]) : `Épisode ${no}`,
      date: dateM ? textOf(dateM[1]) : null,
    });
  }
  return out;
}

/** Pagination d'une page de liste : numéros découverts + page suivante. */
function parsePagination(html) {
  const box = /<div class="paginate">([\s\S]*?)<\/div>/.exec(html);
  if (!box) return { pages: [], next: null };
  const pages = [];
  let next = null;
  const anchorRe = /<a\s([^>]+)>/g;
  let a;
  while ((a = anchorRe.exec(box[1]))) {
    const attrs = a[1];
    const hrefM = /href="([^"]+)"/.exec(attrs);
    if (!hrefM) continue;
    const pgM = /[?&]page=(\d+)/.exec(hrefM[1]);
    if (pgM) pages.push(Number(pgM[1]));
    if (/\bpg_next\b/.test(attrs) && pgM) next = Number(pgM[1]);
  }
  return { pages, next };
}

/** Métadonnées d'une page de liste (= fiche du titre). */
function parseTitleInfo(html) {
  const h1M = /<h1 class="subj">([\s\S]*?)<\/h1>/.exec(html);
  const ogTitleM = /<meta property="og:title" content="([^"]*)"/.exec(html);
  const ogUrlM = /<meta property="og:url" content="([^"]*)"/.exec(html);
  const ogImageM = /<meta property="og:image" content="([^"]*)"/.exec(html);
  const authorM = /<div class="author_area">([\s\S]*?)<\/div>/.exec(html);
  const summaryM = /<p class="summary">([\s\S]*?)<\/p>/.exec(html);
  const genreM = /<h2 class="genre[^"]*">([^<]*)<\/h2>/.exec(html);
  const viewsM = /<ul class="grade_area">[\s\S]*?<em class="cnt">([^<]+)<\/em>/.exec(html);
  const dayM = /<p class="day_info">([\s\S]*?)<\/p>/.exec(html);

  const title = textOf(h1M ? h1M[1] : ogTitleM ? ogTitleM[1] : "").replace(/\s*[\|·-]\s*WEBTOON\s*$/i, "");
  const author = authorM
    ? textOf(authorM[1].replace(/<button[\s\S]*?<\/button>/g, "")).replace(/\s*,\s*/g, ", ")
    : "";
  const genreLabel = genreM ? textOf(genreM[1]) : "";
  const code = ogUrlM
    ? (/\/fr\/([a-z0-9%-]+)\//i.exec(ogUrlM[1]) || [])[1]?.toUpperCase().replace(/-/g, "_") || null
    : CODE_BY_FR_LABEL[genreLabel.toLowerCase()] || CODE_BY_LABEL.get(genreLabel.toLowerCase()) || null;

  return {
    title,
    author,
    description: summaryM ? textOf(summaryM[1]) : "",
    cover: ogImageM ? decodeEntities(ogImageM[1]) : null,
    genreLabel,
    genreCode: code,
    views: viewsM ? parseCount(viewsM[1]) : null,
    status: dayM && /txt_ico_completed/.test(dayM[1]) ? "completed" : "ongoing",
  };
}

/** URLs des pages d'un épisode (conteneur #_imageList, classe `_images`). */
function parseViewerImages(html) {
  const start = html.indexOf('id="_imageList"');
  if (start < 0) return [];
  const end = html.indexOf("</div>", start);
  const segment = html.slice(start, end > start ? end : undefined);
  const out = [];
  const imgRe = /<img\b[^>]*>/g;
  let m;
  while ((m = imgRe.exec(segment))) {
    const tag = m[0];
    const classM = /class="([^"]*)"/.exec(tag);
    if (!classM || !/\b_images\b/.test(classM[1])) continue;
    const urlM = /data-url="([^"]+)"/.exec(tag);
    if (urlM) out.push(decodeEntities(urlM[1]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// id interne : `${genre}__${slug}__${titleNo}`
// ---------------------------------------------------------------------------

function encodeId(genrePath, slug, titleNo) {
  return [genrePath, slug, String(titleNo)].map((part) => encodeURIComponent(part)).join("__");
}

function decodeId(raw) {
  const parts = String(raw || "").split("__");
  if (parts.length !== 3) throw httpError(404, "Titre WEBTOON introuvable");
  let decoded;
  try {
    decoded = parts.map((part) => decodeURIComponent(part));
  } catch {
    decoded = parts;
  }
  const [genrePath, slug, titleNo] = decoded;
  if (!/^[a-z0-9-]{1,40}$/i.test(genrePath) || !/^[a-z0-9-]{1,120}$/i.test(slug) || !/^\d{1,10}$/.test(titleNo)) {
    throw httpError(404, "Titre WEBTOON introuvable");
  }
  return { genrePath: genrePath.toLowerCase(), slug, titleNo };
}

function listUrl(id, page = 1) {
  const url = `${BASE}/fr/${encodeURIComponent(id.genrePath)}/${id.slug}/list?title_no=${id.titleNo}`;
  return page > 1 ? `${url}&page=${page}` : url;
}

function genreCodeFromLabel(label) {
  const key = String(label || "").toLowerCase();
  return CODE_BY_LABEL.get(key) || CODE_BY_FR_LABEL[key] || key.toUpperCase().replace(/\s+/g, "_");
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

class WebtoonsSource extends BaseSource {
  constructor() {
    super({
      id: "webtoons",
      name: "WEBTOON",
      baseUrl: BASE,
      lang: "fr",
      version: "1.0.0",
      author: "MangaHub",
      description:
        "Plateforme officielle WEBTOON (Naver) : séries dessinées en français, ORIGINALS et CANVAS. Lecture gratuite, épisodes hebdomadaires découpés par saison.",
    });
    this.genres = GENRES.map(([, label]) => label);
  }

  // ---- Recherche ----------------------------------------------------------

  async search(query = "", options = {}) {
    const { genre = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    const q = String(query || "").trim();

    const html = await getHtml(
      q ? `${BASE}/fr/search?keyword=${encodeURIComponent(q)}` : `${BASE}/fr/`
    );

    const seen = new Set();
    let cards = parseCards(html).filter((c) => {
      const key = `${c.genrePath}/${c.slug}/${c.titleNo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (genre && genre !== "all") {
      const wanted = genreCodeFromLabel(genre);
      cards = cards.filter((c) => c.code === wanted);
    }

    const sorters = {
      popularity: (a, b) => (b.views || 0) - (a.views || 0),
      chapters: (a, b) => (b.views || 0) - (a.views || 0),
      title: (a, b) => a.title.localeCompare(b.title, "fr"),
    };
    if (sorters[sort]) cards = cards.slice().sort(sorters[sort]);

    const total = cards.length;
    const lim = Math.min(100, Math.max(1, Number(limit) || 24));
    const off = Math.max(0, Number(offset) || 0);
    return { results: cards.slice(off, off + lim).map((c) => this._result(c)), total };
  }

  _result(card) {
    return {
      id: encodeId(card.genrePath, card.slug, card.titleNo),
      title: card.title,
      author: card.author || "Auteur inconnu",
      cover: images.proxied(card.cover),
      status: null,
      genre: card.genreLabel || "",
      tags: card.genreLabel ? [card.genreLabel] : [],
      rating: null,
      popularity: card.views ?? null,
      year: null,
      chapterCount: null,
      sourceId: this.id,
      sourceName: this.name,
    };
  }

  // ---- Fiche + épisodes ---------------------------------------------------

  async getMangaInfo(mangaId) {
    const id = decodeId(mangaId);
    const first = await getHtml(listUrl(id, 1));
    const info = parseTitleInfo(first);
    const episodes = await this._episodeList(id, first);
    if (!episodes.length) throw httpError(404, "Aucun épisode WEBTOON trouvé");

    const chapters = episodes
      .slice()
      .sort((a, b) => a.no - b.no)
      .map((e) => ({ id: String(e.no), title: e.title || `Épisode ${e.no}`, order: e.no }));

    return {
      id: mangaId,
      title: info.title || prettify(id.slug),
      author: info.author || "Auteur inconnu",
      description: info.description || "",
      cover: images.proxied(info.cover),
      status: info.status || null,
      genre: info.genreLabel || "",
      tags: info.genreLabel ? [info.genreLabel] : [],
      rating: null,
      popularity: info.views ?? null,
      year: null,
      chapterCount: chapters.length,
      chapters,
      sourceId: this.id,
      sourceName: this.name,
    };
  }

  /**
   * Tous les épisodes du titre : suit les liens de pagination, six requêtes en
   * parallèle. Les pages hors bornes renvoient la dernière page (dédoublonnées
   * par numéro d'épisode), la boucle reste bornée.
   */
  async _episodeList(id, firstHtml = null) {
    const byNo = new Map();
    const done = new Set();
    let pending = [1];
    let html = firstHtml;
    let guard = 0;

    while (pending.length && guard++ < 500) {
      const wave = pending.splice(0, 6);
      const pages = await Promise.all(
        wave.map(async (n) => {
          if (n === 1 && html) return { n, html };
          try {
            return { n, html: await getHtml(listUrl(id, n)) };
          } catch (err) {
            if (err.status === 404) return { n, html: null };
            throw err;
          }
        })
      );
      html = null;
      for (const page of pages) {
        if (!page.html) continue;
        done.add(page.n);
        for (const ep of parseEpisodes(page.html)) if (!byNo.has(ep.no)) byNo.set(ep.no, ep);
        const { pages: discovered, next } = parsePagination(page.html);
        for (const n of [...discovered, next]) {
          if (n && !done.has(n) && !pending.includes(n)) pending.push(n);
        }
      }
    }

    return [...byNo.values()].sort((a, b) => a.no - b.no);
  }

  // ---- Pages d'un épisode -------------------------------------------------

  async getChapterPages(mangaId, chapterId) {
    const id = decodeId(mangaId);
    const epNo = Number(chapterId);
    if (!Number.isInteger(epNo) || epNo < 1) throw httpError(404, "Épisode WEBTOON introuvable");

    const first = await getHtml(listUrl(id, 1));
    const firstEps = parseEpisodes(first);
    if (!firstEps.length) throw httpError(404, "Aucun épisode WEBTOON trouvé");

    const total = Math.max(...firstEps.map((e) => e.no));
    if (epNo > total) throw httpError(404, "Épisode WEBTOON introuvable");

    // Page 1 = épisodes les plus récents, d'où l'index de page ci-dessous.
    const pageSize = Math.max(1, firstEps.length);
    const target = Math.max(1, Math.ceil((total - epNo + 1) / pageSize));
    let episode = null;
    if (target === 1) {
      episode = firstEps.find((e) => e.no === epNo) || null;
    } else {
      try {
        episode = parseEpisodes(await getHtml(listUrl(id, target))).find((e) => e.no === epNo) || null;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }

    if (!episode) {
      // Formule approximative (numérotation irrégulière) : parcours complet.
      episode = (await this._episodeList(id, first)).find((e) => e.no === epNo) || null;
    }
    if (!episode) throw httpError(404, "Épisode WEBTOON introuvable");

    const viewerUrl = new URL(episode.href, BASE).toString();
    const urls = parseViewerImages(await getHtml(viewerUrl));
    if (!urls.length) throw httpError(404, "Aucune page pour cet épisode");

    return {
      id: String(epNo),
      title: episode.title || null,
      order: epNo,
      pages: images.proxiedAll(urls),
      pagesLow: [],
      externalUrl: null,
    };
  }
}

module.exports = WebtoonsSource;
