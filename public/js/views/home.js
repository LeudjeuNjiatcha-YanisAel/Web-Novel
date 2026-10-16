// OptiManga — page d'accueil premium animée

// Import de dépendances
import { api } from "../api.js";
// Import de dépendances
import { navigate } from "../router.js";
// Import de dépendances
import { icon } from "../icons.js";
// Import de dépendances
import { escapeHtml, coverImage, formatCount } from "../ui.js";
// Import de dépendances
import { serverState } from "../state.js";

// Déclaration de variable
const RANK_BADGE = ["01", "02", "03"];
// Déclaration de variable
const REDUCE_MOTION =
// Ligne de code
  typeof window !== "undefined" &&
// Ligne de code
  window.matchMedia &&
// Ligne de code
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Export de la fonction/render
export function renderHome({ viewRoot }) {
// Déclaration de variable
  const cleanups = [];

// Génère le HTML de la vue
  viewRoot.innerHTML = `
    <section class="home-hero">
      <div class="home-orbs" aria-hidden="true">
        <span class="home-orb orb-a"></span>
        <span class="home-orb orb-b"></span>
        <span class="home-orb orb-c"></span>
      </div>
      <div class="home-hero-inner">
        <span class="home-kicker home-rise" style="--d:0ms">
          ${icon("sparkle", 13)} Anime · Manga · Premium
        </span>
        <h1 class="home-title home-rise" style="--d:70ms">
          Plonge dans ton <span class="home-grad">univers</span> premium
        </h1>
        <p class="home-sub home-rise" style="--d:140ms">
          Catalogue multi-sources, lecteur immersif, export CBZ et suivi synchronisé.
          Découvre les mangas du moment et les animes en VF, en toute légalité.
        </p>
        <div class="home-cta home-rise" style="--d:210ms">
          <a class="btn btn-primary btn-lg" href="#/catalogue">${icon("search", 17)} Explorer le catalogue</a>
          <a class="btn btn-lg" href="#/catalogue?source=animesama">${icon("play", 15)} Anime VF</a>
        </div>
        <div class="home-stats home-rise" id="home-stats" style="--d:280ms">
          <div class="home-stat"><span class="skeleton" style="height:22px;width:42px;border-radius:6px"></span></div>
          <div class="home-stat"><span class="skeleton" style="height:22px;width:52px;border-radius:6px"></span></div>
          <div class="home-stat"><span class="skeleton" style="height:22px;width:46px;border-radius:6px"></span></div>
        </div>
      </div>
    </section>

    <div id="home-continue"></div>
    <div id="home-rails">
      <div class="home-section reveal">${skeletonRail()}</div>
      <div class="home-section reveal">${skeletonRail()}</div>
    </div>
  `;

  // Reprise de lecture immédiate (état déjà chargé)
// Ligne de code
  renderContinue(viewRoot);

  // Révélation au défilement + parallaxe du hero
// Déclaration de variable
  const reveal = createReveal(viewRoot);
// Ligne de code
  reveal.scan();
// Ajoute un élément au tableau
  cleanups.push(() => reveal.destroy());
// Initialise un module/composant
  cleanups.push(initHeroMotion(viewRoot));

  // Données en parallèle (asynchrone, non bloquant)
// Initialise un module/composant
  loadRails(viewRoot, reveal, cleanups);

// Retourne l'objet cleanup
  return {
// Ligne de code
    cleanup() {
// Itération sur les éléments
      cleanups.forEach((fn) => {
// Bloc try/catch
        try {
// Ligne de code
          fn && fn();
// Gestion d'erreur
        } catch (err) {
// Ligne de code
          console.warn(err);
// Fermeture de bloc
        }
// Fermeture de bloc
      });
// Fermeture de bloc
    },
// Fermeture de bloc
  };
// Fermeture de bloc
}

