// NovelHub — cartes de novels (partagées catalogue/favoris)

import { icon } from "../icons.js";
import { coverImage, ratingBadge, statusInfo, escapeHtml } from "../ui.js";
import { isFavorite, readRatio } from "../state.js";

export function novelCard(novel, { showSource = false } = {}) {
  const fav = isFavorite(novel.sourceId, novel.id);
  const status = statusInfo(novel.status);
  const ratio = readRatio(novel.sourceId, novel.id, novel.chapterCount);
  const genre = novel.genre ? ` · ${escapeHtml(novel.genre)}` : "";
  const sourceBadge = showSource && novel.sourceName
    ? `<span class="novel-card-meta"><span style="color:var(--violet);font-weight:650">${escapeHtml(novel.sourceName)}</span></span>`
    : "";

  return `
  <article class="novel-card" data-sid="${escapeHtml(novel.sourceId)}" data-nid="${escapeHtml(novel.id)}" tabindex="0" aria-label="${escapeHtml(novel.title)}">
    <div class="novel-card-cover">
      ${coverImage(novel)}
      <span class="status-badge ${status.cls}">${status.label}</span>
      <button class="fav-btn ${fav ? "active" : ""}" data-fav data-sid="${escapeHtml(novel.sourceId)}" data-nid="${escapeHtml(novel.id)}" aria-label="Favori" title="Favori">
        ${icon("heart", 16)}
      </button>
    </div>
    <div class="novel-card-body">
      <h3>${escapeHtml(novel.title)}</h3>
      <p class="novel-card-meta">${escapeHtml(novel.author || "Auteur inconnu")}${genre}</p>
      ${sourceBadge}
      <div class="novel-card-foot">
        ${ratingBadge(novel.rating)}
        <span>${novel.chapterCount || 0} chap.</span>
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