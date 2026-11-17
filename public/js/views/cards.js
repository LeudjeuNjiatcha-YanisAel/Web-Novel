// OptiManga — cartes de mangas (partagées catalogue/favoris)

// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";
// Importe les utilitaires d'affichage (couverture, note, statut, échappement, format, accent).
import { coverImage, ratingBadge, statusInfo, escapeHtml, formatCount, coverAccent } from "../ui.js";
// Importe les fonctions d'état (favori et ratio de lecture).
import { isFavorite, readRatio } from "../state.js";

// Déclare la fonction qui construit la carte d'un manga (option d'affichage de la source).
export function mangaCard(manga, { showSource = false } = {}) {
  // Vérifie si ce manga est dans les favoris.
  const fav = isFavorite(manga.sourceId, manga.id);
  // Récupère les informations de statut (classe CSS et libellé).
  const status = statusInfo(manga.status);
  // Calcule le ratio de progression de lecture du manga.
  const ratio = readRatio(manga.sourceId, manga.id, manga.chapterCount);
  // Prépare le suffixe du genre s'il est renseigné.
  const genre = manga.genre ? ` · ${escapeHtml(manga.genre)}` : "";
  // Prépare le badge de source si l'option est activée et que la source a un nom.
  const sourceBadge = showSource && manga.sourceName
    // Construit le HTML du badge affichant le nom de la source.
    ? `<span class="novel-card-meta"><span style="color:var(--violet);font-weight:650">${escapeHtml(manga.sourceName)}</span></span>`
    // Sinon, chaîne vide (aucun badge).
    : "";

  // Ouvre le gabarit HTML de la carte (ne rien modifier à l'intérieur).
  return `
  <article class="novel-card" data-sid="${escapeHtml(manga.sourceId)}" data-nid="${escapeHtml(manga.id)}" data-media="${escapeHtml(manga.mediaType || "")}" tabindex="0" aria-label="${escapeHtml(manga.title)}">
    <div class="book book-card" style="${coverAccent(manga)}">
      <div class="book-front novel-card-cover">
        ${coverImage(manga)}
        <span class="status-badge ${status.cls}">${status.label}</span>
        <button class="fav-btn ${fav ? "active" : ""}" data-fav data-sid="${escapeHtml(manga.sourceId)}" data-nid="${escapeHtml(manga.id)}" aria-label="Favori" title="Favori">
          ${icon("heart", 16)}
        </button>
      </div>
      <i class="book-pages" aria-hidden="true"></i>
    </div>
    <div class="novel-card-body">
      <h3>${escapeHtml(manga.title)}</h3>
      <p class="novel-card-meta">${escapeHtml(manga.author || "Auteur inconnu")}${genre}</p>
      ${sourceBadge}
      <div class="novel-card-foot">
        ${ratingBadge(manga.rating)}
        ${manga.chapterCount ? `<span>${formatCount(manga.chapterCount)} ${manga.mediaType === "anime" ? "ép." : "chap."}</span>` : ""}
      </div>
      ${ratio > 0 ? `<div class="mini-progress"><i style="width:${Math.round(ratio * 100)}%"></i></div>` : ""}
    </div>
  </article>`;
  // Ferme la fonction mangaCard.
}

// Déclare la fonction qui génère une grille de cartes squelettes (chargement).
export function skeletonGrid(count = 8) {
  // Ouvre le gabarit de la grille et répète le bloc squelette `count` fois.
  return Array.from({ length: count }, () => `
    <div class="novel-card">
      <div class="skeleton" style="aspect-ratio:2/3;border-radius:16px"></div>
      <div class="novel-card-body">
        <div class="skeleton" style="height:17px;width:85%;margin-bottom:7px;border-radius:6px"></div>
        <div class="skeleton" style="height:12px;width:52%;border-radius:6px"></div>
      </div>
    </div>`).join("");
  // Ferme la fonction skeletonGrid.
}
