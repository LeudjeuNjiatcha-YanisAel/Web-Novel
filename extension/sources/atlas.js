"use strict";

const BaseSource = require("../BaseSource");
const { coverFor } = require("../covers");
const { chapterHtml, chapterTitle } = require("../content/prose");
const { wordCount, normalize, httpError } = require("../utils");

/**
 * Atlas — seconde source de démonstration, orientation fantasy / cultivation.
 * Elle sert à valider la recherche multi-sources et les filtres croisés.
 */

const NOVELS = [
  {
    id: "six-trones",
    title: "L'Aube des Six Trônes",
    author: "Aldric Vane",
    status: "ongoing",
    genre: "Fantasy",
    pool: "fantasy",
    tags: ["Empire", "Guerre de succession", "Diplomatie"],
    rating: 4.7,
    popularity: 1310,
    year: 2025,
    chapterCount: 30,
    description:
      "Six maisons se partagent un empire qui n'en a plus la force. À la mort du dernier empereur, chacune doit choisir : s'allier, trahir, ou attendre que les autres le fassent à sa place.",
    seeds: [
      `<p>Le testament fut lu deux fois : une fois à voix haute, pour la cour ; une fois en silence, pour ceux qui savaient que les vrais ordres ne s'écritent pas. Six maisons entendirent la même phrase et tirèrent six conséquences différentes.</p>`,
      `<p>La salle du conseil sentait la cire froide et les vestes trempées. Chaque membre avait posé la main sur la table — non pas pour jurer, mais parce qu'on n'ose plus faire serment quand on a déjà menti une fois.</p>`,
    ],
  },
  {
    id: "serment-pierre",
    title: "Le Serment de Pierre",
    author: "Sombre Encre",
    status: "completed",
    genre: "Dark Fantasy",
    pool: "dark",
    tags: ["Chevalerie", "Malédiction", "Ruines"],
    rating: 4.5,
    popularity: 742,
    year: 2024,
    chapterCount: 12,
    description:
      "Une confrérie de chevaliers a juré de garder un tombeau que personne n'a jamais ouvert. Trois cents ans plus tard, il ne reste qu'un survivant — et le tombeau, lui, a commencé à répondre.",
    seeds: [
      `<p>Le nom avait été effacé du registre, mais il persistait sur les murs, gratté dans la pierre par des ongles qui n'avaient plus rien à perdre. On efface un nom ; on n'efface pas la main qui l'a écrit.</p>`,
      `<p>La neige tombait sur les ruines sans se fondre. Les novices disaient que c'était un présage ; l'ancien disait que c'était de la neige, et qu'il avait appris, très tôt, à ne plus baptiser ce qu'il ne comprenait pas.</p>`,
    ],
  },
  {
    id: "cendres-qiang",
    title: "Les Cendres de Qiang",
    author: "Jade Immortelle",
    status: "ongoing",
    genre: "Xianxia",
    pool: "xianxia",
    tags: ["Cultivation", "Secte", "Vengeance"],
    rating: 4.8,
    popularity: 1402,
    year: 2025,
    chapterCount: 24,
    description:
      "Sa secte a été rasée en une nuit, sans un cri. Le seul disciple qui dormait dehors survit — avec un souffle brisé, une dette impossible, et dix ans pour s'en servir.",
    seeds: [
      `<p>La montagne ne se gravissait pas : elle se méritait. Chaque marche correspondait à une année de pratique, disaient les maîtres ; les disciples, eux, comptaient simplement leurs genoux.</p>`,
      `<p>Le Qi montait du sol comme une brume tiède, et les anciens disaient qu'il fallait savoir l'écouter avant de prétendre le contrôler. Beaucoup d'adeptes étaient morts en confondant les deux.</p>`,
    ],
  },
  {
    id: "foret-chuchote",
    title: "La Forêt qui Chuchote",
    author: "Vladimir Hertz",
    status: "ongoing",
    genre: "Horreur",
    pool: "horror",
    tags: ["Forêt", "Rite", "Disparitions"],
    rating: 4.4,
    popularity: 821,
    year: 2025,
    chapterCount: 13,
    description:
      "Chaque village de la vallée perd un habitant par hiver. Depuis toujours, on attribue cela à la forêt. Cette année, un botaniste arrive avec un carnet, un thermomètre et l'intention de prouver le contraire.",
    seeds: [
      `<p>Les arbres, ici, penchent tous vers le nord — un détail que les cartes ignorent et que les forestiers répètent sans y croire. Le biologiste releva l'anomalie à la première journée, avant de comprendre qu'elle n'était pas géographique.</p>`,
      `<p>Il y avait des traces autour du camp, mais aucune n'était dirigée vers les vivres : elles tournaient en rond, patientes, comme si quelqu'un — quelque chose — avait renoncé à entrer et avait choisi d'attendre.</p>`,
    ],
  },
  {
    id: "dernier-eclaireur",
    title: "Le Dernier Éclaireur",
    author: "Sébastien Ocre",
    status: "completed",
    genre: "Aventure",
    pool: "adventure",
    tags: ["Frontière", "Marche", "Fraternité"],
    rating: 4.2,
    popularity: 604,
    year: 2023,
    chapterCount: 10,
    description:
      "Il cartographie seul la frontière que l'armée n'ose plus franchir. Quand la dernière tour s'éteint, il lui reste trois jours de marche, une mule têtue et une promesse faite à quelqu'un qui n'est plus là.",
    seeds: [
      `<p>La nuit tomba plus vite que prévu, ce qui, dans la steppe, signifie qu'on a marché toute la journée dans la mauvaise direction. Beren corrigea l'azimut d'un doigt callus et décida de ne pas allumer de feu.</p>`,
      `<p>Ils cuisinèrent au bord du fleuve, parlèrent peu, et se rappelèrent pourquoi ils avaient commencé : l'horizon, d'abord ; le reste venait toujours après, avec les comptes et les regrets.</p>`,
    ],
  },
  {
    id: "ronde-esprits",
    title: "Ronde des Esprits",
    author: "Ondine Fray",
    status: "ongoing",
    genre: "Fantasy",
    pool: "fantasy",
    tags: ["Esprits", "Village", "Saisons", "Pacte"],
    rating: 4.5,
    popularity: 697,
    year: 2024,
    chapterCount: 17,
    description:
      "Au solstice, les esprits descendent danser sur la place du village — à condition que quelqu'un danse avec eux. Cette année, la fille du maire refuse, et les récoltes commencent à le payer.",
    seeds: [
      `<p>Les lampes s'éteignaient une à une le long du corridor, comme si quelque chose les consumait à mesure qu'il avançait. Maëva aurait dû reculer ; elle aurait dû, c'est le mot qu'elle répétera plus tard, devant des gens qui ne la croiront pas.</p>`,
      `<p>La place était déjà pleine au matin. Les marchands étalaient leurs étoffes par-dessus les traces de la nuit, geste habituel de ceux qui savent que certains spectacles ne supportent pas le jour.</p>`,
    ],
  },
];

class AtlasSource extends BaseSource {
  constructor() {
    super({
      id: "atlas",
      name: "Atlas Fantasy",
      baseUrl: "atlas.local",
      lang: "fr",
      version: "1.4.2",
      author: "Collectif Atlas",
      description: "Anthologie spécialisée : fantasy, dark fantasy et cultivation. Source de test multi-sources.",
      genres: ["Fantasy", "Dark Fantasy", "Xianxia", "Horreur", "Aventure"],
    });
    this._novels = new Map(NOVELS.map((n) => [n.id, n]));
  }

  async search(query = "", options = {}) {
    const q = normalize(query);
    let list = NOVELS.filter((n) => {
      if (!q) return true;
      const hay = normalize([n.title, n.author, n.genre, n.tags.join(" "), n.description].join(" "));
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
    return { id: `ch-${order}`, title, order, content, wordCount: wordCount(content) };
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

module.exports = AtlasSource;
