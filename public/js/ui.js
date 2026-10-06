// NovelHub — primitives d'interface : toast, modale, helpers HTML

import { icon } from "./icons.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function coverImage(novel, alt = "") {
  const src = escapeHtml(novel?.cover || "");
  return `<img src="${src}" alt="${escapeHtml(alt || novel?.title || "")}" loading="lazy" decoding="async" />`;
}

export function ratingBadge(rating) {
  if (!rating) return "";
  return `<span class="rating">${icon("star", 13)} ${rating.toFixed(1)}</span>`;
}

export function statusInfo(status) {
  if (status === "completed") return { label: "Terminé", cls: "completed" };
  if (status === "ongoing") return { label: "En cours", cls: "ongoing" };
  return { label: status || "Inconnu", cls: "" };
}

export function formatCount(n) {
  if (n == null) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k`;
  return String(n);
}

export function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  return `il y a ${Math.floor(months / 12)} an(s)`;
}

export function minutesLabel(wordCount) {
  if (!wordCount) return "";
  const mins = Math.max(1, Math.round(wordCount / 220));
  return `≈ ${mins} min`;
}

// ---- Toast -----------------------------------------------------------------

export function toast(msg, type = "success") {
  const host = document.getElementById("toast-host");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === "error" ? "close" : type === "info" ? "info" : "check", 17)}<span>${escapeHtml(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.classList.add("leaving"), 2600);
  setTimeout(() => el.remove(), 3000);
}

// ---- Modale ----------------------------------------------------------------

export function modal({ title, text = "", body = "", actions = [] }) {
  const host = document.getElementById("modal-host");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const actionHtml = actions
    .map(
      (a, i) =>
        `<button class="btn ${a.type === "primary" ? "btn-primary" : a.type === "danger" ? "btn-danger-solid" : ""}" data-action="${i}">${a.label}</button>`
    )
    .join("");

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

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = btn.dataset.action;
      const action = i === "close" ? null : actions[Number(i)];
      if (action && typeof action.onClick === "function") {
        const result = action.onClick({ close });
        const isAsync = result && typeof result.then === "function";
        if (result === false || isAsync) return;
      }
      close();
    });
  });

  document.addEventListener("keydown", onKey);
  host.appendChild(overlay);
  return { close };
}

// ---- Squelettes ------------------------------------------------------------

export function skeletonCards(count = 8) {
  return Array.from({ length: count }, () => `<div class="novel-card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:16px"></div><div class="novel-card-body"><div class="skeleton" style="height:18px;width:85%;margin-bottom:6px;border-radius:6px"></div><div class="skeleton" style="height:12px;width:55%;border-radius:6px"></div></div></div>`).join("");
}

// ---- États vides -----------------------------------------------------------

export function emptyState({ iconName = "bookOpen", title, text, action = "" }) {
  return `
    <div class="empty">
      ${icon(iconName, 44)}
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
      ${action}
    </div>`;
}