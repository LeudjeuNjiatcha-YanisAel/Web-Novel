// Active le mode strict de JavaScript : toute variable non déclarée ou affectation interdite lève une erreur.
"use strict";

// Importe la classe mère BaseSource, contrat commun à toutes les sources (id, recherche, lecture).
const BaseSource = require("../BaseSource");
// Importe httpError, fabrique d'erreurs HTTP typées (404, 502…) pour remonter proprement les échecs.
const { httpError } = require("../utils");
// Importe les utilitaires d'images partagés par les sources (proxy de couvertures).
const images = require("../images");

/**
 * Source Anime VF — catalogue AniList (métadonnées) + lecture via OpenOtaku.
 *
 * AniList (graphql.anilist.co) fournit un catalogue légal et gratuit : titres,
 * synopsis, couvertures, genres, année, studios… mais aucun flux vidéo.
 *
 * Pour la lecture, cette source interroge **OpenOtaku** (open-otaku.me) :
 *   1. on recherche l'animé par son titre (anglais puis romanji) ;
 *   2. on récupère ses épisodes (`/api/episodes`) en VF, à défaut VOSTFR ;
 *   3. chaque épisode expose les lecteurs tiers (Vidzy, Lulu…) en `externalUrl`
 *      + `players`, que le lecteur maison incruste directement (aucune
 *      redirection externe).
 *
 * Si aucun équivalent n'est trouvé sur OpenOtaku, on retombe sur les liens
 * officiels AniList (comportement historique).
 */

// URL du point d'entrée GraphQL d'AniList, unique fournisseur des métadonnées d'animés.
const API = "https://graphql.anilist.co";
// User-Agent présenté à AniList et OpenOtaku pour identifier OptiManga comme lecteur auto-hébergé.
const UA = "OptiManga/2.0 (lecteur auto-heberge)";

// Domaine racine d'OpenOtaku, l'hébergeur des épisodes VF et VOSTFR.
const OO_BASE = "https://open-otaku.me";
// Délai maximal (20 s) accordé à une requête OpenOtaku avant son annulation.
const OO_TIMEOUT = 20_000;
// Cadence minimale (700 ms) entre deux appels OpenOtaku pour ne pas déclencher son anti-flood.
const OO_MIN_INTERVAL = 700; // ms entre deux appels OpenOtaku
// Fraîcheur (10 min) du cache des recherches OpenOtaku avant un nouvel appel réseau.
const OO_SEARCH_TTL = 10 * 60_000;
// Fraîcheur (30 min) du cache des épisodes OpenOtaku, plus stables que les recherches.
const OO_EPS_TTL = 30 * 60_000;

// Genres AniList proposés au filtrage par genre dans l'interface.
const GENRES = [
  // Genre « Action » : combats, poursuites et scènes spectaculaires.
  "Action",
  // Genre « Adventure » : quêtes, voyages et exploration.
  "Adventure",
  // Genre « Comedy » : humour et situations légères.
  "Comedy",
  // Genre « Drama » : conflits émotionnels et enjeux sérieux.
  "Drama",
  // Genre « Ecchi » : fan-service et allusions suggestives.
  "Ecchi",
  // Genre « Fantasy » : magie, créatures et mondes imaginaires.
  "Fantasy",
  // Genre « Horror » : horreur, épouvante et effroi.
  "Horror",
  // Genre « Mahou Shoujo » : jeunes filles magiques et transformations.
  "Mahou Shoujo",
  // Genre « Mecha » : robots géants et combats de machines.
  "Mecha",
  // Genre « Music » : musique, groupes et performances scéniques.
  "Music",
  // Genre « Mystery » : énigmes et enquêtes à élucider.
  "Mystery",
  // Genre « Psychological » : jeux mentaux et troubles psychologiques.
  "Psychological",
  // Genre « Romance » : histoires d'amour et relations amoureuses.
  "Romance",
  // Genre « Sci-Fi » : science-fiction, technologies et futurs spéculatifs.
  "Sci-Fi",
  // Genre « Slice of Life » : tranches de vie quotidiennes et douces.
  "Slice of Life",
  // Genre « Sports » : compétitions et disciplines sportives.
  "Sports",
  // Genre « Supernatural » : pouvoirs et phénomènes surnaturels.
  "Supernatural",
  // Genre « Thriller » : suspense intense et rebondissements.
  "Thriller",
// Fin de la liste des genres AniList proposés aux filtres.
];

// Correspondance entre les clés de tri de l'application et les valeurs MediaSort d'AniList.
const SORTS = {
  // Tri « relevance » : pertinence par rapport au texte recherché (SEARCH_MATCH).
  relevance: "SEARCH_MATCH",
  // Tri « popularity » : animés les plus populaires en premier.
  popularity: "POPULARITY_DESC",
  // Tri « rating » : meilleures notes AniList en premier.
  rating: "SCORE_DESC",
  // Tri « recent » : date de diffusion la plus récente en premier.
  recent: "START_DATE_DESC",
  // Tri « chapters » : nombre d'épisodes décroissant.
  chapters: "EPISODES_DESC",
  // Tri « title » : ordre alphabétique selon le titre romanji.
  title: "TITLE_ROMAJI",
// Fin de la table des tris proposés à l'utilisateur.
};

// Conversion des statuts AniList (anglais) vers les statuts utilisés par l'application.
const STATUS_TO_APP = {
  // RELEASING (en diffusion) devient « ongoing ».
  RELEASING: "ongoing",
  // FINISHED (terminé) devient « completed ».
  FINISHED: "completed",
  // HIATUS (en pause) devient « hiatus ».
  HIATUS: "hiatus",
  // CANCELLED (annulé) devient « cancelled ».
  CANCELLED: "cancelled",
  // NOT_YET_RELEASED (à venir) est classé « ongoing ».
  NOT_YET_RELEASED: "ongoing",
// Fin de la table de conversion des statuts AniList.
};

// Conversion inverse : des statuts de l'application vers les statuts AniList (filtre de recherche).
const APP_TO_STATUS = {
  // « ongoing » envoie RELEASING à AniList.
  ongoing: "RELEASING",
  // « completed » envoie FINISHED à AniList.
  completed: "FINISHED",
  // « hiatus » envoie HIATUS à AniList.
  hiatus: "HIATUS",
  // « cancelled » envoie CANCELLED à AniList.
  cancelled: "CANCELLED",
// Fin de la table de conversion inverse.
};

