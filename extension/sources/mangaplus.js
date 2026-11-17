// Active le mode strict de JavaScript (interdit certaines erreurs silencieuses)
"use strict";

// Importe le module natif "path" pour manipuler les chemins de fichiers
const path = require("path");
// Importe le module natif "crypto" (ici pour générer un UUID de session)
const crypto = require("crypto");
// Importe la bibliothèque protobufjs pour décoder les réponses protobuf
const protobuf = require("protobufjs");

// Importe la classe de base commune à toutes les sources
const BaseSource = require("../BaseSource");
// Importe le helper httpError pour créer des erreurs HTTP typées
const { httpError } = require("../utils");
// Importe le module images (proxy et User-Agent)
const images = require("../images");

/**
 * Source Manga Plus — API protobuf officielle de Shueisha (jumpg-webapi).
 *
 * Endpoints utilisés, les mêmes que le site mangaplus.shueisha.co.jp :
 *   - GET /title_list/search   index complet des titres + genres (SearchView)
 *   - GET /title_detailV3      fiche + chapitres (TitleDetailView)
 *   - GET /manga_viewer_v3     pages d'un chapitre (MangaViewer)
 *
 * Les réponses sont en protobuf : les schémas sont vendorisés dans
 * extension/mangaplus/protos (schémas communautaires « MangaPlus », références
 * de style Java XxxOuterClass.Yyy réécrites en Yyy pour protobufjs).
 *
 * Chaque requête porte un SESSION-TOKEN (UUID auto-généré) et les paramètres
 * os/os_ver/app_ver de l'application Android officielle ; lang/clang en fra.
 *
 * Accès gratuit : l'API ne renvoie que les premiers chapitres du titre et les
 * derniers publiés (abonnement requis au-delà). Les pages du lecteur
 * (jumpg-assets3) exigent l'en-tête Plus-Vw-Token (vwToken du MangaViewer) et
 * sont chiffrées en XOR (encryptionKey) : elles passent par /api/image qui
 * déchiffre ; les vignettes jumpg-assets restent directes.
 *
 * id interne = le titleId de Manga Plus (différent par langue : 1xxxxx EN,
 * 7xxxxx FR…). La variante FR est privilégiée, sinon la variante EN.
 */

// URL de base de l'API protobuf Manga Plus
const API = "https://jumpg-webapi.tokyo-cdn.com/api";
// Paramètres de l'application Android officielle (os, version OS, version app)
const APP_PARAMS = { os: "android", os_ver: "35", app_ver: "237" };
// Paramètres de langue : français pour la langue et la langue de contenu
const LANG_PARAMS = { lang: "fra", clang: "fra" };
// Dossier contenant les schémas protobuf locaux
const PROTO_DIR = path.join(__dirname, "..", "mangaplus", "protos");
// Durée de validité du cache de l'index : 30 minutes en millisecondes
const INDEX_TTL = 30 * 60_000;
// Délai maximal d'une requête HTTP : 20 secondes
const TIMEOUT_MS = 20_000;

// Genres de l'index Manga Plus (allTags), filet de sécurité hors-ligne.
// Tableau de secours des genres de l'index Manga Plus (hors-ligne)
const GENRE_TAGS = [
  // Libellé de genre "Battle / Action"
  "Battle / Action",
  // Libellé de genre "Comedy"
  "Comedy",
  // Libellé de genre "Sport / Club Activities"
  "Sport / Club Activities",
  // Libellé de genre "Mystery / Thriller"
  "Mystery / Thriller",
  // Libellé de genre "Romance"
  "Romance",
  // Libellé de genre "Horror / Supernatural"
  "Horror / Supernatural",
  // Libellé de genre "Spin-off"
  "Spin-off",
  // Libellé de genre "Sci-Fi / Fantasy"
  "Sci-Fi / Fantasy",
  // Libellé de genre "Romantic Comedy"
  "Romantic Comedy",
  // Libellé de genre "Drama"
  "Drama",
  // Libellé de genre "Food"
  "Food",
  // Libellé de genre "History / Period"
  "History / Period",
  // Libellé de genre "Gangsta"
  "Gangsta",
  // Libellé de genre "One-shot"
  "One-shot",
  // Libellé de genre "Manga Award"
  "Manga Award",
// Fin du tableau GENRE_TAGS
];

