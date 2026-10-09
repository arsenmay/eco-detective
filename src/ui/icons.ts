const paths: Record<string, string> = {
  leaf: '<path d="M20 4c-8-2-16 2-16 9a7 7 0 0 0 7 7c7 0 11-8 9-16Z"/><path d="M5 19 15 9M10 14v-5M10 14h5"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  folder: '<path d="M3 7h7l2 3h9v9H3Z"/><path d="M3 7V4h7l2 3h8v3"/>',
  trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0Z"/><path d="M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v5m-4 3h8m-6-3h4v3"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 3v3l4 3 3-1 3 1 4-3v-3l2-3-2-4-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
  bolt: '<path d="m13 2-8 12h6l-1 8 9-13h-6Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  computer: '<rect x="3" y="4" width="12" height="12" rx="1"/><path d="M7 20h4m-2-4v4"/><rect x="18" y="4" width="3" height="16" rx="1"/>',
  projector: '<rect x="3" y="7" width="18" height="11" rx="3"/><circle cx="16" cy="12" r="3"/><path d="M6 10h3m-3 3h3m0-9v3m6-3v3"/>',
  lighting: '<path d="M8 15a7 7 0 1 1 8 0l-1 3H9Z"/><path d="M9 21h6m-3-3v-7m-3-1 3 2 3-2"/>',
  network: '<rect x="4" y="12" width="16" height="7" rx="2"/><path d="M7 12V8m10 4V8m-9-3a7 7 0 0 1 8 0M5 2a12 12 0 0 1 14 0M7 16h.1m4 0h.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  save: '<path d="M4 3h13l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
};

export function icon(name: string, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
}
