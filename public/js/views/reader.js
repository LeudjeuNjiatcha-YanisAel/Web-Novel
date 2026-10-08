// MangaHub — lecteur manga (pages en images) : modes paginé & bande, TOC, clavier

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, toast } from "../ui.js";
import { getPrefs, savePrefs, markChapterRead, pushHistory, saveReadingPosition, isChapterRead, getProgress } from "../state.js";

export async function renderReader({ params, viewRoot }) {
  const [sourceId, mangaId, chapterId] = params;
  const prefs = getPrefs();
  const readerPrefs = prefs.reader;

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

  const screen = viewRoot.querySelector(".reader-screen");
  const stage = viewRoot.querySelector("#rd-stage");
  const progressEl = viewRoot.querySelector("#rd-progress");
  const topbar = viewRoot.querySelector("#rd-top");
  const tocDrawer = viewRoot.querySelector("#rd-toc");
  const settingsPop = viewRoot.querySelector("#rd-settings");
  const titleEl = viewRoot.querySelector("#rd-title");
  const subEl = viewRoot.querySelector("#rd-sub");

  let manga = null;
  let chapter = null;
  let cleanupFns = [];
  let saveTimer = null;
  cleanupFns.push(() => clearTimeout(saveTimer));

  // ---- Chargement (fiche + chapitre en parallèle)
  try {
    [manga, chapter] = await Promise.all([
      api.manga(sourceId, mangaId),
      api.chapter(sourceId, mangaId, chapterId),
    ]);
  } catch (err) {
    showUnavailable(err.message, "arrière");
    return;
  }

  const isExternal = Boolean(chapter.externalUrl) || !chapter.pages?.length;
  const totalPages = (chapter.pages || []).length;
  const idx = manga.chapters.findIndex((c) => c.id === chapterId);
  const order = chapter.order ?? (idx >= 0 ? idx + 1 : 0);
  const { prevChap, nextChap } = neighbors(manga.chapters, chapterId);

  titleEl.textContent = manga.title;
  subEl.textContent = isExternal
    ? `Chapitre ${order ?? ""} · éditeur externe`
    : `Chapitre ${order ?? ""} · ${totalPages} pages · ${escapeHtml(manga.sourceName)}`;

  // ---- Suivi de lecture (uniquement chapitres hébergés)
  if (!isExternal) {
    markChapterRead(sourceId, mangaId, chapterId);
    pushHistory({
      sourceId,
      sourceName: manga.sourceName,
      mangaId,
      mangaTitle: manga.title,
      author: manga.author,
      cover: manga.cover,
      chapterId,
      chapterTitle: chapter.title || `Chapitre ${order}`,
      order,
    });
  }

  wireTopNav();

  if (isExternal) {
    renderExternalEmbed();
    return;
  }

  buildSettings();
  renderToc();
  installStage(manga, chapter);

  return {
    cleanup() {
      for (const fn of cleanupFns) try { fn(); } catch { /* ignore */ }
    },
  };

  // ---- Helpers ------------------------------------------------------------

  function neighbors(list, cid) {
    let prev = null;
    let next = null;
    let seen = false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.id === cid) { seen = true; continue; }
      if (!c.externalUrl) {
        if (!seen) prev = c;
        else if (!next) { next = c; break; }
      }
    }
    return { prevChap: prev, nextChap: next };
  }

  function goChapter(c) {
    if (!c) return;
    navigate(`/read/${sourceId}/${mangaId}/${c.id}`);
  }

  function openToc() {
    tocDrawer.classList.add("open");
    viewRoot.querySelector(".toc-drawer-overlay").classList.add("open");
  }
  function closeToc() {
    tocDrawer.classList.remove("open");
    viewRoot.querySelector(".toc-drawer-overlay").classList.remove("open");
  }

  function wireTopNav() {
    viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate(`/manga/${sourceId}/${mangaId}`));
    if (prevChap) viewRoot.querySelector("[data-prev]").addEventListener("click", () => goChapter(prevChap));
    if (nextChap) viewRoot.querySelector("[data-next]").addEventListener("click", () => goChapter(nextChap));
    viewRoot.querySelector("[data-toc]").addEventListener("click", () =>
      tocDrawer.classList.contains("open") ? closeToc() : openToc()
    );
    viewRoot.querySelectorAll("[data-toc-close]").forEach((b) => b.addEventListener("click", closeToc));
    if (settingsPop) viewRoot.querySelector("[data-settings]").addEventListener("click", () => {
      settingsPop.classList.toggle("open");
    });
  }

  function showUnavailable(message, where) {
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
    viewRoot.querySelector("[data-back]").addEventListener("click", () => {
      if (where === "fiche") navigate(`/manga/${sourceId}/${mangaId}`);
      else navigate("/");
    });
  }

  function renderExternalEmbed() {
    const embedUrl = chapter.externalUrl;
    stage.innerHTML = `
      <div class="external-frame">
        <div class="external-frame-bar">
          <span class="external-frame-chip">${icon("external", 13)} Site officiel de l'éditeur</span>
          ${embedUrl
            ? `<a class="btn btn-sm" href="${escapeHtml(embedUrl)}" target="_blank" rel="noopener">${icon("external", 14)} Ouvrir dans un onglet</a>`
            : ""}
        </div>
        <div class="external-frame-body">
          <div class="external-loading" id="ext-loading">${icon("info", 22)}<span>Chargement du lecteur externe…</span></div>
          ${embedUrl ? `<iframe id="ext-iframe" src="${escapeHtml(embedUrl)}" title="${escapeHtml(chapter.title || `Chapitre ${order}`)}" allow="fullscreen; autoplay; encrypted-media" allowfullscreen></iframe>` : ""}
        </div>
        <p class="external-foot">${icon("info", 13)} Certains sites bloquent l'affichage incrusté&nbsp;: si la page reste vide, utilise «&nbsp;Ouvrir dans un onglet&nbsp;».</p>
      </div>`;
    const loading = stage.querySelector("#ext-loading");
    const iframe = stage.querySelector("#ext-iframe");
    const done = () => {
      if (loading) loading.classList.add("done");
      if (iframe) iframe.classList.add("loaded");
    };
    if (iframe) iframe.addEventListener("load", done);
    cleanupFns.push(() => {
      if (iframe) iframe.remove();
    });
    renderToc();
  }

  function renderToc(filter = "") {
    const tocList = viewRoot.querySelector("#rd-toc-list");
    const q = filter.toLowerCase();
    const rows = manga.chapters
      .filter((c) => !q || c.title?.toLowerCase().includes(q))
      .map((c) => {
        const active = c.id === chapterId;
        const isRead = isChapterRead(sourceId, mangaId, c.id);
        return `<button class="toc-item ${active ? "active" : ""}" data-toc-chapter="${escapeHtml(c.id)}">
          <span class="n">${String(c.order ?? "").padStart(2, "0")}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title || `Chapitre ${c.order}`)}</span>
          ${c.externalUrl ? `<span class="toc-external">${icon("external", 13)}</span>` : isRead ? `<span style="color:var(--emerald)">${icon("check", 13)}</span>` : ""}
        </button>`;
      })
      .join("");
    tocList.innerHTML = rows || `<p style="padding:14px;color:var(--reader-text-2);font-size:.85rem">Aucun chapitre</p>`;
    tocList.querySelectorAll("[data-toc-chapter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeToc();
        const target = btn.dataset.tocChapter;
        if (target !== chapterId) navigate(`/read/${sourceId}/${mangaId}/${target}`);
      });
    });
  }

  function buildSettings() {
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

    settingsPop.querySelectorAll("[data-seg]").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-v]");
        if (!btn) return;
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        readerPrefs[seg.dataset.seg] = btn.dataset.v;
        if (seg.dataset.seg === "contrast") screen.dataset.theme = readerPrefs.contrast;
        savePrefs();
        if (seg.dataset.seg !== "contrast" && typeof installStage === "function" && chapter) {
          installStage(manga, chapter);
        }
      });
    });
  }

  // ---- Affichage des pages ------------------------------------------------

  function installStage(mangaData, chapterData) {
    const urls = readerPrefs.quality === "dataSaver" && chapterData.pagesLow?.length
      ? chapterData.pagesLow
      : chapterData.pages;
    const saved = getProgress(sourceId, mangaId)?.last;
    const savedRatio =
      saved && saved.chapterId === chapterId
        ? readerPrefs.mode === "strip"
          ? saved.ratio
          : ((saved.page || 1) - 1) / Math.max(1, urls.length)
        : 0;

    if (readerPrefs.mode === "strip") installStrip(urls, savedRatio);
    else installPaged(urls, savedRatio);
  }

  // --- Mode paginé : une page à la fois, zones de clic + clavier
  function installPaged(urls, savedRatio) {
    let pageIdx = Math.max(0, Math.min(urls.length - 1, Math.round(savedRatio * (urls.length - 1))));

    stage.innerHTML = `
      <div class="reader-pages" id="rd-pages">
        <button class="clickzone z-left" data-pg="prev" aria-label="Page précédente"></button>
        <figure class="reader-page" id="rd-page">
          <img id="rd-img" alt="Page de manga" />
        </figure>
        <button class="clickzone z-right" data-pg="next" aria-label="Page suivante"></button>
      </div>`;

    const pageEl = stage.querySelector("#rd-page");
    const img = stage.querySelector("#rd-img");
    const prevZone = stage.querySelector(".z-left");
    const nextZone = stage.querySelector(".z-right");

    function setPage(i, preload = true) {
      if (i < 0 || i >= urls.length) return;
      pageIdx = i;
      img.classList.add("loading");
      img.onload = () => {
        img.classList.remove("loading");
        img.classList.add("loaded");
      };
      img.onerror = () => {
        img.classList.remove("loading");
        img.alt = "Page indisponible";
        toast("Une page n'a pas pu être chargée.", "error");
      };
      img.src = urls[i];
      img.alt = `Page ${i + 1}`;
      prevZone.style.visibility = i === 0 ? "hidden" : "";
      nextZone.style.visibility = i === urls.length - 1 ? "hidden" : "";
      progressEl.style.width = `${((i + 1) / urls.length) * 100}%`;
      subEl.textContent = `Chapitre ${order ?? ""} · Page ${i + 1} / ${urls.length}`;
      if (preload && i + 1 < urls.length) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = urls[i + 1];
        document.head.appendChild(link);
        setTimeout(() => link.remove(), 3000);
      }
      scheduleSave();
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveReadingPosition(sourceId, mangaId, {
          chapterId,
          chapterTitle: chapter.title || `Chapitre ${order}`,
          order,
          page: pageIdx + 1,
          ratio: pageIdx / Math.max(1, urls.length),
        });
      }, 500);
    }

    function nextPage() {
      if (pageIdx < urls.length - 1) setPage(pageIdx + 1);
      else if (nextChap) goChapter(nextChap);
    }
    function prevPage() {
      if (pageIdx > 0) setPage(pageIdx - 1);
      else if (prevChap) goChapter(prevChap);
    }

    prevZone.addEventListener("click", prevPage);
    nextZone.addEventListener("click", nextPage);

    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
        if (tocDrawer.classList.contains("open")) return closeToc();
        navigate(`/manga/${sourceId}/${mangaId}`);
      } else if (e.key === "ArrowRight") nextPage();
      else if (e.key === "ArrowLeft") prevPage();
      else if (e.key.toLowerCase() === "t") tocDrawer.classList.contains("open") ? closeToc() : openToc();
    };
    window.addEventListener("keydown", onKey);
    cleanupFns.push(() => window.removeEventListener("keydown", onKey));

    setPage(pageIdx);
  }

  // --- Mode bande : toutes les pages empilées avec défilement
  function installStrip(urls, savedRatio) {
    stage.innerHTML = `
      <div class="reader-strip" id="rd-strip">
        ${urls.map((u, i) => `<img src="${escapeHtml(u)}" alt="Page ${i + 1}" loading="${i < 4 ? "eager" : "lazy"}" decoding="async" />`).join("")}
      </div>`;

    const strip = stage.querySelector("#rd-strip");

    function updateFromScroll() {
      const max = strip.scrollHeight - strip.clientHeight;
      const ratio = max > 0 ? strip.scrollTop / max : 1;
      progressEl.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
      const pageCount = Math.min(urls.length, Math.max(1, Math.round((ratio * urls.length) / 10) * 10) + 10);
      subEl.textContent = `Chapitre ${order ?? ""} · ~${Math.min(urls.length, pageCount)} / ${urls.length}`;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveReadingPosition(sourceId, mangaId, {
          chapterId,
          chapterTitle: chapter.title || `Chapitre ${order}`,
          order,
          page: Math.min(urls.length, Math.max(1, Math.round(ratio * urls.length))),
          ratio,
        });
      }, 600);
      handleTopbarAutoHide(ratio);
    }

    let lastRatio = 0;
    const onScroll = () => {
      const max = strip.scrollHeight - strip.clientHeight;
      const ratio = max > 0 ? strip.scrollTop / max : 1;
      updateFromScroll();
      topbar.classList.toggle("rd-top-hide", ratio - lastRatio > 0.001 && ratio > 0.02);
      lastRatio = ratio;
    };
    strip.addEventListener("scroll", onScroll, { passive: true });

    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
        if (tocDrawer.classList.contains("open")) return closeToc();
        navigate(`/manga/${sourceId}/${mangaId}`);
      } else if (e.key === "ArrowRight") {
        if (nextChap) goChapter(nextChap);
      } else if (e.key === "ArrowLeft") {
        if (prevChap) goChapter(prevChap);
      } else if (e.key.toLowerCase() === "t") tocDrawer.classList.contains("open") ? closeToc() : openToc();
    };
    window.addEventListener("keydown", onKey);
    cleanupFns.push(() => window.removeEventListener("keydown", onKey));
    cleanupFns.push(() => strip.removeEventListener("scroll", onScroll));

    topbar.classList.remove("rd-top-hide");
    requestAnimationFrame(() => {
      const max = strip.scrollHeight - strip.clientHeight;
      if (savedRatio > 0 && savedRatio < 0.98 && max > 0) {
        strip.scrollTop = max * savedRatio;
      }
      updateFromScroll();
    });
  }

  function handleTopbarAutoHide() {
    /* géré dans le scroll du mode bande */
  }
}