// Active le mode strict (syntaxe JavaScript plus sure).
"use strict";

// Importe la classe de base commune aux sources.
const BaseSource = require("../BaseSource");
// Importe l'utilitaire de creation d'erreurs HTTP.
const { httpError } = require("../utils");
// Importe le module de gestion des images.
const images = require("../images");

/**
 * Extension JapScan — Source francophone de scans manga.
 *
 * Catalogue : / (accueil avec plus de 600 titres et chapitres récents)
 * Fiche manga : /manga/{slug}/
 * Chapitre : /manga/{slug}/{chapterNo}/ ou /lecture-en-ligne/{slug}/{chapterNo}/
 *
 * En cas de blocage Cloudflare (403/503), l'extension passe automatiquement
 * sur les miroirs ou génère un repli avec `externalUrl` pour permettre la lecture
 * directe sur JapScan sans casser l'interface utilisateur.
 */

// Declare la liste des domaines miroirs de JapScan.
const BASE_DOMAINS = [
  // Miroir principal (extension .foo).
  "https://www.japscan.foo",
  // Miroir alternatif (extension .lol).
  "https://www.japscan.lol",
  // Miroir alternatif (extension .me).
  "https://www.japscan.me",
  // Miroir alternatif (extension .cc).
  "https://www.japscan.cc",
  // Miroir alternatif (extension .ws).
  "https://www.japscan.ws",
// Ferme le tableau des domaines.
];

// Declare le User-Agent envoye a JapScan.
const USER_AGENT =
  // Utilise la variable d'environnement si definie.
  process.env.JAPSCAN_USER_AGENT ||
  // Sinon, User-Agent de navigateur par defaut.
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

// Declare la liste des genres proposes par la source.
const GENRES = [
  // Genre propose : Action.
  "Action",
  // Genre propose : Aventure.
  "Aventure",
  // Genre propose : Comedie.
  "Comédie",
  // Genre propose : Drame.
  "Drame",
  // Genre propose : Fantastique.
  "Fantastique",
  // Genre propose : Horreur.
  "Horreur",
  // Genre propose : Mystere.
  "Mystère",
  // Genre propose : Romance.
  "Romance",
  // Genre propose : Sci-Fi.
  "Sci-Fi",
  // Genre propose : Seinen.
  "Seinen",
  // Genre propose : Shonen.
  "Shonen",
  // Genre propose : Shojo.
  "Shojo",
  // Genre propose : Slice of Life.
  "Slice of Life",
  // Genre propose : Sports.
  "Sports",
  // Genre propose : Surnaturel.
  "Surnaturel",
  // Genre propose : Thriller.
  "Thriller",
// Ferme le tableau des genres.
];

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
    // Reduit les suites d'espaces.
    .replace(/\s+/g, " ")
    // Supprime les espaces en debut et fin.
    .trim();
// Ferme la fonction cleanText.
}

// Transforme un slug en titre lisible.
function prettifySlug(slug) {
  // Convertit le slug en chaine.
  return String(slug || "")
    // Separe les mots sur les tirets.
    .split("-")
    // Supprime les segments vides.
    .filter(Boolean)
    // Met une majuscule au debut de chaque mot.
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    // Rejoint les mots par des espaces.
    .join(" ");
// Ferme la fonction prettifySlug.
}

// Declare la classe de la source JapScan.
class JapScanSource extends BaseSource {
  // Initialise la source avec ses metadonnees.
  constructor() {
    // Appelle le constructeur de la classe de base.
    super({
      // Identifiant technique de la source.
      id: "japscan",
      // Nom affiche de la source.
      name: "JapScan",
      // URL de base (premier miroir).
      baseUrl: BASE_DOMAINS[0],
      // Langue principale.
      lang: "fr",
      // Version de l'extension.
      version: "1.0.2",
      // Auteur de l'extension.
      author: "OptiManga",
      // Declare la description affichee a l'utilisateur.
      description:
        // Suite de la description.
        "Source francophone JapScan : mangas, manhwas et webtoons en version française. Fiches détaillées, chapitres récents et lecture en ligne VF. " +
        // Fin de la description.
        "Désactivée par défaut : le site est protégé par Cloudflare (Turnstile), qui bloque la lecture intégrée et renvoie vers une redirection externe.",
      // Liste des genres proposes.
      genres: GENRES,
      // Type de media (manga).
      mediaType: "manga",
      // Couleur d'accent dans l'interface.
      color: "#e62117",
      // Desactive la source par defaut (Cloudflare).
      defaultEnabled: false,
    // Ferme l'objet de configuration de super.
    });
  // Ferme le constructeur.
  }

