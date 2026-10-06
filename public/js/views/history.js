// NovelHub — historique de lecture

import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, timeAgo, emptyState, toast, modal } from "../ui.js";
import { serverState, clearHistory } from "../state.js";

export function renderHistory({ viewRoot }) {
  const hist = serverState.history;

  viewRoot.innerHTML = `
    <header class="page-head page-head-row">
      <div>
        <span class="eyebrow">Reprendre</span>
        <h1>Historique de lecture</h1>
        <p class="lead">Là où tu t'es arrêté, exactement. Ta progression est sauvegardée sur le serveur.</p>
      </div>
      ${hist.length ? `<button class="btn btn-ghost btn-danger" id="hist-clear">${icon("trash", 15)} Effacer</button>` : ""}
    </header>
    <div id="hist-list" class="history-list"></div>
  `;

  const list = viewRoot.querySelector("#hist-list");

  if (!hist.length) {
    list.innerHTML = emptyState({
      iconName: "history",
      title: "Aucune lecture pour l'instant",
      text: "Ouvre un chapitre depuis une fiche novel : il apparaîtra ici pour que tu puisses reprendre facilement.",
      action: `<button class="btn btn-primary" id="hist-cta">${icon("bookOpen", 16)} Parcourir le catalogue</button>`,
    });
    list.querySelector("#hist-cta").addEventListener("click", () => navigate("/"));
    return;
  }

  list.innerHTML = hist
    .map(
      (h, i) => `
    <div class="history-item" data-idx="${i}">
      <div class="hist-cover">${h.cover ? `<img src="${escapeHtml(h.cover)}" alt="" loading="lazy" />` : ""}</div>
      <div class="hist-info">
        <h4>${escapeHtml(h.novelTitle)}</h4>
        <p>${escapeHtml(h.chapterTitle || `Chapitre ${h.order || ""}`)} · ${escapeHtml(h.sourceName || h.sourceId || "")}</p>
      </div>
      <span class="hist-time">${timeAgo(h.at)}</span>
      <span style="color:var(--accent);display:inline-flex">${icon("chevronRight", 16)}</span>
    </div>`
    )
    .join("");

  list.querySelectorAll(".history-item").forEach((item) => {
    item.addEventListener("click", () => {
      const h = hist[+item.dataset.idx];
      navigate(`/read/${h.sourceId}/${h.novelId}/${h.chapterId}`);
    });
  });

  const clearBtn = viewRoot.querySelector("#hist-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      modal({
        title: "Effacer l'historique ?",
        text: "Tes progressions de lecture restent intactes ; seuls les repères d'historique seront supprimés.",
        actions: [
          {
            label: "Effacer",
            type: "danger",
            onClick: () => {
              clearHistory();
              toast("Historique effacé.");
              renderHistory({ viewRoot });
            },
          },
        ],
      });
    });
  }
}