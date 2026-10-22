/**
 * The theme itself: every SVG under `./icons/` is inlined into the bundle at build time,
 * and an entry resolves to one of them through `./mapping`.
 *
 * Icons are handed to the host as `data:` URLs (the host draws them with `<img>`), built
 * once per icon and reused for every row that shows it.
 */

import type { FileIcon, FileIconRequest } from '@navishell/plugin-api';
import { iconNameFor } from './mapping';

// Vite resolves the glob at build time, so the bundle carries the markup and nothing is
// read from disk when the plugin runs.
const MODULES = import.meta.glob<string>('./icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Icon name (`typescript`, `folder-src`) → SVG markup. */
const ICONS: Record<string, string> = {};
for (const [path, svg] of Object.entries(MODULES)) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  ICONS[file.slice(0, -'.svg'.length)] = svg;
}

/** How many icons the bundle carries. */
export const ICON_COUNT = Object.keys(ICONS).length;

const cache = new Map<string, FileIcon>();

/** The icon for an entry, or `undefined` to let the host draw its default. */
export function resolveIcon(request: FileIconRequest): FileIcon | undefined {
  const name = iconNameFor(request);
  if (name === undefined) return undefined;
  const svg = ICONS[name];
  if (svg === undefined) return undefined;
  let icon = cache.get(name);
  if (!icon) {
    icon = { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
    cache.set(name, icon);
  }
  return icon;
}
