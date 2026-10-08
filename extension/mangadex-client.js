"use strict";

const { httpError } = require("./utils");

/**
 * Client minimal de l'API publique MangaDex (api.mangadex.org).
 * - throttle global (~5 requêtes / seconde)
 * - retry sur 429 / 5xx et timeouts
 * - helpers de mapping (titre, couverture, relations…)
 */

const API = "https://api.mangadex.org";
const COVER_CDN = "https://uploads.mangadex.org/covers";
const UA = "MangaHub/2.0 (lecteur auto-hébergé; node-fetch)";

const MIN_INTERVAL = 220;
let lastRequest = 0;
let queue = Promise.resolve();

function throttle(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL - (Date.now() - lastRequest));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return fn();
  });
  queue = run.then(() => {}, () => {});
  return run;
}

async function _fetch(path, { timeout = 20000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(API + path, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`MangaDex HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw httpError(res.status, `MangaDex HTTP ${res.status}${text ? ` : ${text.slice(0, 140)}` : ""}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.status) throw err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw httpError(502, `MangaDex injoignable : ${lastErr.message || "timeout"}`);
}

/** Requête GET JSON (throttlée + retry). */
function get(path) {
  return throttle(() => _fetch(path));
}

// ---- Helpers de mapping ----------------------------------------------------

function coverUrl(mangaId, fileName, size = "256") {
  if (!mangaId || !fileName) return null;
  const suffix = size === "512" ? ".512" : "";
  return `${COVER_CDN}/${mangaId}/${fileName}${suffix}.jpg`;
}

function titleOf(mangaAttrs) {
  const title = (mangaAttrs && mangaAttrs.title) || {};
  return (
    title.fr ||
    title["fr-fr"] ||
    title["fr-ca"] ||
    title.en ||
    title["en-gb"] ||
    title["ja-ro"] ||
    title.ja ||
    Object.values(title)[0] ||
    ""
  );
}

function altTitleOf(mangaAttrs) {
  if (!mangaAttrs || !Array.isArray(mangaAttrs.altTitles)) return null;
  for (const alt of mangaAttrs.altTitles) {
    if (alt && typeof alt === "object") {
      const v = alt.fr || alt["fr-fr"] || alt["fr-ca"] || alt.en || alt["ja-ro"];
      if (v) return v;
    }
  }
  return null;
}

function relationshipOf(relationships, type, attrName = "name") {
  const rel = (relationships || []).find((r) => r.type === type);
  return rel && rel.attributes && attrName in rel.attributes ? rel.attributes[attrName] : null;
}

function tagNames(mangaAttrs, max = 8) {
  const out = [];
  for (const t of (mangaAttrs && mangaAttrs.tags) || []) {
    const name = (t.attributes && t.attributes.name) || {};
    const label = name.fr || name.en;
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

function statusOf(status) {
  const map = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };
  return map[status] || "unknown";
}

function descriptionOf(mangaAttrs) {
  const desc = (mangaAttrs && mangaAttrs.description) || {};
  return (desc.fr || desc["fr-ca"] || desc.en || "") || "";
}

module.exports = {
  get,
  coverUrl,
  titleOf,
  altTitleOf,
  relationshipOf,
  tagNames,
  statusOf,
  descriptionOf,
};