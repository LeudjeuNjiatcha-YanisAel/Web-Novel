// MangaHub — vue Catalogue (recherche, filtres, grille, défilement infini)

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, toast, emptyState, coverAccent, coverImage } from "../ui.js";
import { serverState, toggleFavorite } from "../state.js";
import { mangaCard, skeletonGrid } from "./cards.js";

const PAGE_SIZE = 24;
const SENTINEL_MARGIN = 600; // px de préchargement avant la fin de la grille

const filters = {
  q: "",
  source: "all",
  genre: "all",
  status: "all",
  sort: "relevance",
};

let sourcesCache = [];
let genresCache = [];

export function renderCatalog({ params, viewRoot }) {
  viewRoot.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">Explorer</span>
      <h1>Le catalogue des mangas</h1>
      <p class="lead">Tous les mangas disponibles sont listés ici dès qu'une extension est active. Filtre, trie, suis et télécharge en CBZ.</p>
    </header>

    <div id="shelf-slot"></div>

    <div id="continue-slot"></div>

    <div class="search-panel">
      <div class="search-field">
        ${icon("search", 17)}
        <input id="cat-search" class="field" type="search" placeholder="Titre, auteur, genre…" autocomplete="off" spellcheck="false" />
      </div>
      <select id="cat-source" class="select" style="min-width:200px" aria-label="Source">
        <option value="all">Toutes les sources</option>
      </select>
      <button id="cat-submit" class="btn btn-primary">${icon("search", 16)} Rechercher</button>
    </div>

    <div class="filter-row">
      <div class="chips" id="cat-genres"></div>
      <div style="flex:1"></div>
      <select id="cat-status" class="select" style="min-width:150px" aria-label="Statut">
        <option value="all">Tous statuts</option>
        <option value="ongoing">En cours</option>
        <option value="completed">Terminé</option>
        <option value="hiatus">En pause</option>
        <option value="cancelled">Annulé</option>
      </select>
      <select id="cat-sort" class="select" style="min-width:150px" aria-label="Tri">
        <option value="relevance">Pertinence</option>
        <option value="popularity">Popularité</option>
        <option value="rating">Meilleures notes</option>
        <option value="recent">Plus récents</option>
        <option value="chapters">Plus étoffés</option>
        <option value="title">Titre A → Z</option>
      </select>
    </div>

    <div class="result-meta"><span class="count"></span></div>
    <div id="cat-grid" class="grid"></div>
    <div class="load-wrap" id="cat-sentinel" style="display:none" aria-hidden="true">
      <span class="load-spin"></span>
    </div>
  `;

  const qInput = viewRoot.querySelector("#cat-search");
  const sourceSelect = viewRoot.querySelector("#cat-source");
  const statusSelect = viewRoot.querySelector("#cat-status");
  const sortSelect = viewRoot.querySelector("#cat-sort");
  const genresHost = viewRoot.querySelector("#cat-genres");
  const grid = viewRoot.querySelector("#cat-grid");
  const countEl = viewRoot.querySelector(".count");
  const sentinel = viewRoot.querySelector("#cat-sentinel");

  let results = [];
  let offset = 0;
  let canLoadMore = false;
  let loadingMore = false;
  let seq = 0; // numéro de séquence : invalide les réponses d'une recherche remplacée

  // ---- Défilement infini : le sentinelle observe la fin de la grille -------
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { rootMargin: `${SENTINEL_MARGIN}px 0px` }
  );
  observer.observe(sentinel);

  function sentinelInView() {
    return sentinel.getBoundingClientRect().top <= window.innerHeight + SENTINEL_MARGIN;
  }

  function setSentinel() {
    sentinel.style.display = canLoadMore ? "" : "none";
  }

  function loadMore() {
    if (!canLoadMore || loadingMore) return;
    runSearch(false);
  }

  function renderGenres() {
    const genres = ["all", ...genresCache];
    genresHost.innerHTML = genres
      .map((g) => `<button class="chip ${filters.genre === g ? "active" : ""}" data-genre="${escapeHtml(g)}">${g === "all" ? "Tous genres" : escapeHtml(g)}</button>`)
      .join("");
    genresHost.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        filters.genre = chip.dataset.genre;
        renderGenres();
        runSearch();
      });
    });
  }

  // Restaure l'état précédent si on revient sur la vue
  qInput.value = filters.q;
  statusSelect.value = filters.status;
  sortSelect.value = filters.sort;

  qInput.addEventListener("input", () => {
    filters.q = qInput.value;
    clearTimeout(qInput._t);
    qInput._t = setTimeout(runSearch, 320);
  });
  qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(qInput._t);
      filters.q = qInput.value;
      runSearch();
    }
  });
  viewRoot.querySelector("#cat-submit").addEventListener("click", () => {
    filters.q = qInput.value;
    runSearch();
  });
  sourceSelect.addEventListener("change", () => {
    filters.source = sourceSelect.value;
    runSearch();
  });
  statusSelect.addEventListener("change", () => {
    filters.status = statusSelect.value;
    runSearch();
  });
  sortSelect.addEventListener("change", () => {
    filters.sort = sortSelect.value;
    runSearch();
  });

  /** Applique une page de résultats (reset = première page). */
  function applyPage(res, reset) {
    const chunk = res.results || [];
    const total = res.paginated ? res.total : results.length;
    results = reset ? chunk : results.concat(chunk);
    if (chunk.length) offset += chunk.length;
    canLoadMore = res.paginated === true && results.length < total;
    countEl.innerHTML = `<strong>${results.length}</strong> manga${results.length > 1 ? "s" : ""}${canLoadMore ? `<span class="muted"> sur un total de ${total}</span>` : ""}`;
  }

  function renderGrid() {
    grid.innerHTML = results.map((m) => mangaCard(m, { showSource: filters.source === "all" })).join("");
    wireCards(grid, results);
    setSentinel();
  }

  async function runSearch(reset = true) {
    if (reset) {
      const mySeq = ++seq;
      results = [];
      offset = 0;
      canLoadMore = false;
      loadingMore = false;
      setSentinel();
      grid.innerHTML = skeletonGrid(9);
      countEl.innerHTML = "<span>Recherche…</span>";
      try {
        const res = await api.search({ ...filters, limit: PAGE_SIZE, offset });
        if (mySeq !== seq) return;
        applyPage(res, true);
        if (!results.length) {
          grid.innerHTML = emptyState({
            iconName: "search",
            title: "Aucun résultat",
            text: "Essayez un autre terme, changez de genre ou de source.",
          });
          setSentinel();
          return;
        }
        renderGrid();
      } catch (err) {
        if (mySeq !== seq) return;
        grid.innerHTML = emptyState({
          iconName: "info",
          title: "Recherche impossible",
          text: err.message || "Le serveur n'a pas répondu correctement.",
        });
        setSentinel();
      }
      return;
    }

    // Page suivante (défilement infini)
    if (!canLoadMore || loadingMore) return;
    loadingMore = true;
    sentinel.classList.add("loading");
    const mySeq = ++seq;
    try {
      const res = await api.search({ ...filters, limit: PAGE_SIZE, offset });
      if (mySeq !== seq) return;
      applyPage(res, false);
      renderGrid();
    } catch (err) {
      if (mySeq === seq) toast(err.message || "Impossible de charger la suite.", "error");
    } finally {
      if (mySeq === seq) {
        loadingMore = false;
        sentinel.classList.remove("loading");
        // Le sentinelle peut toujours être visible (page courte) : on enchaîne.
        if (canLoadMore && sentinelInView()) loadMore();
      }
    }
  }

  // Bases (extensions + genres) puis première recherche
  async function init() {
    try {
      const [extData, genresData] = await Promise.all([
        api.extensions().catch(() => ({ installed: [] })),
        api.genres().catch(() => []),
      ]);
      sourcesCache = extData.installed;
      genresCache = genresData;
      sourceSelect.innerHTML =
        `<option value="all">Toutes les sources</option>` +
        sourcesCache
          .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
          .join("");
      sourceSelect.value = filters.source;
      renderGenres();
    } catch {
      /* repli : recherche sans filtre de source */
    }
    runSearch();
  }

  renderContinue();
  renderShelf();
  init();

  return {
    cleanup() {
      observer.disconnect();
      clearTimeout(qInput._t);
    },
  };
}

// ---- Carrousel « À la une » : historique + mangas du moment + nouveautés ----

function shelfItem(m, tag) {
  const sub = m.chapterCount
    ? `${m.chapterCount} chap.${m.rating ? ` · ★ ${m.rating.toFixed(1)}` : ""}`
    : m.author || "";
  return { sourceId: m.sourceId, id: m.id, cover: m.cover, title: m.title, sub, tag: tag || "" };
}

async function renderShelf() {
  const slot = document.getElementById("shelf-slot");
  if (!slot) return;

  // Onglet 1 — historique de lecture (dédoublonné par manga)
  const history = [];
  const seenHistory = new Set();
  for (const h of serverState.history || []) {
    if (!h.sourceId || !h.mangaId || !h.mangaTitle) continue;
    const key = `${h.sourceId}:${h.mangaId}`;
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    history.push(shelfItem({
      sourceId: h.sourceId,
      id: h.mangaId,
      cover: h.cover,
      title: h.mangaTitle,
      author: "",
    }, `Reprendre · Chapitre ${h.order ?? ""}`.trim() || "Reprendre"));
  }

  // Onglets 2 & 3 — mangas du moment + nouveautés (un seul appel chacun, en parallèle)
  const [popular, recent] = await Promise.all([
    api.search({ sort: "popularity", limit: 16 }).catch(() => ({ results: [] })),
    api.search({ sort: "recent", limit: 16 }).catch(() => ({ results: [] })),
  ]);

  const tabs = [];
  if (history.length) {
    tabs.push({ id: "reprise", label: "À la une", hint: "Ton historique de lecture", items: history });
  }
  tabs.push({
    id: "popular",
    label: "Mangas du moment",
    hint: "Les plus suivis sur MangaDex",
    items: (popular.results || []).filter((m) => m.cover).map((m) => shelfItem(m, "Populaire")),
  });
  tabs.push({
    id: "recent",
    label: "Nouveautés",
    hint: "Les derniers chapitres publiés",
    items: (recent.results || []).filter((m) => m.cover).map((m) => shelfItem(m, "Nouveau")),
  });
  const usable = tabs.filter((t) => t.items.length);
  if (!usable.length) {
    slot.innerHTML = "";
    return;
  }

  slot.innerHTML = `
    <section class="shelf" aria-label="Sélection de mangas">
      <div class="shelf-head">
        <div>
          <span class="eyebrow">Explorer</span>
          <h2 id="shelf-title">${escapeHtml(usable[0].label)}</h2>
          <p class="shelf-hint" id="shelf-hint">${icon("sparkle", 13)} <span>${escapeHtml(usable[0].hint || "")}</span></p>
        </div>
        <div class="shelf-controls">
          <button class="bubble-btn" data-shelf-surprise title="Manga au hasard" aria-label="Manga au hasard">${icon("shuffle", 16)}</button>
          <button class="shelf-btn" data-shelf-prev aria-label="Précédent" title="Précédent">${icon("arrowLeft", 18)}</button>
          <button class="shelf-btn" data-shelf-next aria-label="Suivant" title="Suivant">${icon("arrowRight", 18)}</button>
        </div>
      </div>
      <div class="shelf-tabs" role="tablist" aria-label="Rubriques">
        ${usable.map((t, i) => `<button class="shelf-tab ${i === 0 ? "active" : ""}" role="tab" data-tab="${t.id}" aria-selected="${i === 0}">${escapeHtml(t.label)}</button>`).join("")}
      </div>
      <div class="shelf-viewport" data-shelf-view>
        <div class="shelf-track" data-shelf-track></div>
      </div>
    </section>`;

  const view = slot.querySelector("[data-shelf-view]");
  const track = slot.querySelector("[data-shelf-track]");
  const titleEl = slot.querySelector("#shelf-title");
  const hintEl = slot.querySelector("#shelf-hint span");
  const prev = slot.querySelector("[data-shelf-prev]");
  const next = slot.querySelector("[data-shelf-next]");
  const surprise = slot.querySelector("[data-shelf-surprise]");
  const tabBtns = [...slot.querySelectorAll(".shelf-tab")];

  let active = usable[0];
  let timer = null;
  const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function render() {
    const html = active.items
      .map(
        (s) => `
        <button class="shelf-slide" data-src="${escapeHtml(s.sourceId)}" data-nid="${escapeHtml(s.id)}" aria-label="${escapeHtml(s.title)}">
          <span class="shelf-cover">${coverImage(s, s.title)}${s.tag ? `<span class="shelf-tag">${icon("sparkle", 11)} ${escapeHtml(s.tag)}</span>` : ""}</span>
          <span class="shelf-cap"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.sub)}</small></span>
        </button>`
      )
      .join("");
    track.innerHTML = html;
    view.scrollLeft = 0;

    track.querySelectorAll(".shelf-cover img").forEach((img) => {
      img.addEventListener("error", () => img.remove());
    });
    track.querySelectorAll(".shelf-slide").forEach((slide) => {
      slide.addEventListener("click", () => navigate(`/manga/${slide.dataset.src}/${slide.dataset.nid}`));
    });

    titleEl.textContent = active.label;
    hintEl.textContent = active.hint || "";
    tabBtns.forEach((b) => {
      const isActive = b.dataset.tab === active.id;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", String(isActive));
    });
    syncBtns();
  }

  const step = () => {
    const s = track.querySelector(".shelf-slide");
    if (!s) return 0;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return Math.round(s.getBoundingClientRect().width + gap);
  };
  const atEnd = () => view.scrollLeft + view.clientWidth >= view.scrollWidth - 12;
  function go(back = false) {
    if (back) view.scrollBy({ left: -step(), behavior: "smooth" });
    else if (atEnd()) view.scrollTo({ left: 0, behavior: "smooth" });
    else view.scrollBy({ left: step(), behavior: "smooth" });
    syncBtns();
  }
  function syncBtns() {
    const no = view.scrollWidth <= view.clientWidth + 4;
    prev.disabled = no;
    next.disabled = no;
  }
  function start() {
    stop();
    if (!motionOk || active.items.length < 2) return;
    timer = setInterval(() => go(false), 3800);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = usable.find((t) => t.id === btn.dataset.tab);
      if (!tab || tab === active) return;
      active = tab;
      stop();
      render();
      start();
    });
  });
  prev.addEventListener("click", () => { stop(); go(true); start(); });
  next.addEventListener("click", () => { stop(); go(false); start(); });
  view.addEventListener("pointerenter", stop);
  view.addEventListener("pointerleave", start);
  view.addEventListener("focusin", stop);
  view.addEventListener("focusout", () => { if (motionOk) start(); });
  view.addEventListener("scroll", syncBtns, { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  surprise.addEventListener("click", async () => {
    stop();
    surprise.disabled = true;
    try {
      const off = Math.floor(Math.random() * 70) * 24;
      const res = await api.search({ sort: "popularity", limit: 24, offset: off });
      const list = res.results || [];
      const pick = list[Math.floor(Math.random() * list.length)];
      if (!pick) throw new Error("Aucun manga trouvé sur cette page.");
      toast(`Direction « ${pick.title} »…`);
      navigate(`/manga/${pick.sourceId}/${pick.id}`);
    } catch (err) {
      toast(err.message || "Impossible de piocher un manga.", "error");
      if (surprise.isConnected) surprise.disabled = false;
    }
  });

  render();
  start();
}

function wireCards(grid, novels = []) {
  grid.querySelectorAll(".novel-card").forEach((card, index) => {
    const sid = card.dataset.sid;
    const nid = card.dataset.nid;
    const novel = novels[index];

    const open = (e) => {
      if (e.target.closest("[data-fav]")) return;
      navigate(`/manga/${sid}/${nid}`);
    };

    const favBtn = card.querySelector("[data-fav]");
    if (favBtn && novel) {
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const result = toggleFavorite(novel);
        favBtn.classList.toggle("active");
        toast(result.added ? "Ajouté aux favoris" : "Retiré des favoris");
      });
    }

    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(e);
      }
    });
  });
}

export function renderContinue(host) {
  const slot = document.getElementById("continue-slot");
  if (!slot) return;
  const latest = serverState.history[0];
  const last = latest ? latest.chapterId : null;
  if (!latest || !last) {
    slot.innerHTML = "";
    return;
  }

  slot.innerHTML = `
    <div class="continue-card" data-continue>
      <div class="book book-sm" style="${coverAccent({ title: latest.title })}"><div class="book-front continue-cover">${latest.cover ? `<img src="${escapeHtml(latest.cover)}" alt="" loading="lazy" />` : ""}</div><i class="book-pages" aria-hidden="true"></i></div>
      <div class="continue-info">
        <span class="cl">${icon("play", 12)} Reprendre la lecture</span>
        <h3>${escapeHtml(latest.mangaTitle || latest.novelTitle)}</h3>
        <p>${escapeHtml(latest.chapterTitle || `Chapitre ${latest.order || ""}`)}</p>
      </div>
      <button class="btn btn-primary continue-cta">${icon("bookOpen", 16)} Lire</button>
    </div>`;

  slot.querySelector("[data-continue]").addEventListener("click", () => {
    navigate(`/read/${latest.sourceId}/${latest.mangaId || latest.novelId}/${latest.chapterId}`);
  });
}