// OptiManga — bibliothèque de CBZ générés

// Importe le client API pour dialoguer avec le serveur.
import { api } from "../api.js";
// Importe la fonction de navigation entre les pages.
import { navigate } from "../router.js";
// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";
// Importe les utilitaires d'affichage (échappement, couverture, état vide, notification, temps, modale, taille).
import { escapeHtml, coverImage, emptyState, toast, timeAgo, modal, formatSizeBytes } from "../ui.js";

// Fonction asynchrone de rendu de la page de la bibliothèque.
export async function renderLibrary({ viewRoot }) {
  // Ouvre le gabarit HTML de la page (ne rien modifier à l'intérieur).
  viewRoot.innerHTML = `
    <header class="page-head page-head-row">
      <div>
        <span class="eyebrow">Hors-ligne</span>
        <h1>Bibliothèque</h1>
        <p class="lead">Les CBZ exportés depuis les fiches manga. Télécharge-les pour tes lecteurs (Tachiyomi, Mihon, Kawazu…) ou supprime-les.</p>
      </div>
      <span class="badge" id="lib-count">Chargement…</span>
    </header>
    <div id="lib-grid" class="lib-grid"></div>
  `;

  // Récupère la grille de la bibliothèque dans le DOM.
  const grid = viewRoot.querySelector("#lib-grid");
  // Récupère l'élément du compteur de fichiers.
  const countEl = viewRoot.querySelector("#lib-count");
  // Initialise le tableau des entrées de la bibliothèque.
  let entries = [];

  // Fonction asynchrone qui charge les fichiers de la bibliothèque.
  async function load() {
    // Affiche des cartes squelettes pendant le chargement.
    grid.innerHTML = Array.from({ length: 4 }, () => `<div class="lib-item"><div class="skeleton" style="aspect-ratio:2/3;border-radius:16px"></div></div>`).join("");
    // Débute un bloc pour intercepter les erreurs.
    try {
      // Récupère la liste des fichiers depuis l'API.
      entries = await api.library();
      // Met à jour le compteur avec le bon pluriel.
      countEl.textContent = `${entries.length} fichier${entries.length > 1 ? "s" : ""}`;
      // Affiche les entrées récupérées.
      render();
    // Capture une erreur de chargement.
    } catch (err) {
      // Affiche un état vide signalant l'indisponibilité de la bibliothèque.
      grid.innerHTML = emptyState({ iconName: "fileText", title: "Bibliothèque indisponible", text: err.message });
    // Ferme le bloc catch.
    }
  // Ferme la fonction load.
  }

  // Fonction qui affiche les entrées de la bibliothèque.
  function render() {
    // Cas où la bibliothèque est vide.
    if (!entries.length) {
      // Affiche un état vide invitant à explorer le catalogue.
      grid.innerHTML = emptyState({
        // Nom de l'icône affichée.
        iconName: "fileText",
        // Titre de l'état vide.
        title: "Ta bibliothèque est vide",
        // Texte explicatif.
        text: "Ouvre un manga et utilise l'export CBZ pour générer ton premier fichier hors-ligne.",
        // Bouton d'action vers le catalogue.
        action: `<button class="btn btn-primary" id="empty-cta">${icon("bookOpen", 16)} Explorer le catalogue</button>`,
      // Ferme l'appel à emptyState.
      });
      // Récupère le bouton d'action.
      const cta = grid.querySelector("#empty-cta");
      // Branche le bouton sur la navigation vers le catalogue s'il existe.
      if (cta) cta.addEventListener("click", () => navigate("/catalogue"));
      // Quitte la fonction : rien d'autre à afficher.
      return;
    // Ferme le cas « bibliothèque vide ».
    }

    // Construit et injecte la liste des fichiers.
    grid.innerHTML = entries
      // Transforme chaque entrée en élément HTML.
      .map(
        // Ouvre le gabarit HTML d'un fichier (ne rien modifier à l'intérieur).
        (e) => `
      <div class="lib-item" data-id="${escapeHtml(e.id)}">
        <div class="book book-sm"><div class="book-front lib-cover">
          ${coverImage({ cover: e.cover, title: e.title }, e.title)}
          <div class="lib-actions">
            ${e.url
              ? `<a class="btn btn-sm" href="${escapeHtml(e.url)}" download="${escapeHtml(e.filename)}">${icon("download", 14)}</a>`
              : `<span class="btn btn-sm" title="Fichier manquant" style="opacity:.5">${icon("info", 14)}</span>`}
            <button class="btn btn-sm delete" data-del="${escapeHtml(e.id)}" title="Supprimer">${icon("trash", 14)}</button>
          </div>
        </div><i class="book-pages" aria-hidden="true"></i></div>
        <div class="lib-body">
          <h3>${escapeHtml(e.title)}</h3>
          <p>${escapeHtml(e.author || "Auteur inconnu")}</p>
          <div class="lib-meta">
            <span>${e.chapterCount} chap.</span>
            <span>·</span>
            <span>${formatSizeBytes(e.size)}</span>
            <span>·</span>
            <span>${timeAgo(e.downloadedAt)}</span>
          </div>
        </div>
      </div>`
      // Ferme le callback du map.
      )
      // Assemble les entrées en une seule chaîne HTML.
      .join("");

    // Branche la suppression sur chaque bouton de suppression.
    grid.querySelectorAll("[data-del]").forEach((btn) => {
      // Ajoute un gestionnaire de clic au bouton de suppression.
      btn.addEventListener("click", () => {
        // Retrouve l'entrée correspondant au bouton cliqué.
        const entry = entries.find((x) => x.id === btn.dataset.del);
        // Affiche la modale de confirmation de suppression.
        modal({
          // Titre de la modale.
          title: "Supprimer ce CBZ ?",
          // Texte explicatif utilisant le titre de l'entrée.
          text: `« ${entry?.title || "le fichier"} » sera retiré de la bibliothèque et le fichier supprimé du serveur.`,
          // Liste des actions (boutons) de la modale.
          actions: [
            // Décrit l'action unique de suppression.
            {
              // Libellé du bouton.
              label: "Supprimer",
              // Style du bouton (danger).
              type: "danger",
              // Action asynchrone exécutée au clic sur le bouton.
              onClick: async ({ close }) => {
                // Demande au serveur de supprimer l'entrée.
                await api.deleteLibraryEntry(btn.dataset.del);
                // Ferme la modale.
                close();
                // Affiche une notification de confirmation.
                toast("CBZ supprimé de la bibliothèque.");
                // Recharge la liste des fichiers.
                load();
              // Ferme la fonction onClick.
              },
            // Ferme l'objet d'action.
            },
          // Ferme le tableau des actions.
          ],
        // Ferme l'appel à modal.
        });
      // Ferme le gestionnaire de clic.
      });
    // Ferme le forEach des boutons de suppression.
    });
  // Ferme la fonction render.
  }

  // Lance le chargement de la bibliothèque au rendu.
  await load();
// Ferme la fonction renderLibrary.
}
