// OptiManga — historique de lecture

// Importe la fonction de navigation entre les pages.
import { navigate } from "../router.js";
// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";
// Importe les utilitaires d'affichage (échappement, temps relatif, état vide, notification, modale).
import { escapeHtml, timeAgo, emptyState, toast, modal, coverImageTag, coverPlaceholder } from "../ui.js";
// Importe l'état global et l'action d'effacement de l'historique.
import { serverState, clearHistory } from "../state.js";

// Fonction de rendu de la page d'historique de lecture.
export function renderHistory({ viewRoot }) {
  // Récupère la liste de l'historique depuis l'état serveur.
  const hist = serverState.history;

  // Ouvre le gabarit HTML de la page (ne rien modifier à l'intérieur).
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

  // Récupère la liste de l'historique dans le DOM.
  const list = viewRoot.querySelector("#hist-list");

  // Cas où l'historique est vide.
  if (!hist.length) {
    // Affiche un état vide invitant à parcourir le catalogue.
    list.innerHTML = emptyState({
      // Nom de l'icône affichée.
      iconName: "history",
      // Titre de l'état vide.
      title: "Aucune lecture pour l'instant",
      // Texte explicatif.
      text: "Ouvre un chapitre depuis une fiche manga : il apparaîtra ici pour que tu puisses reprendre facilement.",
      // Bouton d'action vers le catalogue.
      action: `<button class="btn btn-primary" id="hist-cta">${icon("bookOpen", 16)} Parcourir le catalogue</button>`,
    // Ferme l'appel à emptyState.
    });
    // Branche le bouton d'action sur la navigation vers le catalogue.
    list.querySelector("#hist-cta").addEventListener("click", () => navigate("/catalogue"));
    // Quitte la fonction : la suite ne s'applique pas sans historique.
    return;
  // Ferme le cas « historique vide ».
  }

  // Construit et injecte la liste des entrées d'historique.
  list.innerHTML = hist
    // Transforme chaque entrée en élément HTML.
    .map(
      // Ouvre le gabarit HTML d'une entrée (ne rien modifier à l'intérieur).
      (h, i) => `
    <div class="history-item" data-idx="${i}">
      <div class="book book-sm"><div class="book-front hist-cover">${h.cover ? coverImageTag({ cover: h.cover, id: `${h.sourceId}:${h.mangaId}`, title: h.mangaTitle || h.novelTitle }, h.mangaTitle || h.novelTitle || "") : coverPlaceholder({ id: `${h.sourceId}:${h.mangaId}`, title: h.mangaTitle || h.novelTitle }, "")}</div><i class="book-pages" aria-hidden="true"></i></div>
      <div class="hist-info">
        <h4>${escapeHtml(h.mangaTitle || h.novelTitle)}</h4>
        <p>${escapeHtml(h.chapterTitle || `Chapitre ${h.order || ""}`)} · ${escapeHtml(h.sourceName || h.sourceId || "")}</p>
      </div>
      <span class="hist-time">${timeAgo(h.at)}</span>
      <span style="color:var(--accent);display:inline-flex">${icon("chevronRight", 16)}</span>
    </div>`
    // Ferme le callback du map.
    )
    // Assemble les entrées en une seule chaîne HTML.
    .join("");

  // Branche l'ouverture du chapitre au clic sur chaque entrée.
  list.querySelectorAll(".history-item").forEach((item) => {
    // Ajoute un gestionnaire de clic à l'entrée.
    item.addEventListener("click", () => {
      // Récupère l'entrée correspondant à l'index cliqué.
      const h = hist[+item.dataset.idx];
      // Navigue vers la lecture du chapitre concerné.
      navigate(`/read/${h.sourceId}/${h.mangaId || h.novelId}/${h.chapterId}`);
    // Ferme le gestionnaire de clic.
    });
  // Ferme le forEach des entrées.
  });

  // Récupère le bouton d'effacement de l'historique.
  const clearBtn = viewRoot.querySelector("#hist-clear");
  // Vérifie que le bouton existe avant de le brancher.
  if (clearBtn) {
    // Ouvre une modale de confirmation au clic.
    clearBtn.addEventListener("click", () => {
      // Affiche la modale de confirmation d'effacement.
      modal({
        // Titre de la modale.
        title: "Effacer l'historique ?",
        // Texte explicatif de la modale.
        text: "Tes progressions de lecture restent intactes ; seuls les repères d'historique seront supprimés.",
        // Liste des actions (boutons) de la modale.
        actions: [
          // Décrit l'action unique d'effacement.
          {
            // Libellé du bouton.
            label: "Effacer",
            // Style du bouton (danger).
            type: "danger",
            // Action exécutée au clic sur le bouton.
            onClick: () => {
              // Efface l'historique côté serveur.
              clearHistory();
              // Affiche une notification de confirmation.
              toast("Historique effacé.");
              // Re-rend la page avec l'historique vidé.
              renderHistory({ viewRoot });
            // Ferme la fonction onClick.
            },
          // Ferme l'objet d'action.
          },
        // Ferme le tableau des actions.
        ],
      // Ferme l'appel à modal.
      });
    // Ferme le gestionnaire de clic du bouton.
    });
  // Ferme la condition sur le bouton d'effacement.
  }
// Ferme la fonction renderHistory.
}
