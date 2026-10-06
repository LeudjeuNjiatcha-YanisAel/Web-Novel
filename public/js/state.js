// NovelHub — état local (préférences) + état serveur (favoris, historique, progression)

import { api } from "./api.js";

const PREFS_KEY = "novelhub:prefs";

export const defaults = {
  theme: "dark",
  reader: {
    size: 1.02,
    family: "sans",
    height: 1.9,
    width: "medium", // narrow | medium | wide
    contrast: "dark", // dark | light | sepia
  },
};

export let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
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
    serverState.favorites = data.favorites || [];
    serverState.history = data.history || [];
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

// ---- Favoris --------------------------------------------------------------

function favKey(sourceId, novelId) {
  return `${sourceId}:${novelId}`;
}

export function isFavorite(sourceId, novelId) {
  return serverState.favorites.some((f) => f.sourceId === sourceId && f.novelId === novelId);
}

export function toggleFavorite(novel) {
  const key = favKey(novel.sourceId, novel.id);
  const existing = serverState.favorites.find(
    (f) => f.sourceId === novel.sourceId && f.novelId === novel.id
  );
  if (existing) {
    serverState.favorites = serverState.favorites.filter((f) => favKey(f.sourceId, f.novelId) !== key);
    scheduleSync();
    return { added: false };
  }
  serverState.favorites.unshift({
    sourceId: novel.sourceId,
    sourceName: novel.sourceName,
    novelId: novel.id,
    title: novel.title,
    author: novel.author,
    cover: novel.cover,
    genre: novel.genre,
    rating: novel.rating,
    status: novel.status,
    chapterCount: novel.chapterCount,
    addedAt: new Date().toISOString(),
  });
  scheduleSync();
  return { added: true };
}

// ---- Historique -----------------------------------------------------------

export function pushHistory(entry) {
  const existingIndex = serverState.history.findIndex(
    (h) => h.sourceId === entry.sourceId && h.novelId === entry.novelId
  );
  if (existingIndex >= 0) serverState.history.splice(existingIndex, 1);
  serverState.history.unshift({
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
    novelId: entry.novelId,
    novelTitle: entry.novelTitle,
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

function progressKey(sourceId, novelId) {
  return `${sourceId}:${novelId}`;
}

export function getProgress(sourceId, novelId) {
  return serverState.progress[progressKey(sourceId, novelId)] || null;
}

export function isChapterRead(sourceId, novelId, chapterId) {
  const entry = getProgress(sourceId, novelId);
  return entry ? (entry.read || []).includes(chapterId) : false;
}

export function markChapterRead(sourceId, novelId, chapterId, words = 0) {
  const key = progressKey(sourceId, novelId);
  const entry = serverState.progress[key] || { read: [], words: 0, last: null, updatedAt: null };
  if (!entry.read.includes(chapterId)) {
    entry.read = [...entry.read, chapterId];
    entry.words = (entry.words || 0) + (words || 0);
  }
  entry.updatedAt = new Date().toISOString();
  serverState.progress[key] = entry;
  scheduleSync();
}

export function saveReadingPosition(sourceId, novelId, { chapterId, chapterTitle, order, scroll = 0 }) {
  const key = progressKey(sourceId, novelId);
  const entry = serverState.progress[key] || { read: [], words: 0, last: null, updatedAt: null };
  entry.last = {
    chapterId,
    chapterTitle,
    order,
    scroll: Math.min(100, Math.max(0, scroll)),
    at: new Date().toISOString(),
  };
  entry.updatedAt = new Date().toISOString();
  serverState.progress[key] = entry;
  scheduleSync();
}

export function readRatio(sourceId, novelId, totalChapters) {
  const entry = getProgress(sourceId, novelId);
  if (!entry || !totalChapters) return 0;
  return Math.min(1, (entry.read || []).length / totalChapters);
}