// Libellé de filtre partagé (MangaDex / WEBTOON) -> libellés Manga Plus.
// Table des alias de genres : libellé normalisé -> libellés Manga Plus
const GENRE_ALIASES = {
  // Alias "action" -> ["battle / action"]
  action: ["battle / action"],
  // Alias "sport" -> ["sport / club activities"]
  sport: ["sport / club activities"],
  // Alias "sports" -> ["sport / club activities"]
  sports: ["sport / club activities"],
  // Alias "mystery" -> ["mystery / thriller"]
  mystery: ["mystery / thriller"],
  // Alias "thriller" -> ["mystery / thriller"]
  thriller: ["mystery / thriller"],
  // Alias "horror" -> ["horror / supernatural"]
  horror: ["horror / supernatural"],
  // Alias "supernatural" -> ["horror / supernatural"]
  supernatural: ["horror / supernatural"],
  // Alias "sci-fi" -> ["sci-fi / fantasy"]
  "sci-fi": ["sci-fi / fantasy"],
  // Alias "science-fiction" -> ["sci-fi / fantasy"]
  "science-fiction": ["sci-fi / fantasy"],
  // Alias "science fiction" -> ["sci-fi / fantasy"]
  "science fiction": ["sci-fi / fantasy"],
  // Alias "fantasy" -> ["sci-fi / fantasy"]
  fantasy: ["sci-fi / fantasy"],
  // Alias "historical" -> ["history / period"]
  historical: ["history / period"],
  // Alias "history" -> ["history / period"]
  history: ["history / period"],
  // Alias "comedy" -> ["comedy", "romantic comedy"]
  comedy: ["comedy", "romantic comedy"],
  // Alias "romance" -> ["romance", "romantic comedy"]
  romance: ["romance", "romantic comedy"],
// Fin de l'objet GENRE_ALIASES
};

// Normalise une chaîne : minuscules, sans accents, espaces compactés
function norm(str) {
  // Convertit l'entrée en chaîne (vide si nulle) puis applique les transformations
  return String(str || "")
    // Met la chaîne en minuscules
    .toLowerCase()
    // Décompose les caractères accentués (lettre + accent séparés)
    .normalize("NFD")
    // Supprime les accents (diacritiques séparés)
    .replace(/[\u0300-\u036f]/g, "")
    // Remplace les suites d'espaces par un seul espace
    .replace(/\s+/g, " ")
    // Supprime les espaces en début et fin
    .trim();
// Fin de la fonction norm
}

// Valide et convertit un identifiant en entier strictement positif
function parseId(raw) {
  // Convertit la valeur brute en nombre
  const id = Number(raw);
  // Vérifie que c'est un entier positif sans caractères superflus
  if (!Number.isInteger(id) || id <= 0 || String(raw).trim() !== String(id)) {
    // Lève une erreur 404 si l'identifiant est invalide
    throw httpError(404, "Titre Manga Plus introuvable");
  // Fin du if de validation
  }
  // Renvoie l'identifiant validé
  return id;
// Fin de la fonction parseId
}

/** #001 / Chapitre 141 / Chapter 3 -> numéro ; sinon ordre précédent + 1. */
// Détermine l'ordre d'un chapitre d'après son nom, sous-titre ou l'ordre précédent
function chapterOrder(chapter, prevOrder) {
  // Cherche un numéro du type "#001" dans le nom du chapitre
  const fromName = /#0*(\d+)/.exec(chapter.name || "");
  // Si trouvé, renvoie ce numéro
  if (fromName) return Number(fromName[1]);
  // Sinon cherche "chapitre N" ou "chapter N" dans le sous-titre
  const fromSub = /(?:chapitre|chapter)\s+(\d+)/i.exec(chapter.subTitle || "");
  // Si trouvé, renvoie ce numéro
  if (fromSub) return Number(fromSub[1]);
  // Sinon incrémente l'ordre précédent
  return prevOrder + 1;
// Fin de la fonction chapterOrder
}

