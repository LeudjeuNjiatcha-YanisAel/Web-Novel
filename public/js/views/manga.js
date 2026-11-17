// OptiManga — fiche manga : infos, actions, chapitres, export CBZ

// Importe le client d'API pour dialoguer avec le serveur.
import { api } from "../api.js";
// Importe la navigation entre vues.
import { navigate } from "../router.js";
// Importe la fabrique d'icônes SVG.
import { icon } from "../icons.js";
// Importe des utilitaires d'interface variés.
import { escapeHtml, heroImage, ratingBadge, statusInfo, toast, emptyState, modal, formatCount, coverAccent } from "../ui.js";
// Importe les fonctions d'état liées aux favoris et à la progression.
import { isFavorite, toggleFavorite, getProgress, isChapterRead, readRatio } from "../state.js";

// Fonction de rendu de la fiche manga.
export async function renderManga({ params, viewRoot, signal }) {
  // Récupère les identifiants de source et de manga depuis l'URL.
  const [sourceId, mangaId] = params;
  if (signal?.aborted) return;

  // Affiche un écran de chargement (gabarit multiligne, non commenté à l'intérieur).
  viewRoot.innerHTML = `
    <button class="back-link" data-back>${icon("arrowLeft", 15)} Catalogue</button>
    <div id="manga-loading">${"<div class='skeleton' style='height:340px;border-radius:22px'></div>"}</div>
  `;

  // Bouton retour vers le catalogue.
  viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate("/catalogue"));

  // Variable destinée à contenir les données du manga.
  let manga;
  // Bloc protégé pour le chargement des données.
  try {
    // Demande la fiche manga au serveur.
    manga = await api.manga(sourceId, mangaId, { signal });
  // Gestion d'une fiche introuvable ou en erreur.
  } catch (err) {
    if (signal?.aborted) return;
    // Remplace le chargement par un état vide explicatif.
    viewRoot.querySelector("#manga-loading").outerHTML = emptyState({
      // Icône d'information.
      iconName: "info",
      // Titre de l'état vide.
      title: "Manga introuvable",
      // Message d'erreur ou texte par défaut.
      text: err.message || "Cette fiche n'existe pas ou l'extension est désactivée.",
    });
    // Stoppe le rendu.
    return;
  }

  // Indique s'il s'agit d'un anime.
  const isAnime = manga.mediaType === "anime";
  // Unité plurielle adaptée au type de média.
  const unit = isAnime ? "épisodes" : "chapitres";
  // Unité au singulier adaptée au type de média.
  const unitOne = isAnime ? "épisode" : "chapitre";
  // Nombre de chapitres hébergés (non externes).
  const hostedCount = (manga.chapters || []).filter((c) => !c.externalUrl).length;
  // Nombre de chapitres externes (hébergés chez l'éditeur).
  const externalCount = (manga.chapters || []).length - hostedCount;

  if (signal?.aborted) return;

  // Injecte le gabarit principal de la fiche (multiligne).
  viewRoot.innerHTML = `
    <button class="back-link" data-back>${icon("arrowLeft", 15)} Catalogue</button>
    <div class="novel-hero">
      <div class="book book-hero" style="${coverAccent(manga)}"><div class="book-front novel-hero-cover">${heroImage(manga, manga.title)}</div><i class="book-pages" aria-hidden="true"></i></div>
      <div class="novel-hero-info">
        <span class="source-pill">${icon("puzzle", 12)} ${escapeHtml(manga.sourceName)}</span>
        <h1>${escapeHtml(manga.title)}</h1>
        <p class="author">par ${escapeHtml(manga.author)}</p>
        <div class="badges">
          ${badge(manga.genre, "genre", icon("sparkle", 13))}
          ${badge(statusInfo(manga.status).label, statusInfo(manga.status).cls)}
          ${badge(statusInfo(manga.status).label ? manga.year || "" : manga.year || "", "")}
          ${ratingBadge(manga.rating) ? `<span class="badge">${ratingBadge(manga.rating)}</span>` : ""}
          ${manga.popularity ? `<span class="badge">${icon("heart", 13)} ${formatCount(manga.popularity)} suivis</span>` : ""}
          <span class="badge">${icon(isAnime ? "play" : "library", 13)} ${manga.chapters?.length || 0} ${unit}</span>
        </div>
        ${manga.tags?.length ? `<div class="tags">${manga.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        <p class="novel-description">${escapeHtml(manga.description || "Aucune description disponible.")}</p>
        <div class="novel-actions">
          <button id="read-cta" class="btn btn-primary">${icon(isAnime ? "play" : "bookOpen", 17)} <span id="read-cta-label"></span></button>
          <button id="fav-cta" class="btn">${icon("heart", 16)} <span id="fav-label"></span></button>
          ${isAnime ? "" : `<button id="export-cta" class="btn">${icon("download", 16)} CBZ</button>`}
        </div>
        <div class="read-progress-box">
          <div class="read-progress-label"><span>Progression</span><strong id="ratio-label"></strong></div>
          <div class="bar"><i id="ratio-bar" style="width:0%"></i></div>
        </div>
      </div>
    </div>

    <section class="chapter-panel">
      <div class="chapter-panel-head">
        <h2>${isAnime ? "Épisodes" : "Chapitres"}</h2>
        <span class="count">${manga.chapters.length}</span>
        <div class="chapter-search">
          ${icon("search", 15)}
          <input id="chapter-filter" class="field" type="search" placeholder="Filtrer…" />
        </div>
      </div>
      ${externalCount ? `<p class="chapter-note">${externalCount} ${unitOne}(s) ${isAnime ? "sont lus dans le lecteur intégré (aucune redirection)." : "ne sont pas hébergés et s'ouvrent sur le site de l'éditeur."}</p>` : ""}
      <div id="chapter-list" class="chapter-list"></div>
    </section>
  `;

  // Bouton retour (présent aussi dans le gabarit complet).
  viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate("/catalogue"));

  // ---- État local de la fiche
  // Calcule le ratio de lecture de la fiche.
  const ratio = readRatio(sourceId, mangaId, manga.chapters.length);
  // Récupère la progression enregistrée.
  const progress = getProgress(sourceId, mangaId);
  // Construit l'ensemble des chapitres déjà lus.
  const readSet = new Set(progress?.read || []);

  // Affiche le compteur de chapitres lus / total.
  viewRoot.querySelector("#ratio-label").textContent =
    `${readSet.size} / ${manga.chapters.length} ${unit}`;
  // Affiche la barre de progression en pourcentage.
  viewRoot.querySelector("#ratio-bar").style.width = `${Math.round(ratio * 100)}%`;

  // ---- Boutons d'action
  // Dernier chapitre lu (le cas échéant).
  const lastRead = progress?.last;
  // Liste complète des chapitres (ou tableau vide).
  const chapters = manga.chapters || [];
  // Un chapitre « externe » reste lisible dans le lecteur intégré : on retombe
  // donc sur le premier chapitre disponible, hébergé ou incrusté.
  // Cherche le premier chapitre jouable (hébergé sinon le premier de la liste).
  const firstPlayable = chapters.find((c) => !c.externalUrl) || chapters[0];
  // Élément de libellé du bouton de lecture.
  const ctaLabel = viewRoot.querySelector("#read-cta-label");
  // Détermine la cible du bouton de lecture.
  const ctaTarget = lastRead?.chapterId
    // Si un dernier chapitre existe, on le retrouve sinon on prend le premier jouable.
    ? chapters.find((c) => c.id === lastRead.chapterId) || firstPlayable
    // Sinon, on prend le premier chapitre jouable.
    : firstPlayable;
  // Si aucun chapitre n'est disponible…
  if (!firstPlayable) {
    // …affiche un libellé d'indisponibilité.
    ctaLabel.textContent = `Aucun ${unitOne} disponible`;
    // Désactive le bouton de lecture.
    viewRoot.querySelector("#read-cta").disabled = true;
  // Sinon, s'il y a une lecture en cours à reprendre…
  } else if (lastRead && lastRead.chapterId && ctaTarget) {
    // …affiche « Continuer » avec le numéro du chapitre.
    ctaLabel.textContent = `Continuer · ${isAnime ? "Épisode" : "Chapitre"} ${ctaTarget.order ?? ""}`.trim();
  // Sinon (première lecture)…
  } else {
    // …affiche le libellé de démarrage.
    ctaLabel.textContent = isAnime ? "Lancer le premier épisode" : "Commencer la lecture";
  }

  // Bouton de lecture : navigue vers le chapitre cible.
  viewRoot.querySelector("#read-cta").addEventListener("click", () => {
    // Navigue vers le lecteur si une cible existe.
    if (ctaTarget) navigate(`/read/${sourceId}/${mangaId}/${ctaTarget.id}`);
  });

  // Met à jour l'état visuel des favoris.
  updateFavState();
  // Fonction de mise à jour de l'état du favori.
  function updateFavState() {
    // Vérifie si le manga est en favori.
    const fav = isFavorite(sourceId, mangaId);
    // Récupère le bouton favori.
    const btn = viewRoot.querySelector("#fav-cta");
    // Récupère le libellé du bouton favori.
    const label = viewRoot.querySelector("#fav-label");
    // Applique la classe principale si favori.
    btn.classList.toggle("btn-primary", fav);
    // Colore l'icône selon l'état favori.
    btn.querySelector("svg").style.color = fav ? "var(--accent-ink)" : "var(--rose)";
    // Met à jour le texte du bouton.
    label.textContent = fav ? "Dans les favoris" : "Ajouter aux favoris";
  }

  // Bouton favori : bascule l'état au clic.
  viewRoot.querySelector("#fav-cta").addEventListener("click", () => {
    // Bascule le favori et récupère le résultat.
    const res = toggleFavorite(manga);
    // Affiche une notification selon l'action.
    toast(res.added ? "Ajouté aux favoris" : "Retiré des favoris");
    // Rafraîchit l'apparence du bouton.
    updateFavState();
  });

  // Bouton d'export CBZ (absent pour les animes) : ouvre la modale.
  viewRoot.querySelector("#export-cta")?.addEventListener("click", () => openCbzModal(manga));

  // ---- Chapitres
  // Affiche d'abord tous les chapitres.
  renderChapters("");
  // Récupère le champ de filtrage des chapitres.
  const filterInput = viewRoot.querySelector("#chapter-filter");
  // Re-filtre la liste à chaque saisie.
  filterInput.addEventListener("input", () => renderChapters(filterInput.value.trim()));

  // Construit la liste des chapitres selon un filtre.
  function renderChapters(filter) {
    // Récupère le conteneur de la liste.
    const list = viewRoot.querySelector("#chapter-list");
    // Normalise le filtre en minuscules.
    const q = filter.toLowerCase();
    // Filtre les chapitres par titre ou par numéro d'ordre.
    const filtered = manga.chapters.filter((c) =>
      // Garde tout si le filtre est vide, sinon correspondance titre ou ordre.
      !q || c.title?.toLowerCase().includes(q) || `${c.order}` === q
    );

    // Si aucun chapitre ne correspond…
    if (!filtered.length) {
      // …affiche un état vide.
      list.innerHTML = emptyState({ iconName: "search", title: `Aucun ${unitOne}`, text: `Aucun ${unitOne} ne correspond à ce filtre.` });
      // Stoppe la fonction.
      return;
    }

    // Génère les lignes de chapitres.
    list.innerHTML = filtered
      // Transforme chaque chapitre en ligne HTML.
      .map((c) => {
        // Indique si le chapitre a été lu.
        const read = readSet.has(c.id);
        // Indique si c'est le chapitre à reprendre.
        const isContinue = lastRead && lastRead.chapterId === c.id;
        // Renvoie le gabarit d'une ligne (multiligne, non commenté à l'intérieur).
        return `
        <button class="chapter-row ${read ? "read" : ""} ${isContinue ? "continue-here" : ""}" data-cid="${escapeHtml(c.id)}"
          ${c.externalUrl ? `data-external="${escapeHtml(c.externalUrl)}"` : ""}>
          <span class="chapter-num">${String(c.order ?? "").padStart(2, "0")}</span>
          <h4>${escapeHtml(c.title || `${isAnime ? "Épisode" : "Chapitre"} ${c.order}`)}</h4>
          ${c.group ? `<span class="chapter-group">${escapeHtml(c.group)}</span>` : ""}
          ${c.externalUrl
            ? `<span class="external-chip">${icon("external", 12)} ${isAnime ? "Streaming" : "Éditeur"}</span>`
            : read
              ? `<span class="read-mark">${icon("check", 12)} ${isAnime ? "Vu" : "Lu"}</span>`
              : isContinue
                ? `<span class="read-mark" style="color:var(--accent)">En cours</span>`
                : ""}
          <span class="chevron">${icon("chevronRight", 15)}</span>
        </button>`;
      })
      // Concatène les lignes en une chaîne.
      .join("");

    // Pour chaque ligne de chapitre, attache le clic.
    list.querySelectorAll(".chapter-row").forEach((row) => {
      // Navigue vers le lecteur au clic.
      row.addEventListener("click", () => {
        // Les épisodes/chapitres déportés sont désormais lus dans le lecteur
        // intégré (incrustation) plutôt que d'ouvrir un nouvel onglet.
        navigate(`/read/${sourceId}/${mangaId}/${row.dataset.cid}`);
      });
    });
  }
}

// Construit un badge HTML si un libellé est fourni.
function badge(label, cls = "", prepend = "") {
  // Renvoie une chaîne vide si aucun libellé.
  if (!label) return "";
  // Renvoie le badge avec classes et contenu échappés.
  return `<span class="badge ${escapeHtml(cls)}">${prepend}${escapeHtml(label)}</span>`;
}

// ---- Export CBZ -----------------------------------------------------------

// Ouvre la modale d'export CBZ pour un manga donné.
export function openCbzModal(manga) {
  // Liste des numéros d'ordre valides.
  const orders = (manga.chapters || []).map((c) => c.order).filter((o) => Number.isFinite(o));
  // Borne inférieure de la plage d'export.
  const minOrder = orders.length ? Math.floor(Math.min(...orders)) : 1;
  // Borne supérieure de la plage d'export.
  const maxOrder = orders.length ? Math.ceil(Math.max(...orders)) : 1;

  // Construit le corps HTML de la modale (multiligne).
  const body = `
    <div class="modal-inputs">
      <div>
        <div class="input-label">Plage de chapitres (ordres)</div>
        <div style="display:flex;gap:10px;align-items:center">
          <input id="exp-from" class="field" type="number" min="${minOrder}" max="${maxOrder}" value="${minOrder}" style="width:90px;text-align:center" />
          <span>→</span>
          <input id="exp-to" class="field" type="number" min="${minOrder}" max="${maxOrder}" value="${maxOrder}" style="width:90px;text-align:center" />
          <span class="count" style="font-size:.72rem;color:var(--text-3);font-family:var(--font-mono)">/ ${manga.chapters ? manga.chapters.length : maxOrder} vol.</span>
        </div>
      </div>
    </div>
    <div class="export-progress" id="exp-progress" style="display:none">
      <div class="bar"><i id="exp-bar" style="width:0%"></i></div>
      <div class="export-state"><span id="exp-message">Préparation…</span><span id="exp-pct">0 %</span></div>
    </div>
    <div id="exp-result" style="display:none;text-align:center;padding:6px 0">
      <p style="color:var(--text);font-weight:600;margin-bottom:14px">CBZ prêt !</p>
      <a id="exp-download" class="btn btn-primary" download>${icon("download", 16)} Télécharger le fichier</a>
    </div>
  `;

  // Ouvre la modale et récupère son objet de contrôle.
  const m = modal({
    // Titre de la modale.
    title: `Exporter « ${manga.title} »`,
    // Texte explicatif de la modale.
    text: `Le fichier CBZ (compatible Tachiyomi/Mihon) est généré côté serveur puis ajouté à ta bibliothèque hors-ligne. Les chapitres abrités chez l'éditeur sont ignorés.`,
    // Corps de la modale.
    body,
    // Actions disponibles (bouton de génération).
    actions: [{ label: "Générer le CBZ", type: "primary", onClick: ({ close }) => startExport(close) }],
  });

  // Met à jour la barre et le texte de progression.
  function setProgress(pct, msg) {
    // Récupère la barre de progression.
    const bar = document.getElementById("exp-bar");
    // Récupère l'élément du pourcentage.
    const pctEl = document.getElementById("exp-pct");
    // Récupère l'élément du message.
    const msgEl = document.getElementById("exp-message");
    // Met à jour la largeur de la barre si présente.
    if (bar) bar.style.width = `${pct}%`;
    // Met à jour le pourcentage si présent.
    if (pctEl) pctEl.textContent = `${pct} %`;
    // Met à jour le message si présent.
    if (msgEl) msgEl.textContent = msg;
  }

  // Lance l'export CBZ côté serveur.
  async function startExport(close) {
    // Lit et borne le numéro de début saisi.
    const from = Math.max(minOrder, Math.min(maxOrder, parseInt(document.getElementById("exp-from").value, 10) || minOrder));
    // Lit et borne le numéro de fin saisi.
    const to = Math.max(minOrder, Math.min(maxOrder, parseInt(document.getElementById("exp-to").value, 10) || maxOrder));
    // Vérifie la cohérence de la plage.
    if (from > to) {
      // Signale la plage invalide.
      toast("Plage invalide : le départ doit précéder la fin.", "error");
      // Annule l'export.
      return false;
    }

    // Récupère le conteneur de progression.
    const progress = document.getElementById("exp-progress");
    // Affiche la zone de progression.
    if (progress) progress.style.display = "";
    // Initialise la progression.
    setProgress(2, "Création de la tâche…");

    // Identifiant de la tâche d'export.
    let jobId;
    // Bloc protégé pour la création de la tâche.
    try {
      // Demande la création de la tâche d'export.
      const res = await api.downloadCbz(manga.sourceId, manga.id, from, to);
      // Récupère l'identifiant de la tâche.
      jobId = res.jobId;
    // Gestion des erreurs de création.
    } catch (err) {
      // Cache la zone de progression.
      if (progress) progress.style.display = "none";
      // Signale l'échec.
      toast(err.message || "Échec de l'export.", "error");
      // Annule l'export.
      return false;
    }

    // Renvoie une promesse qui suit la tâche jusqu'à la fin.
    return new Promise(() => {
      // Fonction de sondage périodique de l'état de la tâche.
      const poll = async () => {
        // Variable destinée à l'état de la tâche.
        let job;
        // Bloc protégé pour l'interrogation.
        try {
          // Récupère l'état de la tâche.
          job = await api.job(jobId);
        // Gestion d'une perte de connexion.
        } catch {
          // Signale la perte de connexion.
          toast("Perte de connexion avec la tâche d'export.", "error");
          // Stoppe le sondage.
          return;
        }
        // Calcule le pourcentage d'avancement.
        const pct = job.total ? Math.round((job.progress / job.total) * 100) : 0;
        // Met à jour la progression affichée.
        setProgress(pct, job.message || "");

        // Si la tâche est terminée…
        if (job.status === "done") {
          // Récupère le résultat de la tâche.
          const result = job.result;
          // Affiche 100 %.
          setProgress(100, "Terminé");
          // Récupère la zone de progression.
          const progress = document.getElementById("exp-progress");
          // Cache la zone de progression.
          if (progress) progress.style.display = "none";
          // Récupère la zone de résultat.
          const resultEl = document.getElementById("exp-result");
          // Si la zone de résultat existe…
          if (resultEl) {
            // …l'affiche.
            resultEl.style.display = "";
            // Renseigne le lien de téléchargement.
            document.getElementById("exp-download").href = result.url;
          }
          // Affiche un résumé de l'export (chapitres ignorés inclus).
          toast(skipLabel(result));
          // Stoppe le sondage.
          return;
        }
        // Si la tâche a échoué…
        if (job.status === "error") {
          // …signale l'échec.
          toast(job.message || "L'export a échoué.", "error");
          // Cache la zone de progression.
          if (progress) progress.style.display = "none";
          // Stoppe le sondage.
          return;
        }
        // Sinon, replanifie un sondage plus tard.
        setTimeout(poll, 420);
      };
      // Lance le premier sondage.
      poll();
    });
  }

  // Construit le message de résultat (avec les chapitres ignorés).
  function skipLabel(result) {
    // Message spécifique si des chapitres externes ont été ignorés.
    if (result.skipped) return `CBZ généré (${result.chapterCount} chapitre(s), ${result.skipped} externe(s) ignoré(s)).`;
    // Message standard sinon.
    return `CBZ généré (${result.chapterCount} chapitre(s)) et ajouté à la bibliothèque.`;
  }

  // Renvoie l'objet de contrôle de la modale.
  return m;
}
