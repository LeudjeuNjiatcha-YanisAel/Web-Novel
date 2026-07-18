// ===========================================================================
// NovelHub — logique frontend (vanilla JS, sans framework)
// ===========================================================================

const state = {
  currentSourceId: null,
  currentNovel: null,   // dernière fiche novel chargée { id, title, chapters, ... }
  currentChapterId: null,
  readerFontSize: 1.05, // rem
};

const LS_KEYS = {
  favorites: "novelhub:favorites",
  history: "novelhub:history",
  readChapters: "novelhub:readChapters",
};

// ---------------------------------------------------------------------------
// Petit utilitaire de stockage local (bibliothèque de suivi côté client :
// favoris, historique, chapitres lus — le catalogue et les EPUB restent eux
// gérés côté serveur)
// ---------------------------------------------------------------------------
function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ===========================================================================
// Navigation entre vues
// ===========================================================================
function showView(viewName) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${viewName}`).classList.add("active");

  document.querySelectorAll(".nav-item, .tab-item").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(`[data-view="${viewName}"]`).forEach((b) => b.classList.add("active"));

  if (viewName === "library") renderShelf();
  if (viewName === "favorites") renderFavorites();
  if (viewName === "history") renderHistory();
  if (viewName === "extensions") renderExtensions();
}

document.querySelectorAll(".nav-item, .tab-item").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.back));
});

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

// ===========================================================================
// Sources / recherche / catalogue
// ===========================================================================
async function loadExtensionsSelect() {
  const res = await fetch("/api/extensions");
  const sources = await res.json();
  const select = document.getElementById("source-select");
  select.innerHTML = sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  if (sources.length) {
    state.currentSourceId = sources[0].id;
    runSearch("");
  }
}

document.getElementById("source-select").addEventListener("change", (e) => {
  state.currentSourceId = e.target.value;
  runSearch(document.getElementById("search-input").value);
});
document.getElementById("search-btn").addEventListener("click", () =>
  runSearch(document.getElementById("search-input").value)
);
document.getElementById("search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch(e.target.value);
});

function cardTemplate(n, sourceId) {
  const initial = (n.title || "?").trim().charAt(0).toUpperCase();
  const isFav = isFavorite(sourceId, n.id);
  return `
    <div class="card" data-novel-id="${n.id}">
      <button class="fav-toggle ${isFav ? "active" : ""}" data-fav-id="${n.id}" aria-label="Ajouter aux favoris" title="Favori">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}"><path d="M12 20.5C12 20.5 3.5 15.6 3.5 9.6C3.5 6.9 5.6 4.8 8.2 4.8C9.8 4.8 11.2 5.6 12 6.9C12.8 5.6 14.2 4.8 15.8 4.8C18.4 4.8 20.5 6.9 20.5 9.6C20.5 15.6 12 20.5 12 20.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
      <div class="cover"><span class="cover-initial">${initial}</span></div>
      <h3>${n.title}</h3>
      <p>${n.author || "Auteur inconnu"}</p>
    </div>`;
}

async function runSearch(query) {
  const grid = document.getElementById("results-grid");
  grid.innerHTML = `<p class="empty-state">Recherche en cours…</p>`;

  try {
    const res = await fetch(
      `/api/sources/${state.currentSourceId}/search?q=${encodeURIComponent(query || "")}`
    );
    const results = await res.json();

    if (!results.length) {
      grid.innerHTML = `<p class="empty-state">Aucun résultat pour cette recherche.</p>`;
      return;
    }

    grid.innerHTML = results.map((n) => cardTemplate(n, state.currentSourceId)).join("");
    wireGridCards(grid, state.currentSourceId);
  } catch {
    grid.innerHTML = `<p class="empty-state">Erreur lors de la recherche.</p>`;
  }
}

function wireGridCards(grid, sourceId) {
  grid.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".fav-toggle")) return;
      openNovel(sourceId, card.dataset.novelId);
    });
  });
  grid.querySelectorAll(".fav-toggle").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const card = btn.closest(".card");
      const title = card.querySelector("h3").textContent;
      const author = card.querySelector("p").textContent;
      toggleFavorite(sourceId, btn.dataset.favId, title, author);
      btn.classList.toggle("active");
      btn.querySelector("svg").setAttribute("fill", btn.classList.contains("active") ? "currentColor" : "none");
    });
  });
}

// ===========================================================================
// Fiche novel
// ===========================================================================
async function openNovel(sourceId, novelId) {
  state.currentSourceId = sourceId;
  const res = await fetch(`/api/sources/${sourceId}/novels/${novelId}`);
  const novel = await res.json();
  state.currentNovel = novel;

  const readSet = new Set(getReadChapters(sourceId, novelId));
  const isFav = isFavorite(sourceId, novelId);
  const isDone = (novel.status || "").toLowerCase().includes("termin");

  const container = document.getElementById("novel-detail");
  container.innerHTML = `
    <div class="novel-head">
      <div class="novel-cover-lg"><span>${novel.title.charAt(0).toUpperCase()}</span></div>
      <div class="novel-info">
        <h2>${novel.title}</h2>
        <div class="novel-meta">
          <span>${novel.author || "Auteur inconnu"}</span>
          <span class="meta-pill">${novel.status || "Statut inconnu"}</span>
          <span class="meta-pill">${novel.chapters.length} chapitres</span>
        </div>
        <p class="novel-description">${novel.description || ""}</p>
        <button id="fav-detail-btn" class="icon-btn ${isFav ? "active" : ""}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}"><path d="M12 20.5C12 20.5 3.5 15.6 3.5 9.6C3.5 6.9 5.6 4.8 8.2 4.8C9.8 4.8 11.2 5.6 12 6.9C12.8 5.6 14.2 4.8 15.8 4.8C18.4 4.8 20.5 6.9 20.5 9.6C20.5 15.6 12 20.5 12 20.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          ${isFav ? "Dans les favoris" : "Ajouter aux favoris"}
        </button>
      </div>
    </div>

    <div class="download-box">
      <span class="label">Télécharger en EPUB</span>
      <div class="row">
        <div class="range-field">Du chapitre <input type="number" id="from-chapter" min="1" max="${novel.chapters.length}" value="1" /></div>
        <div class="range-field">au <input type="number" id="to-chapter" min="1" max="${novel.chapters.length}" value="${novel.chapters.length}" /></div>
        <button id="download-btn" class="btn-primary">Générer l'EPUB</button>
      </div>
    </div>

    <ul class="chapter-list">
      ${novel.chapters
        .map(
          (c, i) => `
        <li data-chapter-id="${c.id}" class="${readSet.has(c.id) ? "read" : ""}">
          <span><span class="chap-num">#${String(i + 1).padStart(2, "0")}</span>${c.title}</span>
          <span class="arrow">→</span>
        </li>`
        )
        .join("")}
    </ul>
  `;

  container.querySelectorAll(".chapter-list li").forEach((li) => {
    li.addEventListener("click", () => openChapter(sourceId, novelId, li.dataset.chapterId));
  });

  document.getElementById("download-btn").addEventListener("click", () => downloadEpub(sourceId, novelId));

  document.getElementById("fav-detail-btn").addEventListener("click", () => {
    toggleFavorite(sourceId, novelId, novel.title, novel.author);
    openNovel(sourceId, novelId); // re-render pour refléter le nouvel état
  });

  showView("novel");
}

// ===========================================================================
// Lecteur
// ===========================================================================
async function openChapter(sourceId, novelId, chapterId) {
  const res = await fetch(`/api/sources/${sourceId}/novels/${novelId}/chapters/${chapterId}`);
  const chapter = await res.json();

  state.currentChapterId = chapterId;
  const novel = state.currentNovel;
  const idx = novel.chapters.findIndex((c) => c.id === chapterId);

  document.getElementById("reader-content").innerHTML = `
    <h2>${chapter.title}</h2>
    <div class="chapter-body">${chapter.content}</div>
    <div class="reader-nav">
      <button id="prev-chapter" ${idx <= 0 ? "disabled" : ""}>&larr; Chapitre précédent</button>
      <button id="next-chapter" ${idx >= novel.chapters.length - 1 ? "disabled" : ""}>Chapitre suivant &rarr;</button>
    </div>
  `;

  applyReaderFontSize();

  document.getElementById("prev-chapter")?.addEventListener("click", () => {
    if (idx > 0) openChapter(sourceId, novelId, novel.chapters[idx - 1].id);
  });
  document.getElementById("next-chapter")?.addEventListener("click", () => {
    if (idx < novel.chapters.length - 1) openChapter(sourceId, novelId, novel.chapters[idx + 1].id);
  });

  markChapterRead(sourceId, novelId, chapterId);
  pushHistory(sourceId, novelId, novel.title, chapterId, chapter.title);

  showView("reader");
}

function applyReaderFontSize() {
  document.getElementById("reader-content").style.setProperty("--reader-font-size", `${state.readerFontSize}rem`);
}

document.getElementById("font-inc").addEventListener("click", () => {
  state.readerFontSize = Math.min(1.5, +(state.readerFontSize + 0.075).toFixed(3));
  applyReaderFontSize();
});
document.getElementById("font-dec").addEventListener("click", () => {
  state.readerFontSize = Math.max(0.85, +(state.readerFontSize - 0.075).toFixed(3));
  applyReaderFontSize();
});

// ===========================================================================
// Téléchargement EPUB
// ===========================================================================
async function downloadEpub(sourceId, novelId) {
  const from = parseInt(document.getElementById("from-chapter").value, 10);
  const to = parseInt(document.getElementById("to-chapter").value, 10);
  const btn = document.getElementById("download-btn");

  btn.disabled = true;
  btn.textContent = "Génération en cours…";

  try {
    const res = await fetch(`/api/sources/${sourceId}/novels/${novelId}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromChapter: from, toChapter: to }),
    });
    if (!res.ok) throw new Error("Échec de la génération");
    const data = await res.json();
    toast(`EPUB généré : ${data.title}`);
  } catch {
    toast("Erreur lors de la génération de l'EPUB");
  } finally {
    btn.disabled = false;
    btn.textContent = "Générer l'EPUB";
  }
}

