// MangaHub — cartes de mangas (partagées catalogue/favoris)

import { icon } from "../icons.js";
import { coverImage, ratingBadge, statusInfo, escapeHtml, formatCount, coverAccent } from "../ui.js";
import { isFavorite, readRatio } from "../state.js";

export function mangaCard(manga, { showSource = false } = {}) {
  const fav = isFavorite(manga.sourceId, manga.id);
  const status = statusInfo(manga.status);
  const ratio = readRatio(manga.sourceId, manga.id, manga.chapterCount);
  const genre = manga.genre ? ` · ${escapeHtml(manga.genre)}` : "";
  const sourceBadge = showSource && manga.sourceName
    ? `<span class="novel-card-meta"><span style="color:var(--violet);font-weight:650">${escapeHtml(manga.sourceName)}</span></span>`
    : "";

  return `
  <article class="novel-card" data-sid="${escapeHtml(manga.sourceId)}" data-nid="${escapeHtml(manga.id)}" tabindex="0" aria-label="${escapeHtml(manga.title)}">
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
        ${manga.chapterCount ? `<span>${formatCount(manga.chapterCount)} chap.</span>` : ""}
      </div>
      ${ratio > 0 ? `<div class="mini-progress"><i style="width:${Math.round(ratio * 100)}%"></i></div>` : ""}
    </div>
  </article>`;
}

export function skeletonGrid(count = 8) {
  return Array.from({ length: count }, () => `
    <div class="novel-card">
      <div class="skeleton" style="aspect-ratio:2/3;border-radius:16px"></div>
      <div class="novel-card-body">
        <div class="skeleton" style="height:17px;width:85%;margin-bottom:7px;border-radius:6px"></div>
        <div class="skeleton" style="height:12px;width:52%;border-radius:6px"></div>
      </div>
    </div>`).join("");
}