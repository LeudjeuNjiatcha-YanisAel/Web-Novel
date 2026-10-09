// OptiManga — état local (préférences) + état serveur (favoris, historique, progression)

import { api } from "./api.js";

const PREFS_KEY = "optimanga:prefs";

export const defaults = {
  theme: "dark",
  reader: {
    mode: "paged", // paged | strip
    quality: "full", // full | dataSaver
    contrast: "dark", // dark | light | sepia
  },
};

export let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const oldRaw = raw ? null : (localStorage.getItem("mangahub:prefs") || localStorage.getItem("novelhub:prefs"));
    const parsed = JSON.parse(raw || oldRaw || "{}");
    return {
      theme: parsed.theme || defaults.theme,
      reader: { ...defaults.reader, ...(parsed.reader || {}) },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* stockage indisponible */
  }
}

export function getPrefs() {
  return prefs;
}

// ---- État serveur ---------------------------------------------------------

export const serverState = {
  favorites: [],
  history: [],
  progress: {},
  _loaded: false,
};

let syncTimer = null;

export async function loadServerState() {
  try {
    const data = await api.getState();
    serverState.favorites = (data.favorites || []).map(normalizeFavorite);
    serverState.history = (data.history || []).map(normalizeHistory);
    serverState.progress = data.progress || {};
  } catch (err) {
    console.warn("[state] chargement impossible", err);
  }
  serverState._loaded = true;
  return serverState;
}

export function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    api
      .putState({
        favorites: serverState.favorites,
        history: serverState.history,
        progress: serverState.progress,
      })
      .catch((err) => console.warn("[state] synchronisation impossible", err));
  }, 350);
}

export async function resetServerState() {
  await api.resetState();
  serverState.favorites = [];
  serverState.history = [];
  serverState.progress = {};
  scheduleSync();
}

// Compatibilité avec les entrées sauvegardées au format "novel".
function normalizeFavorite(f) {
  if (f.mangaId) return f;
  return { ...f, mangaId: f.novelId, novelId: undefined };
}

function normalizeHistory(h) {
  const out = { ...h };
  if (!out.mangaId && out.novelId) out.mangaId = out.novelId;
  if (!out.mangaTitle && out.novelTitle) out.mangaTitle = out.novelTitle;
  return out;
}

// ---- Favoris --------------------------------------------------------------

function favKey(sourceId, mangaId) {
  return `${sourceId}:${mangaId}`;
}

export function isFavorite(sourceId, mangaId) {
  return serverState.favorites.some((f) => f.sourceId === sourceId && f.mangaId === mangaId);
}

export function toggleFavorite(manga) {
  const key = favKey(manga.sourceId, manga.id);
  const existing = serverState.favorites.find(
    (f) => f.sourceId === manga.sourceId && f.mangaId === manga.id
  );
  if (existing) {
    serverState.favorites = serverState.favorites.filter((f) => favKey(f.sourceId, f.mangaId) !== key);
    scheduleSync();
    return { added: false };
  }
  serverState.favorites.unshift({
    sourceId: manga.sourceId,
    sourceName: manga.sourceName,
    mangaId: manga.id,
    title: manga.title,
    author: manga.author,
    cover: manga.cover,
    genre: manga.genre,
    rating: manga.rating,
    status: manga.status,
    chapterCount: manga.chapterCount,
    addedAt: new Date().toISOString(),
  });
  scheduleSync();
  return { added: true };
}

// ---- Historique -----------------------------------------------------------

export function pushHistory(entry) {
  const existingIndex = serverState.history.findIndex(
    (h) => h.sourceId === entry.sourceId && h.mangaId === entry.mangaId
  );
  if (existingIndex >= 0) serverState.history.splice(existingIndex, 1);
  serverState.history.unshift({
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
    mangaId: entry.mangaId,
    mangaTitle: entry.mangaTitle,
    cover: entry.cover,
    author: entry.author,
    chapterId: entry.chapterId,
    chapterTitle: entry.chapterTitle,
    order: entry.order,
    at: new Date().toISOString(),
  });
  serverState.history = serverState.history.slice(0, 50);
  scheduleSync();
}

export function clearHistory() {
  serverState.history = [];
  scheduleSync();
}

// ---- Progression ----------------------------------------------------------

function progressKey(sourceId, mangaId) {
  return `${sourceId}:${mangaId}`;
}

export function getProgress(sourceId, mangaId) {
  return serverState.progress[progressKey(sourceId, mangaId)] || null;
}

export function isChapterRead(sourceId, mangaId, chapterId) {
  const entry = getProgress(sourceId, mangaId);
  return entry ? (entry.read || []).includes(chapterId) : false;
}

export function markChapterRead(sourceId, mangaId, chapterId) {
  const key = progressKey(sourceId, mangaId);
  const entry = serverState.progress[key] || { read: [], last: null, updatedAt: null };
  if (!entry.read.includes(chapterId)) {
    entry.read = [...entry.read, chapterId];
  }
  entry.updatedAt = new Date().toISOString();
  serverState.progress[key] = entry;
  scheduleSync();
}

/** Sangler une position de lecture : page (paged) ou ratio 0-1 (strip). */
export function saveReadingPosition(sourceId, mangaId, { chapterId, chapterTitle, order, page = 1, ratio = 0 }) {
  const key = progressKey(sourceId, mangaId);
  const entry = serverState.progress[key] || { read: [], last: null, updatedAt: null };
  entry.last = {
    chapterId,
    chapterTitle,
    order,
    page: Math.max(1, Math.floor(page || 1)),
    ratio: Math.min(1, Math.max(0, ratio)),
    at: new Date().toISOString(),
  };
  entry.updatedAt = new Date().toISOString();
  serverState.progress[key] = entry;
  scheduleSync();
}

export function readRatio(sourceId, mangaId, totalChapters) {
  const entry = getProgress(sourceId, mangaId);
  if (!entry || !totalChapters) return 0;
  return Math.min(1, (entry.read || []).length / totalChapters);
}