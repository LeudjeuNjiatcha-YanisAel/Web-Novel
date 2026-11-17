// Active le mode strict de JavaScript (interdit certaines erreurs silencieuses)
"use strict";

// Importe la classe de base commune à toutes les sources
const BaseSource = require("../BaseSource");
// Importe le helper httpError pour créer des erreurs HTTP typées
const { httpError } = require("../utils");
// Importe le module images (proxy et User-Agent)
const images = require("../images");

/**
 * Source WEBTOON — scraping de www.webtoons.com (officiel, Naver/Webtoon).
 *
 * Pages consultées :
 *   - /fr/search?keyword=…      recherche (sections ORIGINAL + CANVAS)
 *   - /fr/                      accueil (catalogue sans requête : tendances,
 *                               populaires, nouveautés, hebdo, CANVAS)
 *   - /fr/{genre}/{slug}/list…  fiche + liste des épisodes (paginée, 10/page)
 *   - …/viewer?title_no=…&episode_no=…  pages d'un épisode (HTML complet)
 *
 * Les images sont servies par pstatic.net avec hotlink protection (403 hors
 * Referer webtoons.com) : leurs URLs passent par le proxy /api/image.
 *
 * Un « titre » WEBTOON = un genre + un slug + un numéro de série (title_no) ;
 * les saisons longues sont découpées en plusieurs title_no côté éditeur.
 * id interne : `${genre}__${slug}__${titleNo}` (URL-safe).
 */

// URL de base du site WEBTOON
const BASE = "https://www.webtoons.com";

// Genres des classements WEBTOON : code -> libellé (aligné sur MangaDex pour
// que les filtres de genres restent communs entre les sources).
// Tableau des genres : paires [code, libellé]
const GENRES = [
  // Genre ACTION
  ["ACTION", "Action"],
  // Genre COMEDY
  ["COMEDY", "Comedy"],
  // Genre DRAMA
  ["DRAMA", "Drama"],
  // Genre FANTASY
  ["FANTASY", "Fantasy"],
  // Genre ROMANCE
  ["ROMANCE", "Romance"],
  // Genre SF (science-fiction)
  ["SF", "Sci-Fi"],
  // Genre SLICE_OF_LIFE
  ["SLICE_OF_LIFE", "Slice of Life"],
  // Genre SUPER_HERO
  ["SUPER_HERO", "Super Hero"],
  // Genre THRILLER
  ["THRILLER", "Thriller"],
  // Genre HISTORICAL
  ["HISTORICAL", "Historical"],
  // Genre SPORTS
  ["SPORTS", "Sports"],
// Fin du tableau GENRES
];
// Construit la correspondance code -> libellé
const LABEL_BY_CODE = new Map(GENRES);
// Construit la correspondance libellé (minuscules) -> code
const CODE_BY_LABEL = new Map(GENRES.map(([code, label]) => [label.toLowerCase(), code]));
// Libellés affichés par WEBTOON FR, ramenés aux codes ci-dessus.
// Correspondance libellé français -> code de genre
const CODE_BY_FR_LABEL = {
  // "action" -> ACTION
  action: "ACTION",
  // "comédie" -> COMEDY
  comédie: "COMEDY",
  // "comedie" (sans accent) -> COMEDY
  comedie: "COMEDY",
  // "drama" -> DRAMA
  drama: "DRAMA",
  // "fantastique" -> FANTASY
  fantastique: "FANTASY",
  // "fantasy" -> FANTASY
  fantasy: "FANTASY",
  // "historique" -> HISTORICAL
  historique: "HISTORICAL",
  // "romance" -> ROMANCE
  romance: "ROMANCE",
  // "sf" -> SF
  sf: "SF",
  // "science-fiction" -> SF
  "science-fiction": "SF",
  // "sport" -> SPORTS
  sport: "SPORTS",
  // "sports" -> SPORTS
  sports: "SPORTS",
  // "tranche de vie" -> SLICE_OF_LIFE
  "tranche de vie": "SLICE_OF_LIFE",
  // "superhéros" -> SUPER_HERO
  "superhéros": "SUPER_HERO",
  // "superheros" (sans accent) -> SUPER_HERO
  "superheros": "SUPER_HERO",
  // "super-héros" -> SUPER_HERO
  "super-héros": "SUPER_HERO",
  // "super-heros" (sans accent) -> SUPER_HERO
  "super-heros": "SUPER_HERO",
  // "thriller" -> THRILLER
  thriller: "THRILLER",
// Fin de l'objet CODE_BY_FR_LABEL
};