  /**
   * Effectue un fetch HTTP avec les en-têtes appropriés pour JapScan.
   * Bascule sur un miroir fonctionnel si Cloudflare bloque (403/503).
   */
  // Effectue un fetch HTTP avec bascule sur miroir.
  async _fetchHtml(urlPath) {
    // Memorise la derniere erreur rencontree.
    let lastError = null;

    // Declare le cookie personnalise eventuel.
    const customCookie =
      // Lit le cookie depuis la variable d'environnement.
      process.env.JAPSCAN_COOKIE ||
      // Sinon, construit le cookie cf_clearance.
      (process.env.CF_CLEARANCE ? `cf_clearance=${process.env.CF_CLEARANCE}` : null);

    // Parcourt les miroirs dans l'ordre.
    for (const base of BASE_DOMAINS) {
      // Declare l'URL cible.
      const targetUrl = urlPath.startsWith("http")
        // Utilise l'URL telle quelle si absolue.
        ? urlPath
        // Sinon, prefixe l'URL avec le miroir courant.
        : `${base}${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;

      // Declare les en-tetes de la requete.
      const headers = {
        // S'identifie via le User-Agent.
        "User-Agent": USER_AGENT,
        // Types de contenu acceptes.
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        // Langues preferees.
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        // Indique le site d'origine.
        Referer: `${base}/`,
        // Indique la destination de la requete.
        "Sec-Fetch-Dest": "document",
        // Indique le mode de navigation.
        "Sec-Fetch-Mode": "navigate",
        // Indique la provenance same-origin.
        "Sec-Fetch-Site": "same-origin",
        // Demande la mise a niveau vers HTTPS.
        "Upgrade-Insecure-Requests": "1",
      // Ferme l'objet des en-tetes.
      };

      // Si un cookie personnalise existe...
      if (customCookie) {
        // ...l'ajoute aux en-tetes.
        headers["Cookie"] = customCookie;
      // Ferme le bloc if.
      }

      // Tente la requete sur ce miroir.
      try {
        // Envoie la requete fetch.
        const res = await fetch(targetUrl, {
          // En-tetes a envoyer.
          headers,
          // Suit les redirections.
          redirect: "follow",
        // Ferme les options de fetch.
        });

        // Si la page n'existe pas (404)...
        if (res.status === 404) {
          // ...leve immediatement une erreur 404.
          throw httpError(404, "Page JapScan introuvable");
        // Ferme le bloc if.
        }

        // En cas de blocage Cloudflare (403/503)...
        if (res.status === 403 || res.status === 503) {
          // ...previent dans la console.
          console.warn(`[JapScan] Blocage Cloudflare (${res.status}) sur ${base}${urlPath}`);
          // ...memorise l'erreur.
          lastError = httpError(res.status, `Cloudflare 403/503 sur ${base}`);
          // ...et passe au miroir suivant.
          continue;
        // Ferme le bloc if.
        }

        // Si la reponse est correcte...
        if (res.ok) {
          // ...lit le corps de la reponse.
          const html = await res.text();

          // Détection d'un challenge Cloudflare dans le corps HTML
          // Si un challenge Cloudflare est detecte...
          if (html.includes("Just a moment...") || html.includes("challenges.cloudflare.com")) {
            // ...previent dans la console.
            console.warn(`[JapScan] Challenge Cloudflare détecté dans le HTML de ${base}`);
            // ...memorise l'erreur.
            lastError = httpError(403, `Cloudflare Challenge sur ${base}`);
            // ...et passe au miroir suivant.
            continue;
          // Ferme le bloc if.
          }

          // Memorise le miroir fonctionnel.
          this.baseUrl = base;
          // Renvoie le HTML et l'URL finale.
          return { html, url: res.url || targetUrl };
        // Ferme le bloc if.
        }

        // Memorise l'erreur HTTP.
        lastError = httpError(res.status, `JapScan HTTP ${res.status}`);
      // Capture les erreurs reseau.
      } catch (err) {
        // Relance immediatement les erreurs 404.
        if (err.status === 404) throw err;
        // Memorise l'erreur ou en cree une 502.
        lastError = err.status ? err : httpError(502, `JapScan injoignable (${err.message})`);
      // Ferme le bloc catch.
      }
    // Ferme la boucle des miroirs.
    }

    // Leve la derniere erreur ou une erreur 502.
    throw lastError || httpError(502, "Impossible de contacter JapScan (miroirs indisponibles)");
  // Ferme la methode _fetchHtml.
  }

  // ---------------------------------------------------------------------------
  // Recherche & Catalog
  // ---------------------------------------------------------------------------

  // Recherche des mangas dans le catalogue.
  async search(query = "", options = {}) {
    // Extrait les options de filtrage.
    const { genre = "all", sort = "relevance", limit = 24, offset = 0 } = options;
    // Nettoie la requete en minuscules.
    const q = String(query || "").trim().toLowerCase();

    // Prepare la liste des resultats.
    let items = [];
    // Tente de charger le catalogue.
    try {
      // Recupere le HTML et l'URL de l'accueil.
      const { html, url } = await this._fetchHtml("/");
      // Analyse le catalogue.
      items = this._parseCatalog(html, url);
    // Capture les erreurs de chargement.
    } catch (err) {
      // Previent dans la console.
      console.warn("[JapScan] Échec du chargement du catalogue:", err.message);
    // Ferme le bloc catch.
    }

    // Copie la liste pour la filtrer.
    let filtered = items;

    // Si une requete texte est fournie...
    if (q) {
      // ...filtre les fiches correspondantes.
      filtered = filtered.filter(
        // Predicat de filtrage applique a chaque fiche.
        (item) =>
          // Filtre sur le titre.
          item.title.toLowerCase().includes(q) ||
          // Filtre sur l'identifiant.
          item.id.toLowerCase().includes(q) ||
          // Filtre sur le genre.
          (item.genre && item.genre.toLowerCase().includes(q))
      // Ferme l'appel filter.
      );
    // Ferme le bloc if.
    }

    // Si un genre precis est demande...
    if (genre && genre !== "all") {
      // ...normalise le genre en minuscules.
      const gLower = genre.toLowerCase();
      // ...filtre les fiches de ce genre.
      filtered = filtered.filter(
        // Filtre sur le genre.
        (item) => item.genre && item.genre.toLowerCase().includes(gLower)
      // Ferme l'appel filter.
      );
    // Ferme le bloc if.
    }

    // Si le tri par titre est demande...
    if (sort === "title") {
      // ...trie les resultats par titre.
      filtered.sort((a, b) => a.title.localeCompare(b.title, "fr"));
    // Ferme le bloc if.
    }

    // Nombre total de resultats.
    const total = filtered.length;
    // Borne la limite entre 1 et 100.
    const lim = Math.min(100, Math.max(1, Number(limit) || 24));
    // Force un decalage positif ou nul.
    const off = Math.max(0, Number(offset) || 0);

    // Renvoie la tranche demandee.
    return {
      // Convertit chaque fiche en resultat de recherche.
      results: filtered.slice(off, off + lim).map((item) => this._toSearchResult(item)),
      // Total des resultats.
      total,
    // Ferme l'objet de retour.
    };
  // Ferme la methode search.
  }

  // Analyse la page du catalogue.
  _parseCatalog(html, baseUrl) {
    // Accumule les resultats.
    const results = [];
    // Memorise les slugs deja vus.
    const seen = new Set();

    // Regex capturant les liens vers les fiches manga.
    const re = /<a\s[^>]*href=["'](\/manga\/([^/'"]+)\/([^/'"]*)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
    // Variable recevant chaque correspondance.
    let m;

    // Parcourt toutes les correspondances.
    while ((m = re.exec(html))) {
      // Extrait le slug.
      const slug = m[2];
      // Extrait le HTML interne du lien.
      const innerHtml = m[4];

      // Ignore les entrees invalides ou deja vues.
      if (!slug || slug === "1" || seen.has(slug)) continue;

      // Declare la recherche du titre.
      const titleMatch =
        // Cherche l'attribut alt de l'image de couverture.
        innerHtml.match(/alt=["'](Couverture de\s*)?([^"']+)["']/i) ||
        // Sinon, cherche une classe de titre.
        innerHtml.match(/class=["'][^"']*title[^"']*["']>([^<]+)</i);

      // Determine le titre a afficher.
      let title = titleMatch ? cleanText(titleMatch[2] || titleMatch[1]) : prettifySlug(slug);
      // Retire le prefixe Couverture de.
      title = title.replace(/^Couverture de\s*/i, "").trim();

      // Declare la recherche de l'image.
      const imgMatch =
        // Cherche l'attribut data-src.
        innerHtml.match(/data-src=["']([^"']+)["']/i) ||
        // Cherche l'attribut data-lazy-src.
        innerHtml.match(/data-lazy-src=["']([^"']+)["']/i) ||
        // Cherche l'attribut src.
        innerHtml.match(/src=["']([^"']+)["']/i);

      // Prepare la couverture.
      let cover = null;
      // Si une image valide existe...
      if (imgMatch && imgMatch[1] && !imgMatch[1].startsWith("data:")) {
        // ...utilise l'URL absolue si elle l'est deja.
        cover = imgMatch[1].startsWith("http")
          // Sinon...
          ? imgMatch[1]
          // ...resout l'URL relative.
          : new URL(imgMatch[1], baseUrl).href;
      // Ferme le bloc if.
      }

      // Marque le slug comme vu.
      seen.add(slug);
      // Ajoute la fiche a la liste.
      results.push({
        // Identifiant (slug).
        id: slug,
        // Titre ou slug transforme.
        title: title || prettifySlug(slug),
        // Couverture.
        cover,
        // Genre vide.
        genre: "",
      // Ferme l'objet fiche.
      });
    // Ferme la boucle while.
    }

    // Renvoie les resultats.
    return results;
  // Ferme la methode _parseCatalog.
  }

  // Convertit une fiche en resultat de recherche.
  _toSearchResult(item) {
    // Renvoie l'objet resultat.
    return {
      // Identifiant.
      id: item.id,
      // Titre.
      title: item.title,
      // Auteur (JapScan).
      author: "JapScan",
      // Couverture passee par le proxy d'images.
      cover: images.proxied(item.cover),
      // Statut inconnu.
      status: null,
      // Genre ou vide.
      genre: item.genre || "",
      // Tags deduits du genre.
      tags: item.genre ? [item.genre] : [],
      // Note inconnue.
      rating: null,
      // Popularite inconnue.
      popularity: null,
      // Annee inconnue.
      year: null,
      // Nombre de chapitres inconnu.
      chapterCount: null,
      // Identifiant de la source.
      sourceId: this.id,
      // Nom de la source.
      sourceName: this.name,
    // Ferme l'objet resultat.
    };
  // Ferme la methode _toSearchResult.
  }

  // ---------------------------------------------------------------------------
  // Fiche Manga & Chapitres
  // ---------------------------------------------------------------------------

  // Recupere les informations d'un manga.
  async getMangaInfo(mangaId) {
    // Normalise l'identifiant en slug.
    const slug = String(mangaId || "").trim();
    // Leve une erreur si le slug est vide.
    if (!slug) throw httpError(404, "Identifiant manga JapScan invalide");

    // Prepare les donnees de la fiche.
    let pageData = null;
    // Indique si le chargement a echoue (403).
    let fetchFailed403 = false;

    // Tente de charger la fiche manga.
    try {
      // Recupere la page.
      pageData = await this._fetchHtml(`/manga/${slug}/`);
    // Capture les erreurs.
    } catch (err) {
      // Relance immediatement les erreurs 404.
      if (err.status === 404) throw err;
      // Marque un echec de type 403.
      fetchFailed403 = true;
    // Ferme le bloc catch.
    }

    // Si Cloudflare a bloqué l'accès direct aux détails, on génère une fiche de secours propre avec externalUrl
    // Si le chargement a echoue...
    if (fetchFailed403 || !pageData) {
      // ...genere un titre a partir du slug.
      const title = prettifySlug(slug);
      // ...construit l'URL de secours.
      const fallbackUrl = `${this.baseUrl}/manga/${slug}/`;
      // ...renvoie une fiche de secours.
      return {
        // Identifiant.
        id: slug,
        // Titre.
        title,
        // Auteur.
        author: "JapScan",
        // Description expliquant le blocage.
        description: `⚠️ Les détails de ce manga sur JapScan sont temporairement sous protection Cloudflare (403). Vous pouvez accéder directement aux chapitres sur le site officiel via le bouton ci-dessous.`,
        // Couverture passee par le proxy.
        cover: images.proxied(`${this.baseUrl}/imgs/mangas/${slug}.jpg`),
        // Statut ongoing.
        status: "ongoing",
        // Genre Manga.
        genre: "Manga",
        // Tags.
        tags: ["VF", "Cloudflare Protection"],
        // Note inconnue.
        rating: null,
        // Popularite inconnue.
        popularity: null,
        // Annee inconnue.
        year: null,
        // Un seul chapitre.
        chapterCount: 1,
        // URL externe de secours.
        externalUrl: fallbackUrl,
        // Liste des chapitres de secours.
        chapters: [
          // Debut du chapitre de secours.
          {
            // Identifiant du chapitre.
            id: "1",
            // Titre du chapitre.
            title: "Lire sur JapScan (Site Officiel)",
            // Ordre du chapitre.
            order: 1,
            // URL externe du chapitre.
            externalUrl: fallbackUrl,
          // Ferme l'objet chapitre.
          },
        // Ferme le tableau des chapitres.
        ],
        // Identifiant de la source.
        sourceId: this.id,
        // Nom de la source.
        sourceName: this.name,
      // Ferme l'objet fiche.
      };
    // Ferme le bloc if.
    }

    // Recupere HTML et URL de la fiche.
    const { html, url } = pageData;

    // Declare la recherche du titre.
    const titleMatch =
      // Cherche la balise h1.
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      // Sinon, cherche og:title.
      html.match(/<meta property="og:title" content="([^"]*)"/i);
    // Determine le titre final.
    const title = titleMatch
      // Nettoie le titre et retire le suffixe Japscan.
      ? cleanText(titleMatch[1]).replace(/\s*-\s*Japscan.*$/i, "")
      // Sinon, utilise le slug transforme.
      : prettifySlug(slug);

    // Declare la recherche de description.
    const descMatch =
      // Cherche un bloc synopsis.
      html.match(/<div[^>]*class=["'][^"']*synopsis[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      // Cherche un paragraphe description.
      html.match(/<p[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
      // Cherche og:description.
      html.match(/<meta property="og:description" content="([^"]*)"/i);
    // Nettoie la description ou vide.
    const description = descMatch ? cleanText(descMatch[1]) : "";

    // Declare la recherche de couverture.
    const coverMatch =
      // Cherche une image de classe cover.
      html.match(/<img[^>]*class=["'][^"']*cover[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
      // Cherche og:image.
      html.match(/<meta property="og:image" content="([^"]*)"/i);
    // Extrait la couverture.
    let cover = coverMatch ? coverMatch[1] : null;
    // Si la couverture est relative...
    if (cover && !cover.startsWith("http")) {
      // ...resout l'URL absolue.
      cover = new URL(cover, url).href;
    // Ferme le bloc if.
    }

    // Cherche l'auteur.
    const authorMatch = html.match(/Auteur(?:s)?\s*:\s*<\/b>\s*([^<]+)/i);
    // Extrait l'auteur ou Inconnu.
    const author = authorMatch ? cleanText(authorMatch[1]) : "Inconnu";

    // Cherche le statut.
    const statusMatch = html.match(/Statut\s*:\s*<\/b>\s*([^<]+)/i);
    // Extrait le statut en minuscules.
    const statusText = statusMatch ? cleanText(statusMatch[1]).toLowerCase() : "";
    // Determine si l'oeuvre est terminee.
    const status = statusText.includes("terminé") || statusText.includes("completed")
      // Statut completed.
      ? "completed"
      // Sinon ongoing.
      : "ongoing";

    // Analyse la liste des chapitres.
    const chapters = this._parseChapterList(html, slug);
    // Si aucun chapitre n'est trouve...
    if (!chapters.length) {
      // ...ajoute un chapitre par defaut.
      chapters.push({
        // Identifiant.
        id: "1",
        // Titre.
        title: "Chapitre 1",
        // Ordre.
        order: 1,
        // URL externe par defaut.
        externalUrl: `${this.baseUrl}/lecture-en-ligne/${slug}/1/`,
      // Ferme l'objet chapitre.
      });
    // Ferme le bloc if.
    }

    // Renvoie la fiche manga.
    return {
      // Identifiant.
      id: slug,
      // Titre.
      title,
      // Auteur.
      author,
      // Description.
      description,
      // Couverture passee par le proxy.
      cover: images.proxied(cover),
      // Statut.
      status,
      // Genre Manga.
      genre: "Manga",
      // Tags.
      tags: ["VF"],
      // Note inconnue.
      rating: null,
      // Popularite inconnue.
      popularity: null,
      // Annee inconnue.
      year: null,
      // Nombre de chapitres.
      chapterCount: chapters.length,
      // Liste des chapitres.
      chapters,
      // Identifiant de la source.
      sourceId: this.id,
      // Nom de la source.
      sourceName: this.name,
    // Ferme l'objet fiche.
    };
  // Ferme la methode getMangaInfo.
  }

  // Analyse la liste des chapitres d'un manga.
  _parseChapterList(html, mangaSlug) {
    // Accumule les chapitres.
    const chapters = [];
    // Memorise les identifiants deja vus.
    const seen = new Set();

    // Construit dynamiquement une regex pour ce manga.
    const re = new RegExp(
      // Motif capturant les liens de chapitres.
      `href=["'](?:/manga|/lecture-en-ligne)/${mangaSlug}/([^/'"]+)/?["'][^>]*>([\\s\\S]*?)</a>`,
      // Options insensibles a la casse et globales.
      "gi"
    // Ferme l'appel RegExp.
    );
    // Variable recevant chaque correspondance.
    let m;

    // Parcourt toutes les correspondances.
    while ((m = re.exec(html))) {
      // Extrait l'identifiant du chapitre.
      const chapterId = m[1];
      // Nettoie le titre brut.
      const rawTitle = cleanText(m[2]);

      // Ignore les entrees invalides ou deja vues.
      if (!chapterId || seen.has(chapterId)) continue;
      // Marque le chapitre comme vu.
      seen.add(chapterId);

      // Deduit un numero de chapitre.
      const num = Number(chapterId.replace(/[^0-9.]/g, "")) || chapters.length + 1;
      // Ajoute le chapitre a la liste.
      chapters.push({
        // Identifiant du chapitre.
        id: chapterId,
        // Titre ou valeur par defaut.
        title: rawTitle || `Chapitre ${chapterId}`,
        // Ordre du chapitre.
        order: num,
        // URL externe de lecture.
        externalUrl: `${this.baseUrl}/lecture-en-ligne/${mangaSlug}/${chapterId}/`,
      // Ferme l'objet chapitre.
      });
    // Ferme la boucle while.
    }

    // Renvoie les chapitres tries par ordre.
    return chapters.sort((a, b) => a.order - b.order);
  // Ferme la methode _parseChapterList.
  }

