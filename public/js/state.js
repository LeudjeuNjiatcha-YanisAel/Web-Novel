// OptiManga — état local (préférences) + état serveur (favoris, historique, progression)

// On importe l'objet api pour dialoguer avec le serveur.
import { api } from "./api.js";

// On définit la clé utilisée pour stocker les préférences dans le navigateur.
const PREFS_KEY = "optimanga:prefs";

// On exporte les valeurs par défaut des préférences.
export const defaults = {
  // Le thème par défaut est sombre.
  theme: "dark",
  // On regroupe les préférences liées au lecteur.
  reader: {
    // Mode d'affichage par défaut : page par page (paged | strip).
    mode: "paged", // paged | strip
    // Qualité d'image par défaut (full | dataSaver).
    quality: "full", // full | dataSaver
    // Contraste par défaut (dark | light | sepia).
    contrast: "dark", // dark | light | sepia
  // On referme l'objet des préférences du lecteur.
  },
// On referme l'objet des valeurs par défaut.
};

// On charge les préférences au démarrage et on les exporte.
export let prefs = loadPrefs();

// On déclare la fonction qui lit et normalise les préférences sauvegardées.
function loadPrefs() {
  // On protège la lecture du stockage local contre les erreurs.
  try {
    // On lit la valeur brute liée à la clé des préférences.
    const raw = localStorage.getItem(PREFS_KEY);
    // Si absente, on cherche une ancienne clé pour assurer la migration.
    const oldRaw = raw ? null : (localStorage.getItem("mangahub:prefs") || localStorage.getItem("novelhub:prefs"));
    // On analyse le JSON obtenu, ou un objet vide par défaut.
    const parsed = JSON.parse(raw || oldRaw || "{}");
    // On renvoie des préférences complètes en complétant les valeurs manquantes.
    return {
      // On reprend le thème sauvegardé ou la valeur par défaut.
      theme: parsed.theme || defaults.theme,
      // On fusionne les préférences du lecteur avec les valeurs par défaut.
      reader: { ...defaults.reader, ...(parsed.reader || {}) },
    // On referme l'objet renvoyé.
    };
  // On intercepte une éventuelle erreur de lecture ou de parsing.
  } catch {
    // On renvoie une copie profonde des valeurs par défaut.
    return structuredClone(defaults);
  // On referme le bloc de capture d'erreur.
  }
// On referme la fonction loadPrefs.
}

// On déclare la fonction qui sauvegarde les préférences dans le navigateur.
export function savePrefs() {
  // On protège l'écriture dans le stockage local contre les erreurs.
  try {
    // On sérialise et enregistre les préférences sous la clé dédiée.
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  // On intercepte le cas où le stockage est indisponible.
  } catch {
    /* stockage indisponible */
  // On referme le bloc de capture d'erreur.
  }
// On referme la fonction savePrefs.
}

// On déclare la fonction qui donne accès aux préférences courantes.
export function getPrefs() {
  // On renvoie l'objet de préférences courant.
  return prefs;
// On referme la fonction getPrefs.
}

// ---- État serveur ---------------------------------------------------------

// On exporte l'objet qui contient l'état synchronisé avec le serveur.
export const serverState = {
  // La liste des favoris, initialement vide.
  favorites: [],
  // La liste de l'historique, initialement vide.
  history: [],
  // Le dictionnaire des progressions de lecture, initialement vide.
  progress: {},
  // Un indicateur précisant si l'état a déjà été chargé.
  _loaded: false,
// On referme l'objet serverState.
};

// On prépare un identifiant de minuteur pour différer la synchronisation.
let syncTimer = null;

