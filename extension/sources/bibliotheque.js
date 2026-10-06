"use strict";

const BaseSource = require("../BaseSource");
const { coverFor } = require("../covers");
const { chapterHtml, chapterTitle } = require("../content/prose");
const { wordCount, normalize, httpError } = require("../utils");

/**
 * Bibliothèque NovelHub — source de démonstration principale.
 * Données en mémoire, générées de façon déterministe.
 */

const NOVELS = [
  {
    id: "vent-perdu",
    title: "Les Chroniques du Vent Perdu",
    author: "Aurore Lemaître",
    status: "ongoing",
    genre: "Fantasy",
    pool: "fantasy",
    tags: ["Aventure", "Royaumes", "Cartographie", "Épopée"],
    rating: 4.6,
    popularity: 942,
    year: 2024,
    chapterCount: 12,
    description:
      "Un jeune cartographe découvre une carte qui ne mène nulle part — et pourtant tout le monde la cherche. Entre royaumes en guerre et confréries secrètes, Kaël devra choisir entre la vérité et la survie.",
    seeds: [
      `<p>La carte n'était pas censée exister. Kaël l'avait trouvée glissée entre les pages d'un atlas poussiéreux, dans la réserve du maître Aldric, là où personne ne mettait les pieds depuis des années. Le parchemin était ancien — vraiment ancien — avec ces bords brûlés qui indiquaient une conservation délibérée, comme si quelqu'un avait voulu effacer les preuves de son existence sans tout à fait y parvenir.</p>`,
      `<p>Le marché de Port-Vaelen grouillait comme chaque vendredi matin. Les pêcheurs déchargeaient leurs prises, les marchands criaillaient, les enfants-mains légères travaillaient en silence entre les jambes des adultes. Kaël marchait vite, la carte roulée contre sa peau, persuadé que les regards croisés n'étaient pas le fruit du hasard.</p>`,
    ],
  },
  {
    id: "dernier-codeur",
    title: "Le Dernier Codeur",
    author: "Plume Numérique",
    status: "completed",
    genre: "Science-Fiction",
    pool: "scifi",
    tags: ["Satire", "Tech", "Dystopie"],
    rating: 4.3,
    popularity: 771,
    year: 2023,
    chapterCount: 8,
    description:
      "Dans un monde où l'IA a remplacé les développeurs, un étudiant en informatique tient tête — à coups de boucles for. Une satire tendre et grinçante du monde tech de demain.",
    seeds: [
      `<p>L'email d'acceptation était arrivé à 7 h 13 : <em>Candidature au poste de Développeur Junior — REJETÉE par notre IA de présélection.</em> Mathis le referma. Dix-septième refus du mois. Pas par un humain — les humains ne lisaient plus les CV depuis 2031.</p>`,
      `<p>La salle de TP était à moitié vide. La moitié présente était celle qui n'avait pas encore compris que tout cela était inutile, ou celle qui avait tout compris et était venue quand même, par principe. Mathis appartenait à la seconde catégorie.</p>`,
    ],
  },
  {
    id: "heritiere-neant",
    title: "L'Héritière de Néant",
    author: "Sombre Encre",
    status: "ongoing",
    genre: "Dark Fantasy",
    pool: "dark",
    tags: ["Sorcellerie", "Famille maudite", "Grimoire"],
    rating: 4.8,
    popularity: 1188,
    year: 2025,
    chapterCount: 20,
    description:
      "Elara n'a jamais su qu'elle était la dernière descendante d'une lignée de sorcières oubliées. Quand les ombres commencent à lui parler, elle doit apprendre à maîtriser un pouvoir qui a détruit tous ceux qui l'ont porté avant elle.",
    seeds: [
      `<p>L'ombre parla pour la première fois un mardi soir. Elara faisait sa vaisselle — activité suffisamment banale pour laisser le cerveau en pilote automatique — quand quelque chose murmura son nom. Pas tout à fait un son : plutôt la sensation qu'un son aurait pu faire.</p>`,
      `<p>Le grimoire sentait la cire et la cendre. Il ne s'ouvrait pas au hasard : il s'ouvrait à l'endroit où son ancienne propriétaire s'était arrêtée, trois générations plus tôt, la main figée au milieu d'une phrase qu'elle n'eut jamais le temps d'achever.</p>`,
    ],
  },
  {
    id: "renaissance-gouffre",
    title: "Système : Renaissance du Gouffre",
    author: "ReZero_Fan",
    status: "ongoing",
    genre: "LitRPG",
    pool: "litrpg",
    tags: ["LitRPG", "Donjon", "Progression", "Survie"],
    rating: 4.5,
    popularity: 1520,
    year: 2025,
    chapterCount: 45,
    description:
      "Après sa mort dans un accident banal, Yuto se réveille dans un donjon de niveau 0 avec un seul avantage : un système qui lui attribue des points d'expérience pour chaque moment de pure terreur vécu.",
    seeds: [
      `<p>[SYSTÈME : Bienvenue, Joueur. Votre vie précédente a été archivée. Votre respawn est en cours.] Yuto ouvrit les yeux sur du roc gris et une obscurité presque totale. L'air sentait l'humidité et quelque chose de biologique qu'il préférait ne pas identifier.</p>`,
      `<p>[NIVEAU ACTUEL : 0. CLASSE : Aucune. COMPÉTENCE UNIQUE : Résilience de la Terreur (passif) — chaque point de peur génère +2 EXP.] Bien. Le système fonctionnait. Yuto n'avait aucune idée de comment survivre au niveau 0, mais son incompétence totale serait au moins rentable.</p>`,
    ],
  },
  {
    id: "cultivatrice",
    title: "Mémoires d'une Cultivatrice",
    author: "Jade Immortelle",
    status: "completed",
    genre: "Xianxia",
    pool: "xianxia",
    tags: ["Cultivation", "Romance", "Empire", "Politique"],
    rating: 4.7,
    popularity: 1043,
    year: 2024,
    chapterCount: 15,
    description:
      "Dans l'empire de Qian, seuls les hommes peuvent cultiver le Qi. Lin Fei a pourtant une âme de guerrière et un secret qui pourrait renverser mille ans de tradition.",
    seeds: [
      `<p>Le Grand Tournoi de Qian avait lieu tous les dix ans. Pour y participer, il fallait être de sexe masculin, fils d'une famille reconnue, et posséder au moins la première strate de condensation du Qi. Lin Fei répondait à exactement zéro de ces critères. Elle s'inscrivit quand même.</p>`,
      `<p>— Votre nom ne figure pas sur les registres, dit le fonctionnaire en soulevant ses lunettes. Êtes-vous sûre d'être au bon endroit ? — Absolument, répondit Lin Fei avec le sourire de quelqu'un qui a déjà gagné. Je suis ici pour gagner.</p>`,
    ],
  },
  {
    id: "station-bercy",
    title: "La Dernière Station de Bercy",
    author: "Nuit Blanche",
    status: "ongoing",
    genre: "Polar",
    pool: "mystery",
    tags: ["Enquête", "Paris", "Disparition"],
    rating: 4.2,
    popularity: 654,
    year: 2025,
    chapterCount: 10,
    description:
      "Une nuit de métro, un voyageur disparaît entre deux stations. L'enquête d'une inspectrice obstinée révèle un réseau bien plus ancien qu'une simple affaire de video-surveillance.",
    seeds: [
      `<p>La rame entra en station à 00 h 47. Il y avait neuf passagers ; à la station suivante, il n'y en avait plus que huit — et personne, sur les images, n'était sorti. Ce détail mit trois jours à remonter jusqu'à l'inspectrice Amélie Ravel.</p>`,
      `<p>Le témoin répéta la même phrase trois fois, avec des intonations légèrement différentes, comme si la vérité pouvait se dire en plusieurs versions et qu'il fallait choisir la bonne. Elle nota tout, sans le regarder dans les yeux.</p>`,
    ],
  },
  {
    id: "oiseaux-verre",
    title: "Les Oiseaux de Verre",
    author: "Camille Aubry",
    status: "completed",
    genre: "Romance",
    pool: "romance",
    tags: ["Contemporain", "Reconstruction", "Paris"],
    rating: 4.4,
    popularity: 812,
    year: 2023,
    chapterCount: 14,
    description:
      "Deux inconnus se croisent chaque soir dans le même couloir de RER, à l'heure exacte où la lumière fait de chacun quelqu'un de plus aimable. Une histoire lente sur ce qu'on ose dire trop tard.",
    seeds: [
      `<p>Ils se croisèrent encore dans ce couloir, à 18 h 40, quand la lumière de fin de journée transforme les visages en promesses. Ni l'un ni l'autre ne changea de trottoir ; c'était déjà, depuis trois semaines, toute leur conversation.</p>`,
      `<p>Elle avait pris l'habitude de compter les secondes de silence entre ses phrases. Ce soir-là, le silence dura un peu plus long, et elle comprit qu'elle devait choisir entre rire, ou enfin poser la question.</p>`,
    ],
  },
  {
    id: "choeur-cendres",
    title: "Chœur de Cendres",
    author: "Vladimir Hertz",
    status: "ongoing",
    genre: "Horreur",
    pool: "horror",
    tags: ["Maison hantée", "Folklore", "Surnaturel"],
    rating: 4.5,
    popularity: 903,
    year: 2025,
    chapterCount: 9,
    description:
      "Une troupe de théâtre répète dans un manoir loué à prix d'ami. Chaque nuit, la pièce s'avance d'un acte que personne n'a écrit — et le public, chaque soir, est plus nombreux.",
    seeds: [
      `<p>Le couloir était plus long le soir qu'au matin. Ce n'était pas une impression : les marches en convenaient aussi, et personne, dans la troupe, n'avait envie d'en reparler au petit déjeuner.</p>`,
      `<p>Quelqu'un avait déplacé la chaise de la loge. Rien d'autre n'avait bougé dans le manoir, et c'était justement cela qui faisait peur : un désordre complet rassure, un détail précis accuse.</p>`,
    ],
  },
  {
    id: "orbitale-zero",
    title: "Orbitale Zéro",
    author: "K. M. Ferrand",
    status: "ongoing",
    genre: "Science-Fiction",
    pool: "scifi",
    tags: ["Espace", "Survie", "Station", "Mystère"],
    rating: 4.6,
    popularity: 1077,
    year: 2025,
    chapterCount: 22,
    description:
      "La station Méridienne tourne depuis deux cents ans sans qu'aucun humain n'ait ouvert le panneau de supervision. Quand il se fissure, l'équipage découvre que le silence de l'espace n'a jamais été vide.",
    seeds: [
      `<p>Le message avait mis quarante-deux minutes à traverser l'orbite, et à peine une seconde à détruire tout ce qu'on croyait savoir. On avait toujours cru le silence vide ; le silence, en réalité, était très occupé.</p>`,
      `<p>L'air recyclé portait une trace de câble brûlé. Chaque équipage reconnaît son vaisseau à son odeur avant de le reconnaître à sa forme — et celui-là sentait la panne annoncée depuis longtemps.</p>`,
    ],
  },
  {
    id: "marchand-pluie",
    title: "Le Marchand de Pluie",
    author: "Sébastien Ocre",
    status: "completed",
    genre: "Aventure",
    pool: "adventure",
    tags: ["Voyage", "Steppe", "Contrat", "Mythes"],
    rating: 4.1,
    popularity: 588,
    year: 2022,
    chapterCount: 16,
    description:
      "Dans les cités-secs, l'eau est une monnaie et la pluie un commerce. Malik vend des nuages — jusqu'au jour où on lui commande une tempête qui ne tombera jamais sur la bonne ville.",
    seeds: [
      `<p>La caravane quitta l'étape avant l'aube, comme il se devait : les routes les plus sûres sont celles que personne ne voit se franchir. Malik comptait déjà, d'avance, les journées de marche qu'il faudrait mentir pour tenir son contrat.</p>`,
      `<p>Le contrat prévoyait trois clauses et une primature. Dans ce métier, on lit toujours la quatrième en dernier, quand il est trop tard pour négocier. Il la lut en dernier. Il la lut trop tard.</p>`,
    ],
  },
  {
    id: "karma-protocol",
    title: "Karma Protocol",
    author: "Nyx_09",
    status: "ongoing",
    genre: "Science-Fiction",
    pool: "scifi",
    tags: ["Cyberpunk", "Hacking", "Mémoire", "Conspiration"],
    rating: 4.4,
    popularity: 996,
    year: 2024,
    chapterCount: 18,
    description:
      "Dans une ville où la réputation est calculée en temps réel, une ancienne hackeuse revendique l'effacement de son propre dossier. Le système, lui, n'a jamais rien oublié.",
    seeds: [
      `<p>La ville sous la coupole consommait plus d'énergie la nuit que le jour — ce qui avait toujours intrigué les économistes et jamais les insomniaques. Les insomniaques, eux, savaient parfaitement pourquoi.</p>`,
      `<p>Son score chuta de 214 points en une seconde. Personne ne l'expliqua ; personne, dans ce quartier, ne demandait d'explication à quelqu'un dont l'ombre venait de disparaître des écrans.</p>`,
    ],
  },
  {
    id: "bibliotheque-mers",
    title: "La Bibliothèque des Mers Perdues",
    author: "Ondine Fray",
    status: "completed",
    genre: "Fantasy",
    pool: "fantasy",
    tags: ["Archives", "Navigation", "Métaphysique"],
    rating: 4.7,
    popularity: 864,
    year: 2023,
    chapterCount: 11,
    description:
      "Il existe une bibliothèque où sont conservés les cartes de toutes les mers qui ont disparu. Y travailler consiste à relire des naufrages — jusqu'à ce qu'on y retrouve sa propre signature.",
    seeds: [
      `<p>Les cartes des mers disparues étaient classées par date de submersion, une organisation élégante qui avait l'avantage de transformer l'archive en calendrier funèbre. Ysandre aimait ce classement : il ne mentait jamais sur l'ordre des pertes.</p>`,
      `<p>La salle basse n'était accessible qu'à marée basse, ce qui en faisait soit l'endroit le plus sûr de l'archipel, soit le plus imprudent, selon l'heure et le tempérament du gardien.</p>`,
    ],
  },
];

