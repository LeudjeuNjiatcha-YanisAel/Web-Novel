# WebNovel Reader

Application façon Tachiyomi, mais pour les web novels : catalogue par extensions,
lecture en ligne, et export au format EPUB pour lecture hors-ligne.

## Démarrer

```
npm install
npm start
```

Puis ouvrir http://localhost:3000

## Structure

- `server.js` — API Express (extensions, recherche, lecture, téléchargement EPUB)
- `extension/BaseSource.js` — contrat que doit respecter toute extension
- `extension/index.js` — chargeur automatique des extensions (extension/sources/*.js)
- `extension/sources/demo-source.js` — extension de démo (données en mémoire, aucun scraping)
- `extension/epubBuilder.js` — génération EPUB (epub-gen-memory)
- `data/libraryStore.js` — persistance JSON simple des EPUB téléchargés
- `public/` — frontend vanilla HTML/CSS/JS (catalogue, fiche novel, lecteur, bibliothèque)

## Ajouter une nouvelle extension

Créer un fichier dans `extension/sources/`, exporter une classe qui étend `BaseSource`
et implémente `search()`, `getNovelInfo()` et `getChapterContent()`. Elle sera chargée
automatiquement au démarrage du serveur.

⚠️ Pour toute extension branchée sur un vrai site, pense à respecter ses CGU et les
droits d'auteur du contenu (throttling, robots.txt, contenu libre de droits ou avec
autorisation).