// ===========================================================================
// Bibliothèque (étagère des EPUB téléchargés)
// ===========================================================================
async function renderShelf() {
  const res = await fetch("/api/library");
  const entries = await res.json();

  const shelf = document.getElementById("shelf");
  const panel = document.getElementById("shelf-panel") || document.createElement("div");

  if (!entries.length) {
    shelf.innerHTML = `<p class="shelf-empty">Ta bibliothèque est vide. Télécharge un EPUB depuis une fiche novel pour le voir apparaître ici.</p>`;
    return;
  }

  shelf.innerHTML = entries
    .map((e, i) => {
      const tone = (i % 5) + 1;
      return `<div class="spine spine-tone-${tone}" data-idx="${i}" title="${e.title}">
        <span class="spine-title">${e.title}</span>
      </div>`;
    })
    .join("");

  // Panneau détail sous l'étagère
  let detailPanel = document.getElementById("shelf-panel");
  if (!detailPanel) {
    detailPanel = document.createElement("div");
    detailPanel.id = "shelf-panel";
    detailPanel.className = "shelf-panel";
    shelf.after(detailPanel);
  }
  detailPanel.innerHTML = entries
    .map(
      (e) => `
    <div class="shelf-detail-item">
      <div>
        <strong>${e.title}</strong><br/>
        <span class="meta">${e.author || "Auteur inconnu"} · ${e.chapterCount} chapitres</span>
      </div>
      <a href="/downloads/${e.filename}" download>Télécharger</a>
    </div>`
    )
    .join("");
}

