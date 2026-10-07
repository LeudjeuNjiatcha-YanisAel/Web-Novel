// Lecteur d'images Manga (sans ajout à la sidebar)
import { api } from "../api.js";
import { h, render, escapeHtml } from "../ui.js";
import { icons } from "../icons.js";

const state = {
  sourceId: null,
  mangaId: null,
  chapterId: null,
  manga: null,
  chapter: null,
  pages: [],
  page: 0,
  loading: true,
  error: null,
  uiHidden: false,
  fit: "width",
  direction: "ltr",
  preload: true,
  imageErrors: new Set(),
  imageLoaded: new Set(),
  showThumbnails: false,
};

const FITS = ["width", "height", "original", "contain"];

function getMangaProgressKey(mangaId) { return `mangadex:progress:${mangaId}`; }
function getChapterProgressKey(mangaId, chapterId) { return `mangadex:chapter:${mangaId}:${chapterId}`; }
function saveMangaProgress(mangaId, data) { try { localStorage.setItem(getMangaProgressKey(mangaId), JSON.stringify({ ...data, updatedAt: Date.now() })); } catch {} }
function loadChapterProgress(mangaId, chapterId) { try { const s = localStorage.getItem(getChapterProgressKey(mangaId, chapterId)); return s ? JSON.parse(s) : null; } catch { return null; } }
function saveChapterProgress(mangaId, chapterId, data) { try { localStorage.setItem(getChapterProgressKey(mangaId, chapterId), JSON.stringify({ ...data, updatedAt: Date.now() })); } catch {} }

async function preloadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(true);
    img.onerror = () => res(false);
    img.src = url;
  });
}

async function fetchPages(chapterId) {
  const url = `https://api.mangadex.org/at-home/server/${chapterId}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MangaDex at-home failed: ${res.status}`);
  const data = await res.json();
  const baseUrl = data.baseUrl;
  const chapter = data.chapter || {};
  const hash = chapter.hash || "";
  const pageFiles = chapter.data || [];
  const pageSaver = chapter.dataSaver || [];
  const pages = pageFiles.map((filename, i) => ({
    index: i,
    filename,
    url: `${baseUrl}/data/${hash}/${filename}`,
    urlSaver: pageSaver[i] ? `${baseUrl}/data-saver/${hash}/${pageSaver[i]}` : null,
  }));
  return { pages, baseUrl, hash };
}

export async function initMangaImageReader(sourceId, mangaId, chapterId) {
  state.sourceId = sourceId; state.mangaId = mangaId; state.chapterId = chapterId;
  state.manga = null; state.pages = []; state.page = 0;
  state.loading = true; state.error = null; state.uiHidden = false; state.showThumbnails = false;
  state.imageErrors = new Set(); state.imageLoaded = new Set();
  renderView();
  try {
    const [m, pagesRes] = await Promise.all([
      api.getNovel(sourceId, mangaId).catch(() => null),
      fetchPages(chapterId),
    ]);
    state.manga = m;
    state.pages = pagesRes.pages || [];
    const cp = loadChapterProgress(mangaId, chapterId);
    if (cp && typeof cp.page === "number" && cp.page >= 0 && cp.page < state.pages.length) state.page = cp.page;
    else state.page = 0;
    saveMangaProgress(mangaId, { lastChapterId: chapterId, lastPage: state.page });
    if (state.preload && state.pages[state.page + 1]?.url) preloadImage(state.pages[state.page + 1].url);
    if (state.preload && state.pages[state.page + 2]?.url) preloadImage(state.pages[state.page + 2].url);
  } catch (e) {
    state.error = e.message || "Impossible de charger ce chapitre";
  } finally {
    state.loading = false;
    renderView();
  }
}

