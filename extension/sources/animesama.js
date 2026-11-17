// Active le mode strict (syntaxe JavaScript plus sure).
"use strict";

// Importe la classe de base de toutes les sources.
const BaseSource = require("../BaseSource");
// Importe l'utilitaire de creation d'erreurs HTTP.
const { httpError } = require("../utils");
// Importe le module de gestion des images.
const images = require("../images");

/**
 * Source Anime-Sama — catalogue d'animes en VF / VOSTFR (anime-sama.to).
 *
 * Le site expose, pour chaque saison et chaque langue, un fichier
 *   /catalogue/{slug}/{saison}/{langue}/episodes.js
 * qui contient les URLs des lecteurs vidéo (sibnet, sendvid, vk, oneupload…).
 * Ces lecteurs tiers sont faits pour l'incrustation : on les expose en
 * `externalUrl` et le lecteur maison les affiche dans une iframe — aucune
 * redirection externe n'est déclenchée.
 *
 * Particularités du site :
 *   - les panneaux de saisons sont écrits en clair : panneauAnime("Nom", "saison1/vostfr")
 *   - chaque épisode propose plusieurs lecteurs de repli (eps1, eps2, …)
 *   - les langues réellement disponibles varient : on sonde episodes.js
 *   - le site pose X-Frame-Options: SAMEORIGIN : on n'incruste donc jamais
 *     anime-sama.to lui-même, uniquement les lecteurs tiers.
 */

// URL de base du site Anime-Sama.
const BASE = "https://anime-sama.to";
// User-Agent recupere depuis le module images.
const UA = images.USER_AGENT;
// Delai maximal d'une requete en millisecondes (20 s).
const TIMEOUT_MS = 20_000;
// Duree de cache des episodes.js en millisecondes (30 min).
const EPS_TTL = 30 * 60_000;

// Langues candidates, par ordre de préférence (VF avant VOSTFR).
// Langues candidates, classees par preference (VF avant VOSTFR).
const LANG_ORDER = ["vf", "vf1", "vf2", "vqc", "vo", "va", "vostfr"];
// Table associant un code de langue a son libelle affiche.
const LANG_LABEL = {
  // Libelle de la version sous-titree francaise.
  vostfr: "VOSTFR",
  // Libelle de la version originale.
  vo: "VO",
  // Libelle de la version audio alternative.
  va: "VA",
  // Libelle de la version francaise.
  vf: "VF",
  // Libelle de la premiere variante VF.
  vf1: "VF1",
  // Libelle de la deuxieme variante VF.
  vf2: "VF2",
  // Libelle de la version quebecoise.
  vqc: "VQC",
// Ferme l'objet LANG_LABEL.
};

// Donne l'indice de preference d'une langue.
function rank(lang) {
  // Cherche la position de la langue dans la liste d'ordre.
  const i = LANG_ORDER.indexOf(lang);
  // Renvoie la position, ou la taille de la liste si inconnue.
  return i === -1 ? LANG_ORDER.length : i;
// Ferme la fonction rank.
}

// Decode les entites HTML en caracteres reels.
function decodeEntities(str) {
  // Convertit l'entree en chaine et demarre les remplacements.
  return String(str || "")
    // Remplace les espaces insecables par des espaces.
    .replace(/&nbsp;/g, " ")
    // Remplace l'entite &lt; par le caractere <.
    .replace(/&lt;/g, "<")
    // Remplace l'entite &gt; par le caractere >.
    .replace(/&gt;/g, ">")
    // Remplace l'entite &quot; par un guillemet double.
    .replace(/&quot;/g, '"')
    // Remplace les apostrophes encodees.
    .replace(/&#0?39;|&apos;/g, "'")
    // Remplace l'entite &amp; par le caractere &.
    .replace(/&amp;/g, "&")
    // Decode les entites hexadecimales.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Decode les entites decimales.
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
// Ferme la fonction decodeEntities.
}

// Retire les balises HTML et normalise les espaces.
function cleanText(html) {
  // Decode les entites et remplace chaque balise par un espace.
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " "))
    // Reduit les suites d'espaces a un seul espace.
    .replace(/\s+/g, " ")
    // Supprime les espaces en debut et fin de chaine.
    .trim();
// Ferme la fonction cleanText.
}

