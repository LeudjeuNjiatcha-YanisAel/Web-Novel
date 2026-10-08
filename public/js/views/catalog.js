// MangaHub — vue Catalogue (recherche, filtres, grille paginée, reprise)

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, toast, emptyState, coverAccent } from "../ui.js";
import { serverState, toggleFavorite } from "../state.js";
import { mangaCard, skeletonGrid } from "./cards.js";

const PAGE_SIZE = 24;

const filters = {
  q: "",
  source: "all",
  genre: "all",
  status: "all",
  sort: "relevance",
};

let sourcesCache = [];
let genresCache = [];

export async function renderCatalog({ params, viewRoot }) {
  viewRoot.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">Explorer</span>
      <h1>Le catalogue des mangas</h1>
      <p class="lead">Tous les mangas disponibles sont listés ici dès qu'une extension est active. Filtre, trie, suis et télécharge en CBZ.</p>
    </header>

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
    <div class="load-wrap" id="load-wrap" style="display:none">
      <button id="load-more" class="btn btn-ghost">${icon("download", 15)} Charger plus</button>
    </div>
  `;

  const qInput = viewRoot.querySelector("#cat-search");
  const sourceSelect = viewRoot.querySelector("#cat-source");
  const statusSelect = viewRoot.querySelector("#cat-status");
  const sortSelect = viewRoot.querySelector("#cat-sort");
  const genresHost = viewRoot.querySelector("#cat-genres");
  const grid = viewRoot.querySelector("#cat-grid");
  const countEl = viewRoot.querySelector(".count");
  const loadWrap = viewRoot.querySelector("#load-wrap");
  const loadMoreBtn = viewRoot.querySelector("#load-more");

  let results = [];
  let offset = 0;
  let canLoadMore = false;

  // Bases (extensions + genres) en parallèle
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
  renderGenres();

  // Restaure l'état précédent si on revient sur la vue
  qInput.value = filters.q;
  sourceSelect.value = filters.source;
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

  async function runSearch(reset = true) {
    if (reset) {
      results = [];
      offset = 0;
      grid.innerHTML = skeletonGrid(9);
      countEl.innerHTML = "<span>Recherche…</span>";
    } else {
      countEl.innerHTML = "<span>Chargement…</span>";
    }
    try {
      const res = await api.search({ ...filters, limit: PAGE_SIZE, offset });
      const total = res.paginated ? res.total : results.length;
      results = reset ? res.results || [] : results.concat(res.results || []);
      offset = res.results ? offset + res.results.length : offset;
      canLoadMore = res.paginated === true && results.length < total;
      countEl.innerHTML = `<strong>${results.length}</strong> manga${results.length > 1 ? "s" : ""}${canLoadMore ? `<span class="muted"> sur un total de ${total}</span>` : ""}`;
      if (!results.length) {
        grid.innerHTML = emptyState({
          iconName: "search",
          title: "Aucun résultat",
          text: "Essayez un autre terme, changez de genre ou de source.",
        });
        loadWrap.style.display = "none";
        return;
      }
      grid.innerHTML = results.map((m) => mangaCard(m, { showSource: filters.source === "all" })).join("");
      wireCards(grid, results);
      loadWrap.style.display = canLoadMore ? "" : "none";
    } catch (err) {
      if (reset) {
        grid.innerHTML = emptyState({
          iconName: "info",
          title: "Recherche impossible",
          text: err.message || "Le serveur n'a pas répondu correctement.",
        });
      } else {
        toast(err.message || "Impossible de charger la suite.", "error");
      }
      loadWrap.style.display = "none";
    }
  }

  loadMoreBtn.addEventListener("click", () => {
    grid.insertAdjacentHTML("beforeend", `<div class="row-loading">${icon("info", 16)} Chargement…</div>`);
    runSearch(false).finally(() => grid.querySelector(".row-loading")?.remove());
  });

  renderContinue();
  runSearch();
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