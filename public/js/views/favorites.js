// NovelHub — favoris (suivi des novels)

import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast, emptyState } from "../ui.js";
import { serverState, toggleFavorite } from "../state.js";
import { novelCard } from "./cards.js";

export function renderFavorites({ viewRoot }) {
  const favs = serverState.favorites;

  viewRoot.innerHTML = `
    <header class="page-head page-head-row">
      <div>
        <span class="eyebrow">Suivi</span>
        <h1>Favoris</h1>
        <p class="lead">Retrouve ici les novels que tu suis. Un cœur suffit à ranger une histoire.</p>
      </div>
      ${favs.length ? `<span class="badge">${favs.length} roman${favs.length > 1 ? "s" : ""}</span>` : ""}
    </header>
    <div id="fav-grid" class="grid"></div>
  `;

  const grid = viewRoot.querySelector("#fav-grid");

  if (!favs.length) {
    grid.innerHTML = emptyState({
      iconName: "heart",
      title: "Aucun favori pour l'instant",
      text: "Passe le cœur sur les cartes du catalogue ou depuis une fiche novel pour suivre cette histoire ici.",
      action: `<button class="btn btn-primary" id="fav-cta">${icon("sparkle", 16)} Découvrir le catalogue</button>`,
    });
    grid.querySelector("#fav-cta").addEventListener("click", () => navigate("/"));
    return;
  }

  grid.innerHTML = favs
    .map((f) =>
      novelCard({
        sourceId: f.sourceId,
        id: f.novelId,
        title: f.title,
        author: f.author,
        cover: f.cover,
        genre: f.genre,
        rating: f.rating,
        status: f.status,
        chapterCount: f.chapterCount,
      })
    )
    .join("");

  grid.querySelectorAll(".novel-card").forEach((card, index) => {
    const fav = favs[index];
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav]")) return;
      navigate(`/novel/${fav.sourceId}/${fav.novelId}`);
    });
    card.querySelector("[data-fav]").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite({ ...fav, id: fav.novelId, sourceId: fav.sourceId });
      toast("Retiré des favoris");
      renderFavorites({ viewRoot });
    });
  });
}