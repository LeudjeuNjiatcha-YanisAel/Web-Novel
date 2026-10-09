// OptiManga — réglages, statistiques et gestion des données

import { api } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml, toast, modal } from "../ui.js";
import { prefs, savePrefs, loadServerState, serverState } from "../state.js";

export async function renderSettings({ viewRoot }) {
  const theme = prefs.theme || "dark";

  viewRoot.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">Préférences</span>
      <h1>Réglages</h1>
      <p class="lead">Tes préférences sont conservées localement dans le navigateur.</p>
    </header>

    <section class="settings-stats" id="stats-row">
      ${[1, 2, 3, 4, 5].map(() => `<div class="stat-card"><div class="skeleton" style="height:14px;width:60%;border-radius:6px"></div><div class="skeleton" style="height:26px;width:40%;margin-top:10px;border-radius:6px"></div></div>`).join("")}
    </section>

    <div class="settings-columns">
      <div class="panel">
        <h2 class="panel-title">${icon("sun", 16)} Apparence</h2>
        <div class="panel-row">
          <div>
            <strong>Thème de l'application</strong>
            <p class="muted">Sombre pour la nuit, clair pour le jour.</p>
          </div>
          <div class="seg" id="theme-seg">
            <button data-v="dark" class="${theme === "dark" ? "active" : ""}">${icon("moon", 15)} Sombre</button>
            <button data-v="light" class="${theme === "light" ? "active" : ""}">${icon("sun", 15)} Clair</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2 class="panel-title">${icon("settings", 16)} Lecteur</h2>
        <div class="panel-row">
          <div>
            <strong>Réglages de lecture</strong>
            <p class="muted">Mode « Pages » ou « Bande continue », qualité des images et fond se règlent aussi dans le lecteur (touche « T » pour la table des matières).</p>
          </div>
          <a class="btn btn-sm btn-primary" href="#/" data-goto-catalog>${icon("bookOpen", 15)} Ouvrir un manga</a>
        </div>
      </div>

      <div class="panel">
        <h2 class="panel-title">${icon("download", 16)} Données locales</h2>
        <div class="panel-row">
          <div>
            <strong>Réinitialiser mes données</strong>
            <p class="muted">Efface favoris, historique, progressions de lecture et bibliothèque CBZ.</p>
          </div>
          <button class="btn btn-sm btn-danger" id="reset-data">${icon("trash", 15)} Réinitialiser</button>
        </div>
      </div>

      <div class="panel">
        <h2 class="panel-title">${icon("info", 16)} À propos</h2>
        <div class="about-line"><span>Version d'OptiManga</span><span class="muted">2.0.0</span></div>
        <div class="about-line"><span>Source active</span><span class="muted">MangaDex (API)</span></div>
        <p class="muted about-note">
          OptiManga est une expérience de lecture premium dédiée aux univers manga & anime : extensions, lecteur d'images (pages ou bande),
          export CBZ et progression synchronisée. Projet personnel à but pédagogique, sans hébergement de contenu.
        </p>
      </div>
    </div>
  `;

  // ---- Statistiques
  try {
    const stats = await api.stats();
    const favCount = serverState.favorites.length;
    const readChapters = stats.readChapters || 0;

    const cards = [
      { label: "Sources actives", value: `${stats.sources}` },
      { label: "Mangas au catalogue", value: `${stats.mangas}` },
      { label: "Chapitres", value: `${stats.chapters}` },
      { label: "Téléchargements CBZ", value: `${stats.downloads || 0}` },
      { label: "Chapitres lus", value: `${readChapters}` },
    ];
    viewRoot.querySelector("#stats-row").innerHTML = cards
      .map(
        (c) => `
      <div class="stat-card">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
      </div>`
      )
      .join("");
  } catch (err) {
    viewRoot.querySelector("#stats-row").innerHTML = `<div class="stat-card muted" style="grid-column:1/-1">Statistiques indisponibles : ${escapeHtml(err.message)}</div>`;
  }

  // ---- Thème
  const themeSeg = viewRoot.querySelector("#theme-seg");
  themeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-v]");
    if (!btn) return;
    const value = btn.dataset.v;
    prefs.theme = value;
    const seg = themeSeg.querySelector(`[data-v="${value}"]`);
    if (seg) {
      themeSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      seg.classList.add("active");
    }
    document.documentElement.setAttribute("data-theme", value);
    savePrefs();
    window.dispatchEvent(new CustomEvent("nh:theme"));
  });

  // ---- Réinitialisation
  viewRoot.querySelector("#reset-data").addEventListener("click", () => {
    modal({
      title: "Tout réinitialiser ?",
      text: "Favoris, historique, progressions de lecture et fichiers CBZ seront définitivement effacés.",
      actions: [
        {
          label: "Réinitialiser",
          type: "danger",
          onClick: async ({ close }) => {
            try {
              await api.resetState();
              await loadServerState();
              close();
              toast("Données réinitialisées.");
              renderSettings({ viewRoot });
            } catch (err) {
              toast(err.message || "Erreur lors de la réinitialisation.");
            }
          },
        },
      ],
    });
  });
}