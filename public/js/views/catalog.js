// OptiManga — vue Catalogue (recherche, filtres, grille, défilement infini)

// Importe le client d'API pour dialoguer avec le serveur.
import { api } from "../api.js";
// Importe la navigation et l'analyse du hash d'URL depuis le routeur.
import { navigate, parseHash } from "../router.js";
// Importe la fabrique d'icônes SVG.
import { icon } from "../icons.js";
// Importe des utilitaires d'interface (échappement, notifications, couvertures).
import { escapeHtml, toast, emptyState, coverAccent, coverImage, coverImageTag, coverPlaceholder } from "../ui.js";
// Importe l'état partagé du serveur et la bascule des favoris.
import { serverState, toggleFavorite } from "../state.js";
// Importe les composants de carte manga et de squelette de grille.
import { mangaCard, skeletonGrid } from "./cards.js";

// Nombre de résultats demandés par page.
const PAGE_SIZE = 24;
// Marge de préchargement du défilement infini, en pixels.
const SENTINEL_MARGIN = 600; // px de préchargement avant la fin de la grille

// Objet regroupant l'état des filtres de recherche.
const filters = {
  // Terme de recherche textuelle.
  q: "",
  // Source sélectionnée (« all » = toutes).
  source: "all",
  // Genre sélectionné (« all » = tous).
  genre: "all",
  // Statut de publication sélectionné.
  status: "all",
  // Critère de tri des résultats.
  sort: "relevance",
};

// Cache mémoire des sources (extensions) disponibles.
let sourcesCache = [];
// Cache mémoire des genres disponibles.
let genresCache = [];

