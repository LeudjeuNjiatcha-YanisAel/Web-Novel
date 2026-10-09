// OptiManga — point d'entrée de l'application

import { registerRoutes, startRouting } from "./router.js";
import { prefs, savePrefs, loadServerState } from "./state.js";
import { renderCatalog } from "./views/catalog.js";
import { renderManga } from "./views/manga.js";
import { renderReader } from "./views/reader.js";
import { renderLibrary } from "./views/library.js";
import { renderFavorites } from "./views/favorites.js";
import { renderHistory } from "./views/history.js";
import { renderExtensions } from "./views/extensions.js";
import { renderSettings } from "./views/settings.js";

registerRoutes([
  { pattern: /^\/$/, title: "Catalogue manga", nav: "catalogue", view: renderCatalog },
  { pattern: /^\/library$/, title: "Bibliothèque CBZ", nav: "library", view: renderLibrary },
  { pattern: /^\/favorites$/, title: "Favoris", nav: "favorites", view: renderFavorites },
  { pattern: /^\/history$/, title: "Historique", nav: "history", view: renderHistory },
  { pattern: /^\/extensions$/, title: "Extensions", nav: "extensions", view: renderExtensions },
  { pattern: /^\/settings$/, title: "Réglages", nav: "settings", view: renderSettings },
  { pattern: /^\/manga\/([^/]+)\/([^/]+)$/, title: "Manga", nav: "", view: renderManga },
  { pattern: /^\/read\/([^/]+)\/([^/]+)\/([^/]+)$/, title: "Lecture", nav: "", reader: true, view: renderReader },
]);

// ---- Thème (sidebar + topbar)
function applyTheme() {
  const dark = prefs.theme !== "light";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelectorAll("#theme-icon-moon, #topbar-icon-moon").forEach((el) => {
    el.style.display = dark ? "" : "none";
  });
  document.querySelectorAll("#theme-icon-sun, #topbar-icon-sun").forEach((el) => {
    el.style.display = dark ? "none" : "";
  });
  const label = document.getElementById("theme-toggle-label");
  if (label) label.textContent = dark ? "Thème" : "Mode clair";
}

document.querySelectorAll("[data-toggle-theme]").forEach((btn) => {
  btn.addEventListener("click", () => {
    prefs.theme = prefs.theme === "light" ? "dark" : "light";
    savePrefs();
    applyTheme();
  });
});

window.addEventListener("nh:theme", applyTheme);

// ---- Navigation mobile
const navScrim = document.getElementById("nav-scrim");
const menuBtn = document.getElementById("menu-btn");
const sidebar = document.getElementById("sidebar");

function setNav(open) {
  document.documentElement.classList.toggle("nav-open", open);
  sidebar.classList.toggle("open", open);
  if (navScrim) navScrim.classList.toggle("open", open);
}

function closeNav() {
  setNav(false);
}

if (menuBtn) {
  menuBtn.addEventListener("click", () => {
    setNav(!sidebar.classList.contains("open"));
  });
}
if (navScrim) navScrim.addEventListener("click", closeNav);
if (sidebar) sidebar.addEventListener("click", (e) => {
  if (e.target.closest("a")) closeNav();
});

// ---- Démarrage
loadServerState()
  .catch((err) => console.error("Chargement de l'état serveur impossible :", err))
  .finally(() => {
    applyTheme();
    startRouting();
  });