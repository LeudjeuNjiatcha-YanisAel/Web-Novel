"use strict";
// Force l'exécution en mode strict JavaScript pour intercepter erreurs silencieuses.

const MangaDex = require("./mangadex");
// Importe la source MangaDex multi-langues comme classe mère pour spécialiser le filtre linguistique.

/**
 * Variante anglophone de MangaDex : même API officielle, chapitres EN uniquement.
 * Désactivée par défaut (évite les doublons avec MangaDex multi-langues) ;
 * à activer depuis l'écran Extensions pour un catalogue strictement anglais.
 */

class MangadexEN extends MangaDex {
// Variante anglophone héritant du sourceur MangaDex générique.
  constructor() {
// Initialise la variante anglophone avec filtre « anglais uniquement ».
    super();
// Transmet l'initialisation à la classe MangaDex pour réutiliser filtres, tris et helpers.
    this.id = "mangadex-en";
// Identifiant unique de la source pour l'inventaire des sources dans l'extension.
    this.name = "MangaDex (EN)";
// Libellé affiché dans l'interface utilisateur pour la source anglophone.
    this.lang = "en";
// Code langue par défaut associé à cette source (affichage/interface).
    this.languages = ["en"];
// Filtre l'API MangaDex pour ne récupérer que les chapitres traduits en anglais.
    this.description =
      "MangaDex en anglais : mêmes scanlations via l'API officielle, sans chapitres français. Active-la si tu préfères un catalogue anglophone.";
// Description textuelle de la source affichée dans l'écran Extensions.
    this.defaultEnabled = false;
// Désactive cette variante par défaut pour éviter les doublons avec le sourceur multi-langues.
  }
// Termine le constructeur de la variante MangaDex (EN).
}
// Termine la déclaration de la classe MangadexEN.

module.exports = MangadexEN;
// Exporte la classe MangadexEN pour enregistrement par le gestionnaire de sources.