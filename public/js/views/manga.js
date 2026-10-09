// OptiManga — fiche manga : infos, actions, chapitres, export CBZ

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, heroImage, ratingBadge, statusInfo, toast, emptyState, modal, formatCount, coverAccent } from "../ui.js";
import { isFavorite, toggleFavorite, getProgress, isChapterRead, readRatio } from "../state.js";

export async function renderManga({ params, viewRoot }) {
  const [sourceId, mangaId] = params;

  viewRoot.innerHTML = `
    <button class="back-link" data-back>${icon("arrowLeft", 15)} Catalogue</button>
    <div id="manga-loading">${"<div class='skeleton' style='height:340px;border-radius:22px'></div>"}</div>
  `;

  viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate("/"));

  let manga;
  try {
    manga = await api.manga(sourceId, mangaId);
  } catch (err) {
    viewRoot.querySelector("#manga-loading").outerHTML = emptyState({
      iconName: "info",
      title: "Manga introuvable",
      text: err.message || "Cette fiche n'existe pas ou l'extension est désactivée.",
    });
    return;
  }

  const hostedCount = (manga.chapters || []).filter((c) => !c.externalUrl).length;
  const externalCount = (manga.chapters || []).length - hostedCount;

  viewRoot.innerHTML = `
    <button class="back-link" data-back>${icon("arrowLeft", 15)} Catalogue</button>
    <div class="novel-hero">
      <div class="book book-hero" style="${coverAccent(manga)}"><div class="book-front novel-hero-cover">${heroImage(manga, manga.title)}</div><i class="book-pages" aria-hidden="true"></i></div>
      <div class="novel-hero-info">
        <span class="source-pill">${icon("puzzle", 12)} ${escapeHtml(manga.sourceName)}</span>
        <h1>${escapeHtml(manga.title)}</h1>
        <p class="author">par ${escapeHtml(manga.author)}</p>
        <div class="badges">
          ${badge(manga.genre, "genre", icon("sparkle", 13))}
          ${badge(statusInfo(manga.status).label, statusInfo(manga.status).cls)}
          ${badge(statusInfo(manga.status).label ? manga.year || "" : manga.year || "", "")}
          ${ratingBadge(manga.rating) ? `<span class="badge">${ratingBadge(manga.rating)}</span>` : ""}
          ${manga.popularity ? `<span class="badge">${icon("heart", 13)} ${formatCount(manga.popularity)} suivis</span>` : ""}
          <span class="badge">${icon("library", 13)} ${manga.chapters?.length || 0} chapitres</span>
        </div>
        ${manga.tags?.length ? `<div class="tags">${manga.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        <p class="novel-description">${escapeHtml(manga.description || "Aucune description disponible.")}</p>
        <div class="novel-actions">
          <button id="read-cta" class="btn btn-primary">${icon("bookOpen", 17)} <span id="read-cta-label"></span></button>
          <button id="fav-cta" class="btn">${icon("heart", 16)} <span id="fav-label"></span></button>
          <button id="export-cta" class="btn">${icon("download", 16)} CBZ</button>
        </div>
        <div class="read-progress-box">
          <div class="read-progress-label"><span>Progression</span><strong id="ratio-label"></strong></div>
          <div class="bar"><i id="ratio-bar" style="width:0%"></i></div>
        </div>
      </div>
    </div>

    <section class="chapter-panel">
      <div class="chapter-panel-head">
        <h2>Chapitres</h2>
        <span class="count">${manga.chapters.length}</span>
        <div class="chapter-search">
          ${icon("search", 15)}
          <input id="chapter-filter" class="field" type="search" placeholder="Filtrer…" />
        </div>
      </div>
      ${externalCount ? `<p class="chapter-note">${externalCount} chapitre(s) ne sont pas hébergés par MangaDex et s'ouvrent sur le site de l'éditeur.</p>` : ""}
      <div id="chapter-list" class="chapter-list"></div>
    </section>
  `;

  viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate("/"));

  // ---- État local de la fiche
  const ratio = readRatio(sourceId, mangaId, manga.chapters.length);
  const progress = getProgress(sourceId, mangaId);
  const readSet = new Set(progress?.read || []);

  viewRoot.querySelector("#ratio-label").textContent =
    `${readSet.size} / ${manga.chapters.length} chapitres`;
  viewRoot.querySelector("#ratio-bar").style.width = `${Math.round(ratio * 100)}%`;

  // ---- Boutons d'action
  const lastRead = progress?.last;
  const firstHosted = (manga.chapters || []).find((c) => !c.externalUrl);
  const ctaLabel = viewRoot.querySelector("#read-cta-label");
  const ctaTarget = lastRead?.chapterId
    ? (manga.chapters || []).find((c) => c.id === lastRead.chapterId) || firstHosted
    : firstHosted;
  if (!firstHosted) {
    ctaLabel.textContent = "Aucun chapitre disponible";
    viewRoot.querySelector("#read-cta").disabled = true;
  } else if (lastRead && lastRead.chapterId && ctaTarget) {
    ctaLabel.textContent = `Continuer · Chapitre ${ctaTarget.order ?? ""}`.trim();
  } else {
    ctaLabel.textContent = "Commencer la lecture";
  }

  viewRoot.querySelector("#read-cta").addEventListener("click", () => {
    if (ctaTarget) navigate(`/read/${sourceId}/${mangaId}/${ctaTarget.id}`);
  });

  updateFavState();
  function updateFavState() {
    const fav = isFavorite(sourceId, mangaId);
    const btn = viewRoot.querySelector("#fav-cta");
    const label = viewRoot.querySelector("#fav-label");
    btn.classList.toggle("btn-primary", fav);
    btn.querySelector("svg").style.color = fav ? "var(--accent-ink)" : "var(--rose)";
    label.textContent = fav ? "Dans les favoris" : "Ajouter aux favoris";
  }

  viewRoot.querySelector("#fav-cta").addEventListener("click", () => {
    const res = toggleFavorite(manga);
    toast(res.added ? "Ajouté aux favoris" : "Retiré des favoris");
    updateFavState();
  });

  viewRoot.querySelector("#export-cta").addEventListener("click", () => openCbzModal(manga));

  // ---- Chapitres
  renderChapters("");
  const filterInput = viewRoot.querySelector("#chapter-filter");
  filterInput.addEventListener("input", () => renderChapters(filterInput.value.trim()));

  function renderChapters(filter) {
    const list = viewRoot.querySelector("#chapter-list");
    const q = filter.toLowerCase();
    const filtered = manga.chapters.filter((c) =>
      !q || c.title?.toLowerCase().includes(q) || `${c.order}` === q
    );

    if (!filtered.length) {
      list.innerHTML = emptyState({ iconName: "search", title: "Aucun chapitre", text: "Aucun chapitre ne correspond à ce filtre." });
      return;
    }

    list.innerHTML = filtered
      .map((c) => {
        const read = readSet.has(c.id);
        const isContinue = lastRead && lastRead.chapterId === c.id;
        return `
        <button class="chapter-row ${read ? "read" : ""} ${isContinue ? "continue-here" : ""}" data-cid="${escapeHtml(c.id)}"
          ${c.externalUrl ? `data-external="${escapeHtml(c.externalUrl)}"` : ""}>
          <span class="chapter-num">${String(c.order ?? "").padStart(2, "0")}</span>
          <h4>${escapeHtml(c.title || `Chapitre ${c.order}`)}</h4>
          ${c.group ? `<span class="chapter-group">${escapeHtml(c.group)}</span>` : ""}
          ${c.externalUrl
            ? `<span class="external-chip">${icon("external", 12)} Éditeur</span>`
            : read
              ? `<span class="read-mark">${icon("check", 12)} Lu</span>`
              : isContinue
                ? `<span class="read-mark" style="color:var(--accent)">En cours</span>`
                : ""}
          <span class="chevron">${icon("chevronRight", 15)}</span>
        </button>`;
      })
      .join("");

    list.querySelectorAll(".chapter-row").forEach((row) => {
      row.addEventListener("click", () => {
        const ext = row.dataset.external;
        if (ext) {
          window.open(ext, "_blank", "noopener");
          return;
        }
        navigate(`/read/${sourceId}/${mangaId}/${row.dataset.cid}`);
      });
    });
  }
}

function badge(label, cls = "", prepend = "") {
  if (!label) return "";
  return `<span class="badge ${escapeHtml(cls)}">${prepend}${escapeHtml(label)}</span>`;
}

// ---- Export CBZ -----------------------------------------------------------

export function openCbzModal(manga) {
  const orders = (manga.chapters || []).map((c) => c.order).filter((o) => Number.isFinite(o));
  const minOrder = orders.length ? Math.floor(Math.min(...orders)) : 1;
  const maxOrder = orders.length ? Math.ceil(Math.max(...orders)) : 1;

  const body = `
    <div class="modal-inputs">
      <div>
        <div class="input-label">Plage de chapitres (ordres)</div>
        <div style="display:flex;gap:10px;align-items:center">
          <input id="exp-from" class="field" type="number" min="${minOrder}" max="${maxOrder}" value="${minOrder}" style="width:90px;text-align:center" />
          <span>→</span>
          <input id="exp-to" class="field" type="number" min="${minOrder}" max="${maxOrder}" value="${maxOrder}" style="width:90px;text-align:center" />
          <span class="count" style="font-size:.72rem;color:var(--text-3);font-family:var(--font-mono)">/ ${manga.chapters ? manga.chapters.length : maxOrder} vol.</span>
        </div>
      </div>
    </div>
    <div class="export-progress" id="exp-progress" style="display:none">
      <div class="bar"><i id="exp-bar" style="width:0%"></i></div>
      <div class="export-state"><span id="exp-message">Préparation…</span><span id="exp-pct">0 %</span></div>
    </div>
    <div id="exp-result" style="display:none;text-align:center;padding:6px 0">
      <p style="color:var(--text);font-weight:600;margin-bottom:14px">CBZ prêt !</p>
      <a id="exp-download" class="btn btn-primary" download>${icon("download", 16)} Télécharger le fichier</a>
    </div>
  `;

  const m = modal({
    title: `Exporter « ${manga.title} »`,
    text: `Le fichier CBZ (compatible Tachiyomi/Mihon) est généré côté serveur puis ajouté à ta bibliothèque hors-ligne. Les chapitres abrités chez l'éditeur sont ignorés.`,
    body,
    actions: [{ label: "Générer le CBZ", type: "primary", onClick: ({ close }) => startExport(close) }],
  });

  function setProgress(pct, msg) {
    const bar = document.getElementById("exp-bar");
    const pctEl = document.getElementById("exp-pct");
    const msgEl = document.getElementById("exp-message");
    if (bar) bar.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct} %`;
    if (msgEl) msgEl.textContent = msg;
  }

  async function startExport(close) {
    const from = Math.max(minOrder, Math.min(maxOrder, parseInt(document.getElementById("exp-from").value, 10) || minOrder));
    const to = Math.max(minOrder, Math.min(maxOrder, parseInt(document.getElementById("exp-to").value, 10) || maxOrder));
    if (from > to) {
      toast("Plage invalide : le départ doit précéder la fin.", "error");
      return false;
    }

    const progress = document.getElementById("exp-progress");
    if (progress) progress.style.display = "";
    setProgress(2, "Création de la tâche…");

    let jobId;
    try {
      const res = await api.downloadCbz(manga.sourceId, manga.id, from, to);
      jobId = res.jobId;
    } catch (err) {
      if (progress) progress.style.display = "none";
      toast(err.message || "Échec de l'export.", "error");
      return false;
    }

    return new Promise(() => {
      const poll = async () => {
        let job;
        try {
          job = await api.job(jobId);
        } catch {
          toast("Perte de connexion avec la tâche d'export.", "error");
          return;
        }
        const pct = job.total ? Math.round((job.progress / job.total) * 100) : 0;
        setProgress(pct, job.message || "");

        if (job.status === "done") {
          const result = job.result;
          setProgress(100, "Terminé");
          const progress = document.getElementById("exp-progress");
          if (progress) progress.style.display = "none";
          const resultEl = document.getElementById("exp-result");
          if (resultEl) {
            resultEl.style.display = "";
            document.getElementById("exp-download").href = result.url;
          }
          toast(skipLabel(result));
          return;
        }
        if (job.status === "error") {
          toast(job.message || "L'export a échoué.", "error");
          if (progress) progress.style.display = "none";
          return;
        }
        setTimeout(poll, 420);
      };
      poll();
    });
  }

  function skipLabel(result) {
    if (result.skipped) return `CBZ généré (${result.chapterCount} chapitre(s), ${result.skipped} externe(s) ignoré(s)).`;
    return `CBZ généré (${result.chapterCount} chapitre(s)) et ajouté à la bibliothèque.`;
  }

  return m;
}