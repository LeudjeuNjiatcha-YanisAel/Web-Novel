"use strict";

const { hashString, pick } = require("../utils");

/**
 * Moteur de contenu pour les extensions de démonstration.
 * Les paragraphes sont volontairement génériques (aucun nom de personnage)
 * : ils sont piochés de façon déterministe selon le genre du roman, puis
 * combinés aux paragraphes d'ouverture propres à chaque œuvre.
 */

const POOLS = {
  fantasy: {
    paragraphs: [
      "Le vent montait des remparts en sifflant entre les pierres, et portait avec lui l'odeur lointaine de la mer. Personne, dans le village, ne s'en était encore servi pour penser à l'avenir : ici, l'avenir se calculait en récoltes, en saisons, en jours sans embuscade.",
      "La salle du conseil sentait la cire froide et les vestes trempées. Chaque membre avait posé sa main sur la table, non pas pour jurer, mais parce qu'on n'ose plus faire serment quand on a déjà menti une fois.",
      "Il regarda la carte s'étendre sous ses doigts, ce ruban de montagnes qu'il avait appris à connaître par cœur avant même de savoir lire. Les frontières y étaient des lignes ; sur le terrain, elles étaient des os.",
      "Les lampes s'éteignaient une à une le long du corridor, comme si quelque chose les consumait à mesure qu'il avançait. Il aurait dû reculer. Il aurait dû, c'est le mot qu'il répétera plus tard, devant des gens qui ne le croiraient pas.",
      "Au matin, la place était déjà pleine. Les marchands étalaient leurs étoffes par-dessus les traces de la nuit, geste habituel de ceux qui savent que certains spectacles ne supportent pas le jour.",
      "La vieille citadelle n'avait pas de nom sur les registres officiels. Elle n'en avait jamais eu besoin : tout le monde savait qu'elle se trouvait à trois journées de marche, au-delà du pont, là où les routes cessent d'être des routes.",
      "Il y a des serments qui se tiennent debout tout seuls, et d'autres qui ont besoin qu'on les porte. Celui-là pesait comme une pierre depuis l'aube, et il ne demandait qu'à être laissé au bord du chemin.",
      "La lumière tombait de la verrière en blocs inclinés, et dans ces blocs, la poussière dansait sans savoir qu'elle était observée. C'est souvent ainsi que commencent les décisions : par un rien qu'on regarde trop longtemps.",
      "Les cloches sonnèrent trois coups, puis s'arrêtèrent au milieu du troisième, comme rattrapées par une main prudente. Dans ce pays, on ne sonne l'alarme que lorsqu'il est déjà trop tard pour fuir.",
      "Il repassa les chiffres une dernière fois. Tout tenait : les vivres, les chevaux, le temps. Il ne tenait plus qu'une chose, et c'était celle-là qu'on lui demandait d'abandonner.",
    ],
    titles: [
      "Le vent des remparts", "La salle du conseil", "Au-delà du pont",
      "Le poids d'un serment", "Trois coups de cloche", "La route sans nom",
      "Le marché aux lanternes", "Ce que la carte tait", "L'heure du départ",
      "Les pierres se souviennent",
    ],
  },
  dark: {
    paragraphs: [
      "Quelque chose respirait sous le plancher, lentement, avec la régularité d'un appareil qu'on aurait oublié de débrancher. Elle compta les secondes entre chaque inspiration, non pas pour se calmer, mais pour savoir combien il lui restait.",
      "Les ombres ici ne suivaient pas la lumière : c'était la lumière qui cherchait pénibrement à les contourner, comme si elle aussi avait quelque chose à cacher.",
      "Le nom avait été effacé du registre, mais il persistait sur les murs, gratté dans la pierre par des ongles qui n'avaient plus rien à perdre. On efface un nom ; on n'efface pas la main qui l'a écrit.",
      "Elle avait appris très tôt que la peur n'est pas un bruit. La peur est un silence précis, celui qui s'installe juste avant qu'on vous appelle par un nom que vous n'avez jamais porté.",
      "La cendre tombait sans feu, blanche et régulière, sur les toits déserts. Les habitants disaient que c'était un signe. Les habitants disaient beaucoup de choses pour ne pas dire qu'ils avaient peur.",
      "Il y avait une porte au fond du couloir qu'aucune clé n'avait ouverte depuis trois générations. On avait muré la serrure, puis l'encadrement, puis l'idée même de cette porte — tout, sauf l'habitude de la regarder.",
      "Le rituel exigeait un nom, un souvenir et une perte. Elle avait apporté les trois, dans cet ordre, en espérant que la dernière serait la plus facile à donner.",
      "Les morts, dans cette maison, ne rendaient jamais visite deux fois de la même façon. C'est même à cela qu'on les reconnaissait : ils avaient chacun leur manière d'entrer sans bruit.",
      "Un froid sans saison s'était installé entre les murs. On l'attribuait au vent, comme on attribue aux ombres ce que les yeux refusent de voir en pleine lumière.",
      "Elle savait que le pouvoir ne se prend pas : il se contracte, comme un muscle trop sollicité, et un jour il ne répond plus. Chaque usage laissait une fissure, et les fissures, elles, ne se referment pas.",
    ],
    titles: [
      "Sous le plancher", "Le nom effacé", "Cendre sans feu",
      "La porte murée", "Ce qu'on n'appelle plus", "Fissures",
      "Le troisième souvenir", "Murmure dans le couloir", "La maison respire",
      "Nuit de veille",
    ],
  },
  scifi: {
    paragraphs: [
      "Le message avait mis quarante-deux minutes à traverser l'orbite, et à peine une seconde à détruire ce qu'on croyait savoir. On avait toujours cru le silence vide ; le silence, en réalité, était très occupé.",
      "La station tournait à neuf tours par minute, suffisamment pour simuler une pesanteur de bordure, insuffisamment pour faire oublier qu'on n'était qu'un objet en chute libre très bien éclairé.",
      "Les écrans affichaient des courbes vertes, ce qui, dans ce métier, signifie que les systèmes tiennent — et non que quelqu'un les comprend encore. Il y avait des années qu'aucun humain n'avait ouvert le panneau de supervision.",
      "L'air recyclé portait une trace de câble brûlé. Chaque équipage reconnaît son vaisseau à son odeur avant de le reconnaître à sa forme, et celui-là sentait la panne annoncée depuis longtemps.",
      "Il relut l'ordre de mission trois fois. Trois fois le texte disait la même chose : descendre, extraire, ne pas entrer en contact. Trois fois il pensa qu'on avait écrit ce dernier mot pour qu'on l'enfreigne.",
      "La ville sous la coupole consommait plus d'énergie la nuit que le jour, ce qui avait toujours intrigué les économistes et jamais les insomniaques. Les insomniaques, eux, savaient parfaitement pourquoi.",
      "Le drone revint sans données mais avec une rayure fraîche. On avait programmé pour l'impossible ; on n'avait pas programmé pour le presque-retour.",
      "Les archives gardaient tout, y compris ce qu'on avait ordonné d'oublier. Un système qui n'oublie rien finit par devenir la mémoire exacte des mensonges de ceux qui l'ont construit.",
      "Il ajusta la trajectoire de dix-sept degrés. La manœuvre devait rapporter six heures de carburant et une journée d'explications ; tout, dans ce métier, se paie deux fois.",
      "Le soleil de synthèse s'alluma à l'heure prévue, bleu et parfait. Personne, à bord, ne regarda vers la fenêtre : on finit par trouver l'artifice rassurant quand on a oublié l'autre.",
    ],
    titles: [
      "Quarante-deux minutes", "Objet en chute libre", "Ordre de contact",
      "Le panneau de supervision", "Trajectoire corrigée", "Mémoire des mensonges",
      "Soleil de synthèse", "Le drone revenu", "Coupole nord",
      "Signal d'entrée",
    ],
  },
  litrpg: {
    paragraphs: [
      "[SYSTÈME : Paramètres chargés. Veuillez confirmer votre consentement pour la collecte d'événements.] La fenêtre flottait là, translucide, et n'avait aucune intention de disparaître avant d'être traitée.",
      "[+12 EXP — Observation d'un environnement hostile] Le simple fait de constater qu'il avait peur semblait suffire à valoriser l'expérience. C'était, avouons-le, un système particulièrement cynical.",
      "Il vérifia ses statistiques pour la quatrième fois. Rien n'avait changé, mis à part un point de fatigue accumulée qui, d'après la description, se « dissiperait au repos — non garanti ».",
      "[AVERTISSEMENT : La mort est permanente dans cette zone. Les sauvegardes sont désactivées.] Il relut l'avertissement, le ferma, le rouvrit. Le texte, lui, ne s'était pas fatigué.",
      "La fenêtre d'inventaire contenait trois objets : une corde, un galet luisant et une note dont la lecture était « requise avant utilisation ». Il n'avait jamais rien demandé de plus à la chance.",
      "[QUEST : Survivre à la nuit — Récompense : 250 EXP, 1 Point de compétence — Échec : mort.] Il aurait préféré un choix, mais le système avait l'habitude d'offrir des échéances.",
      "Chaque action, même la plus banale, générait une ligne de journal. Au bout d'une heure, il tenait le récit le mieux documenté et le moins héroïque de toute l'histoire du donjon.",
      "[NIVEAU SUPÉRIEUR ATTEINT] Le flash lumineux dura une seconde ; l'euphorie, trois. Il lui restait à décider dans quoi investir ce qui, à l'évidence, serait le pire choix de sa vie.",
      "Il apprit vite que les monstres de bas niveau avaient un point commun avec les administrations : ils revenaient toujours, en plus nombreux, dès qu'on croyait avoir gagné du temps.",
      "[CHAT DE GROUPE : Vous êtes le seul membre en ligne.] La notification apparut en haut de l'écran, polie, factuelle, et terriblement claire sur la nature de l'aventure qui l'attendait.",
    ],
    titles: [
      "Chargement du système", "Première quête", "Écran de statistiques",
      "Zone à sauvegarde désactivée", "Point de compétence", "Journal de bord",
      "Palier suivant", "Le chat des absents", "Récompense d'échec",
      "Niveau 1",
    ],
  },
  xianxia: {
    paragraphs: [
      "Le Qi, ici, se levait du sol comme une brume tiède, et les plus anciens disaient qu'il fallait savoir l'écouter avant de prétendre le contrôler. Beaucoup d'adeptes étaient morts en confondant les deux.",
      "La montagne ne se gravissait pas : elle se méritait. Chaque marche correspondait à une année de pratique, disaient les maîtres ; les disciples, eux, comptaient simplement leurs genoux.",
      "Sous le hall des serments, les dalles portaient encore les marques de genoux qui avaient tenu plus longtemps que des promesses. La pierre, elle, ne ment jamais assez vite.",
      "Il ferma les yeux et laissa le souffle descendre jusqu'à son dantien. Trois respirations plus tard, il sentit la chaleur familière — et, comme toujours, la fissure qui l'accompagnait depuis le dernier combat.",
      "Les grands sectaires ne discutaient pas : ils établissaient des équilibres, puis ils les respectaient jusqu'à ce que quelqu'un, quelque part, trouve une raison de ne plus le faire.",
      "Le vent portait des pétales secs sur la terrasse d'entraînement. On dit d'un endroit qu'il est paisible lorsque les disciples y pratiquent sans témoins, et qu'il devient sacré lorsqu'ils y échouent sans s'en vanter.",
      "Son épée n'était pas bonne. Elle était juste fidèle, ce qui, dans une lignée où tout le monde arborait des armes héritées de génies, constituait une forme discrète de bravoure.",
      "L'ancienne ouvrit le rouleau sans le déplier entièrement. Ce qui devait être lu, dit-elle, se lit dans la marge ; le reste s'adresse à ceux qui n'ont pas encore compris qu'ils apprenaient.",
      "La cérémonie durera du premier coup de gong au dernier. Quiconque tremble devant l'autel, dit-on, voit son nom s'effacer du registre céleste — une métaphore, jusqu'au jour où elle ne l'est plus.",
      "Il avait progressé d'une strate en une nuit, ce qui impressionnait les juniors et inquiétait les anciens : la vitesse n'est pas un talent, c'est souvent un acompte.",
    ],
    titles: [
      "La montagne se mérite", "Le dantien fissuré", "Rouleau de la marge",
      "Premier coup de gong", "Une strate en une nuit", "Lame fidèle",
      "Pétales sur la terrasse", "Registre céleste", "Le prix de la vitesse",
      "Passage du seuil",
    ],
  },
  romance: {
    paragraphs: [
      "Ils se croisèrent encore dans ce corridor, à l'heure où la lumière fait de chacun quelqu'un de plus aimable. Ni l'un ni l'autre ne changea de trottoir ; c'était déjà une forme de conversation.",
      "Elle avait pris l'habitude de compter les secondes de silence entre deux de ses phrases. Ce jour-là, le silence fut un peu plus long que d'ordinaire, et elle sut qu'elle devrait choisir entre rire ou partir.",
      "Le café avait fermé depuis longtemps, mais la table du fond restait libre, comme si l'établissement gardait une place pour les histoires qui n'ont pas su se terminer à l'heure.",
      "Il écrivait des mots qu'il ne dirait jamais, les relisait, les raturait, puis les laissait tels quels — parce qu'un rature finit toujours par ressembler davantage à la vérité.",
      "On lui avait dit que le temps aplanit tout. Le temps, dans son cas, s'était contenté d'accumuler les preuves, avec la patience d'un archiviste qui n'a aucune envie de conclure.",
      "La pluie commença au moment précis où elle eut raison de partir. Elle resta donc, ce qui, dans sa famille, passait pour un caractère bien trempé.",
      "Ils parlèrent de tout, sauf de la seule chose qui comptait, avec cette élégance particulière des gens qui ont peur de gâcher un soir parfait en disant ce qu'ils pensent vraiment.",
      "Un message composé, effacé, recomposé, puis envoyé trop vite : elle relut la phrase huit fois sans jamais obtenir la version qui sonnait comme elle le voulait. Le cœur n'a pas de correcteur orthographique.",
      "Dans le train, il regarda la ville s'éloigner et comprit qu'il ne regrettait pas le départ, mais l'instant d'avant, où tout était encore possible sans que rien n'ait été décidé.",
      "Elle rit plus fort qu'elle ne l'aurait voulu, posa la main sur la sienne par réflexe, puis la retira — et cet intervalle de deux secondes contint, à lui seul, tout ce qu'ils n'osaient pas formuler.",
    ],
    titles: [
      "Le même corridor", "La table du fond", "Message recomposé",
      "Deux secondes de trop", "Ce que je n'écrirai pas", "Pluie à la sortie",
      "Le train de 18 h 40", "Rire trop fort", "Après le café",
      "Silence compté",
    ],
  },
  mystery: {
    paragraphs: [
      "Le témoin répéta la même phrase trois fois, avec des intonations légèrement différentes, comme si la vérité pouvait se dire en plusieurs versions et qu'il fallait choisir la bonne.",
      "La scène était rangée : trop rangée pour un cambriolage, trop désordonnée pour une scène de ménage. Il nota ce détail, comme il notait toujours ce qui ne cadrait pas.",
      "L'horloge du bureau s'était arrêtée à 4 h 12. On avait d'abord cru à un hasard ; puis on avait trouvé la seconde, dissimulée dans un tiroir, exactement à la même heure.",
      "Il connaissait ce quartier depuis vingt ans, assez pour savoir que les commerçants ferment non pas par manque de clients, mais parce qu'ils ont entendu quelque chose.",
      "Le dossier sentait la poussière et le café refroidi. Chaque page supplémentaire rendait l'affaire plus claire, ce qui, dans ce genre d'enquête, signifie toujours qu'on s'approche du mensonge principal.",
      "Elle n'avait rien pris, rien déplacé, rien touché — et c'était précisément ce qui l'inquiétait : les vides sont plus bavards que les traces.",
      "La note était pliée en quatre, glissée dans une enveloppe sans destinataire. L'écriture était nette, pressée, et surtout parfaitement lisible : on n'écrit pas aussi lisiblement pour être ignoré.",
      "Il remonta le fil des appels. Trois numéros, trois explications plausibles, et un quatrième appel qui n'apparaissait nulle part sauf sur la facture — l'endroit exact où les gens cachent ce qu'ils croient inutile.",
      "Le voisin décrivit une silhouette sans visage avec une précision qui l'étonna lui-même. On n'a pas une mémoire aussi détaillée pour un hasard : il avait reconnu, quelque part, sans vouloir l'avouer.",
      "À minuit, la porte du fond était ouverte d'un cran. Personne n'avait la clé. Personne, non plus, n'avait entendu le bruit — sauf peut-être l'horloge, qui, elle, avait bien quelque chose à dire.",
    ],
    titles: [
      "Trois versions", "4 h 12", "Trop rangé",
      "L'enveloppe sans destinataire", "Le quatrième appel", "Silhouette décrite",
      "La porte entrouverte", "Ce que le voisin sait", "Poussière et café",
      "Dernier témoin",
    ],
  },
  horror: {
    paragraphs: [
      "Le couloir était plus long le soir qu'au matin. Ce n'était pas une impression : les marches en convenaient aussi, et personne n'avait envie d'en reparler.",
      "Quelqu'un avait déplacé la chaise. Rien d'autre dans la pièce n'avait bougé, et c'était justement cela qui faisait peur : un désordre complet rassure, un détail précis accuse.",
      "Elle entendit le plafond craquer au-dessus de sa tête, avec ce rythme lent qui n'appartient qu'aux pas — et à rien d'autre, se répétait-elle, surtout pas à rien d'autre.",
      "Les photos de la famille s'étaient jaunies de façon inégale. Sur chacune, un visage avait disparu, comme effacé par une main patiente, et personne n'osait dire lequel.",
      "La radio ne captait plus que des souffles, ponctués parfois d'une voix qui comptait. Toujours le même nombre, toujours s'arrêtant avant la fin — comme si compter jusqu'au bout avait des conséquences.",
      "L'air sentait la terre mouillée, alors que la pièce donnait sur le huitième étage. Ce parfum revenait chaque nuit, un peu plus proche du lit, un peu plus dense.",
      "Un bruit d'objet renversé vint de l'étage d'en dessous. Il n'y avait personne en dessous. Il n'y avait, depuis des mois, personne nulle part dans cet immeuble — et pourtant l'immeuble vivait.",
      "Elle se réveilla avec la sensation d'avoir été observée pendant son sommeil. Ce n'était pas une intuition : l'oreiller, à côté d'elle, portait encore la marque d'une tête.",
      "Les murs gardaient l'humidité comme les gens gardent les secrets : silencieusement, et toujours au même endroit. On avait repeint trois fois la même tache.",
      "Dans le miroir, la pièce semblait correcte. C'est en s'approchant qu'elle comprit que le reflet s'était arrêté une fraction de seconde trop tôt.",
    ],
    titles: [
      "Plus long le soir", "La chaise déplacée", "Le plafond craque",
      "Photos jaunies", "La radio qui compte", "Terre mouillée",
      "Étage vide", "Marque sur l'oreiller", "Trois fois la même tache",
      "Le reflet retardé",
    ],
  },
  adventure: {
    paragraphs: [
      "La caravane quitta l'étape avant l'aube, comme il se devait : les routes les plus sûres sont celles que personne ne voit se franchir.",
      "Ils marchèrent cinq jours sans trouver d'eau, et au sixième, la carte promit une source. Les cartes promettent beaucoup de choses qu'elles n'ont jamais vues.",
      "Le pont de corde tremblait à chaque pas, mais il tenait — parole de passeur, ce qui valait autant qu'une autre, et souvent davantage.",
      "Au détour du col, la vallée apparut d'un coup, immense et verte, comme si la montagne avait gardé ce secret pour elle seule pendant des siècles.",
      "Le contrat prévoyait trois clauses et une primauté. Dans ce métier, on lit toujours la quatrième en dernier, quand il est trop tard pour négocier.",
      "Ils cuisinèrent au bord du fleuve, parlèrent peu, et se rappelèrent ensemble pourquoi ils avaient commencé : l'horizon, d'abord ; le reste venait après.",
      "Le marché de la cité-porte n'avait pas de plan. On y vendait des reliques, des mensonges et, les bons jours, des cartes de régions que personne n'avait encore traversées.",
      "La nuit tomba plus vite que prévu, ce qui, dans la steppe, signifie qu'on a marché toute la journée dans la mauvaise direction.",
      "Un orage forca le groupe à se réfugier dans une bergerie abandonnée. Au matin, quelqu'un avait laissé du feu allumé — et ils n'étaient pas arrivés seuls.",
      "Au dernier passage, il se retourna une fois vers ce qu'il laissait derrière. Les gens sages ne font pas ça ; les gens heureux davantage.",
    ],
    titles: [
      "Avant l'aube", "La promesse de la carte", "Pont de corde",
      "Le secret de la vallée", "Quatrième clause", "Étape de la steppe",
      "Le feu qu'on a laissé", "Marché de la cité-porte", "Le col sans nom",
      "Dernier regard",
    ],
  },
};

