"use strict";

/**
 * Images distantes protégées par hotlink ou jeton de visionnage.
 *
 * Certains CDN (pstatic / WEBTOON) exigent un Referer émis par leur domaine
 * et renvoient un 403 sinon ; d'autres (jumpg-assets3 / Manga Plus) exigent
 * l'en-tête Plus-Vw-Token porté par le MangaViewer de la dernière réponse, et
 * chiffrent les pages en XOR avec une clé par chapitre (pageKey). Un navigateur
 * ne peut falsifier ni l'un ni l'autre : on expose donc une route
 * /api/image?url=…&vwt=…&k=… qui déchiffre et requête côté serveur avec les
 * en-têtes attendus. Les sources passent leurs URLs par proxied() avant de les
 * renvoyer au client ; le serveur (CBZ, proxy) les décode par resolve().
 *
 * MangaDex fait l'inverse (placeholder si Referer présent) : la page porte
 * <meta name="referrer" content="no-referrer">, ses URLs restent directes.
 */

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PROXY_PATH = "/api/image";
const PROXY_PREFIX = `${PROXY_PATH}?url=`;

// Jeton de visionnage Manga Plus (hex court), transmis en query puis en en-tête.
const VWT_PARAM = "vwt";
const VWT_HEADER = "Plus-Vw-Token";
const VWT_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Clé de déchiffrement XOR des pages Manga Plus (hex, transmise en query).
const KEY_PARAM = "k";
const KEY_RE = /^[0-9a-fA-F]{16,256}$/;

// [suffix d'hôte, en-têtes supplémentaires attendus par le CDN]
const HOST_RULES = [
  [".pstatic.net", { referer: "https://www.webtoons.com/" }],
  [".tokyo-cdn.com", {}],
];

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function ruleFor(url) {
  const host = hostnameOf(url);
  if (!host) return null;
  const rule = HOST_RULES.find(([suffix]) => host.endsWith(suffix));
  return rule ? rule[1] : null;
}

function isProxyForm(url) {
  return String(url || "").startsWith(`${PROXY_PATH}?`);
}

/** L'hôte exige-t-il un Referer forgé ou un jeton (donc un passage par le proxy) ? */
function needsProxy(url) {
  return Boolean(ruleFor(url));
}

/** URL à servir au client : proxifiée si le CDN l'exige.
 *  opts.vwt = jeton Manga Plus, opts.k = clé XOR du chapitre. */
function proxied(url, opts) {
  if (!url) return url;
  if (!needsProxy(url)) return url;
  const vwt = opts && opts.vwt && VWT_RE.test(opts.vwt) ? `&${VWT_PARAM}=${encodeURIComponent(opts.vwt)}` : "";
  const k = opts && opts.k && KEY_RE.test(opts.k) ? `&${KEY_PARAM}=${opts.k}` : "";
  return `${PROXY_PREFIX}${encodeURIComponent(url)}${vwt}${k}`;
}

function proxiedAll(urls, opts) {
  return (urls || []).map((url) => proxied(url, opts));
}

/** Décode une URL proxifiée (usage serveur uniquement). */
function resolve(url) {
  const str = String(url || "");
  if (!isProxyForm(str)) return str;
  try {
    return new URLSearchParams(str.slice(str.indexOf("?") + 1)).get("url") || str;
  } catch {
    return str;
  }
}

/** Jeton Plus-Vw-Token éventuellement porté par l'URL proxifiée. */
function vwtOf(url) {
  const str = String(url || "");
  if (!isProxyForm(str)) return null;
  try {
    const vwt = new URLSearchParams(str.slice(str.indexOf("?") + 1)).get(VWT_PARAM);
    return vwt && VWT_RE.test(vwt) ? vwt : null;
  } catch {
    return null;
  }
}

/** Clé de déchiffrement XOR éventuellement portée par l'URL proxifiée. */
function kOf(url) {
  const str = String(url || "");
  if (!isProxyForm(str)) return null;
  try {
    const k = new URLSearchParams(str.slice(str.indexOf("?") + 1)).get(KEY_PARAM);
    return k && KEY_RE.test(k) ? k : null;
  } catch {
    return null;
  }
}

/** Déchiffre une page Manga Plus (XOR avec la clé du chapitre) ; sinon inchangé. */
function decodePage(buf, key) {
  if (!key || !KEY_RE.test(key)) return buf;
  const kb = Buffer.from(key, "hex");
  if (!kb.length) return buf;
  const out = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  for (let i = 0; i < out.length; i++) out[i] ^= kb[i % kb.length];
  return out;
}

/** En-têtes à émettre vers l'hôte d'origine (fetch serveur). */
function headersFor(url) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  const rule = ruleFor(resolve(url));
  if (rule && rule.referer) headers.Referer = rule.referer;
  const vwt = vwtOf(url);
  if (vwt) headers[VWT_HEADER] = vwt;
  return headers;
}

/** La route proxy accepte-t-elle cette URL ? (anti-SSRF : hôte imposé) */
function isProxiable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return Boolean(ruleFor(parsed.toString()));
}

module.exports = {
  USER_AGENT,
  PROXY_PATH,
  proxied,
  proxiedAll,
  resolve,
  vwtOf,
  kOf,
  decodePage,
  headersFor,
  needsProxy,
  isProxiable,
};