// ---------------------------------------------------------------------------
// Utilitaires HTML (regex ciblées : le site est rendu côté serveur)
// ---------------------------------------------------------------------------

// Décode les entités HTML d'une chaîne
function decodeEntities(str) {
  // Convertit l'entrée en chaîne et remplace les entités courantes
  return String(str || "")
    // Remplace &nbsp; par un espace
    .replace(/&nbsp;/g, " ")
    // Remplace &lt; par <
    .replace(/&lt;/g, "<")
    // Remplace &gt; par >
    .replace(/&gt;/g, ">")
    // Remplace &quot; par "
    .replace(/&quot;/g, '"')
    // Remplace &#39; / &apos; par une apostrophe
    .replace(/&#0?39;|&apos;/g, "'")
    // Remplace &amp; par & (en dernier pour ne pas redécoder)
    .replace(/&amp;/g, "&")
    // Remplace les entités hexadécimales &#x…. par le caractère correspondant
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Remplace les entités décimales &#…. par le caractère correspondant
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
// Fin de la fonction decodeEntities
}

// Extrait le texte brut d'un fragment HTML
function textOf(html) {
  // Supprime les balises, décode les entités et compacte les espaces
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " "))
    // Remplace les suites d'espaces par un seul espace
    .replace(/\s+/g, " ")
    // Supprime les espaces en début et fin
    .trim();
// Fin de la fonction textOf
}

/** "3,2M Vues" / "472K" / "841 848" -> nombre entier. */
// Convertit un texte de compteur (vues, abonnés) en nombre entier
function parseCount(str) {
  // Convertit en chaîne et retire tous les espaces
  const cleaned = String(str || "").replace(/\s/g, "");
  // Recherche un nombre éventuellement suivi d'un suffixe k/m/b
  const m = /([\d]+(?:[.,]\d+)?)\s*([kmb])?/i.exec(cleaned);
  // Renvoie null si aucun nombre
  if (!m) return null;
  // Convertit la partie numérique (virgule -> point)
  let n = Number.parseFloat(m[1].replace(",", "."));
  // Renvoie null si la conversion échoue
  if (!Number.isFinite(n)) return null;
  // Récupère le suffixe en minuscules
  const suffix = (m[2] || "").toLowerCase();
  // Multiplie par mille si suffixe "k"
  if (suffix === "k") n *= 1e3;
  // Multiplie par un million si suffixe "m"
  else if (suffix === "m") n *= 1e6;
  // Multiplie par un milliard si suffixe "b"
  else if (suffix === "b") n *= 1e9;
  // Renvoie le nombre arrondi
  return Math.round(n);
// Fin de la fonction parseCount
}

// Transforme un segment d'URL en libellé lisible (majuscule initiale)
function prettify(segment) {
  // Convertit en chaîne puis prépare le découpage
  return String(segment || "")
    // Découpe sur les tirets
    .split("-")
    // Retire les segments vides
    .filter(Boolean)
    // Met la première lettre de chaque mot en majuscule
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    // Recolle les mots avec des espaces
    .join(" ");
// Fin de la fonction prettify
}

