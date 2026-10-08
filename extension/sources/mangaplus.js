"use strict";

const path = require("path");
const crypto = require("crypto");
const protobuf = require("protobufjs");

const BaseSource = require("../BaseSource");
const { httpError } = require("../utils");
const images = require("../images");

/**
 * Source Manga Plus — API protobuf officielle de Shueisha (jumpg-webapi).
 *
 * Endpoints utilisés, les mêmes que le site mangaplus.shueisha.co.jp :
 *   - GET /title_list/search   index complet des titres + genres (SearchView)
 *   - GET /title_detailV3      fiche + chapitres (TitleDetailView)
 *   - GET /manga_viewer_v3     pages d'un chapitre (MangaViewer)
 *
 * Les réponses sont en protobuf : les schémas sont vendorisés dans
 * extension/mangaplus/protos (schémas communautaires « MangaPlus », références
 * de style Java XxxOuterClass.Yyy réécrites en Yyy pour protobufjs).
 *
 * Chaque requête porte un SESSION-TOKEN (UUID auto-généré) et les paramètres
 * os/os_ver/app_ver de l'application Android officielle ; lang/clang en fra.
 *
 * Accès gratuit : l'API ne renvoie que les premiers chapitres du titre et les
 * derniers publiés (abonnement requis au-delà). Les pages du lecteur
 * (jumpg-assets3) exigent l'en-tête Plus-Vw-Token (vwToken du MangaViewer) et
 * sont chiffrées en XOR (encryptionKey) : elles passent par /api/image qui
 * déchiffre ; les vignettes jumpg-assets restent directes.
 *
 * id interne = le titleId de Manga Plus (différent par langue : 1xxxxx EN,
 * 7xxxxx FR…). La variante FR est privilégiée, sinon la variante EN.
 */

const API = "https://jumpg-webapi.tokyo-cdn.com/api";
const APP_PARAMS = { os: "android", os_ver: "35", app_ver: "237" };
const LANG_PARAMS = { lang: "fra", clang: "fra" };
const PROTO_DIR = path.join(__dirname, "..", "mangaplus", "protos");
const INDEX_TTL = 30 * 60_000;
const TIMEOUT_MS = 20_000;

// Genres de l'index Manga Plus (allTags), filet de sécurité hors-ligne.
const GENRE_TAGS = [
  "Battle / Action",
  "Comedy",
  "Sport / Club Activities",
  "Mystery / Thriller",
  "Romance",
  "Horror / Supernatural",
  "Spin-off",
  "Sci-Fi / Fantasy",
  "Romantic Comedy",
  "Drama",
  "Food",
  "History / Period",
  "Gangsta",
  "One-shot",
  "Manga Award",
];

// Libellé de filtre partagé (MangaDex / WEBTOON) -> libellés Manga Plus.
const GENRE_ALIASES = {
  action: ["battle / action"],
  sport: ["sport / club activities"],
  sports: ["sport / club activities"],
  mystery: ["mystery / thriller"],
  thriller: ["mystery / thriller"],
  horror: ["horror / supernatural"],
  supernatural: ["horror / supernatural"],
  "sci-fi": ["sci-fi / fantasy"],
  "science-fiction": ["sci-fi / fantasy"],
  "science fiction": ["sci-fi / fantasy"],
  fantasy: ["sci-fi / fantasy"],
  historical: ["history / period"],
  history: ["history / period"],
  comedy: ["comedy", "romantic comedy"],
  romance: ["romance", "romantic comedy"],
};

function norm(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || String(raw).trim() !== String(id)) {
    throw httpError(404, "Titre Manga Plus introuvable");
  }
  return id;
}

/** #001 / Chapitre 141 / Chapter 3 -> numéro ; sinon ordre précédent + 1. */
function chapterOrder(chapter, prevOrder) {
  const fromName = /#0*(\d+)/.exec(chapter.name || "");
  if (fromName) return Number(fromName[1]);
  const fromSub = /(?:chapitre|chapter)\s+(\d+)/i.exec(chapter.subTitle || "");
  if (fromSub) return Number(fromSub[1]);
  return prevOrder + 1;
}

function statusOf(detail) {
  const schedule = ((detail.titleLabels || {}).releaseSchedule || "").toUpperCase();
  if (schedule === "COMPLETED" || schedule === "ONE_SHOT") return "completed";
  if (schedule === "HIATUS") return "hiatus";
  if (schedule === "EVERYDAY" || schedule === "WEEKLY" || schedule === "BIWEEKLY" || schedule === "MONTHLY" ||
      schedule === "BIMONTHLY" || schedule === "TRIMONTHLY") return "ongoing";
  return null;
}

function popupMessage(popup) {
  if (!popup) return "";
  if (popup.subject !== undefined || popup.body !== undefined) {
    return [popup.subject, popup.body].filter(Boolean).join(" — ");
  }
  const inner = popup.oSDefault || popup.appDefault;
  if (inner) return [inner.subject, inner.body].filter(Boolean).join(" — ");
  return "";
}

