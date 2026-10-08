// MangaHub — routeur hash (#/chemin) et coordination des vues

export function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  return { path, queryParams: params };
}

export function currentPath() {
  return parseHash().path;
}

export function navigate(path) {
  const p = String(path).startsWith("/") ? path : "/" + path;
  if (currentPath() === p) {
    window.scrollTo(0, 0);
    runRoute();
    return;
  }
  location.hash = p;
}

let routes = [];
let routesReady = false;
let cleanupFn = null;

let onRouteChange = null;

export function setRouteListener(fn) {
  onRouteChange = fn;
}

export function registerRoutes(list) {
  routes = list;
  routesReady = true;
}

export function runRoute(forceRender = false) {
  if (!routesReady) return;
  const { path } = parseHash();

  let route = routes.find((r) => r.pattern.test(path));
  if (!route) route = routes.find((r) => r.fallback) || routes[0];

  const match = String(path).match(route.pattern) || [];
  const params = match.slice(1);

  if (forceRender && window.__lastPath === path) {
    /* re-render demandé sur la même route */
  }

  if (typeof cleanupFn === "function") {
    try {
      cleanupFn();
    } catch (err) {
      console.warn(err);
    }
    cleanupFn = null;
  }

  const content = document.getElementById("view-root");

  // État du document (lecteur immersif)
  document.documentElement.classList.toggle("reader-open", Boolean(route.reader));
  document.documentElement.style.overflow = route.reader ? "hidden" : "";
  if (!route.reader) document.body.scrollTop = 0;

  setNavActive(route.nav);
  const titleEl = document.getElementById("topbar-title");
  if (titleEl) titleEl.textContent = route.title;

  if (typeof onRouteChange === "function") onRouteChange(route, params);
  window.__lastPath = path;

  content.scrollTop = 0;

  const result = route.view({ params, path, viewRoot: content });
  if (result && typeof result.cleanup === "function") cleanupFn = result.cleanup;
}

function setNavActive(navKey) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === navKey);
  });
}

export function startRouting() {
  window.addEventListener("hashchange", () => runRoute());
  runRoute();
}

export function requestRender() {
  runRoute(true);
}