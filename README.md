# NovelHub

Lecteur de web novels façon Tachiyomi, mais pour le texte : catalogue multi-sources
par extensions, lecture en ligne optimisée au clavier, suivi de progression
synchronisé et export EPUB hors-ligne.

Interface pensée pour la lecture longue : thèmes (sombre, clair, sépia), réglages
typographiques (police, taille, interligne, largeur de ligne), table des matières,
navigation au clavier, et export de chapitres en EPUB consultables partout.

## Démarrer

```
npm install
npm start
```

Puis ouvrir http://localhost:3000

## Fonctionnalités

- **Catalogue** — recherche plein texte, filtres par genre/statut, tris (popularité, note, récent, chapitres, titre), chargement progressif.
- **Fiche novel** — description, badges, progressions de lecture par chapitre, filtrage des chapitres, reprise exacte là où tu t'es arrêté.
- **Lecteur** — écran immersif, restauration du défilement, barre de progression, TOC (touche `T`), réglages typographiques, navigation `←`/`→`/`Échap`.
- **Favoris & historique** — synchronisés côté serveur.
- **Extensions** — sources de contenu activables ; deux sources de démonstration incluses (tout le contenu est généré localement, aucune ressource externe).
- **Export EPUB** — génération asynchrone avec progression, ajout à la bibliothèque, téléchargement ou suppression.

## API (résumé)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/health` | Santé du serveur |
| GET | `/api/stats` | Statistiques globales |
| GET | `/api/extensions` | Sources installées / disponibles |
| PATCH | `/api/extensions/:id` | Activer / désactiver une source |
| GET | `/api/genres` | Genres disponibles |
| GET | `/api/search?q=&source=&genre=&status=&sort=` | Recherche catalogue |
| GET | `/api/sources/:sid/novels/:nid` | Informations novel |
| GET | `/api/sources/:sid/novels/:nid/chapters/:cid` | Contenu d'un chapitre |
| POST | `/api/sources/:sid/novels/:nid/export` | Lance l'export EPUB (job) |
| GET | `/api/jobs/:id` | Progression du job |
| GET | `/api/library` · DELETE `/api/library/:id` | Bibliothèque EPUB |
| GET/PUT/DELETE | `/api/state` | Favoris, historique, progression |
| GET | `/files/:filename` | Téléchargement du fichier EPUB |

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
  covers.js               génération de couvertures SVG procédurales
  epub.js                 génération EPUB (epub-gen-memory)
  content/prose.js        banque de prose pour le contenu de démonstration
  sources/bibliotheque.js source de démo (12 romans)
  sources/atlas.js        source de démo (6 romans)
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
    views/                catalog, novel, reader, library, favorites, history, extensions, settings
downloads/                EPUB générés (ignoré par git)
data/db.json              état persistant (ignoré par git)
```

## Ajouter une nouvelle extension

Créer un fichier dans `extension/sources/`, exporter une classe qui étend
`BaseSource` et implémente `search()`, `getNovelInfo()` et `getChapterContent()`.
Elle est chargée et listée automatiquement au démarrage du serveur, puis activable
depuis l'écran Extensions.

```
class MaSource extends BaseSource {
  static id = "masource";
  static name = "Ma Source";
  async search(query, options) { /* -> [{ id, title, author, cover, ... }] */ }
  async getNovelInfo(novelId) { /* -> { title, author, description, chapters: [{ id, order, title }], ... } */ }
  async getChapterContent(novelId, chapterId) { /* -> { title, order, wordCount, content: "<p>…</p>" } */ }
}
```

> ℹ️ Pour toute extension branchée sur un vrai site, respecte ses CGU et le droit
> d'auteur du contenu (throttling, robots.txt, contenu libre de droits ou autorisé).

## Notes

- `type: commonjs` côté serveur ; le frontend est en modules ES standards, servi
  tel quel (aucun build).
- Objectif : auto-hébergement, données locales, aucune dépendance tierce pour les
  fonts et les couvertures (générées en SVG inline).