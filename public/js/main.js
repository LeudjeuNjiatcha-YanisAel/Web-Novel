// OptiManga — point d'entrée de l'application

// On importe les fonctions du routeur pour enregistrer et démarrer les routes.
import { registerRoutes, startRouting } from "./router.js";
// On importe les préférences, leur sauvegarde et le chargement de l'état serveur.
import { prefs, savePrefs, loadServerState } from "./state.js";
// On importe la vue de la page d'accueil.
import { renderHome } from "./views/home.js";
// On importe la vue du catalogue manga.
import { renderCatalog } from "./views/catalog.js";
// On importe la vue détaillée d'un manga.
import { renderManga } from "./views/manga.js";
// On importe la vue du lecteur de chapitres.
import { renderReader } from "./views/reader.js";
// On importe la vue de la bibliothèque CBZ.
import { renderLibrary } from "./views/library.js";
// On importe la vue des favoris.
import { renderFavorites } from "./views/favorites.js";
// On importe la vue de l'historique.
import { renderHistory } from "./views/history.js";
// On importe la vue des extensions.
import { renderExtensions } from "./views/extensions.js";
// On importe la vue des réglages.
import { renderSettings } from "./views/settings.js";
// On importe la vue affichée quand aucune route ne correspond.
import { renderNotFound } from "./views/notfound.js";

// On enregistre la table des routes avec leur motif, titre et vue associée.
registerRoutes([
  // Route de la page d'accueil.
  { pattern: /^\/$/, title: "Accueil", nav: "home", view: renderHome },
  // Route du catalogue manga.
  { pattern: /^\/catalogue$/, title: "Catalogue manga", nav: "catalogue", view: renderCatalog },
  // Route de la bibliothèque CBZ.
  { pattern: /^\/library$/, title: "Bibliothèque CBZ", nav: "library", view: renderLibrary },
  // Route des favoris.
  { pattern: /^\/favorites$/, title: "Favoris", nav: "favorites", view: renderFavorites },
  // Route de l'historique.
  { pattern: /^\/history$/, title: "Historique", nav: "history", view: renderHistory },
  // Route des extensions.
  { pattern: /^\/extensions$/, title: "Extensions", nav: "extensions", view: renderExtensions },
  // Route des réglages.
  { pattern: /^\/settings$/, title: "Réglages", nav: "settings", view: renderSettings },
  // Route d'une fiche manga avec source et identifiant dans l'URL.
  { pattern: /^\/manga\/([^/]+)\/([^/]+)$/, title: "Manga", nav: "", view: renderManga },
  // Route du lecteur avec source, manga et chapitre dans l'URL.
  { pattern: /^\/read\/([^/]+)\/([^/]+)\/([^/]+)$/, title: "Lecture", nav: "", reader: true, view: renderReader },
  // Route de repli quand aucune autre ne correspond.
  { pattern: /^.*$/, fallback: true, title: "Introuvable", nav: "", view: renderNotFound },
// On referme la liste des routes.
]);

// ---- Thème (sidebar + topbar)
// On déclare la fonction qui applique le thème courant à la page.
function applyTheme() {
  // On considère le thème sombre sauf si la préférence vaut « light ».
  const dark = prefs.theme !== "light";
  // On positionne l'attribut data-theme sur la racine du document.
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  // On sélectionne toutes les icônes de lune présentes dans l'interface.
  document.querySelectorAll("#theme-icon-moon, #topbar-icon-moon").forEach((el) => {
    // On les affiche en mode sombre et les masque en mode clair.
    el.style.display = dark ? "" : "none";
  // On referme la boucle des icônes de lune.
  });
  // On sélectionne toutes les icônes de soleil présentes dans l'interface.
  document.querySelectorAll("#theme-icon-sun, #topbar-icon-sun").forEach((el) => {
    // On les masque en mode sombre et les affiche en mode clair.
    el.style.display = dark ? "none" : "";
  // On referme la boucle des icônes de soleil.
  });
  // On récupère l'étiquette texte du bouton de thème.
  const label = document.getElementById("theme-toggle-label");
  // On met à jour le libellé selon le thème actif, s'il existe.
  if (label) label.textContent = dark ? "Thème" : "Mode clair";
// On referme la fonction applyTheme.
}

// On attache un écouteur de clic à chaque bouton de bascule du thème.
document.querySelectorAll("[data-toggle-theme]").forEach((btn) => {
  // À chaque clic, on inverse le thème puis on réapplique les préférences.
  btn.addEventListener("click", () => {
    // On bascule la préférence entre « light » et « dark ».
    prefs.theme = prefs.theme === "light" ? "dark" : "light";
    // On sauvegarde les préférences modifiées.
    savePrefs();
    // On applique immédiatement le nouveau thème à l'interface.
    applyTheme();
  // On referme la fonction de clic.
  });
// On referme la boucle des boutons de thème.
});

// On réapplique le thème lorsqu'un événement personnalisé « nh:theme » est émis.
window.addEventListener("nh:theme", applyTheme);

// ---- Navigation mobile
// On récupère l'élément d'arrière-plan qui masque la navigation mobile.
const navScrim = document.getElementById("nav-scrim");
// On récupère le bouton d'ouverture du menu.
const menuBtn = document.getElementById("menu-btn");
// On récupère la barre latérale de navigation.
const sidebar = document.getElementById("sidebar");

// On déclare la fonction qui ouvre ou ferme la navigation mobile.
function setNav(open) {
  // On ajoute ou retire la classe « nav-open » sur la racine du document.
  document.documentElement.classList.toggle("nav-open", open);
  // On ajoute ou retire la classe « open » sur la barre latérale.
  sidebar.classList.toggle("open", open);
  // On synchronise l'arrière-plan s'il est présent.
  if (navScrim) navScrim.classList.toggle("open", open);
// On referme la fonction setNav.
}

// On déclare la fonction pratique qui ferme la navigation.
function closeNav() {
  // On demande la fermeture via setNav.
  setNav(false);
// On referme la fonction closeNav.
}

// Si le bouton de menu existe, on lui ajoute un écouteur de clic.
if (menuBtn) {
  // Au clic, on inverse l'état d'ouverture actuel de la barre latérale.
  menuBtn.addEventListener("click", () => {
    // On ouvre si elle est fermée, on ferme si elle est ouverte.
    setNav(!sidebar.classList.contains("open"));
  // On referme la fonction de clic.
  });
// On referme le test de présence du bouton de menu.
}
// Si l'arrière-plan existe, un clic dessus ferme la navigation.
if (navScrim) navScrim.addEventListener("click", closeNav);
// Si la barre latérale existe, on écoute les clics qui la traversent.
if (sidebar) sidebar.addEventListener("click", (e) => {
  // Si le clic provient d'un lien, on referme la navigation.
  if (e.target.closest("a")) closeNav();
// On referme la fonction de clic sur la barre latérale.
});

// ---- Démarrage
// On lance le chargement de l'état serveur.
loadServerState()
  // En cas d'échec, on journalise l'erreur dans la console.
  .catch((err) => console.error("Chargement de l'état serveur impossible :", err))
  // Quoi qu'il arrive, on applique le thème puis on démarre le routeur.
  .finally(() => {
    // On applique le thème choisi par l'utilisateur.
    applyTheme();
    // On démarre la gestion des routes.
    startRouting();
  // On referme la fonction finally.
  });