function errorText(error) {
  const candidates = [error.englishPopup, error.spanishPopup, ...(error.popups || [])];
  for (const popup of candidates) {
    const msg = popupMessage(popup);
    if (msg) return `Manga Plus : ${msg}`;
  }
  if (error.debugInfo) return `Manga Plus : erreur API (${error.debugInfo})`;
  return "Manga Plus : erreur API";
}

function errorStatus(action) {
  if (action === "MAINTENANCE" || action === "GEOIP_BLOCKING") return 503;
  if (action === "UNAUTHORIZED") return 403;
  return 502;
}

// Chargement paresseux des schémas (une seule fois pour tout le processus).
let responseTypeCache = null;
function responseType() {
  if (!responseTypeCache) {
    const root = protobuf.loadSync(path.join(PROTO_DIR, "ResponseOuterClass.proto"));
    responseTypeCache = root.lookupType("mangaplus_api_protocol.Response");
  }
  return responseTypeCache;
}

class MangaPlusSource extends BaseSource {
  constructor() {
    super({
      id: "mangaplus",
      name: "Manga Plus",
      baseUrl: "https://mangaplus.shueisha.co.jp",
      lang: "fr",
      version: "1.0.0",
      author: "MangaHub",
      description:
        "Plateforme officielle Shueisha (Manga Plus) : One Piece, Jujutsu Kaisen, Chainsaw Man… " +
        "Catalogue multilingue avec titres en français, API protobuf officielle. " +
        "Accès gratuit : premiers chapitres et dernières sorties (abonnement au-delà).",
    });
    this.genres = GENRE_TAGS.slice();
    this._session = crypto.randomUUID();
    this._indexData = null;
    this._indexAt = 0;
    this._indexLoad = null;
  }

  // ---- Appels API protobuf ------------------------------------------------