// Déduit le statut de publication à partir des labels du titre
function statusOf(detail) {
  // Récupère le calendrier de parution en majuscules
  const schedule = ((detail.titleLabels || {}).releaseSchedule || "").toUpperCase();
  // Statut "terminé" si l'œuvre est complète ou un one-shot
  if (schedule === "COMPLETED" || schedule === "ONE_SHOT") return "completed";
  // Statut "en pause"
  if (schedule === "HIATUS") return "hiatus";
  // Statut "en cours" pour les parutions régulières (début de la condition)
  if (schedule === "EVERYDAY" || schedule === "WEEKLY" || schedule === "BIWEEKLY" || schedule === "MONTHLY" ||
      // Suite de la condition précédente, renvoie "ongoing"
      schedule === "BIMONTHLY" || schedule === "TRIMONTHLY") return "ongoing";
  // Statut inconnu
  return null;
// Fin de la fonction statusOf
}

// Construit un message texte à partir d'une popup d'erreur de l'API
function popupMessage(popup) {
  // Renvoie une chaîne vide si aucune popup
  if (!popup) return "";
  // Cas d'une popup simple avec sujet et/ou corps
  if (popup.subject !== undefined || popup.body !== undefined) {
    // Assemble sujet et corps présents, séparés par un tiret long
    return [popup.subject, popup.body].filter(Boolean).join(" — ");
  // Fin du if popup simple
  }
  // Sinon récupère la popup imbriquée (par défaut OS ou app)
  const inner = popup.oSDefault || popup.appDefault;
  // Assemble les champs de la popup imbriquée
  if (inner) return [inner.subject, inner.body].filter(Boolean).join(" — ");
  // Aucun message exploitable
  return "";
// Fin de la fonction popupMessage
}

// Extrait un texte lisible depuis un objet d'erreur de l'API
function errorText(error) {
  // Liste des popups candidates (anglais, espagnol, puis liste générique)
  const candidates = [error.englishPopup, error.spanishPopup, ...(error.popups || [])];
  // Parcourt les popups candidates
  for (const popup of candidates) {
    // Construit le message de la popup courante
    const msg = popupMessage(popup);
    // Renvoie le premier message non vide, préfixé
    if (msg) return `Manga Plus : ${msg}`;
  // Fin de la boucle sur les popups
  }
  // Sinon renvoie le détail de debug s'il existe
  if (error.debugInfo) return `Manga Plus : erreur API (${error.debugInfo})`;
  // Sinon message d'erreur générique
  return "Manga Plus : erreur API";
// Fin de la fonction errorText
}

// Convertit une action d'erreur de l'API en code HTTP
function errorStatus(action) {
  // 503 pour maintenance ou blocage géographique
  if (action === "MAINTENANCE" || action === "GEOIP_BLOCKING") return 503;
  // 403 si non autorisé
  if (action === "UNAUTHORIZED") return 403;
  // 502 par défaut (mauvaise passerelle)
  return 502;
// Fin de la fonction errorStatus
}

// Chargement paresseux des schémas (une seule fois pour tout le processus).
// Cache du type protobuf Response (chargé une seule fois)
let responseTypeCache = null;
// Renvoie le type protobuf Response, en le chargeant au besoin
function responseType() {
  // Charge le schéma uniquement s'il n'est pas déjà en cache
  if (!responseTypeCache) {
    // Charge le fichier .proto racine
    const root = protobuf.loadSync(path.join(PROTO_DIR, "ResponseOuterClass.proto"));
    // Recherche le type Response dans le schéma
    responseTypeCache = root.lookupType("mangaplus_api_protocol.Response");
  // Fin du chargement conditionnel
  }
  // Renvoie le type mis en cache
  return responseTypeCache;
// Fin de la fonction responseType
}