// On déclare la fonction asynchrone qui charge l'état depuis le serveur.
export async function loadServerState() {
  // On protège l'appel réseau contre les erreurs.
  try {
    // On récupère l'état serveur via l'API.
    const data = await api.getState();
    // On remplit les favoris normalisés à partir des données reçues.
    serverState.favorites = (data.favorites || []).map(normalizeFavorite);
    // On remplit l'historique normalisé à partir des données reçues.
    serverState.history = (data.history || []).map(normalizeHistory);
    // On reprend la progression fournie, ou un objet vide.
    serverState.progress = data.progress || {};
  // On intercepte une éventuelle erreur de chargement.
  } catch (err) {
    // On signale l'échec dans la console sans bloquer l'application.
    console.warn("[state] chargement impossible", err);
  // On referme le bloc de capture d'erreur.
  }
  // On marque l'état comme chargé.
  serverState._loaded = true;
  // On renvoie l'état serveur mis à jour.
  return serverState;
// On referme la fonction loadServerState.
}

// On déclare la fonction qui planifie une synchronisation différée.
export function scheduleSync() {
  // On annule un éventuel minuteur précédent pour regrouper les envois.
  clearTimeout(syncTimer);
  // On programme l'envoi après un court délai d'inactivité.
  syncTimer = setTimeout(() => {
    // On prépare l'appel de mise à jour de l'état serveur.
    api
      // On envoie les favoris, l'historique et la progression.
      .putState({
        // On transmet la liste courante des favoris.
        favorites: serverState.favorites,
        // On transmet la liste courante de l'historique.
        history: serverState.history,
        // On transmet la progression courante.
        progress: serverState.progress,
      // On referme l'objet envoyé.
      })
      // En cas d'échec, on journalise un avertissement.
      .catch((err) => console.warn("[state] synchronisation impossible", err));
  // On fixe le délai de regroupement à 350 millisecondes.
  }, 350);
// On referme la fonction scheduleSync.
}

// On déclare la fonction asynchrone qui réinitialise l'état serveur.
export async function resetServerState() {
  // On demande au serveur de réinitialiser son état.
  await api.resetState();
  // On vide localement la liste des favoris.
  serverState.favorites = [];
  // On vide localement la liste de l'historique.
  serverState.history = [];
  // On vide localement la progression.
  serverState.progress = {};
  // On planifie la synchronisation de cet état vidé.
  scheduleSync();
// On referme la fonction resetServerState.
}

// Compatibilité avec les entrées sauvegardées au format "novel".
// On déclare la fonction qui convertit un favori en format « manga ».
function normalizeFavorite(f) {
  // Si l'entrée possède déjà un mangaId, on la renvoie telle quelle.
  if (f.mangaId) return f;
  // Sinon on recopie l'entrée en renommant novelId en mangaId.
  return { ...f, mangaId: f.novelId, novelId: undefined };
// On referme la fonction normalizeFavorite.
}

// On déclare la fonction qui convertit une entrée d'historique.
function normalizeHistory(h) {
  // On crée une copie de l'entrée reçue.
  const out = { ...h };
  // Si mangaId manque mais novelId existe, on recopie l'identifiant.
  if (!out.mangaId && out.novelId) out.mangaId = out.novelId;
  // Si mangaTitle manque mais novelTitle existe, on recopie le titre.
  if (!out.mangaTitle && out.novelTitle) out.mangaTitle = out.novelTitle;
  // On renvoie l'entrée normalisée.
  return out;
// On referme la fonction normalizeHistory.
}

// ---- Favoris --------------------------------------------------------------

// On déclare la fonction qui construit la clé unique d'un favori.
function favKey(sourceId, mangaId) {
  // On concatène la source et l'identifiant du manga.
  return `${sourceId}:${mangaId}`;
// On referme la fonction favKey.
}

// On déclare la fonction qui teste si un manga est dans les favoris.
export function isFavorite(sourceId, mangaId) {
  // On vérifie si un favori correspond à cette source et ce manga.
  return serverState.favorites.some((f) => f.sourceId === sourceId && f.mangaId === mangaId);
// On referme la fonction isFavorite.
}