function goPage(n) {
  if (!state.pages.length) return;
  const next = Math.max(0, Math.min(state.pages.length - 1, n));
  if (next === state.page) return;
  state.page = next;
  saveChapterProgress(state.mangaId, state.chapterId, { page: state.page, totalPages: state.pages.length, readAt: Date.now() });
  saveMangaProgress(state.mangaId, { lastChapterId: state.chapterId, lastPage: state.page });
  if (state.preload && state.pages[next + 1]?.url && !state.imageLoaded.has(next + 1)) preloadImage(state.pages[next + 1].url);
  if (state.preload && state.pages[next + 2]?.url && !state.imageLoaded.has(next + 2)) preloadImage(state.pages[next + 2].url);
  window.scrollTo({ top: 0, behavior: "auto" });
  renderView();
}
function nextPage() { if (state.direction === "rtl") goPage(state.page - 1); else goPage(state.page + 1); }
function prevPage() { if (state.direction === "rtl") goPage(state.page + 1); else goPage(state.page - 1); }
function toggleUI() { state.uiHidden = !state.uiHidden; renderView(); }
function cycleFit() { const i = FITS.indexOf(state.fit); state.fit = FITS[(i + 1) % FITS.length]; renderView(); }
function toggleDir() { state.direction = state.direction === "ltr" ? "rtl" : "ltr"; renderView(); }
function toggleThumbs() { state.showThumbnails = !state.showThumbnails; renderView(); }
function handleImageLoad(i) { state.imageLoaded.add(i); renderView(); }
function handleImageError(i) { state.imageErrors.add(i); renderView(); }

