"use strict";
// Force l'exécution en mode strict JavaScript pour intercepter erreurs silencieuses.

const MangaDex = require("./mangadex");
// Importe la source MangaDex multi-langues comme classe mère pour spécialiser le filtre linguistique.

/**
 * Variante francophone de MangaDex : même API officielle, chapitres FR
 * (translatedLanguage[] = fr) pour un catalogue strictement français.
 * Désactivée par défaut pour éviter les doublons avec MangaDex multi-langues.
 */

class MangadexFR extends MangaDex {
// Variante francophone héritant du sourceur MangaDex générique.
  constructor() {
// Initialise la variante francophone avec filtre « français uniquement ».
    super();
// Transmet l'initialisation à la classe MangaDex pour réutiliser filtres, tris et helpers.
    this.id = "mangadex-fr";
// Identifiant unique de la source pour l'inventaire des sources dans l'extension.
    this.name = "MangaDex (FR)";
// Libellé affiché dans l'interface utilisateur pour la source francophone.
    this.lang = "fr";
// Code langue par défaut associé à cette source (affichage/interface).
    this.languages = ["fr"];
// Filtre l'API MangaDex pour ne récupérer que les chapitres traduits en français.
    this.description =
      "MangaDex 100 % français : scanlations FR via l'API officielle, sans chapitres anglais ou autres langues. Idéal pour un catalogue exclusivement en français.";
// Description textuelle de la source affichée dans l'écran Extensions.
    this.defaultEnabled = false;
// Désactive cette variante par défaut pour éviter les doublons avec le sourceur multi-langues.
  }
// Termine le constructeur de la variante MangaDex (FR).
}
// Termine la déclaration de la classe MangadexFR.

module.exports = MangadexFR;
// Exporte la classe MangadexFR pour enregistrement par le gestionnaire de sources.