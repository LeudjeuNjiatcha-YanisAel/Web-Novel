"use strict";

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const images = require("./images");

/**
 * Export CBZ : télécharge les pages d'un chapitre et les regroupe en archive
 * (zip) compatible avec les lecteurs de mangas (Tachiyomi, Mihon…).
 */

const UA = "OptiManga/2.0 (lecteur auto-hébergé; node-fetch)";

/** Exécute fn sur une liste avec une borne de concurrence. */
async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function fetchImage(url, { timeout = 30000 } = {}) {
  const target = images.resolve(url);
  const headers = images.needsProxy(target) ? images.headersFor(url) : { "User-Agent": UA };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(target, {
      signal: ctrl.signal,
      headers,
    });
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    return images.decodePage(Buffer.from(await res.arrayBuffer()), images.kOf(url));
  } finally {
    clearTimeout(timer);
  }
}

function imageExt(url) {
  const target = images.resolve(url);
  const m = /\.(jpe?g|png|webp|gif|avif)(?:\?|%|$)/i.exec(target || "");
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

/**
 * Télécharge les pages d'un chapitre dans un dossier temporaire.
 * @returns {Promise<{dir: string, files: string[]}>}
 */
async function downloadChapter(chapter, chapterDir, { concurrency = 5 } = {}) {
  const dirs = await _writeChapter(chapterDir, chapter);
  return dirs;
}

async function _writeChapter(chapterDir, chapter) {
  const volume = chapter.volume ? `volume-${chapter.volume}` : "volume-1";
  const chapterLabel = chapter.chapterNum ? `chapitre-${chapter.chapterNum}` : `chapitre-${chapter.order || 1}`;
  const target = path.join(chapterDir, volume, chapterLabel);
  fs.mkdirSync(target, { recursive: true });
  const urls = chapter.pages;
  const files = await mapPool(urls, 5, async (url, i) => {
    const buf = await fetchImage(url);
    const filename = `${String(i + 1).padStart(3, "0")}.${imageExt(url)}`;
    const filePath = path.join(target, filename);
    fs.writeFileSync(filePath, buf);
    return filename;
  });
  return { dir: target, files };
}

/** Construit une archive CBZ (Buffer) depuis un dossier. */
function buildCbz(dir) {
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  return zip.toBuffer();
}

module.exports = { downloadChapter, buildCbz, mapPool };