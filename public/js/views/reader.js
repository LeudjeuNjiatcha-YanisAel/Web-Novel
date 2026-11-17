// OptiManga — lecteur manga (pages en images) : modes paginé & bande, TOC, clavier

// Client HTTP de l'application (fiche manga + détail d'un chapitre).
import { api } from "../api.js";
// Navigation SPA : change l'URL sans recharger la page.
import { navigate } from "../router.js";
// Générateur de balises SVG pour les icônes de l'interface.
import { icon } from "../icons.js";
// Utilitaires d'interface : échappement HTML et notifications.
import { escapeHtml, toast } from "../ui.js";
// État persistant : préférences, progression, historique, favoris.
import { getPrefs, savePrefs, markChapterRead, pushHistory, saveReadingPosition, isChapterRead, getProgress } from "../state.js";

// Point d'entrée de la vue lecteur, monté par le routeur.
export async function renderReader({ params, viewRoot, signal }) {
  // L'URL /read/:sourceId/:mangaId/:chapterId fournit ces trois segments.
  const [sourceId, mangaId, chapterId] = params;
  if (signal?.aborted) return;
  // Préférences globales de l'utilisateur.
  const prefs = getPrefs();
  // Sous-ensemble « lecteur » : mode d'affichage, qualité, contraste.
  const readerPrefs = prefs.reader;

  // Squelette de l'écran : barre supérieure, scène centrale, tiroir des chapitres, réglages.
  viewRoot.innerHTML = `
    <div class="reader-screen" data-theme="${escapeHtml(readerPrefs.contrast || "dark")}">
      <header class="reader-top" id="rd-top">
        <button class="tool-btn" data-back title="Retour">${icon("arrowLeft", 18)}</button>
        <div class="rt-title">
          <h2 id="rd-title">Chargement…</h2>
          <span id="rd-sub">Récupération du chapitre</span>
        </div>
        <div class="reader-tools">
          <button class="tool-btn" data-prev title="Chapitre précédent">${icon("arrowLeft", 17)}</button>
          <button class="tool-btn" data-next title="Chapitre suivant">${icon("arrowRight", 17)}</button>
          <button class="tool-btn" data-toc title="Table des matières">${icon("list", 18)}</button>
          <button class="tool-btn" data-settings title="Réglages">${icon("type", 18)}</button>
        </div>
        <div class="reader-top-progress"><i id="rd-progress"></i></div>
      </header>

      <div class="reader-stage" id="rd-stage"></div>

      <div class="toc-drawer-overlay" data-toc-close></div>
      <aside class="toc-drawer" id="rd-toc" aria-label="Chapitres">
        <div class="toc-head"><h3>Chapitres</h3><button class="btn btn-sm btn-ghost" data-toc-close>${icon("close", 15)}</button></div>
        <div class="toc-list" id="rd-toc-list"></div>
      </aside>

      <div class="settings-pop" id="rd-settings"></div>
    </div>
  `;

  // Racine de l'écran lecteur (porte le thème de contraste).
  const screen = viewRoot.querySelector(".reader-screen");
  // Zone centrale où l'on injecte pages, bande ou lecteur vidéo.
  const stage = viewRoot.querySelector("#rd-stage");
  // Barre de progression fine sous la barre supérieure.
  const progressEl = viewRoot.querySelector("#rd-progress");
  // Barre supérieure (masquée automatiquement en mode bande).
  const topbar = viewRoot.querySelector("#rd-top");
  // Tiroir latéral listant les chapitres.
  const tocDrawer = viewRoot.querySelector("#rd-toc");
  // Panneau flottant des réglages (mode, qualité, fond).
  const settingsPop = viewRoot.querySelector("#rd-settings");
  // Titre affiché dans la barre supérieure.
  const titleEl = viewRoot.querySelector("#rd-title");
  // Sous-titre (numéro de page, type de lecteur…).
  const subEl = viewRoot.querySelector("#rd-sub");

  // Fiche du manga courant (remplie par l'appel API).
  let manga = null;
  // Détail du chapitre courant (pages ou liens externes).
  let chapter = null;
  // Liste des fonctions de nettoyage à exécuter en quittant la vue.
  let cleanupFns = [];
  // Nettoyage propre à la scène installée (pages, bande, lecteur externe).
  let stageCleanup = null;
  // Évite de relancer plusieurs rafraîchissements en parallèle.
  let refreshing = false;
  // Limite les tentatives pour ne pas boucler si le serveur renvoie les mêmes URL.
  let refreshAttempts = 0;
  // Minuteur d'enregistrement de la position de lecture.
  let saveTimer = null;
  // À la sortie, on annule l'enregistrement différé en attente.
  cleanupFns.push(() => clearTimeout(saveTimer));
  cleanupFns.push(() => stageCleanup?.());

  // ---- Chargement (fiche + chapitre en parallèle)
  // Les deux appels sont indépendants : on les lance simultanément.
  try {
    [manga, chapter] = await Promise.all([
      api.manga(sourceId, mangaId, { signal }),
      api.chapter(sourceId, mangaId, chapterId, { signal }),
    ]);
  } catch (err) {
    // Échec d'un des deux appels : on affiche un écran d'indisponibilité.
    if (signal?.aborted) return;
    showUnavailable(err.message, "arrière");
    return { cleanup };
  }
  if (signal?.aborted) return;

  // Vrai si le chapitre n'a pas d'images hébergées mais un lien/lecteur externe.
  const isExternal = Boolean(chapter.externalUrl) || !chapter.pages?.length;
  // Nombre de pages hébergées (0 pour un épisode externe).
  const totalPages = (chapter.pages || []).length;
  // Position du chapitre courant dans la liste du manga.
  const idx = manga.chapters.findIndex((c) => c.id === chapterId);
  // Numéro d'ordre affiché (fourni par la source, sinon l'index + 1).
  const order = chapter.order ?? (idx >= 0 ? idx + 1 : 0);
  // Chapitres adjacents pour la navigation précédent/suivant.
  const { prevChap, nextChap } = neighbors(manga.chapters, chapterId);

  // Un manga de type « anime » se lit dans un lecteur intégré, pas en images.
  const isAnime = manga.mediaType === "anime";
  // Le mot « Épisode » remplace « Chapitre » pour les animés.
  const label = isAnime ? "Épisode" : "Chapitre";
  // Affiche le titre du manga.
  titleEl.textContent = manga.title;
  // Affiche un sous-titre adapté : externe (épisode) ou images (page X/Y).
  subEl.textContent = isExternal
    ? `${label} ${order ?? ""} · ${isAnime ? "lecteur intégré" : "éditeur externe"}`
    : `${label} ${order ?? ""} · ${totalPages} pages · ${escapeHtml(manga.sourceName)}`;

  // ---- Suivi de lecture
  // Les épisodes externes ne sont pas marqués « lus » (aucune page à parcourir),
  // mais ils alimentent quand même l'historique et la carte « Reprendre » avec leur couverture.
  if (!isExternal) markChapterRead(sourceId, mangaId, chapterId);
  pushHistory({
    sourceId,
    sourceName: manga.sourceName,
    mangaId,
    mangaTitle: manga.title,
    author: manga.author,
    cover: manga.cover,
    chapterId,
    chapterTitle: chapter.title || `${label} ${order}`,
    order,
  });

  // Câble les boutons de la barre supérieure (retour, préc./suiv., TOC, réglages).
  wireTopNav();

  // Un épisode externe s'affiche dans une iframe : chemin de rendu dédié.
  if (isExternal) {
    renderExternalEmbed();
    // On renvoie quand même un nettoyage pour libérer l'iframe et les minuteurs.
    return { cleanup };
  }

  // Chapitre en images : construction des réglages, du sommaire et des pages.
  buildSettings();
  renderToc();
  installStage(manga, chapter);

  // Objet rendu au routeur pour nettoyer la vue au démontage.
  return { cleanup };

  // ---- Helpers ------------------------------------------------------------

  // Exécute toutes les callbacks de nettoyage (minuteurs, écouteurs, iframe…).
  function cleanup() {
    for (const fn of cleanupFns) try { fn(); } catch { /* ignore */ }
  }

  // Retourne le chapitre précédent et le suivant autour de `cid`.
  function neighbors(list, cid) {
    // Chapitre situé juste avant le courant.
    let prev = null;
    // Chapitre situé juste après le courant.
    let next = null;
    // Passe à vrai dès qu'on a dépassé le chapitre courant.
    let seen = false;
    // Parcourt la liste dans l'ordre de lecture.
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      // Le chapitre courant est ignoré (il n'est ni « avant » ni « après »).
      if (c.id === cid) { seen = true; continue; }
      // Tous les chapitres naviguent dans le lecteur (les épisodes « externes »
      // y sont affichés en incrustation), donc on ne les ignore plus.
      // Tant qu'on n'a pas atteint le courant, on mémorise le dernier vu.
      if (!seen) prev = c;
      // Après le courant, le premier élément rencontré est le suivant.
      else if (!next) { next = c; break; }
    }
    // Renvoie les deux voisins (null si absent).
    return { prevChap: prev, nextChap: next };
  }

  // Navigue vers un autre chapitre du même manga.
  function goChapter(c) {
    // Rien à faire si le chapitre est absent.
    if (!c) return;
    // Change l'URL : le routeur remontera la vue lecteur pour ce chapitre.
    navigate(`/read/${sourceId}/${mangaId}/${c.id}`);
  }

  // Ouvre le tiroir latéral des chapitres.
  function openToc() {
    tocDrawer.classList.add("open");
    // Affiche aussi le voile cliquable qui assombrit le fond.
    viewRoot.querySelector(".toc-drawer-overlay").classList.add("open");
  }
  // Ferme le tiroir latéral des chapitres.
  function closeToc() {
    tocDrawer.classList.remove("open");
    // Retire le voile associé.
    viewRoot.querySelector(".toc-drawer-overlay").classList.remove("open");
  }

  // Relie les contrôles de la barre supérieure aux actions correspondantes.
  function wireTopNav() {
    // Bouton retour : revient sur la fiche du manga.
    viewRoot.querySelector("[data-back]").addEventListener("click", () => navigate(`/manga/${sourceId}/${mangaId}`));
    // Bouton « chapitre précédent » : uniquement si un voisin existe.
    if (prevChap) viewRoot.querySelector("[data-prev]").addEventListener("click", () => goChapter(prevChap));
    // Bouton « chapitre suivant » : uniquement si un voisin existe.
    if (nextChap) viewRoot.querySelector("[data-next]").addEventListener("click", () => goChapter(nextChap));
    // Bouton TOC : ouvre le tiroir s'il est fermé, le ferme sinon.
    viewRoot.querySelector("[data-toc]").addEventListener("click", () =>
      tocDrawer.classList.contains("open") ? closeToc() : openToc()
    );
    // Tous les éléments marqués [data-toc-close] ferment le tiroir.
    viewRoot.querySelectorAll("[data-toc-close]").forEach((b) => b.addEventListener("click", closeToc));
    // Bouton réglages : bascule le panneau flottant.
    if (settingsPop) viewRoot.querySelector("[data-settings]").addEventListener("click", () => {
      settingsPop.classList.toggle("open");
    });
  }

  // Remplace l'écran par un message d'erreur (chapitre introuvable, serveur muet…).
  function showUnavailable(message, where) {
    if (signal?.aborted) return;
    viewRoot.innerHTML = `
      <div class="reader-screen" data-theme="dark">
        <header class="reader-top">
          <button class="tool-btn" data-back title="Retour">${icon("arrowLeft", 18)}</button>
          <div class="rt-title"><h2>Chapitre indisponible</h2></div>
        </header>
        <div class="reader-stage" style="display:grid;place-items:center;padding:40px;text-align:center;color:var(--reader-text-2)">
          <div>${icon("info", 40)}<p style="margin-top:12px">${escapeHtml(message || "Le serveur n'a pas répondu.")}</p></div>
        </div>
      </div>`;
    // Le bouton retour renvoie vers la fiche ou le catalogue selon l'origine.
    viewRoot.querySelector("[data-back]").addEventListener("click", () => {
      if (where === "fiche") navigate(`/manga/${sourceId}/${mangaId}`);
      else navigate("/catalogue");
    });
  }

  // ---- Lecteur vidéo « cinéma » pour les épisodes externes (animés)
  function renderExternalEmbed() {
    // Lecteurs proposés par l'extension, sinon repli sur l'unique lien externe.
    const players = Array.isArray(chapter.players) && chapter.players.length
      ? chapter.players
      : (chapter.externalUrl ? [{ label: "Lecteur", url: chapter.externalUrl }] : []);

    // Aucune source exploitable : on affiche un état vide soigné.
    if (!players.length) {
      stage.innerHTML = `
        <div class="external-screen">
          ${icon("play", 44)}
          <h3>Aucun lecteur disponible</h3>
          <p>Cet épisode n'a pas de source de lecture exploitable pour le moment.</p>
        </div>`;
      // Le sommaire reste accessible pour changer d'épisode.
      renderToc();
      return;
    }

    // Active l'ambiance « cinéma » propre à la vue vidéo (halos animés).
    stage.classList.add("ext-view");

    // Index du lecteur actuellement affiché.
    let active = 0;

    // Barre de sélection des sources : affichée seulement s'il y en a plusieurs.
    const switcher = players.length > 1
      ? `<div class="external-player-switch" role="tablist" aria-label="Choix du lecteur">
          <span class="eps-label">${icon("shuffle", 13)} Sources</span>
          ${players
            .map(
              (p, i) =>
                `<button type="button" class="player-chip ${i === 0 ? "active" : ""}" data-player-idx="${i}" data-player-url="${escapeHtml(p.url)}" role="tab" style="--i:${i}">${icon("play", 12)}${escapeHtml(p.label)}</button>`
            )
            .join("")}
        </div>`
      : "";

    // Structure du lecteur : barre d'outils, sources, scène 16:9, pied d'aide.
    stage.innerHTML = `
      <div class="ext-cinema">
        <div class="external-frame" id="ext-frame">
          <div class="external-frame-bar">
            <span class="external-frame-chip">${icon("external", 13)} ${isAnime ? "Lecteur intégré · VF / VOSTFR" : "Site officiel de l'éditeur"}</span>
            <div class="external-frame-actions">
              <button type="button" class="tool-btn tool-btn-xs" data-reload title="Recharger le lecteur">${icon("refresh", 15)}</button>
              <button type="button" class="tool-btn tool-btn-xs" data-fullscreen title="Plein écran">${icon("maximize", 15)}</button>
              <a class="btn btn-sm" href="${escapeHtml(players[0].url)}" target="_blank" rel="noopener">${icon("external", 14)} Nouvel onglet</a>
            </div>
          </div>
          ${switcher}
          <div class="ext-stage">
            <div class="ext-glow" aria-hidden="true"></div>
            <div class="external-loading" id="ext-loading">
              <span class="external-spinner"></span>
              <span class="ext-loading-text">Connexion au lecteur<i class="ext-dots"><b></b><b></b><b></b></i></span>
              <span class="ext-autobar" aria-hidden="true"><i id="ext-autofill"></i></span>
            </div>
            <iframe id="ext-iframe" src="${escapeHtml(players[0].url)}" title="${escapeHtml(chapter.title || `${label} ${order}`)}" allow="fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>
          </div>
          <p class="external-foot">${icon("info", 13)} ${players.length > 1 ? "Certains lecteurs démarrent après un clic sur ▶. Si l'un reste vide, choisissez une autre source ci-dessus." : "Si la page reste vide, lancez la lecture (▶) ou ouvrez-la dans un nouvel onglet."}</p>
        </div>
      </div>`;

    // Références des éléments pilotés par le script.
    const loading = stage.querySelector("#ext-loading");
    const iframe = stage.querySelector("#ext-iframe");
    const frame = stage.querySelector("#ext-frame");
    // Remplissage de la barre de repli automatique.
    const autofill = stage.querySelector("#ext-autofill");
    // Bouton plein écran (icône permutée selon l'état).
    const fsBtn = stage.querySelector("[data-fullscreen]");
    // Minuteur de bascule automatique vers un autre lecteur.
    let fallbackTimer = null;
    // À la sortie, on annule ce minuteur.
    cleanupFns.push(() => clearTimeout(fallbackTimer));

    // Marque visuellement la puce de source active.
    function selectChip(idx) {
      stage.querySelectorAll("[data-player-idx]").forEach((b) =>
        b.classList.toggle("active", Number(b.dataset.playerIdx) === idx)
      );
    }

    // Charge (ou recharge) le lecteur d'index `idx`, avec message facultatif.
    function loadPlayer(idx, message) {
      active = idx;
      selectChip(idx);
      // Sans iframe (cas dégénéré), on s'arrête là.
      if (!iframe) return;
      // Réaffiche le voile de chargement et masque l'iframe le temps de la connexion.
      if (loading) loading.classList.remove("done");
      iframe.classList.remove("loaded");
      // Pointe l'iframe sur la nouvelle source.
      iframe.src = players[idx].url;
      // Le lien « nouvel onglet » suit toujours la source active.
      const openLink = stage.querySelector('a[target="_blank"]');
      if (openLink) openLink.href = players[idx].url;
      // Notifie l'utilisateur lors d'une bascule automatique.
      if (message) toast(message, "info");
      // Relance la barre de repli et son minuteur.
      startAutoBar();
      startFallbackTimer();
    }

    // Anime la fine barre de repli : 0 → 100 % en 12 s (durée avant bascule).
    function startAutoBar() {
      if (!autofill) return;
      // Repart de zéro sans transition, puis remplit linéairement.
      autofill.style.transition = "none";
      autofill.style.width = "0%";
      requestAnimationFrame(() => {
        autofill.style.transition = "width 12s linear";
        autofill.style.width = "100%";
      });
    }

    // Repli automatique : si un lecteur reste vide 12 s, on tente le suivant.
    function startFallbackTimer() {
      clearTimeout(fallbackTimer);
      // Inutile de basculer s'il n'y a qu'une seule source.
      if (players.length <= 1) return;
      fallbackTimer = setTimeout(() => {
        // Toujours pas chargé après le délai : on passe au lecteur suivant en boucle.
        if (iframe && !iframe.classList.contains("loaded")) {
          const nextIdx = (active + 1) % players.length;
          loadPlayer(nextIdx, `Lecteur lent · passage à ${players[nextIdx].label}`);
        }
      }, 12000);
    }

    // Appelé quand l'iframe a fini de charger : masque le voile et fige la barre.
    const done = () => {
      clearTimeout(fallbackTimer);
      if (loading) loading.classList.add("done");
      if (iframe) iframe.classList.add("loaded");
      if (autofill) autofill.style.width = "100%";
    };
    iframe.addEventListener("load", done);
    // En cas d'erreur de chargement, on bascule sur la source suivante.
    iframe.addEventListener("error", () => {
      // Une seule source : rien vers quoi basculer.
      if (players.length > 1) {
        const nextIdx = (active + 1) % players.length;
        loadPlayer(nextIdx, `Lecteur indisponible · passage à ${players[nextIdx].label}`);
      }
    });

    // Bouton « recharger » : relance la source active avec une rotation d'icône.
    stage.querySelector("[data-reload]")?.addEventListener("click", (e) => {
      const b = e.currentTarget;
      // Réinitialise l'animation CSS pour qu'elle rejoue à chaque clic.
      b.classList.remove("spinning");
      void b.offsetWidth;
      b.classList.add("spinning");
      loadPlayer(active);
    });

    // Synchronise l'icône du bouton plein écran avec l'état réel du navigateur.
    function syncFsIcon() {
      if (!fsBtn) return;
      const on = document.fullscreenElement === frame;
      fsBtn.innerHTML = icon(on ? "minimize" : "maximize", 15);
      fsBtn.title = on ? "Quitter le plein écran" : "Plein écran";
    }
    // Bascule le plein écran sur le cadre (impossible directement sur une iframe cross-origin).
    fsBtn?.addEventListener("click", () => {
      if (document.fullscreenElement === frame) document.exitFullscreen?.();
      else frame?.requestFullscreen?.().catch(() => {});
    });
    // L'événement fullscreenchange suit les sorties via Échap.
    document.addEventListener("fullscreenchange", syncFsIcon);
    cleanupFns.push(() => document.removeEventListener("fullscreenchange", syncFsIcon));

    // Sélection manuelle d'une source dans la barre de lecteurs.
    stage.querySelectorAll("[data-player-idx]").forEach((btn) => {
      btn.addEventListener("click", () => loadPlayer(Number(btn.dataset.playerIdx)));
    });

    // Démarre immédiatement la barre de repli et son minuteur.
    startAutoBar();
    startFallbackTimer();
    // En quittant la vue : retire l'ambiance cinéma et détruit l'iframe (stoppe la lecture).
    cleanupFns.push(() => {
      stage.classList.remove("ext-view");
      if (iframe) iframe.remove();
    });
    // Construit le sommaire des chapitres dans le tiroir latéral.
    renderToc();
  }

  // ---- Table des matières (tiroir latéral)
  // Construit la liste des chapitres, avec filtre textuel optionnel.
  function renderToc(filter = "") {
    // Conteneur de la liste dans le tiroir.
    const tocList = viewRoot.querySelector("#rd-toc-list");
    // Filtre normalisé en minuscules.
    const q = filter.toLowerCase();
    // Une ligne de chapitre pour chaque entrée correspondant au filtre.
    const rows = manga.chapters
      .filter((c) => !q || c.title?.toLowerCase().includes(q))
      .map((c) => {
        // Vrai s'il s'agit du chapitre actuellement ouvert.
        const active = c.id === chapterId;
        // Vrai si ce chapitre a déjà été lu (coche verte).
        const isRead = isChapterRead(sourceId, mangaId, c.id);
        return `<button class="toc-item ${active ? "active" : ""}" data-toc-chapter="${escapeHtml(c.id)}">
          <span class="n">${String(c.order ?? "").padStart(2, "0")}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title || `Chapitre ${c.order}`)}</span>
          ${c.externalUrl ? `<span class="toc-external">${icon("external", 13)}</span>` : isRead ? `<span style="color:var(--emerald)">${icon("check", 13)}</span>` : ""}
        </button>`;
      })
      .join("");
    // Affiche les lignes, ou un message si la liste est vide.
    tocList.innerHTML = rows || `<p style="padding:14px;color:var(--reader-text-2);font-size:.85rem">Aucun chapitre</p>`;
    // Chaque ligne navigue vers le chapitre correspondant.
    tocList.querySelectorAll("[data-toc-chapter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // On referme le tiroir avant de naviguer.
        closeToc();
        const target = btn.dataset.tocChapter;
        // Évite un rechargement inutile si on reclique le chapitre courant.
        if (target !== chapterId) navigate(`/read/${sourceId}/${mangaId}/${target}`);
      });
    });
  }

  // ---- Panneau de réglages (mode, qualité, fond)
  function buildSettings() {
    // Trois groupes de boutons segmentés reflétant les préférences actuelles.
    settingsPop.innerHTML = `
      <div class="setting-row">
        <div class="setting-label">Mode de lecture</div>
        <div class="seg" data-seg="mode">
          ${Object.entries({ paged: "Pages", strip: "Bande continue" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.mode === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Qualité des pages</div>
        <div class="seg" data-seg="quality">
          ${Object.entries({ full: "Haute", dataSaver: "Éco" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.quality === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Fond</div>
        <div class="seg" data-seg="contrast">
          ${Object.entries({ dark: "Sombre", sepia: "Sépia", light: "Clair" }).map(([k, v]) => `<button data-v="${k}" class="${readerPrefs.contrast === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
      </div>
    `;

    // Un écouteur de clic par groupe segmenté.
    settingsPop.querySelectorAll("[data-seg]").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        // Bouton réellement cliqué (ou aucun).
        const btn = e.target.closest("button[data-v]");
        if (!btn) return;
        // Désélectionne tous les boutons du groupe, puis active le clic.
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        // Enregistre le choix dans les préférences du lecteur.
        readerPrefs[seg.dataset.seg] = btn.dataset.v;
        // Le contraste s'applique immédiatement au thème de l'écran.
        if (seg.dataset.seg === "contrast") screen.dataset.theme = readerPrefs.contrast;
        // Persiste les préférences.
        savePrefs();
        // Mode ou qualité changés : on reconstruit l'affichage des pages.
        if (seg.dataset.seg !== "contrast" && typeof installStage === "function" && chapter) {
          installStage(manga, chapter);
        }
      });
    });
  }

  // ---- Affichage des pages ------------------------------------------------

  // Choisit la liste d'URL puis délègue au mode paginé ou bande.
  function installStage(mangaData, chapterData, restoreRatio) {
    if (stageCleanup) {
      stageCleanup();
      stageCleanup = null;
    }
    // Utilise les images « éco » si l'option dataSaver est active et disponible.
    const urls = readerPrefs.quality === "dataSaver" && chapterData.pagesLow?.length
      ? chapterData.pagesLow
      : chapterData.pages;
    // Dernière position de lecture enregistrée pour ce manga.
    const saved = getProgress(sourceId, mangaId)?.last;
    // Position de reprise exprimée en ratio (0→1), si elle concerne ce chapitre.
    const savedRatio =
      saved && saved.chapterId === chapterId
        ? readerPrefs.mode === "strip"
          ? saved.ratio
          : ((saved.page || 1) - 1) / Math.max(1, urls.length)
        : 0;
    const ratio = typeof restoreRatio === "number" ? restoreRatio : savedRatio;

    // Mode bande continue, ou mode paginé par défaut.
    stageCleanup = readerPrefs.mode === "strip" ? installStrip(urls, ratio) : installPaged(urls, ratio);
  }

  async function refreshPages(ratio) {
    if (refreshing || refreshAttempts >= 2 || signal?.aborted) return;
    refreshing = true;
    refreshAttempts += 1;
    try {
      const fresh = await api.chapter(sourceId, mangaId, chapterId, { signal, fresh: true });
      if (!fresh?.pages?.length || signal?.aborted) return;
      chapter = fresh;
      installStage(manga, chapter, ratio);
    } catch {
    } finally {
      refreshing = false;
    }
  }

  // --- Mode paginé : une page à la fois, zones de clic + clavier
  function installPaged(urls, savedRatio) {
    // Index de la page affichée, calculé depuis la position sauvegardée.
    let pageIdx = Math.max(0, Math.min(urls.length - 1, Math.round(savedRatio * (urls.length - 1))));

    // Structure : zones cliquables gauche/droite, figure centrale, pastille de page.
    stage.innerHTML = `
      <div class="reader-pages" id="rd-pages">
        <button class="clickzone z-left" data-pg="prev" aria-label="Page précédente"></button>
        <figure class="reader-page" id="rd-page">
          <img id="rd-img" alt="Page de manga" />
          <div class="reader-page-shine" aria-hidden="true"></div>
        </figure>
        <button class="clickzone z-right" data-pg="next" aria-label="Page suivante"></button>
        <div class="reader-page-pill" id="rd-page-pill" aria-live="polite"></div>
      </div>`;

    // Figure centrale contenant l'image.
    const pageEl = stage.querySelector("#rd-page");
    // L'image de la page courante.
    const img = stage.querySelector("#rd-img");
    // Pastille affichant « page courante / total ».
    const pill = stage.querySelector("#rd-page-pill");
    // Zones de clic bord gauche et bord droit.
    const prevZone = stage.querySelector(".z-left");
    const nextZone = stage.querySelector(".z-right");
    const preloadLinks = [];
    const preloadTimers = [];

    // Affiche la page d'index `i` et gère le préchargement de la suivante.
    function setPage(i, preload = true) {
      // Index hors bornes : on ne fait rien.
      if (i < 0 || i >= urls.length) return;
      pageIdx = i;
      // État visuel « en cours de chargement ».
      img.classList.remove("failed");
      img.classList.add("loading");
      delete img.dataset.retried;
      // Image prête : on révèle la page.
      img.onload = () => {
        img.classList.remove("loading", "failed");
        img.classList.add("loaded");
      };
      // Image en échec : on tente l'URL d'origine avant de signaler l'erreur.
      img.onerror = () => {
        const direct = directImageUrl(img.src);
        if (direct && direct !== img.src && !img.dataset.retried) {
          img.dataset.retried = "1";
          img.src = direct;
          return;
        }
        img.classList.remove("loading");
        img.classList.add("failed");
        img.alt = "Page indisponible";
        toast("Une page n'a pas pu être chargée.", "error");
        refreshPages(pageIdx / Math.max(1, urls.length - 1));
      };
      // Change la source de l'image.
      img.src = urls[i];
      img.alt = `Page ${i + 1}`;
      // Masque la zone « précédent » sur la première page.
      prevZone.style.visibility = i === 0 ? "hidden" : "";
      // Masque la zone « suivant » sur la dernière page.
      nextZone.style.visibility = i === urls.length - 1 ? "hidden" : "";
      // Met à jour la barre de progression globale.
      progressEl.style.width = `${((i + 1) / urls.length) * 100}%`;
      // Met à jour la pastille de page.
      if (pill) pill.textContent = `${i + 1} / ${urls.length}`;
      // Met à jour le sous-titre de la barre supérieure.
      subEl.textContent = `${label} ${order ?? ""} · Page ${i + 1} / ${urls.length}`;
      // Précharge discrètement la page suivante pour une navigation fluide.
      if (preload && i + 1 < urls.length) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = urls[i + 1];
        document.head.appendChild(link);
        preloadLinks.push(link);
        // Retire le <link> après usage pour ne pas polluer le <head>.
        preloadTimers.push(setTimeout(() => link.remove(), 3000));
      }
      // Programme l'enregistrement de la progression.
      scheduleSave();
    }

    // Enregistre la position de lecture, groupée pour limiter les écritures.
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveReadingPosition(sourceId, mangaId, {
          chapterId,
          chapterTitle: chapter.title || `Chapitre ${order}`,
          order,
          page: pageIdx + 1,
          ratio: pageIdx / Math.max(1, urls.length),
        });
      }, 500);
    }

    // Page suivante, ou chapitre suivant en fin de chapitre.
    function nextPage() {
      if (pageIdx < urls.length - 1) setPage(pageIdx + 1);
      else if (nextChap) goChapter(nextChap);
    }
    // Page précédente, ou chapitre précédent en début de chapitre.
    function prevPage() {
      if (pageIdx > 0) setPage(pageIdx - 1);
      else if (prevChap) goChapter(prevChap);
    }

    // Les zones latérales déclenchent la navigation.
    prevZone.addEventListener("click", prevPage);
    nextZone.addEventListener("click", nextPage);

    // Raccourcis clavier du mode paginé.
    const onKey = (e) => {
      // On ignore le clavier lorsque l'utilisateur tape dans un champ.
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Échap : ferme d'abord un panneau ouvert, sinon quitte le lecteur.
      if (e.key === "Escape") {
        if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
        if (tocDrawer.classList.contains("open")) return closeToc();
        navigate(`/manga/${sourceId}/${mangaId}`);
      } else if (e.key === "ArrowRight") nextPage();
      else if (e.key === "ArrowLeft") prevPage();
      // Touche « T » : bascule le tiroir des chapitres.
      else if (e.key.toLowerCase() === "t") tocDrawer.classList.contains("open") ? closeToc() : openToc();
    };
    window.addEventListener("keydown", onKey);

    // Affiche la page de reprise.
    setPage(pageIdx);

    return () => {
      window.removeEventListener("keydown", onKey);
      for (const timer of preloadTimers) clearTimeout(timer);
      for (const link of preloadLinks) link.remove();
    };
  }

  // --- Mode bande : toutes les pages empilées avec défilement
  function installStrip(urls, savedRatio) {
    // Empile toutes les pages en images (les 4 premières chargées d'emblée).
    stage.innerHTML = `
      <div class="reader-strip" id="rd-strip">
        ${urls.map((u, i) => `<img src="${escapeHtml(u)}" alt="Page ${i + 1}" loading="${i < 4 ? "eager" : "lazy"}" decoding="async" />`).join("")}
      </div>`;

    // Conteneur défilant contenant toutes les pages.
    const strip = stage.querySelector("#rd-strip");

    const onImgError = (e) => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement)) return;
      const direct = directImageUrl(target.src);
      if (direct && direct !== target.src && !target.dataset.retried) {
        target.dataset.retried = "1";
        target.src = direct;
        return;
      }
      target.classList.add("failed");
      target.alt = "Page indisponible";
      const max = strip.scrollHeight - strip.clientHeight;
      refreshPages(max > 0 ? strip.scrollTop / max : 0);
    };
    strip.addEventListener("error", onImgError, true);

    // Recalcule progression, sous-titre et sauvegarde depuis la position de défilement.
    function updateFromScroll() {
      // Course de défilement maximale.
      const max = strip.scrollHeight - strip.clientHeight;
      // Ratio de lecture (0 = haut, 1 = bas).
      const ratio = max > 0 ? strip.scrollTop / max : 1;
      // Barre de progression de la barre supérieure.
      progressEl.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
      // Estimation du nombre de pages parcourues (arrondi à la dizaine).
      const pageCount = Math.min(urls.length, Math.max(1, Math.round((ratio * urls.length) / 10) * 10) + 10);
      subEl.textContent = `${label} ${order ?? ""} · ~${Math.min(urls.length, pageCount)} / ${urls.length}`;
      // Sauvegarde différée de la position (évite d'écrire à chaque pixel).
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveReadingPosition(sourceId, mangaId, {
          chapterId,
          chapterTitle: chapter.title || `Chapitre ${order}`,
          order,
          page: Math.min(urls.length, Math.max(1, Math.round(ratio * urls.length))),
          ratio,
        });
      }, 600);
      // Met à jour l'affichage (masquage) de la barre supérieure.
      handleTopbarAutoHide(ratio);
    }

    // Ratio précédent, pour détecter le sens du défilement.
    let lastRatio = 0;
    // Au défilement : met à jour la progression et masque la barre vers le bas.
    const onScroll = () => {
      const max = strip.scrollHeight - strip.clientHeight;
      const ratio = max > 0 ? strip.scrollTop / max : 1;
      updateFromScroll();
      // Masque la barre supérieure quand on descend, la réaffiche sinon.
      topbar.classList.toggle("rd-top-hide", ratio - lastRatio > 0.001 && ratio > 0.02);
      lastRatio = ratio;
    };
    // Écoute le défilement en mode passif (plus performant).
    strip.addEventListener("scroll", onScroll, { passive: true });

    // Raccourcis clavier du mode bande (navigation entre chapitres).
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (settingsPop.classList.contains("open")) return settingsPop.classList.remove("open");
        if (tocDrawer.classList.contains("open")) return closeToc();
        navigate(`/manga/${sourceId}/${mangaId}`);
      } else if (e.key === "ArrowRight") {
        if (nextChap) goChapter(nextChap);
      } else if (e.key === "ArrowLeft") {
        if (prevChap) goChapter(prevChap);
      } else if (e.key.toLowerCase() === "t") tocDrawer.classList.contains("open") ? closeToc() : openToc();
    };
    window.addEventListener("keydown", onKey);

    // S'assure que la barre supérieure est visible au montage.
    topbar.classList.remove("rd-top-hide");
    // Après le premier rendu, restaure la position de défilement sauvegardée.
    requestAnimationFrame(() => {
      const max = strip.scrollHeight - strip.clientHeight;
      strip.style.scrollBehavior = "auto";
      // On ne restaure que si la position n'est pas déjà en tête ou en fin.
      if (savedRatio > 0 && savedRatio < 0.98 && max > 0) {
        strip.scrollTop = max * savedRatio;
      }
      // Synchronise l'affichage avec la position finale.
      updateFromScroll();
      requestAnimationFrame(() => {
        strip.style.scrollBehavior = "";
      });
    });

    return () => {
      window.removeEventListener("keydown", onKey);
      strip.removeEventListener("scroll", onScroll);
      strip.removeEventListener("error", onImgError, true);
    };
  }

  // Stub : le masquage de la barre est géré directement dans le scroll de la bande.
  function handleTopbarAutoHide() {
    /* géré dans le scroll du mode bande */
  }
}

function directImageUrl(url) {
  const str = String(url || "");
  try {
    const parsed = new URL(str, location.href);
    if (parsed.origin !== location.origin || parsed.pathname !== "/api/image") return str;
    return parsed.searchParams.get("url") || str;
  } catch {
    return str;
  }
}