const GENERIC_TITLES = [
  "Le tournant", "Convergence", "Ce qu'il fallait taire", "Le prix",
  "Après la tempête", "La faille", "Les mains vides", "Face à face",
  "Ce qui reste", "Le long retour", "L'éclaircie", "Promesse tenue",
  "Le bord du précipice", "Ceux qui attendent", "Une fois de plus",
  "Le seuil",
];

const ENDINGS = [
  "Il lui restait une décision à prendre, et le jour, cette fois, ne l'attendrait pas.",
  "De l'autre côté de la porte, quelqu'un avait déjà commencé à compter.",
  "La suite s'annonçait pire ; c'est à cela qu'on reconnaît un vrai tournant.",
  "Personne ne dit rien. Dans ces cas-là, le silence est une réponse très claire.",
  "Plus tard, il se souviendrait de ce moment comme de celui où tout a basculé — sans pouvoir dire exactement quoi.",
  "Le vent se leva de nouveau, et avec lui, quelque chose qui ne devait pas encore être nommé.",
  "Il referma les yeux une seconde. Une seconde suffit, parfois, à changer la suite de l'histoire.",
  "L'aube arriva sans prévenir, indifférente aux plans qu'on avait faits la nuit.",
];

const SCENE_BREAK = `<p style="text-align:center;opacity:.5;letter-spacing:.6em;margin:2.2em 0">❧</p>`;

