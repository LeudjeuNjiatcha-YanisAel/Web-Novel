// OptiManga — réglages, statistiques et gestion des données

// Importe le client API pour dialoguer avec le serveur.
import { api } from "../api.js";
// Importe la fonction d'icône depuis le module des icônes.
import { icon } from "../icons.js";
// Importe les utilitaires d'affichage (échappement, notification, modale).
import { escapeHtml, toast, modal } from "../ui.js";
// Importe les préférences, la sauvegarde et l'état global du serveur.
import { prefs, savePrefs, loadServerState, serverState } from "../state.js";

// Fonction asynchrone de rendu de la page des réglages.
export async function renderSettings({ viewRoot }) {
  // Détermine le thème actuel (sombre par défaut).
  const theme = prefs.theme || "dark";

  // Ouvre le gabarit HTML de la page (ne rien modifier à l'intérieur).
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
          <a class="btn btn-sm btn-primary" href="#/catalogue" data-goto-catalog>${icon("bookOpen", 15)} Ouvrir un manga</a>
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
        <div class="about-line"><span>Sources actives</span><span class="muted" id="active-sources">…</span></div>
        <p class="muted about-note">
          OptiManga est une expérience de lecture premium dédiée aux univers manga & anime : extensions, lecteur d'images (pages ou bande),
          export CBZ et progression synchronisée. Projet personnel à but pédagogique, sans hébergement de contenu.
        </p>
      </div>
    </div>
  `;

  // ---- Statistiques
  // Débute un bloc pour intercepter les erreurs de chargement des statistiques.
  try {
    // Récupère les statistiques depuis l'API.
    const stats = await api.stats();
    // Récupère le nombre de favoris depuis l'état serveur.
    const favCount = serverState.favorites.length;
    // Récupère le nombre de chapitres lus (0 par défaut).
    const readChapters = stats.readChapters || 0;

    // Prépare les cartes de statistiques à afficher.
    const cards = [
      // Carte : nombre de sources actives.
      { label: "Sources actives", value: `${stats.sources}` },
      // Carte : nombre de mangas au catalogue.
      { label: "Mangas au catalogue", value: `${stats.mangas}` },
      // Carte : nombre de chapitres.
      { label: "Chapitres", value: `${stats.chapters}` },
      // Carte : nombre de téléchargements CBZ.
      { label: "Téléchargements CBZ", value: `${stats.downloads || 0}` },
      // Carte : nombre de chapitres lus.
      { label: "Chapitres lus", value: `${readChapters}` },
    // Ferme le tableau des cartes.
    ];
    // Construit et injecte les cartes de statistiques.
    viewRoot.querySelector("#stats-row").innerHTML = cards
      // Transforme chaque statistique en carte HTML.
      .map(
        // Ouvre le gabarit HTML d'une carte (ne rien modifier à l'intérieur).
        (c) => `
      <div class="stat-card">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
      </div>`
      // Ferme le callback du map.
      )
      // Assemble les cartes en une seule chaîne HTML.
      .join("");
  // Capture une erreur de chargement des statistiques.
  } catch (err) {
    // Affiche un message d'indisponibilité des statistiques.
    viewRoot.querySelector("#stats-row").innerHTML = `<div class="stat-card muted" style="grid-column:1/-1">Statistiques indisponibles : ${escapeHtml(err.message)}</div>`;
  // Ferme le bloc catch.
  }

  // ---- Sources actives (dynamique)
  // Récupère l'élément d'affichage des sources actives.
  const sourcesEl = viewRoot.querySelector("#active-sources");
  // Récupère les extensions et met à jour le compteur de sources actives.
  api
    // Appelle l'API des extensions.
    .extensions()
    // Traite la réponse en cas de succès.
    .then((data) => {
      // Filtre les extensions actives.
      const active = (data.installed || []).filter((e) => e.enabled);
      // Abandonne si l'élément cible n'existe pas.
      if (!sourcesEl) return;
      // Affiche la liste des noms de sources actives ou un message par défaut.
      sourcesEl.textContent = active.length
        // Joint les noms des sources actives par une virgule.
        ? active.map((e) => e.name).join(", ")
        // Message affiché si aucune source n'est active.
        : "Aucune (active une extension)";
    // Ferme le bloc then.
    })
    // Traite une éventuelle erreur.
    .catch(() => {
      // Affiche un message d'indisponibilité si l'élément existe.
      if (sourcesEl) sourcesEl.textContent = "Indisponible";
    // Ferme le bloc catch.
    });

  // ---- Thème
  // Récupère le sélecteur de thème.
  const themeSeg = viewRoot.querySelector("#theme-seg");
  // Branche le changement de thème au clic sur le sélecteur.
  themeSeg.addEventListener("click", (e) => {
    // Récupère le bouton de thème cliqué.
    const btn = e.target.closest("button[data-v]");
    // Abandonne si aucun bouton n'a été cliqué.
    if (!btn) return;
    // Récupère la valeur du thème choisi.
    const value = btn.dataset.v;
    // Met à jour la préférence de thème.
    prefs.theme = value;
    // Récupère le bouton correspondant à la valeur choisie.
    const seg = themeSeg.querySelector(`[data-v="${value}"]`);
    // Met à jour l'état visuel des boutons si le bouton existe.
    if (seg) {
      // Retire la classe active de tous les boutons.
      themeSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      // Ajoute la classe active au bouton choisi.
      seg.classList.add("active");
    // Ferme la condition sur le bouton.
    }
    // Applique le thème à la racine du document.
    document.documentElement.setAttribute("data-theme", value);
    // Sauvegarde les préférences.
    savePrefs();
    // Émet un évènement pour prévenir le reste de l'application.
    window.dispatchEvent(new CustomEvent("nh:theme"));
  // Ferme le gestionnaire de clic du sélecteur de thème.
  });

  // ---- Réinitialisation
  // Branche la réinitialisation des données au clic sur le bouton.
  viewRoot.querySelector("#reset-data").addEventListener("click", () => {
    // Affiche la modale de confirmation de réinitialisation.
    modal({
      // Titre de la modale.
      title: "Tout réinitialiser ?",
      // Texte explicatif de la modale.
      text: "Favoris, historique, progressions de lecture et fichiers CBZ seront définitivement effacés.",
      // Liste des actions (boutons) de la modale.
      actions: [
        // Décrit l'action unique de réinitialisation.
        {
          // Libellé du bouton.
          label: "Réinitialiser",
          // Style du bouton (danger).
          type: "danger",
          // Action asynchrone exécutée au clic sur le bouton.
          onClick: async ({ close }) => {
            // Débute un bloc pour intercepter les erreurs.
            try {
              // Demande au serveur de réinitialiser l'état.
              await api.resetState();
              // Recharge l'état serveur local.
              await loadServerState();
              // Ferme la modale.
              close();
              // Affiche une notification de confirmation.
              toast("Données réinitialisées.");
              // Re-rend la page des réglages avec les données à jour.
              renderSettings({ viewRoot });
            // Capture une éventuelle erreur de réinitialisation.
            } catch (err) {
              // Affiche une notification d'erreur.
              toast(err.message || "Erreur lors de la réinitialisation.");
            // Ferme le bloc catch.
            }
          // Ferme la fonction onClick.
          },
        // Ferme l'objet d'action.
        },
      // Ferme le tableau des actions.
      ],
    // Ferme l'appel à modal.
    });
  // Ferme le gestionnaire de clic du bouton de réinitialisation.
  });
// Ferme la fonction renderSettings.
}
