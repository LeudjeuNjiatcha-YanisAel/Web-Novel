// Active le mode strict de JavaScript.
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

// En-tête User-Agent utilisé pour les requêtes d'images.
const USER_AGENT =
  // Chaîne User-Agent imitant un navigateur Chrome sous Linux.
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Chemin de la route proxy d'images.
const PROXY_PATH = "/api/image";
// Préfixe de query ajouté devant l'URL cible.
const PROXY_PREFIX = `${PROXY_PATH}?url=`;

// Jeton de visionnage Manga Plus (hex court), transmis en query puis en en-tête.
// Nom du paramètre de query transportant le jeton.
const VWT_PARAM = "vwt";
// Nom de l'en-tête HTTP transportant le jeton.
const VWT_HEADER = "Plus-Vw-Token";
// Format autorisé pour le jeton de visionnage.
const VWT_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Clé de déchiffrement XOR des pages Manga Plus (hex, transmise en query).
// Nom du paramètre de query transportant la clé.
const KEY_PARAM = "k";
// Format autorisé pour la clé de déchiffrement.
const KEY_RE = /^[0-9a-fA-F]{16,256}$/;

// [suffix d'hôte, en-têtes supplémentaires attendus par le CDN]
// Table des règles par suffixe de domaine (Referer à forger, etc.).
const HOST_RULES = [
  // Webtoons (pstatic) exige un Referer de son domaine.
  [".pstatic.net", { referer: "https://www.webtoons.com/" }],
  // Tokyo CDN n'exige aucun en-tête supplémentaire.
  [".tokyo-cdn.com", {}],
  // Japscan (divers domaines) exige le Referer de japscan.foo.
  [".japscan.foo", { referer: "https://www.japscan.foo/" }],
  // Variante de domaine Japscan.
  [".japscan.lol", { referer: "https://www.japscan.foo/" }],
  // Variante de domaine Japscan.
  [".japscan.me", { referer: "https://www.japscan.foo/" }],
  // Variante de domaine Japscan.
  [".japscan.cc", { referer: "https://www.japscan.foo/" }],
  // Variante de domaine Japscan.
  [".japscan.ws", { referer: "https://www.japscan.foo/" }],
  // ComicK (meo.comick.pictures) exige le Referer de son site.
  [".comick.pictures", { referer: "https://comick.io/" }],
  // Anime-Sama (couvertures et miniatures) exige le Referer du site.
  [".anime-sama.to", { referer: "https://anime-sama.to/" }],
  [".anime-sama.fr", { referer: "https://anime-sama.to/" }],
  // AniList (s4.anilist.co) : couvertures proxifiées pour éviter les blocages de hotlink.
  [".anilist.co", { referer: "https://anilist.co/" }],
// Fermeture du tableau HOST_RULES.
];

// Extrait le nom d'hôte (en minuscules) d'une URL, ou null si invalide.
function hostnameOf(url) {
  // Tente de parser l'URL pour en lire l'hôte.
  try {
    // Retourne le hostname normalisé en minuscules.
    return new URL(url).hostname.toLowerCase();
  // Si l'URL est invalide.
  } catch {
    // Retourne null pour signaler l'échec.
    return null;
  // Fermeture du bloc try/catch.
  }
// Fermeture de la fonction hostnameOf.
}

// Retourne les en-têtes supplémentaires associés à l'hôte d'une URL.
function ruleFor(url) {
  // Récupère le nom d'hôte de l'URL.
  const host = hostnameOf(url);
  // Sans hôte valide, aucune règle.
  if (!host) return null;
  // Cherche le premier suffixe de domaine correspondant.
  const rule = HOST_RULES.find(([suffix]) => {
    const domain = suffix.startsWith(".") ? suffix.slice(1) : suffix;
    return host === domain || host.endsWith(`.${domain}`);
  });
  // Retourne les en-têtes de la règle trouvée, sinon null.
  return rule ? rule[1] : null;
// Fermeture de la fonction ruleFor.
}