// Fragment GraphQL listant les champs d'animé récupérés par toutes les requêtes.
const MEDIA_FIELDS = `
  id
  title { romaji english native }
  coverImage { extraLarge large color }
  description(asHtml: false)
  genres
  averageScore
  popularity
  seasonYear
  episodes
  duration
  status
  format
  countryOfOrigin
  studios(isMain: true) { nodes { name } }
`;


// Intervalle minimal (350 ms) entre deux requêtes AniList pour rester dans son quota.
const MIN_INTERVAL = 350;
// Horodatage du dernier appel AniList, utilisé pour calculer le prochain délai d'attente.
let lastRequest = 0;
// File d'attente sérialisant les appels AniList : une requête après l'autre.
let queue = Promise.resolve();

// Enveloppe une requête AniList pour l'espacer dans le temps et la sérialiser.
function throttle(fn) {
  // Attend la requête précédente puis applique l'intervalle minimal avant d'exécuter.
  const run = queue.then(async () => {
    // Calcule le temps d'attente restant depuis le dernier appel AniList.
    const wait = Math.max(0, MIN_INTERVAL - (Date.now() - lastRequest));
    // Si le délai minimal n'est pas écoulé, patiente avant de continuer.
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Enregistre l'instant de départ de cette requête pour la suivante.
    lastRequest = Date.now();
    // Lance effectivement la requête une fois le créneau libre.
    return fn();
  // Fin du callback exécuté par le throttle AniList.
  });
  // Met à jour la file même si la requête échoue, pour ne pas la bloquer.
  queue = run.then(() => {}, () => {});
  // Renvoie la promesse de cette requête à l'appelant.
  return run;
// Fin de la fonction throttle.
}

// Exécute une requête GraphQL sur AniList, avec réessais et délai de garde.
function gql(query, variables) {
  // Fait passer l'appel par le throttle AniList pour respecter son quota.
  return throttle(async () => {
    // Garde la dernière erreur pour la restituer si les trois essais échouent.
    let lastErr = null;
    // Tente jusqu'à trois fois la requête AniList avant d'abandonner.
    for (let attempt = 0; attempt < 3; attempt++) {
      // Contrôleur permettant d'annuler la requête si elle traîne trop.
      const ctrl = new AbortController();
      // Minuteur qui coupe la requête au bout de 20 secondes.
      const timer = setTimeout(() => ctrl.abort(), 20000);
      // Capture les erreurs réseau ou HTTP pour pouvoir réessayer.
      try {
        // Envoie la requête GraphQL à AniList en POST.
        const res = await fetch(API, {
          // L'API AniList n'accepte que des requêtes POST GraphQL.
          method: "POST",
          // En-têtes HTTP attendus par AniList (identification et JSON).
          headers: {
            // S'identifie comme OptiManga auprès d'AniList.
            "User-Agent": UA,
            // Indique que le corps envoyé est du JSON.
            "Content-Type": "application/json",
            // Demande une réponse au format JSON.
            Accept: "application/json",
          // Fin des en-têtes HTTP.
          },
          // Corps GraphQL sérialisé contenant la requête et ses variables.
          body: JSON.stringify({ query, variables }),
          // Permet d'annuler la requête via le contrôleur.
          signal: ctrl.signal,
        // Fin de l'appel fetch vers AniList.
        });
        // Requête reçue : annule le minuteur de garde.
        clearTimeout(timer);
        // Sur 429 ou erreur serveur 5xx, on retente après une pause.
        if (res.status === 429 || res.status >= 500) {
          // Mémorise l'erreur en cas d'échec définitif.
          lastErr = new Error(`AniList HTTP ${res.status}`);
          // Attente croissante (600 ms × tentative) avant le prochain essai.
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          // Passe directement à la tentative suivante.
          continue;
        // Fin du bloc de réessai 429/5xx.
        }
        // Lit le JSON de la réponse, ou null si le corps n'est pas exploitable.
        const data = await res.json().catch(() => null);
        // Détecte une réponse en erreur ou un tableau d'erreurs GraphQL.
        if (!res.ok || (data && data.errors)) {
          // Construit le message d'erreur à remonter à l'application.
          const msg =
            // Utilise en priorité le message de la première erreur GraphQL.
            (data && data.errors && data.errors[0] && data.errors[0].message) ||
            // Sinon retombe sur un libellé générique avec le code HTTP.
            `AniList HTTP ${res.status}`;
          // Remonte l'erreur à l'application avec le statut approprié.
          throw httpError(res.ok ? 502 : res.status, msg);
        // Fin du bloc de gestion des erreurs GraphQL.
        }
        // Renvoie la charge utile de la réponse GraphQL.
        return data.data;
      // Rattrape les erreurs réseau et les erreurs HTTP non typées.
      } catch (err) {
        // Stoppe le minuteur pour éviter une annulation tardive.
        clearTimeout(timer);
        // Une erreur HTTP déjà typée (404, 502…) est définitive.
        if (err.status) throw err;
        // Mémorise l'erreur réseau pour le message final.
        lastErr = err;
        // Pause croissante (400 ms × tentative) avant le nouvel essai.
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      // Fin du bloc catch des erreurs réseau.
      }
    // Fin de la boucle des trois tentatives.
    }
    // Les trois essais ont échoué : signale AniList comme injoignable (502).
    throw httpError(502, `AniList injoignable : ${lastErr ? lastErr.message : "timeout"}`);
  // Fin du callback exécuté par le throttle AniList.
  });
// Fin de la fonction gql.
}


// Version promisifiée de setTimeout, pratique pour les pauses du cadencement OpenOtaku.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Horodatage du dernier appel OpenOtaku, pour calculer l'attente suivante.
let ooLast = 0;
// File d'attente sérialisant les appels OpenOtaku.
let ooQueue = Promise.resolve();

// Enveloppe une requête OpenOtaku pour l'espacer et la sérialiser.
function ooThrottle(fn) {
  // Attend la requête précédente puis applique l'intervalle minimal OpenOtaku.
  const run = ooQueue.then(async () => {
    // Calcule le temps d'attente restant depuis le dernier appel OpenOtaku.
    const wait = Math.max(0, OO_MIN_INTERVAL - (Date.now() - ooLast));
    // Patiente si le délai anti-flood n'est pas encore écoulé.
    if (wait > 0) await sleep(wait);
    // Enregistre l'instant de départ de cet appel.
    ooLast = Date.now();
    // Exécute réellement la requête sur le créneau libre.
    return fn();
  // Fin du callback exécuté en file d'attente.
  });
  // Met à jour la file même en cas d'échec pour ne pas la bloquer.
  ooQueue = run.then(() => {}, () => {});
  // Renvoie la promesse de cet appel à l'appelant.
  return run;
// Fin de la fonction ooThrottle.
}

