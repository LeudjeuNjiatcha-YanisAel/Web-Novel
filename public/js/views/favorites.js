// OptiManga — favoris (suivi des mangas)

// Importe la fonction de navigation entre les pages.
import { navigate } from "../router.js";
// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";
// Importe les utilitaires d'affichage (notification, état vide).
import { toast, emptyState } from "../ui.js";
// Importe l'état global et l'action de bascule des favoris.
import { serverState, toggleFavorite } from "../state.js";
// Importe le composant de carte manga partagé.
import { mangaCard } from "./cards.js";

// Fonction de rendu de la page des favoris.
export function renderFavorites({ viewRoot }) {
  // Récupère la liste des favoris depuis l'état serveur.
  const favs = serverState.favorites;

  // Ouvre le gabarit HTML de la page (ne rien modifier à l'intérieur).
  viewRoot.innerHTML = `
    <header class="page-head page-head-row">
      <div>
        <span class="eyebrow">Suivi</span>
        <h1>Favoris</h1>
        <p class="lead">Retrouve ici les mangas que tu suis. Un cœur suffit à ranger une série.</p>
      </div>
      ${favs.length ? `<span class="badge">${favs.length} manga${favs.length > 1 ? "s" : ""}</span>` : ""}
    </header>
    <div id="fav-grid" class="grid"></div>
  `;

  // Récupère la grille des favoris dans le DOM.
  const grid = viewRoot.querySelector("#fav-grid");

  // Cas où aucun favori n'est enregistré.
  if (!favs.length) {
    // Affiche un état vide invitant à découvrir le catalogue.
    grid.innerHTML = emptyState({
      // Nom de l'icône affichée.
      iconName: "heart",
      // Titre de l'état vide.
      title: "Aucun favori pour l'instant",
      // Texte explicatif.
      text: "Passe le cœur sur les cartes du catalogue ou depuis une fiche manga pour suivre cette série ici.",
      // Bouton d'action vers le catalogue.
      action: `<button class="btn btn-primary" id="fav-cta">${icon("sparkle", 16)} Découvrir le catalogue</button>`,
    // Ferme l'appel à emptyState.
    });
    // Branche le bouton d'action sur la navigation vers le catalogue.
    grid.querySelector("#fav-cta").addEventListener("click", () => navigate("/catalogue"));
    // Quitte la fonction : la suite ne s'applique pas sans favoris.
    return;
  // Ferme le cas « aucun favori ».
  }

  // Construit et injecte les cartes des mangas favoris.
  grid.innerHTML = favs
    // Transforme chaque favori en carte manga.
    .map((f) =>
      // Appelle le composant de carte avec les données du favori.
      mangaCard({
        // Identifiant de la source.
        sourceId: f.sourceId,
        // Identifiant du manga.
        id: f.mangaId,
        // Titre du manga.
        title: f.title,
        // Auteur du manga.
        author: f.author,
        // Couverture du manga.
        cover: f.cover,
        // Genre du manga.
        genre: f.genre,
        // Note du manga.
        rating: f.rating,
        // Statut de publication.
        status: f.status,
        // Nombre de chapitres.
        chapterCount: f.chapterCount,
      // Ferme l'appel à mangaCard.
      })
    // Ferme le callback du map.
    )
    // Assemble les cartes en une seule chaîne HTML.
    .join("");

  // Branche les interactions sur chaque carte.
  grid.querySelectorAll(".novel-card").forEach((card, index) => {
    // Récupère le favori correspondant à l'index de la carte.
    const fav = favs[index];
    // Ouvre la fiche manga au clic sur la carte.
    card.addEventListener("click", (e) => {
      // Ignore le clic si l'on a cliqué sur le bouton favori.
      if (e.target.closest("[data-fav]")) return;
      // Navigue vers la fiche du manga.
      navigate(`/manga/${fav.sourceId}/${fav.mangaId}`);
    // Ferme le gestionnaire de clic de la carte.
    });
    // Branche le bouton favori pour retirer le manga.
    card.querySelector("[data-fav]").addEventListener("click", (e) => {
      // Empêche la propagation du clic vers la carte.
      e.stopPropagation();
      // Bascule le manga hors des favoris.
      toggleFavorite({ ...fav, id: fav.mangaId, sourceId: fav.sourceId });
      // Affiche une notification de confirmation.
      toast("Retiré des favoris");
      // Re-rend la page avec la liste mise à jour.
      renderFavorites({ viewRoot });
    // Ferme le gestionnaire de clic du bouton favori.
    });
  // Ferme le forEach des cartes.
  });
// Ferme la fonction renderFavorites.
}
