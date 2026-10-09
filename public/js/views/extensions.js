// OptiManga — extensions : sources installées (scan dynamique de extension/sources/*.js)

import { api } from "../api.js";
import { escapeHtml, toast, emptyState } from "../ui.js";

export async function renderExtensions({ viewRoot }) {
  viewRoot.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">Sources de contenu</span>
      <h1>Extensions</h1>
      <p class="lead">Chaque extension est une source de mangas (API ou scraping). Les fichiers de <code>extension/sources/</code> sont détectés automatiquement au démarrage — active-la et son contenu rejoint le catalogue.</p>
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
        <h2>Ajouter une source</h2>
        <span class="muted">Scan automatique</span>
      </div>
      <p class="ext-hint">Aucune liste à maintenir : le dossier <code>extension/sources/</code> est scanné au démarrage du serveur. Dépose un fichier <code>ma-source.js</code> qui exporte une classe étendant <code>BaseSource</code>, redémarre, et la source apparaît ici ainsi que dans le catalogue.</p>
    </section>

    <p class="ext-legal">Les extensions sont des scripts fournis par la communauté. OptiManga n'est affilié à aucune d'elles et n'héberge aucun contenu : chaque source en est responsable. Les sources fournies (MangaDex, WEBTOON, Manga Plus) n'utilisent que des API ou sites officiels, au contenu légalement hébergé.</p>
  `;

  const installedGrid = viewRoot.querySelector("#installed-grid");

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
              <span>${ext.mangas ?? ext.novels ?? "?"} mangas</span>
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

  await loadInstalled();
}