function resolvePool(novel) {
  const key = novel.pool || "fantasy";
  return POOLS[key] || POOLS.fantasy;
}

/** Titre de chapitre déterministe. */
function chapterTitle(novel, order) {
  if (Array.isArray(novel.titles) && novel.titles[order - 1]) {
    return novel.titles[order - 1];
  }
  const pool = resolvePool(novel);
  const merged = pool.titles.concat(GENERIC_TITLES);
  const base = hashString(novel.id) % merged.length;
  const idx = (base + order - 1) % merged.length;
  const cycle = Math.floor((base + order - 1) / merged.length);
  const title = merged[idx];
  if (cycle === 0) return title;
  const romans = ["", " II", " III", " IV", " V", " VI"];
  if (cycle < romans.length) return title + romans[cycle];
  return `Chapitre ${order}`;
}

/** Composition déterministe du HTML d'un chapitre. */
function chapterHtml(novel, order) {
  const pool = resolvePool(novel);
  const seed = hashString(`${novel.id}:${order}`);
  const parts = [];

  if (novel.seeds && novel.seeds[order - 1]) {
    parts.push(novel.seeds[order - 1]);
  }

  const used = new Set();
  const count = 5;
  for (let i = 0; i < count; i++) {
    let idx = (seed + i * 3) % pool.paragraphs.length;
    let guard = 0;
    while (used.has(idx) && guard < pool.paragraphs.length) {
      idx = (idx + 1) % pool.paragraphs.length;
      guard++;
    }
    used.add(idx);
    parts.push(`<p>${pool.paragraphs[idx]}</p>`);
    if (i === 2) parts.push(SCENE_BREAK);
  }

  parts.push(`<p>${pick(ENDINGS, seed + order)}</p>`);
  return parts.join("\n");
}

module.exports = { chapterHtml, chapterTitle, POOLS };