// On déclare la fonction qui ajoute ou retire un manga des favoris.
export function toggleFavorite(manga) {
  // On calcule la clé unique du manga visé.
  const key = favKey(manga.sourceId, manga.id);
  // On cherche si ce manga figure déjà dans les favoris.
  const existing = serverState.favorites.find(
    // On compare la source et l'identifiant du manga.
    (f) => f.sourceId === manga.sourceId && f.mangaId === manga.id
  // On referme la recherche du favori existant.
  );
  // On traite le cas où le manga est déjà favori.
  if (existing) {
    // On retire ce favori de la liste.
    serverState.favorites = serverState.favorites.filter((f) => favKey(f.sourceId, f.mangaId) !== key);
    // On planifie la synchronisation de la suppression.
    scheduleSync();
    // On indique que le manga a été retiré.
    return { added: false };
  // On referme le cas du favori existant.
  }
  // On ajoute le nouveau favori en tête de liste.
  serverState.favorites.unshift({
    // On enregistre la source du manga.
    sourceId: manga.sourceId,
    // On enregistre le nom de la source.
    sourceName: manga.sourceName,
    // On enregistre l'identifiant du manga.
    mangaId: manga.id,
    // On enregistre le titre du manga.
    title: manga.title,
    // On enregistre l'auteur du manga.
    author: manga.author,
    // On enregistre l'URL de couverture.
    cover: manga.cover,
    // On enregistre le genre du manga.
    genre: manga.genre,
    // On enregistre la note du manga.
    rating: manga.rating,
    // On enregistre le statut de publication.
    status: manga.status,
    // On enregistre le nombre de chapitres.
    chapterCount: manga.chapterCount,
    // On enregistre l'horodatage d'ajout.
    addedAt: new Date().toISOString(),
  // On referme l'objet du nouveau favori.
  });
  // On planifie la synchronisation de l'ajout.
  scheduleSync();
  // On indique que le manga a été ajouté.
  return { added: true };
// On referme la fonction toggleFavorite.
}

// ---- Historique -----------------------------------------------------------

// On déclare la fonction qui ajoute une entrée en tête de l'historique.
export function pushHistory(entry) {
  // On cherche la position d'une entrée déjà existante pour ce manga.
  const existingIndex = serverState.history.findIndex(
    // On compare la source et l'identifiant du manga.
    (h) => h.sourceId === entry.sourceId && h.mangaId === entry.mangaId
  // On referme la recherche de l'entrée existante.
  );
  // Si une entrée existe déjà, on la retire pour la remettre en tête.
  if (existingIndex >= 0) serverState.history.splice(existingIndex, 1);
  // On insère la nouvelle entrée en tête de la liste.
  serverState.history.unshift({
    // On enregistre la source de l'entrée.
    sourceId: entry.sourceId,
    // On enregistre le nom de la source.
    sourceName: entry.sourceName,
    // On enregistre l'identifiant du manga.
    mangaId: entry.mangaId,
    // On enregistre le titre du manga.
    mangaTitle: entry.mangaTitle,
    // On enregistre l'URL de couverture.
    cover: entry.cover,
    // On enregistre l'auteur.
    author: entry.author,
    // On enregistre l'identifiant du chapitre.
    chapterId: entry.chapterId,
    // On enregistre le titre du chapitre.
    chapterTitle: entry.chapterTitle,
    // On enregistre l'ordre du chapitre.
    order: entry.order,
    // On enregistre l'horodatage de la consultation.
    at: new Date().toISOString(),
  // On referme l'objet de la nouvelle entrée.
  });
  // On limite l'historique aux 50 entrées les plus récentes.
  serverState.history = serverState.history.slice(0, 50);
  // On planifie la synchronisation de l'historique.
  scheduleSync();
// On referme la fonction pushHistory.
}

// On déclare la fonction qui vide entièrement l'historique.
export function clearHistory() {
  // On remplace l'historique par un tableau vide.
  serverState.history = [];
  // On planifie la synchronisation de ce vidage.
  scheduleSync();
// On referme la fonction clearHistory.
}

// ---- Progression ----------------------------------------------------------