  // ---------------------------------------------------------------------------
  // Pages d'un chapitre
  // ---------------------------------------------------------------------------

  // Recupere les pages d'un chapitre.
  async getChapterPages(mangaId, chapterId) {
    // Normalise l'identifiant du manga.
    const slug = String(mangaId || "").trim();
    // Normalise l'identifiant du chapitre.
    const chap = String(chapterId || "").trim();

    // Leve une erreur si l'un est vide.
    if (!slug || !chap) throw httpError(404, "Chapitre JapScan introuvable");

    // Construit l'URL externe de lecture.
    const externalUrl = `${this.baseUrl}/lecture-en-ligne/${slug}/${chap}/`;

    // Prepare les donnees de la page.
    let pageData = null;
    // Tente de charger la page de lecture.
    try {
      // Recupere la page de lecture.
      pageData = await this._fetchHtml(`/lecture-en-ligne/${slug}/${chap}/`);
    // En cas d'echec...
    } catch {
      // ...essaie une autre URL.
      try {
        // Recupere la page via /manga/.
        pageData = await this._fetchHtml(`/manga/${slug}/${chap}/`);
      // En cas d'echec a nouveau...
      } catch {
        // En cas d'erreur de blocage Cloudflare 403, retourne un objet lisible sans faire crasher l'app
        // ...renvoie un objet lisible de secours.
        return {
          // Identifiant.
          id: chap,
          // Titre.
          title: `Chapitre ${chap}`,
          // Ordre.
          order: Number(chap.replace(/[^0-9.]/g, "")) || 1,
          // Aucune page.
          pages: [],
          // Aucune page basse resolution.
          pagesLow: [],
          // URL externe.
          externalUrl,
        // Ferme l'objet de secours.
        };
      // Ferme le catch interne.
      }
    // Ferme le catch externe.
    }

    // Recupere HTML et URL de la page.
    const { html, url } = pageData;
    // Extrait les images du chapitre.
    const imageUrls = this._extractChapterImages(html, url);

    // Si aucune image n'est trouvee...
    if (!imageUrls.length) {
      // ...renvoie un objet sans pages.
      return {
        // Identifiant.
        id: chap,
        // Titre.
        title: `Chapitre ${chap}`,
        // Ordre.
        order: Number(chap.replace(/[^0-9.]/g, "")) || 1,
        // Aucune page.
        pages: [],
        // Aucune page basse resolution.
        pagesLow: [],
        // URL externe.
        externalUrl: url || externalUrl,
      // Ferme l'objet.
      };
    // Ferme le bloc if.
    }

    // Renvoie l'objet de lecture.
    return {
      // Identifiant.
      id: chap,
      // Titre.
      title: `Chapitre ${chap}`,
      // Ordre.
      order: Number(chap.replace(/[^0-9.]/g, "")) || 1,
      // Pages passees par le proxy.
      pages: images.proxiedAll(imageUrls),
      // Aucune page basse resolution.
      pagesLow: [],
      // URL externe.
      externalUrl: url || externalUrl,
    // Ferme l'objet.
    };
  // Ferme la methode getChapterPages.
  }

