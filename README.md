# MangaHub

Lecteur de mangas façon Tachiyomi : catalogue multi-sources par extensions,
lecture en ligne en images (mode paginé ou bande continue), suivi de progression
synchronisé et export CBZ hors-ligne compatible avec Micha, Tachiyomi, Kawazu…

Interface pensée pour la lecture sur écran : thèmes (sombre, clair, sépia),
choix de la qualité des pages (Haute / Éco via le CDN data-saver), table des
matières, navigation au clavier et à la souris, et export de chapitres en CBZ.

## Démarrer

```
npm install
npm start
```

Puis ouvrir http://localhost:3000

## Fonctionnalités

- **Catalogue** — tous les mangas de la source active sont listés (pagination « Charger plus »), recherche plein texte, filtres par genre/statut, tris (popularité, note, récent, chapitres, titre).
- **Fiche manga** — description, badges, popularité, progressions de lecture par chapitre, chapitres externes signalés (lien vers l'éditeur), reprise exacte là où tu t'es arrêté.
- **Lecteur** — écran immersif, deux modes (pages / bande continue), restauration de la position, barre de progression, TOC (touche `T`), qualité des images, fond, navigation `←`/`→`/`Échap`.
- **Favoris & historique** — synchronisés côté serveur.
- **Extensions** — sources de contenu activables ; la source **MangaDex** (API officielle) est fournie avec genres, statuts, langues FR/EN et couvertures.
- **Export CBZ** — génération asynchrone avec progression, ajout à la bibliothèque, téléchargement ou suppression.

> ℹ️ MangaDex ne propose que du contenu légalement hébergé ; certaines séries
> (shōnen majeurs : One Piece, Naruto…) n'y ont que peu de chapitres hébergés en
> français, l'essentiel renvoyant vers le site de l'éditeur. Ces chapitres sont
> marqués « Éditeur » dans l'application et ignorés lors de l'export CBZ.

## API (résumé)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/health` | Santé du serveur |
| GET | `/api/stats` | Statistiques globales |
| GET | `/api/extensions` | Sources installées / disponibles |
| PATCH | `/api/extensions/:id` | Activer / désactiver une source |
| GET | `/api/genres` | Genres disponibles |
| GET | `/api/search?q=&source=&genre=&status=&sort=&limit=&offset=` | Recherche catalogue (paginée) |
| GET | `/api/sources/:sid/mangas/:mid` | Fiche manga + chapitres |
| GET | `/api/sources/:sid/mangas/:mid/chapters/:cid` | Pages d'un chapitre |
| POST | `/api/sources/:sid/mangas/:mid/download` | Lance l'export CBZ (job, plage `from`→`to`) |
| GET | `/api/jobs/:id` | Progression du job |
| GET | `/api/library` · DELETE `/api/library/:id` | Bibliothèque CBZ |
| GET/PUT/DELETE | `/api/state` | Favoris, historique, progression |
| GET | `/files/:filename` | Téléchargement du fichier CBZ |

## Structure

```
server.js                 point d'entrée Express
src/
  app.js                  assemblage de l'application + téléchargement /files
  routes.js               routes API (recherche, lecture, export, état)
  cache.js                cache mémoire TTL
  jobs.js                 jobs d'export en arrière-plan
  rateLimit.js            limiteur de débit des extensions
extension/
  BaseSource.js           contrat d'une source de contenu
  registry.js             chargement automatique de extension/sources/*.js
  mangadex-client.js      client API MangaDex (throttle, retry, helpers)
  cbz.js                  téléchargement des pages + empaquetage CBZ (adm-zip)
  sources/mangadex.js     source MangaDex (recherche, fiche, pages, genres)
data/
  db.js                   persistance JSON atomique (favoris, historique, progression, bibliothèque)
public/
  index.html              coquille de l'application (SPA)
  css/style.css           design system « Ink & Ember » + vues + lecteur + responsive
  js/
    main.js               point d'entrée frontend (routes, thème, navigation)
    router.js             routeur hash
    api.js                couche réseau
    state.js              préférences locales + état serveur (sync debounced)
    ui.js, icons.js       primitives, modales, toasts, icônes SVG
    views/                catalog, manga, reader, library, favorites, history, extensions, settings
downloads/                CBZ générés (ignoré par git)
data/db.json              état persistant (ignoré par git)
```

## Ajouter une nouvelle extension

Créer un fichier dans `extension/sources/`, exporter une classe qui étend
`BaseSource` et implémente `search()`, `getMangaInfo()` et `getChapterPages()`.
Elle est chargée et listée automatiquement au démarrage du serveur, puis activable
depuis l'écran Extensions.

```
class MaSource extends BaseSource {
  static id = "masource";
  static name = "Ma Source";
  async search(query, options) { /* -> { results, total } */ }
  async getMangaInfo(mangaId) { /* -> { title, author, cover, description, chapters: [{ id, order, title, externalUrl, pages }], ... } */ }
  async getChapterPages(mangaId, chapterId) { /* -> { pages: [urls], pagesLow: [urls], ... } */ }
}
```

> ℹ️ Pour toute extension branchée sur un vrai site, respecte ses CGU et le droit
> d'auteur du contenu (throttling, robots.txt, contenu libre de droits ou autorisé).

## Notes

- `type: commonjs` côté serveur ; le frontend est en modules ES standards, servi
  tel quel (aucun build).
- MangaDex impose un rythme modéré : le client est throttlé (~4 requêtes/s) et
  relance les appels sur 429/erreurs transitoires.
- Objectif : auto-hébergement, données locales, aucune dépendance tierce pour les
  fonts (SVG inline) et les couvertures (seuil : placeholder si absente).