# OptiManga — Explication détaillée du code

Ce document décrit **chaque fichier source** du projet : son rôle, ses fonctions/classes,
leurs paramètres, ce qu'elles renvoient et comment les morceaux s'enchaînent.

> Convention de lecture : `file.js:ligne` renvoie à l'emplacement dans le dépôt.
> Les fichiers `.proto` de `extension/mangaplus/protos/` sont des schémas Protocol
> Buffers vendorisés (générés/traduits depuis l'API Manga Plus) : ils ne contiennent
> pas de logique, ils ne sont donc pas détaillés ligne à ligne.

---

## Table des matières

1. [Vue d'ensemble & architecture](#1-vue-densemble--architecture)
2. [Backend](#2-backend)
   - [server.js](#serverjs)
   - [src/app.js](#srcappjs)
   - [src/routes.js](#srcroutesjs)
   - [src/cache.js](#srccachejs)
   - [src/jobs.js](#srcjobsjs)
   - [src/rateLimit.js](#srcratelimitjs)
   - [data/db.js](#datadbjs)
3. [Système d'extensions](#3-système-dextensions)
   - [extension/BaseSource.js](#extensionbasesourcejs)
   - [extension/registry.js](#extensionregistryjs)
   - [extension/utils.js](#extensionutilsjs)
   - [extension/images.js](#extensionimagesjs)
   - [extension/cbz.js](#extensioncbzjs)
   - [extension/mangadex-client.js](#extensionmangadex-clientjs)
4. [Sources de contenu](#4-sources-de-contenu)
   - [mangadex.js / mangadex-fr.js / mangadex-en.js](#extensionsourcesmangadexjs)
   - [webtoons.js](#extensionsourceswebtoonsjs)
   - [mangaplus.js](#extensionsourcesmangaplusjs)
   - [animesama.js](#extensionsourcesanimesamajs)
   - [anilist.js](#extensionsourcesanilistjs)
   - [japscan.js](#extensionsourcesjapscanjs)
5. [Frontend](#5-frontend)
   - [public/index.html](#publicindexhtml)
   - [public/css/style.css](#publiccssstylecss)
   - [public/js/main.js](#publicjsmainjs)
   - [public/js/router.js](#public-js.jsrouterjs)
   - [public/js/api.js](#public-jsjsapijs)
   - [public/js/state.js](#public-jsjsstatejs)
   - [public/js/ui.js](#public-jsjsuijs)
   - [public/js/icons.js](#public-jsjsiconsjs)
   - [public/js/views/*.js](#public-jsviewsjs)
6. [Flux complets (de bout en bout)](#6-flux-complets-de-bout-en-bout)
7. [Ajouter une extension](#7-ajouter-une-extension)

---

## 1. Vue d'ensemble & architecture

OptiManga est une **liseuse manga/anime auto-hébergée** :

- **Serveur** : Node.js + Express, en CommonJS (`require`). Il sert une API REST
  (`/api/*`), les fichiers CBZ (`/files/*`), et l'application front.
- **Frontend** : application mono-page (SPA) en **modules ES natifs**, sans étape de
  build. Le routage se fait sur le *hash* d'URL (`#/catalogue`, `#/read/…`).
- **Extensions** : chaque « source » (MangaDex, WEBTOON, Manga Plus, AniList,
  Anime-Sama, JapScan) est un fichier dans `extension/sources/` découvert **au
  démarrage** par un registre. Aucune liste n'est codée en dur.
- **Persistance** : un simple fichier JSON (`data/db.json`) pour favoris, historique,
  progression, bibliothèque CBZ et état des extensions.

### Schéma logique

```
Navigateur (SPA public/)
   │  fetch /api/...
   ▼
Express (src/app.js)
   │  middleware : cors, json, rateLimit, en-têtes
   ├── /api        → src/routes.js
   ├── /files/:f   → téléchargement CBZ
   └── /*          → public/index.html (SPA)

src/routes.js
   ├── registry (extension/registry.js) → sources (extension/sources/*.js)
   ├── cache    (src/cache.js)           → mémoïse les réponses des sources
   ├── jobs     (src/jobs.js)            → progression des exports CBZ
   ├── images   (extension/images.js)    → proxy & déchiffrement d'images
   ├── cbz      (extension/cbz.js)       → téléchargement pages + zip
   └── db       (data/db.js)             → état utilisateur
```

### Conventions transverses

- **Erreurs HTTP** : toute la couche métier lève des erreurs portant une propriété
  `status` via `httpError(status, message)` (`extension/utils.js`). Le gestionnaire
  d'erreurs d'Express (`src/app.js`) les transforme en `{ error: message }` avec le bon
  code.
- **Cache** : `cache.wrap(clé, ttl, producer)` renvoie la valeur mémoïsée si présente,
  sinon exécute la fonction asynchrone et la stocke.
- **Fonctions `async`** : les méthodes des sources sont toutes asynchrones et peuvent
  rejeter une erreur décorée par `httpError`.

---

## 2. Backend

### `server.js`

Point d'entrée minimal (5 lignes).

- `require("./src/app")` importe `{ start }`.
- `start()` lance le serveur HTTP.
- `"use strict"` active le mode strict.

C'est le fichier désigné par `"main"` et par le script `npm start`.

### `src/app.js`

Assemble l'application Express et démarre l'écoute.

**Constantes (haut de fichier)**

- `ROOT` : racine du dépôt (`src/..`).
- `PUBLIC_DIR` : dossier des assets statiques (`public/`).
- `DOWNLOADS_DIR` : dossier des CBZ. Surchargeable via `OPTIMANGA_DOWNLOADS_DIR` puis
  `NOVELHUB_DOWNLOADS_DIR` (compat. ancien nom), sinon `downloads/`.
- `fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })` : garantit l'existence du dossier.
- **Nettoyage au démarrage** : parcourt `DOWNLOADS_DIR`, supprime tout dossier dont le
  nom commence par `.tmp-` (exports interrompus par un arrêt brutal). Erreur tolérée
  (simple `console.warn`).

**`downloadRoute(req, res, next)`**

Sert un fichier CBZ (`GET /files/:filename`).

- `path.basename(req.params.filename)` : **neutralise toute traversée de chemin**
  (`../`) en ne gardant que le nom de fichier.
- Si le fichier n'existe pas → `httpError(404, …)`.
- `res.download(filePath, filename, cb)` : envoie le fichier en pièce jointe ; toute
  erreur d'envoi est propagée à `next` (si les en-têtes ne sont pas déjà partis).

**`createApp()`** — construit et renvoie l'app Express :

1. `app.set("trust proxy", true)` : fait confiance à `X-Forwarded-For` (utile derrière
   un reverse proxy ; nécessaire au rate-limit par IP).
2. `cors()` : autorise les appels cross-origin.
3. `express.json({ limit: "1mb" })` : parse les corps JSON, taille max 1 Mo.
4. `limiter({ windowMs: 60_000, max: 1200 })` : rate-limit global (voir `rateLimit.js`).
5. Middleware ajoutant `X-Content-Type-Options: nosniff` (sécurité anti-MIME sniffing).
6. Monte le routeur API sur `/api` (`src/routes.js`).
7. `GET /files/:filename` → `downloadRoute`.
8. `express.static(PUBLIC_DIR, { index: "index.html", maxAge: "0", etag: true })` : sert
   le front. `maxAge: 0` + `etag` pour éviter la mise en cache longue pendant le dev.
9. **Catch-all SPA** : toute requête `GET` hors `/api` et `/files` renvoie
   `index.html` (le routeur front prend le relais). Les autres méthodes passent à la
   suite.
10. 404 JSON par défaut : `{ error: "Ressource introuvable" }`.
11. **Gestionnaire d'erreurs** (4 arguments) : déduit le code de `err.status || 500`,
    journalise les 5xx, répond `{ error: err.message }`.

**`start()`** — démarre le serveur :

- `PORT = process.env.PORT || 3000`.
- `app.listen(PORT, cb)` : affiche l'URL d'accès.
- `shutdown()` : `db.flush()` (force l'écriture du JSON), `server.close()` puis
  `process.exit(0)` ; garde-fou de 2 s (`setTimeout(...).unref()`) pour sortir même si
  des connexions traînent.
- Branche `SIGINT` (Ctrl-C) et `SIGTERM` sur `shutdown`.
- Renvoie l'instance `server`.

Exporte `{ createApp, start }` (le `createApp` séparé facilite les tests).

### `src/routes.js`

Cœur de l'API REST. C'est le fichier le plus dense du backend.

**Constantes & helpers internes**

- `DOWNLOADS_DIR` : même logique que `app.js` (cohérence des chemins).
- `STATE_KEYS = ["favorites", "history", "progress"]` : clés d'état modifiables via
  l'API.
- `ensureDownloadsDir()` : crée `DOWNLOADS_DIR` si absent (avant d'écrire un CBZ).
- `searchSource(source, query, options)` : mémoïse (`cache.wrap`) la recherche pendant
  **60 s**, clé construite sur `id + query + genre + status + sort + limit + offset`.
- `mangaInfo(source, mangaId)` : mémoïse la fiche pendant **300 s**.
- `chapterPages(source, mangaId, chapterId)` : mémoïse les pages pendant **900 s**.
- `normalizeSearch(out, fallbackTotal)` : uniformise le retour d'un `search` de source
  en `{ results, total }` (accepte un tableau brut ou un objet `{ results, total }`).
- `allMangas()` : mémoïse 60 s la concaténation des recherches « vides » (`search("")`)
  de toutes les sources **actives**, en ajoutant `sourceId` à chaque item. Sert aux
  statistiques.

**Proxy d'images** (`GET /api/image?url=…&vwt=…&k=…`)

Objectif : certains CDN exigent un `Referer` de leur domaine (WEBTOON/pstatic), ou un
jeton (`Plus-Vw-Token`) et un déchiffrement XOR (Manga Plus). Un navigateur ne peut pas
les fournir → le serveur les requête à sa place.

- Constantes : cache-control `public, max-age=604800, immutable`, **12 fetch
  simultanés max**, **120 entrées / 64 Mo** de cache, taille d'image **15 Mo max**.
- `imageCache` : `Map` url → `{ buf, type, bytes }` ; `imageCacheBytes` (volume
  total) ; `imageActive` (compteur de requêtes en vol) ; `imageWaiters` (file
  d'attente).
- `imageCachePut(url, entry)` : ignore les entrées trop grosses ; ré-insert en fin
  (pseudo-LRU) ; évince les plus anciennes jusqu'à respecter les bornes.
- `acquireImageSlot()` / `releaseImageSlot()` : sémaphore simple limitant la
  concurrence à 12 (mécanisme de "promesse en attente").
- Handler :
  1. `images.resolve(query.url)` puis `images.isProxiable(url)` : **anti-SSRF**, on
     refuse une URL hors des hôtes autorisés.
  2. Cache-hit → renvoie le buffer tel quel.
  3. Sinon `await acquireImageSlot()`, `fetch` avec `AbortController` (timeout 20 s),
     en-têtes via `images.headersFor` (Referer/jeton).
  4. Vérifie `ok`, récupère le buffer, applique `images.decodePage(buf, images.kOf(...))`
     (déchiffrement XOR Manga Plus le cas échéant), vérifie la taille, type MIME, met en
     cache et répond.
  5. `finally` → `releaseImageSlot()`.
  Tout est capté et transmis à `next(err)`.

**Santé / statistiques**

- `GET /api/health` : `{ ok: true, uptime, time }`.
- `GET /api/stats` : agrège via `allMangas()` le nombre de mangas et de chapitres,
  compte les chapitres lus dans `db.get("progress")`, les favoris, la bibliothèque, et
  `db.get("stats").downloads`.

**Extensions**

- `GET /api/extensions` : `{ installed: registry.list() }`.
- `PATCH /api/extensions/:id` : attend `{ enabled: boolean }` ; appelle
  `registry.setEnabled` ; **vide le cache** (les résultats changent quand on
  active/désactive) ; renvoie l'extension mise à jour.
- `GET /api/genres` : genres fusionnés de toutes les sources actives
  (`registry.genres()`).

**Recherche / catalogue** — `GET /api/search`

Paramètres : `q`, `source` (défaut `all`), `genre`, `status`, `sort`, `limit`, `offset`.

- `limit` borné à `1..100` (défaut 24) ; `offset ≥ 0`.
- `sort` validé contre `allowedSorts` (`relevance, popularity, rating, recent,
  chapters, title`).
- Trois cas :
  1. `source === "all"` **avec une seule source active** → délègue à cette source et
     **pagine** (`paginated = true`).
  2. `source === "all"` **avec plusieurs** → lance toutes les sources en parallèle et
     fusionne (`flatMap`), puis trie **localement** selon `sort` (les sources ne
     partagent pas la même notion de tri). `paginated = false`.
  3. `source` précise → délègue et pagine via `registry.get(source)` (lève 404/403 si
     inconnue/désactivée).
- Réponse : `{ count, total, paginated, results }`.

**Lecture**

- `GET /api/sources/:sourceId/mangas/:mangaId` : renvoie `mangaInfo(...)` (fiche +
  chapitres).
- `GET /api/sources/:sourceId/mangas/:mangaId/chapters/:chapterId` : récupère les pages.
  - Si `getChapterPages` lève une **404** (chapitre non hébergé, ex. renvoi éditeur), on
    reconstruit un objet minimal contenant `externalUrl` (tiré des métadonnées du
    chapitre) pour permettre l'affichage embarqué côté client.
  - Ensuite, on « complète » `title`/`order`/`externalUrl` depuis la fiche (mise en
    cache), sans écraser les valeurs déjà présentes.
  - Toute autre erreur est propagée.

**Export CBZ** — `POST /api/sources/:sourceId/mangas/:mangaId/download`

Corps attendu : `{ from, to }` (ordres de chapitres).

1. Récupère la fiche, filtre les chapitres par plage `[fromN, toN]` (défauts = premier et
   dernier ordre). Vérifie que la plage est valide et non vide.
2. `jobs.create({ type: "cbz", title })` : crée une tâche suivie.
3. **Lance une IIFE asynchrone** (le HTTP répond tout de suite) qui :
   - crée un dossier temporaire `.tmp-<jobId>` ;
   - boucle les chapitres, met à jour la progression (`jobs.update`),
   - **saute** les chapitres `externalUrl` et ceux dont les pages sont vides/indisponibles
     (compteur `skipped`) ;
   - `downloadChapter(...)` télécharge les pages (concurrence 3) ;
   - après la boucle, si aucun chapitre hébergé → erreur ;
   - `buildCbz(tmpRoot)` fabrique le zip en mémoire ;
   - écrit le fichier `.cbz` (nom `slug-titre-sourceid-timestamp.cbz`) ;
   - construit une entrée de bibliothèque et l'insère dans `db` (`library`), incrémente
     `stats.downloads` ;
   - `jobs.update(..., status: "done", result)` (ou `"error"` en cas d'échec) ;
   - `finally` → supprime le dossier temporaire.
4. Répond **202** `{ jobId }`.

- `GET /api/jobs/:id` : renvoie l'état d'une tâche (404 si inconnue).

**Bibliothèque**

- `GET /api/library` : liste les entrées ; calcule `url = /files/<filename>` seulement si
  le fichier existe encore (`null` sinon).
- `DELETE /api/library/:id` : retire l'entrée `db` et supprime le fichier (via
  `path.basename`). 404 si l'entrée n'existe pas.

**État utilisateur** (`/api/state`)

- `GET` : renvoie `{ favorites, history, progress }`.
- `PUT` : pour chaque clé présente dans le corps :
  - `favorites`/`history` : doit être un tableau ; **plafonné à 500 éléments**, chaque
    élément non-null.
  - `progress` : doit être un objet ; on nettoie chaque entrée — max **500 mangas**, et
    pour chacun : `read` (tableau de chaînes ≤ 500), `words` (entier ≥ 0), `last`
    (objet ou null), `updatedAt`.
  - Renvoie les valeurs effectivement enregistrées.
- `DELETE` : `db.reset()` + `cache.clear()` (réinitialisation complète).

Exporte le routeur Express.

### `src/cache.js`

Cache mémoire à durée de vie (TTL), volontairement simple.

- `store = new Map()` : clé → `{ value, expires }`.
- `get(key)` : renvoie `undefined` si absent ou expiré (et supprime l'entrée expirée).
- `set(key, value, ttlMs = 60000)` : stocke avec expiration ; si `store.size > 500`,
  évince la première clé insérée (ordre d'insertion ≈ FIFO). Renvoie `value`.
- `wrap(key, ttlMs, producer)` : optimisation classique — si en cache, renvoie la
  promesse résolue ; sinon exécute `producer()` (synchrone ou async) puis met en cache.
- `clear(prefix)` : vide tout, ou seulement les clés commençant par `prefix`.

Le cache n'est **jamais** invalidé automatiquement par TTL lors d'une lecture — il peut
donc servir une valeur un peu ancienne ; c'est acceptable pour un catalogue.

### `src/jobs.js`

File d'attente **en mémoire** pour les tâches longues (aujourd'hui : export CBZ).

- `jobs = new Map()` ; `MAX_AGE = 45 min`.
- `create({ type, title })` : génère un id `job_<timestamp36>_<random>`, crée l'objet
  tâche (`status: "running"`, `progress`, `total`, `message`, `result`, `error`,
  `createdAt`), l'enregistre, déclenche un nettoyage (`_gc`) et le renvoie.
- `get(id)` : renvoie la tâche ou `null`.
- `update(id, patch)` : fusionne `patch` dans la tâche (`Object.assign`) ; `null` si
  inconnue.
- `_gc()` : supprime les tâches plus vieilles que `MAX_AGE`.

Les tâches sont perdues au redémarrage (choix assumé : ce sont des opérations courtes).

### `src/rateLimit.js`

Limiteur de débit en mémoire, par IP (« token bucket » simplifié par fenêtre).

- `buckets = new Map()` : clé IP → `{ start, count }`.
- `limiter({ windowMs = 60000, max = 600 })` renvoie un middleware Express :
  - clé = `req.ip` ou l'adresse de socket, sinon `"anon"` ;
  - crée/réinitialise le compteur si la fenêtre est dépassée ;
  - incrémente ; au-delà de 2000 buckets, purge les buckets expirés ;
  - si `count > max` → réponse **429** JSON ;
  - sinon `next()`.

`src/app.js` l'utilise avec `max: 1200`/min.

### `data/db.js`

Persistance JSON locale, **atomique** et *debouncée*.

- `DATA_DIR = process.env.NOVELHUB_DATA_DIR || __dirname` ; `DB_FILE = db.json`.
- `DEFAULTS` : structure initiale (`favorites`, `history`, `progress`, `library`,
  `extensions`, `stats`).
- `state`/`saveTimer` : état en mémoire et minuteur d'écriture.
- `_load()` : charge paresseusement le fichier ; en cas de JSON illisible, log + repart
  des valeurs par défaut ; fusionne les défauts avec le contenu lu.
- `_persist()` : écrit dans `db.json.tmp` puis **`renameSync`** (écriture atomique :
  jamais de fichier à moitié écrit).
- `_scheduleSave()` : reporte l'écriture de 60 ms (regroupe les modifications rapprochées).
- `get(key)` : renvoie tout l'état (sans clé) ou une clé.
- `set(key, value)` / `update(key, fn)` : modifient l'état puis programment la sauvegarde.
- `flush()` : force une écriture immédiate (appelé à l'arrêt du serveur).
- `reset()` : remet `DEFAULTS` et persiste.

Exporte aussi `DB_FILE` et `DEFAULTS`.

---

## 3. Système d'extensions

### `extension/BaseSource.js`

**Contrat** que toute extension doit respecter. Une extension = une source de contenu.

**Constructeur** (objet d'options) : `id`, `name` (obligatoires), `baseUrl`, `lang`,
`version`, `description`, `genres`, `author`, `mediaType` (`"manga"` ou `"anime"`),
`color`, `defaultEnabled`. Renseigne `installed = true` et `enabled = defaultEnabled`.

**Méthodes à implémenter (sinon 501 : non implémentée)**

- `async search(query, options)` → `{ results, total }` (ou tableau). `options` :
  `{ genre, status, sort, limit, offset }`. Chaque résultat doit exposer au moins
  `{ id, title, cover, author, status, genre, tags, rating, popularity, year,
  chapterCount, sourceId, sourceName }`.
- `async getMangaInfo(mangaId)` → fiche détaillée avec `chapters: [{ id, title, order,
  externalUrl?, pages? }]`.
- `async getChapterPages(mangaId, chapterId)` → `{ id, title, order, pages: [urls],
  pagesLow?: [urls], externalUrl?, players? }`.

**Méthodes d'obsolescence** : `getNovelInfo()` / `getChapterContent()` lèvent une 501
rappelant qu'elles ont été renommées (compat. ascendante).

**`async getGenres()`** : renvoie `this.genres` (surchargée par certaines sources qui
récupèrent les genres dynamiquement).

**`toJSON()`** : vue publique exposée par l'API (omet `enabled` ? non — elle l'inclut ;
omet les champs internes comme les caches).

### `extension/registry.js`

**Découverte dynamique** et activation des extensions. Exporte une **instance unique**
(singleton) : `new ExtensionRegistry()`.

- `_loadAll()` (appelé au constructeur) :
  - lit `extension/sources/` (s'il n'existe pas, avertit et s'arrête) ;
  - filtré `.js`, trié ;
  - pour chaque fichier : `require`, instanciation, **dédoublonnage de l'id**, puis
    application de la préférence utilisateur (`db.get("extensions")`) si présente, sinon
    `defaultEnabled` ;
  - stocke dans `this.sources`, journalise ; les fichiers en erreur sont signalés sans
    interrompre les autres.
- `list()` : `toJSON()` de toutes les sources.
- `get(id)` : renvoie la source ; lève **404** si inconnue, **403** si désactivée.
- `setEnabled(id, enabled)` : met à jour `enabled` en mémoire **et** persiste la
  préférence (`db.update("extensions", …)` avec `updatedAt`). Renvoie `toJSON()`.
- `enabled()` : sources actives (utilisé pour la recherche multi-sources et le catalogue).
- `async genres()` : fusionne (Set) les genres de toutes les sources actives via
  `getGenres()`/`genres()` (sync ou async), renvoie trié en français.

### `extension/utils.js`

Petits utilitaires partagés.

- `hashString(str)` : hash déterministe **djb2** (décalage + addition ; `>>> 0` pour
  rester un entier 32 bits non signé).
- `pick(list, seed)` : sélection déterministe d'un élément (utile pour un placeholder
  stable).
- `wordCount(html)` : retire les balises et entités, puis compte les mots.
- `normalize(str)` : minuscule + suppression des diacritiques (accents) via NFD.
- `slugify(str)` : titre → nom de fichier sûr (accents retirés, non-alphanumérique → `-`,
  trim des tirets, 60 caractères max, défaut `"sans-titre"`).
- `httpError(status, message)` : fabrique une `Error` avec une propriété `status`.

### `extension/images.js`

Gestion des **images distantes protégées** (hotlink ou jeton).

Le problème : certains CDN renvoient 403 sans `Referer` de leur domaine
(`pstatic.net`/WEBTOON) ; d'autres exigent l'en-tête `Plus-Vw-Token` et **chiffrent**
les pages en XOR (Manga Plus). Le navigateur ne peut pas usurper ça → le serveur proxifie.

**Constantes**

- `USER_AGENT` : UA navigateur générique (certains sites filtrent les bots).
- `PROXY_PATH = "/api/image"` ; `PROXY_PREFIX = "/api/image?url="`.
- `VWT_PARAM = "vwt"`, `VWT_HEADER = "Plus-Vw-Token"`, `VWT_RE` (validation hex court).
- `KEY_PARAM = "k"`, `KEY_RE` (clé XOR hexadécimale 16–256 caractères).
- `HOST_RULES` : couples `[suffixe d'hôte, en-têtes requis]`. `pstatic.net` → Referer
  webtoons ; les domaines `japscan.*` → Referer japscan ; `tokyo-cdn.com` (Manga Plus)
  → aucun Referer mais jeton/XOR gérés ailleurs.

**Fonctions internes**

- `hostnameOf(url)` : hôte en minuscules ou `null`.
- `ruleFor(url)` : règle applicable à l'hôte (ou `null`).

**Fonctions exportées**

- `isProxyForm(url)` : l'URL commence-t-elle par `/api/image?`.
- `needsProxy(url)` : un `ruleFor` existe (donc passage obligé par le proxy).
- `proxied(url, opts)` : si `needsProxy`, renvoie
  `/api/image?url=<encodé>` et ajoute `&vwt=…` (si `opts.vwt` valide) et `&k=…` (clé XOR
  valide) ; sinon renvoie l'URL inchangée.
- `proxiedAll(urls, opts)` : applique `proxied` à une liste.
- `resolve(url)` : inverse le proxy côté **serveur** (extrait le paramètre `url`).
- `vwtOf(url)` / `kOf(url)` : extraient et valident le jeton / la clé d'une URL
  proxifiée.
- `decodePage(buf, key)` : déchiffre une page Manga Plus par **XOR cyclique** avec la
  clé (`out[i] ^= key[i % keyLen]`) ; renvoie le buffer tel quel sans clé valide.
- `headersFor(url)` : en-têtes à envoyer à l'hôte d'origine : `User-Agent`, `Accept`
  image, `Referer` (selon `ruleFor`) et `Plus-Vw-Token` (si jeton).
- `isProxiable(url)` : **anti-SSRF** — l'URL doit être http(s) **et** correspondre à un
  hôte de `HOST_RULES`. C'est ce que la route `/api/image` vérifie avant tout fetch.

### `extension/cbz.js`

Téléchargement des pages et empaquetage **CBZ** (zip de lecteurs type Tachiyomi/Mihon).

- `UA = "OptiManga/2.0 …"` : UA dédié au téléchargement.
- `mapPool(items, concurrency, fn)` : exécute `fn` sur une liste avec une **borne de
  concurrence** ; retourne les résultats dans l'ordre.
- `fetchImage(url, { timeout = 30000 })` : résout l'URL (dé-proxifie), choisit les
  en-têtes (`images.headersFor` si CDN protégé, sinon UA simple), `fetch` avec timeout,
  vérifie `ok`, décode (XOR éventuel) et renvoie le buffer.
- `imageExt(url)` : déduit l'extension depuis l'URL (`jpg/png/webp/gif/avif`), défaut
  `jpg`.
- `downloadChapter(chapter, chapterDir, { concurrency = 5 })` : délègue à
  `_writeChapter`.
- `_writeChapter(chapterDir, chapter)` : construit un sous-dossier
  `volume-<v>/chapitre-<n>`, télécharge toutes les pages en parallèle borné (5),
  les nomme `001.jpg`, `002.jpg`, … (`padStart(3, "0")`) et renvoie
  `{ dir, files }`.
- `buildCbz(dir)` : `new AdmZip()` + `addLocalFolder(dir)` → `Buffer` (l'archive CBZ).

Exporte `{ downloadChapter, buildCbz, mapPool }`.

### `extension/mangadex-client.js`

Client de l'API publique **MangaDex** (`api.mangadex.org`).

- `API`, `COVER_CDN`, `UA`.
- **Throttle global** : `MIN_INTERVAL = 220 ms` (~4-5 req/s). `throttle(fn)` enchaîne
  les appels sur une file (`queue`) et espace les requêtes. `lastRequest` partagé.
- `_fetch(path, { timeout })` : jusqu'à **3 tentatives** ; `AbortController` pour le
  timeout ; sur **429/5xx**, attend `500*(attempt+1)` ms puis réessaie ; en cas d'erreur
  réseau (pas de `status`), attend `300*(attempt+1)` ms ; les erreurs HTTP définitives
  (`err.status`) sont relancées immédiatement, enrichies du début du corps de réponse.
  Échec final → `httpError(502, "MangaDex injoignable…")`.
- `get(path)` : `throttle(() => _fetch(path))`.
- Helpers de mapping :
  - `coverUrl(mangaId, fileName)` : URL de couverture canonique.
  - `titleOf(attrs)` : choisit un titre par ordre de préférence FR → EN → romaji → ja →
    premier disponible.
  - `altTitleOf(attrs)` : premier titre alternatif FR/EN/romaji.
  - `relationshipOf(relationships, type, attrName)` : lit un attribut d'une relation
    (`cover_art`, `author`…).
  - `tagNames(attrs, max = 8)` : libellés de tags (FR sinon EN), dédoublonnés.
  - `statusOf(status)` : mappe `ongoing/completed/hiatus/cancelled` (défaut `unknown`).
  - `descriptionOf(attrs)` : description FR sinon EN.

---

## 4. Sources de contenu

Toutes héritent de `BaseSource` et sont chargées par le registre. Elles implémentent
`search`, `getMangaInfo`, `getChapterPages` (+ éventuellement `getGenres`).

### `extension/sources/mangadex.js`

Source **MangaDex** (API REST officielle).

**Constantes** : `GENRE_KEYS` (ordre d'affichage des genres), `FALLBACK_TAGS` (ids de
tags vérifiés hors-ligne si l'appel réseau échoue), `SORTS` (mapping des tris de l'app
vers les clés MangaDex).

**Constructeur** : id `mangadex`, lang fr, `languages = ["fr","en"]`,
`contentRating = ["safe","suggestive"]`, caches internes de tags.

**`async _tagMap()`** : récupère `/manga/tag`, ne garde que le groupe `genre`, construit
une `Map` libellé EN → `{ id, label(FR ou EN) }` ; en cas d'échec, utilise
`FALLBACK_TAGS`. Résultat mémoïsé (`_tagIds`).

**`async getGenres()`** : liste curée (`GENRE_KEYS` d'abord), puis complète jusqu'à 24
avec les autres tags. Mémoïsée (`_genreLabels`).

**`async search(query, options)`** :
- construit les `URLSearchParams` : `limit`, `offset`, `hasAvailableChapters=true`,
  `includes[]=cover_art/author/artist`, langs, ratings ;
- filtre par `title` si requête, par tag si `genre`, par `status` si valide ;
- applique le tri MangaDex ;
- mappe les items via `_brief` ;
- **enrichit** note/popularité via `/statistics/manga` (bayesian rating, follows) ;
- **récupère les couvertures manquantes** en un appel groupé (car
  `hasAvailableChapters` vide parfois `cover_art`) ;
- renvoie `{ results, total }`.

**`async getMangaInfo(mangaId)`** : `/manga/{id}` (avec relations) → `_brief` +
`chapters` via `_chapters`.

**`async _chapters(mangaId)`** : pagine `/manga/{id}/feed` (100/page), ignore les
entrées sans titre/numéro (pages de garde), construit les chapitres
(`id, title, chapterNum, volume, order, externalUrl, pages, group`), puis trie par
`order` puis numéro de chapitre (tri numérique).

**`_groupName(relationships)`** : nom de la scanlation (`scanlation_group`) ou
`"Scanlation officielle"` si `siteId`.

**`async getChapterPages(mangaId, chapterId)`** : `/at-home/server/{chapterId}` →
URLs `data/` (haute qualité) et `data-saver/` (éco). 404 si pas de `hash`.

**`_brief(m)`** : mapping commun d'une œuvre (titre, auteur nettoyé des parenthèses,
couverture, statut, tags, année, description, `sourceId/Name`).

### `extension/sources/mangadex-fr.js` / `mangadex-en.js`

Sous-classes triviales de MangaDex : surchargent `id`, `name`, `lang`, `languages`
(`["fr"]` / `["en"]`), la description, et forcent `enabled = false` (pour éviter les
doublons avec la source multi-langues ; à activer à la main).

### `extension/sources/webtoons.js`

Source **WEBTOON** (scraping du site officiel FR `www.webtoons.com`).

- `BASE`, table `GENRES` (code → libellé aligné sur MangaDex), `LABEL_BY_CODE`,
  `CODE_BY_LABEL`, `CODE_BY_FR_LABEL` (libellés FR du site → codes).
- `decodeEntities`, `textOf` : nettoyage HTML ; `parseCount` : « 3,2M Vues » → entier ;
  `prettify` : « mon-slug » → « Mon Slug ».
- `getHtml(url)` : `fetch` avec UA/language, gère 404 (erreur) et autres erreurs (502).

**Parsers (regex ciblées — le site est rendu côté serveur)** :
- `parseCards(html)` : extrait les cartes de titre (recherche/classements/accueil) :
  `titleNo`, `genrePath`, `slug`, `title`, `author`, `cover`, `views`, `genreLabel`,
  `code`. Gère le cas CANVAS (fallback sur le libellé affiché).
- `parseEpisodes(html)` : liste des épisodes (`no`, `href`, `title`, `date`).
- `parsePagination(html)` : numéros de page + page suivante (`pg_next`).
- `parseTitleInfo(html)` : métadonnées de la fiche (titre, auteur, description,
  couverture, genre, vues, statut `completed`/`ongoing`).
- `parseViewerImages(html)` : URLs des planches dans `#_imageList` (classe `_images`).

**id interne** : `encodeId`/`decodeId` → `genrePath__slug__titleNo` (validé par regex).
`listUrl(id, page)` construit l'URL de la liste ; `genreCodeFromLabel(label)`.

**Constructeur** : id `webtoons`, `genres` = libellés de `GENRES`.

**`async search(query, options)`** : charge la recherche (`/fr/search?keyword=`) ou
l'accueil (`/fr/`), dédoublonne, filtre par genre, trie (popularité = vues), pagine.

**`_result(card)`** : mappe une carte vers le format standard (couverture **proxifiée**).

**`async getMangaInfo(mangaId)`** : décode l'id, charge page 1 de la liste, parse la
fiche, récupère tous les épisodes (`_episodeList`), construit les chapitres triés.

**`async _episodeList(id, firstHtml)`** : parcours de pagination par **vagues de 6**
requêtes parallèles ; borné (`guard < 500`), dédoublonné par numéro d'épisode.

**`async getChapterPages(mangaId, chapterId)`** : retrouve l'épisode (calcule la page de
liste par formule ; repli sur un parcours complet si la numérotation est irrégulière),
charge la page du lecteur et renvoie les images **proxifiées**.

### `extension/sources/mangaplus.js`

Source **Manga Plus** (API protobuf officielle Shueisha).

- `API` (`jumpg-webapi.tokyo-cdn.com/api`), `APP_PARAMS`, `LANG_PARAMS` (fra),
  `PROTO_DIR`, `INDEX_TTL` (30 min), `TIMEOUT_MS`.
- `GENRE_TAGS` (genres statiques de secours), `GENRE_ALIASES` (traduit les libellés de
  filtre partagés vers ceux de Manga Plus).
- Helpers : `norm`, `parseId` (id entier positif), `chapterOrder` (déduit le numéro
  depuis `name`/`subTitle`, sinon incrémente), `statusOf` (releaseSchedule → statut),
  `popupMessage`/`errorText` (extraient un message d'erreur lisible), `errorStatus`
  (mappe `MAINTENANCE`/`GEOIP_BLOCKING`→503, `UNAUTHORIZED`→403, sinon 502).
- `responseType()` : charge **paresseusement** `ResponseOuterClass.proto` avec
  `protobufjs` et renvoie le type `mangaplus_api_protocol.Response` (une seule fois).

**Constructeur** : id `mangaplus`, session UUID aléatoire, caches d'index.

**`async _call(endpoint, params)`** : construit l'URL (params app + langue + spécifiques),
`fetch` avec en-têtes `SESSION-TOKEN` et UA, timeout ; décode en protobuf ; si `error` non
vide → lève une erreur lisible ; si `success` vide → 502 ; sinon renvoie `success`.

**`async _index()`** : `title_list/search` mis en cache 30 min (avec verrou anti-appels
concurrents `_indexLoad`). Renvoie `{ groups, tags }`.

**`async getGenres()`** : tags de l'index, sinon `GENRE_TAGS`.

**`search(query, options)`** : construit les items depuis l'index (variante FR sinon EN),
filtre (titre/auteur/theTitle), filtre par genre via alias, trie par titre si demandé,
pagine.

**`getMangaInfo(mangaId)`** : `title_detailV3` → fiche + tags + chapitres + vues.

**`_chapters(detail)`** : rassemble les listes `firstChapterList`, `lastChapterList`,
`chapterListV2`, et les groupes `chapterListGroup` (first/mid/last), dédoublonne par
`chapterId`, calcule l'ordre, trie.

**`getChapterPages(mangaId, chapterId)`** : `manga_viewer_v3` → `mangaViewer` ; pour
chaque page, **proxifie** `imageUrl` en transmettant le jeton `vwToken` et la clé de
déchiffrement `encryptionKey` (que le proxy utilisera pour XOR + en-tête).

### `extension/sources/animesama.js`

Source **Anime-Sama** (scraping `anime-sama.to` — animes VF/VOSTFR).

- `LANG_ORDER` (préférence VF avant VOSTFR) / `LANG_LABEL`, `rank(lang)`.
- Helpers HTML : `decodeEntities`, `cleanText`, `seasonStart` (déduit le 1er épisode d'un
  nom « Épisode X à Y »).
- `mapLimit` : `mapPool` local (concurrence bornée).
- `request(url, { method, body, allow404 })` : `fetch` avec UA/Referer, timeout,
  gestion 404 optionnelle.
- `parsePlayerArrays(js)` : parse les `var epsN = [...]` d'un `episodes.js` et trie par
  numéro (pour que `eps1` soit en premier).
- `HOST_RANK`/`hostInfo` : note la **fiabilité** des lecteurs tiers (Uqload et Smoothpre
  en tête, Sendvid en bas…).
- `preferredPlayers(arrays, i)` : tous les lecteurs de l'épisode `i`, dédoublonnés et
  triés par fiabilité. `playerFor` renvoie le meilleur.
- `isPlayable(url)`/`rankPlayers(players)` : teste en direct (GET rapide, cache 10 min) et
  place les liens manifestement morts en dernier.

**`search(query, options)`** : `_searchSite` (POST `fetch.php`) ou `_browse` (page
catalogue), filtre par genre si fourni, trie par titre si demandé, pagine.

**`getMangaInfo(mangaId)`** : charge `/catalogue/{slug}/` ; parse titre, titre alternatif,
description, couverture, genres ; `_seasons` (panneaux `panneauAnime(...)`) ; détecte les
langues réellement dispo (`_availableLangs` sonde `episodes.js`) ; construit les
chapitres (`_buildChapters`).

**`getChapterPages(mangaId, chapterId)`** : `chapterId` = `dir~lang~index` ; recharge
`episodes.js`, ordonne les lecteurs (vivants d'abord), renvoie `players` +
`externalUrl` (premier lecteur) pour l'iframe intégrée.

### `extension/sources/anilist.js`

Source **AniList + OpenOtaku** (catalogue d'animes ; lecture via lecteurs tiers).

- `API` (GraphQL), `OO_BASE` (OpenOtaku), timeouts/intervalle/throttle dédiés, caches TTL.
- `GENRES`, `SORTS` (mapping tri app → MediaSort), `STATUS_TO_APP`/`APP_TO_STATUS`,
  `MEDIA_FIELDS` (sélection GraphQL commune).
- `throttle`/`gql` : client GraphQL throttlé + retry (429/5xx/erreurs GraphQL).
- `ooThrottle`/`ooRequest`/`ooSearch`/`ooEpisodes` : client OpenOtaku (throttle + retry ;
  `ooSearch` réessaie si la réponse indique « trop de requêtes »).
- Helpers : `titleOf`, `studioOf`, `clean` (retire le HTML), et l'ensemble
  `normalize`/`tokens`/`overlap`/`seasonOf`/`yearOf`/`matchScore` pour **apparier** un
  titre AniList à un titre OpenOtaku (recouvrement de tokens, bonus/malus saison/année).
- `OO_HOST_RANK`/`ooPlayers(map)` : classe les lecteurs OpenOtaku et renvoie une liste
  `{ label, url }` triée.

**`search(query, options)`** : construit dynamiquement la requête GraphQL (variables et
arguments selon q/genre/status/sort), appelle `Page(media(...))`, mappe via `_brief`.

**`getMangaInfo(mangaId)`** : `Media(id)` + `streamingEpisodes` + `externalLinks` ;
tente `_resolveOpenOtaku` (recherche par titre, score, cache) puis `_getEpisodesCached`
pour produire des chapitres lisibles ; en cas d'absence, repli sur `_episodes` (liens
officiels AniList).

**`getChapterPages(mangaId, chapterId)`** : `chapterId` = `oo~newsId~lang~num` ; récupère
les lecteurs (`ooPlayers`) et renvoie `players` + `externalUrl`.

**Interne** : `_brief`, `_resolveOpenOtaku`, `_searchOpenOtaku`/`_getEpisodesCached`
(caches), `_ooChapters` (construit les chapitres depuis VF sinon VOSTFR),
`_episodes`/`_episodeNumber`/`_bestFrenchLink` (repli).

### `extension/sources/japscan.js`

Source **JapScan** (scraping FR, désactivée par défaut car protégée Cloudflare).

- `BASE_DOMAINS` : liste de miroirs essayés successivement.
- `USER_AGENT` (env `JAPSCAN_USER_AGENT`), `GENRES`, helpers HTML, `prettifySlug`.
- `_fetchHtml(urlPath)` : essaie chaque miroir ; gère 404, **403/503** (Cloudflare) et la
  détection de challenge (`"Just a moment..."`, `challenges.cloudflare.com`) ; accepte un
  cookie via `JAPSCAN_COOKIE`/`CF_CLEARANCE` ; mémorise le miroir qui a fonctionné.

**`search`** : parse la page d'accueil (`_parseCatalog`) et filtre localement
(titre/id/genre), trie par titre, pagine.

**`getMangaInfo`** : tente `/manga/{slug}/` ; si Cloudflare bloque, renvoie une **fiche de
secours** propre avec `externalUrl` (lien direct vers JapScan) pour ne pas casser l'UI ;
sinon parse titre/description/couverture/auteur/statut/chapitres (`_parseChapterList`).

**`getChapterPages`** : essaie `/lecture-en-ligne/…` puis `/manga/…` ; extrait les images
(`_extractChapterImages`, `<img>` + variable JS `images`) ; en cas d'échec total, renvoie
un objet lisible avec `externalUrl` (pas de crash).

---

## 5. Frontend

### `public/index.html`

**Coquille** de la SPA (structure fixe ; le contenu de `#view-root` est remplacé par les
vues JS).

- `data-theme="dark"` sur `<html>` (thème par défaut).
- `<meta name="referrer" content="no-referrer">` : **indispensable** — MangaDex renvoie
  une image « placeholder » si un Referer tiers est présent ; sans Referer, les vraies
  pages sont servies.
- Polices Google (Fraunces display, Plus Jakarta Sans UI, JetBrains Mono meta), favicon
  SVG inline, feuille `css/style.css?v=7`.
- **Sidebar** (`.sidebar#sidebar`) : logo, navigation (`data-route`, `data-nav`), bouton
  de thème, version.
- **Topbar** : bouton menu (mobile), titre (`#topbar-title`), bouton thème.
- **`<main id="view-root">`** : où chaque vue s'injecte.
- **Tabbar mobile** : navigation réduite.
- `#toast-host` et `#modal-host` : hôtes pour `toast()` et `modal()`.
- `<script type="module" src="/js/main.js?v=7">` : point d'entrée ES modules.

### `public/css/style.css`

Design system « Obsidian & Champagne » (~3200 lignes). Rôle : variables, layout, vues,
lecteur, animations. Sections principales (repérées par leurs commentaires d'en-tête) :

1. **Design tokens** (`:root` et `html[data-theme="light"]`) : couleurs (`--bg`, `--text`,
   `--accent` or champagne, `--violet`, `--rose`…), dégradés, typographies (`--font-*`),
   rayons, ombres, largeur sidebar, timing function.
2. **Reset & base** : `box-sizing`, `color-scheme`, style `body` (halos radiaux +
   grain SVG en `::before`), sélection, scrollbars, focus visible.
3. **Layout** : `.app`, `.sidebar`, `.main`, `.content`, `.topbar`, `.tabbar` (grille
   principale, responsive).
4. **Page headers** (`.page-head`).
5. **Boutons & champs** (`.btn` et variantes `btn-primary`, `btn-ghost`, `btn-danger`,
   `.field`, `.select`, `.seg`, `.switch`).
6. **Recherche / filtres** (`.search-panel`, `.filter-row`, `.chips`, `.chip`).
7. **Grille de cartes** (`.grid`, `.novel-card`, `.mini-progress`).
8. **États vides / erreurs** (`.empty`) et **retour** (`.back-link`).
9. **Fiche manga (hero)** (`.novel-hero`, `.badges`, `.tags`, `.read-progress-box`).
10. **Chapitres** (`.chapter-panel`, `.chapter-row`, `.chapter-num`, `.external-chip`).
11. **Lecteur** (`.reader-screen`, `.reader-top`, `.reader-stage`, paginé/strip, TOC,
    réglages, chapitre externe) — inclut le tryptique pages/bande.
12. **Bibliothèque & historique** (`.lib-grid`, `.history-list`, `.continue-card`).
13. **Extensions** (`.ext-grid`, `.ext-card`, `.switch`).
14. **Réglages** (`.settings-stats`, `.settings-columns`, `.panel`).
15. **Toasts**, **Modales**.
16. **Responsive** (`@media (max-width: 960px)` et suivants) : bascule sidebar → menu
    coulissant + tabbar.
17. Sections additionnelles « placeholders de couverture », « livres 3D », « accueil
    premium animé » (halos, parallaxe `--mx/--my`, rails horizontaux, inclinaison 3D des
    cartes, révélation au défilement), « teinte par extension », « page 404 ».

### `public/js/main.js`

**Point d'entrée frontend**.

- Importe le routeur, l'état, et toutes les fonctions `render*` des vues.
- `registerRoutes([...])` : table des routes hash → vue :

  | Pattern | Vue | `nav` | Notes |
  | --- | --- | --- | --- |
  | `/^\/$/` | `renderHome` | home | accueil |
  | `/^\/catalogue$/` | `renderCatalog` | catalogue | catalogue |
  | `/^\/library$/` | `renderLibrary` | library | CBZ |
  | `/^\/favorites$/` | `renderFavorites` | favorites | |
  | `/^\/history$/` | `renderHistory` | history | |
  | `/^\/extensions$/` | `renderExtensions` | extensions | |
  | `/^\/settings$/` | `renderSettings` | settings | |
  | `/^\/manga\/([^/]+)\/([^/]+)$/` | `renderManga` | — | params = sourceId, mangaId |
  | `/^\/read\/([^/]+)\/([^/]+)\/([^/]+)$/` | `renderReader` | — | `reader: true` |
  | `/^.*$/` (fallback) | `renderNotFound` | — | 404 |

- `applyTheme()` : bascule `data-theme` sombre/clair, affiche la bonne icône
  lune/soleil, adapte le libellé du bouton.
- Branche les boutons `[data-toggle-theme]` (bascule + sauvegarde `prefs.theme`).
- Écoute l'événement custom `nh:theme` (émis par les Réglages) pour rafraîchir.
- Navigation mobile : `setNav(open)`/`closeNav()` pilotent la classe `nav-open`, la
  sidebar et le voile (`#nav-scrim`).
- **Démarrage** : `loadServerState()` (récupère favoris/historique/progression serveur)
  puis, en `finally`, `applyTheme()` + `startRouting()`.

### `public/js/router.js`

Routeur **hash** (`#/chemin?query`).

- `parseHash()` : renvoie `{ path, queryParams }` (URLSearchParams).
- `currentPath()` : juste le chemin.
- `navigate(path)` : normalise en `/…` ; si on est déjà sur la route, remonte en haut et
  re-render ; sinon change `location.hash` (ce qui déclenche `hashchange`).
- `setRouteListener(fn)` : callback appelé à chaque changement de route.
- `registerRoutes(list)` / `startRouting()` : enregistre la table, écoute `hashchange` et
  rend la route courante.
- `runRoute(forceRender)` :
  - trouve la route par `pattern.test(path)` (sinon la route `fallback`) ;
  - extrait les `params` par `path.match(pattern)` ;
  - **nettoie** la vue précédente (`cleanupFn`) ;
  - ajuste l'état document (`reader-open`, `overflow: hidden` pour le lecteur) ;
  - met à jour la nav active et le titre de la barre ;
  - appelle `onRouteChange(route, params)`, mémorise `window.__lastPath` ;
  - appelle `route.view({ params, path, viewRoot })` et **capture le `cleanup`** renvoyé
    pour le prochain changement.
- `setNavActive(navKey)` : active l'élément `[data-nav]` correspondant.
- `requestRender()` : force un re-render.

### `public/js/api.js`

Couche réseau (mince surcouche de `fetch`).

- `class ApiError extends Error` : porte `status`.
- `request(url, options)` : `fetch`, lit la réponse en texte puis parse en JSON (tolérant),
  lève `ApiError(data.error || "Erreur <status>")` si non-`ok`, sinon renvoie les données.
- `qs(params)` : sérialise une query string en ignorant les valeurs vides/`null`.
- `api` : objet de méthodes typées :
  - `health`, `search(params)`, `genres`, `stats` ;
  - `extensions()`, `toggleExtension(id, enabled)` (PATCH) ;
  - `manga(sourceId, mangaId)`, `chapter(sourceId, mangaId, chapterId)` ;
  - `downloadCbz(sourceId, mangaId, from, to)` (POST), `job(jobId)` ;
  - `library()`, `deleteLibraryEntry(id)` ;
  - `getState()`, `putState(patch)`, `resetState()`.

### `public/js/state.js`

Deux états : **préférences locales** (localStorage) et **état serveur** (favoris,
historique, progression).

- `defaults` : thème + réglages lecteur (`mode`, `quality`, `contrast`).
- `prefs` : chargé par `loadPrefs()` (clé `optimanga:prefs`, avec lecture de secours des
  anciennes clés `mangahub:prefs` / `novelhub:prefs`).
- `savePrefs()`, `getPrefs()`.
- `serverState` : `{ favorites, history, progress, _loaded }`.
- `loadServerState()` : appelle `api.getState()`, normalise (compat. anciens champs
  `novelId`/`novelTitle` → `mangaId`/`mangaTitle`) et marque `_loaded`.
- `scheduleSync()` : **debounce 350 ms** puis `PUT /api/state` (évite une requête par clic).
- `resetServerState()` : `DELETE` puis vide l'état local.
- **Favoris** : `isFavorite(sourceId, mangaId)`, `toggleFavorite(manga)` (ajoute au début
  avec métadonnées, ou retire ; programme la synchro).
- **Historique** : `pushHistory(entry)` (retire l'ancienne entrée du même manga, ajoute en
  tête, **plafond 50**), `clearHistory()`.
- **Progression** : `getProgress`, `isChapterRead`, `markChapterRead` (ajoute le `id` à
  `read`), `saveReadingPosition(...)` (enregistre `{ page, ratio, chapterId, order }`),
  `readRatio(sourceId, mangaId, totalChapters)` (fraction de chapitres lus).

### `public/js/ui.js`

Primitives d'UI et helpers d'échappement/format.

- `escapeHtml(value)` : échappe `& < > " '` — **toute** donnée injectée en HTML doit
  passer par là.
- `coverPalette(seed)` : choisit un couple de couleurs déterministe à partir d'une chaîne.
- `coverAccent(manga)` : chaîne CSS `--ph1/--ph2` pour teinter le « livre ».
- `coverPlaceholder(manga, alt)` : vignette gradient avec initiales + icône.
- `coverImage(manga, alt)` : `<img>` (lazy) ou placeholder.
- `heroImage(manga, alt)` : `<img>` (eager) pour les grandes couvertures.
- `ratingBadge(rating)`, `statusInfo(status)` (libellé/classe FR), `formatCount(n)`
  (« 1,2 k »), `timeAgo(iso)` (« il y a 3 h »), `formatSizeBytes(bytes)` (Ko/Mo).
- `toast(msg, type)` : notification éphémère (icône selon le type), auto-supprimée.
- `modal({ title, text, body, actions })` : modale accessible (Échap, clic sur
  l'overlay), actions typées (`primary`/`danger`), résout l'action (`onClick` peut
  renvoyer `false` pour garder la modale ouverte/async).
- `skeletonCards(count)` / `emptyState({ iconName, title, text, action })` : états de
  chargement et vides réutilisables.

### `public/js/icons.js`

- `ICONS` : dictionnaire de tracés SVG inline (heart, search, book, library, history,
  star, download, trash, play, flèches, chevrons, close, settings, list, check, clock,
  fileText, sparkle, bookOpen, type, sun, moon, puzzle, info, external, shuffle…).
- `icon(name, size = 18)` : renvoie la balise `<svg>` complète (défaut `book` si inconnu).
  Aucune police d'icône externe (SVG inline).

### `public/js/views/*.js`

Chaque vue exporte une fonction `render…({ params, path, viewRoot })` qui remplit
`viewRoot` et **retourne optionnellement `{ cleanup }`** (pour retirer les écouteurs).

#### `views/cards.js`

Composants partagés catalogue/favoris.
- `mangaCard(manga, { showSource })` : carte complète (couverture, badge statut, bouton
  favori `[data-fav]`, titre, auteur, genre, note, nombre de chapitres, mini-barre de
  progression). Les `data-sid`/`data-nid` servent au routage/clic.
- `skeletonGrid(count)` : squelettes de chargement en grille.

#### `views/notfound.js`

`renderNotFound` : page 404 avec liens vers l'accueil et le catalogue.

#### `views/home.js`

Accueil « premium » animé.

- Constantes : `RANK_BADGE`, `REDUCE_MOTION` (respect de `prefers-reduced-motion`).
- `renderHome({ viewRoot })` : injection du hero (orbs, titre, CTA, stats squelettiques),
  slots `#home-continue` et `#home-rails` ; lance `renderContinue`, la révélation au
  défilement, la parallaxe du hero, puis `loadRails` ; retourne `{ cleanup }` qui purge
  tous les écouteurs.
- `loadRails(viewRoot, reveal, cleanups)` : charge en parallèle extensions, stats,
  populaires, récents ; vérifie que la vue est **toujours montée** (`isConnected`) ;
  construit les rails (Tendances, Nouveautés, et un rail Anime si une source `anime` est
  active) ; branche les cartes et les rails.
- `renderStats(...)` / `animateCount(...)` : affiche et anime les compteurs (sauf si
  mouvement réduit).
- `renderContinue(viewRoot)` : carte « Reprendre » depuis le dernier historique.
- `railHtml(rail)` / `skeletonRail()` : gabarits d'un rail horizontal et de son squelette.
- `wireRails(host)` : clic sur une carte → fiche manga.
- `initHeroMotion(viewRoot)` : parallaxe douce du hero (variables CSS `--mx/--my`,
  `requestAnimationFrame`).
- `createReveal(viewRoot)` : `IntersectionObserver` ajoutant `.is-in` aux `.reveal`
  (désactivé si mouvement réduit), renvoie `{ scan, destroy }`.
- `initRail(shell)` : flèches précédent/suivant, état désactivé aux extrémités, glisser
  souris (avec suppression du clic après glisser), inclinaison 3D au survol ; renvoie une
  fonction de nettoyage.

#### `views/catalog.js`

Catalogue : recherche, filtres, grille, défilement infini, carrousel « À la une ».

- `PAGE_SIZE = 24`, `SENTINEL_MARGIN = 600`.
- État module `filters` (`q, source, genre, status, sort`) conservé entre visites.
- `renderCatalog({ params, viewRoot })` :
  - lit `source/sort/genre/q` depuis l'URL (ex. arrivée depuis l'accueil) ;
  - construit le panneau recherche + filtres (chips de genres, statut, tri) ;
  - `IntersectionObserver` sur la sentinelle pour le **défilement infini** ;
  - `renderGenres`, `runSearch(reset)` (avec **numéro de séquence `seq`** pour ignorer les
    réponses d'une recherche remplacée), `applyPage`, `renderGrid`, `init` (charge
    extensions + genres puis lance la recherche) ;
  - `renderShelf()` : carrousel d'onglets (historique « À la une », mangas du moment,
    nouveautés), auto-défilement, bouton **manga au hasard**, navigation.
  - retourne `{ cleanup }` (déconnecte l'observer, annule le debounce de recherche).
- `wireCards(grid, mangas)` : branche clic (→ fiche) et bouton favori sur chaque carte.
- `renderContinue(host)` : bloc « Reprendre la lecture » en haut du catalogue.

#### `views/manga.js`

Fiche manga : infos, actions, chapitres, export CBZ.

- `renderManga` : charge `api.manga`, gère l'erreur (état vide), calcule
  hébergés/externes, unité selon `mediaType` (`chapitre` ou `épisode`), rend le hero
  (badges, tags, description, boutons **Lire / Favori / CBZ**), la progression, la liste
  de chapitres filtrable.
  - Le **bouton principal** cible le dernier chapitre lu s'il existe, sinon le premier
    chapitre jouable (hébergé **ou** incrusté).
  - Chaque ligne de chapitre navigue vers le lecteur (`/read/…`) — même les externes, qui
    seront incrustés.
- `badge(label, cls, prepend)` : petit helper d'affichage.
- `openCbzModal(manga)` : modale d'export.
  - Champs `from`/`to` (bornés aux ordres min/max).
  - `startExport` : appelle `api.downloadCbz` puis **poll** `api.job(jobId)` toutes les
    420 ms, met à jour la barre/progression, et à la fin affiche le lien de
    téléchargement (`result.url`) ou l'erreur. Renvoie une promesse jamais résolue (la
    modale ne se ferme pas automatiquement).

#### `views/reader.js`

Lecteur d'images (le plus complexe côté front).

- `renderReader({ params, viewRoot })` : `params = [sourceId, mangaId, chapterId]`.
  - Construit la coquille : barre supérieure (retour, titre/sous-titre, précédent/suivant,
    TOC, réglages), `#rd-stage`, tiroir TOC, popover de réglages.
  - Charge **en parallèle** la fiche et le chapitre.
  - Détecte un contenu **externe** (`externalUrl` ou pas de pages).
  - Marque le chapitre lu + pousse l'historique (uniquement si hébergé).
  - Branche la navigation (`wireTopNav`).
  - Si externe → `renderExternalEmbed()` et retour ; sinon `buildSettings()`,
    `renderToc()`, `installStage(...)`.
  - Retourne `{ cleanup }` (retire les écouteurs clavier/scroll, vide le timer).
- Helpers : `neighbors(list, cid)` (chapitres précédent/suivant), `goChapter`, `openToc`/
  `closeToc`, `wireTopNav`, `showUnavailable`.
- `renderExternalEmbed()` : lecteur intégré en **iframe sandboxée**
  (`allow-scripts allow-same-origin`, `referrerpolicy: no-referrer`), sélecteur de
  lecteurs (`players`), bouton « ouvrir dans un onglet », écran de chargement.
- `renderToc(filter)` : liste des chapitres (actif/lu/externe), navigation.
- `buildSettings()` : réglages lecteur (mode Pages/Bande, qualité Haute/Éco, fond
  Sombre/Sépia/Clair) ; re-render le stage si mode/qualité change.
- `installStage` : choisit les URLs selon la qualité, calcule la position sauvegardée,
  délègue à `installPaged` ou `installStrip`.
- `installPaged(urls, savedRatio)` : une page à la fois, zones de clic gauche/droite,
  clavier (←/→, Échap, `T`), **préchargement** de la page suivante, sauvegarde de position
  debouncée.
- `installStrip(urls, savedRatio)` : bande continue (toutes les images empilées),
  sauvegarde de la progression au scroll, masquage auto de la barre supérieure en
  descendant.

#### `views/library.js`

Bibliothèque CBZ.
- `renderLibrary` : liste `api.library()` ; vide → état vide + CTA ; sinon grille de
  cartes (télécharger si `url`, supprimer avec confirmation `modal`, métadonnées
  chapitres/taille/date).

#### `views/favorites.js`

`renderFavorites` : liste `serverState.favorites` sous forme de `mangaCard` ; clic →
fiche ; retrait du favori → re-render immédiat ; état vide sinon.

#### `views/history.js`

`renderHistory` : liste `serverState.history` (couverture, titre, chapitre, source,
`timeAgo`) ; clic → reprise dans le lecteur ; bouton « Effacer » avec confirmation.

#### `views/extensions.js`

`renderExtensions` : liste les sources installées (`api.extensions()`) en cartes (teinte
déterministe `extHue`, type Manga/Anime, langue, genres, auteur, version) ; **interrupteur
d'activation** appelant `api.toggleExtension`. Rappel que le dossier
`extension/sources/` est scanné automatiquement.

#### `views/settings.js`

`renderSettings` : statistiques (via `api.stats()`), panneaux Apparence (thème),
Lecteur, Données locales (réinitialisation avec confirmation), À propos (version, sources
actives dynamiques). Le changement de thème met à jour `prefs.theme` et émet
`nh:theme`.

---

## 6. Flux complets (de bout en bout)

### A. Rechercher dans le catalogue

1. `views/catalog.js` → `api.search({ q, source, genre, status, sort, limit, offset })`.
2. `GET /api/search` (`routes.js`) :
   - une source → `searchSource` (cache 60 s) → la source fait son `search()` ;
   - plusieurs sources (ou `all`) → fusion + tri local.
3. La source renvoie des items normalisés ; la réponse est `{ count, total, paginated,
   results }`.
4. La vue rend les cartes (`mangaCard`), observe la sentinelle pour charger la page
   suivante (défilement infini).

### B. Lire un chapitre (hébergé)

1. Clic sur une ligne → navigation `#/read/<sourceId>/<mangaId>/<chapterId>`.
2. `views/reader.js` charge fiche + chapitre (`api.manga`, `api.chapter`).
3. `GET /api/.../chapters/:chapterId` → `chapterPages` (cache 900 s) → `getChapterPages`
   de la source.
4. La source renvoie des URLs de pages. Selon le CDN, elles sont **proxifiées**
   (`/api/image?url=…&vwt=…&k=…`).
5. Le lecteur affiche les images (mode paginé ou bande) ; chaque image proxifiée passe
   par `GET /api/image`, qui **fetch côté serveur** avec les bons en-têtes et
   **déchiffre** si nécessaire, avec cache disque/mémoire.
6. La progression (`markChapterRead`, `saveReadingPosition`) est synchronisée par
   `scheduleSync` (debounce) vers `PUT /api/state`.

### C. Exporter un CBZ

1. Fiche manga → `openCbzModal` → `POST /api/.../download` `{ from, to }`.
2. Le serveur crée un **job** et répond `202 { jobId }`, puis télécharge en tâche de fond
   (dossier `.tmp-<jobId>`, concurrence 3), zippe (`buildCbz`), écrit le fichier, l'ajoute
   à la bibliothèque (`db.library`, `db.stats`).
3. Le front **poll** `GET /api/jobs/:id` et affiche la progression puis le lien
   `/files/<filename>` pour télécharger.

### D. Images protégées (proxy)

1. Une source renvoie `images.proxied(url, { vwt, k })` quand l'hôte est dans
   `HOST_RULES` (ou qu'un jeton/clé est requis).
2. `GET /api/image` : `resolve` → `isProxiable` (**anti-SSRF**) → cache → `fetch` avec
   `headersFor` (Referer/jeton) → `decodePage` (XOR) → réponse + cache.
3. Côté CBZ, `cbz.js` fait la même chose en direct sans repasser par le proxy.

---

## 7. Ajouter une extension

1. Créer `extension/sources/ma-source.js` :

   ```js
   const BaseSource = require("../BaseSource");
   const { httpError } = require("../utils");

   class MaSource extends BaseSource {
     constructor() {
       super({ id: "masource", name: "Ma Source", lang: "fr", mediaType: "manga" });
       this.genres = ["Action", "Fantasy"];
     }
     async search(query, options) { /* -> { results, total } */ }
     async getMangaInfo(mangaId)    { /* -> { ...info, chapters } */ }
     async getChapterPages(mangaId, chapterId) { /* -> { pages, pagesLow } */ }
   }
   module.exports = MaSource;
   ```

2. Redémarrer le serveur : `registry.js` scanne `extension/sources/*.js`, instancie la
   classe et l'expose dans `/api/extensions` et le catalogue.
3. L'activer à la main (écran Extensions) si `defaultEnabled: false`.
4. Si le CDN exige un `Referer`/un jeton, ajouter une entrée dans `HOST_RULES`
   (`images.js`) et renvoyer les URLs via `images.proxied(url)`.

---

### Notes finales

- **Sécurité** : `escapeHtml` côté front pour tout contenu dynamique ; `path.basename`
  pour les téléchargements ; `isProxiable` comme garde anti-SSRF du proxy d'images ;
  limiteur de débit global.
- **Cache** : `src/cache.js` (mémoire, par clé) + cache d'images (`routes.js`) +
  caches internes des sources. Le cache API est vidé lors d'un `PATCH /extensions` ou
  d'un `DELETE /state`.
- **Arrêt** : `db.flush()` (écriture JSON) est garanti sur `SIGINT`/`SIGTERM`.