/** Démarre le compteur d'épisodes depuis un nom « [Épisode X à Y] », sinon 1. */
// Calcule le numero du premier episode d'une saison.
function seasonStart(name) {
  // Cherche un motif X a Y dans le nom de la saison.
  const m = /(\d+)\s*à\s*(\d+|\.\.\.)/i.exec(String(name || ""));
  // Renvoie le premier nombre trouve, sinon 1.
  return m ? Number(m[1]) : 1;
// Ferme la fonction seasonStart.
}

/** mapLimit : exécute fn sur items avec une concurrence bornée. */
// Applique fn sur items en limitant la concurrence.
async function mapLimit(items, limit, fn) {
  // Tableau des resultats de la meme taille que l'entree.
  const out = new Array(items.length);
  // Compteur du prochain index a traiter.
  let cursor = 0;
  // Cree des travailleurs qui piochent les elements a traiter.
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    // Boucle tant qu'il reste des elements.
    while (cursor < items.length) {
      // Reserve l'index courant et avance le compteur.
      const i = cursor++;
      // Execute fn sur l'element et stocke le resultat.
      out[i] = await fn(items[i], i);
    // Ferme la boucle while.
    }
  // Ferme la fonction du travailleur.
  });
  // Attend la fin de tous les travailleurs.
  await Promise.all(workers);
  // Renvoie tous les resultats.
  return out;
// Ferme la fonction mapLimit.
}

// Effectue une requete HTTP et renvoie le texte de la reponse.
async function request(url, { method = "GET", body = null, allow404 = false } = {}) {
  // Declare la variable recevant la reponse.
  let res;
  // Tente la requete en capturant les erreurs reseau.
  try {
    // Lance la requete fetch avec les options adaptees.
    res = await fetch(url, {
      // Methode HTTP (GET ou POST).
      method,
      // En-tetes envoyes au serveur.
      headers: {
        // S'identifie aupres du serveur via le User-Agent.
        "User-Agent": UA,
        // Types de contenu acceptes.
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        // Langues preferees, le francais en premier.
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        // Indique le site d'origine de la requete.
        Referer: `${BASE}/`,
        // Ajoute le type de contenu seulement si un corps est envoye.
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      // Ferme l'objet des en-tetes.
      },
      // Corps de la requete (null pour un GET).
      body,
      // Annule la requete apres le delai maximal.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    // Ferme les options de fetch.
    });
  // Capture les erreurs de la requete.
  } catch (err) {
    // Determine la raison de l'echec.
    const reason = err.name === "TimeoutError" ? "délai dépassé" : err.message;
    // Leve une erreur 502 : site injoignable.
    throw httpError(502, `Anime-Sama injoignable (${reason})`);
  // Ferme le bloc catch.
  }
  // Si la ressource est introuvable (404)...
  if (res.status === 404) {
    // ...et que les 404 sont autorises, renvoie null.
    if (allow404) return null;
    // Sinon, leve une erreur 404.
    throw httpError(404, "Ressource Anime-Sama introuvable");
  // Ferme le bloc if.
  }
  // Leve une erreur 502 pour les autres echecs HTTP.
  if (!res.ok) throw httpError(502, `Anime-Sama : réponse HTTP ${res.status}`);
  // Renvoie le corps de la reponse en texte.
  return res.text();
// Ferme la fonction request.
}

/** Parse le contenu d'un episodes.js -> tableau [ [lecteur1, lecteur2…], … ].
 *  Les variables epsN ne sont pas toujours déclarées dans l'ordre : on trie
 *  par numéro pour que le lecteur principal (eps1) passe en premier. */
// Transforme un episodes.js en listes d'URLs de lecteurs.
function parsePlayerArrays(js) {
  // Accumule les groupes de lecteurs trouves.
  const arrays = [];
  // Regex capturant chaque declaration var epsN = [...].
  const re = /var\s+eps(\d*)\s*=\s*\[([\s\S]*?)\];/g;
  // Variable recevant chaque correspondance.
  let match;
  // Parcourt toutes les correspondances de la regex.
  while ((match = re.exec(js))) {
    // Numero du lecteur (eps sans chiffre vaut 1).
    const n = match[1] ? Number(match[1]) : 1;
    // Extrait les URLs entre apostrophes du tableau.
    const urls = [...match[2].matchAll(/'(https?:[^']+)'/g)].map((m) => m[1]);
    // Enregistre le numero et les URLs associees.
    arrays.push({ n, urls });
  // Ferme la boucle while.
  }
  // Trie les lecteurs par numero croissant.
  arrays.sort((a, b) => a.n - b.n);
  // Ne renvoie que les listes d'URLs ordonnees.
  return arrays.map((a) => a.urls);
// Ferme la fonction parsePlayerArrays.
}

