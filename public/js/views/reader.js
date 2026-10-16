// OptiManga — lecteur manga (pages en images) : modes paginé & bande, TOC, clavier

// Import de dépendances
import { api } from "../api.js";
// Import de dépendances
import { navigate } from "../router.js";
// Import de dépendances
import { icon } from "../icons.js";
// Import de dépendances
import { escapeHtml, toast } from "../ui.js";
// Import de dépendances
import { getPrefs, savePrefs, markChapterRead, pushHistory, saveReadingPosition, isChapterRead, getProgress } from "../state.js";

// Export de la fonction/render
export async function renderReader({ params, viewRoot }) {
// Déclaration de variable
  const [sourceId, mangaId, chapterId] = params;
// Déclaration de variable
  const prefs = getPrefs();
// Déclaration de variable
  const readerPrefs = prefs.reader;

// Génère le HTML de la vue
  viewRoot.innerHTML = `
    <div class="reader-screen" data-theme="${escapeHtml(readerPrefs.contrast || "dark")}">
      <header class="reader-top" id="rd-top">
        <button class="tool-btn" data-back title="Retour">${icon("arrowLeft", 18)}</button>
        <div class="rt-title">
          <h2 id="rd-title">Chargement…</h2>
          <span id="rd-sub">Récupération du chapitre</span>
        </div>
        <div class="reader-tools">
          <button class="tool-btn" data-prev title="Chapitre précédent">${icon("arrowLeft", 17)}</button>
          <button class="tool-btn" data-next title="Chapitre suivant">${icon("arrowRight", 17)}</button>
          <button class="tool-btn" data-toc title="Table des matières">${icon("list", 18)}</button>
          <button class="tool-btn" data-settings title="Réglages">${icon("type", 18)}</button>
        </div>
        <div class="reader-top-progress"><i id="rd-progress"></i></div>
      </header>

      <div class="reader-stage" id="rd-stage"></div>

      <div class="toc-drawer-overlay" data-toc-close></div>
      <aside class="toc-drawer" id="rd-toc" aria-label="Chapitres">
        <div class="toc-head"><h3>Chapitres</h3><button class="btn btn-sm btn-ghost" data-toc-close>${icon("close", 15)}</button></div>
        <div class="toc-list" id="rd-toc-list"></div>
      </aside>

      <div class="settings-pop" id="rd-settings"></div>
    </div>
  `;

// Déclaration de variable
  const screen = viewRoot.querySelector(".reader-screen");
// Déclaration de variable
  const stage = viewRoot.querySelector("#rd-stage");
// Déclaration de variable
  const progressEl = viewRoot.querySelector("#rd-progress");
// Déclaration de variable
  const topbar = viewRoot.querySelector("#rd-top");
// Déclaration de variable
  const tocDrawer = viewRoot.querySelector("#rd-toc");
// Déclaration de variable
  const settingsPop = viewRoot.querySelector("#rd-settings");
// Déclaration de variable
  const titleEl = viewRoot.querySelector("#rd-title");
// Déclaration de variable
  const subEl = viewRoot.querySelector("#rd-sub");

// Déclaration de variable
  let manga = null;
// Déclaration de variable
  let chapter = null;
// Déclaration de variable
  let cleanupFns = [];
// Déclaration de variable
  let saveTimer = null;
// Ajoute un élément au tableau
  cleanupFns.push(() => clearTimeout(saveTimer));

  // ---- Chargement (fiche + chapitre en parallèle)
// Bloc try/catch
  try {
// Ligne de code
    [manga, chapter] = await Promise.all([
// Ligne de code
      api.manga(sourceId, mangaId),
// Ligne de code
      api.chapter(sourceId, mangaId, chapterId),
// Fermeture de tableau
    ]);
// Gestion d'erreur
  } catch (err) {
// Ligne de code
    showUnavailable(err.message, "arrière");
// Ligne de code
    return;
// Fermeture de bloc
  }

// Déclaration de variable
  const isExternal = Boolean(chapter.externalUrl) || !chapter.pages?.length;
// Déclaration de variable
  const totalPages = (chapter.pages || []).length;
// Déclaration de variable
  const idx = manga.chapters.findIndex((c) => c.id === chapterId);
// Déclaration de variable
  const order = chapter.order ?? (idx >= 0 ? idx + 1 : 0);
// Déclaration de variable
  const { prevChap, nextChap } = neighbors(manga.chapters, chapterId);

// Déclaration de variable
  const isAnime = manga.mediaType === "anime";
// Déclaration de variable
  const label = isAnime ? "Épisode" : "Chapitre";
// Ligne de code
  titleEl.textContent = manga.title;
// Ligne de code
  subEl.textContent = isExternal
// Ligne de code
    ? `${label} ${order ?? ""} · ${isAnime ? "lecteur intégré" : "éditeur externe"}`
// Ligne de code
    : `${label} ${order ?? ""} · ${totalPages} pages · ${escapeHtml(manga.sourceName)}`;

  // ---- Suivi de lecture (uniquement chapitres hébergés)
// Condition
  if (!isExternal) {
// Ligne de code
    markChapterRead(sourceId, mangaId, chapterId);
// Ligne de code
    pushHistory({
// Ligne de code
      sourceId,
// Ligne de code
      sourceName: manga.sourceName,
// Ligne de code
      mangaId,
// Ligne de code
      mangaTitle: manga.title,
// Ligne de code
      author: manga.author,
// Ligne de code
      cover: manga.cover,
// Ligne de code
      chapterId,
// Ligne de code
      chapterTitle: chapter.title || `${label} ${order}`,
// Ligne de code
      order,
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Ligne de code
  wireTopNav();

// Condition
  if (isExternal) {
// Ligne de code
    renderExternalEmbed();
// Ligne de code
    return;
// Fermeture de bloc
  }

// Ligne de code
  buildSettings();
// Ligne de code
  renderToc();
// Ligne de code
  installStage(manga, chapter);

// Retourne l'objet cleanup
  return {
// Ligne de code
    cleanup() {
// Boucle
      for (const fn of cleanupFns) try { fn(); } catch { /* ignore */ }
// Fermeture de bloc
    },
// Fermeture de bloc
  };

  // ---- Helpers ------------------------------------------------------------

// Définition de fonction
  function neighbors(list, cid) {
// Déclaration de variable
    let prev = null;
// Déclaration de variable
    let next = null;
// Déclaration de variable
    let seen = false;
// Boucle
    for (let i = 0; i < list.length; i++) {
// Déclaration de variable
      const c = list[i];
// Condition
      if (c.id === cid) { seen = true; continue; }
      // Tous les chapitres naviguent dans le lecteur (les épisodes « externes »
      // y sont affichés en incrustation), donc on ne les ignore plus.
// Condition
      if (!seen) prev = c;
// Ligne de code
      else if (!next) { next = c; break; }
// Fermeture de bloc
    }
// Retourne l'objet cleanup
    return { prevChap: prev, nextChap: next };
// Fermeture de bloc
  }

// Définition de fonction
  function goChapter(c) {
// Condition
    if (!c) return;
// Ligne de code
    navigate(`/read/${sourceId}/${mangaId}/${c.id}`);
// Fermeture de bloc
  }

// Définition de fonction
  function openToc() {
// Modifie les classes CSS
    tocDrawer.classList.add("open");
// Sélectionne un élément du DOM
    viewRoot.querySelector(".toc-drawer-overlay").classList.add("open");
// Fermeture de bloc
  }
// Définition de fonction
  function closeToc() {
// Modifie les classes CSS
    tocDrawer.classList.remove("open");
// Sélectionne un élément du DOM
    viewRoot.querySelector(".toc-drawer-overlay").classList.remove("open");
// Fermeture de bloc
  }

// Définition de fonction
  function wireTopNav() {
// Ajoute un écouteur d'événement
    viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate(`/manga/${sourceId}/${mangaId}`));
// Condition
    if (prevChap) viewRoot.querySelector("[data-prev]").addEventListener("click", () => goChapter(prevChap));
// Condition
    if (nextChap) viewRoot.querySelector("[data-next]").addEventListener("click", () => goChapter(nextChap));
// Ajoute un écouteur d'événement
    viewRoot.querySelector("[data-toc]").addEventListener("click", () =>
// Modifie les classes CSS
      tocDrawer.classList.contains("open") ? closeToc() : openToc()
// Ligne de code
    );
// Itération sur les éléments
    viewRoot.querySelectorAll("[data-toc-close]").forEach((b) => b.addEventListener("click", closeToc));
// Condition
    if (settingsPop) viewRoot.querySelector("[data-settings]").addEventListener("click", () => {
// Modifie les classes CSS
      settingsPop.classList.toggle("open");
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Définition de fonction
  function showUnavailable(message, where) {
// Génère le HTML de la vue
    viewRoot.innerHTML = `
      <div class="reader-screen" data-theme="dark">
        <header class="reader-top">
          <button class="tool-btn" data-back title="Retour">${icon("arrowLeft", 18)}</button>
          <div class="rt-title"><h2>Chapitre indisponible</h2></div>
        </header>
        <div class="reader-stage" style="display:grid;place-items:center;padding:40px;text-align:center;color:var(--reader-text-2)">
          <div>${icon("info", 40)}<p style="margin-top:12px">${escapeHtml(message || "Le serveur n'a pas répondu.")}</p></div>
        </div>
      </div>`;
// Ajoute un écouteur d'événement
    viewRoot.querySelector("[data-back]").addEventListener("click", () => {
// Condition
      if (where === "fiche") navigate(`/manga/${sourceId}/${mangaId}`);
// Ligne de code
      else navigate("/catalogue");
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Définition de fonction
  function renderExternalEmbed() {
// Déclaration de variable
    const players = Array.isArray(chapter.players) && chapter.players.length
// Ligne de code
      ? chapter.players
// Ligne de code
      : (chapter.externalUrl ? [{ label: "Lecteur", url: chapter.externalUrl }] : []);

// Condition
    if (!players.length) {
// Ligne de code
      stage.innerHTML = `
        <div class="external-screen">
          ${icon("play", 44)}
          <h3>Aucun lecteur disponible</h3>
          <p>Cet épisode n'a pas de source de lecture exploitable pour le moment.</p>
        </div>`;
// Ligne de code
      renderToc();
// Ligne de code
      return;
// Fermeture de bloc
    }

// Déclaration de variable
    let active = 0;
// Déclaration de variable
    const switcher = players.length > 1
// Ligne de code
      ? `<div class="external-player-switch" role="tablist" aria-label="Choix du lecteur">
          <span class="eps-label">${icon("shuffle", 13)} Sources</span>
          ${players
            .map(
              (p, i) =>
                `<button type="button" class="player-chip ${i === 0 ? "active" : ""}" data-player-idx="${i}" data-player-url="${escapeHtml(p.url)}" role="tab">${escapeHtml(p.label)}</button>`
            )
            .join("")}
        </div>`
// Ligne de code
      : "";

// Ligne de code
    stage.innerHTML = `
      <div class="external-frame">
        <div class="external-frame-bar">
          <span class="external-frame-chip">${icon("external", 13)} ${isAnime ? "Lecteur intégré · VF / VOSTFR" : "Site officiel de l'éditeur"}</span>
          <div class="external-frame-actions">
            <button type="button" class="tool-btn tool-btn-xs" data-reload title="Recharger le lecteur">${icon("refresh", 15)}</button>
            <a class="btn btn-sm" href="${escapeHtml(players[0].url)}" target="_blank" rel="noopener">${icon("external", 14)} Nouvel onglet</a>
          </div>
        </div>
        ${switcher}
        <div class="external-frame-body">
          <div class="external-loading" id="ext-loading">
            <span class="external-spinner"></span>
            <span>Chargement du lecteur…</span>
          </div>
          <iframe id="ext-iframe" src="${escapeHtml(players[0].url)}" title="${escapeHtml(chapter.title || `Chapitre ${order}`)}" allow="fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups allow-popups-to-escape-sandbox" referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>
        <p class="external-foot">${icon("info", 13)} ${players.length > 1 ? "Certains lecteurs démarrent après un clic sur ▶. Si l'un reste vide, choisissez une autre source ci-dessus." : "Si la page reste vide, lancez la lecture (▶) ou ouvrez-la dans un nouvel onglet."}</p>
      </div>`;

// Déclaration de variable
    const loading = stage.querySelector("#ext-loading");
// Déclaration de variable
    const iframe = stage.querySelector("#ext-iframe");
// Déclaration de variable
    let fallbackTimer = null;

// Ajoute un élément au tableau
    cleanupFns.push(() => clearTimeout(fallbackTimer));

// Définition de fonction
    function selectChip(idx) {
// Itération sur les éléments
      stage.querySelectorAll("[data-player-idx]").forEach((b) =>
// Modifie les classes CSS
        b.classList.toggle("active", Number(b.dataset.playerIdx) === idx)
// Ligne de code
      );
// Fermeture de bloc
    }

// Définition de fonction
    function loadPlayer(idx, message) {
// Ligne de code
      active = idx;
// Ligne de code
      selectChip(idx);
// Condition
      if (!iframe) return;
// Condition
      if (loading) loading.classList.remove("done");
// Modifie les classes CSS
      iframe.classList.remove("loaded");
// Ligne de code
      iframe.src = players[idx].url;
// Déclaration de variable
      const openLink = stage.querySelector('a[target="_blank"]');
// Condition
      if (openLink) openLink.href = players[idx].url;
// Condition
      if (message) toast(message, "info");
// Ligne de code
      startFallbackTimer();
// Fermeture de bloc
    }

    // Repli automatique : si un lecteur ne charge pas en 12 s, on tente le suivant.
// Définition de fonction
    function startFallbackTimer() {
// Ligne de code
      clearTimeout(fallbackTimer);
// Condition
      if (players.length <= 1) return;
// Ligne de code
      fallbackTimer = setTimeout(() => {
// Condition
        if (iframe && !iframe.classList.contains("loaded")) {
// Déclaration de variable
          const nextIdx = (active + 1) % players.length;
// Ligne de code
          loadPlayer(nextIdx, `Lecteur lent · passage à ${players[nextIdx].label}`);
// Fermeture de bloc
        }
// Fermeture de bloc
      }, 12000);
// Fermeture de bloc
    }

// Déclaration de variable
    const done = () => {
// Ligne de code
      clearTimeout(fallbackTimer);
// Condition
      if (loading) loading.classList.add("done");
// Condition
      if (iframe) iframe.classList.add("loaded");
// Fermeture de bloc
    };
// Ajoute un écouteur d'événement
    iframe.addEventListener("load", done);
// Ajoute un écouteur d'événement
    iframe.addEventListener("error", () => {
// Condition
      if (players.length > 1) {
// Déclaration de variable
        const nextIdx = (active + 1) % players.length;
// Ligne de code
        loadPlayer(nextIdx, `Lecteur indisponible · passage à ${players[nextIdx].label}`);
// Fermeture de bloc
      }
// Fermeture de bloc
    });

// Ajoute un écouteur d'événement
    stage.querySelector("[data-reload]")?.addEventListener("click", () => loadPlayer(active));
// Itération sur les éléments
    stage.querySelectorAll("[data-player-idx]").forEach((btn) => {
// Ajoute un écouteur d'événement
      btn.addEventListener("click", () => loadPlayer(Number(btn.dataset.playerIdx)));
// Fermeture de bloc
    });

// Ligne de code
    startFallbackTimer();
// Ajoute un élément au tableau
    cleanupFns.push(() => {
// Condition
      if (iframe) iframe.remove();
// Fermeture de bloc
    });
// Ligne de code
    renderToc();
// Fermeture de bloc
  }

// Définition de fonction
  function renderToc(filter = "") {
// Déclaration de variable
    const tocList = viewRoot.querySelector("#rd-toc-list");
// Déclaration de variable
    const q = filter.toLowerCase();
// Déclaration de variable
    const rows = manga.chapters
// Filtre les éléments
      .filter((c) => !q || c.title?.toLowerCase().includes(q))
// Transforme les éléments
      .map((c) => {
// Déclaration de variable
        const active = c.id === chapterId;
// Déclaration de variable
        const isRead = isChapterRead(sourceId, mangaId, c.id);
// Retourne une valeur
        return `<button class="toc-item ${active ? "active" : ""}" data-toc-chapter="${escapeHtml(c.id)}">
          <span class="n">${String(c.order ?? "").padStart(2, "0")}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title || `Chapitre ${c.order}`)}</span>
          ${c.externalUrl ? `<span class="toc-external">${icon("external", 13)}</span>` : isRead ? `<span style="color:var(--emerald)">${icon("check", 13)}</span>` : ""}
        </button>`;
// Fermeture de bloc
      })
// Joint les éléments
      .join("");
// Ligne de code
    tocList.innerHTML = rows || `<p style="padding:14px;color:var(--reader-text-2);font-size:.85rem">Aucun chapitre</p>`;
// Itération sur les éléments
    tocList.querySelectorAll("[data-toc-chapter]").forEach((btn) => {
// Ajoute un écouteur d'événement
      btn.addEventListener("click", () => {
// Ligne de code
        closeToc();
// Déclaration de variable
        const target = btn.dataset.tocChapter;
// Condition
        if (target !== chapterId) navigate(`/read/${sourceId}/${mangaId}/${target}`);
// Fermeture de bloc
      });
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Définition de fonction
  function buildSettings() {
// Ligne de code
    settingsPop.innerHTML = `
      <div class="setting-row">
        <div class="setting-label">Mode de lecture</div>
        <div class="seg" data-seg="mode">
          ${Object.entries({ paged: "Pages", strip: "Bande continue" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.mode === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Qualité des pages</div>
        <div class="seg" data-seg="quality">
          ${Object.entries({ full: "Haute", dataSaver: "Éco" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.quality === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Fond</div>
        <div class="seg" data-seg="contrast">
          ${Object.entries({ dark: "Sombre", sepia: "Sépia", light: "Clair" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.contrast === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
    `;

// Itération sur les éléments
    settingsPop.querySelectorAll("[data-seg]").forEach((seg) => {
// Ajoute un écouteur d'événement
      seg.addEventListener("click", (e) => {
// Déclaration de variable
        const btn = e.target.closest("button[data-v]");
// Condition
        if (!btn) return;
// Itération sur les éléments
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
// Modifie les classes CSS
        btn.classList.add("active");
// Ligne de code
        readerPrefs[seg.dataset.seg] = btn.dataset.v;
// Condition
        if (seg.dataset.seg === "contrast") screen.dataset.theme = readerPrefs.contrast;
// Ligne de code
        savePrefs();
// Condition
        if (seg.dataset.seg !== "contrast" && typeof installStage === "function" && chapter) {
// Ligne de code
          installStage(manga, chapter);
// Fermeture de bloc
        }
// Fermeture de bloc
      });
// Fermeture de bloc
    });
// Fermeture de bloc
  }

  // ---- Affichage des pages ------------------------------------------------

// Définition de fonction
  function installStage(mangaData, chapterData) {
// Déclaration de variable
    const urls = readerPrefs.quality === "dataSaver" && chapterData.pagesLow?.length
// Ligne de code
      ? chapterData.pagesLow
// Ligne de code
      : chapterData.pages;
// Déclaration de variable
    const saved = getProgress(sourceId, mangaId)?.last;
// Déclaration de variable
    const savedRatio =
// Ligne de code
      saved && saved.chapterId === chapterId
// Ligne de code
        ? readerPrefs.mode === "strip"
// Ligne de code
          ? saved.ratio
// Ligne de code
          : ((saved.page || 1) - 1) / Math.max(1, urls.length)
// Ligne de code
        : 0;

// Condition
    if (readerPrefs.mode === "strip") installStrip(urls, savedRatio);
// Ligne de code
    else installPaged(urls, savedRatio);
// Fermeture de bloc
  }

  // --- Mode paginé : une page à la fois, zones de clic + clavier
// Définition de fonction
  function installPaged(urls, savedRatio) {
// Déclaration de variable
    let pageIdx = Math.max(0, Math.min(urls.length - 1, Math.round(savedRatio * (urls.length - 1))));

// Ligne de code
    stage.innerHTML = `
      <div class="reader-pages" id="rd-pages">
        <button class="clickzone z-left" data-pg="prev" aria-label="Page précédente"></button>
        <figure class="reader-page" id="rd-page">
          <img id="rd-img" alt="Page de manga" />
          <div class="reader-page-shine" aria-hidden="true"></div>
        </figure>
        <button class="clickzone z-right" data-pg="next" aria-label="Page suivante"></button>
        <div class="reader-page-pill" id="rd-page-pill" aria-live="polite"></div>
      </div>`;

// Déclaration de variable
    const pageEl = stage.querySelector("#rd-page");
// Déclaration de variable
    const img = stage.querySelector("#rd-img");
// Déclaration de variable
    const pill = stage.querySelector("#rd-page-pill");
// Déclaration de variable
    const prevZone = stage.querySelector(".z-left");
// Déclaration de variable
    const nextZone = stage.querySelector(".z-right");

// Définition de fonction
    function setPage(i, preload = true) {
// Condition
      if (i < 0 || i >= urls.length) return;
// Ligne de code
      pageIdx = i;
// Modifie les classes CSS
      img.classList.add("loading");
// Ligne de code
      img.onload = () => {
// Modifie les classes CSS
        img.classList.remove("loading");
// Modifie les classes CSS
        img.classList.add("loaded");
// Fermeture de bloc
      };
// Ligne de code
      img.onerror = () => {
// Modifie les classes CSS
        img.classList.remove("loading");
// Ligne de code
        img.alt = "Page indisponible";
// Ligne de code
        toast("Une page n'a pas pu être chargée.", "error");
// Fermeture de bloc
      };
// Ligne de code
      img.src = urls[i];
// Ligne de code
      img.alt = `Page ${i + 1}`;
// Met à jour le style CSS
      prevZone.style.visibility = i === 0 ? "hidden" : "";
// Met à jour le style CSS
      nextZone.style.visibility = i === urls.length - 1 ? "hidden" : "";
// Met à jour le style CSS
      progressEl.style.width = `${((i + 1) / urls.length) * 100}%`;
// Condition
      if (pill) pill.textContent = `${i + 1} / ${urls.length}`;
// Ligne de code
      subEl.textContent = `Chapitre ${order ?? ""} · Page ${i + 1} / ${urls.length}`;
// Condition
      if (preload && i + 1 < urls.length) {
// Déclaration de variable
        const link = document.createElement("link");
// Ligne de code
        link.rel = "preload";
// Ligne de code
        link.as = "image";
// Ligne de code
        link.href = urls[i + 1];
// Ligne de code
        document.head.appendChild(link);
// Ligne de code
        setTimeout(() => link.remove(), 3000);
// Fermeture de bloc
      }
// Ligne de code
      scheduleSave();
// Fermeture de bloc
    }

// Définition de fonction
    function scheduleSave() {
// Ligne de code
      clearTimeout(saveTimer);
// Ligne de code
      saveTimer = setTimeout(() => {
// Ligne de code
        saveReadingPosition(sourceId, mangaId, {
// Ligne de code
          chapterId,
// Ligne de code
          chapterTitle: chapter.title || `Chapitre ${order}`,
// Ligne de code
          order,
// Ligne de code
          page: pageIdx + 1,
// Ligne de code
          ratio: pageIdx / Math.max(1, urls.length),
// Fermeture de bloc
        });
// Fermeture de bloc
      }, 500);
// Fermeture de bloc
    }

// Définition de fonction
    function nextPage() {
// Condition
      if (pageIdx < urls.length - 1) setPage(pageIdx + 1);
// Ligne de code
      else if (nextChap) goChapter(nextChap);
// Fermeture de bloc
    }
// Définition de fonction
    function prevPage() {
// Condition
      if (pageIdx > 0) setPage(pageIdx - 1);
// Ligne de code
      else if (prevChap) goChapter(prevChap);
// Fermeture de bloc
    }

// Ajoute un écouteur d'événement
    prevZone.addEventListener("click", prevPage);
// Ajoute un écouteur d'événement
    nextZone.addEventListener("click", nextPage);

// Déclaration de variable
    const onKey = (e) => {
// Déclaration de variable
      const tag = document.activeElement?.tagName;
// Condition
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
// Condition
      if (e.key === "Escape") {
// Condition
        if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
// Condition
        if (tocDrawer.classList.contains("open")) return closeToc();
// Ligne de code
        navigate(`/manga/${sourceId}/${mangaId}`);
// Fermeture de bloc
      } else if (e.key === "ArrowRight") nextPage();
// Ligne de code
      else if (e.key === "ArrowLeft") prevPage();
// Modifie les classes CSS
      else if (e.key.toLowerCase() === "t") tocDrawer.classList.contains("open") ? closeToc() : openToc();
// Fermeture de bloc
    };
// Ajoute un écouteur d'événement
    window.addEventListener("keydown", onKey);
// Ajoute un élément au tableau
    cleanupFns.push(() => window.removeEventListener("keydown", onKey));

// Ligne de code
    setPage(pageIdx);
// Fermeture de bloc
  }

  // --- Mode bande : toutes les pages empilées avec défilement
// Définition de fonction
  function installStrip(urls, savedRatio) {
// Ligne de code
    stage.innerHTML = `
      <div class="reader-strip" id="rd-strip">
        ${urls.map((u, i) => `<img src="${escapeHtml(u)}" alt="Page ${i + 1}" loading="${i < 4 ? "eager" : "lazy"}" decoding="async" />`).join("")}
      </div>`;

// Déclaration de variable
    const strip = stage.querySelector("#rd-strip");

// Définition de fonction
    function updateFromScroll() {
// Déclaration de variable
      const max = strip.scrollHeight - strip.clientHeight;
// Déclaration de variable
      const ratio = max > 0 ? strip.scrollTop / max : 1;
// Met à jour le style CSS
      progressEl.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
// Déclaration de variable
      const pageCount = Math.min(urls.length, Math.max(1, Math.round((ratio * urls.length) / 10) * 10) + 10);
// Ligne de code
      subEl.textContent = `Chapitre ${order ?? ""} · ~${Math.min(urls.length, pageCount)} / ${urls.length}`;
// Ligne de code
      clearTimeout(saveTimer);
// Ligne de code
      saveTimer = setTimeout(() => {
// Ligne de code
        saveReadingPosition(sourceId, mangaId, {
// Ligne de code
          chapterId,
// Ligne de code
          chapterTitle: chapter.title || `Chapitre ${order}`,
// Ligne de code
          order,
// Ligne de code
          page: Math.min(urls.length, Math.max(1, Math.round(ratio * urls.length))),
// Ligne de code
          ratio,
// Fermeture de bloc
        });
// Fermeture de bloc
      }, 600);
// Ligne de code
      handleTopbarAutoHide(ratio);
// Fermeture de bloc
    }

// Déclaration de variable
    let lastRatio = 0;
// Déclaration de variable
    const onScroll = () => {
// Déclaration de variable
      const max = strip.scrollHeight - strip.clientHeight;
// Déclaration de variable
      const ratio = max > 0 ? strip.scrollTop / max : 1;
// Ligne de code
      updateFromScroll();
// Modifie les classes CSS
      topbar.classList.toggle("rd-top-hide", ratio - lastRatio > 0.001 && ratio > 0.02);
// Ligne de code
      lastRatio = ratio;
// Fermeture de bloc
    };
// Ajoute un écouteur d'événement
    strip.addEventListener("scroll", onScroll, { passive: true });

// Déclaration de variable
    const onKey = (e) => {
// Déclaration de variable
      const tag = document.activeElement?.tagName;
// Condition
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
// Condition
      if (e.key === "Escape") {
// Condition
        if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
// Condition
        if (tocDrawer.classList.contains("open")) return closeToc();
// Ligne de code
        navigate(`/manga/${sourceId}/${mangaId}`);
// Fermeture de bloc
      } else if (e.key === "ArrowRight") {
// Condition
        if (nextChap) goChapter(nextChap);
// Fermeture de bloc
      } else if (e.key === "ArrowLeft") {
// Condition
        if (prevChap) goChapter(prevChap);
// Fermeture de bloc
      } else if (e.key.toLowerCase() === "t") tocDrawer.classList.contains("open") ? closeToc() : openToc();
// Fermeture de bloc
    };
// Ajoute un écouteur d'événement
    window.addEventListener("keydown", onKey);
// Ajoute un élément au tableau
    cleanupFns.push(() => window.removeEventListener("keydown", onKey));
// Ajoute un élément au tableau
    cleanupFns.push(() => strip.removeEventListener("scroll", onScroll));

// Modifie les classes CSS
    topbar.classList.remove("rd-top-hide");
// Ligne de code
    requestAnimationFrame(() => {
// Déclaration de variable
      const max = strip.scrollHeight - strip.clientHeight;
// Condition
      if (savedRatio > 0 && savedRatio < 0.98 && max > 0) {
// Ligne de code
        strip.scrollTop = max * savedRatio;
// Fermeture de bloc
      }
// Ligne de code
      updateFromScroll();
// Fermeture de bloc
    });
// Fermeture de bloc
  }

// Définition de fonction
  function handleTopbarAutoHide() {
// Ligne de code
    /* géré dans le scroll du mode bande */
// Fermeture de bloc
  }
// Fermeture de bloc
}