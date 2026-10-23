/** Inline SVG icons (no icon dependency). 20×20 grid, currentColor, decorative (aria-hidden). */
const svg = (body: string): string =>
  `<svg class="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M6 4.5v11l9-5.5z" fill="currentColor"/>'),
  pause: svg('<rect x="5" y="4.5" width="3.5" height="11" rx="1" fill="currentColor"/><rect x="11.5" y="4.5" width="3.5" height="11" rx="1" fill="currentColor"/>'),
  prev: svg('<path d="M14.5 4.5v11l-8-5.5z" fill="currentColor"/><rect x="4.5" y="4.5" width="2" height="11" rx="0.8" fill="currentColor"/>'),
  next: svg('<path d="M5.5 4.5v11l8-5.5z" fill="currentColor"/><rect x="13.5" y="4.5" width="2" height="11" rx="0.8" fill="currentColor"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  overview: svg('<rect x="2.5" y="7" width="15" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 7v6M10 7v6M14 7v6" stroke="currentColor" stroke-width="1.2"/>'),
  enter: svg('<rect x="3" y="3" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 10h6M10.5 7.5 13 10l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** Compass: guided tours. */
  tour: svg('<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12.8 7.2 11 11l-3.8 1.8L9 9z" fill="currentColor"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2" stroke="currentColor" stroke-width="1.2"/>'),
  legend: svg('<circle cx="6" cy="6" r="2.5" fill="currentColor"/><rect x="11" y="3.5" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 11.5l2.8 3-2.8 3-2.8-3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 16a3 3 0 0 1 5 0" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
  gear: svg('<circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v2.6M10 15.4V18M2 10h2.6M15.4 10H18M4.3 4.3l1.9 1.9M13.8 13.8l1.9 1.9M4.3 15.7l1.9-1.9M13.8 6.2l1.9-1.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
  sliders: svg('<path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="5.5" r="1.9" fill="#000" stroke="currentColor" stroke-width="1.4"/><circle cx="13" cy="10" r="1.9" fill="#000" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="14.5" r="1.9" fill="#000" stroke="currentColor" stroke-width="1.4"/>'),
  // Panel sections.
  info: svg('<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.2" r="1.1" fill="currentColor"/>'),
  sigma: svg('<path d="M15 4H5.5l5 6-5 6H15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>'),
  grid: svg('<rect x="3" y="3" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.7 3v14M12.3 3v14M3 7.7h14M3 12.3h14" stroke="currentColor" stroke-width="1"/><rect x="7.7" y="7.7" width="4.6" height="4.6" fill="currentColor" opacity="0.7"/>'),
  link: svg('<circle cx="4.5" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15.5" cy="4.5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15.5" cy="15.5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.6 9 13.4 5.6M6.6 11l6.8 3.4" stroke="currentColor" stroke-width="1.4"/>'),
  warning: svg('<path d="M10 2.8 18 16.8H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14.6" r="1" fill="currentColor"/>'),
  doc: svg('<path d="M5 2.5h7l3.5 3.5v11.5H5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 2.5V6h3.5M7.5 10h5M7.5 13h5" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
  sketch: svg('<path d="M2.5 15c3-8 5-8 7.5-3s4.5 5 7.5-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2.5 17.5h15" stroke="currentColor" stroke-width="1"/>'),
  // Component roles.
  eye: svg('<path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/>'),
  fork: svg('<circle cx="4" cy="10" r="2" fill="currentColor"/><path d="M6 10h3M9 10l6-5.5M9 10h6M9 10l6 5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="4.5" r="1.4" fill="currentColor"/><circle cx="16" cy="10" r="1.4" fill="currentColor"/><circle cx="16" cy="15.5" r="1.4" fill="currentColor"/>'),
  cubes: svg('<path d="M10 2.5 14 4.7v4.4L10 11.3 6 9.1V4.7z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 9.4l4 2.2v4.4L6 18.2 2 16v-4.4zM14 9.4l4 2.2V16l-4 2.2-4-2.2v-4.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),
  valve: svg('<path d="M2 6.5v7M18 6.5v7M2 10h4.5M13.5 10H18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6.5 6.5 13.5 13.5V6.5L6.5 13.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 10V3.5M7.5 3.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  scale: svg('<path d="M10 3v14M5 17h10M3.5 6h13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 6 1.5 11h4zM16.5 6l-2 5h4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),
  token: svg('<rect x="2.5" y="5.5" width="15" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 8.5h2.6M7.3 8.5v4M11 8.5v4M11 8.5h3M11 10.5h2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  layers: svg('<path d="M10 3 18 7l-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 10.5l8 4 8-4M2 14l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  lane: svg('<path d="M2 7h16M2 13h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 4.5 16 7l-3 2.5M13 10.5l3 2.5-3 2.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
  chevron: svg('<path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
} as const;

export type IconName = keyof typeof ICONS;

/** Icon of a component type (panel chip, hover tip). */
export function typeIcon(type: string): string {
  switch (type) {
    case 'attn': case 'head': return ICONS.eye;
    case 'router': return ICONS.fork;
    case 'bank': case 'expert': case 'seed_bias': case 'gelu': return ICONS.cubes;
    case 'anastomosis': case 'gate': return ICONS.valve;
    case 'ln1': case 'ln2': case 'ln_f': return ICONS.scale;
    case 'embed': case 'lm_head': return ICONS.token;
    case 'matrix': return ICONS.grid;
    case 'shaft': return ICONS.lane;
    default: return ICONS.layers;
  }
}