/** Premier lecteur disponible pour l'épisode d'index i (repli eps1 -> eps2 -> …). */
// Renvoie l'URL du lecteur principal, ou null.
function playerFor(arrays, i) {
  // Recupere la liste des lecteurs ordonnes.
  const p = preferredPlayers(arrays, i);
  // Renvoie la premiere URL ou null.
  return p.length ? p[0].url : null;
// Ferme la fonction playerFor.
}

// Fiabilité observée des lecteurs tiers dans un vrai navigateur. Uqload et
// Smoothpre lisent l'épisode complet en lecture automatique ; Voe (domaines
// rotatifs teresapolitical/jeremy/minochinos) lit aussi l'épisode complet mais
// démarre au clic. ansembed.net, embed4me et oneupload sont souvent hors service,
// sibnet est bloqué sur certains réseaux et sendvid ne renvoie qu'un extrait de
// 5 s. Sert à choisir le lecteur par défaut et à ordonner les alternatives.
// Table classant les hebergeurs du plus fiable au moins fiable.
const HOST_RANK = [
  // Uqload, lecteur le plus fiable.
  { re: /uqload\./i, label: "Uqload" },
  // Smoothpre, lecture automatique fiable.
  { re: /smoothpre\.com/i, label: "Smoothpre" },
  // Voe et ses domaines rotatifs.
  { re: /voe\.sx|teresapolitical|jeremyparticipantanything|minochinos/i, label: "Voe" },
  // Ansembed, fiabilite moyenne.
  { re: /ansembed\.net/i, label: "Ansembed" },
  // Video hebergee par VK.
  { re: /vk(?:video)?\.(?:com|ru)/i, label: "VK" },
  // OneUpload, souvent hors service.
  { re: /oneupload\.to/i, label: "OneUpload" },
  // Embed4Me, souvent hors service.
  { re: /embed4me\.com/i, label: "Embed4Me" },
  // Movearnpre.
  { re: /movearnpre\.com/i, label: "Movearnpre" },
  // Sibnet, parfois bloque selon le reseau.
  { re: /sibnet\.ru/i, label: "Sibnet" },
  // Sendvid, ne renvoie qu'un court extrait.
  { re: /sendvid\.com/i, label: "Sendvid" },
// Ferme le tableau HOST_RANK.
];

// Determine le rang et le libelle d'un hebergeur.
function hostInfo(url) {
  // Parcourt la table HOST_RANK dans l'ordre.
  for (let i = 0; i < HOST_RANK.length; i++) {
    // Renvoie le rang et le libelle si le motif correspond.
    if (HOST_RANK[i].re.test(url)) return { rank: i, label: HOST_RANK[i].label };
  // Ferme la boucle for.
  }
  // Prepare un libelle de secours.
  let host = "";
  // Tente d'extraire le nom d'hote de l'URL.
  try {
    // Nettoie le prefixe www. du nom d'hote.
    host = new URL(url).hostname.replace(/^www\./, "");
  // Ignore silencieusement les URLs invalides.
  } catch {
    /* ignore */
  // Ferme le bloc catch.
  }
  // Renvoie le rang le plus bas et le nom d'hote.
  return { rank: HOST_RANK.length, label: host || "Lecteur" };
// Ferme la fonction hostInfo.
}

/** Tous les lecteurs disponibles pour l'épisode i, du plus fiable au moins. */
// Construit la liste ordonnee des lecteurs d'un episode.
function preferredPlayers(arrays, i) {
  // Accumule les URLs proposees pour cet episode.
  const urls = [];
  // Parcourt chaque groupe de lecteurs.
  for (const arr of arrays) {
    // Ajoute l'URL si ce groupe propose bien cet episode.
    if (arr && arr[i]) urls.push(arr[i]);
  // Ferme la boucle for.
  }
  // Deduplique les URLs.
  const uniq = [...new Set(urls)];
  // Trie les URLs par fiabilite.
  uniq.sort((a, b) => hostInfo(a).rank - hostInfo(b).rank);
  // Renvoie chaque URL avec le libelle de son lecteur.
  return uniq.map((url) => ({ label: hostInfo(url).label, url }));
// Ferme la fonction preferredPlayers.
}