// Indique si une URL est déjà sous forme proxifiée.
function isProxyForm(url) {
  // Vérifie que la chaîne commence par le préfixe de proxy.
  return String(url || "").startsWith(`${PROXY_PATH}?`);
// Fermeture de la fonction isProxyForm.
}

/** L'hôte exige-t-il un Referer forgé ou un jeton (donc un passage par le proxy) ? */
// Détermine si l'URL doit passer par le proxy (règle d'hôte existante).
function needsProxy(url) {
  // Renvoie vrai si une règle d'hôte s'applique à l'URL.
  return Boolean(ruleFor(url));
// Fermeture de la fonction needsProxy.
}

/** URL à servir au client : proxifiée si le CDN l'exige.
 *  opts.vwt = jeton Manga Plus, opts.k = clé XOR du chapitre. */
// Construit l'URL à renvoyer au client (proxifiée si nécessaire).
function proxied(url, opts) {
  // Une URL vide est renvoyée telle quelle.
  if (!url) return url;
  // Si l'hôte n'exige pas de proxy, renvoie l'URL directe.
  if (!needsProxy(url)) return url;
  // Ajoute le paramètre vwt s'il est valide.
  const vwt = opts && opts.vwt && VWT_RE.test(opts.vwt) ? `&${VWT_PARAM}=${encodeURIComponent(opts.vwt)}` : "";
  // Ajoute le paramètre k s'il est valide.
  const k = opts && opts.k && KEY_RE.test(opts.k) ? `&${KEY_PARAM}=${opts.k}` : "";
  // Assemble le préfixe, l'URL encodée et les paramètres optionnels.
  return `${PROXY_PREFIX}${encodeURIComponent(url)}${vwt}${k}`;
// Fermeture de la fonction proxied.
}

// Applique proxied() à chaque URL d'un tableau.
function proxiedAll(urls, opts) {
  // Mappe chaque URL vers sa forme proxifiée.
  return (urls || []).map((url) => proxied(url, opts));
// Fermeture de la fonction proxiedAll.
}

/** Décode une URL proxifiée (usage serveur uniquement). */
// Extrait l'URL d'origine depuis une URL proxifiée.
function resolve(url) {
  // Convertit l'entrée en chaîne (ou chaîne vide).
  const str = String(url || "");
  // Si ce n'est pas une URL proxifiée, la retourne telle quelle.
  if (!isProxyForm(str)) return str;
  // Tente d'extraire le paramètre "url".
  try {
    // Renvoie la valeur du paramètre "url", ou la chaîne initiale.
    return new URLSearchParams(str.slice(str.indexOf("?") + 1)).get("url") || str;
  // Si l'analyse échoue.
  } catch {
    // Retourne la chaîne initiale.
    return str;
  // Fermeture du bloc try/catch.
  }
// Fermeture de la fonction resolve.
}

/** Jeton Plus-Vw-Token éventuellement porté par l'URL proxifiée. */
// Lit le jeton de visionnage présent dans une URL proxifiée.
function vwtOf(url) {
  // Convertit l'entrée en chaîne (ou chaîne vide).
  const str = String(url || "");
  // Hors URL proxifiée, aucun jeton.
  if (!isProxyForm(str)) return null;
  // Tente d'extraire le paramètre vwt.
  try {
    // Récupère la valeur du paramètre vwt.
    const vwt = new URLSearchParams(str.slice(str.indexOf("?") + 1)).get(VWT_PARAM);
    // Retourne le jeton s'il est valide, sinon null.
    return vwt && VWT_RE.test(vwt) ? vwt : null;
  // Si l'analyse échoue.
  } catch {
    // Retourne null.
    return null;
  // Fermeture du bloc try/catch.
  }
// Fermeture de la fonction vwtOf.
}