// ===========================================================================
// Favoris (localStorage)
// ===========================================================================
function isFavorite(sourceId, novelId) {
  return readLS(LS_KEYS.favorites, []).some((f) => f.sourceId === sourceId && f.novelId === novelId);
}

function toggleFavorite(sourceId, novelId, title, author) {
  const favs = readLS(LS_KEYS.favorites, []);
  const idx = favs.findIndex((f) => f.sourceId === sourceId && f.novelId === novelId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    toast("Retiré des favoris");
  } else {
    favs.unshift({ sourceId, novelId, title, author, addedAt: new Date().toISOString() });
    toast("Ajouté aux favoris");
  }
  writeLS(LS_KEYS.favorites, favs);
}

function renderFavorites() {
  const favs = readLS(LS_KEYS.favorites, []);
  const grid = document.getElementById("favorites-grid");

  if (!favs.length) {
    grid.innerHTML = `<p class="empty-state">Aucun favori pour l'instant. Le cœur sur une fiche novel te permet de le retrouver ici.</p>`;
    return;
  }

  grid.innerHTML = favs.map((f) => cardTemplate({ id: f.novelId, title: f.title, author: f.author }, f.sourceId)).join("");

  grid.querySelectorAll(".card").forEach((card, i) => {
    const entry = favs[i];
    card.addEventListener("click", (e) => {
      if (e.target.closest(".fav-toggle")) return;
      openNovel(entry.sourceId, entry.novelId);
    });
    const favBtn = card.querySelector(".fav-toggle");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(entry.sourceId, entry.novelId, entry.title, entry.author);
      renderFavorites();
    });
  });
}

