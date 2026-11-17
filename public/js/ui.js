// OptiManga — primitives d'interface : toast, modale, helpers HTML

// On importe la fonction de génération d'icônes SVG.
import { icon } from "./icons.js";

// On déclare la fonction qui neutralise les caractères HTML dangereux.
export function escapeHtml(value) {
  // On convertit la valeur en texte, avec une chaîne vide si elle est nulle.
  return String(value ?? "")
    // On remplace les « & » par leur entité HTML.
    .replace(/&/g, "&amp;")
    // On remplace les « < » par leur entité HTML.
    .replace(/</g, "&lt;")
    // On remplace les « > » par leur entité HTML.
    .replace(/>/g, "&gt;")
    // On remplace les guillemets doubles par leur entité HTML.
    .replace(/"/g, "&quot;")
    // On remplace les apostrophes par leur entité HTML.
    .replace(/'/g, "&#39;");
// On referme la fonction escapeHtml.
}

// On définit la palette de couleurs utilisée pour les couvertures de secours.
const PLACEHOLDER_PALETTE = [
  // Paire de couleurs violette.
  ["#8a6cff", "#3f2b96"],
  // Paire de couleurs orange.
  ["#ff8a5c", "#b23a20"],
  // Paire de couleurs turquoise.
  ["#2dd4bf", "#0e6b5f"],
  // Paire de couleurs bleue.
  ["#4aa3ff", "#1d4fa0"],
  // Paire de couleurs rose.
  ["#f472b6", "#941d52"],
  // Paire de couleurs verte.
  ["#4ade80", "#1f6e3a"],
  // Paire de couleurs ambre.
  ["#fbbf24", "#92600a"],
  // Paire de couleurs indigo.
  ["#818cf8", "#3b3f9e"],
  // Paire de couleurs rouge rosé.
  ["#fb7185", "#9e1c33"],
  // Paire de couleurs gris bleuté.
  ["#94a3b8", "#38424f"],
// On referme le tableau de la palette.
];

// On déclare la fonction qui choisit une paire de couleurs de façon déterministe.
function coverPalette(seed) {
  // On convertit la graine en texte, ou « M » par défaut.
  const s = String(seed || "M");
  // On initialise la valeur de hachage à zéro.
  let h = 0;
  // On parcourt chaque caractère de la graine pour calculer un hachage.
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  // On renvoie la paire de couleurs correspondant au hachage.
  return PLACEHOLDER_PALETTE[h % PLACEHOLDER_PALETTE.length];
// On referme la fonction coverPalette.
}

/** Accent (couleurs du livre) déterministe pour un manga : doré pour lisibilité. */
// On déclare la fonction qui renvoie les variables CSS d'accent d'un manga.
export function coverAccent(manga) {
  // On détermine la paire de couleurs à partir de l'identifiant ou du titre.
  const [c1, c2] = coverPalette(manga?.id || manga?.title);
  // On renvoie une chaîne de variables CSS avec ces couleurs.
  return `--ph1:${c1};--ph2:${c2}`;
// On referme la fonction coverAccent.
}

// On déclare la fonction qui génère une couverture de remplacement.
export function coverPlaceholder(manga, alt = "") {
  // On construit les initiales du titre, échappées pour le HTML.
  const initials = escapeHtml(
    // On part du titre du manga, ou « M » par défaut.
    (manga?.title || "M")
      // On découpe le titre sur les espaces.
      .split(/\s+/)
      // On ne garde que les deux premiers mots.
      .slice(0, 2)
      // On prend la première lettre de chaque mot en majuscule.
      .map((w) => w.charAt(0).toUpperCase())
      // On assemble les initiales en une seule chaîne.
      .join("")
  // On referme l'appel à escapeHtml.
  );
  // On détermine la paire de couleurs à partir de l'identifiant ou du titre.
  const [c1, c2] = coverPalette(manga?.id || manga?.title);
  // On construit le style du dégradé et les variables de couleur.
  const style = `background:linear-gradient(160deg,${c1} 0%,${c2} 100%);--ph1:${c1};--ph2:${c2}`;
  // On renvoie la couverture de remplacement avec l'icône et les initiales.
  return `<span class="cover-ph" style="${style}" aria-hidden="true">${icon("library", 30)}<em>${initials}</em></span>`;
// On referme la fonction coverPlaceholder.
}

// On déclare la fonction qui génère l'image de couverture d'un manga.
export function coverImage(manga, alt = "") {
  // Sans couverture, on renvoie la couverture de remplacement.
  if (!manga?.cover) return coverPlaceholder(manga, alt);
  // On échappe l'URL de la couverture pour l'insérer dans le HTML.
  const src = escapeHtml(manga.cover);
  // On renvoie une balise image en chargement différé.
  return `<img src="${src}" alt="${escapeHtml(alt || manga?.title || "")}" loading="lazy" decoding="async" />`;
// On referme la fonction coverImage.
}

/** Couverture d'un chapitre/fiche présentée en grand (jamais de placeholder). */
// On déclare la fonction qui génère l'image héro d'un manga.
export function heroImage(manga, alt = "") {
  // Sans couverture, on renvoie la couverture de remplacement.
  if (!manga?.cover) return coverPlaceholder(manga, alt);
  // On échappe l'URL de la couverture pour l'insérer dans le HTML.
  const src = escapeHtml(manga.cover);
  // On renvoie une balise image chargée immédiatement.
  return `<img src="${src}" alt="${escapeHtml(alt || manga?.title || "")}" loading="eager" decoding="async" />`;
// On referme la fonction heroImage.
}

// On déclare la fonction qui génère le badge de note d'un manga.
export function ratingBadge(rating) {
  // Sans note, on ne renvoie aucun balisage.
  if (!rating) return "";
  // On renvoie le badge avec l'icône étoile et la note formatée.
  return `<span class="rating">${icon("star", 13)} ${rating.toFixed(1)}</span>`;
// On referme la fonction ratingBadge.
}

// On déclare la fonction qui traduit un statut en libellé et classe CSS.
export function statusInfo(status) {
  // Statut « completed » : manga terminé.
  if (status === "completed") return { label: "Terminé", cls: "completed" };
  // Statut « ongoing » : manga en cours.
  if (status === "ongoing") return { label: "En cours", cls: "ongoing" };
  // Statut « hiatus » : manga en pause.
  if (status === "hiatus") return { label: "En pause", cls: "hiatus" };
  // Statut « cancelled » : manga annulé.
  if (status === "cancelled") return { label: "Annulé", cls: "cancelled" };
  // Statut inconnu : on renvoie la valeur brute ou « Inconnu ».
  return { label: status || "Inconnu", cls: "" };
// On referme la fonction statusInfo.
}

// On déclare la fonction qui abrège un grand nombre en milliers.
export function formatCount(n) {
  // Sans valeur, on renvoie « 0 ».
  if (n == null) return "0";
  // Au-delà de 1000, on affiche le nombre arrondi suivi de « k ».
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k`;
  // Sinon on renvoie simplement le nombre sous forme de texte.
  return String(n);
// On referme la fonction formatCount.
}

// On déclare la fonction qui exprime une date sous forme relative.
export function timeAgo(iso) {
  // On calcule l'écart en millisecondes depuis la date donnée.
  const diffMs = Date.now() - new Date(iso).getTime();
  // On convertit cet écart en minutes entières.
  const mins = Math.floor(diffMs / 60000);
  // Moins d'une minute : on affiche « à l'instant ».
  if (mins < 1) return "à l'instant";
  // Moins d'une heure : on affiche les minutes écoulées.
  if (mins < 60) return `il y a ${mins} min`;
  // On convertit l'écart en heures entières.
  const hours = Math.floor(mins / 60);
  // Moins d'un jour : on affiche les heures écoulées.
  if (hours < 24) return `il y a ${hours} h`;
  // On convertit l'écart en jours entiers.
  const days = Math.floor(hours / 24);
  // Moins de trente jours : on affiche les jours écoulés.
  if (days < 30) return `il y a ${days} j`;
  // On convertit l'écart en mois entiers.
  const months = Math.floor(days / 30);
  // Moins d'un an : on affiche les mois écoulés.
  if (months < 12) return `il y a ${months} mois`;
  // Au-delà, on affiche le nombre d'années écoulées.
  return `il y a ${Math.floor(months / 12)} an(s)`;
// On referme la fonction timeAgo.
}

// On déclare la fonction qui formate une taille en octets de façon lisible.
function formatSizeBytes(bytes) {
  // Sans valeur, on renvoie un tiret.
  if (!bytes) return "—";
  // On convertit les octets en kilooctets.
  const kb = bytes / 1024;
  // En dessous d'un mégaoctet, on affiche des kilooctets arrondis.
  if (kb < 1024) return `${Math.round(kb)} Ko`;
  // Sinon on affiche des mégaoctets avec une décimale.
  return `${(kb / 1024).toFixed(1)} Mo`;
// On referme la fonction formatSizeBytes.
}

// On réexporte la fonction de formatage des tailles pour les autres modules.
export { formatSizeBytes };

// ---- Toast -----------------------------------------------------------------

// On déclare la fonction qui affiche une notification temporaire.
export function toast(msg, type = "success") {
  // On récupère le conteneur dédié aux notifications.
  const host = document.getElementById("toast-host");
  // On crée l'élément de la notification.
  const el = document.createElement("div");
  // On lui applique la classe de toast et le type fourni.
  el.className = `toast ${type}`;
  // On insère l'icône adaptée au type et le message échappé.
  el.innerHTML = `${icon(type === "error" ? "close" : type === "info" ? "info" : "check", 17)}<span>${escapeHtml(msg)}</span>`;
  // On ajoute la notification au conteneur.
  host.appendChild(el);
  // Après 2,6 secondes, on déclenche son animation de sortie.
  setTimeout(() => el.classList.add("leaving"), 2600);
  // Après 3 secondes, on retire la notification du document.
  setTimeout(() => el.remove(), 3000);
// On referme la fonction toast.
}

// ---- Modale ----------------------------------------------------------------

// On déclare la fonction qui ouvre une fenêtre modale configurable.
export function modal({ title, text = "", body = "", actions = [] }) {
  // On récupère le conteneur dédié aux modales.
  const host = document.getElementById("modal-host");
  // On crée l'élément d'arrière-plan de la modale.
  const overlay = document.createElement("div");
  // On lui applique la classe d'arrière-plan de modale.
  overlay.className = "modal-overlay";

  // On construit le HTML des boutons d'action de la modale.
  const actionHtml = actions
    // On transforme chaque action en bouton correspondant.
    .map(
      // Pour chaque action, on produit son bouton avec le bon style.
      (a, i) =>
        // On renvoie le balisage du bouton avec son libellé.
        `<button class="btn ${a.type === "primary" ? "btn-primary" : a.type === "danger" ? "btn-danger-solid" : ""}" data-action="${i}">${a.label}</button>`
    // On referme la fonction de transformation.
    )
    // On assemble tous les boutons en une seule chaîne.
    .join("");

  // On définit le contenu HTML complet de la modale (gabarit multi-lignes).
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <h3>${escapeHtml(title)}</h3>
      ${text ? `<p>${text}</p>` : ""}
      ${body || ""}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close">Annuler</button>
        ${actionHtml}
      </div>
    </div>`;

  // On déclare la fonction interne qui ferme la modale.
  function close() {
    // On retire l'arrière-plan et tout son contenu du document.
    overlay.remove();
    // On retire l'écouteur clavier associé à la modale.
    document.removeEventListener("keydown", onKey);
  // On referme la fonction close.
  }

  // On déclare la fonction interne qui gère les touches du clavier.
  function onKey(e) {
    // On ferme la modale si la touche Échap est pressée.
    if (e.key === "Escape") close();
  // On referme la fonction onKey.
  }

  // On ajoute un écouteur de clic sur l'arrière-plan.
  overlay.addEventListener("click", (e) => {
    // On ferme la modale quand le clic vise l'arrière-plan lui-même.
    if (e.target === overlay) close();
  // On referme la fonction de clic.
  });
  // On parcourt tous les boutons portant l'attribut data-action.
  overlay.querySelectorAll("[data-action]").forEach((btn) => {
    // On ajoute un écouteur de clic à chaque bouton.
    btn.addEventListener("click", () => {
      // On lit l'index d'action stocké sur le bouton.
      const i = btn.dataset.action;
      // On retrouve l'action correspondante, ou null pour « close ».
      const action = i === "close" ? null : actions[Number(i)];
      // On vérifie que l'action expose bien une fonction onClick.
      if (action && typeof action.onClick === "function") {
        // On exécute la fonction onClick de l'action.
        const result = action.onClick({ close });
        // On détecte si le résultat est une promesse asynchrone.
        const isAsync = result && typeof result.then === "function";
        // On laisse la modale ouverte si l'action veut rester ou est asynchrone.
        if (result === false || isAsync) return;
      // On referme le test de présence de l'action.
      }
      // On ferme la modale après l'exécution de l'action.
      close();
    // On referme la fonction de clic du bouton.
    });
  // On referme la boucle des boutons d'action.
  });

  // On écoute le clavier pour permettre la fermeture par Échap.
  document.addEventListener("keydown", onKey);
  // On ajoute la modale au conteneur dédié.
  host.appendChild(overlay);
  // On renvoie un objet exposant la fonction de fermeture.
  return { close };
// On referme la fonction modal.
}

// ---- Squelettes ------------------------------------------------------------

// On déclare la fonction qui génère des cartes squelettes de chargement.
export function skeletonCards(count = 8) {
  // On produit le nombre demandé de cartes squelettes et on les assemble.
  return Array.from({ length: count }, () => `<div class="novel-card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:16px"></div><div class="novel-card-body"><div class="skeleton" style="height:18px;width:85%;margin-bottom:6px;border-radius:6px"></div><div class="skeleton" style="height:12px;width:55%;border-radius:6px"></div></div></div>`).join("");
// On referme la fonction skeletonCards.
}

// ---- États vides -----------------------------------------------------------

// On déclare la fonction qui génère un état vide avec icône et message.
export function emptyState({ iconName = "library", title, text, action = "" }) {
  // On renvoie le gabarit HTML de l'état vide (gabarit multi-lignes).
  return `
    <div class="empty">
      ${icon(iconName, 44)}
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
      ${action}
    </div>`;
// On referme la fonction emptyState.
}
