// MangaHub — bibliothèque de CBZ générés

import { api } from "../api.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { escapeHtml, coverImage, emptyState, toast, timeAgo, modal, formatSizeBytes } from "../ui.js";

export async function renderLibrary({ viewRoot }) {
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

  const grid = viewRoot.querySelector("#lib-grid");
  const countEl = viewRoot.querySelector("#lib-count");
  let entries = [];

  async function load() {
    grid.innerHTML = Array.from({ length: 4 }, () => `<div class="lib-item"><div class="skeleton" style="aspect-ratio:2/3;border-radius:16px"></div></div>`).join("");
    try {
      entries = await api.library();
      countEl.textContent = `${entries.length} fichier${entries.length > 1 ? "s" : ""}`;
      render();
    } catch (err) {
      grid.innerHTML = emptyState({ iconName: "fileText", title: "Bibliothèque indisponible", text: err.message });
    }
  }

  function render() {
    if (!entries.length) {
      grid.innerHTML = emptyState({
        iconName: "fileText",
        title: "Ta bibliothèque est vide",
        text: "Ouvre un manga et utilise l'export CBZ pour générer ton premier fichier hors-ligne.",
        action: `<button class="btn btn-primary" id="empty-cta">${icon("bookOpen", 16)} Explorer le catalogue</button>`,
      });
      const cta = grid.querySelector("#empty-cta");
      if (cta) cta.addEventListener("click", () => navigate("/"));
      return;
    }

    grid.innerHTML = entries
      .map(
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
      )
      .join("");

    grid.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = entries.find((x) => x.id === btn.dataset.del);
        modal({
          title: "Supprimer ce CBZ ?",
          text: `« ${entry?.title || "le fichier"} » sera retiré de la bibliothèque et le fichier supprimé du serveur.`,
          actions: [
            {
              label: "Supprimer",
              type: "danger",
              onClick: async ({ close }) => {
                await api.deleteLibraryEntry(btn.dataset.del);
                close();
                toast("CBZ supprimé de la bibliothèque.");
                load();
              },
            },
          ],
        });
      });
    });
  }

  await load();
}