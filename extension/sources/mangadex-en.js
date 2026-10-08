"use strict";

const MangaDex = require("./mangadex");

/**
 * Variante anglophone de MangaDex : même API officielle, chapitres EN uniquement.
 * Désactivée par défaut (évite les doublons avec MangaDex multi-langues) ;
 * à activer depuis l'écran Extensions pour un catalogue strictement anglais.
 */
class MangadexEN extends MangaDex {
  constructor() {
    super();
    this.id = "mangadex-en";
    this.name = "MangaDex (EN)";
    this.lang = "en";
    this.languages = ["en"];
    this.description =
      "MangaDex en anglais : mêmes scanlations via l'API officielle, sans chapitres français. Active-la si tu préfères un catalogue anglophone.";
    this.enabled = false;
  }
}

module.exports = MangadexEN;