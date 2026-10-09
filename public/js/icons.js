// OptiManga — banque d'icônes (SVG inline)

const ICONS = {
  heart: '<path d="M12 20.5C12 20.5 3.5 15.6 3.5 9.6a4.55 4.55 0 0 1 7.8-3.1 4.55 4.55 0 0 1 1.7 3.1 4.55 4.55 0 0 1 1.7-3.1 4.55 4.55 0 0 1 7.8 3.1c0 6-8.5 10.9-8.5 10.9z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  book: '<path d="M4 19.5V5.5A1.5 1.5 0 0 1 5.5 4h4A1.5 1.5 0 0 1 11 5.5V19.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M13 19.5V5.5A1.5 1.5 0 0 1 14.5 4h4A1.5 1.5 0 0 1 20 5.5V19.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3 20h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  library: '<path d="M4 19.5V5.5A1.5 1.5 0 0 1 5.5 4h4A1.5 1.5 0 0 1 11 5.5V19.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M13 19.5V5.5A1.5 1.5 0 0 1 14.5 4h4A1.5 1.5 0 0 1 20 5.5V19.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3 20h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  history: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3.2 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  star: '<path d="M12 3.5l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8 2.5-5.1z" fill="currentColor"/>',
  download: '<path d="M12 3v11m0 0l-4-4m4 4l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-.8 12.1A2 2 0 0 1 17.2 21H6.8a2 2 0 0 1-2-1.9L4 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M7 4.5l12 7.5-12 7.5v-15z" fill="currentColor"/>',
  arrowLeft: '<path d="M19 12H5m0 0l6-6m-6 6l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowRight: '<path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronRight: '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H5a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z" stroke="currentColor" stroke-width="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  check: '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3.2 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  fileText: '<path d="M6 3h8.5L19 7.5V21H6V3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5M9.5 12h6M9.5 16h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" fill="currentColor"/>',
  bookOpen: '<path d="M12 6.5C10.5 5 8.5 4.5 5 4.5c-.6 0-1 .4-1 1V18c0 .6.4 1 1 1 3.5 0 5.5.5 7 2 1.5-1.5 3.5-2 7-2 .6 0 1-.4 1-1V5.5c0-.6-.4-1-1-1-3.5 0-5.5.5-7 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 6.5V19" stroke="currentColor" stroke-width="1.6"/>',
  type: '<path d="M4 6V4h16v2M12 4v16m-3 0h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  puzzle: '<path d="M12 4a2 2 0 0 1 2 2v.5a1 1 0 0 0 1 1h1.5a1.5 1.5 0 0 1 0 3H15a1 1 0 0 0-1 1v.5a2 2 0 1 1-4 0V11.5a1 1 0 0 0-1-1h-.5a1.5 1.5 0 0 1 0-3H10a1 1 0 0 0 1-1V6a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  external: '<path d="M14 4h6v6M20 4L10 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5v-10A1.5 1.5 0 0 1 6.5 7H12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  shuffle: '<path d="M16 3h5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20L21 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 16v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name, size = 18) {
  const body = ICONS[name] || ICONS.book;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
}