function renderView() {
  const root = document.getElementById("view-root");
  if (!root) return;

  if (state.loading) {
    root.innerHTML = `<main class="manga-reader loading"><div class="manga-reader-center"><div class="spinner xl"></div><p>Chargement des pages...</p></div></main>`;
    return;
  }
  if (state.error) {
    render(h("main", { class: "manga-reader error" },
      h("div", { class: "manga-reader-center" },
        icons.alertTriangle,
        h("h3", null, "Erreur de lecture"),
        h("p", null, state.error),
        h("a", { class: "btn primary mt-4", href: `#/novel/mangadex/${state.mangaId}` }, "Retour à la fiche")
      )
    ), root);
    return;
  }

  const total = state.pages.length;
  const page = state.pages[state.page];
  const mTitle = state.manga?.title || "";
  const fitCls = `fit-${state.fit}`;
  const dirCls = `dir-${state.direction}`;

  const view = h("main", { class: `manga-reader ${dirCls} ${fitCls} ${state.uiHidden ? "ui-hidden" : ""}` },
    h("header", { class: "manga-reader-header" },
      h("div", { class: "manga-reader-left" },
        h("a", { class: "icon-btn ghost", href: `#/novel/mangadex/${state.mangaId}` }, icons.arrowLeft),
        h("div", { class: "manga-reader-title-group" },
          h("h1", { class: "manga-reader-manga-title" }, escapeHtml(mTitle)),
          h("p", { class: "manga-reader-chapter-title" }, `Chapitre ${state.chapterId.slice(0,8)}...`)
        )
      ),
      h("div", { class: "manga-reader-center-info" }, total > 0 ? h("span", { class: "manga-reader-pagecount" }, `${state.page + 1} / ${total}`) : null),
      h("div", { class: "manga-reader-actions" },
        h("button", { class: "icon-btn ghost", id: "manga-reader-thumbs" }, icons.grid),
        h("button", { class: "icon-btn ghost", id: "manga-reader-dir" }, state.direction === "ltr" ? icons.arrowRight : icons.arrowLeft),
        h("button", { class: "icon-btn ghost", id: "manga-reader-fit" }, icons.maximize2),
        h("button", { class: "icon-btn ghost", id: "manga-reader-ui" }, state.uiHidden ? icons.eye : icons.eyeOff)
      )
    ),

    h("div", { class: "manga-reader-stage", id: "manga-reader-stage" },
      total === 0 ? h("div", { class: "manga-reader-empty" }, icons.image, h("p", null, "Aucune page trouvée.")) :
        h("div", { class: "manga-reader-page-wrap" },
          page && !state.imageErrors.has(state.page)
            ? h("img", { src: page.url, alt: `Page ${state.page + 1}`, class: "manga-reader-page-img", draggable: "false", onload: () => handleImageLoad(state.page), onerror: () => handleImageError(state.page) })
            : h("div", { class: "manga-reader-page-error" }, icons.alertTriangle, h("p", null, "Impossible de charger cette page"), h("button", { class: "btn ghost sm", id: "manga-retry-page" }, "Réessayer")),
          h("button", { class: "manga-nav prev", id: "manga-nav-prev" }, state.direction === "rtl" ? icons.chevronRight : icons.chevronLeft),
          h("button", { class: "manga-nav next", id: "manga-nav-next" }, state.direction === "rtl" ? icons.chevronLeft : icons.chevronRight),
          h("div", { class: "manga-reader-tapzones" },
            h("div", { class: "tapzone left", id: "tapzone-left" }),
            h("div", { class: "tapzone center", id: "tapzone-center" }),
            h("div", { class: "tapzone right", id: "tapzone-right" })
          )
        )
    ),

    h("div", { class: "manga-reader-bottom" },
      h("div", { class: "manga-reader-progress" },
        h("input", { type: "range", min: 0, max: Math.max(0, total - 1), step: 1, value: state.page, id: "manga-page-slider" }),
        h("div", { class: "manga-reader-progress-info" }, total > 0 ? h("span", null, `Page ${state.page + 1} sur ${total}`) : null)
      )
    ),

    state.showThumbnails
      ? h("div", { class: "manga-thumbnails" },
          h("div", { class: "manga-thumbnails-header" },
            h("h3", null, "Vignettes"),
            h("button", { class: "icon-btn ghost", id: "manga-thumbs-close" }, icons.x)
          ),
          h("div", { class: "manga-thumbnails-grid" },
            state.pages.map((p, i) =>
              h("button", { class: `manga-thumb ${i === state.page ? "active" : ""}`, "data-page": i },
                state.imageErrors.has(i) ? h("div", { class: "thumb-error" }, icons.image) : h("img", { src: p.urlSaver || p.url, alt: `P${i + 1}`, loading: "lazy" }),
                h("span", { class: "thumb-index" }, i + 1)
              )
            )
          )
        )
      : null
  );

  render(view, root);

  const stage = document.getElementById("manga-reader-stage");
  if (stage) stage.addEventListener("click", toggleUI);

  document.getElementById("manga-nav-prev")?.addEventListener("click", (e) => { e.stopPropagation(); prevPage(); });
  document.getElementById("manga-nav-next")?.addEventListener("click", (e) => { e.stopPropagation(); nextPage(); });
  document.getElementById("tapzone-left")?.addEventListener("click", (e) => { e.stopPropagation(); prevPage(); });
  document.getElementById("tapzone-right")?.addEventListener("click", (e) => { e.stopPropagation(); nextPage(); });
  document.getElementById("tapzone-center")?.addEventListener("click", (e) => { e.stopPropagation(); toggleUI(); });
  document.getElementById("manga-reader-thumbs")?.addEventListener("click", (e) => { e.stopPropagation(); toggleThumbs(); });
  document.getElementById("manga-reader-dir")?.addEventListener("click", (e) => { e.stopPropagation(); toggleDir(); });
  document.getElementById("manga-reader-fit")?.addEventListener("click", (e) => { e.stopPropagation(); cycleFit(); });
  document.getElementById("manga-reader-ui")?.addEventListener("click", (e) => { e.stopPropagation(); toggleUI(); });
  document.getElementById("manga-page-slider")?.addEventListener("input", (e) => { goPage(Number(e.target.value)); });
  document.getElementById("manga-retry-page")?.addEventListener("click", () => { state.imageErrors.delete(state.page); renderView(); });
  document.getElementById("manga-thumbs-close")?.addEventListener("click", () => { state.showThumbnails = false; renderView(); });
  document.querySelectorAll(".manga-thumb").forEach((b) => {
    b.addEventListener("click", () => { const p = Number(b.dataset.page); goPage(p); state.showThumbnails = false; renderView(); });
  });

  const onKey = (e) => {
    if (state.showThumbnails) { if (e.key === "Escape") { state.showThumbnails = false; renderView(); } return; }
    if (e.key === "ArrowRight") { e.preventDefault(); nextPage(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); prevPage(); }
    if (e.key === " " || e.key === "PageDown") { e.preventDefault(); nextPage(); }
    if (e.key === "PageUp") { e.preventDefault(); prevPage(); }
    if (e.key === "f" || e.key === "F") { e.preventDefault(); cycleFit(); }
    if (e.key === "h" || e.key === "H" || e.key === "Escape") { e.preventDefault(); toggleUI(); }
    if (e.key === "t" || e.key === "T") { e.preventDefault(); toggleThumbs(); }
    if (e.key === "r" || e.key === "R") { e.preventDefault(); toggleDir(); }
  };
  window.removeEventListener("keydown", onKey);
  window.addEventListener("keydown", onKey);
}