class BibliothequeSource extends BaseSource {
  constructor() {
    super({
      id: "bibliotheque",
      name: "Bibliothèque NovelHub",
      baseUrl: null,
      lang: "fr",
      version: "2.0.0",
      author: "NovelHub",
      description: "Catalogue local de démonstration : romans générés, lecture et export EPUB sans réseau.",
      genres: ["Fantasy", "Dark Fantasy", "Science-Fiction", "LitRPG", "Xianxia", "Romance", "Polar", "Horreur", "Aventure"],
    });
    this._novels = new Map(NOVELS.map((n) => [n.id, n]));
  }

  async search(query = "", options = {}) {
    const q = normalize(query);
    let list = NOVELS.filter((n) => {
      if (!q) return true;
      const hay = normalize(
        [n.title, n.author, n.genre, n.tags.join(" "), n.description].join(" ")
      );
      return hay.includes(q);
    });

    if (options.genre && options.genre !== "all") {
      list = list.filter((n) => n.genre === options.genre);
    }
    if (options.status && options.status !== "all") {
      list = list.filter((n) => n.status === options.status);
    }

    const sorters = {
      popularity: (a, b) => b.popularity - a.popularity,
      rating: (a, b) => b.rating - a.rating,
      recent: (a, b) => b.year - a.year,
      chapters: (a, b) => b.chapterCount - a.chapterCount,
      title: (a, b) => a.title.localeCompare(b.title, "fr"),
      relevance: (a, b) => b.popularity - a.popularity,
    };
    list.sort(sorters[options.sort] || sorters.relevance);
    return list.map((n) => this._brief(n));
  }