// Classe de la source Manga Plus, héritant de BaseSource
class MangaPlusSource extends BaseSource {
  // Constructeur de la source
  constructor() {
    // Appelle le constructeur de BaseSource avec la configuration
    super({
      // Identifiant interne de la source
      id: "mangaplus",
      // Nom affiché
      name: "Manga Plus",
      // URL du site officiel
      baseUrl: "https://mangaplus.shueisha.co.jp",
      // Langue de la source
      lang: "fr",
      // Version de la source
      version: "1.0.0",
      // Auteur de la source
      author: "OptiManga",
      // Début de la description (concaténation de chaînes)
      description:
        // Première partie de la description
        "Plateforme officielle Shueisha (Manga Plus) : One Piece, Jujutsu Kaisen, Chainsaw Man… " +
        // Deuxième partie de la description
        "Catalogue multilingue avec titres en français, API protobuf officielle. " +
        // Dernière partie de la description
        "Accès gratuit : premiers chapitres et dernières sorties (abonnement au-delà).",
    // Fin de l'objet de configuration et de l'appel à super
    });
    // Initialise la liste des genres (copie du tableau de secours)
    this.genres = GENRE_TAGS.slice();
    // Génère un identifiant de session unique (UUID)
    this._session = crypto.randomUUID();
    // Cache de l'index des titres, initialement vide
    this._indexData = null;
    // Horodatage du cache de l'index
    this._indexAt = 0;
    // Promesse de chargement de l'index en cours (verrou)
    this._indexLoad = null;
  // Fin du constructeur
  }

  // ---- Appels API protobuf ------------------------------------------------

  // Appelle un endpoint de l'API protobuf et renvoie la partie "success"
  async _call(endpoint, params = {}) {
    // Construit l'URL complète de l'endpoint
    const url = new URL(`${API}/${endpoint}`);
    // Fusionne paramètres app, langue et spécifiques, puis les parcourt
    for (const [key, value] of Object.entries({ ...APP_PARAMS, ...LANG_PARAMS, ...params })) {
      // Ajoute le paramètre à l'URL s'il a une valeur utile
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    // Fin de la boucle des paramètres
    }

    // Déclare la réponse HTTP
    let res;
    // Tente la requête réseau
    try {
      // Envoie la requête avec en-têtes et timeout
      res = await fetch(url, {
        // Début des en-têtes HTTP
        headers: {
          // En-tête de session (UUID)
          "SESSION-TOKEN": this._session,
          // En-tête User-Agent commun
          "User-Agent": images.USER_AGENT,
        // Fin des en-têtes
        },
        // Annule la requête après le délai imparti
        signal: AbortSignal.timeout(TIMEOUT_MS),
      // Fin de l'appel fetch
      });
    // En cas d'échec réseau
    } catch (err) {
      // Détermine la raison (timeout ou message d'erreur)
      const reason = err.name === "TimeoutError" ? "délai dépassé" : err.message;
      // Lève une erreur 502
      throw httpError(502, `Manga Plus injoignable (${reason})`);
    // Fin du catch réseau
    }
    // Erreur 502 si le statut HTTP n'est pas 2xx
    if (!res.ok) throw httpError(502, `Manga Plus : réponse HTTP ${res.status}`);

    // Lit le corps de la réponse en Buffer binaire
    const buf = Buffer.from(await res.arrayBuffer());
    // Erreur 502 si le corps est vide
    if (!buf.length) throw httpError(502, "Manga Plus : réponse vide");

    // Déclare l'objet décodé
    let decoded;
    // Tente de décoder le protobuf
    try {
      // Récupère le type protobuf Response
      const type = responseType();
      // Décode le Buffer en objet JS (énumérations et longs en chaînes)
      decoded = type.toObject(type.decode(buf), { enums: String, longs: String });
    // En cas d'échec de décodage
    } catch {
      // Lève une erreur 502
      throw httpError(502, "Manga Plus : réponse illisible");
    // Fin du try/catch de décodage
    }

    // Détecte une erreur renvoyée par l'API
    if (decoded.error && Object.keys(decoded.error).length) {
      // Récupère l'objet d'erreur
      const err = decoded.error;
      // Construit le texte d'erreur
      const text = errorText(err);
      // Lève une erreur HTTP adaptée (404 si "not found")
      throw httpError(/not found/i.test(text) ? 404 : errorStatus(err.action), text);
    // Fin du traitement d'erreur API
    }
    // Récupère la partie "success" du message
    const success = decoded.success;
    // Erreur 502 si le succès est absent ou vide
    if (!success || !Object.keys(success).length) throw httpError(502, "Manga Plus : réponse vide");
    // Renvoie les données utiles
    return success;
  // Fin de la méthode _call
  }