// Vérification légère de disponibilité : évite de proposer par défaut un lien
// mort (404/410/5xx). En cas de doute (réseau, 403…), on garde le lecteur.
// Duree de cache des verifications de disponibilite (10 min).
const LIVE_TTL = 10 * 60_000;
// Cache memoire des resultats de disponibilite.
const _liveCache = new Map();

// Verifie si un lecteur repond sans etre manifestement mort.
async function isPlayable(url) {
  // Consulte le cache pour cette URL.
  const hit = _liveCache.get(url);
  // Renvoie le resultat en cache s'il n'a pas expire.
  if (hit && Date.now() - hit.at < LIVE_TTL) return hit.ok;
  // Prepare un controleur pour annuler la requete.
  const ctrl = new AbortController();
  // Programme l'annulation apres 4 secondes.
  const timer = setTimeout(() => ctrl.abort(), 4000);
  // Suppose par defaut que le lecteur est disponible.
  let ok = true;
  // Tente une requete legere vers le lecteur.
  try {
    // Envoie la requete en suivant les redirections.
    const res = await fetch(url, {
      // En-tetes minimaux : User-Agent et referer.
      headers: { "user-agent": UA, referer: `${BASE}/` },
      // Suit automatiquement les redirections.
      redirect: "follow",
      // Signal permettant d'annuler la requete.
      signal: ctrl.signal,
    // Ferme les options de fetch.
    });
    // Marque le lecteur comme mort en cas de 404, 410 ou 5xx.
    ok = !(res.status === 404 || res.status === 410 || res.status >= 500);
  // En cas d'erreur reseau, on reste optimiste.
  } catch {
    // Garde le lecteur par prudence.
    ok = true;
  // Execute le nettoyage dans tous les cas.
  } finally {
    // Annule le minuteur d'abandon.
    clearTimeout(timer);
  // Ferme le bloc finally.
  }
  // Memorise le resultat dans le cache.
  _liveCache.set(url, { ok, at: Date.now() });
  // Renvoie le resultat de la verification.
  return ok;
// Ferme la fonction isPlayable.
}

/** Reordonne les lecteurs : liens vivants d'abord, liens manifestement morts en dernier. */
// Place les lecteurs vivants en tete, les morts a la fin.
async function rankPlayers(players) {
  // Aucun tri necessaire s'il n'y a qu'un lecteur.
  if (players.length <= 1) return players;
  // Verifie en parallele la disponibilite de chaque lecteur.
  const checks = await Promise.all(players.map((p) => isPlayable(p.url)));
  // Tableau des lecteurs vivants.
  const alive = [];
  // Tableau des lecteurs morts.
  const dead = [];
  // Repartit chaque lecteur dans alive ou dead.
  players.forEach((p, i) => (checks[i] ? alive : dead).push(p));
  // Concatene les vivants puis les morts.
  return alive.concat(dead);
// Ferme la fonction rankPlayers.
}

// Declare la classe de la source Anime-Sama.
class AnimesamaSource extends BaseSource {
  // Initialise la source avec ses metadonnees.
  constructor() {
    // Appelle le constructeur de la classe de base.
    super({
      // Identifiant technique de la source.
      id: "animesama",
      // Nom affiche de la source.
      name: "Anime-Sama",
      // URL de base par defaut.
      baseUrl: BASE,
      // Langue principale de la source.
      lang: "fr",
      // Version de l'extension.
      version: "1.0.0",
      // Auteur de l'extension.
      author: "OptiManga",
      // Type de media (anime).
      mediaType: "anime",
      // Couleur d'accent dans l'interface.
      color: "#f97316",
      // Description affichee a l'utilisateur.
      description:
        // Debut de la description.
        "Catalogue d'animes gratuit en VF et VOSTFR (anime-sama.to). Les épisodes sont lus " +
        // Suite de la description.
        "directement dans le lecteur intégré (Uqload, Smoothpre, Voe…), sans redirection " +
        // Fin de la description.
        "vers un autre site. Fiches, saisons et épisodes en français.",
      // Active la source par defaut.
      defaultEnabled: true,
    // Ferme l'objet de configuration de super.
    });
    // Cache des episodes par cle dossier/langue.
    this._epsCache = new Map(); // "dir/lang" -> { arrays, at }
  // Ferme le constructeur.
  }

  // ---- Recherche ----------------------------------------------------------

