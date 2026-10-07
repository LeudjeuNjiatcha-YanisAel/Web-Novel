// NovelHub — fiche novel : infos, actions, chapitres, export EPUB

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, coverImage, ratingBadge, statusInfo, toast, emptyState } from "../ui.js";
import { isFavorite, toggleFavorite, getProgress, isChapterRead, readRatio } from "../state.js";

export async function renderNovel({ params, viewRoot }) {
  const [sourceId, novelId] = params;

  viewRoot.innerHTML = `
    <button class="back-link" data-back>${icon("arrowLeft", 15)} Catalogue</button>
    <div id="novel-loading">${"<div class='skeleton' style='height:340px;border-radius:22px'></div>"}</div>
  `;

  viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate("/"));

  let novel;
  try {
    novel = await api.novel(sourceId, novelId);
  } catch (err) {
    viewRoot.querySelector("#novel-loading").outerHTML = emptyState({
      iconName: "info",
      title: "Roman introuvable",
      text: err.message || "Cette fiche n'existe pas ou l'extension est désactivée.",
    });
    return;
  }

  viewRoot.innerHTML = `
    <button class="back-link" data-back>${icon("arrowLeft", 15)} Catalogue</button>
    <div class="novel-hero">
      <div class="novel-hero-cover">${coverImage(novel, novel.title)}</div>
      <div class="novel-hero-info">
        <span class="source-pill">${icon("puzzle", 12)} ${escapeHtml(novel.sourceName)}</span>
        <h1>${escapeHtml(novel.title)}</h1>
        <p class="author">par ${escapeHtml(novel.author || "Auteur inconnu")}</p>
        <div class="badges">
          ${badge(novel.genre, "genre", icon("sparkle", 13))}
          ${badge(statusInfo(novel.status).label, statusInfo(novel.status).cls)}
          ${badge(novel.year || "", "")}
          ${ratingBadge(novel.rating) ? `<span class="badge">${ratingBadge(novel.rating)}</span>` : ""}
          <span class="badge">${icon("book", 13)} ${novel.chapters.length} chapitres</span>
        </div>
        ${novel.tags?.length ? `<div class="tags">${novel.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        <p class="novel-description">${escapeHtml(novel.description || "")}</p>
        <div class="novel-actions">
          <button id="read-cta" class="btn btn-primary">${icon("bookOpen", 17)} <span id="read-cta-label"></span></button>
          <button id="fav-cta" class="btn">${icon("heart", 16)} <span id="fav-label"></span></button>
          <button id="export-cta" class="btn">${icon("download", 16)} EPUB</button>
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
        <span class="count">${novel.chapters.length}</span>
        <div class="chapter-search">
          ${icon("search", 15)}
          <input id="chapter-filter" class="field" type="search" placeholder="Filtrer…" />
        </div>
      </div>
      <div id="chapter-list" class="chapter-list"></div>
    </section>
  `;

  viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate("/"));

  // ---- État local de la fiche
  const ratio = readRatio(sourceId, novelId, novel.chapters.length);
  const progress = getProgress(sourceId, novelId);
  const readSet = new Set(progress?.read || []);

  viewRoot.querySelector("#ratio-label").textContent =
    `${readSet.size} / ${novel.chapters.length} chapitres`;
  viewRoot.querySelector("#ratio-bar").style.width = `${Math.round(ratio * 100)}%`;

  // ---- Boutons d'action
  const lastRead = progress?.last;
  const ctaLabel = viewRoot.querySelector("#read-cta-label");
  if (lastRead && lastRead.order) {
    ctaLabel.textContent = `Continuer · ${lastRead.chapterTitle}`;
  } else {
    ctaLabel.textContent = "Commencer la lecture";
  }

  viewRoot.querySelector("#read-cta").addEventListener("click", () => {
    const target = lastRead?.order
      ? novel.chapters.find((c) => c.id === lastRead.chapterId) || novel.chapters[0]
      : novel.chapters[0];
    if (novel.sourceType === "manga" || sourceId === "mangadex") {
      navigate(`/manga/read/${sourceId}/${novelId}/${target.id}`);
      return;
    }
    navigate(`/read/${sourceId}/${novelId}/${target.id}`);
  });

  updateFavState();
  function updateFavState() {
    const fav = isFavorite(sourceId, novelId);
    const btn = viewRoot.querySelector("#fav-cta");
    const label = viewRoot.querySelector("#fav-label");
    btn.classList.toggle("btn-primary", fav);
    btn.classList.toggle("danger-tint", false);
    btn.style.color = fav ? "" : "";
    btn.querySelector("svg").style.color = fav ? "var(--accent-ink)" : "var(--rose)";
    label.textContent = fav ? "Dans les favoris" : "Ajouter aux favoris";
  }

  viewRoot.querySelector("#fav-cta").addEventListener("click", () => {
    const res = toggleFavorite(novel);
    toast(res.added ? "Ajouté aux favoris" : "Retiré des favoris");
    updateFavState();
  });

  viewRoot.querySelector("#export-cta").addEventListener("click", () => openExportModal(novel));

  // ---- Chapitres
  renderChapters("");
  const filterInput = viewRoot.querySelector("#chapter-filter");
  filterInput.addEventListener("input", () => renderChapters(filterInput.value.trim()));

  function renderChapters(filter) {
    const list = viewRoot.querySelector("#chapter-list");
    const q = filter.toLowerCase();
    const filtered = novel.chapters.filter((c) =>
      !q || c.title.toLowerCase().includes(q) || `${c.order}` === q
    );

    if (!filtered.length) {
      list.innerHTML = emptyState({ iconName: "search", title: "Aucun chapitre", text: "Aucun chapitre ne correspond à ce filtre." });
      return;
    }

    list.innerHTML = filtered
      .map((c, i) => {
        const read = readSet.has(c.id);
        const isContinue = lastRead && lastRead.chapterId === c.id;
        return `
        <button class="chapter-row ${read ? "read" : ""} ${isContinue ? "continue-here" : ""}" data-cid="${escapeHtml(c.id)}">
          <span class="chapter-num">${String(c.order).padStart(2, "0")}</span>
          <h4>${escapeHtml(c.title)}</h4>
          ${read ? `<span class="read-mark">${icon("check", 12)} Lu</span>` : isContinue ? `<span class="read-mark" style="color:var(--accent)">En cours</span>` : ""}
          <span class="chevron">${icon("chevronRight", 15)}</span>
        </button>`;
      })
      .join("");

    list.querySelectorAll(".chapter-row").forEach((row) => {
      row.addEventListener("click", () => {
        if (novel.sourceType === "manga" || sourceId === "mangadex") {
          navigate(`/manga/read/${sourceId}/${novelId}/${row.dataset.cid}`);
          return;
        }
        navigate(`/read/${sourceId}/${novelId}/${row.dataset.cid}`);
      });
    });
  }
}

function badge(label, cls = "", prepend = "") {
  if (!label) return "";
  return `<span class="badge ${escapeHtml(cls)}">${prepend}${escapeHtml(label)}</span>`;
}

// ---- Export EPUB -----------------------------------------------------------

export function openExportModal(novel) {
  const body = `
    <div class="modal-inputs">
      <div>
        <div class="input-label">Plage de chapitres</div>
        <div style="display:flex;gap:10px;align-items:center">
          <input id="exp-from" class="field" type="number" min="1" max="${novel.chapters.length}" value="1" style="width:90px;text-align:center" />
          <span>→</span>
          <input id="exp-to" class="field" type="number" min="1" max="${novel.chapters.length}" value="${novel.chapters.length}" style="width:90px;text-align:center" />
          <span class="count" style="font-size:.72rem;color:var(--text-3);font-family:var(--font-mono)">/ ${novel.chapters.length}</span>
        </div>
      </div>
    </div>
    <div class="export-progress" id="exp-progress" style="display:none">
      <div class="bar"><i id="exp-bar" style="width:0%"></i></div>
      <div class="export-state"><span id="exp-message">Préparation…</span><span id="exp-pct">0 %</span></div>
    </div>
    <div id="exp-result" style="display:none;text-align:center;padding:6px 0">
      <p style="color:var(--text);font-weight:600;margin-bottom:14px">EPUB prêt !</p>
      <a id="exp-download" class="btn btn-primary" download>${icon("download", 16)} Télécharger le fichier</a>
    </div>
  `;

  const m = modal({
    title: `Exporter « ${novel.title} »`,
    text: "Le fichier est généré côté serveur puis ajouté à ta bibliothèque.",
    body,
    actions: [{ label: "Générer l'EPUB", type: "primary", onClick: ({ close }) => startExport(close) }],
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
    const from = Math.max(1, Math.min(novel.chapters.length, parseInt(document.getElementById("exp-from").value, 10) || 1));
    const to = Math.max(1, Math.min(novel.chapters.length, parseInt(document.getElementById("exp-to").value, 10) || novel.chapters.length));
    if (from > to) {
      toast("Plage invalide : le départ doit précéder la fin.", "error");
      return false;
    }

    const progress = document.getElementById("exp-progress");
    if (progress) progress.style.display = "";
    setProgress(2, "Création de la tâche…");

    let jobId;
    try {
      const res = await api.exportEpub(novel.sourceId, novel.id, from, to);
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
          toast("EPUB généré et ajouté à la bibliothèque.");
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

  return m;
}