// Récupère le HTML d'une URL avec en-têtes de navigateur
async function getHtml(url) {
  // Déclare la réponse HTTP
  let res;
  // Tente la requête réseau
  try {
    // Envoie la requête avec les en-têtes
    res = await fetch(url, {
      // Début des en-têtes HTTP
      headers: {
        // User-Agent commun
        "User-Agent": images.USER_AGENT,
        // Types de contenu acceptés
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        // Langues préférées
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
      // Fin des en-têtes
      },
    // Fin de l'appel fetch
    });
  // En cas d'échec réseau
  } catch (err) {
    // Lève une erreur 502 avec le message d'erreur
    throw httpError(502, `WEBTOON injoignable (${err.message})`);
  // Fin du catch réseau
  }
  // Erreur 404 si la page n'existe pas
  if (res.status === 404) throw httpError(404, "Page WEBTOON introuvable");
  // Erreur 502 pour toute autre réponse non 2xx
  if (!res.ok) throw httpError(502, `WEBTOON : réponse HTTP ${res.status}`);
  // Renvoie le corps de la réponse en texte
  return await res.text();
// Fin de la fonction getHtml
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Cartes de titre (recherche, classements, accueil). */
// Analyse le HTML pour en extraire les cartes de titre
function parseCards(html) {
  // Liste des cartes trouvées
  const out = [];
  // Regex globale des liens <a>
  const re = /<a\s([^>]+)>([\s\S]*?)<\/a>/g;
  // Déclare la correspondance courante
  let m;
  // Parcourt tous les liens du HTML
  while ((m = re.exec(html))) {
    // Attributs du lien
    const attrs = m[1];
    // Contenu interne du lien
    const body = m[2];
    // Recherche l'attribut href
    const hrefM = /href="([^"]+)"/.exec(attrs);
    // Ignore si pas de href ou pas de data-title-no
    if (!hrefM || !/data-title-no="\d+"/.test(attrs)) continue;

    // Recherche le motif /fr/{genre}/{slug}/list dans l'URL
    const pathM = /\/fr\/([a-z0-9%-]+)\/([a-z0-9%-]+)\/list(?:\?|$)/i.exec(hrefM[1]);
    // Ignore si le motif n'est pas trouvé
    if (!pathM) continue;
    // Recherche le numéro de série (title_no) dans l'URL ou les attributs
    const titleNoM = /[?&]title_no=(\d+)/.exec(hrefM[1]) || /data-title-no="(\d+)"/.exec(attrs);
    // Ignore si aucun numéro de série
    if (!titleNoM) continue;

    // Recherche le bloc du titre
    const titleM = /class="title">([\s\S]*?)<\/strong>/.exec(body);
    // Recherche le bloc de l'auteur
    const authorM = /class="author">([\s\S]*?)<\/div>/.exec(body);
    // Recherche la balise image de couverture
    const coverM = /<img[^>]*\bsrc="([^"]+)"/.exec(body);
    // Recherche le compteur de vues
    const viewsM = /class="view_count[^"]*">([\s\S]*?)<\/(?:div|span)>/.exec(body);
    // Recherche le libellé de genre affiché
    const genreM = /class="genre[^"]*">([^<]+)</.exec(body);
    // Recherche l'attribut data-genre
    const dataGenreM = /data-genre="([A-Z_]+)"/.exec(attrs);

    // Genre issu du chemin d'URL, en minuscules
    const genrePath = pathM[1].toLowerCase();
    // Détermine le libellé de genre à afficher
    const genreLabel = genreM
      // Utilise le libellé trouvé dans la page s'il existe
      ? textOf(genreM[1])
      // Sinon tente la correspondance par code, ou un libellé déduit
      : LABEL_BY_CODE.get(genrePath.toUpperCase().replace(/-/g, "_")) ||
        (genrePath === "canvas" ? "CANVAS" : prettify(genrePath));
    // CANVAS regroupe tous les genres : on retombe sur le libellé affiché.
    // Détermine le code de genre
    const code = dataGenreM
      // Utilise l'attribut data-genre s'il existe
      ? dataGenreM[1]
      // Sinon traite le cas CANVAS
      : genrePath === "canvas"
        // Retrouve le code depuis le libellé français, sinon CANVAS
        ? CODE_BY_FR_LABEL[genreLabel.toLowerCase()] || "CANVAS"
        // Sinon dérive le code depuis le chemin d'URL
        : genrePath.toUpperCase().replace(/-/g, "_");

    // Récupère le titre depuis la page ou, à défaut, depuis l'attribut alt
    const title = textOf(titleM ? titleM[1] : "") || textOf(/alt="([^"]+)"/.exec(body)?.[1] || "");
    // Ignore la carte si aucun titre
    if (!title) continue;

    // Ajoute la carte à la liste
    out.push({
      // Numéro de série
      titleNo: titleNoM[1],
      // Genre issu de l'URL
      genrePath,
      // Slug du titre
      slug: pathM[2],
      // Titre
      title,
      // Auteur (vide si absent)
      author: authorM ? textOf(authorM[1]) : "",
      // URL de couverture (décodée) ou null
      cover: coverM ? decodeEntities(coverM[1]) : null,
      // Nombre de vues ou null
      views: viewsM ? parseCount(viewsM[1]) : null,
      // Libellé de genre
      genreLabel,
      // Code de genre
      code,
    // Fin de l'ajout
    });
  // Fin de la boucle des liens
  }
  // Renvoie les cartes trouvées
  return out;
// Fin de la fonction parseCards
}