// ===========================================================================
// Historique de lecture (localStorage)
// ===========================================================================
function pushHistory(sourceId, novelId, novelTitle, chapterId, chapterTitle) {
  let hist = readLS(LS_KEYS.history, []);
  hist = hist.filter((h) => !(h.sourceId === sourceId && h.novelId === novelId)); // un seul entrée par novel, la plus récente
  hist.unshift({ sourceId, novelId, novelTitle, chapterId, chapterTitle, at: new Date().toISOString() });
  writeLS(LS_KEYS.history, hist.slice(0, 50));
}

function renderHistory() {
  const hist = readLS(LS_KEYS.history, []);
  const list = document.getElementById("history-list");

  if (!hist.length) {
    list.innerHTML = `<p class="empty-state">Ton historique de lecture est vide.</p>`;
    return;
  }

  list.innerHTML = hist
    .map(
      (h, i) => `
    <div class="history-item" data-idx="${i}">
      <span class="history-dot"></span>
      <div class="h-info">
        <h4>${h.novelTitle}</h4>
        <span>${h.chapterTitle}</span>
      </div>
      <time>${formatRelativeDate(h.at)}</time>
    </div>`
    )
    .join("");

  list.querySelectorAll(".history-item").forEach((item) => {
    const h = hist[+item.dataset.idx];
    item.addEventListener("click", async () => {
      // recharge la fiche novel pour retrouver la structure des chapitres, puis ouvre le lecteur
      state.currentSourceId = h.sourceId;
      const res = await fetch(`/api/sources/${h.sourceId}/novels/${h.novelId}`);
      state.currentNovel = await res.json();
      openChapter(h.sourceId, h.novelId, h.chapterId);
    });
  });
}

function formatRelativeDate(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `il y a ${days} j`;
}

// ===========================================================================
// Chapitres lus (localStorage)
// ===========================================================================
function getReadChapters(sourceId, novelId) {
  const map = readLS(LS_KEYS.readChapters, {});
  return map[`${sourceId}:${novelId}`] || [];
}

function markChapterRead(sourceId, novelId, chapterId) {
  const map = readLS(LS_KEYS.readChapters, {});
  const key = `${sourceId}:${novelId}`;
  const set = new Set(map[key] || []);
  set.add(chapterId);
  map[key] = [...set];
  writeLS(LS_KEYS.readChapters, map);
}

// ===========================================================================
// Extensions (catalogue)
// ===========================================================================
const EXTENSIONS_CATALOG = [
  {
    id: "demo",
    name: "Bibliothèque de démo",
    domain: "local · données de test",
    desc: "Source de démonstration en mémoire, utilisée pour valider le moteur de l'application.",
    version: "1.0.0",
    functional: true,
  },
  {
    id: "royalroad",
    name: "RoyalRoad",
    domain: "royalroad.com",
    desc: "Nécessite l'implémentation du scraping côté serveur avant activation.",
    version: "—",
    functional: false,
  },
  {
    id: "webnovel",
    name: "WebNovel",
    domain: "webnovel.com",
    desc: "Nécessite l'implémentation du scraping côté serveur avant activation.",
    version: "—",
    functional: false,
  },
  {
    id: "scribblehub",
    name: "ScribbleHub",
    domain: "scribblehub.com",
    desc: "Nécessite l'implémentation du scraping côté serveur avant activation.",
    version: "—",
    functional: false,
  },
];

function renderExtensions() {
  const list = document.getElementById("extensions-list");
  list.innerHTML = EXTENSIONS_CATALOG.map((ext) => {
    const initial = ext.name.charAt(0).toUpperCase();
    return `
      <div class="ext-card">
        <div class="ext-card-head">
          <div class="ext-icon">${initial}</div>
          <div>
            <h3>${ext.name}</h3>
            <div class="ext-domain">${ext.domain}</div>
          </div>
        </div>
        <p class="ext-desc">${ext.desc}</p>
        <div class="ext-card-foot">
          <span class="ext-version">v${ext.version}</span>
          ${
            ext.functional
              ? `<button class="ext-btn installed" disabled>Installée</button>`
              : `<button class="ext-btn install" disabled>Bientôt disponible</button>`
          }
        </div>
      </div>`;
  }).join("");
}

// ===========================================================================
// Init
// ===========================================================================
loadExtensionsSelect();