  /** Index des titres (SearchView), mis en cache 30 min. */
  // Charge (et met en cache 30 min) l'index des titres
  async _index() {
    // Renvoie le cache s'il est encore valide
    if (this._indexData && Date.now() - this._indexAt < INDEX_TTL) return this._indexData;
    // Renvoie le chargement en cours s'il existe
    if (this._indexLoad) return this._indexLoad;

    // Démarre le chargement asynchrone de l'index
    this._indexLoad = (async () => {
      // Appelle l'endpoint de recherche/liste des titres
      const success = await this._call("title_list/search");
      // Récupère la vue SearchView
      const view = success.searchView || {};
      // Récupère les groupes de titres
      const groups = view.allTitlesGroup || [];
      // Erreur 502 si aucun groupe
      if (!groups.length) throw httpError(502, "Manga Plus : index des titres vide");
      // Construit et stocke les données d'index
      this._indexData = {
        // Groupes de titres
        groups,
        // Liste des tags de genres nettoyés
        tags: (view.allTags || []).map((t) => String(t.tag || "").trim()).filter(Boolean),
      // Fin de l'objet d'index
      };
      // Enregistre l'horodatage du cache
      this._indexAt = Date.now();
      // Libère le verrou de chargement
      this._indexLoad = null;
      // Renvoie les données d'index
      return this._indexData;
    // En cas d'échec du chargement
    })().catch((err) => {
      // Libère le verrou
      this._indexLoad = null;
      // Propage l'erreur
      throw err;
    // Fin de la chaîne de promesse
    });
    // Renvoie la promesse de chargement
    return this._indexLoad;
  // Fin de la méthode _index
  }

  // ---- Genres -------------------------------------------------------------

  // Renvoie la liste des genres disponibles
  async getGenres() {
    // Tente de récupérer les genres depuis l'index
    try {
      // Charge l'index et extrait les tags
      const { tags } = await this._index();
      // Renvoie les tags s'il y en a
      if (tags.length) return tags;
    // Si l'index est indisponible
    } catch {
      // index indisponible : libellés statiques
    // Fin du try/catch
    }
    // Renvoie la liste de genres statique de secours
    return GENRE_TAGS;
  // Fin de la méthode getGenres
  }

  // ---- Recherche ----------------------------------------------------------

  /** Variante FR du groupe de titres, sinon EN, sinon la première. */
  // Choisit la variante FR du groupe, sinon EN, sinon la première
  static _variant(group) {
    // Récupère la liste des variantes de titre
    const titles = group.titles || [];
    // Renvoie null s'il n'y a aucune variante
    if (!titles.length) return null;
    // Début de l'expression de sélection
    return (
      // Cherche d'abord la variante française
      titles.find((t) => t.language === "FRENCH") ||
      // Sinon la variante anglaise
      titles.find((t) => t.language === "ENGLISH") ||
      // Sinon la première variante
      titles[0]
    // Fin de l'expression de sélection
    );
  // Fin de la méthode _variant
  }

  // Extrait les tags nettoyés d'un groupe de titres
  static _tagsOf(group) {
    // Convertit, nettoie et filtre les tags
    return (group.tags || []).map((t) => String(t.tag || "").trim()).filter(Boolean);
  // Fin de la méthode _tagsOf
  }