/** Épisodes d'une page de liste (10 par page, du plus récent au plus ancien). */
// Analyse le HTML d'une page de liste pour en extraire les épisodes
function parseEpisodes(html) {
  // Liste des épisodes trouvés
  const out = [];
  // Regex globale des éléments <li> portant data-episode-no
  const re = /<li[^>]*\bdata-episode-no="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  // Déclare la correspondance courante
  let m;
  // Parcourt tous les épisodes du HTML
  while ((m = re.exec(html))) {
    // Numéro de l'épisode
    const no = Number(m[1]);
    // Contenu interne de l'élément
    const body = m[2];
    // Recherche l'attribut href
    const hrefM = /href="([^"]+)"/.exec(body);
    // Ignore si pas de href ou numéro invalide
    if (!hrefM || !Number.isFinite(no)) continue;
    // Recherche le titre de l'épisode
    const subjM = /class="subj">([\s\S]*?)<\/span>/.exec(body);
    // Recherche la date de publication
    const dateM = /class="date">([^<]*)</.exec(body);
    // Ajoute l'épisode à la liste
    out.push({
      // Numéro de l'épisode
      no,
      // Lien de l'épisode (décodé)
      href: decodeEntities(hrefM[1]),
      // Titre de l'épisode (ou valeur par défaut)
      title: subjM ? textOf(subjM[1]) : `Épisode ${no}`,
      // Date de publication ou null
      date: dateM ? textOf(dateM[1]) : null,
    // Fin de l'ajout
    });
  // Fin de la boucle des épisodes
  }
  // Renvoie les épisodes trouvés
  return out;
// Fin de la fonction parseEpisodes
}

/** Pagination d'une page de liste : numéros découverts + page suivante. */
// Analyse le bloc de pagination d'une page de liste
function parsePagination(html) {
  // Recherche le conteneur de pagination
  const box = /<div class="paginate">([\s\S]*?)<\/div>/.exec(html);
  // Renvoie une pagination vide si le conteneur est absent
  if (!box) return { pages: [], next: null };
  // Liste des numéros de page découverts
  const pages = [];
  // Numéro de la page suivante
  let next = null;
  // Regex globale des liens <a> dans le conteneur
  const anchorRe = /<a\s([^>]+)>/g;
  // Déclare le lien courant
  let a;
  // Parcourt les liens du conteneur de pagination
  while ((a = anchorRe.exec(box[1]))) {
    // Attributs du lien
    const attrs = a[1];
    // Recherche l'attribut href
    const hrefM = /href="([^"]+)"/.exec(attrs);
    // Ignore si pas de href
    if (!hrefM) continue;
    // Recherche le paramètre page
    const pgM = /[?&]page=(\d+)/.exec(hrefM[1]);
    // Ajoute le numéro de page trouvé
    if (pgM) pages.push(Number(pgM[1]));
    // Détecte le lien "page suivante"
    if (/\bpg_next\b/.test(attrs) && pgM) next = Number(pgM[1]);
  // Fin de la boucle des liens
  }
  // Renvoie les pages découvertes et la page suivante
  return { pages, next };
// Fin de la fonction parsePagination
}

/** Métadonnées d'une page de liste (= fiche du titre). */
// Analyse le HTML d'une page de liste pour en extraire la fiche du titre
function parseTitleInfo(html) {
  // Recherche le titre principal (h1)
  const h1M = /<h1 class="subj">([\s\S]*?)<\/h1>/.exec(html);
  // Recherche le titre Open Graph
  const ogTitleM = /<meta property="og:title" content="([^"]*)"/.exec(html);
  // Recherche l'URL Open Graph
  const ogUrlM = /<meta property="og:url" content="([^"]*)"/.exec(html);
  // Recherche l'image Open Graph
  const ogImageM = /<meta property="og:image" content="([^"]*)"/.exec(html);
  // Recherche le bloc auteur
  const authorM = /<div class="author_area">([\s\S]*?)<\/div>/.exec(html);
  // Recherche le résumé
  const summaryM = /<p class="summary">([\s\S]*?)<\/p>/.exec(html);
  // Recherche le genre (h2)
  const genreM = /<h2 class="genre[^"]*">([^<]*)<\/h2>/.exec(html);
  // Recherche le compteur de vues
  const viewsM = /<ul class="grade_area">[\s\S]*?<em class="cnt">([^<]+)<\/em>/.exec(html);
  // Recherche les jours de publication
  const dayM = /<p class="day_info">([\s\S]*?)<\/p>/.exec(html);

  // Détermine le titre, en retirant le suffixe "WEBTOON"
  const title = textOf(h1M ? h1M[1] : ogTitleM ? ogTitleM[1] : "").replace(/\s*[\|·-]\s*WEBTOON\s*$/i, "");
  // Détermine l'auteur
  const author = authorM
    // Nettoie le bloc auteur (retire boutons et normalise les virgules)
    ? textOf(authorM[1].replace(/<button[\s\S]*?<\/button>/g, "")).replace(/\s*,\s*/g, ", ")
    // Sinon chaîne vide
    : "";
  // Libellé de genre affiché
  const genreLabel = genreM ? textOf(genreM[1]) : "";
  // Détermine le code de genre
  const code = ogUrlM
    // Déduit le code depuis le chemin de l'URL Open Graph
    ? (/\/fr\/([a-z0-9%-]+)\//i.exec(ogUrlM[1]) || [])[1]?.toUpperCase().replace(/-/g, "_") || null
    // Sinon depuis les correspondances de libellés
    : CODE_BY_FR_LABEL[genreLabel.toLowerCase()] || CODE_BY_LABEL.get(genreLabel.toLowerCase()) || null;

  // Renvoie les métadonnées du titre
  return {
    // Titre
    title,
    // Auteur
    author,
    // Description (résumé)
    description: summaryM ? textOf(summaryM[1]) : "",
    // Couverture
    cover: ogImageM ? decodeEntities(ogImageM[1]) : null,
    // Libellé de genre
    genreLabel,
    // Code de genre
    genreCode: code,
    // Nombre de vues
    views: viewsM ? parseCount(viewsM[1]) : null,
    // Statut (terminé ou en cours)
    status: dayM && /txt_ico_completed/.test(dayM[1]) ? "completed" : "ongoing",
  // Fin de l'objet de métadonnées
  };
// Fin de la fonction parseTitleInfo
}

