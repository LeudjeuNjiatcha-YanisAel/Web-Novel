// OptiManga — couche réseau

// On déclare une classe d'erreur personnalisée qui hérite de la classe Error.
export class ApiError extends Error {
  // On définit le constructeur de l'erreur avec le message et le statut HTTP.
  constructor(message, status) {
    // On appelle le constructeur parent pour initialiser le message.
    super(message);
    // On donne un nom explicite à l'erreur pour le débogage.
    this.name = "ApiError";
    // On conserve le code de statut HTTP dans une propriété de l'instance.
    this.status = status;
  // On referme le constructeur.
  }
// On referme la classe ApiError.
}

// On déclare la fonction utilitaire qui exécute les requêtes réseau.
async function request(url, options = {}) {
  // On envoie la requête HTTP et on attend la réponse.
  const res = await fetch(url, {
    // On définit les en-têtes en fusionnant le type JSON et ceux fournis.
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    // On ajoute ou on écrase avec les autres options fournies.
    ...options,
  // On referme la configuration passée à fetch.
  });

  // On prépare une variable qui accueillera les données JSON.
  let data = null;
  // On lit le corps de la réponse sous forme de texte brut.
  const text = await res.text();
  // On traite le corps uniquement s'il n'est pas vide.
  if (text) {
    // On tente de convertir le texte reçu en objet JSON.
    try {
      // On analyse le JSON et on stocke le résultat dans data.
      data = JSON.parse(text);
    // On intercepte une éventuelle erreur de conversion JSON.
    } catch {
      // En cas d'échec, on laisse les données à null.
      data = null;
    // On referme le bloc catch.
    }
  // On referme le test de présence du texte.
  }

  // On vérifie si la réponse HTTP signale une erreur.
  if (!res.ok) {
    // On lève une ApiError avec le message du serveur ou un message par défaut.
    throw new ApiError(data?.error || `Erreur ${res.status}`, res.status);
  // On referme le test d'erreur HTTP.
  }
  // On renvoie les données analysées à l'appelant.
  return data;
// On referme la fonction request.
}

// On déclare la fonction qui construit une chaîne de paramètres d'URL.
function qs(params) {
  // On transforme les paramètres en tableau de paires clé/valeur.
  const parts = Object.entries(params || {})
    // On retire les valeurs indéfinies, nulles ou vides.
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    // On encode chaque paire au format clé=valeur.
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  // On assemble la chaîne finale précédée de « ? », ou une chaîne vide.
  return parts.length ? "?" + parts.join("&") : "";
// On referme la fonction qs.
}

// On expose un objet regroupant tous les appels à l'API.
export const api = {
  // On interroge le point de contrôle de santé du serveur.
  health: () => request("/api/health"),

  // On lance une recherche avec les paramètres fournis.
  search: (params) => request("/api/search" + qs(params)),
  // On récupère la liste des genres disponibles.
  genres: () => request("/api/genres"),
  // On récupère les statistiques globales.
  stats: () => request("/api/stats"),

  // On récupère la liste des extensions installées.
  extensions: () => request("/api/extensions"),
  // On active ou désactive une extension à partir de son identifiant.
  toggleExtension: (id, enabled) =>
    // On envoie une requête PATCH avec le nouvel état d'activation.
    request(`/api/extensions/${id}`, {
      // On précise la méthode HTTP à utiliser.
      method: "PATCH",
      // On envoie l'état d'activation sérialisé en JSON.
      body: JSON.stringify({ enabled }),
    // On referme les options de la requête PATCH.
    }),

  // On récupère la fiche d'un manga selon sa source et son identifiant.
  manga: (sourceId, mangaId) => request(`/api/sources/${sourceId}/mangas/${mangaId}`),
  // On récupère un chapitre précis d'un manga.
  chapter: (sourceId, mangaId, chapterId) =>
    // On construit l'URL du chapitre et on lance la requête.
    request(`/api/sources/${sourceId}/mangas/${mangaId}/chapters/${chapterId}`),

  // On demande la création d'un téléchargement CBZ sur une plage de chapitres.
  downloadCbz: (sourceId, mangaId, from, to) =>
    // On envoie une requête POST avec les bornes de chapitres.
    request(`/api/sources/${sourceId}/mangas/${mangaId}/download`, {
      // On précise la méthode HTTP POST.
      method: "POST",
      // On envoie les chapitres de début et de fin en JSON.
      body: JSON.stringify({ from, to }),
    // On referme les options de la requête de téléchargement.
    }),
  // On suit l'état d'avancement d'une tâche via son identifiant.
  job: (jobId) => request(`/api/jobs/${jobId}`),

  // On récupère le contenu de la bibliothèque CBZ.
  library: () => request("/api/library"),
  // On supprime une entrée de la bibliothèque par son identifiant.
  deleteLibraryEntry: (id) =>
    // On envoie une requête DELETE sur l'entrée visée.
    request(`/api/library/${id}`, { method: "DELETE" }),

  // On récupère l'état serveur (favoris, historique, progression).
  getState: () => request("/api/state"),
  // On envoie une mise à jour partielle de l'état serveur.
  putState: (patch) =>
    // On envoie une requête PUT avec le correctif sérialisé en JSON.
    request("/api/state", { method: "PUT", body: JSON.stringify(patch) }),
  // On réinitialise complètement l'état serveur.
  resetState: () => request("/api/state", { method: "DELETE" }),
// On referme l'objet api.
};