// On déclare la fonction qui construit la clé de progression d'un manga.
function progressKey(sourceId, mangaId) {
  // On concatène la source et l'identifiant du manga.
  return `${sourceId}:${mangaId}`;
// On referme la fonction progressKey.
}

// On déclare la fonction qui récupère la progression d'un manga.
export function getProgress(sourceId, mangaId) {
  // On renvoie l'entrée de progression correspondante, ou null.
  return serverState.progress[progressKey(sourceId, mangaId)] || null;
// On referme la fonction getProgress.
}

// On déclare la fonction qui indique si un chapitre a été lu.
export function isChapterRead(sourceId, mangaId, chapterId) {
  // On récupère l'entrée de progression du manga.
  const entry = getProgress(sourceId, mangaId);
  // On vérifie la présence du chapitre dans la liste des chapitres lus.
  return entry ? (entry.read || []).includes(chapterId) : false;
// On referme la fonction isChapterRead.
}

// On déclare la fonction qui marque un chapitre comme lu.
export function markChapterRead(sourceId, mangaId, chapterId) {
  // On calcule la clé de progression du manga.
  const key = progressKey(sourceId, mangaId);
  // On récupère l'entrée existante ou on en crée une nouvelle vide.
  const entry = serverState.progress[key] || { read: [], last: null, updatedAt: null };
  // On vérifie que le chapitre n'est pas déjà marqué comme lu.
  if (!entry.read.includes(chapterId)) {
    // On ajoute le chapitre à la liste des chapitres lus.
    entry.read = [...entry.read, chapterId];
  // On referme le test de chapitre non lu.
  }
  // On met à jour l'horodatage de modification.
  entry.updatedAt = new Date().toISOString();
  // On enregistre l'entrée modifiée dans la progression.
  serverState.progress[key] = entry;
  // On planifie la synchronisation de la progression.
  scheduleSync();
// On referme la fonction markChapterRead.
}

/** Sangler une position de lecture : page (paged) ou ratio 0-1 (strip). */
// On déclare la fonction qui sauvegarde la position de lecture d'un manga.
export function saveReadingPosition(sourceId, mangaId, { chapterId, chapterTitle, order, page = 1, ratio = 0 }) {
  // On calcule la clé de progression du manga.
  const key = progressKey(sourceId, mangaId);
  // On récupère l'entrée existante ou on en crée une nouvelle vide.
  const entry = serverState.progress[key] || { read: [], last: null, updatedAt: null };
  // On mémorise la dernière position de lecture connue.
  entry.last = {
    // On enregistre l'identifiant du chapitre.
    chapterId,
    // On enregistre le titre du chapitre.
    chapterTitle,
    // On enregistre l'ordre du chapitre.
    order,
    // On enregistre la page en la bornant à un entier au moins égal à 1.
    page: Math.max(1, Math.floor(page || 1)),
    // On enregistre le ratio en le bornant entre 0 et 1.
    ratio: Math.min(1, Math.max(0, ratio)),
    // On enregistre l'horodatage de la position.
    at: new Date().toISOString(),
  // On referme l'objet de la dernière position.
  };
  // On met à jour l'horodatage de modification de l'entrée.
  entry.updatedAt = new Date().toISOString();
  // On enregistre l'entrée modifiée dans la progression.
  serverState.progress[key] = entry;
  // On planifie la synchronisation de la progression.
  scheduleSync();
// On referme la fonction saveReadingPosition.
}

// On déclare la fonction qui calcule la proportion de chapitres lus.
export function readRatio(sourceId, mangaId, totalChapters) {
  // On récupère l'entrée de progression du manga.
  const entry = getProgress(sourceId, mangaId);
  // Sans entrée ou sans total de chapitres, le ratio vaut zéro.
  if (!entry || !totalChapters) return 0;
  // On calcule le rapport des chapitres lus, borné à 1.
  return Math.min(1, (entry.read || []).length / totalChapters);
// On referme la fonction readRatio.
}