// Envoie une requête JSON à OpenOtaku (recherche ou épisodes), avec réessais.
function ooRequest(path, { method = "GET", body = null } = {}) {
  // Fait passer l'appel par le throttle OpenOtaku pour respecter l'anti-flood.
  return ooThrottle(async () => {
    // Garde la dernière erreur pour la restituer si les trois essais échouent.
    let lastErr = null;
    // Tente jusqu'à trois fois l'appel OpenOtaku.
    for (let attempt = 0; attempt < 3; attempt++) {
      // Contrôleur d'annulation si la requête dépasse le délai OpenOtaku.
      const ctrl = new AbortController();
      // Minuteur qui coupe la requête au bout d'OO_TIMEOUT.
      const timer = setTimeout(() => ctrl.abort(), OO_TIMEOUT);
      // Capture les erreurs réseau ou HTTP pour réessayer.
      try {
        // Envoie la requête à l'URL OpenOtaku construite depuis la racine et le chemin.
        const res = await fetch(`${OO_BASE}${path}`, {
          // Méthode HTTP demandée (GET par défaut, POST pour la recherche).
          method,
          // En-têtes HTTP de la requête (identification et JSON).
          headers: {
            // S'identifie comme OptiManga auprès d'OpenOtaku.
            "User-Agent": UA,
            // Demande une réponse JSON.
            Accept: "application/json",
            // Ajoute l'en-tête JSON uniquement quand un corps est envoyé.
            ...(body ? { "Content-Type": "application/json" } : {}),
          // Fin des en-têtes HTTP.
          },
          // Corps JSON éventuel (null pour une requête GET).
          body: body ? JSON.stringify(body) : null,
          // Permet d'annuler la requête via le contrôleur.
          signal: ctrl.signal,
        // Fin de l'appel fetch vers OpenOtaku.
        });
        // Réponse reçue : annule le minuteur de garde.
        clearTimeout(timer);
        // Sur 429 ou erreur serveur 5xx, on retente après une pause.
        if (res.status === 429 || res.status >= 500) {
          // Mémorise l'erreur en cas d'échec définitif.
          lastErr = new Error(`OpenOtaku HTTP ${res.status}`);
          // Attente croissante (700 ms × tentative) avant le prochain essai.
          await sleep(700 * (attempt + 1));
          // Passe à la tentative suivante.
          continue;
        // Fin du bloc de réessai 429/5xx.
        }
        // Lit le JSON de la réponse, ou null si le corps est illisible.
        const data = await res.json().catch(() => null);
        // Une réponse HTTP en erreur devient une erreur typée (404 conservé, sinon 502).
        if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, `OpenOtaku HTTP ${res.status}`);
        // Renvoie le corps JSON de la réponse OpenOtaku.
        return data;
      // Rattrape les erreurs réseau et les erreurs HTTP déjà typées.
      } catch (err) {
        // Stoppe le minuteur pour éviter une annulation tardive.
        clearTimeout(timer);
        // Une erreur HTTP déjà typée (404, 502…) est définitive.
        if (err.status) throw err;
        // Mémorise l'erreur réseau pour le message final.
        lastErr = err;
        // Pause croissante (500 ms × tentative) avant le nouvel essai.
        await sleep(500 * (attempt + 1));
      // Fin du bloc catch des erreurs réseau.
      }
    // Fin de la boucle des trois tentatives.
    }
    // Les trois essais ont échoué : signale OpenOtaku comme injoignable (502).
    throw httpError(502, `OpenOtaku injoignable : ${lastErr ? lastErr.message : "timeout"}`);
  // Fin du callback exécuté par le throttle OpenOtaku.
  });
// Fin de la fonction ooRequest.
}

// Recherche un animé sur OpenOtaku par mot-clé et renvoie ses résultats bruts.
async function ooSearch(query) {
  // Nettoie et sécurise le mot-clé recherché.
  const q = String(query || "").trim();
  // Requête vide : inutile d'interroger OpenOtaku, on renvoie une liste vide.
  if (!q) return [];
  // Trois tentatives : OpenOtaku répond parfois « trop de requêtes ».
  for (let attempt = 0; attempt < 3; attempt++) {
    // Appelle l'endpoint de recherche OpenOtaku en POST.
    const data = await ooRequest("/api/search", { method: "POST", body: { query: q } });
    // Récupère le tableau de résultats, ou un tableau vide si absent.
    const results = (data && Array.isArray(data.results) && data.results) || [];
    // Si au moins un résultat a un identifiant newsId, la recherche est exploitable.
    if (results.some((r) => r && r.newsId)) return results;
    // Détecte la réponse d'anti-flood « trop de requêtes » d'OpenOtaku.
    if (results.some((r) => r && /trop de requ/i.test(String(r.title || "")))) {
      // Attend de plus en plus longtemps (900 ms × tentative) avant de réessayer.
      await sleep(900 * (attempt + 1));
      // Relance un nouvel essai.
      continue;
    // Fin du test anti-flood.
    }
    // Résultats valides (même sans newsId) : on les renvoie tels quels.
    return results;
  // Fin de la boucle des tentatives de recherche.
  }
  // Toutes les tentatives ont échoué : liste vide.
  return [];
// Fin de la fonction ooSearch.
}

// Récupère la liste des épisodes d'un animé OpenOtaku par son identifiant newsId.
async function ooEpisodes(newsId) {
  // Appelle l'endpoint des épisodes en encodant proprement l'identifiant.
  const data = await ooRequest(`/api/episodes?id=${encodeURIComponent(String(newsId))}`);
  // Ne renvoie un objet que si l'API a répondu par un objet, sinon un objet vide.
  return data && typeof data === "object" ? data : {};
// Fin de la fonction ooEpisodes.
}


// Extrait le meilleur titre disponible d'un animé (anglais, sinon romanji, sinon natif).
function titleOf(title) {
  // Sans objet de titre, renvoie une chaîne vide.
  if (!title) return "";
  // Choisit l'anglais en priorité, puis le romanji, puis le titre natif.
  return title.english || title.romaji || title.native || "";
// Fin de la fonction titleOf.
}