  async getNovelInfo(novelId) {
    const n = this._novels.get(novelId);
    if (!n) throw httpError(404, "Roman introuvable sur cette source");

    const chapters = Array.from({ length: n.chapterCount }, (_, i) => ({
      id: `ch-${i + 1}`,
      title: chapterTitle(n, i + 1),
      order: i + 1,
    }));

    return {
      ...this._brief(n),
      sourceId: this.id,
      sourceName: this.name,
      description: n.description,
      chapters,
    };
  }

  async getChapterContent(novelId, chapterId) {
    const n = this._novels.get(novelId);
    if (!n) throw httpError(404, "Roman introuvable sur cette source");

    const match = /^ch-(\d+)$/.exec(String(chapterId));
    const order = match ? parseInt(match[1], 10) : 0;
    if (!order || order < 1 || order > n.chapterCount) {
      throw httpError(404, "Chapitre introuvable");
    }

    const title = chapterTitle(n, order);
    const content = chapterHtml(n, order);
    return {
      id: `ch-${order}`,
      title,
      order,
      content,
      wordCount: wordCount(content),
    };
  }

  _brief(n) {
    return {
      id: n.id,
      title: n.title,
      author: n.author,
      cover: coverFor(n),
      status: n.status,
      genre: n.genre,
      tags: n.tags,
      rating: n.rating,
      popularity: n.popularity,
      year: n.year,
      chapterCount: n.chapterCount,
      sourceId: this.id,
      sourceName: this.name,
    };
  }
}

module.exports = BibliothequeSource;