  // Recherche des titres selon la requête et les options
  async search(query = "", options = {}) {
    // Déstructure les options avec valeurs par défaut
    const { genre = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    // Charge l'index et récupère les groupes
    const { groups } = await this._index();
    // Normalise la requête
    const q = norm(query);

    // Initialise la liste des éléments candidats
    let items = [];
    // Parcourt chaque groupe de titres
    for (const group of groups) {
      // Sélectionne la variante à afficher
      const title = MangaPlusSource._variant(group);
      // Ignore les groupes sans titre valide
      if (!title || !title.titleId) continue;
      // Ajoute un élément candidat
      items.push({
        // Variante de titre retenue
        title,
        // Tags du groupe
        tags: MangaPlusSource._tagsOf(group),
        // Nom normalisé pour l'affichage/la recherche
        display: norm(title.name || group.theTitle),
        // Auteur normalisé
        author: norm(title.author),
        // Titre principal du groupe normalisé
        theTitle: norm(group.theTitle),
      // Fin de l'ajout
      });
    // Fin de la boucle de construction
    }

    // Filtre par requête textuelle si présente
    if (q) {
      // Conserve les éléments dont le titre, le titre principal ou l'auteur contient q
      items = items.filter(
        // Prédicat de filtrage
        (it) => it.display.includes(q) || it.theTitle.includes(q) || it.author.includes(q)
      // Fin du filter
      );
    // Fin du filtre texte
    }

    // Filtre par genre si un genre précis est demandé
    if (genre && genre !== "all") {
      // Construit l'ensemble des libellés de genre acceptés (avec alias)
      const wanted = new Set([norm(genre), ...((GENRE_ALIASES[norm(genre)] || []).map(norm))]);
      // Conserve les éléments ayant au moins un tag attendu
      items = items.filter((it) => it.tags.some((tag) => wanted.has(norm(tag))));
    // Fin du filtre de genre
    }

    // Sans tri explicite : on conserve l'ordre de l'API (titres en vedette d'abord).
    // Trie par titre si demandé
    if (sort === "title") items = items.slice().sort((a, b) => a.display.localeCompare(b.display, "fr"));

    // Nombre total de résultats
    const total = items.length;
    // Borne la limite entre 1 et 100
    const lim = Math.min(100, Math.max(1, Number(limit) || 24));
    // Borne l'offset à 0 minimum
    const off = Math.max(0, Number(offset) || 0);
    // Renvoie la page de résultats mise en forme
    return { results: items.slice(off, off + lim).map((it) => this._result(it.title, it.tags)), total };
  // Fin de la méthode search
  }

  // Met en forme un titre sous forme de résultat
  _result(title, tags) {
    // Début de l'objet résultat
    return {
      // Identifiant = titleId
      id: String(title.titleId),
      // Titre (ou libellé par défaut)
      title: String(title.name || "").trim() || "Sans titre",
      // Auteur (ou libellé par défaut)
      author: String(title.author || "").trim() || "Auteur inconnu",
      // Image de couverture (portrait puis paysage)
      cover: title.portraitImageUrl || title.landscapeImageUrl || null,
      // Statut indisponible ici
      status: null,
      // Premier genre
      genre: tags[0] || "",
      // Liste des tags
      tags,
      // Note indisponible
      rating: null,
      // Popularité indisponible
      popularity: null,
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

  // ---- Fiche manga --------------------------------------------------------

  // Récupère la fiche détaillée d'un manga
  async getMangaInfo(mangaId) {
    // Valide l'identifiant de titre
    const titleId = parseId(mangaId);
    // Appelle l'endpoint de détail du titre
    const success = await this._call("title_detailV3", { title_id: titleId });
    // Récupère la vue TitleDetailView
    const detail = success.titleDetailView;
    // Vérifie que le détail est complet
    if (!detail || !detail.title || !detail.title.titleId) {
      // Erreur 404 si introuvable
      throw httpError(404, "Titre Manga Plus introuvable");
    // Fin de la vérification
    }

    // Extrait et nettoie les tags
    const tags = (detail.tags || []).map((t) => String(t.tag || "").trim()).filter(Boolean);
    // Construit la liste des chapitres
    const chapters = this._chapters(detail);
    // Convertit le nombre de vues en nombre
    const views = Number(detail.numberOfViews);

    // Début de l'objet fiche
    return {
      // Identifiant du titre
      id: String(detail.title.titleId),
      // Titre
      title: String(detail.title.name || "").trim() || "Sans titre",
      // Auteur
      author: String(detail.title.author || "").trim() || "Auteur inconnu",
      // Description
      description: String(detail.overview || "").trim(),
      // Couverture
      cover: detail.title.portraitImageUrl || detail.title.landscapeImageUrl || null,
      // Statut de publication
      status: statusOf(detail),
      // Premier genre
      genre: tags[0] || "",
      // Tags
      tags,
      // Note indisponible
      rating: null,
      // Popularité = nombre de vues si valide
      popularity: Number.isFinite(views) && views > 0 ? views : null,
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
   * Chapitres gratuits renvoyés par la fiche : groupes first/mid/last (ordre
   * croissant) + listes plates éventuelles, dédoublonnés par chapterId.
   */
  // Construit la liste dédoublonnée des chapitres gratuits
  _chapters(detail) {
    // Début du tableau des chapitres candidats
    const candidates = [
      // Chapitres du début
      ...(detail.firstChapterList || []),
      // Chapitres de la fin
      ...(detail.lastChapterList || []),
      // Liste plate éventuelle
      ...(detail.chapterListV2 || []),
    // Fin du tableau des candidats
    ];
    // Parcourt les groupes de chapitres s'il y en a
    for (const group of detail.chapterListGroup || []) {
      // Ajoute au tableau les chapitres du groupe
      candidates.push(
        // Chapitres du début du groupe
        ...(group.firstChapterList || []),
        // Chapitres du milieu du groupe
        ...(group.midChapterList || []),
        // Chapitres de la fin du groupe
        ...(group.lastChapterList || [])
      // Fin du push
      );
    // Fin de la boucle des groupes
    }

    // Ensemble des identifiants déjà vus (dédoublonnage)
    const seen = new Set();
    // Liste finale des chapitres
    const chapters = [];
    // Ordre du chapitre précédent
    let prevOrder = 0;
    // Parcourt tous les chapitres candidats
    for (const ch of candidates) {
      // Ignore les entrées vides ou déjà vues
      if (!ch || !ch.chapterId || seen.has(ch.chapterId)) continue;
      // Marque l'identifiant comme vu
      seen.add(ch.chapterId);
      // Calcule l'ordre du chapitre
      const order = chapterOrder(ch, prevOrder);
      // Met à jour l'ordre précédent (au moins +1)
      prevOrder = Math.max(prevOrder + 1, order);
      // Ajoute le chapitre à la liste
      chapters.push({
        // Identifiant du chapitre
        id: String(ch.chapterId),
        // Titre du chapitre (ou valeur par défaut)
        title: String(ch.subTitle || ch.name || "").trim() || `Chapitre ${ch.chapterId}`,
        // Ordre du chapitre
        order,
      // Fin de l'ajout
      });
    // Fin de la boucle
    }
    // Renvoie les chapitres triés par ordre croissant
    return chapters.sort((a, b) => a.order - b.order);
  // Fin de la méthode _chapters
  }

  // ---- Pages d'un chapitre ------------------------------------------------

  // Récupère les pages (images) d'un chapitre
  async getChapterPages(mangaId, chapterId) {
    // Valide l'identifiant du manga (sans l'utiliser)
    parseId(mangaId);
    // Valide et convertit l'identifiant du chapitre
    const cid = parseId(chapterId);

    // Appelle l'endpoint du lecteur de chapitre
    const success = await this._call("manga_viewer_v3", {
      // Identifiant du chapitre
      chapter_id: cid,
      // Active le découpage des images
      split: "yes",
      // Qualité d'image maximale
      img_quality: "super_high",
      // Mode de lecture vertical
      viewer_mode: "vertical",
    // Fin de l'appel
    });
    // Récupère la vue MangaViewer
    const viewer = success.mangaViewer;
    // Erreur 404 si le chapitre est introuvable
    if (!viewer) throw httpError(404, "Chapitre Manga Plus introuvable");

    // Récupère le jeton de visualisation (vwToken)
    const vwt = String(viewer.vwToken || "");
    // Liste des pages
    const pages = [];
    // Parcourt les pages du chapitre
    for (const page of viewer.pages || []) {
      // Récupère l'objet mangaPage
      const mp = page.mangaPage;
      // Ajoute l'URL d'image proxifiée avec jeton et clé de déchiffrement
      if (mp && mp.imageUrl) pages.push(images.proxied(mp.imageUrl, { vwt, k: mp.encryptionKey }));
    // Fin de la boucle des pages
    }
    // Erreur 404 si aucune page
    if (!pages.length) throw httpError(404, "Aucune page pour ce chapitre");

    // Début de l'objet chapitre
    return {
      // Identifiant du chapitre
      id: String(cid),
      // Nom du chapitre
      title: viewer.chapterName || null,
      // Ordre indisponible
      order: null,
      // Liste des pages
      pages,
      // Pas de version basse résolution
      pagesLow: [],
      // Pas d'URL externe
      externalUrl: null,
    // Fin de l'objet chapitre
    };
  // Fin de la méthode getChapterPages
  }
// Fin de la classe MangaPlusSource
}

// Exporte la classe pour les autres modules
module.exports = MangaPlusSource;