  async _call(endpoint, params = {}) {
    const url = new URL(`${API}/${endpoint}`);
    for (const [key, value] of Object.entries({ ...APP_PARAMS, ...LANG_PARAMS, ...params })) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    let res;
    try {
      res = await fetch(url, {
        headers: {
          "SESSION-TOKEN": this._session,
          "User-Agent": images.USER_AGENT,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err.name === "TimeoutError" ? "délai dépassé" : err.message;
      throw httpError(502, `Manga Plus injoignable (${reason})`);
    }
    if (!res.ok) throw httpError(502, `Manga Plus : réponse HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw httpError(502, "Manga Plus : réponse vide");

    let decoded;
    try {
      const type = responseType();
      decoded = type.toObject(type.decode(buf), { enums: String, longs: String });
    } catch {
      throw httpError(502, "Manga Plus : réponse illisible");
    }

    if (decoded.error && Object.keys(decoded.error).length) {
      const err = decoded.error;
      const text = errorText(err);
      throw httpError(/not found/i.test(text) ? 404 : errorStatus(err.action), text);
    }
    const success = decoded.success;
    if (!success || !Object.keys(success).length) throw httpError(502, "Manga Plus : réponse vide");
    return success;
  }

  /** Index des titres (SearchView), mis en cache 30 min. */
  async _index() {
    if (this._indexData && Date.now() - this._indexAt < INDEX_TTL) return this._indexData;
    if (this._indexLoad) return this._indexLoad;

    this._indexLoad = (async () => {
      const success = await this._call("title_list/search");
      const view = success.searchView || {};
      const groups = view.allTitlesGroup || [];
      if (!groups.length) throw httpError(502, "Manga Plus : index des titres vide");
      this._indexData = {
        groups,
        tags: (view.allTags || []).map((t) => String(t.tag || "").trim()).filter(Boolean),
      };
      this._indexAt = Date.now();
      this._indexLoad = null;
      return this._indexData;
    })().catch((err) => {
      this._indexLoad = null;
      throw err;
    });
    return this._indexLoad;
  }

  // ---- Genres -------------------------------------------------------------

  async getGenres() {
    try {
      const { tags } = await this._index();
      if (tags.length) return tags;
    } catch {
      // index indisponible : libellés statiques
    }
    return GENRE_TAGS;
  }

  // ---- Recherche ----------------------------------------------------------

  /** Variante FR du groupe de titres, sinon EN, sinon la première. */
  static _variant(group) {
    const titles = group.titles || [];
    if (!titles.length) return null;
    return (
      titles.find((t) => t.language === "FRENCH") ||
      titles.find((t) => t.language === "ENGLISH") ||
      titles[0]
    );
  }

  static _tagsOf(group) {
    return (group.tags || []).map((t) => String(t.tag || "").trim()).filter(Boolean);
  }

  async search(query = "", options = {}) {
    const { genre = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    const { groups } = await this._index();
    const q = norm(query);

    let items = [];
    for (const group of groups) {
      const title = MangaPlusSource._variant(group);
      if (!title || !title.titleId) continue;
      items.push({
        title,
        tags: MangaPlusSource._tagsOf(group),
        display: norm(title.name || group.theTitle),
        author: norm(title.author),
        theTitle: norm(group.theTitle),
      });
    }

    if (q) {
      items = items.filter(
        (it) => it.display.includes(q) || it.theTitle.includes(q) || it.author.includes(q)
      );
    }

    if (genre && genre !== "all") {
      const wanted = new Set([norm(genre), ...((GENRE_ALIASES[norm(genre)] || []).map(norm))]);
      items = items.filter((it) => it.tags.some((tag) => wanted.has(norm(tag))));
    }

    // Sans tri explicite : on conserve l'ordre de l'API (titres en vedette d'abord).
    if (sort === "title") items = items.slice().sort((a, b) => a.display.localeCompare(b.display, "fr"));

    const total = items.length;
    const lim = Math.min(100, Math.max(1, Number(limit) || 24));
    const off = Math.max(0, Number(offset) || 0);
    return { results: items.slice(off, off + lim).map((it) => this._result(it.title, it.tags)), total };
  }

  _result(title, tags) {
    return {
      id: String(title.titleId),
      title: String(title.name || "").trim() || "Sans titre",
      author: String(title.author || "").trim() || "Auteur inconnu",
      cover: title.portraitImageUrl || title.landscapeImageUrl || null,
      status: null,
      genre: tags[0] || "",
      tags,
      rating: null,
      popularity: null,
      year: null,
      chapterCount: null,
      sourceId: this.id,
      sourceName: this.name,
    };
  }

  // ---- Fiche manga --------------------------------------------------------

  async getMangaInfo(mangaId) {
    const titleId = parseId(mangaId);
    const success = await this._call("title_detailV3", { title_id: titleId });
    const detail = success.titleDetailView;
    if (!detail || !detail.title || !detail.title.titleId) {
      throw httpError(404, "Titre Manga Plus introuvable");
    }

    const tags = (detail.tags || []).map((t) => String(t.tag || "").trim()).filter(Boolean);
    const chapters = this._chapters(detail);
    const views = Number(detail.numberOfViews);

    return {
      id: String(detail.title.titleId),
      title: String(detail.title.name || "").trim() || "Sans titre",
      author: String(detail.title.author || "").trim() || "Auteur inconnu",
      description: String(detail.overview || "").trim(),
      cover: detail.title.portraitImageUrl || detail.title.landscapeImageUrl || null,
      status: statusOf(detail),
      genre: tags[0] || "",
      tags,
      rating: null,
      popularity: Number.isFinite(views) && views > 0 ? views : null,
      year: null,
      chapterCount: chapters.length,
      chapters,
      sourceId: this.id,
      sourceName: this.name,
    };
  }

  /**
   * Chapitres gratuits renvoyés par la fiche : groupes first/mid/last (ordre
   * croissant) + listes plates éventuelles, dédoublonnés par chapterId.
   */
  _chapters(detail) {
    const candidates = [
      ...(detail.firstChapterList || []),
      ...(detail.lastChapterList || []),
      ...(detail.chapterListV2 || []),
    ];
    for (const group of detail.chapterListGroup || []) {
      candidates.push(
        ...(group.firstChapterList || []),
        ...(group.midChapterList || []),
        ...(group.lastChapterList || [])
      );
    }

    const seen = new Set();
    const chapters = [];
    let prevOrder = 0;
    for (const ch of candidates) {
      if (!ch || !ch.chapterId || seen.has(ch.chapterId)) continue;
      seen.add(ch.chapterId);
      const order = chapterOrder(ch, prevOrder);
      prevOrder = Math.max(prevOrder + 1, order);
      chapters.push({
        id: String(ch.chapterId),
        title: String(ch.subTitle || ch.name || "").trim() || `Chapitre ${ch.chapterId}`,
        order,
      });
    }
    return chapters.sort((a, b) => a.order - b.order);
  }

  // ---- Pages d'un chapitre ------------------------------------------------

  async getChapterPages(mangaId, chapterId) {
    parseId(mangaId);
    const cid = parseId(chapterId);

    const success = await this._call("manga_viewer_v3", {
      chapter_id: cid,
      split: "yes",
      img_quality: "super_high",
      viewer_mode: "vertical",
    });
    const viewer = success.mangaViewer;
    if (!viewer) throw httpError(404, "Chapitre Manga Plus introuvable");

    const vwt = String(viewer.vwToken || "");
    const pages = [];
    for (const page of viewer.pages || []) {
      const mp = page.mangaPage;
      if (mp && mp.imageUrl) pages.push(images.proxied(mp.imageUrl, { vwt, k: mp.encryptionKey }));
    }
    if (!pages.length) throw httpError(404, "Aucune page pour ce chapitre");

    return {
      id: String(cid),
      title: viewer.chapterName || null,
      order: null,
      pages,
      pagesLow: [],
      externalUrl: null,
    };
  }
}

module.exports = MangaPlusSource;