// Récupère le studio principal d'un animé, ou « Studio inconnu » à défaut.
function studioOf(media) {
  // Liste des studios principaux renvoyés par AniList, ou tableau vide.
  const nodes = (media.studios && media.studios.nodes) || [];
  // Renvoie le premier studio nommé, sinon une valeur de repli.
  return nodes[0] && nodes[0].name ? nodes[0].name : "Studio inconnu";
// Fin de la fonction studioOf.
}

// Nettoie un synopsis HTML d'AniList pour l'afficher en texte brut.
function clean(text) {
  // Sécurise l'entrée en chaîne vide si le texte est absent.
  return String(text || "")
    // Convertit les balises de saut de ligne HTML en vrais retours à la ligne.
    .replace(/<br\s*\/?>/gi, "\n")
    // Supprime toutes les balises HTML restantes (gras, italique, liens…).
    .replace(/<[^>]+>/g, "")
    // Retire les espaces superflus en début et fin de texte.
    .trim();
// Fin de la fonction clean.
}


// Normalise une chaîne pour la comparaison de titres (minuscules, sans accents).
function normalize(str) {
  // Sécurise l'entrée en chaîne vide.
  return String(str || "")
    // Passe en minuscules pour ignorer la casse.
    .toLowerCase()
    // Décompose les accents en caractère de base plus diacritique.
    .normalize("NFD")
    // Supprime les diacritiques (accents) ainsi séparés.
    .replace(/[\u0300-\u036f]/g, "")
    // Remplace apostrophes et accents graves par des espaces.
    .replace(/[’'`]/g, " ")
    // Retire les mots parasites (saison, the, movie…) qui faussent l'appariement.
    .replace(/\b(saison|season|part|partie|final|the|movie|film)\b/g, " ")
    // Ne conserve que lettres, chiffres et espaces.
    .replace(/[^a-z0-9 ]+/g, " ")
    // Réduit les suites d'espaces à un seul.
    .replace(/\s+/g, " ")
    // Retire les espaces en début et fin.
    .trim();
// Fin de la fonction normalize.
}

// Découpe un titre normalisé en mots significatifs (plus d'un caractère).
function tokens(str) {
  // Normalise puis sépare sur les espaces en écartant les mots d'une lettre.
  return normalize(str).split(" ").filter((t) => t.length > 1);
// Fin de la fonction tokens.
}

// Calcule le taux de recouvrement (0 à 1) entre les mots de deux titres.
function overlap(a, b) {
  // Ensemble des mots du premier titre.
  const A = new Set(tokens(a));
  // Ensemble des mots du second titre.
  const B = new Set(tokens(b));
  // Si l'un des deux titres n'a pas de mots, le score est nul.
  if (!A.size || !B.size) return 0;
  // Compteur de mots présents dans les deux titres.
  let inter = 0;
  // Parcourt les mots du premier titre pour compter les intersections.
  for (const t of A) if (B.has(t)) inter++;
  // Rapporte l'intersection à la taille du plus grand ensemble.
  return inter / Math.max(A.size, B.size);
// Fin de la fonction overlap.
}

// Détecte le numéro de saison mentionné dans un titre (ex. « Saison 2 »).
function seasonOf(title) {
  // Cherche « saison N » ou « season N » dans le titre.
  const m = /(?:saison|season)\s*(\d+)/i.exec(String(title || ""));
  // Renvoie le numéro de saison, ou null si aucun n'est trouvé.
  return m ? Number(m[1]) : null;
// Fin de la fonction seasonOf.
}

// Détecte une année entre parenthèses dans un titre (ex. « (2019) »).
function yearOf(title) {
  // Cherche un nombre à quatre chiffres entre parenthèses.
  const m = /\((\d{4})\)/.exec(String(title || ""));
  // Renvoie l'année trouvée, ou null sinon.
  return m ? Number(m[1]) : null;
// Fin de la fonction yearOf.
}

// Évalue la ressemblance entre un résultat OpenOtaku et les titres AniList.
function matchScore(candidate, titles, year) {
  // Titre du résultat candidat OpenOtaku.
  const candTitle = candidate.title || "";
  // Année du candidat, déduite du champ year ou du titre.
  const candYear = Number(candidate.year) || yearOf(candTitle);
  // Meilleur score trouvé parmi tous les titres AniList.
  let best = 0;
  // Compare le candidat à chacun des titres AniList (anglais, romanji, natif).
  for (const t of titles) {
    // Ignore un titre AniList vide.
    if (!t) continue;
    // Score de base : recouvrement des mots entre le titre AniList et le candidat.
    let s = overlap(t, candTitle);
    // Saison annoncée par le titre AniList.
    const tSeason = seasonOf(t);
    // Saison annoncée par le titre du candidat.
    const cSeason = seasonOf(candTitle);
    // Si les deux saisons sont connues, bonus si identiques, malus sinon.
    if (tSeason != null && cSeason != null) s += tSeason === cSeason ? 0.5 : -0.5;
    // Titre AniList avec saison mais candidat sans : léger malus.
    else if (tSeason != null && cSeason == null) s -= 0.25;
    // Candidat avec une saison supérieure à 1 sans équivalent AniList : malus.
    else if (tSeason == null && cSeason != null && cSeason > 1) s -= 0.3;
    // Candidat annoncé comme saison 1 : léger bonus.
    else if (tSeason == null && cSeason === 1) s += 0.1;
    // Si l'année de recherche et celle du candidat sont connues, on ajuste le score.
    if (year && candYear) {
      // Même année : bonus de confiance.
      if (Number(candYear) === Number(year)) s += 0.2;
      // Écart de plus d'un an : malus.
      else if (Math.abs(Number(candYear) - Number(year)) > 1) s -= 0.15;
    // Fin de l'ajustement par année.
    }
    // Conserve le meilleur score rencontré.
    best = Math.max(best, s);
  // Fin de la comparaison aux titres AniList.
  }
  // Renvoie le meilleur score trouvé.
  return best;
// Fin de la fonction matchScore.
}


// Priorité des hébergeurs de lecteurs OpenOtaku (les mieux classés d'abord).
const OO_HOST_RANK = [
  // Lulu (luluvid/luluvdo) : lecteur privilégié.
  { re: /luluvid|luluvdo/i, label: "Lulu" },
  // Vidzy : lecteur secondaire fiable.
  { re: /vidzy\./i, label: "Vidzy" },
  // Sibnet : lecteur de repli.
  { re: /sibnet\./i, label: "Sibnet" },
  // Sendvid : lecteur de repli.
  { re: /sendvid\./i, label: "Sendvid" },
  // Miroirs génériques (voe, uqload, smoothpre) en dernier recours.
  { re: /voe\.|uqload\.|smoothpre\./i, label: "Miroir" },
// Fin de la table de priorité des hébergeurs.
];

// Transforme la carte des lecteurs d'un épisode en liste triée et dédupliquée.
function ooPlayers(map) {
  // Parcourt les entrées de la carte des lecteurs.
  const scored = Object.entries(map || {})
    // Filtre les valeurs non textuelles ou non URL.
    .filter(([, v]) => typeof v === "string" && /^https?:/i.test(v))
    // Associe à chaque URL un rang d'hébergeur et un libellé lisible.
    .map(([key, url]) => {
      // Rang par défaut : après tous les hébergeurs connus.
      let rank = OO_HOST_RANK.length;
      // Libellé par défaut : la clé avec une majuscule initiale.
      let label = key.charAt(0).toUpperCase() + key.slice(1);
      // Cherche l'hébergeur connu correspondant à l'URL.
      OO_HOST_RANK.forEach((h, i) => {
        // Si l'URL correspond et que ce rang est meilleur, on le retient.
        if (h.re.test(url) && i < rank) {
          // Adopte ce rang d'hébergeur.
          rank = i;
          // Adopte le libellé de l'hébergeur.
          label = h.label;
        // Fin du test d'hébergeur.
        }
      // Fin de la recherche d'hébergeur.
      });
      // Renvoie le lecteur enrichi de son rang et de son libellé.
      return { rank, label, url };
    // Fin de la transformation d'une entrée.
    });
  // Liste finale des lecteurs uniques.
  const uniq = [];
  // Ensemble des URLs déjà vues pour éviter les doublons.
  const seen = new Set();
  // Parcourt les lecteurs pour dédupliquer.
  for (const p of scored) {
    // Saute une URL déjà rencontrée.
    if (seen.has(p.url)) continue;
    // Marque l'URL comme vue.
    seen.add(p.url);
    // Ajoute le lecteur unique à la liste.
    uniq.push(p);
  // Fin de la déduplication.
  }
  // Trie les lecteurs par rang croissant (meilleur hébergeur en tête).
  uniq.sort((a, b) => a.rank - b.rank);
  // Renvoie la liste finale réduite à label plus url.
  return uniq.map((p) => ({ label: p.label, url: p.url }));
// Fin de la fonction ooPlayers.
}

// Source « Anime VF · AniList » : catalogue AniList plus lecture via OpenOtaku.
class AnilistSource extends BaseSource {
  // Initialise la source avec ses métadonnées et ses deux caches mémoire.
  constructor() {
    // Déclare l'identité et les capacités de la source auprès de BaseSource.
    super({
      // Identifiant technique unique de la source.
      id: "anilist",
      // Nom affiché dans l'interface.
      name: "Anime VF · AniList",
      // Site de référence de la source.
      baseUrl: "https://anilist.co",
      // Langue principale proposée.
      lang: "fr",
      // Version de la source.
      version: "2.0.0",
      // Auteur/mainteneur de la source.
      author: "OptiManga",
      // Type de média fourni : anime.
      mediaType: "anime",
      // Couleur d'accent de la source dans l'interface.
      color: "#5aa9ff",
      // Genres exposés par la source.
      genres: GENRES,
      // Source activée par défaut dans les réglages.
      defaultEnabled: true,
      // Texte de description présenté à l'utilisateur.
      description:
        // Décrit le catalogue AniList et ses métadonnées légales.
        "Catalogue d'animes via l'API publique AniList (métadonnées légales : notes, genres, studios, résumés). " +
        // Explique que la lecture est assurée par OpenOtaku dans le lecteur intégré.
        "La lecture est assurée par OpenOtaku : chaque épisode est apparié par titre puis lu dans le lecteur intégré " +
        // Précise la priorité VF et le repli sur les liens officiels.
        "(Vidzy, Lulu…), avec priorité à la VF (repli VOSTFR). Si aucun équivalent n'existe, la fiche renvoie vers la plateforme officielle.",
    // Fin de la configuration passée à BaseSource.
    });
    // Cache des recherches OpenOtaku, indexé par requête.
    this._ooSearchCache = new Map(); // query -> { results, at }
    // Cache des épisodes OpenOtaku, indexé par identifiant newsId.
    this._ooEpsCache = new Map(); // newsId -> { data, at }
  // Fin du constructeur.
  }

  // Renvoie la liste des genres filtrables proposés par la source.
  async getGenres() {
    // Retourne directement la liste statique des genres AniList.
    return GENRES;
  // Fin de la méthode getGenres.
  }

  // Recherche paginée d'animés sur AniList avec filtres de genre, statut et tri.
  async search(query = "", options = {}) {
    // Déstructure les filtres avec leurs valeurs par défaut.
    const { genre = "all", status = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    // Borne le nombre de résultats par page entre 1 et 50 (défaut 24).
    const perPage = Math.min(50, Math.max(1, Number(limit) || 24));
    // Convertit l'offset demandé en numéro de page AniList (commence à 1).
    const page = Math.floor(Math.max(0, Number(offset) || 0) / perPage) + 1;
    // Nettoie le mot-clé recherché.
    const q = String(query || "").trim();

    // Traduit la clé de tri en valeur MediaSort, avec « relevance » par défaut.
    let sortKey = SORTS[sort] || SORTS.relevance;
    // Sans mot-clé, la pertinence n'a pas de sens : on bascule sur la popularité.
    if (!q && sortKey === "SEARCH_MATCH") sortKey = "POPULARITY_DESC";

    // Variables GraphQL transmises à AniList (pagination et tri).
    const variables = { page, perPage, sort: [sortKey] };
    // Arguments du filtre media passés à AniList.
    const args = ["type: ANIME", "isAdult: false", "sort: $sort"];
    // Déclarations des variables GraphQL correspondantes.
    const varDefs = ["$page: Int", "$perPage: Int", "$sort: [MediaSort]"];
    // Ajoute le filtre de recherche textuelle si un mot-clé est fourni.
    if (q) {
      // Transmet le mot-clé dans les variables GraphQL.
      variables.search = q;
      // Ajoute l'argument de recherche au filtre media.
      args.push("search: $search");
      // Déclare la variable GraphQL du mot-clé.
      varDefs.push("$search: String");
    // Fin du filtre de recherche textuelle.
    }
    // Ajoute le filtre de genre si un genre précis est demandé.
    if (genre && genre !== "all") {
      // Transmet le genre dans les variables GraphQL.
      variables.genre = genre;
      // Ajoute l'argument de genre au filtre media.
      args.push("genre: $genre");
      // Déclare la variable GraphQL du genre.
      varDefs.push("$genre: String");
    // Fin du filtre de genre.
    }
    // Ajoute le filtre de statut si celui-ci est reconnu.
    if (status && status !== "all" && APP_TO_STATUS[status]) {
      // Convertit le statut de l'application en statut AniList.
      variables.status = APP_TO_STATUS[status];
      // Ajoute l'argument de statut au filtre media.
      args.push("status: $status");
      // Déclare la variable GraphQL du statut.
      varDefs.push("$status: MediaStatus");
    // Fin du filtre de statut.
    }

    // Requête GraphQL paginée construite dynamiquement à partir des filtres actifs.
    const gqlQuery = `query (${varDefs.join(", ")}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage }
        media(${args.join(", ")}) { ${MEDIA_FIELDS} }
      }
    }`;

    // Exécute la requête GraphQL sur AniList.
    const data = await gql(gqlQuery, variables);
    // Récupère la page de résultats, ou un objet vide.
    const pageData = (data && data.Page) || {};
    // Convertit chaque animé brut en fiche condensée pour l'interface.
    const results = (pageData.media || []).map((m) => this._brief(m));
    // Détermine le total de résultats, ou retombe sur la taille de la page.
    const total = (pageData.pageInfo && pageData.pageInfo.total) || results.length;
    // Renvoie les résultats et le total attendus par l'application.
    return { results, total };
  // Fin de la méthode search.
  }

  // Récupère la fiche complète d'un animé par son identifiant AniList.
  async getMangaInfo(mangaId) {
    // Convertit l'identifiant reçu en nombre.
    const id = Number(mangaId);
    // Un identifiant non numérique est introuvable.
    if (!Number.isFinite(id)) throw httpError(404, "Anime introuvable");
    // Requête GraphQL détaillant l'animé, ses épisodes diffusés et ses liens externes.
    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        streamingEpisodes { title thumbnail url site }
        externalLinks { site url type language }
      }
    }`;
    // Interroge AniList pour l'animé demandé.
    const data = await gql(query, { id });
    // Récupère l'objet media de la réponse.
    const media = data && data.Media;
    // Anime absent d'AniList : on signale un 404.
    if (!media) throw httpError(404, "Anime introuvable sur AniList");

    // Fiche condensée de l'animé.
    const brief = this._brief(media);
    // Liste d'épisodes retenue, remplie plus bas.
    let chapters = null;
    // Correspondance OpenOtaku trouvée, si lecture disponible.
    let matched = null;
    // Tente de trouver et charger l'animé correspondant sur OpenOtaku.
    try {
      // Recherche l'animé équivalent sur OpenOtaku.
      const match = await this._resolveOpenOtaku(media);
      // Si un équivalent est trouvé, on récupère ses épisodes.
      if (match) {
        // Charge (avec cache) les épisodes de l'animé OpenOtaku.
        const eps = await this._getEpisodesCached(match.newsId);
        // Construit les chapitres lisibles à partir des lecteurs OpenOtaku.
        chapters = this._ooChapters(match, eps);
        // Mémorise la correspondance si au moins un épisode est lisible.
        if (chapters.length) matched = match;
      // Fin du traitement d'une correspondance trouvée.
      }
    // Rattrape toute panne OpenOtaku sans faire échouer la fiche.
    } catch {
      /* OpenOtaku indisponible : repli sur les liens officiels */
    // Fin du repli en cas de panne OpenOtaku.
    }
    // Sans épisodes OpenOtaku, retombe sur les liens officiels d'AniList.
    if (!chapters || !chapters.length) chapters = this._episodes(media);

    // Assemble la fiche finale renvoyée à l'application.
    return {
      // Recopie les métadonnées condensées de l'animé.
      ...this._brief(media),
      // Nombre d'épisodes disponibles.
      chapterCount: chapters.length,
      // Liste des épisodes/chapitres.
      chapters,
      // Titre de la correspondance OpenOtaku utilisée, ou null.
      streamedBy: matched ? matched.title : null,
    // Fin de la fiche retournée.
    };
  // Fin de la méthode getMangaInfo.
  }

  // Renvoie les lecteurs d'un épisode hébergé par OpenOtaku.
  async getChapterPages(mangaId, chapterId) {
    // Découpe l'identifiant composite oo~newsId~lang~num.
    const parts = String(chapterId || "").split("~");
    // Ne traite que les identifiants OpenOtaku bien formés (préfixe oo et 4 segments).
    if (parts[0] === "oo" && parts.length === 4) {
      // Récupère les segments newsId, langue et numéro d'épisode.
      const [, newsId, lang, num] = parts;
      // Charge (avec cache) les épisodes de l'animé OpenOtaku.
      const data = await this._getEpisodesCached(newsId);
      // Récupère la carte des lecteurs pour la langue et l'épisode demandés.
      const map = data && data[lang] && data[lang][num];
      // Transforme la carte en liste de lecteurs triés.
      const players = ooPlayers(map);
      // Aucun lecteur exploitable : épisode introuvable.
      if (!players.length) throw httpError(404, "Lecteur introuvable pour cet épisode");
      // Titre éventuel de l'épisode fourni par OpenOtaku.
      const title = data && data.info && data.info[num] && data.info[num].title;
      // Construit la réponse de lecture attendue par l'application.
      return {
        // Identifiant du chapitre, inchangé.
        id: String(chapterId),
        // Titre lisible de l'épisode, ou null.
        title: title ? `Épisode ${num} · ${title}` : null,
        // Numéro d'épisode pour le tri.
        order: Number(num) || null,
        // Aucune page image : la lecture passe par un lecteur externe intégré.
        pages: [],
        // Variante basse définition vide.
        pagesLow: [],
        // URL du meilleur lecteur, utilisée comme source par défaut.
        externalUrl: players[0].url,
        // Liste complète des lecteurs disponibles.
        players,
      // Fin de la réponse de lecture.
      };
    // Fin du cas épisode OpenOtaku.
    }
    // Identifiant non OpenOtaku : épisode non hébergé.
    throw httpError(404, "Épisode non hébergé");
  // Fin de la méthode getChapterPages.
  }


  // Condense un media AniList brut en fiche légère pour les listes de l'interface.
  _brief(media) {
    // Genres renvoyés par AniList, ou tableau vide.
    const genres = media.genres || [];
    // Objet fiche au format attendu par l'application.
    return {
      // Identifiant AniList sous forme de chaîne.
      id: String(media.id),
      // Titre choisi parmi anglais, romanji ou natif.
      title: titleOf(media.title),
      // Studio principal affiché comme auteur.
      author: studioOf(media),
      // Meilleure couverture disponible (extraLarge, sinon large).
      cover: (media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || null,
      // Statut traduit pour l'application, ou « unknown ».
      status: STATUS_TO_APP[media.status] || "unknown",
      // Premier genre comme genre principal.
      genre: genres[0] || "",
      // Tous les genres comme étiquettes.
      tags: genres,
      // Note sur 10 arrondie à une décimale, ou null.
      rating: media.averageScore ? +(media.averageScore / 10).toFixed(1) : null,
      // Popularité AniList, ou null.
      popularity: media.popularity || null,
      // Année de diffusion, ou null.
      year: media.seasonYear || null,
      // Nombre d'épisodes, ou null.
      chapterCount: media.episodes || null,
      // Synopsis nettoyé du HTML.
      description: clean(media.description),
      // Type de média : anime.
      mediaType: "anime",
      // Identifiant de la source.
      sourceId: this.id,
      // Nom de la source.
      sourceName: this.name,
    // Fin de la fiche condensée.
    };
  // Fin de la méthode _brief.
  }

  /** Recherche l'animé correspondant sur OpenOtaku (cache mémoire). */
  // Recherche le meilleur équivalent OpenOtaku d'un media AniList.
  async _resolveOpenOtaku(media) {
    // Objet des titres AniList (anglais, romanji, natif).
    const titleObj = media.title || {};
    // Liste des titres non vides servant à interroger OpenOtaku.
    const titles = [titleObj.english, titleObj.romaji, titleObj.native].filter(Boolean);
    // Sans aucun titre exploitable, aucun appariement possible.
    if (!titles.length) return null;
    // Année de diffusion de l'animé, pour affiner l'appariement.
    const year = media.seasonYear || null;

    // Meilleure correspondance trouvée jusqu'ici.
    let best = null;
    // Essaie chaque titre AniList jusqu'à obtenir un bon score.
    for (const q of titles) {
      // Résultats OpenOtaku pour le titre courant.
      let results;
      // Une erreur de recherche sur un titre ne doit pas tout interrompre.
      try {
        // Interroge OpenOtaku (avec cache) pour ce titre.
        results = await this._searchOpenOtaku(q);
      // Ignorer un titre en échec et passer au suivant.
      } catch {
        // Continue avec le titre suivant.
        continue;
      // Fin du traitement d'échec de recherche.
      }
      // Examine chaque résultat OpenOtaku.
      for (const r of results) {
        // Ignore les résultats sans identifiant newsId.
        if (!r || !r.newsId) continue;
        // Score de ressemblance entre le résultat et les titres AniList.
        const score = matchScore(r, titles, year);
        // Garde le résultat s'il est meilleur que le précédent.
        if (!best || score > best.score) {
          // Mémorise la meilleure correspondance et son identifiant.
          best = { score, newsId: String(r.newsId), title: r.title, year: r.year };
        // Fin du test de meilleur score.
        }
      // Fin de l'examen des résultats.
      }
      // Un score d'au moins 0,6 suffit pour arrêter la recherche.
      if (best && best.score >= 0.6) break;
    // Fin de l'essai des différents titres.
    }
    // Sans correspondance suffisante (score inférieur à 0,2), on renvoie null.
    if (!best || best.score < 0.2) return null;
    // Renvoie la meilleure correspondance OpenOtaku.
    return best;
  // Fin de la méthode _resolveOpenOtaku.
  }

  // Recherche OpenOtaku mise en cache par mot-clé.
  async _searchOpenOtaku(q) {
    // Clé de cache normalisée (minuscules, sans espaces superflus).
    const key = String(q || "").toLowerCase().trim();
    // Entrée de cache éventuelle pour ce mot-clé.
    const hit = this._ooSearchCache.get(key);
    // Réutilise le cache s'il est encore frais (moins de OO_SEARCH_TTL).
    if (hit && Date.now() - hit.at < OO_SEARCH_TTL) return hit.results;
    // Sinon interroge réellement OpenOtaku.
    const results = await ooSearch(q);
    // Stocke le résultat et son horodatage dans le cache.
    this._ooSearchCache.set(key, { results, at: Date.now() });
    // Renvoie les résultats obtenus.
    return results;
  // Fin de la méthode _searchOpenOtaku.
  }

  // Liste d'épisodes OpenOtaku mise en cache par identifiant newsId.
  async _getEpisodesCached(newsId) {
    // Clé de cache : l'identifiant newsId sous forme de chaîne.
    const key = String(newsId);
    // Entrée de cache éventuelle pour cet animé.
    const hit = this._ooEpsCache.get(key);
    // Réutilise le cache s'il est encore frais (moins de OO_EPS_TTL).
    if (hit && Date.now() - hit.at < OO_EPS_TTL) return hit.data;
    // Sinon interroge réellement OpenOtaku.
    const data = await ooEpisodes(newsId);
    // Stocke les épisodes et leur horodatage dans le cache.
    this._ooEpsCache.set(key, { data, at: Date.now() });
    // Renvoie les données d'épisodes.
    return data;
  // Fin de la méthode _getEpisodesCached.
  }

  // Transforme les données OpenOtaku en chapitres lisibles, en préférant la VF.
  _ooChapters(match, data) {
    // Carte des lecteurs VF, ou objet vide.
    const vf = (data && data.vf) || {};
    // Carte des lecteurs VOSTFR, ou objet vide.
    const vostfr = (data && data.vostfr) || {};
    // Langue retenue : VF si disponible, sinon VOSTFR, sinon aucune.
    const lang = Object.keys(vf).length ? "vf" : Object.keys(vostfr).length ? "vostfr" : null;
    // Aucune langue disponible : aucun chapitre.
    if (!lang) return [];
    // Carte des lecteurs correspondant à la langue retenue.
    const map = lang === "vf" ? vf : vostfr;
    // Informations d'épisodes OpenOtaku (titres), ou objet vide.
    const info = (data && data.info) || {};
    // Libellé de groupe affiché selon la langue.
    const label = lang === "vf" ? "VF" : "VOSTFR";

    // Numéros d'épisodes valides, triés du plus petit au plus grand.
    const nums = Object.keys(map)
      // Convertit chaque clé d'épisode en nombre.
      .map((n) => Number(n))
      // Écarte les clés non numériques.
      .filter((n) => Number.isFinite(n))
      // Trie les numéros par ordre croissant.
      .sort((a, b) => a - b);

    // Liste des chapitres à construire.
    const chapters = [];
    // Construit un chapitre par numéro d'épisode.
    for (const num of nums) {
      // Lecteurs disponibles pour cet épisode.
      const players = ooPlayers(map[String(num)]);
      // Ignore un épisode sans lecteur exploitable.
      if (!players.length) continue;
      // Titre optionnel de l'épisode fourni par OpenOtaku.
      const epTitle = info[String(num)] && info[String(num)].title;
      // Ajoute le chapitre au format attendu par l'application.
      chapters.push({
        // Identifiant composite encodant animé, langue et numéro.
        id: `oo~${match.newsId}~${lang}~${num}`,
        // Titre affiché, avec le titre OpenOtaku si disponible.
        title: epTitle ? `Épisode ${num} · ${epTitle}` : `Épisode ${num}`,
        // Numéro d'épisode pour le tri.
        order: num,
        // Groupe de langue (VF ou VOSTFR).
        group: label,
        // URL du meilleur lecteur pour cet épisode.
        externalUrl: players[0].url,
        // Pas de pages image : lecture via lecteur intégré.
        pages: 0,
      // Fin de l'ajout du chapitre.
      });
    // Fin de la construction des chapitres.
    }
    // Renvoie la liste des chapitres.
    return chapters;
  // Fin de la méthode _ooChapters.
  }

  // Construit les épisodes de repli à partir des liens officiels AniList.
  _episodes(media) {
    // Liste des épisodes à construire.
    const list = [];
    // Épisodes diffusés fournis par AniList, ou tableau vide.
    const stream = Array.isArray(media.streamingEpisodes) ? media.streamingEpisodes : [];
    // Meilleur lien de streaming français trouvé sur AniList.
    const frLink = this._bestFrenchLink(media);

    // Parcourt les épisodes diffusés pour les convertir.
    for (let i = 0; i < stream.length; i++) {
      // Épisode AniList courant.
      const ep = stream[i];
      // Numéro d'épisode déduit du titre, sinon position dans la liste.
      const order = this._episodeNumber(ep.title, i + 1);
      // Ajoute l'épisode au format attendu par l'application.
      list.push({
        // Identifiant local basé sur le numéro et l'index.
        id: `ep-${order}-${i}`,
        // Titre nettoyé, sinon libellé générique.
        title: clean(ep.title) || `Épisode ${order}`,
        // Numéro d'épisode pour le tri.
        order,
        // Lien du lecteur officiel, sinon lien français, sinon aucun.
        externalUrl: ep.url || frLink || null,
        // Site hébergeur indiqué par AniList.
        group: ep.site || null,
        // Pas de pages image.
        pages: 0,
      // Fin de l'ajout de l'épisode.
      });
    // Fin de la conversion des épisodes diffusés.
    }

    // Aucun épisode diffusé : on génère une liste synthétique.
    if (!list.length) {
      // Nombre total d'épisodes annoncé par AniList.
      const total = Number(media.episodes) || 0;
      // Génère un épisode par numéro jusqu'au total.
      for (let n = 1; n <= total; n++) {
        // Ajoute l'épisode synthétique.
        list.push({
          // Identifiant local basé sur le numéro.
          id: `ep-${n}`,
          // Libellé générique de l'épisode.
          title: `Épisode ${n}`,
          // Numéro d'épisode.
          order: n,
          // Lien français, sinon page AniList de l'animé.
          externalUrl: frLink || `https://anilist.co/anime/${media.id}`,
          // Groupe affiché selon la disponibilité d'un lien français.
          group: frLink ? "VF / VOSTFR" : "AniList",
          // Pas de pages image.
          pages: 0,
        // Fin de l'ajout de l'épisode synthétique.
        });
      // Fin de la génération des épisodes synthétiques.
      }
    // Fin du cas sans épisode diffusé.
    }

    // Trie les épisodes par numéro croissant.
    list.sort((a, b) => a.order - b.order);
    // Renvoie la liste finale des épisodes.
    return list;
  // Fin de la méthode _episodes.
  }

  // Déduit le numéro d'épisode depuis un titre, avec une valeur de repli.
  _episodeNumber(title, fallback) {
    // Cherche le premier nombre présent dans le titre.
    const match = String(title || "").match(/(\d+)/);
    // Renvoie le nombre trouvé, sinon la valeur de repli.
    return match ? Number(match[1]) : fallback;
  // Fin de la méthode _episodeNumber.
  }

  // Sélectionne le meilleur lien de streaming français parmi les liens externes AniList.
  _bestFrenchLink(media) {
    // Liens externes AniList, ou tableau vide.
    const links = Array.isArray(media.externalLinks) ? media.externalLinks : [];
    // Ne conserve que les liens de type streaming.
    const stream = links.filter((l) => l.type === "STREAMING");
    // Cherche un lien français ou un site français connu (Crunchyroll, ADN).
    const fr = stream.find(
      // Teste la langue du lien, puis son site d'origine.
      (l) => /french|français|francais|vf/i.test(l.language || "") || /crunchyroll|adn/i.test(l.site || "")
    // Fin de la recherche du lien français.
    );
    // Renvoie l'URL du lien français, sinon du premier lien streaming, sinon null.
    return (fr || stream[0] || {}).url || null;
  // Fin de la méthode _bestFrenchLink.
  }
// Fin de la classe AnilistSource.
}

// Exporte la source pour le chargeur d'extensions.
module.exports = AnilistSource;
