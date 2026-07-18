const BaseSource = require("../BaseSource");

/**
 * DemoSource
 * ----------
 * Extension de démonstration : ne fait AUCUNE requête réseau, tout est
 * généré en mémoire. Elle sert à valider le moteur (recherche, EPUB, UI)
 * avant de brancher de vraies extensions.
 */
class DemoSource extends BaseSource {
  constructor() {
    super({ id: "demo", name: "Bibliothèque de démo", baseUrl: null, lang: "fr" });

    this._novels = {
      "novel-1": {
        id: "novel-1",
        title: "Les Chroniques du Vent Perdu",
        author: "Auteur Fictif",
        description:
          "Un jeune cartographe découvre une carte qui ne mène nulle part... et pourtant, tout le monde la cherche.",
        cover: null,
        status: "En cours",
        chapterCount: 5,
      },
      "novel-2": {
        id: "novel-2",
        title: "Le Dernier Codeur",
        author: "Plume Numérique",
        description:
          "Dans un monde où l'IA a remplacé les développeurs, un étudiant en L2 informatique tient tête... à coups de boucles for.",
        cover: null,
        status: "Terminé",
        chapterCount: 3,
      },
    };
  }

  async search(query) {
    const q = (query || "").toLowerCase().trim();
    const all = Object.values(this._novels);
    const results = q
      ? all.filter(
          (n) =>
            n.title.toLowerCase().includes(q) || n.author.toLowerCase().includes(q)
        )
      : all;

    return results.map((n) => ({
      id: n.id,
      title: n.title,
      author: n.author,
      cover: n.cover,
    }));
  }

  async getNovelInfo(novelId) {
    const novel = this._novels[novelId];
    if (!novel) {
      const err = new Error("Novel introuvable");
      err.status = 404;
      throw err;
    }

    const chapters = Array.from({ length: novel.chapterCount }, (_, i) => ({
      id: `ch-${i + 1}`,
      title: `Chapitre ${i + 1}`,
      order: i + 1,
    }));

    return {
      id: novel.id,
      title: novel.title,
      author: novel.author,
      description: novel.description,
      cover: novel.cover,
      status: novel.status,
      chapters,
    };
  }

  async getChapterContent(novelId, chapterId) {
    const novel = this._novels[novelId];
    if (!novel) {
      const err = new Error("Novel introuvable");
      err.status = 404;
      throw err;
    }
    const order = parseInt(chapterId.replace("ch-", ""), 10);
    if (!order || order > novel.chapterCount) {
      const err = new Error("Chapitre introuvable");
      err.status = 404;
      throw err;
    }

    return {
      title: `Chapitre ${order}`,
      content: `<p>Ceci est le contenu généré pour le <strong>chapitre ${order}</strong> de « ${novel.title} ».</p>
<p>Paragraphe de test permettant de vérifier la mise en page dans le lecteur et dans l'EPUB généré. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
<p>Fin du chapitre ${order}.</p>`,
    };
  }
}

module.exports = DemoSource;