/** URLs des pages d'un épisode (conteneur #_imageList, classe `_images`). */
// Analyse le HTML d'un épisode pour en extraire les URLs des images
function parseViewerImages(html) {
  // Position du conteneur des images
  const start = html.indexOf('id="_imageList"');
  // Renvoie un tableau vide si le conteneur est absent
  if (start < 0) return [];
  // Position de fin du conteneur
  const end = html.indexOf("</div>", start);
  // Extrait le segment du conteneur
  const segment = html.slice(start, end > start ? end : undefined);
  // Liste des URLs d'images
  const out = [];
  // Regex globale des balises <img>
  const imgRe = /<img\b[^>]*>/g;
  // Déclare la correspondance courante
  let m;
  // Parcourt les balises image du segment
  while ((m = imgRe.exec(segment))) {
    // Balise image courante
    const tag = m[0];
    // Recherche l'attribut class
    const classM = /class="([^"]*)"/.exec(tag);
    // Ignore si ce n'est pas une image de la classe _images
    if (!classM || !/\b_images\b/.test(classM[1])) continue;
    // Recherche l'URL réelle dans data-url
    const urlM = /data-url="([^"]+)"/.exec(tag);
    // Ajoute l'URL décodée
    if (urlM) out.push(decodeEntities(urlM[1]));
  // Fin de la boucle des images
  }
  // Renvoie les URLs trouvées
  return out;
// Fin de la fonction parseViewerImages
}

// ---------------------------------------------------------------------------
// id interne : `${genre}__${slug}__${titleNo}`
// ---------------------------------------------------------------------------

// Encode un identifiant interne à partir du genre, du slug et du numéro de série
function encodeId(genrePath, slug, titleNo) {
  // Encode chaque partie et les assemble par "__"
  return [genrePath, slug, String(titleNo)].map((part) => encodeURIComponent(part)).join("__");
// Fin de la fonction encodeId
}

// Décode et valide un identifiant interne
function decodeId(raw) {
  // Découpe l'identifiant sur "__"
  const parts = String(raw || "").split("__");
  // Erreur 404 si le nombre de parties est incorrect
  if (parts.length !== 3) throw httpError(404, "Titre WEBTOON introuvable");
  // Déclare les parties décodées
  let decoded;
  // Tente de décoder chaque partie
  try {
    // Décode chaque partie de l'identifiant
    decoded = parts.map((part) => decodeURIComponent(part));
  // En cas d'URL mal formée
  } catch {
    // Utilise les parties brutes
    decoded = parts;
  // Fin du try/catch de décodage
  }
  // Déstructure les trois parties
  const [genrePath, slug, titleNo] = decoded;
  // Valide le format de chaque partie
  if (!/^[a-z0-9-]{1,40}$/i.test(genrePath) || !/^[a-z0-9-]{1,120}$/i.test(slug) || !/^\d{1,10}$/.test(titleNo)) {
    // Erreur 404 si le format est invalide
    throw httpError(404, "Titre WEBTOON introuvable");
  // Fin de la validation
  }
  // Renvoie l'identifiant décodé
  return { genrePath: genrePath.toLowerCase(), slug, titleNo };
// Fin de la fonction decodeId
}

