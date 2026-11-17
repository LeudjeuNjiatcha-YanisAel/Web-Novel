// OptiManga — routeur hash (#/chemin) et coordination des vues

// On déclare la fonction qui analyse le hash de l'URL courante.
export function parseHash() {
  // On retire le « # » initial et on utilise « / » si le hash est vide.
  const raw = location.hash.replace(/^#/, "") || "/";
  // On sépare le chemin de la chaîne de requête.
  const [path, query = ""] = raw.split("?");
  // On transforme la chaîne de requête en objet de paramètres.
  const params = new URLSearchParams(query);
  // On renvoie le chemin et les paramètres analysés.
  return { path, queryParams: params };
// On referme la fonction parseHash.
}

// On déclare la fonction qui renvoie seulement le chemin courant.
export function currentPath() {
  // On extrait la propriété path du résultat de parseHash.
  return parseHash().path;
// On referme la fonction currentPath.
}

// On déclare la fonction qui navigue vers un chemin donné.
export function navigate(path) {
  // On garantit que le chemin commence par un « / ».
  const p = String(path).startsWith("/") ? path : "/" + path;
  // On vérifie si l'on est déjà sur ce chemin.
  if (currentPath() === p) {
    // On remonte la page en haut.
    window.scrollTo(0, 0);
    // On relance le rendu de la route courante.
    runRoute();
    // On quitte la fonction puisqu'aucune navigation n'est nécessaire.
    return;
  // On referme le test de chemin déjà actif.
  }
  // On modifie le hash de l'URL, ce qui déclenche la navigation.
  location.hash = p;
// On referme la fonction navigate.
}

// On initialise la table des routes avec un tableau vide.
let routes = [];
// On indique que les routes ne sont pas encore enregistrées.
let routesReady = false;
// On prépare une variable pour stocker la fonction de nettoyage de la vue.
let cleanupFn = null;

// On prépare une variable pour le rappel déclenché à chaque changement de route.
let onRouteChange = null;

// On déclare la fonction qui enregistre un écouteur de changement de route.
export function setRouteListener(fn) {
  // On mémorise la fonction fournie comme rappel.
  onRouteChange = fn;
// On referme la fonction setRouteListener.
}

// On déclare la fonction qui enregistre la liste des routes.
export function registerRoutes(list) {
  // On stocke la liste des routes fournie.
  routes = list;
  // On marque les routes comme prêtes à être utilisées.
  routesReady = true;
// On referme la fonction registerRoutes.
}

// On déclare la fonction qui exécute la route correspondant à l'URL.
export function runRoute(forceRender = false) {
  // On sort immédiatement si les routes ne sont pas encore prêtes.
  if (!routesReady) return;
  // On récupère le chemin courant depuis le hash.
  const { path } = parseHash();

  // On cherche la première route dont le motif correspond au chemin.
  let route = routes.find((r) => r.pattern.test(path));
  // Si aucune ne correspond, on prend la route de repli ou la première.
  if (!route) route = routes.find((r) => r.fallback) || routes[0];

  // On applique le motif de la route pour en extraire les paramètres d'URL.
  const match = String(path).match(route.pattern) || [];
  // On conserve les groupes capturés, sans la correspondance complète.
  const params = match.slice(1);

  // On détecte un re-rendu forcé sur une route déjà affichée.
  if (forceRender && window.__lastPath === path) {
    /* re-render demandé sur la même route */
  // On referme le test de re-rendu forcé.
  }

  // On vérifie qu'une fonction de nettoyage existe avant de l'appeler.
  if (typeof cleanupFn === "function") {
    // On tente d'exécuter le nettoyage de la vue précédente.
    try {
      // On appelle la fonction de nettoyage mémorisée.
      cleanupFn();
    // On intercepte les erreurs éventuelles du nettoyage.
    } catch (err) {
      // On signale l'erreur sans interrompre la navigation.
      console.warn(err);
    // On referme le bloc catch.
    }
    // On réinitialise la fonction de nettoyage.
    cleanupFn = null;
  // On referme le test de présence du nettoyage.
  }

  // On récupère le conteneur racine où sont injectées les vues.
  const content = document.getElementById("view-root");

  // État du document (lecteur immersif)
  // On active la classe « reader-open » si la route est un lecteur.
  document.documentElement.classList.toggle("reader-open", Boolean(route.reader));
  // On bloque le défilement global en mode lecteur, sinon on le rétablit.
  document.documentElement.style.overflow = route.reader ? "hidden" : "";
  // Hors lecteur, on remet la position de défilement du corps à zéro.
  if (!route.reader) document.body.scrollTop = 0;

  // On met en surbrillance l'entrée de navigation correspondante.
  setNavActive(route.nav);
  // On récupère l'élément de titre de la barre supérieure.
  const titleEl = document.getElementById("topbar-title");
  // On met à jour ce titre avec celui de la route, s'il existe.
  if (titleEl) titleEl.textContent = route.title;

  // On notifie l'écouteur externe avec la route et ses paramètres.
  if (typeof onRouteChange === "function") onRouteChange(route, params);
  // On mémorise le chemin courant pour les prochains rendus.
  window.__lastPath = path;

  // On remet le conteneur de vue en haut de son défilement.
  content.scrollTop = 0;

  // On appelle la vue de la route et on récupère son éventuel résultat.
  const result = route.view({ params, path, viewRoot: content });
  // Si la vue expose une fonction de nettoyage, on la mémorise.
  if (result && typeof result.cleanup === "function") cleanupFn = result.cleanup;
// On referme la fonction runRoute.
}

// On déclare la fonction qui met en surbrillance l'entrée de navigation active.
function setNavActive(navKey) {
  // On parcourt tous les éléments portant l'attribut data-nav.
  document.querySelectorAll("[data-nav]").forEach((el) => {
    // On active l'élément dont la clé de navigation correspond.
    el.classList.toggle("active", el.dataset.nav === navKey);
  // On referme la fonction de parcours.
  });
// On referme la fonction setNavActive.
}

// On déclare la fonction qui démarre l'écoute des changements de route.
export function startRouting() {
  // On relance le rendu à chaque modification du hash de l'URL.
  window.addEventListener("hashchange", () => runRoute());
  // On exécute une première fois la route correspondant à l'URL actuelle.
  runRoute();
// On referme la fonction startRouting.
}

// On déclare la fonction qui demande un re-rendu forcé de la route courante.
export function requestRender() {
  // On appelle runRoute en forçant le rendu même si le chemin est identique.
  runRoute(true);
// On referme la fonction requestRender.
}