  // Recherche des animes ou parcourt le catalogue.
  async search(query = "", options = {}) {
    // Extrait les options de tri, limite et decalage.
    const { sort = "relevance", limit = 24, offset = 0 } = options;
    // Nettoie la requete de recherche.
    const q = String(query || "").trim();

    // Cherche sur le site ou parcourt le catalogue.
    let items = q ? await this._searchSite(q) : await this._browse();

    // Trie par titre si demande.
    if (sort === "title") items = items.slice().sort((a, b) => a.title.localeCompare(b.title, "fr"));

    // Nombre total de resultats.
    const total = items.length;
    // Borne la limite entre 1 et 100 (24 par defaut).
    const lim = Math.min(100, Math.max(1, Number(limit) || 24));
    // Force un decalage positif ou nul.
    const off = Math.max(0, Number(offset) || 0);
    // Renvoie la tranche demandee et le total.
    return { results: items.slice(off, off + lim), total };
  // Ferme la methode search.
  }

  // Recherche les animes via l'endpoint du site.
  async _searchSite(q) {
    // Envoie la requete POST de recherche.
    const html = await request(`${BASE}/template-php/defaut/fetch.php`, {
      // Methode HTTP POST.
      method: "POST",
      // Corps de la requete avec le mot recherche.
      body: new URLSearchParams({ query: q }).toString(),
    // Ferme les options de la requete.
    });
    // Declare la regex des resultats de recherche.
    const re =
      // Motif capturant lien, image et titre.
      /<a\s+href="([^"]+?)"\s+class="asn-search-result">\s*<img[^>]*?src="([^"]*)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
    // Accumule les fiches trouvees.
    const items = [];
    // Memorise les slugs deja vus.
    const seen = new Set();
    // Variable recevant chaque correspondance.
    let match;
    // Parcourt toutes les correspondances.
    while ((match = re.exec(html))) {
      // Extrait le slug de l'anime depuis le lien.
      const slug = this._slugOf(match[1]);
      // Ignore les entrees sans slug ou deja vues.
      if (!slug || seen.has(slug)) continue;
      // Marque le slug comme vu.
      seen.add(slug);
      // Ajoute la fiche resume a la liste.
      items.push(this._brief(slug, cleanText(match[3]), match[2] || null));
    // Ferme la boucle while.
    }
    // Renvoie la liste des fiches.
    return items;
  // Ferme la methode _searchSite.
  }

  // Parcourt le catalogue complet du site.
  async _browse() {
    // Recupere la page du catalogue.
    const html = await request(`${BASE}/catalogue/`);
    // Declare la regex des cartes du catalogue.
    const re =
      // Motif capturant lien, image et titre des cartes.
      /<a\s+href="([^"]+?\/catalogue\/[^"/]+)\/?">\s*<div class="card-image-container">\s*<img[\s\S]*?src="([^"]*)"[\s\S]*?<h2[^>]*class="card-title"[^>]*>([\s\S]*?)<\/h2>/g;
    // Accumule les fiches trouvees.
    const items = [];
    // Memorise les slugs deja vus.
    const seen = new Set();
    // Variable recevant chaque correspondance.
    let match;
    // Parcourt toutes les correspondances.
    while ((match = re.exec(html))) {
      // Extrait le slug de l'anime.
      const slug = this._slugOf(match[1]);
      // Ignore les entrees sans slug ou deja vues.
      if (!slug || seen.has(slug)) continue;
      // Marque le slug comme vu.
      seen.add(slug);
      // Ajoute la fiche resume a la liste.
      items.push(this._brief(slug, cleanText(match[3]), match[2] || null));
    // Ferme la boucle while.
    }
    // Renvoie la liste des fiches.
    return items;
  // Ferme la methode _browse.
  }

  // Extrait le slug depuis un lien de catalogue.
  _slugOf(href) {
    // Cherche le slug dans le href.
    const m = /\/catalogue\/([^/?"']+)/.exec(String(href || ""));
    // Renvoie le slug ou null.
    return m ? m[1].replace(/\/+$/, "") : null;
  // Ferme la methode _slugOf.
  }

  // Resout et proxifie une couverture Anime-Sama (URL relative ou absolue).
  _cover(raw) {
    // Nettoie la valeur brute.
    const value = String(raw || "").trim();
    // Renvoie null pour une couverture absente.
    if (!value) return null;
    // Tente de resoudre puis de proxifier l'URL.
    try {
      return images.proxied(new URL(value, BASE).toString());
    // Ignore une URL invalide.
    } catch {
      return null;
    // Ferme le bloc try/catch.
    }
  // Ferme la methode _cover.
  }

  // Construit une fiche resume a partir de donnees brutes.
  _brief(slug, title, cover) {
    // Renvoie l'objet fiche.
    return {
      // Identifiant (le slug).
      id: slug,
      // Titre, ou slug transforme en texte.
      title: title || slug.replace(/-/g, " "),
      // Aucun auteur renseigne.
      author: null,
      // Image de couverture resolue et proxifiee, ou null.
      cover: this._cover(cover),
      // Statut inconnu.
      status: null,
      // Genre vide.
      genre: "",
      // Liste de tags vide.
      tags: [],
      // Note inconnue.
      rating: null,
      // Popularite inconnue.
      popularity: null,
      // Annee inconnue.
      year: null,
      // Nombre de chapitres inconnu.
      chapterCount: null,
      // Type de media (anime).
      mediaType: "anime",
      // Identifiant de la source.
      sourceId: this.id,
      // Nom de la source.
      sourceName: this.name,
    // Ferme l'objet fiche.
    };
  // Ferme la methode _brief.
  }

  // ---- Fiche anime --------------------------------------------------------

  // Recupere les informations detaillees d'un anime.
  async getMangaInfo(mangaId) {
    // Normalise l'identifiant en slug.
    const slug = this._slugOf(`/catalogue/${mangaId}`);
    // Leve une erreur 404 si le slug est invalide.
    if (!slug) throw httpError(404, "Anime introuvable");
    // Recupere la page de la fiche.
    const html = await request(`${BASE}/catalogue/${slug}/`);

    // Extrait le titre principal de la page.
    const title = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1]) || slug.replace(/-/g, " ");
    // Extrait le titre alternatif.
    const altTitle = cleanText((/<h2[^>]*id="titreAlter"[^>]*>([\s\S]*?)<\/h2>/.exec(html) || [])[1]);
    // Declare la description.
    const description =
      // Description depuis la balise meta (ordre 1).
      (/(?:<meta\s+name="description"\s+content="([^"]*)")/i.exec(html) || [])[1] ||
      // Description depuis la balise meta (ordre 2).
      (/(?:<meta\s+content="([^"]*)"\s+name="description")/i.exec(html) || [])[1] ||
      // Description vide par defaut.
      "";
    // Extrait l'image de couverture (og:image, dans les deux ordres d'attributs).
    const cover =
      (/(?:<meta\s+property="og:image"\s+content="([^"]*)")/i.exec(html) || [])[1] ||
      (/(?:<meta\s+content="([^"]*)"\s+property="og:image")/i.exec(html) || [])[1] ||
      null;

    // Extrait les genres listes dans la page.
    const genres = [...html.matchAll(/<span class="genre-pill">([^<]*)<\/span>/g)]
      // Nettoie chaque genre.
      .map((m) => cleanText(m[1]))
      // Supprime les genres vides.
      .filter(Boolean);

    // Analyse les saisons de l'anime.
    const seasons = this._seasons(html);
    // Leve une erreur si aucune saison n'est trouvee.
    if (!seasons.length) throw httpError(404, "Aucune saison trouvée sur Anime-Sama");

    // Determine les langues disponibles pour la premiere saison.
    const langs = await this._availableLangs(slug, seasons[0].dir, seasons[0].lang);
    // Construit la liste des episodes.
    const chapters = await this._buildChapters(slug, seasons, langs);

    // Renvoie l'objet fiche complet.
    return {
      // Identifiant (slug).
      id: slug,
      // Titre.
      title,
      // Auteur (titre alternatif ou null).
      author: altTitle || null,
      // Description nettoyee.
      description: cleanText(description),
      // Couverture resolution et proxifiee.
      cover: this._cover(cover),
      // Statut inconnu.
      status: null,
      // Premier genre.
      genre: genres[0] || "",
      // Liste des tags (genres).
      tags: genres,
      // Note inconnue.
      rating: null,
      // Popularite inconnue.
      popularity: null,
      // Annee inconnue.
      year: null,
      // Nombre total d'episodes.
      chapterCount: chapters.length,
      // Liste des episodes.
      chapters,
      // Type de media (anime).
      mediaType: "anime",
      // Identifiant de la source.
      sourceId: this.id,
      // Nom de la source.
      sourceName: this.name,
    // Ferme l'objet fiche.
    };
  // Ferme la methode getMangaInfo.
  }

  // Analyse les panneaux de saisons dans le HTML.
  _seasons(html) {
    // Accumule les saisons trouvees.
    const seasons = [];
    // Memorise les cles deja vues.
    const seen = new Set();
    // Regex capturant les appels panneauAnime(...).
    const re = /panneauAnime\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g;
    // Variable recevant chaque correspondance.
    let match;
    // Parcourt toutes les correspondances.
    while ((match = re.exec(html))) {
      // Nettoie le nom de la saison.
      const name = cleanText(match[1]);
      // Normalise le chemin de la saison.
      const path = match[2].trim().replace(/^\/+|\/+$/g, "");
      // Ignore les entrees invalides ou factices.
      if (!name || name === "nom" || !path || path === "url") continue;
      // Decoupe le chemin en parties.
      const parts = path.split("/");
      // La langue est la derniere partie.
      const lang = parts.pop();
      // Le dossier est le reste du chemin.
      const dir = parts.join("/");
      // Ignore les chemins incomplets.
      if (!dir || !lang) continue;
      // Construit une cle unique dossier/langue.
      const key = `${dir}/${lang}`;
      // Ignore les saisons deja vues.
      if (seen.has(key)) continue;
      // Marque la saison comme vue.
      seen.add(key);
      // Ajoute la saison a la liste.
      seasons.push({ name, dir, lang });
    // Ferme la boucle while.
    }
    // Renvoie la liste des saisons.
    return seasons;
  // Ferme la methode _seasons.
  }

  /** Langues réellement disponibles pour une saison (sonde episodes.js). */
  // Determine les langues reellement disponibles pour une saison.
  async _availableLangs(slug, dir, defaultLang) {
    // Liste la langue par defaut puis les autres par preference.
    const candidates = [defaultLang, ...LANG_ORDER.filter((l) => l !== defaultLang)];
    // Sonde en parallele chaque langue candidate.
    const checks = await mapLimit(candidates, 6, async (lang) => {
      // Tente de charger episodes.js pour la langue.
      const js = await this._episodesJs(slug, dir, lang).catch(() => null);
      // Renvoie la langue si le fichier existe, sinon null.
      return js ? lang : null;
    // Ferme le callback de mapLimit.
    });
    // Ne conserve que les langues valides.
    const langs = checks.filter(Boolean);
    // Trie les langues par preference.
    langs.sort((a, b) => rank(a) - rank(b));
    // Renvoie les langues trouvees ou la langue par defaut.
    return langs.length ? langs : [defaultLang];
  // Ferme la methode _availableLangs.
  }

  // Charge et analyse le fichier episodes.js d'une combinaison.
  async _episodesJs(slug, dir, lang) {
    // Construit la cle de cache.
    const key = `${slug}/${dir}/${lang}`;
    // Consulte le cache.
    const hit = this._epsCache.get(key);
    // Renvoie le cache s'il n'a pas expire.
    if (hit && Date.now() - hit.at < EPS_TTL) return hit.array;

    // Telecharge le fichier episodes.js.
    const js = await request(`${BASE}/catalogue/${slug}/${dir}/${lang}/episodes.js`, {
      // Autorise une reponse 404 sans lever d'erreur.
      allow404: true,
    // Ferme les options de la requete.
    });
    // Leve une erreur si le fichier est absent.
    if (!js) throw httpError(404, "episodes.js introuvable");
    // Analyse le contenu du fichier.
    const array = parsePlayerArrays(js);
    // Memorise le resultat dans le cache.
    this._epsCache.set(key, { array, at: Date.now() });
    // Renvoie le tableau des lecteurs.
    return array;
  // Ferme la methode _episodesJs.
  }

  // Construit tous les episodes de toutes les saisons.
  async _buildChapters(slug, seasons, langs) {
    // Indique si plusieurs langues existent.
    const multiLang = langs.length > 1;
    // Traite les saisons en parallele (concurrence 6).
    const perSeason = await mapLimit(seasons, 6, async (season) => {
      // Traite les langues d'une saison en parallele (concurrence 4).
      const byLang = await mapLimit(langs, 4, async (lang) => {
        // Charge episodes.js pour la langue.
        const arrays = await this._episodesJs(slug, season.dir, lang).catch(() => null);
        // Renvoie un objet vide si aucun lecteur.
        if (!arrays || !arrays.length) return { lang, arrays: null };
        // Renvoie la langue et ses lecteurs.
        return { lang, arrays };
      // Ferme le callback de mapLimit des langues.
      });
      // Ne garde que les langues ayant des lecteurs.
      return { season, byLang: byLang.filter((b) => b.arrays) };
    // Ferme le callback de mapLimit des saisons.
    });

    // Accumule les episodes construits.
    const chapters = [];
    // Compteur d'ordre global des episodes.
    let order = 0;
    // Parcourt chaque saison et ses langues.
    for (const { season, byLang } of perSeason) {
      // Calcule le premier numero d'episode.
      const base = seasonStart(season.name);
      // Parcourt chaque langue disponible.
      for (const { lang, arrays } of byLang) {
        // Determine le nombre d'episodes de la langue.
        const count = Math.max(...arrays.map((a) => a.length), 0);
        // Choisit le libelle de langue.
        const label = LANG_LABEL[lang] || lang.toUpperCase();
        // Parcourt chaque episode de la langue.
        for (let i = 0; i < count; i++) {
          // Choisit le lecteur principal de l'episode.
          const embed = playerFor(arrays, i);
          // Ignore l'episode s'il n'a aucun lecteur.
          if (!embed) continue;
          // Calcule le numero reel de l'episode.
          const ep = base + i;
          // Incremente le compteur d'ordre.
          order += 1;
          // Ajoute l'episode a la liste.
          chapters.push({
            // Identifiant unique de l'episode.
            id: `${season.dir}~${lang}~${i + 1}`,
            // Titre affiche de l'episode.
            title: `${season.name} · Épisode ${ep}`,
            // Ordre de l'episode.
            order,
            // Groupe de langue si plusieurs langues.
            group: multiLang ? label : null,
            // URL du lecteur externe.
            externalUrl: embed,
            // Aucune page interne (lecteur externe).
            pages: 0,
          // Ferme l'objet episode.
          });
        // Ferme la boucle des episodes.
        }
      // Ferme la boucle des langues.
      }
    // Ferme la boucle des saisons.
    }
    // Renvoie tous les episodes.
    return chapters;
  // Ferme la methode _buildChapters.
  }

  // ---- Lecture ------------------------------------------------------------

  // Recupere les lecteurs d'un episode donne.
  async getChapterPages(mangaId, chapterId) {
    // Decoupe l'identifiant en dossier, langue et index.
    const parts = String(chapterId || "").split("~");
    // Leve une erreur si le format est invalide.
    if (parts.length !== 3) throw httpError(404, "Épisode introuvable");
    // Recupere le dossier.
    const dir = parts[0];
    // Recupere la langue.
    const lang = parts[1];
    // Convertit l'index en base 0.
    const index = Number(parts[2]) - 1;
    // Verifie la validite des composants.
    if (!dir || !lang || !Number.isInteger(index) || index < 0) {
      // Leve une erreur 404 si invalide.
      throw httpError(404, "Épisode introuvable");
    // Ferme le bloc if.
    }
    // Recharge les lecteurs de l'episode.
    const arrays = await this._episodesJs(String(mangaId), dir, lang).catch(() => null);
    // Leve une erreur si aucun lecteur n'est trouve.
    if (!arrays) throw httpError(404, "Lecteur introuvable pour cet épisode");
    // Ordonne les lecteurs par disponibilite.
    const players = await rankPlayers(preferredPlayers(arrays, index)).catch(() => preferredPlayers(arrays, index));
    // Leve une erreur si la liste est vide.
    if (!players.length) throw httpError(404, "Lecteur introuvable pour cet épisode");
    // Renvoie l'objet de lecture.
    return {
      // Identifiant de l'episode.
      id: chapterId,
      // Titre inconnu.
      title: null,
      // Ordre inconnu.
      order: null,
      // Aucune page interne.
      pages: [],
      // Aucune page basse resolution.
      pagesLow: [],
      // URL du lecteur principal.
      externalUrl: players[0].url,
      // Liste des lecteurs de repli.
      players,
    // Ferme l'objet de lecture.
    };
  // Ferme la methode getChapterPages.
  }
// Ferme la classe AnimesamaSource.
}

// Exporte la classe pour le chargeur de sources.
module.exports = AnimesamaSource;
