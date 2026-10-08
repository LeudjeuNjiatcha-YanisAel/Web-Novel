"use strict";

const MangaDex = require("./mangadex");

/**
 * Variante francophone de MangaDex : même API officielle, chapitres FR
 * (translatedLanguage[] = fr) pour un catalogue strictement français.
 * Désactivée par défaut pour éviter les doublons avec MangaDex multi-langues.
 */
class MangadexFR extends MangaDex {
  constructor() {
    super();
    this.id = "mangadex-fr";
    this.name = "MangaDex (FR)";
    this.lang = "fr";
    this.languages = ["fr"];
    this.description =
      "MangaDex 100 % français : scanlations FR via l'API officielle, sans chapitres anglais ou autres langues. Idéal pour un catalogue exclusivement en français.";
    this.enabled = false;
  }
}

module.exports = MangadexFR;