// Construit l'URL de la liste des épisodes d'un titre
function listUrl(id, page = 1) {
  // Assemble l'URL de base de la liste
  const url = `${BASE}/fr/${encodeURIComponent(id.genrePath)}/${id.slug}/list?title_no=${id.titleNo}`;
  // Ajoute le paramètre de page si demandé
  return page > 1 ? `${url}&page=${page}` : url;
// Fin de la fonction listUrl
}

// Convertit un libellé de genre en code
function genreCodeFromLabel(label) {
  // Normalise le libellé en minuscules
  const key = String(label || "").toLowerCase();
  // Cherche le code par libellé, sinon le dérive du texte
  return CODE_BY_LABEL.get(key) || CODE_BY_FR_LABEL[key] || key.toUpperCase().replace(/\s+/g, "_");
// Fin de la fonction genreCodeFromLabel
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

// Classe de la source WEBTOON, héritant de BaseSource
class WebtoonsSource extends BaseSource {
  // Constructeur de la source
  constructor() {
    // Appelle le constructeur de BaseSource avec la configuration
    super({
      // Identifiant interne de la source
      id: "webtoons",
      // Nom affiché
      name: "WEBTOON",
      // URL de base
      baseUrl: BASE,
      // Langue de la source
      lang: "fr",
      // Version de la source
      version: "1.0.0",
      // Auteur de la source
      author: "OptiManga",
      // Début de la description
      description:
        // Description de la source
        "Plateforme officielle WEBTOON (Naver) : séries dessinées en français, ORIGINALS et CANVAS. Lecture gratuite, épisodes hebdomadaires découpés par saison.",
    // Fin de l'objet de configuration et de l'appel à super
    });
    // Initialise la liste des genres (uniquement les libellés)
    this.genres = GENRES.map(([, label]) => label);
  // Fin du constructeur
  }

  // ---- Recherche ----------------------------------------------------------

  // Recherche des titres selon la requête et les options
  async search(query = "", options = {}) {
    // Déstructure les options avec valeurs par défaut
    const { genre = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    // Nettoie la requête
    const q = String(query || "").trim();

    // Récupère le HTML (page de recherche ou accueil selon la requête)
    const html = await getHtml(
      // URL de recherche si requête, sinon accueil
      q ? `${BASE}/fr/search?keyword=${encodeURIComponent(q)}` : `${BASE}/fr/`
    );

    // Ensemble des clés déjà vues (dédoublonnage)
    const seen = new Set();
    // Liste des cartes dédoublonnées
    let cards = parseCards(html).filter((c) => {
      // Clé unique d'une carte
      const key = `${c.genrePath}/${c.slug}/${c.titleNo}`;
      // Ignore les doublons
      if (seen.has(key)) return false;
      // Marque la clé comme vue
      seen.add(key);
      // Garde la carte
      return true;
    // Fin du filtre de dédoublonnage
    });

    // Filtre par genre si un genre précis est demandé
    if (genre && genre !== "all") {
      // Convertit le libellé de genre en code
      const wanted = genreCodeFromLabel(genre);
      // Conserve les cartes du genre demandé
      cards = cards.filter((c) => c.code === wanted);
    // Fin du filtre de genre
    }

    // Table des fonctions de tri
    const sorters = {
      // Tri par popularité (vues décroissantes)
      popularity: (a, b) => (b.views || 0) - (a.views || 0),
      // Tri par nombre de chapitres (même critère faute de mieux)
      chapters: (a, b) => (b.views || 0) - (a.views || 0),
      // Tri alphabétique par titre
      title: (a, b) => a.title.localeCompare(b.title, "fr"),
    // Fin de la table de tri
    };
    // Applique le tri demandé s'il existe
    if (sorters[sort]) cards = cards.slice().sort(sorters[sort]);

    // Nombre total de résultats
    const total = cards.length;
    // Borne la limite entre 1 et 100
    const lim = Math.min(100, Math.max(1, Number(limit) || 24));
    // Borne l'offset à 0 minimum
    const off = Math.max(0, Number(offset) || 0);
    // Renvoie la page de résultats mise en forme
    return { results: cards.slice(off, off + lim).map((c) => this._result(c)), total };
  // Fin de la méthode search
  }

  // Met en forme une carte en résultat
  _result(card) {
    // Début de l'objet résultat
    return {
      // Identifiant encodé
      id: encodeId(card.genrePath, card.slug, card.titleNo),
      // Titre
      title: card.title,
      // Auteur (ou libellé par défaut)
      author: card.author || "Auteur inconnu",
      // Couverture proxifiée
      cover: images.proxied(card.cover),
      // Statut indisponible ici
      status: null,
      // Libellé de genre
      genre: card.genreLabel || "",
      // Tags (le libellé de genre ou vide)
      tags: card.genreLabel ? [card.genreLabel] : [],
      // Note indisponible
      rating: null,
      // Popularité = nombre de vues
      popularity: card.views ?? null,
      // Année indisponible
      year: null,
      // Nombre de chapitres indisponible
      chapterCount: null,
      // Identifiant de la source
      sourceId: this.id,
      // Nom de la source
      sourceName: this.name,
    // Fin de l'objet résultat
    };
  // Fin de la méthode _result
  }

  // ---- Fiche + épisodes ---------------------------------------------------

  // Récupère la fiche détaillée d'un titre
  async getMangaInfo(mangaId) {
    // Décode et valide l'identifiant
    const id = decodeId(mangaId);
    // Récupère la première page de la liste
    const first = await getHtml(listUrl(id, 1));
    // Analyse les métadonnées du titre
    const info = parseTitleInfo(first);
    // Récupère tous les épisodes
    const episodes = await this._episodeList(id, first);
    // Erreur 404 si aucun épisode
    if (!episodes.length) throw httpError(404, "Aucun épisode WEBTOON trouvé");

    // Construit la liste des chapitres triée par numéro
    const chapters = episodes
      // Copie la liste pour ne pas la modifier
      .slice()
      // Trie par numéro d'épisode croissant
      .sort((a, b) => a.no - b.no)
      // Transforme chaque épisode en chapitre
      .map((e) => ({ id: String(e.no), title: e.title || `Épisode ${e.no}`, order: e.no }));

    // Début de l'objet fiche
    return {
      // Identifiant du manga
      id: mangaId,
      // Titre (ou slug embelli)
      title: info.title || prettify(id.slug),
      // Auteur (ou libellé par défaut)
      author: info.author || "Auteur inconnu",
      // Description
      description: info.description || "",
      // Couverture proxifiée
      cover: images.proxied(info.cover),
      // Statut
      status: info.status || null,
      // Libellé de genre
      genre: info.genreLabel || "",
      // Tags (le libellé de genre ou vide)
      tags: info.genreLabel ? [info.genreLabel] : [],
      // Note indisponible
      rating: null,
      // Popularité = nombre de vues
      popularity: info.views ?? null,
      // Année indisponible
      year: null,
      // Nombre de chapitres
      chapterCount: chapters.length,
      // Liste des chapitres
      chapters,
      // Identifiant de la source
      sourceId: this.id,
      // Nom de la source
      sourceName: this.name,
    // Fin de l'objet fiche
    };
  // Fin de la méthode getMangaInfo
  }

  /**
   * Tous les épisodes du titre : suit les liens de pagination, six requêtes en
   * parallèle. Les pages hors bornes renvoient la dernière page (dédoublonnées
   * par numéro d'épisode), la boucle reste bornée.
   */
  // Récupère tous les épisodes d'un titre en suivant la pagination
  async _episodeList(id, firstHtml = null) {
    // Table des épisodes par numéro
    const byNo = new Map();
    // Ensemble des pages déjà traitées
    const done = new Set();
    // Pages en attente de traitement
    let pending = [1];
    // HTML déjà fourni (page 1) ou null
    let html = firstHtml;
    // Compteur de sécurité
    let guard = 0;

    // Boucle tant qu'il reste des pages et sous la limite de sécurité
    while (pending.length && guard++ < 500) {
      // Prend jusqu'à six pages à traiter
      const wave = pending.splice(0, 6);
      // Récupère les pages en parallèle
      const pages = await Promise.all(
        // Traite chaque numéro de page
        wave.map(async (n) => {
          // Réutilise le HTML fourni pour la page 1 si disponible
          if (n === 1 && html) return { n, html };
          // Tente de récupérer le HTML de la page
          try {
            // Renvoie le numéro et le HTML
            return { n, html: await getHtml(listUrl(id, n)) };
          // En cas d'erreur de récupération
          } catch (err) {
            // Page 404 : renvoie un HTML nul
            if (err.status === 404) return { n, html: null };
            // Sinon propage l'erreur
            throw err;
          // Fin du try/catch de page
          }
        // Fin du traitement d'un numéro de page
        })
      );
      // Réinitialise le HTML fourni
      html = null;
      // Traite chaque page récupérée
      for (const page of pages) {
        // Ignore les pages sans HTML
        if (!page.html) continue;
        // Marque la page comme traitée
        done.add(page.n);
        // Enregistre les épisodes non encore connus
        for (const ep of parseEpisodes(page.html)) if (!byNo.has(ep.no)) byNo.set(ep.no, ep);
        // Récupère les pages découvertes et la suivante
        const { pages: discovered, next } = parsePagination(page.html);
        // Ajoute les nouvelles pages à la file d'attente
        for (const n of [...discovered, next]) {
          // Ajoute la page si elle est valide et inédite
          if (n && !done.has(n) && !pending.includes(n)) pending.push(n);
        // Fin de la boucle d'ajout
        }
      // Fin du traitement des pages récupérées
      }
    // Fin de la boucle principale
    }

    // Renvoie les épisodes triés par numéro croissant
    return [...byNo.values()].sort((a, b) => a.no - b.no);
  // Fin de la méthode _episodeList
  }

  // ---- Pages d'un épisode -------------------------------------------------

  // Récupère les pages (images) d'un épisode
  async getChapterPages(mangaId, chapterId) {
    // Décode et valide l'identifiant du manga
    const id = decodeId(mangaId);
    // Convertit l'identifiant de chapitre en numéro
    const epNo = Number(chapterId);
    // Erreur 404 si le numéro d'épisode est invalide
    if (!Number.isInteger(epNo) || epNo < 1) throw httpError(404, "Épisode WEBTOON introuvable");

    // Récupère la première page de la liste
    const first = await getHtml(listUrl(id, 1));
    // Analyse les épisodes de la première page
    const firstEps = parseEpisodes(first);
    // Erreur 404 si aucun épisode
    if (!firstEps.length) throw httpError(404, "Aucun épisode WEBTOON trouvé");

    // Détermine le numéro du dernier épisode
    const total = Math.max(...firstEps.map((e) => e.no));
    // Erreur 404 si l'épisode demandé dépasse le total
    if (epNo > total) throw httpError(404, "Épisode WEBTOON introuvable");

    // Page 1 = épisodes les plus récents, d'où l'index de page ci-dessous.
    // Nombre d'épisodes par page
    const pageSize = Math.max(1, firstEps.length);
    // Calcule la page probable contenant l'épisode
    const target = Math.max(1, Math.ceil((total - epNo + 1) / pageSize));
    // Épisode recherché, initialement introuvable
    let episode = null;
    // Cas où l'épisode est sur la première page
    if (target === 1) {
      // Cherche l'épisode dans la première page
      episode = firstEps.find((e) => e.no === epNo) || null;
    // Sinon récupère une autre page
    } else {
      // Tente de récupérer la page calculée
      try {
        // Cherche l'épisode dans la page récupérée
        episode = parseEpisodes(await getHtml(listUrl(id, target))).find((e) => e.no === epNo) || null;
      // En cas d'erreur de récupération
      } catch (err) {
        // Ignore uniquement les erreurs 404
        if (err.status !== 404) throw err;
      // Fin du try/catch de page ciblée
      }
    // Fin du else
    }

    // Si l'épisode reste introuvable
    if (!episode) {
      // Formule approximative (numérotation irrégulière) : parcours complet.
      // Recherche l'épisode via la liste complète
      episode = (await this._episodeList(id, first)).find((e) => e.no === epNo) || null;
    // Fin du repli sur la liste complète
    }
    // Erreur 404 si l'épisode est toujours introuvable
    if (!episode) throw httpError(404, "Épisode WEBTOON introuvable");

    // Construit l'URL absolue de la page de lecture
    const viewerUrl = new URL(episode.href, BASE).toString();
    // Récupère les URLs des images de l'épisode
    const urls = parseViewerImages(await getHtml(viewerUrl));
    // Erreur 404 si aucune image
    if (!urls.length) throw httpError(404, "Aucune page pour cet épisode");

    // Début de l'objet épisode
    return {
      // Identifiant de l'épisode
      id: String(epNo),
      // Titre de l'épisode
      title: episode.title || null,
      // Ordre = numéro d'épisode
      order: epNo,
      // Pages proxifiées
      pages: images.proxiedAll(urls),
      // Pas de version basse résolution
      pagesLow: [],
      // Pas d'URL externe
      externalUrl: null,
    // Fin de l'objet épisode
    };
  // Fin de la méthode getChapterPages
  }
// Fin de la classe WebtoonsSource
}

// Exporte la classe pour les autres modules
module.exports = WebtoonsSource;
