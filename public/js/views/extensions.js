// OptiManga — extensions : sources installées (scan dynamique de extension/sources/*.js)

// Importe le client API pour dialoguer avec le serveur.
import { api } from "../api.js";
// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";
// Importe les utilitaires d'affichage (échappement, notification, état vide).
import { escapeHtml, toast, emptyState } from "../ui.js";

// Palette déterministe : chaque source reçoit sa propre teinte.
// Déclare la palette de dégradés utilisée pour teinter chaque source.
const EXT_PALETTE = [
  // Couple de couleurs (dégradé) pour une source.
  ["#8f86ff", "#5a3fd6"],
  // Couple de couleurs (dégradé) pour une source.
  ["#ffb15c", "#e0762a"],
  // Couple de couleurs (dégradé) pour une source.
  ["#42dcae", "#159c74"],
  // Couple de couleurs (dégradé) pour une source.
  ["#6cc3ff", "#2f7fd6"],
  // Couple de couleurs (dégradé) pour une source.
  ["#fb7ea2", "#d23f6e"],
  // Couple de couleurs (dégradé) pour une source.
  ["#ffcf6b", "#cf8e2c"],
  // Couple de couleurs (dégradé) pour une source.
  ["#a78bfa", "#6d4bd8"],
  // Couple de couleurs (dégradé) pour une source.
  ["#5aa9ff", "#2a6dd6"],
  // Couple de couleurs (dégradé) pour une source.
  ["#ff8a80", "#c94b41"],
  // Couple de couleurs (dégradé) pour une source.
  ["#7ce0c0", "#1f9e7a"],
// Ferme la palette de couleurs.
];

// Fonction qui détermine la teinte d'une extension.
function extHue(ext) {
  // Si l'extension impose une couleur, on la retourne directement.
  if (ext.color) return ext.color;
  // Construit une graine textuelle à partir de l'identifiant ou du nom.
  const seed = String(ext.id || ext.name || "x");
  // Initialise le hachage.
  let h = 0;
  // Parcourt chaque caractère de la graine pour calculer un indice stable.
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // Retourne la première couleur de la palette choisie par le hachage.
  return EXT_PALETTE[h % EXT_PALETTE.length][0];
// Ferme la fonction extHue.
}