/** Clé de déchiffrement XOR éventuellement portée par l'URL proxifiée. */
// Lit la clé de déchiffrement présente dans une URL proxifiée.
function kOf(url) {
  // Convertit l'entrée en chaîne (ou chaîne vide).
  const str = String(url || "");
  // Hors URL proxifiée, aucune clé.
  if (!isProxyForm(str)) return null;
  // Tente d'extraire le paramètre k.
  try {
    // Récupère la valeur du paramètre k.
    const k = new URLSearchParams(str.slice(str.indexOf("?") + 1)).get(KEY_PARAM);
    // Retourne la clé si elle est valide, sinon null.
    return k && KEY_RE.test(k) ? k : null;
  // Si l'analyse échoue.
  } catch {
    // Retourne null.
    return null;
  // Fermeture du bloc try/catch.
  }
// Fermeture de la fonction kOf.
}

/** Déchiffre une page Manga Plus (XOR avec la clé du chapitre) ; sinon inchangé. */
// Applique un déchiffrement XOR au tampon si une clé valide est fournie.
function decodePage(buf, key) {
  // Sans clé valide, renvoie le tampon inchangé.
  if (!key || !KEY_RE.test(key)) return buf;
  // Convertit la clé hexadécimale en tampon binaire.
  const kb = Buffer.from(key, "hex");
  // Si la clé est vide, renvoie le tampon inchangé.
  if (!kb.length) return buf;
  // S'assure de travailler sur un Buffer.
  const out = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // Applique un XOR octet par octet avec la clé (répétée en boucle).
  for (let i = 0; i < out.length; i++) out[i] ^= kb[i % kb.length];
  // Retourne le tampon déchiffré.
  return out;
// Fermeture de la fonction decodePage.
}

/** En-têtes à émettre vers l'hôte d'origine (fetch serveur). */
// Construit l'ensemble des en-têtes à envoyer vers l'hôte d'origine.
function headersFor(url) {
  // En-têtes de base (User-Agent et Accept).
  const headers = {
    // User-Agent imitant un navigateur.
    "User-Agent": USER_AGENT,
    // Types d'images acceptés.
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  // Fermeture de l'objet headers de base.
  };
  // Récupère la règle d'hôte pour l'URL d'origine.
  const rule = ruleFor(resolve(url));
  // Ajoute le Referer si la règle en impose un.
  if (rule && rule.referer) headers.Referer = rule.referer;
  // Lit le jeton de visionnage éventuel.
  const vwt = vwtOf(url);
  // Ajoute l'en-tête du jeton s'il existe.
  if (vwt) headers[VWT_HEADER] = vwt;
  // Retourne les en-têtes finaux.
  return headers;
// Fermeture de la fonction headersFor.
}

/** La route proxy accepte-t-elle cette URL ? (anti-SSRF : hôte imposé) */
// Vérifie qu'une URL est autorisée par la route proxy.
function isProxiable(url) {
  // Déclare la variable qui recevra l'URL parsée.
  let parsed;
  // Tente d'analyser l'URL.
  try {
    // Parse l'URL fournie.
    parsed = new URL(url);
  // Si l'URL est invalide.
  } catch {
    // Refuse la requête.
    return false;
  // Fermeture du bloc try/catch.
  }
  // N'accepte que les protocoles http et https.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  // Accepte uniquement si une règle d'hôte s'applique.
  return Boolean(ruleFor(parsed.toString()));
// Fermeture de la fonction isProxiable.
}

// Objet exportant l'API publique du module images.
module.exports = {
  // User-Agent partagé.
  USER_AGENT,
  // Chemin de la route proxy.
  PROXY_PATH,
  // Construit une URL proxifiée.
  proxied,
  // Proxifie une liste d'URL.
  proxiedAll,
  // Décode une URL proxifiée.
  resolve,
  // Lit le jeton de visionnage.
  vwtOf,
  // Lit la clé de déchiffrement.
  kOf,
  // Déchiffre une page.
  decodePage,
  // Construit les en-têtes d'origine.
  headersFor,
  // Indique si le proxy est requis.
  needsProxy,
  // Valide l'éligibilité au proxy.
  isProxiable,
// Fermeture de l'objet module.exports.
};