// Fonction de rendu principale de la vue catalogue.
export function renderCatalog({ params, viewRoot }) {
  // Filtres transmis par l'URL (ex. #/catalogue?source=anilist) — accueil.
  const { queryParams } = parseHash();
  // Applique le paramètre « source » de l'URL au filtre si présent.
  if (queryParams.get("source")) filters.source = queryParams.get("source");
  // Applique le paramètre « sort » de l'URL au filtre si présent.
  if (queryParams.get("sort")) filters.sort = queryParams.get("sort");
  // Applique le paramètre « genre » de l'URL au filtre si présent.
  if (queryParams.get("genre")) filters.genre = queryParams.get("genre");
  // Applique le paramètre de recherche « q » de l'URL si présent.
  if (queryParams.has("q")) filters.q = queryParams.get("q");

  // Injecte le squelette HTML de la page (gabarit multiligne, non commenté à l'intérieur).
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

  // Récupère le champ de saisie de recherche.
  const qInput = viewRoot.querySelector("#cat-search");
  // Récupère le menu déroulant des sources.
  const sourceSelect = viewRoot.querySelector("#cat-source");
  // Récupère le menu déroulant des statuts.
  const statusSelect = viewRoot.querySelector("#cat-status");
  // Récupère le menu déroulant du tri.
  const sortSelect = viewRoot.querySelector("#cat-sort");
  // Récupère la zone d'accueil des puces de genres.
  const genresHost = viewRoot.querySelector("#cat-genres");
  // Récupère la grille des résultats.
  const grid = viewRoot.querySelector("#cat-grid");
  // Récupère l'élément affichant le nombre de résultats.
  const countEl = viewRoot.querySelector(".count");
  // Récupère la sentinelle de fin de grille.
  const sentinel = viewRoot.querySelector("#cat-sentinel");

  // Tableau des résultats actuellement affichés.
  let results = [];
  // Décalage (offset) utilisé pour la pagination.
  let offset = 0;
  // Indique si d'autres pages peuvent être chargées.
  let canLoadMore = false;
  // Indique qu'un chargement de page suivante est en cours.
  let loadingMore = false;
  // Nombre de cartes déjà injectées, pour n'ajouter que les nouvelles au défilement.
  let renderedCount = 0;
  let seq = 0; // numéro de séquence : invalide les réponses d'une recherche remplacée

  // ---- Défilement infini : le sentinelle observe la fin de la grille -------
  // Crée un observateur qui déclenche le chargement quand la sentinelle devient visible.
  const observer = new IntersectionObserver(
    // Fonction de rappel appelée à chaque changement de visibilité.
    (entries) => {
      // Si l'une des entrées est visible, on charge la suite.
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    // Options : marge de préchargement verticale.
    { rootMargin: `${SENTINEL_MARGIN}px 0px` }
  );
  // Met la sentinelle sous surveillance.
  observer.observe(sentinel);

  // Vérifie si la sentinelle est dans la zone de préchargement.
  function sentinelInView() {
    // Renvoie vrai si le haut de la sentinelle est proche du bas de la fenêtre.
    return sentinel.getBoundingClientRect().top <= window.innerHeight + SENTINEL_MARGIN;
  }

  // Affiche ou masque la sentinelle selon la possibilité de charger plus.
  function setSentinel() {
    // Affiche la sentinelle seulement si on peut charger davantage.
    sentinel.style.display = canLoadMore ? "" : "none";
  }

  // Charge une page supplémentaire si possible.
  function loadMore() {
    // Tant qu'on ne peut pas charger plus, on ne fait rien.
    if (!canLoadMore || loadingMore) return;
    // Lance une recherche sans réinitialiser les résultats.
    runSearch(false);
  }

  // Construit les puces de genres cliquables.
  function renderGenres() {
    // Prépare la liste « tous genres » + les genres du cache.
    const genres = ["all", ...genresCache];
    // Injecte les puces générées dans la zone des genres.
    genresHost.innerHTML = genres
      // Transforme chaque genre en bouton de puce HTML.
      .map((g) => `<button class="chip ${filters.genre === g ? "active" : ""}" data-genre="${escapeHtml(g)}">${g === "all" ? "Tous genres" : escapeHtml(g)}</button>`)
      // Concatène les puces en une seule chaîne.
      .join("");
    // Pour chaque puce créée, on attache un écouteur de clic.
    genresHost.querySelectorAll(".chip").forEach((chip) => {
      // Gère la sélection d'un genre.
      chip.addEventListener("click", () => {
        // Met à jour le filtre de genre.
        filters.genre = chip.dataset.genre;
        // Redessine les puces pour refléter la sélection.
        renderGenres();
        // Relance la recherche.
        runSearch();
      });
    });
  }

  // Restaure l'état précédent si on revient sur la vue
  // Pré-remplit le champ de recherche avec la valeur mémorisée.
  qInput.value = filters.q;
  // Pré-sélectionne le statut mémorisé.
  statusSelect.value = filters.status;
  // Pré-sélectionne le tri mémorisé.
  sortSelect.value = filters.sort;

  // Applique la recherche pendant la saisie, avec un délai anti-rebond.
  qInput.addEventListener("input", () => {
    // Met à jour le filtre avec la valeur saisie.
    filters.q = qInput.value;
    // Annule le minuteur précédent.
    clearTimeout(qInput._t);
    // Relance la recherche 320 ms après la dernière frappe.
    qInput._t = setTimeout(runSearch, 320);
  });
  // Gère la touche Entrée dans le champ de recherche.
  qInput.addEventListener("keydown", (e) => {
    // Si l'utilisateur appuie sur Entrée…
    if (e.key === "Enter") {
      // …annule le minuteur anti-rebond.
      clearTimeout(qInput._t);
      // Force le filtre à la valeur saisie.
      filters.q = qInput.value;
      // Relance la recherche immédiatement.
      runSearch();
    }
  });
  // Bouton « Rechercher » : relance la recherche.
  viewRoot.querySelector("#cat-submit").addEventListener("click", () => {
    // Récupère la valeur saisie.
    filters.q = qInput.value;
    // Lance la recherche.
    runSearch();
  });
  // Change la source et relance la recherche.
  sourceSelect.addEventListener("change", () => {
    // Met à jour le filtre de source.
    filters.source = sourceSelect.value;
    // Relance la recherche.
    runSearch();
  });
  // Change le statut et relance la recherche.
  statusSelect.addEventListener("change", () => {
    // Met à jour le filtre de statut.
    filters.status = statusSelect.value;
    // Relance la recherche.
    runSearch();
  });
  // Change le tri et relance la recherche.
  sortSelect.addEventListener("change", () => {
    // Met à jour le filtre de tri.
    filters.sort = sortSelect.value;
    // Relance la recherche.
    runSearch();
  });

  /** Applique une page de résultats (reset = première page). */
  function applyPage(res, reset) {
    // Récupère la liste des résultats de la réponse (ou un tableau vide).
    const chunk = res.results || [];
    // Détermine le total, selon que la réponse est paginée ou non.
    const total = res.paginated ? res.total : results.length;
    // Remplace ou concatène les résultats selon le mode reset.
    results = reset ? chunk : results.concat(chunk);
    // Si l'on a reçu des éléments, avance l'offset.
    if (chunk.length) offset += chunk.length;
    // Détermine s'il reste des pages à charger.
    canLoadMore = res.paginated === true && results.length < total;
    // Met à jour le compteur de résultats affiché.
    countEl.innerHTML = `<strong>${results.length}</strong> manga${results.length > 1 ? "s" : ""}${canLoadMore ? `<span class="muted"> sur un total de ${total}</span>` : ""}`;
  }

  // Affiche la grille des résultats (reset) ou ajoute seulement la nouvelle page.
  function renderGrid(reset = true) {
    // Sélectionne les résultats à injecter.
    const items = reset ? results : results.slice(renderedCount);
    // Génère une carte manga pour chaque résultat.
    const html = items.map((m) => mangaCard(m, { showSource: filters.source === "all" })).join("");
    // Remplace la grille au reset, sinon on ajoute à la fin sans recharger les images existantes.
    if (reset) grid.innerHTML = html;
    else grid.insertAdjacentHTML("beforeend", html);
    // Mémorise le nombre de cartes désormais présentes.
    renderedCount = results.length;
    // Attache les interactions aux seules cartes non encore câblées.
    wireCards(grid, results);
    // Met à jour la visibilité de la sentinelle.
    setSentinel();
  }

  // Lance la recherche (reset = true) ou charge la page suivante (reset = false).
  async function runSearch(reset = true) {
    // Cas d'une nouvelle recherche (première page).
    if (reset) {
      // Incrémente la séquence pour invalider les anciennes réponses.
      const mySeq = ++seq;
      // Vide la liste des résultats.
      results = [];
      // Réinitialise l'offset.
      offset = 0;
      // Désactive le chargement supplémentaire.
      canLoadMore = false;
      // Réinitialise l'état de chargement.
      loadingMore = false;
      // Réinitialise le nombre de cartes déjà affichées.
      renderedCount = 0;
      // Cache la sentinelle.
      setSentinel();
      // Affiche des squelettes de chargement dans la grille.
      grid.innerHTML = skeletonGrid(9);
      // Affiche un message de recherche en cours.
      countEl.innerHTML = "<span>Recherche…</span>";
      // Bloc protégé pour capturer les erreurs réseau.
      try {
        // Appelle l'API de recherche avec les filtres courants.
        const res = await api.search({ ...filters, limit: PAGE_SIZE, offset });
        // Ignore la réponse si une autre recherche a été lancée entre-temps.
        if (mySeq !== seq) return;
        // Applique la page reçue en mode remplacement.
        applyPage(res, true);
        // Si aucun résultat n'est trouvé…
        if (!results.length) {
          // …affiche un état vide explicatif.
          grid.innerHTML = emptyState({
            // Nom de l'icône affichée.
            iconName: "search",
            // Titre de l'état vide.
            title: "Aucun résultat",
            // Texte d'aide proposé.
            text: "Essayez un autre terme, changez de genre ou de source.",
          });
          // Cache la sentinelle.
          setSentinel();
          // Termine la fonction.
          return;
        }
        // Sinon, affiche la grille.
        renderGrid(true);
      // Gestion des erreurs.
      } catch (err) {
        // Ignore si une autre recherche a pris le relais.
        if (mySeq !== seq) return;
        // Affiche un état d'erreur.
        grid.innerHTML = emptyState({
          // Nom de l'icône d'information.
          iconName: "info",
          // Titre de l'erreur.
          title: "Recherche impossible",
          // Message d'erreur récupéré ou par défaut.
          text: err.message || "Le serveur n'a pas répondu correctement.",
        });
        // Cache la sentinelle.
        setSentinel();
      }
      // Fin du cas « nouvelle recherche ».
      return;
    }

    // Page suivante (défilement infini)
    // Sécurité : on ne charge pas si c'est impossible ou déjà en cours.
    if (!canLoadMore || loadingMore) return;
    // Marque le chargement comme en cours.
    loadingMore = true;
    // Ajoute une classe d'animation à la sentinelle.
    sentinel.classList.add("loading");
    // Nouvelle séquence pour cette requête.
    const mySeq = ++seq;
    // Bloc protégé pour la requête.
    try {
      // Demande la page suivante à l'API.
      const res = await api.search({ ...filters, limit: PAGE_SIZE, offset });
      // Abandonne si une autre requête a pris le relais.
      if (mySeq !== seq) return;
      // Ajoute les résultats reçus à la suite.
      applyPage(res, false);
      // Ajoute seulement les nouvelles cartes à la grille.
      renderGrid(false);
    // Gestion des erreurs.
    } catch (err) {
      // Signale l'échec seulement si c'est encore la requête courante.
      if (mySeq === seq) toast(err.message || "Impossible de charger la suite.", "error");
    // Bloc exécuté dans tous les cas.
    } finally {
      // Si c'est encore la requête courante…
      if (mySeq === seq) {
        // …réinitialise l'état de chargement.
        loadingMore = false;
        // Retire l'animation de la sentinelle.
        sentinel.classList.remove("loading");
        // Le sentinelle peut toujours être visible (page courte) : on enchaîne.
        // Si la sentinelle est encore visible, relance un chargement.
        if (canLoadMore && sentinelInView()) loadMore();
      }
    }
  }

  // Bases (extensions + genres) puis première recherche
  // Charge les données de base puis lance la première recherche.
  async function init() {
    // Bloc protégé pour les appels de démarrage.
    try {
      // Lance en parallèle la récupération des extensions et des genres.
      const [extData, genresData] = await Promise.all([
        // Récupère les extensions installées (repli vide en cas d'échec).
        api.extensions().catch(() => ({ installed: [] })),
        // Récupère les genres (repli vide en cas d'échec).
        api.genres().catch(() => []),
      ]);
      // Mémorise les extensions installées.
      sourcesCache = extData.installed;
      // Mémorise les genres.
      genresCache = genresData;
      // Remplit le menu des sources avec les extensions disponibles.
      sourceSelect.innerHTML =
        // Option par défaut : toutes les sources.
        `<option value="all">Toutes les sources</option>` +
        sourcesCache
          // Génère une option par source.
          .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
          // Concatène les options en une chaîne.
          .join("");
      // Sélectionne la source mémorisée.
      sourceSelect.value = filters.source;
      // Affiche les puces de genres.
      renderGenres();
    // En cas d'erreur de chargement des bases.
    } catch {
      /* repli : recherche sans filtre de source */
    }
    // Lance la recherche initiale.
    runSearch();
  }

  // Affiche la carte « reprendre la lecture ».
  renderContinue();
  // Affiche le carrousel « à la une ».
  renderShelf();
  // Initialise les sources, genres et la première recherche.
  init();

  // Renvoie l'objet de cycle de vie de la vue.
  return {
    // Méthode appelée lors du démontage de la vue.
    cleanup() {
      // Arrête l'observateur de défilement infini.
      observer.disconnect();
      // Annule le minuteur de recherche en attente.
      clearTimeout(qInput._t);
    },
  };
}

// ---- Carrousel « À la une » : historique + mangas du moment + nouveautés ----

// Construit un élément de carrousel à partir d'un manga et d'une étiquette.
function shelfItem(m, tag) {
  // Sous-titre : nombre de chapitres (avec note) ou auteur.
  const sub = m.chapterCount
    // Format « N chap. · ★ note » quand un nombre de chapitres existe.
    ? `${m.chapterCount} chap.${m.rating ? ` · ★ ${m.rating.toFixed(1)}` : ""}`
    // Sinon, on affiche l'auteur (ou une chaîne vide).
    : m.author || "";
  // Renvoie l'objet normalisé attendu par le carrousel.
  return { sourceId: m.sourceId, id: m.id, cover: m.cover, title: m.title, sub, tag: tag || "" };
}

// Construit et anime le carrousel « À la une ».
async function renderShelf() {
  // Récupère l'emplacement prévu pour le carrousel.
  const slot = document.getElementById("shelf-slot");
  // Si l'emplacement n'existe pas, on s'arrête.
  if (!slot) return;

  // Onglet 1 — historique de lecture (dédoublonné par manga)
  // Liste des éléments d'historique.
  const history = [];
  // Ensemble des clés déjà vues pour dédoublonner.
  const seenHistory = new Set();
  // Parcourt l'historique de lecture du serveur.
  for (const h of serverState.history || []) {
    // Ignore les entrées incomplètes.
    if (!h.sourceId || !h.mangaId || !h.mangaTitle) continue;
    // Construit une clé unique source + manga.
    const key = `${h.sourceId}:${h.mangaId}`;
    // Ignore les doublons déjà traités.
    if (seenHistory.has(key)) continue;
    // Enregistre la clé comme vue.
    seenHistory.add(key);
    // Ajoute l'entrée formatée à l'historique.
    history.push(shelfItem({
      // Identifiant de la source.
      sourceId: h.sourceId,
      // Identifiant du manga.
      id: h.mangaId,
      // Couverture du manga.
      cover: h.cover,
      // Titre du manga.
      title: h.mangaTitle,
      // Auteur inconnu dans l'historique.
      author: "",
    }, `Reprendre · Chapitre ${h.order ?? ""}`.trim() || "Reprendre"));
  }

  // Onglets 2 & 3 — mangas du moment + nouveautés (un seul appel chacun, en parallèle)
  // Récupère en parallèle les mangas populaires et récents.
  const [popular, recent] = await Promise.all([
    // Recherche des mangas les plus populaires.
    api.search({ sort: "popularity", limit: 16 }).catch(() => ({ results: [] })),
    // Recherche des mangas les plus récents.
    api.search({ sort: "recent", limit: 16 }).catch(() => ({ results: [] })),
  ]);

  // Tableau des onglets du carrousel.
  const tabs = [];
  // Ajoute l'onglet historique seulement s'il contient des éléments.
  if (history.length) {
    // Ajoute l'onglet « À la une » basé sur l'historique.
    tabs.push({ id: "reprise", label: "À la une", hint: "Ton historique de lecture", items: history });
  }
  // Ajoute l'onglet des mangas du moment.
  tabs.push({
    // Identifiant de l'onglet.
    id: "popular",
    // Libellé affiché.
    label: "Mangas du moment",
    // Texte d'aide affiché.
    hint: "Les plus suivis sur MangaDex",
    // Éléments : résultats populaires avec couverture, formatés.
    items: (popular.results || []).filter((m) => m.cover).map((m) => shelfItem(m, "Populaire")),
  });
  // Ajoute l'onglet des nouveautés.
  tabs.push({
    // Identifiant de l'onglet.
    id: "recent",
    // Libellé affiché.
    label: "Nouveautés",
    // Texte d'aide affiché.
    hint: "Les derniers chapitres publiés",
    // Éléments : résultats récents avec couverture, formatés.
    items: (recent.results || []).filter((m) => m.cover).map((m) => shelfItem(m, "Nouveau")),
  });
  // Ne conserve que les onglets non vides.
  const usable = tabs.filter((t) => t.items.length);
  // S'il n'y a aucun onglet utilisable…
  if (!usable.length) {
    // …vide l'emplacement et s'arrête.
    slot.innerHTML = "";
    return;
  }

  // Injecte le gabarit HTML du carrousel (multiligne).
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

  // Récupère la zone de défilement du carrousel.
  const view = slot.querySelector("[data-shelf-view]");
  // Récupère la piste contenant les diapositives.
  const track = slot.querySelector("[data-shelf-track]");
  // Récupère le titre affiché du carrousel.
  const titleEl = slot.querySelector("#shelf-title");
  // Récupère le texte d'aide affiché.
  const hintEl = slot.querySelector("#shelf-hint span");
  // Récupère le bouton « précédent ».
  const prev = slot.querySelector("[data-shelf-prev]");
  // Récupère le bouton « suivant ».
  const next = slot.querySelector("[data-shelf-next]");
  // Récupère le bouton « au hasard ».
  const surprise = slot.querySelector("[data-shelf-surprise]");
  // Récupère tous les boutons d'onglet.
  const tabBtns = [...slot.querySelectorAll(".shelf-tab")];

  // Onglet actuellement actif.
  let active = usable[0];
  // Identifiant du minuteur de défilement automatique.
  let timer = null;
  // Indique si les animations sont autorisées par les préférences.
  const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Affiche les diapositives de l'onglet actif.
  function render() {
    // Construit le HTML des diapositives.
    const html = active.items
      // Transforme chaque élément en diapositive.
      .map(
        // Gabarit d'une diapositive (multiligne).
        (s) => `
        <button class="shelf-slide" data-src="${escapeHtml(s.sourceId)}" data-nid="${escapeHtml(s.id)}" aria-label="${escapeHtml(s.title)}">
          <span class="shelf-cover">${coverImage(s, s.title)}${s.tag ? `<span class="shelf-tag">${icon("sparkle", 11)} ${escapeHtml(s.tag)}</span>` : ""}</span>
          <span class="shelf-cap"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.sub)}</small></span>
        </button>`
      )
      // Concatène les diapositives en une chaîne.
      .join("");
    // Injecte les diapositives dans la piste.
    track.innerHTML = html;
    // Replace la vue au début.
    view.scrollLeft = 0;

    // Les couvertures cassées sont remplacées par le repli global de l'interface.
    // Pour chaque diapositive, ajoute la navigation au clic.
    track.querySelectorAll(".shelf-slide").forEach((slide) => {
      // Navigue vers la fiche manga correspondante.
      slide.addEventListener("click", () => navigate(`/manga/${slide.dataset.src}/${slide.dataset.nid}`));
    });

    // Met à jour le titre affiché.
    titleEl.textContent = active.label;
    // Met à jour le texte d'aide affiché.
    hintEl.textContent = active.hint || "";
    // Met à jour l'état visuel des boutons d'onglet.
    tabBtns.forEach((b) => {
      // Détermine si ce bouton correspond à l'onglet actif.
      const isActive = b.dataset.tab === active.id;
      // Applique ou retire la classe active.
      b.classList.toggle("active", isActive);
      // Met à jour l'attribut d'accessibilité.
      b.setAttribute("aria-selected", String(isActive));
    });
    // Synchronise l'état des boutons précédent/suivant.
    syncBtns();
  }

  // Calcule la largeur d'une diapositive plus l'espacement.
  const step = () => {
    // Prend la première diapositive.
    const s = track.querySelector(".shelf-slide");
    // Si aucune diapositive, le pas vaut zéro.
    if (!s) return 0;
    // Lit l'espacement entre colonnes.
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    // Renvoie largeur + espacement, arrondis.
    return Math.round(s.getBoundingClientRect().width + gap);
  };
  // Indique si la vue est arrivée en fin de défilement.
  const atEnd = () => view.scrollLeft + view.clientWidth >= view.scrollWidth - 12;
  // Fait défiler le carrousel dans une direction.
  function go(back = false) {
    // Défile vers la gauche (précédent).
    if (back) view.scrollBy({ left: -step(), behavior: "smooth" });
    // Si on est à la fin, revient au début.
    else if (atEnd()) view.scrollTo({ left: 0, behavior: "smooth" });
    // Sinon, avance d'un pas.
    else view.scrollBy({ left: step(), behavior: "smooth" });
    // Met à jour les boutons.
    syncBtns();
  }
  // Active ou désactive les boutons précédent/suivant.
  function syncBtns() {
    // Détecte s'il n'y a rien à faire défiler.
    const no = view.scrollWidth <= view.clientWidth + 4;
    // Désactive le bouton précédent si inutile.
    prev.disabled = no;
    // Désactive le bouton suivant si inutile.
    next.disabled = no;
  }
  // Démarre le défilement automatique.
  function start() {
    // Arrête d'abord tout minuteur existant.
    stop();
    // Ne démarre pas si animations désactivées ou trop peu d'éléments.
    if (!motionOk || active.items.length < 2) return;
    // Relance le défilement toutes les 3,8 secondes.
    timer = setInterval(() => go(false), 3800);
  }
  // Arrête le défilement automatique.
  function stop() {
    // Annule le minuteur s'il existe.
    if (timer) clearInterval(timer);
    // Réinitialise la référence du minuteur.
    timer = null;
  }

  // Attache la gestion du clic sur chaque onglet.
  tabBtns.forEach((btn) => {
    // Gère le changement d'onglet.
    btn.addEventListener("click", () => {
      // Retrouve l'onglet correspondant au bouton.
      const tab = usable.find((t) => t.id === btn.dataset.tab);
      // Ignore si invalide ou déjà actif.
      if (!tab || tab === active) return;
      // Active le nouvel onglet.
      active = tab;
      // Stoppe le défilement automatique.
      stop();
      // Redessine les diapositives.
      render();
      // Redémarre le défilement automatique.
      start();
    });
  });
  // Bouton précédent : arrête, recule, redémarre.
  prev.addEventListener("click", () => { stop(); go(true); start(); });
  // Bouton suivant : arrête, avance, redémarre.
  next.addEventListener("click", () => { stop(); go(false); start(); });
  // Met en pause le défilement au survol.
  view.addEventListener("pointerenter", stop);
  // Reprend le défilement quand la souris quitte.
  view.addEventListener("pointerleave", start);
  // Met en pause quand un élément prend le focus.
  view.addEventListener("focusin", stop);
  // Reprend quand le focus quitte.
  view.addEventListener("focusout", () => { if (motionOk) start(); });
  // Synchronise les boutons lors du défilement.
  view.addEventListener("scroll", syncBtns, { passive: true });
  // Pause/reprise selon la visibilité de l'onglet navigateur.
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  // Bouton « manga au hasard ».
  surprise.addEventListener("click", async () => {
    // Stoppe le défilement automatique.
    stop();
    // Désactive le bouton pendant l'opération.
    surprise.disabled = true;
    // Bloc protégé pour la requête.
    try {
      // Calcule un décalage aléatoire dans les résultats.
      const off = Math.floor(Math.random() * 70) * 24;
      // Demande une page de mangas populaires au hasard.
      const res = await api.search({ sort: "popularity", limit: 24, offset: off });
      // Récupère la liste des résultats.
      const list = res.results || [];
      // Choisit un manga au hasard dans la page.
      const pick = list[Math.floor(Math.random() * list.length)];
      // Si aucun manga, lève une erreur explicite.
      if (!pick) throw new Error("Aucun manga trouvé sur cette page.");
      // Affiche une notification annonçant la redirection.
      toast(`Direction « ${pick.title} »…`);
      // Navigue vers la fiche du manga choisi.
      navigate(`/manga/${pick.sourceId}/${pick.id}`);
    // Gestion des erreurs.
    } catch (err) {
      // Affiche un message d'erreur.
      toast(err.message || "Impossible de piocher un manga.", "error");
      // Réactive le bouton s'il est toujours présent.
      if (surprise.isConnected) surprise.disabled = false;
    }
  });

  // Premier rendu des diapositives.
  render();
  // Démarre le défilement automatique.
  start();
}

// Attache les interactions aux cartes de la grille.
function wireCards(grid, novels = []) {
  // Pour chaque carte affichée...
  grid.querySelectorAll(".novel-card:not([data-wired])").forEach((card) => {
    card.dataset.wired = "1";
    // Récupère l'identifiant de source de la carte.
    const sid = card.dataset.sid;
    // Récupère l'identifiant du manga/roman.
    const nid = card.dataset.nid;
    // Retrouve les données correspondantes par index.
    const novel = novels.find((n) => String(n.sourceId) === sid && String(n.id) === nid);

    // Gère l'ouverture de la fiche au clic.
    const open = (e) => {
      // Ignore le clic s'il vient du bouton favori.
      if (e.target.closest("[data-fav]")) return;
      // Navigue vers la fiche du manga.
      navigate(`/manga/${sid}/${nid}`);
    };

    // Récupère le bouton favori de la carte.
    const favBtn = card.querySelector("[data-fav]");
    // Si un bouton favori et des données existent…
    if (favBtn && novel) {
      // …attache le basculement du favori au clic.
      favBtn.addEventListener("click", (e) => {
        // Empêche la propagation vers la carte.
        e.stopPropagation();
        // Bascule le favori et récupère le résultat.
        const result = toggleFavorite(novel);
        // Met à jour l'apparence du bouton.
        favBtn.classList.toggle("active");
        // Affiche une notification selon l'action.
        toast(result.added ? "Ajouté aux favoris" : "Retiré des favoris");
      });
    }

    // Ouvre la fiche au clic sur la carte.
    card.addEventListener("click", open);
    // Gère l'activation au clavier.
    card.addEventListener("keydown", (e) => {
      // Réagit à la touche Entrée ou à l'espace.
      if (e.key === "Enter" || e.key === " ") {
        // Empêche le comportement par défaut (défilement).
        e.preventDefault();
        // Ouvre la fiche.
        open(e);
      }
    });
  });
}

// Affiche la carte « reprendre la lecture » sur l'accueil.
export function renderContinue(host) {
  // Récupère l'emplacement de la carte.
  const slot = document.getElementById("continue-slot");
  // Si l'emplacement n'existe pas, on s'arrête.
  if (!slot) return;
  // Prend la lecture la plus récente de l'historique.
  const latest = serverState.history[0];
  // Récupère l'identifiant du dernier chapitre lu.
  const last = latest ? latest.chapterId : null;
  // S'il n'y a pas de lecture récente…
  if (!latest || !last) {
    // …vide l'emplacement et s'arrête.
    slot.innerHTML = "";
    return;
  }

  // Injecte le gabarit HTML de la carte « reprendre » (multiligne).
  slot.innerHTML = `
    <div class="continue-card" data-continue>
      <div class="book book-sm" style="${coverAccent({ title: latest.title })}"><div class="book-front continue-cover">${latest.cover ? coverImageTag({ cover: latest.cover, id: `${latest.sourceId}:${latest.mangaId}`, title: latest.mangaTitle || latest.novelTitle }) : coverPlaceholder({ id: `${latest.sourceId}:${latest.mangaId}`, title: latest.mangaTitle || latest.novelTitle }, "")}</div><i class="book-pages" aria-hidden="true"></i></div>
      <div class="continue-info">
        <span class="cl">${icon("play", 12)} Reprendre la lecture</span>
        <h3>${escapeHtml(latest.mangaTitle || latest.novelTitle)}</h3>
        <p>${escapeHtml(latest.chapterTitle || `Chapitre ${latest.order || ""}`)}</p>
      </div>
      <button class="btn btn-primary continue-cta">${icon("bookOpen", 16)} Lire</button>
    </div>`;

  // Au clic, reprend la lecture au dernier chapitre.
  slot.querySelector("[data-continue]").addEventListener("click", () => {
    // Navigue vers le lecteur du dernier chapitre.
    navigate(`/read/${latest.sourceId}/${latest.mangaId || latest.novelId}/${latest.chapterId}`);
  });
}
