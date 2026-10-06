// NovelHub — lecteur immersif : réglages, TOC, progression, clavier

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, minutesLabel } from "../ui.js";
import { getPrefs, savePrefs, markChapterRead, pushHistory, saveReadingPosition, isChapterRead, getProgress } from "../state.js";

export async function renderReader({ params, viewRoot }) {
  const [sourceId, novelId, chapterId] = params;
  const prefs = getPrefs();
  const readerPrefs = prefs.reader;

  viewRoot.innerHTML = `
    <div class="reader-screen" data-theme="${escapeHtml(readerPrefs.contrast || "dark")}">
      <header class="reader-top">
        <button class="tool-btn" data-back title="Retour">${icon("arrowLeft", 18)}</button>
        <div class="rt-title">
          <h2 id="rd-title">Chargement…</h2>
          <span id="rd-sub">Récupération du chapitre</span>
        </div>
        <div class="reader-tools">
          <button class="tool-btn" data-toc title="Table des matières">${icon("list", 18)}</button>
          <button class="tool-btn" data-settings title="Réglages">${icon("type", 18)}</button>
        </div>
        <div class="reader-top-progress"><i id="rd-progress"></i></div>
      </header>

      <div class="reader-stage" id="rd-stage">
        <article class="reader-paper" id="rd-paper">
          <div class="skeleton" style="height:46px;width:60%;margin:0 auto 30px;border-radius:8px"></div>
          <div class="skeleton" style="height:18px;width:100%;margin-bottom:14px;border-radius:6px"></div>
          <div class="skeleton" style="height:18px;width:96%;margin-bottom:14px;border-radius:6px"></div>
          <div class="skeleton" style="height:18px;width:88%;margin-bottom:14px;border-radius:6px"></div>
          <div class="skeleton" style="height:18px;width:100%;border-radius:6px"></div>
        </article>
      </div>

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
  const paper = viewRoot.querySelector("#rd-paper");
  const progressEl = viewRoot.querySelector("#rd-progress");
  const tocDrawer = viewRoot.querySelector("#rd-toc");
  const settingsPop = viewRoot.querySelector("#rd-settings");
  const titleEl = viewRoot.querySelector("#rd-title");

  let novel = null;
  let chapter = null;
  let cleanupFns = [];

  applyPaperPrefs();

  // ---- Chargement (info + chapitre en parallèle)
  try {
    [novel, chapter] = await Promise.all([
      api.novel(sourceId, novelId),
      api.chapter(sourceId, novelId, chapterId),
    ]);
  } catch (err) {
    viewRoot.innerHTML = `
      <div class="reader-screen" data-theme="${escapeHtml(readerPrefs.contrast)}">
        <header class="reader-top">
          <button class="tool-btn" data-back title="Retour">${icon("arrowLeft", 18)}</button>
          <div class="rt-title"><h2>Chapitre indisponible</h2></div>
        </header>
        <div class="reader-stage" style="display:grid;place-items:center;padding:40px;text-align:center;color:var(--reader-text-2)">
          <div>${icon("info", 40)}<p style="margin-top:12px">${escapeHtml(err.message || "Le serveur n'a pas répondu.")}</p></div>
        </div>
      </div>`;
    viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate(`/novel/${sourceId}/${novelId}`));
    return;
  }

  const idx = novel.chapters.findIndex((c) => c.id === chapterId);
  const order = chapter.order || idx + 1;

  titleEl.textContent = novel.title;
  const sub = viewRoot.querySelector("#rd-sub");
  sub.textContent = `Chapitre ${order} · ${minutesLabel(chapter.wordCount)}`;

  const prevChap = idx > 0 ? novel.chapters[idx - 1] : null;
  const nextChap = idx < novel.chapters.length - 1 ? novel.chapters[idx + 1] : null;

  paper.innerHTML = `
    <p class="chapter-eyebrow">Chapitre ${String(order).padStart(2, "0")}</p>
    <h1>${escapeHtml(chapter.title)}</h1>
    <div class="prose">${chapter.content}</div>
    <div class="reader-meta">
      <span>${minutesLabel(chapter.wordCount)} de lecture</span>
      <span>${escapeHtml(novel.title)}</span>
    </div>
    <div class="reader-nav">
      <button class="btn" data-prev ${prevChap ? "" : "disabled"}>${icon("arrowLeft", 16)} Précédent</button>
      <button class="btn btn-primary" data-next ${nextChap ? "" : "disabled"}>Suivant ${icon("arrowRight", 16)}</button>
    </div>
  `;

  // ---- Suivi de lecture
  markChapterRead(sourceId, novelId, chapterId, chapter.wordCount || 0);
  pushHistory({
    sourceId,
    sourceName: novel.sourceName,
    novelId,
    novelTitle: novel.title,
    author: novel.author,
    cover: novel.cover,
    chapterId,
    chapterTitle: chapter.title,
    order,
  });

  // ---- Navigation
  const prevBtn = paper.querySelector("[data-prev]");
  const nextBtn = paper.querySelector("[data-next]");
  prevBtn.addEventListener("click", () => {
    if (prevChap) navigate(`/read/${sourceId}/${novelId}/${prevChap.id}`);
    else navigate(`/novel/${sourceId}/${novelId}`);
  });
  nextBtn.addEventListener("click", () => {
    if (nextChap) navigate(`/read/${sourceId}/${novelId}/${nextChap.id}`);
  });

  // ---- TOC
  const tocList = viewRoot.querySelector("#rd-toc-list");
  function renderToc(filter = "") {
    const q = filter.toLowerCase();
    const rows = novel.chapters
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .map((c, i) => {
        const active = c.id === chapterId;
        const isRead = isChapterRead(sourceId, novelId, c.id);
        return `<button class="toc-item ${active ? "active" : ""}" data-toc-chapter="${escapeHtml(c.id)}">
          <span class="n">${String(c.order).padStart(2, "0")}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title)}</span>
          ${isRead ? `<span style="color:var(--emerald)">${icon("check", 13)}</span>` : ""}
        </button>`;
      })
      .join("");
    tocList.innerHTML = rows || `<p style="padding:14px;color:var(--reader-text-2);font-size:.85rem">Aucun chapitre</p>`;
    tocList.querySelectorAll("[data-toc-chapter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeToc();
        navigate(`/read/${sourceId}/${novelId}/${btn.dataset.tocChapter}`);
      });
    });
  }
  renderToc();

  function openToc() {
    tocDrawer.classList.add("open");
    viewRoot.querySelector(".toc-drawer-overlay").classList.add("open");
  }
  function closeToc() {
    tocDrawer.classList.remove("open");
    viewRoot.querySelector(".toc-drawer-overlay").classList.remove("open");
  }
  viewRoot.querySelector("[data-toc]").addEventListener("click", () => tocDrawer.classList.contains("open") ? closeToc() : openToc());
  viewRoot.querySelectorAll("[data-toc-close]").forEach((b) => b.addEventListener("click", closeToc));

  // ---- Réglages
  buildSettings();
  function buildSettings() {
    settingsPop.innerHTML = `
      <div class="setting-row">
        <div class="setting-label"><span>Taille du texte</span><output id="set-size">${Math.round(readerPrefs.size * 100)} %</output></div>
        <input type="range" id="set-size-input" min="85" max="135" value="${Math.round(readerPrefs.size * 100)}" />
      </div>
      <div class="setting-row">
        <div class="setting-label">Police</div>
        <div class="seg" data-seg="family">
          <button data-v="sans" class="${readerPrefs.family === "sans" ? "active" : ""}">Sans serif</button>
          <button data-v="serif" class="${readerPrefs.family === "serif" ? "active" : ""}">Serif</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Interligne</div>
        <div class="seg" data-seg="height">
          ${[1.7, 1.9, 2.15].map((h) => `<button data-v="${h}" class="${readerPrefs.height === h ? "active" : ""}">${h.toFixed(1).replace(".", ",")}</button>`).join("")}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Largeur de ligne</div>
        <div class="seg" data-seg="width">
          ${Object.entries({ narrow: "Étroite", medium: "Moyenne", wide: "Large" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.width === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Contraste</div>
        <div class="seg" data-seg="contrast">
          ${Object.entries({ dark: "Sombre", sepia: "Sépia", light: "Clair" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.contrast === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
    `;

    settingsPop.querySelector("#set-size-input").addEventListener("input", (e) => {
      const v = Number(e.target.value) / 100;
      readerPrefs.size = v;
      const out = settingsPop.querySelector("#set-size");
      if (out) out.textContent = `${e.target.value} %`;
      applyPaperPrefs();
      savePrefs();
    });

    settingsPop.querySelectorAll("[data-seg]").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-v]");
        if (!btn) return;
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        readerPrefs[seg.dataset.seg] = seg.dataset.seg === "height" ? Number(btn.dataset.v) : btn.dataset.v;
        applyPaperPrefs();
        savePrefs();
      });
    });
  }

  function applyPaperPrefs() {
    screen.dataset.theme = readerPrefs.contrast || "dark";
    const family = readerPrefs.family === "serif" ? '"Fraunces", Georgia, serif' : "var(--font-ui)";
    const widths = { narrow: 560, medium: 700, wide: 820 };
    paper.style.setProperty("--reader-font", family);
    paper.style.setProperty("--reader-size", `${readerPrefs.size}rem`);
    paper.style.setProperty("--reader-height", readerPrefs.height);
    paper.style.setProperty("--reader-width", `${widths[readerPrefs.width] || 700}px`);
  }

  viewRoot.querySelector("[data-settings]").addEventListener("click", () => {
    settingsPop.classList.toggle("open");
  });

  // ---- Retour
  const backBtn = viewRoot.querySelector("[data-back]");
  backBtn.addEventListener("click", () => navigate(`/novel/${sourceId}/${novelId}`));

  // ---- Progression lecture + restauration position
  let saveTimer = null;
  let rafId = null;

  function onScroll() {
    if (rafId) return;
    const max = stage.scrollHeight - stage.clientHeight;
    const pct = max > 0 ? (stage.scrollTop / max) * 100 : 0;
    rafId = requestAnimationFrame(() => {
      progressEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      rafId = null;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveReadingPosition(sourceId, novelId, {
          chapterId,
          chapterTitle: chapter.title,
          order,
          scroll: pct,
        });
      }, 600);
    });
  }
  stage.addEventListener("scroll", onScroll, { passive: true });

  // Restauration de la position sauvegardée (si même chapitre)
  requestAnimationFrame(() => {
    const last = getProgress(sourceId, novelId)?.last;
    if (last && last.chapterId === chapterId && last.scroll > 0 && last.scroll < 98) {
      setTimeout(() => {
        const max = stage.scrollHeight - stage.clientHeight;
        stage.scrollTop = (max * last.scroll) / 100;
      }, 30);
    }
  });

  // ---- Clavier
  function onKey(e) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }
    if (e.key === "Escape") {
      if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
      if (tocDrawer.classList.contains("open")) return closeToc();
      navigate(`/novel/${sourceId}/${novelId}`);
    } else if (e.key === "ArrowRight") {
      if (nextChap) navigate(`/read/${sourceId}/${novelId}/${nextChap.id}`);
    } else if (e.key === "ArrowLeft") {
      if (prevChap) navigate(`/read/${sourceId}/${novelId}/${prevChap.id}`);
    } else if (e.key.toLowerCase() === "t") {
      tocDrawer.classList.contains("open") ? closeToc() : openToc();
    }
  }
  window.addEventListener("keydown", onKey);
  cleanupFns.push(() => window.removeEventListener("keydown", onKey));
  cleanupFns.push(() => stage.removeEventListener("scroll", onScroll));
  cleanupFns.push(() => clearTimeout(saveTimer));
  cleanupFns.push(() => { if (rafId) cancelAnimationFrame(rafId); });

  return {
    cleanup() {
      for (const fn of cleanupFns) try { fn(); } catch { /* ignore */ }
    },
  };
}