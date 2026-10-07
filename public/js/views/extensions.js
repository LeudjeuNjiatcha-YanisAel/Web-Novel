// NovelHub — extensions : sources installées et catalogue d'extensions

import { api } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml, toast, emptyState, modal } from "../ui.js";

const CATALOG = [
  {
    name: "MangaDex",
    author: "MangaDex",
    lang: "Multilingue (FR, EN)",
    desc: "Catalogue immense de mangas avec chapitres en français. Recherche Dragon Ball, One Piece, Naruto, Bleach et bien plus.",
    size: "—",
    installed: false,
    type: "manga",
    sourceId: "mangadex",
  },
  {
    name: "Magazine d'Histoires",
    author: "Collectif",
    lang: "Français",
    desc: "Imaginaire francophone : fantasy, anticipation et merveilleux, mis à jour chaque mois.",
    size: "2,4 Mo",
    installed: true,
  },
  {
    name: "Corner Library 2",
    author: "Atlas",
    lang: "Anglais",
    desc: "Le forum historique du roman web, version modernisée de la 1re génération.",
    size: "3,1 Mo",
    installed: false,
  },
  {
    name: "Wuxia Nexus",
    author: "WX",
    lang: "Anglais",
    desc: "Romance, cultivation et action ; un large catalogue de premiers chapitres gratuits.",
    size: "4,7 Mo",
    installed: false,
  },
];

export async function renderExtensions({ viewRoot }) {
  viewRoot.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">Sources de contenu</span>
      <h1>Extensions</h1>
      <p class="lead">Chaque extension est une source de novels. Installe-les, active-les, et son contenu rejoint le catalogue.</p>
    </header>

    <section class="ext-section">
      <div class="ext-section-head">
        <h2>Installées</h2>
        <span class="badge" id="ext-count">…</span>
      </div>
      <div class="ext-grid" id="installed-grid"><div class="ext-skeleton"></div><div class="ext-skeleton"></div></div>
    </section>

    <section class="ext-section">
      <div class="ext-section-head">
        <h2>Catalogue</h2>
        <span class="muted">Extensions validées communautaires</span>
      </div>
      <div class="ext-grid" id="catalog-grid"></div>
    </section>

    <p class="ext-legal">Les extensions sont des scripts fournis par la communauté. NovelHub ne leur est pas affilié et n'héberge aucun contenu : chaque source en est responsable.</p>
  `;

  const installedGrid = viewRoot.querySelector("#installed-grid");
  const catalogGrid = viewRoot.querySelector("#catalog-grid");

  async function loadInstalled() {
    try {
      const data = await api.extensions();
      const extensions = data.installed || [];
      const count = viewRoot.querySelector("#ext-count");
      if (count) count.textContent = `${extensions.length} source${extensions.length > 1 ? "s" : ""}`;

      installedGrid.innerHTML = extensions
        .map(
          (ext) => `
        <div class="ext-card" data-ext="${escapeHtml(ext.id)}">
          <span class="ext-logo">${escapeHtml(ext.name.charAt(0).toUpperCase())}</span>
          <div class="ext-body">
            <div class="ext-title">
              <h3>${escapeHtml(ext.name)}</h3>
              <span class="version">v${escapeHtml(ext.version)}</span>
            </div>
            <p class="ext-desc">${escapeHtml(ext.description || "Aucune description")}</p>
            <div class="ext-meta">
              <span>${ext.novels ?? "?"} novels</span>
              <span>·</span>
              <span>${ext.chapters ?? "?"} chapitres</span>
              <span>·</span>
              <span>${escapeHtml(ext.author)}</span>
            </div>
          </div>
          <div class="ext-toggle-wrap">
            <button class="switch ${ext.enabled ? "on" : ""}" data-switch="${escapeHtml(ext.id)}" role="switch" aria-checked="${ext.enabled}" title="${ext.enabled ? "Désactiver" : "Activer"}">
              <span class="knob"></span>
            </button>
            <label class="switch-label">${ext.enabled ? "Active" : "Inactive"}</label>
          </div>
        </div>`
        )
        .join("");

      installedGrid.querySelectorAll("[data-switch]").forEach((sw) => {
        sw.addEventListener("click", async () => {
          const card = installedGrid.querySelector(`[data-ext="${sw.dataset.switch}"]`);
          const ext = extensions.find((x) => x.id === sw.dataset.switch);
          if (!ext) return;
          sw.disabled = true;
          try {
            const updated = await api.toggleExtension(ext.id, !ext.enabled);
            ext.enabled = updated.enabled;
            sw.classList.toggle("on", updated.enabled);
            sw.setAttribute("aria-checked", String(updated.enabled));
            card.querySelector(".switch-label").textContent = updated.enabled ? "Active" : "Inactive";
            toast(updated.enabled ? `« ${ext.name} » activée.` : `« ${ext.name} » désactivée.`);
          } catch (err) {
            toast(err.message || "Erreur lors du changement d'état.");
          } finally {
            sw.disabled = false;
          }
        });
      });
    } catch (err) {
      installedGrid.innerHTML = emptyState({ iconName: "puzzle", title: "Sources indisponibles", text: err.message });
    }
  }

  catalogGrid.innerHTML = CATALOG.map(
    (c, i) => `
    <div class="ext-card available">
      <span class="ext-logo">${c.installed ? "✓" : escapeHtml(c.name.charAt(0).toUpperCase())}</span>
      <div class="ext-body">
        <div class="ext-title">
          <h3>${escapeHtml(c.name)}</h3>
          <span class="version">${escapeHtml(c.size)}</span>
        </div>
        <p class="ext-desc">${escapeHtml(c.desc)}</p>
        <div class="ext-meta">
          <span>${escapeHtml(c.lang)}</span>
          <span>·</span>
          <span>par ${escapeHtml(c.author)}</span>
        </div>
      </div>
      <div class="ext-toggle-wrap">
        ${
          c.installed
            ? `<button class="btn btn-sm" disabled>${icon("check", 14)} Ajoutée</button>`
            : `<button class="btn btn-sm btn-primary install" data-install="${i}">${icon("download", 14)} Installer</button>`
        }
      </div>
    </div>`
  ).join("");

  catalogGrid.querySelectorAll("[data-install]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = CATALOG[+btn.dataset.install];
      const idx = +btn.dataset.install;
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = `<span class="spinner sm"></span> Installation...`;
      try {
        const sourceId = item.sourceId || item.id || item.name.toLowerCase().replace(/\s+/g, "");
        await api.toggleExtension(sourceId, true);
        CATALOG[idx].installed = true;
        renderExtensions({ viewRoot });
        toast(`« ${item.name} » ajouté avec succès.`);
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = original;
        toast(err.message || "Impossible d'installer cette extension.");
      }
    });
  });

  await loadInstalled();
}