// Fonction asynchrone de rendu de la page des extensions.
export async function renderExtensions({ viewRoot }) {
  // Ouvre le gabarit HTML de la page (ne rien modifier à l'intérieur).
  viewRoot.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">Sources de contenu</span>
      <h1>Extensions</h1>
      <p class="lead">Chaque extension est une source de mangas ou d'animes (API ou scraping). Les fichiers de <code>extension/sources/</code> sont détectés automatiquement au démarrage — active-la et son contenu rejoint le catalogue.</p>
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

    <p class="ext-legal">Les extensions sont des scripts fournis par la communauté. OptiManga n'est affilié à aucune d'elles et n'héberge aucun contenu : chaque source en est responsable. Les sources fournies (MangaDex, WEBTOON, Manga Plus, AniList) n'utilisent que des API ou sites officiels, au contenu légalement hébergé.</p>
  `;

  // Récupère la grille des extensions installées dans le DOM.
  const installedGrid = viewRoot.querySelector("#installed-grid");

  // Fonction asynchrone qui charge et affiche les extensions installées.
  async function loadInstalled() {
    // Débute un bloc pour intercepter les erreurs.
    try {
      // Récupère la liste des extensions depuis l'API.
      const data = await api.extensions();
      // Extrait le tableau des extensions installées (ou tableau vide).
      const extensions = data.installed || [];
      // Récupère l'élément d'affichage du compteur.
      const count = viewRoot.querySelector("#ext-count");
      // Met à jour le compteur avec le bon pluriel si l'élément existe.
      if (count) count.textContent = `${extensions.length} source${extensions.length > 1 ? "s" : ""}`;

      // Construit le HTML de chaque carte d'extension puis l'injecte dans la grille.
      installedGrid.innerHTML = extensions
        // Transforme chaque extension en carte HTML.
        .map((ext) => {
          // Détermine s'il s'agit d'une source d'anime.
          const isAnime = ext.mediaType === "anime";
          // Définit le libellé du type (Anime ou Manga).
          const type = isAnime ? "Anime" : "Manga";
          // Calcule la couleur d'accent de l'extension.
          const color = extHue(ext);
          // Compte les genres disponibles (0 si non renseigné).
          const genreCount = Array.isArray(ext.genres) ? ext.genres.length : 0;
          // Ouvre le gabarit HTML d'une carte d'extension (ne rien modifier à l'intérieur).
          return `
        <div class="ext-card ${isAnime ? "is-anime" : ""}" data-ext="${escapeHtml(ext.id)}" style="--ext:${escapeHtml(color)}">
          <span class="ext-logo">${escapeHtml(ext.name.charAt(0).toUpperCase())}</span>
          <div class="ext-body">
            <div class="ext-title">
              <h3>${escapeHtml(ext.name)}</h3>
              <span class="ext-type">${icon(isAnime ? "play" : "book", 11)} ${type}</span>
              <span class="version">v${escapeHtml(ext.version)}</span>
            </div>
            <p class="ext-desc">${escapeHtml(ext.description || "Aucune description")}</p>
            <div class="ext-meta">
              <span>${escapeHtml((ext.lang || "fr").toUpperCase())}</span>
              <span>·</span>
              <span>${genreCount} genre${genreCount > 1 ? "s" : ""}</span>
              <span>·</span>
              <span>${escapeHtml(ext.author || "OptiManga")}</span>
            </div>
          </div>
          <div class="ext-toggle-wrap">
            <button class="switch ${ext.enabled ? "on" : ""}" data-switch="${escapeHtml(ext.id)}" role="switch" aria-checked="${ext.enabled}" title="${ext.enabled ? "Désactiver" : "Activer"}">
              <span class="knob"></span>
            </button>
            <label class="switch-label">${ext.enabled ? "Active" : "Inactive"}</label>
          </div>
        </div>`;
        // Ferme le callback du map.
        })
        // Assemble les cartes en une seule chaîne HTML.
        .join("");

      // Branche l'évènement de clic sur chaque bouton d'activation.
      installedGrid.querySelectorAll("[data-switch]").forEach((sw) => {
        // Ajoute un gestionnaire asynchrone au clic sur l'interrupteur.
        sw.addEventListener("click", async () => {
          // Récupère la carte correspondant à cette extension.
          const card = installedGrid.querySelector(`[data-ext="${sw.dataset.switch}"]`);
          // Retrouve l'objet extension correspondant dans la liste.
          const ext = extensions.find((x) => x.id === sw.dataset.switch);
          // Abandonne si l'extension est introuvable.
          if (!ext) return;
          // Désactive temporairement le bouton pendant le traitement.
          sw.disabled = true;
          // Débute un bloc pour intercepter les erreurs.
          try {
            // Demande au serveur d'inverser l'état de l'extension.
            const updated = await api.toggleExtension(ext.id, !ext.enabled);
            // Met à jour l'état local de l'extension.
            ext.enabled = updated.enabled;
            // Met à jour la classe visuelle de l'interrupteur.
            sw.classList.toggle("on", updated.enabled);
            // Met à jour l'attribut d'accessibilité aria-checked.
            sw.setAttribute("aria-checked", String(updated.enabled));
            // Met à jour le libellé texte (Active/Inactive) de la carte.
            card.querySelector(".switch-label").textContent = updated.enabled ? "Active" : "Inactive";
            // Affiche une notification confirmant le changement.
            toast(updated.enabled ? `« ${ext.name} » activée.` : `« ${ext.name} » désactivée.`);
          // Capture une éventuelle erreur du changement d'état.
          } catch (err) {
            // Affiche une notification d'erreur.
            toast(err.message || "Erreur lors du changement d'état.");
          // Bloc exécuté dans tous les cas pour nettoyer.
          } finally {
            // Réactive le bouton.
            sw.disabled = false;
          // Ferme le bloc finally.
          }
        // Ferme le callback du clic.
        });
      // Ferme le forEach des interrupteurs.
      });
    // Capture une erreur globale du chargement.
    } catch (err) {
      // Affiche un état vide signalant l'indisponibilité des sources.
      installedGrid.innerHTML = emptyState({ iconName: "puzzle", title: "Sources indisponibles", text: err.message });
    // Ferme le bloc catch.
    }
  // Ferme la fonction loadInstalled.
  }

  // Lance le chargement des extensions au rendu.
  await loadInstalled();
// Ferme la fonction renderExtensions.
}
