"use strict";

const { hashString } = require("./utils");

/**
 * Génération de couvertures procédurales (SVG encodé en data-URI).
 * Aucune ressource externe : déterministe, colorée, lisible — elle sert de
 * couverture par défaut quand une source ne fournit pas d'image.
 */

const PALETTES = [
  { bg: ["#1b1b3a", "#3b1b63"], glow: "#a78bfa", ink: "#f5f3ff" },
  { bg: ["#0b3b3e", "#065a60"], glow: "#5eead4", ink: "#ecfeff" },
  { bg: ["#3b0d18", "#7f1d3b"], glow: "#fda4af", ink: "#fff1f2" },
  { bg: ["#10261a", "#14532d"], glow: "#86efac", ink: "#f0fdf4" },
  { bg: ["#2d1b0a", "#7c3a12"], glow: "#fcd34d", ink: "#fffbeb" },
  { bg: ["#0c1a2e", "#1e3a5f"], glow: "#93c5fd", ink: "#eff6ff" },
  { bg: ["#2a0f2e", "#6b1d63"], glow: "#f0abfc", ink: "#fdf4ff" },
  { bg: ["#111827", "#1f2937"], glow: "#67e8f9", ink: "#f9fafb" },
  { bg: ["#2b0f14", "#5c1a1a"], glow: "#fca5a5", ink: "#fef2f2" },
];

const PATTERNS = ["arcs", "dots", "rays", "waves"];

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function patternMarkup(kind, glow, seed) {
  const r = (n) => (hashString(String(seed) + ":" + n) % 100) / 100;
  if (kind === "dots") {
    let out = "";
    for (let i = 0; i < 40; i++) {
      const cx = Math.round(r(i) * 400);
      const cy = Math.round(r(i + 100) * 600);
      const rad = 1 + r(i + 200) * 3;
      out += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${glow}" opacity="${(0.06 + r(i + 300) * 0.18).toFixed(2)}"/>`;
    }
    return out;
  }
  if (kind === "rays") {
    let out = "";
    for (let i = 0; i < 7; i++) {
      const x = Math.round(r(i) * 460) - 30;
      out += `<path d="M${x} 0 L${x + 90} 0 L${x - 60} 600 L${x - 150} 600 Z" fill="${glow}" opacity="0.05"/>`;
    }
    return out;
  }
  if (kind === "waves") {
    let out = "";
    for (let i = 0; i < 5; i++) {
      const y = 120 + i * 100;
      out += `<path d="M0 ${y} C 100 ${y - 40}, 300 ${y + 40}, 400 ${y - 20}" stroke="${glow}" stroke-width="1.5" fill="none" opacity="0.12"/>`;
    }
    return out;
  }
  // arcs
  let out = "";
  for (let i = 0; i < 4; i++) {
    const r0 = 80 + i * 70;
    out += `<circle cx="330" cy="150" r="${r0}" stroke="${glow}" stroke-width="1.2" fill="none" opacity="${(0.16 - i * 0.03).toFixed(2)}"/>`;
  }
  return out;
}

/**
 * @param {{id: string, title: string, author?: string, genre?: string}} novel
 * @returns {string} data-URI SVG
 */
function coverFor(novel) {
  const id = novel.id || novel.title || "x";
  const seed = hashString(id);
  const pal = PALETTES[seed % PALETTES.length];
  const pattern = PATTERNS[(seed >> 3) % PATTERNS.length];
  const title = escapeXml(novel.title || "Sans titre");
  const author = escapeXml(novel.author || "");
  const genre = escapeXml((novel.genre || "").toUpperCase());
  const initial = escapeXml((novel.title || "?").trim().charAt(0).toUpperCase());

  const lines = wrap(novel.title || "Sans titre", 15).slice(0, 5);
  const lineH = 46;
  const startY = 470 - (lines.length - 1) * lineH;

  const titleSvg = lines
    .map(
      (l, i) =>
        `<text x="34" y="${startY + i * lineH}" font-family="Georgia, 'Times New Roman', serif" font-size="${lines.length > 3 ? 36 : 42}" font-weight="700" fill="${pal.ink}">${escapeXml(l)}</text>`
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${pal.bg[0]}"/>
      <stop offset="100%" stop-color="${pal.bg[1]}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.15" r="0.8">
      <stop offset="0%" stop-color="${pal.glow}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${pal.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.65"/>
    </linearGradient>
  </defs>
  <rect width="400" height="600" fill="url(#g)"/>
  <rect width="400" height="600" fill="url(#glow)"/>
  <g>${patternMarkup(pattern, pal.glow, id)}</g>
  <rect width="400" height="600" fill="url(#shade)"/>
  <rect x="16" y="16" width="368" height="568" fill="none" stroke="${pal.glow}" stroke-opacity="0.35" stroke-width="1.5" rx="4"/>
  <text x="34" y="70" font-family="'Courier New', monospace" font-size="14" letter-spacing="4" fill="${pal.glow}" opacity="0.9">${genre || "ROMAN"}</text>
  <text x="34" y="132" font-family="Georgia, serif" font-size="72" font-weight="700" fill="${pal.ink}" opacity="0.14">${initial}</text>
  ${titleSvg}
  <line x1="34" y1="${startY + lines.length * lineH + 4}" x2="140" y2="${startY + lines.length * lineH + 4}" stroke="${pal.glow}" stroke-width="2"/>
  <text x="34" y="556" font-family="'Helvetica Neue', Arial, sans-serif" font-size="17" fill="${pal.ink}" opacity="0.75">${author}</text>
</svg>`;

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

module.exports = { coverFor };