  // Extrait les URLs des images d'un chapitre.
  _extractChapterImages(html, baseUrl) {
    // Accumule les images.
    const imagesList = [];
    // Memorise les URLs deja vues.
    const seen = new Set();

    // Regex capturant les balises img et leurs sources.
    const imgRe = /<img\s[^>]*?(?:data-src|data-lazy-src|src)=["']([^"']+)["'][^>]*?>/gi;
    // Variable recevant chaque correspondance.
    let m;

    // Parcourt toutes les balises img.
    while ((m = imgRe.exec(html))) {
      // Extrait l'URL de la source.
      const src = m[1];
      // Ignore les images non pertinentes.
      if (!src || src.startsWith("data:") || src.includes("logo") || src.includes("banner")) continue;

      // Prepare l'URL complete.
      let fullUrl = src;
      // Si l'URL est relative...
      if (!fullUrl.startsWith("http")) {
        // ...la resout en absolue.
        fullUrl = new URL(fullUrl, baseUrl).href;
      // Ferme le bloc if.
      }

      // Si l'URL n'a pas deja ete vue...
      if (!seen.has(fullUrl)) {
        // ...la marque comme vue.
        seen.add(fullUrl);
        // ...et l'ajoute a la liste.
        imagesList.push(fullUrl);
      // Ferme le bloc if.
      }
    // Ferme la boucle while.
    }

    // Cherche une variable JS contenant les images.
    const jsImagesMatch = html.match(/var\s+images\s*=\s*(\[[^\]]+\]);/i);
    // Si cette variable existe...
    if (jsImagesMatch && jsImagesMatch[1]) {
      // ...tente de l'analyser.
      try {
        // ...parse le tableau JSON.
        const parsed = JSON.parse(jsImagesMatch[1]);
        // Si le resultat est un tableau...
        if (Array.isArray(parsed)) {
          // ...parcourt chaque chemin d'image.
          for (const imgPath of parsed) {
            // Prepare l'URL complete.
            const fullUrl = imgPath.startsWith("http")
              // Utilise l'URL telle quelle si absolue.
              ? imgPath
              // Sinon, la resout en absolue.
              : new URL(imgPath, baseUrl).href;
            // Si l'URL n'a pas deja ete vue...
            if (!seen.has(fullUrl)) {
              // ...la marque comme vue.
              seen.add(fullUrl);
              // ...et l'ajoute a la liste.
              imagesList.push(fullUrl);
            // Ferme le bloc if.
            }
          // Ferme la boucle for.
          }
        // Ferme le bloc if.
        }
      // Ignore les erreurs de parsing JSON.
      } catch {}
    // Ferme le bloc if.
    }

    // Renvoie la liste des images.
    return imagesList;
  // Ferme la methode _extractChapterImages.
  }
// Ferme la classe JapScanSource.
}

// Exporte la classe pour le chargeur de sources.
module.exports = JapScanSource;