// Définition d'une fonction asynchrone
async function loadRails(viewRoot, reveal, cleanups) {
// Déclaration de variable
  const [extData, stats, popular, recent] = await Promise.all([
// Appel à l'API
    api.extensions().catch(() => ({ installed: [] })),
// Appel à l'API
    api.stats().catch(() => null),
// Appel à l'API
    api.search({ sort: "popularity", limit: 14 }).catch(() => ({ results: [] })),
// Appel à l'API
    api.search({ sort: "recent", limit: 14 }).catch(() => ({ results: [] })),
// Ligne de code
  ]);

// Condition
  if (!viewRoot.isConnected) return;

// Ligne de code
  renderStats(viewRoot, stats, extData.installed || [], (popular.results || []).length);

// Déclaration de variable
  const animeSource = (extData.installed || []).find((e) => e.mediaType === "anime" && e.enabled);
// Déclaration de variable
  const animeRail = animeSource
// Appel à l'API
    ? await api.search({ source: animeSource.id, sort: "popularity", limit: 14 }).catch(() => ({ results: [] }))
// Ligne de code
    : null;

// Condition
  if (!viewRoot.isConnected) return;

// Déclaration de variable
  const railsHost = viewRoot.querySelector("#home-rails");
// Condition
  if (!railsHost) return;
// Déclaration de variable
  const rails = [];

// Ajoute un élément au tableau
  rails.push({
// Ligne de code
    id: "popular",
// Ligne de code
    icon: "sparkle",
// Ligne de code
    title: "Tendances du moment",
// Ligne de code
    hint: "Les titres les plus suivis",
// Ligne de code
    items: popular.results || [],
// Ligne de code
    href: "#/catalogue?sort=popularity",
// Ligne de code
    ranked: true,
// Fermeture de bloc
  });
// Ajoute un élément au tableau
  rails.push({
// Ligne de code
    id: "recent",
// Ligne de code
    icon: "clock",
// Ligne de code
    title: "Nouveautés",
// Ligne de code
    hint: "Fraîchement publiés",
// Ligne de code
    items: recent.results || [],
// Ligne de code
    href: "#/catalogue?sort=recent",
// Fermeture de bloc
  });
// Condition
  if (animeRail && (animeRail.results || []).length) {
// Ajoute un élément au tableau
    rails.push({
// Ligne de code
      id: "anime",
// Ligne de code
      icon: "play",
// Ligne de code
      title: "Anime VF",
// Ligne de code
      hint: "Streaming officiel, priorité au français",
// Ligne de code
      items: animeRail.results,
// Ligne de code
      href: `#/catalogue?source=${encodeURIComponent(animeSource.id)}`,
// Ligne de code
      accent: true,
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Déclaration de variable
  const usable = rails.filter((r) => r.items.length);
// Ligne de code
  railsHost.innerHTML = usable.length
// Transforme les éléments
    ? usable.map((r) => railHtml(r)).join("")
// Ligne de code
    : `<div class="empty">${icon("info", 40)}<h3>Rien à afficher</h3><p>Active une extension pour remplir ton accueil.</p></div>`;

// Ligne de code
  wireRails(railsHost);
// Itération sur les éléments
  railsHost.querySelectorAll(".home-rail-shell").forEach((shell) => cleanups.push(initRail(shell)));
// Ligne de code
  reveal.scan(railsHost);
// Fermeture de bloc
}

// Définition d'une fonction
function renderStats(viewRoot, data, extensions, popularCount) {
// Déclaration de variable
  const host = viewRoot.querySelector("#home-stats");
// Condition
  if (!host) return;
// Déclaration de variable
  const active = extensions.filter((e) => e.enabled).length;
// Déclaration de variable
  const values = [
// Ligne de code
    { value: data ? data.mangas : popularCount, label: "titres" },
// Ligne de code
    { value: active || extensions.length, label: "sources" },
// Ligne de code
    { value: data ? data.chapters : null, label: "chapitres" },
// Fermeture de tableau
  ];
// Ligne de code
  host.innerHTML = values
// Transforme les éléments
    .map((v) => {
// Déclaration de variable
      const isNum = v.value != null && Number.isFinite(Number(v.value));
// Déclaration de variable
      const initial = isNum ? (REDUCE_MOTION ? formatCount(Number(v.value)) : "0") : "—";
// Déclaration de variable
      const attr = isNum ? ` data-count="${Number(v.value)}"` : "";
// Retourne une valeur
      return `<div class="home-stat">
        <strong${attr}>${escapeHtml(initial)}</strong>
        <span>${escapeHtml(v.label)}</span>
      </div>`;
// Fermeture de bloc
    })
// Joint les éléments en chaîne
    .join("");

// Condition
  if (REDUCE_MOTION) return;
// Itération sur les éléments
  host.querySelectorAll("strong[data-count]").forEach((el, i) => {
// Déclaration de variable
    const target = Number(el.dataset.count) || 0;
// Condition
    if (!target) {
// Ligne de code
      el.textContent = formatCount(target);
// Ligne de code
      return;
// Fermeture de bloc
    }
// Programme un délai/animation
    setTimeout(() => animateCount(el, target), 240 + i * 90);
// Fermeture de bloc
  });
// Fermeture de bloc
}

// Définition d'une fonction
function animateCount(el, target) {
// Déclaration de variable
  const duration = 950;
// Déclaration de variable
  const start = performance.now();
// Définition d'une fonction
  function tick(now) {
// Déclaration de variable
    const t = Math.min(1, (now - start) / duration);
// Déclaration de variable
    const eased = 1 - Math.pow(1 - t, 3);
// Ligne de code
    el.textContent = formatCount(Math.round(target * eased));
// Condition
    if (t < 1) requestAnimationFrame(tick);
// Ligne de code
    else el.textContent = formatCount(target);
// Fermeture de bloc
  }
// Programme un délai/animation
  requestAnimationFrame(tick);
// Fermeture de bloc
}

// Définition d'une fonction
function renderContinue(viewRoot) {
// Déclaration de variable
  const slot = viewRoot.querySelector("#home-continue");
// Condition
  if (!slot) return;
// Déclaration de variable
  const latest = (serverState.history || [])[0];
// Condition
  if (!latest || !latest.chapterId) return;
// Ligne de code
  slot.innerHTML = `
    <button class="home-continue reveal" data-continue>
      <span class="home-continue-cover">${latest.cover ? `<img src="${escapeHtml(latest.cover)}" alt="" loading="lazy" />` : icon("bookOpen", 28)}</span>
      <span class="home-continue-info">
        <span class="home-continue-tag">${icon("play", 12)} Reprendre</span>
        <b>${escapeHtml(latest.mangaTitle || latest.novelTitle || "")}</b>
        <small>${escapeHtml(latest.chapterTitle || `Chapitre ${latest.order || ""}`)}</small>
      </span>
      <span class="home-continue-go">${icon("arrowRight", 18)}</span>
    </button>`;
// Ajoute un écouteur d'événement
  slot.querySelector("[data-continue]").addEventListener("click", () => {
// Ligne de code
    navigate(`/read/${latest.sourceId}/${latest.mangaId || latest.novelId}/${latest.chapterId}`);
// Fermeture de bloc
  });
// Fermeture de bloc
}

// Définition d'une fonction
function railHtml(rail) {
// Déclaration de variable
  const items = rail.items
// Filtre les éléments
    .filter((m) => m && (m.cover || m.title))
// Transforme les éléments
    .map((m, i) => {
// Déclaration de variable
      const rank = rail.ranked && i < 3 ? `<span class="home-rank">${RANK_BADGE[i]}</span>` : "";
// Déclaration de variable
      const sub = m.chapterCount ? `${formatCount(m.chapterCount)} ${m.mediaType === "anime" ? "ép." : "chap."}` : m.author || "";
// Déclaration de variable
      const hoverIcon = m.mediaType === "anime" ? "play" : "bookOpen";
// Retourne une valeur
      return `
        <button class="home-card" data-src="${escapeHtml(m.sourceId)}" data-nid="${escapeHtml(m.id)}" aria-label="${escapeHtml(m.title)}" style="--rd:${Math.min(i, 10) * 45}ms">
          <span class="home-card-cover">${coverImage(m, m.title)}${rank}<span class="home-card-hover">${icon(hoverIcon, 22)}</span></span>
          <span class="home-card-body">
            <b>${escapeHtml(m.title)}</b>
            <small>${escapeHtml(sub)}</small>
          </span>
        </button>`;
// Fermeture de bloc
    })
// Joint les éléments en chaîne
    .join("");

// Retourne une valeur
  return `
    <section class="home-section reveal ${rail.accent ? "accent" : ""}">
      <div class="home-section-head">
        <div>
          <h2>${icon(rail.icon, 17)} ${escapeHtml(rail.title)}</h2>
          <p>${escapeHtml(rail.hint)}</p>
        </div>
        <a class="home-more" href="${escapeHtml(rail.href)}">Tout voir ${icon("chevronRight", 15)}</a>
      </div>
      <div class="home-rail-shell">
        <div class="home-rail" data-rail-track>${items}</div>
        <button class="home-rail-btn prev" type="button" aria-label="Faire défiler vers la gauche" data-rail-prev>${icon("chevronLeft", 18)}</button>
        <button class="home-rail-btn next" type="button" aria-label="Faire défiler vers la droite" data-rail-next>${icon("chevronRight", 18)}</button>
      </div>
    </section>`;
// Fermeture de bloc
}

// Définition d'une fonction
function skeletonRail() {
// Déclaration de variable
  const cells = Array.from({ length: 7 }, () => `
    <div class="home-card is-skeleton">
      <span class="skeleton" style="aspect-ratio:2/3;border-radius:14px"></span>
      <span class="skeleton" style="height:13px;width:80%;border-radius:6px;margin-top:10px"></span>
    </div>`).join("");
// Retourne une valeur
  return `
    <div class="home-section-head">
      <div><h2><span class="skeleton" style="height:20px;width:180px;border-radius:6px;display:inline-block"></span></h2></div>
    </div>
    <div class="home-rail-shell">
      <div class="home-rail" data-rail-track>${cells}</div>
    </div>`;
// Fermeture de bloc
}

// Définition d'une fonction
function wireRails(host) {
// Itération sur les éléments
  host.querySelectorAll(".home-card:not(.is-skeleton)").forEach((card) => {
// Déclaration de variable
    const open = () => navigate(`/manga/${card.dataset.src}/${card.dataset.nid}`);
// Ajoute un écouteur d'événement
    card.addEventListener("click", open);
// Fermeture de bloc
  });
// Fermeture de bloc
}

// ---- Parallaxe douce du hero ----------------------------------------------

// Définition d'une fonction
function initHeroMotion(viewRoot) {
// Déclaration de variable
  const hero = viewRoot.querySelector(".home-hero");
// Condition
  if (!hero || REDUCE_MOTION) return () => {};
// Déclaration de variable
  let raf = 0;

// Définition d'une fonction
  function onMove(e) {
// Déclaration de variable
    const r = hero.getBoundingClientRect();
// Condition
    if (!r.width || !r.height) return;
// Déclaration de variable
    const mx = (e.clientX - r.left) / r.width - 0.5;
// Déclaration de variable
    const my = (e.clientY - r.top) / r.height - 0.5;
// Condition
    if (raf) return;
// Programme un délai/animation
    raf = requestAnimationFrame(() => {
// Ligne de code
      raf = 0;
// Met à jour une propriété CSS
      hero.style.setProperty("--mx", mx.toFixed(3));
// Met à jour une propriété CSS
      hero.style.setProperty("--my", my.toFixed(3));
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Définition d'une fonction
  function onLeave() {
// Condition
    if (raf) cancelAnimationFrame(raf);
// Ligne de code
    raf = 0;
// Met à jour une propriété CSS
    hero.style.setProperty("--mx", "0");
// Met à jour une propriété CSS
    hero.style.setProperty("--my", "0");
// Fermeture de bloc
  }

// Ajoute un écouteur d'événement
  hero.addEventListener("mousemove", onMove);
// Ajoute un écouteur d'événement
  hero.addEventListener("mouseleave", onLeave);
// Retourne une valeur
  return () => {
// Ligne de code
    hero.removeEventListener("mousemove", onMove);
// Ligne de code
    hero.removeEventListener("mouseleave", onLeave);
// Condition
    if (raf) cancelAnimationFrame(raf);
// Fermeture de bloc
  };
// Fermeture de bloc
}

// ---- Révélation au défilement ---------------------------------------------

// Définition d'une fonction
function createReveal(viewRoot) {
// Déclaration de variable
  let io = null;
// Condition
  if (!REDUCE_MOTION && "IntersectionObserver" in window) {
// Ligne de code
    io = new IntersectionObserver(
// Ligne de code
      (entries) => {
// Itération sur les éléments
        entries.forEach((entry) => {
// Condition
          if (entry.isIntersecting) {
// Modifie les classes CSS
            entry.target.classList.add("is-in");
// Ligne de code
            io.unobserve(entry.target);
// Fermeture de bloc
          }
// Fermeture de bloc
        });
// Fermeture de bloc
      },
// Ligne de code
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
// Fermeture de parenthèse
    );
// Fermeture de bloc
  }

// Définition d'une fonction
  function scan(root = viewRoot) {
// Itération sur les éléments
    root.querySelectorAll(".reveal").forEach((el) => {
// Condition
      if (io) io.observe(el);
// Modifie les classes CSS
      else el.classList.add("is-in");
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Retourne l'objet cleanup
  return { scan, destroy() { if (io) io.disconnect(); } };
// Fermeture de bloc
}

// ---- Rails : flèches, glisser, inclinaison 3D -----------------------------

// Définition d'une fonction
function initRail(shell) {
// Déclaration de variable
  const rail = shell.querySelector("[data-rail-track]");
// Condition
  if (!rail) return () => {};
// Déclaration de variable
  const prev = shell.querySelector("[data-rail-prev]");
// Déclaration de variable
  const next = shell.querySelector("[data-rail-next]");
// Déclaration de variable
  const disposers = [];

// Déclaration de variable
  const step = () => Math.max(rail.clientWidth * 0.85, 220);
// Définition d'une fonction
  function updateButtons() {
// Déclaration de variable
    const max = rail.scrollWidth - rail.clientWidth;
// Condition
    if (prev) prev.disabled = rail.scrollLeft <= 2;
// Condition
    if (next) next.disabled = rail.scrollLeft >= max - 2;
// Fermeture de bloc
  }
// Définition d'une fonction
  function go(dir) {
// Gère le défilement
    rail.scrollTo({ left: rail.scrollLeft + dir * step(), behavior: REDUCE_MOTION ? "auto" : "smooth" });
// Fermeture de bloc
  }

// Condition
  if (prev) {
// Déclaration de variable
    const onPrev = () => go(-1);
// Ajoute un écouteur d'événement
    prev.addEventListener("click", onPrev);
// Ajoute un élément au tableau
    disposers.push(() => prev.removeEventListener("click", onPrev));
// Fermeture de bloc
  }
// Condition
  if (next) {
// Déclaration de variable
    const onNext = () => go(1);
// Ajoute un écouteur d'événement
    next.addEventListener("click", onNext);
// Ajoute un élément au tableau
    disposers.push(() => next.removeEventListener("click", onNext));
// Fermeture de bloc
  }

// Ajoute un écouteur d'événement
  rail.addEventListener("scroll", updateButtons, { passive: true });
// Ajoute un élément au tableau
  disposers.push(() => rail.removeEventListener("scroll", updateButtons));
// Ligne de code
  updateButtons();
// Programme un délai/animation
  requestAnimationFrame(updateButtons);

  // Glisser à la souris
// Déclaration de variable
  let down = false;
// Déclaration de variable
  let moved = false;
// Déclaration de variable
  let suppress = false;
// Déclaration de variable
  let startX = 0;
// Déclaration de variable
  let startLeft = 0;

// Définition d'une fonction
  function onDown(e) {
// Condition
    if (e.pointerType === "touch" || e.button !== 0) return;
// Ligne de code
    down = true;
// Ligne de code
    moved = false;
// Ligne de code
    startX = e.clientX;
// Gère le défilement
    startLeft = rail.scrollLeft;
// Modifie les classes CSS
    rail.classList.add("dragging");
// Fermeture de bloc
  }
// Définition d'une fonction
  function onMove(e) {
// Condition
    if (!down) return;
// Déclaration de variable
    const dx = e.clientX - startX;
// Condition
    if (Math.abs(dx) > 4) moved = true;
// Gère le défilement
    rail.scrollLeft = startLeft - dx;
// Fermeture de bloc
  }
// Définition d'une fonction
  function endDrag() {
// Condition
    if (!down) return;
// Ligne de code
    down = false;
// Modifie les classes CSS
    rail.classList.remove("dragging");
// Condition
    if (moved) {
// Ligne de code
      suppress = true;
// Programme un délai/animation
      setTimeout(() => { suppress = false; }, 0);
// Fermeture de bloc
    }
// Fermeture de bloc
  }
// Définition d'une fonction
  function onClickCapture(e) {
// Condition
    if (suppress) {
// Ligne de code
      e.stopImmediatePropagation();
// Ligne de code
      e.preventDefault();
// Fermeture de bloc
    }
// Fermeture de bloc
  }

// Ajoute un écouteur d'événement
  rail.addEventListener("pointerdown", onDown);
// Ajoute un écouteur d'événement
  window.addEventListener("pointerup", endDrag);
// Ajoute un écouteur d'événement
  window.addEventListener("pointermove", onMove);
// Ajoute un écouteur d'événement
  rail.addEventListener("click", onClickCapture, true);
// Ajoute un élément au tableau
  disposers.push(() => {
// Ligne de code
    rail.removeEventListener("pointerdown", onDown);
// Ligne de code
    window.removeEventListener("pointerup", endDrag);
// Ligne de code
    window.removeEventListener("pointermove", onMove);
// Ligne de code
    rail.removeEventListener("click", onClickCapture, true);
// Fermeture de bloc
  });

  // Inclinaison 3D suivant le curseur
// Déclaration de variable
  let tilted = null;
// Définition d'une fonction
  function resetTilt(card) {
// Ligne de code
    card.style.removeProperty("--rx");
// Ligne de code
    card.style.removeProperty("--ry");
// Fermeture de bloc
  }
// Définition d'une fonction
  function onTilt(e) {
// Condition
    if (e.pointerType === "touch" || down) return;
// Déclaration de variable
    const card = e.target.closest?.(".home-card");
// Condition
    if (!card) return;
// Déclaration de variable
    const r = card.getBoundingClientRect();
// Condition
    if (!r.width || !r.height) return;
// Déclaration de variable
    const px = (e.clientX - r.left) / r.width - 0.5;
// Déclaration de variable
    const py = (e.clientY - r.top) / r.height - 0.5;
// Condition
    if (tilted && tilted !== card) resetTilt(tilted);
// Ligne de code
    tilted = card;
// Met à jour une propriété CSS
    card.style.setProperty("--ry", `${(px * 10).toFixed(2)}deg`);
// Met à jour une propriété CSS
    card.style.setProperty("--rx", `${(-py * 10).toFixed(2)}deg`);
// Fermeture de bloc
  }
// Définition d'une fonction
  function onTiltLeave() {
// Condition
    if (tilted) {
// Ligne de code
      resetTilt(tilted);
// Ligne de code
      tilted = null;
// Fermeture de bloc
    }
// Fermeture de bloc
  }
// Ajoute un écouteur d'événement
  rail.addEventListener("pointermove", onTilt);
// Ajoute un écouteur d'événement
  rail.addEventListener("pointerleave", onTiltLeave);
// Ajoute un élément au tableau
  disposers.push(() => {
// Ligne de code
    rail.removeEventListener("pointermove", onTilt);
// Ligne de code
    rail.removeEventListener("pointerleave", onTiltLeave);
// Fermeture de bloc
  });

// Retourne une valeur
  return () => disposers.forEach((fn) => fn());
// Fermeture de bloc
}
