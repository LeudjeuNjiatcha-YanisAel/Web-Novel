"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Persistance JSON locale (favoris, historique, progression, bibliothèque
 * d'EPUB, état des extensions). Écritures atomiques + debounce.
 */

const DATA_DIR = process.env.NOVELHUB_DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULTS = {
  favorites: [],
  history: [],
  progress: {},
  library: [],
  extensions: {},
  stats: { exports: 0, chaptersRead: 0 },
};

let state = null;
let saveTimer = null;

function _load() {
  if (state) return state;
  state = { ...DEFAULTS };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      state = { ...DEFAULTS, ...parsed };
    } catch (err) {
      console.error("[db] fichier illisible, réinitialisation :", err.message);
    }
  }
  return state;
}

function _persist() {
  try {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error("[db] écriture impossible :", err.message);
  }
}

function _scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(_persist, 60);
}

function get(key) {
  const s = _load();
  return key ? s[key] : s;
}

function set(key, value) {
  const s = _load();
  s[key] = value;
  _scheduleSave();
  return value;
}

function update(key, fn) {
  const s = _load();
  s[key] = fn(s[key]);
  _scheduleSave();
  return s[key];
}

function flush() {
  clearTimeout(saveTimer);
  if (state) _persist();
}

function reset() {
  state = JSON.parse(JSON.stringify(DEFAULTS));
  _persist();
}

module.exports = { get, set, update, flush, reset, DB_FILE, DEFAULTS };
