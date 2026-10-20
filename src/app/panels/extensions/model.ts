/**
 * The Extensions panel's view of the world: one record per plugin that is listed in the
 * marketplace index and/or installed, with everything the list and the detail pane need
 * already resolved (localized name, what the primary button does, which versions exist).
 *
 * Pure functions over the marketplace and plugins stores; no React, no IPC.
 */

import { resolveLocalized, type Locale } from '@navishell/plugin-api';

import { fallbackChain } from '@/core/i18n';
import {
  PLUGIN_CATEGORIES,
  type PluginCategory,
  type PluginRegistryEntry,
} from '@/core/ipc/contract';
import type { PluginEntry } from '@/core/stores/plugins';
import { compareVersions } from '@/core/util/fn';

export type ExtensionView = 'marketplace' | 'installed' | 'updates';
export type ExtensionSort = 'default' | 'name';

/** What the primary button of an item does. */
export type ExtensionAction =
  /** Listed, not installed. */
  | { kind: 'install' }
  /** Installed from the marketplace and the index has a newer version. */
  | { kind: 'update'; installed: string; latest: string }
  /** Installed and the index has nothing newer. */
  | { kind: 'upToDate'; installed: string }
  /** Installed from a URL or a file; the index does not list it. */
  | { kind: 'installedOnly'; installed: string }
  /** Ships with the app; never installed over. */
  | { kind: 'builtin' };

export interface ExtensionItem {
  id: string;
  /** Localized display name (falls back to the id). */
  name: string;
  /** Localized one-liner, `''` when there is none. */
  description: string;
  /** lucide-react icon name; the UI falls back to `Puzzle` when it does not resolve. */
  icon: string | undefined;
  author: string | undefined;
  /** The index entry, when the plugin is listed. */
  registry: PluginRegistryEntry | undefined;
  /** The installed plugin (built-in or external), when it is installed. */
  installed: PluginEntry | undefined;
  /** The newest version the index offers, or the installed one when unlisted. */
  version: string;
  categories: PluginCategory[];
  tags: string[];
  /** The newest listed version needs a newer host than this one. */
  hostTooOld: boolean;
  action: ExtensionAction;
}

/** One installable version of an item, for the Versions tab. */
export interface VersionOption {
  version: string;
  url: string;
  sha256: string | undefined;
  minHostVersion: string | undefined;
  /** ISO date; the latest version has none (the index does not date it). */
  date: string | undefined;
  latest: boolean;
  /** This exact version is what is installed. */
  installed: boolean;
  hostTooOld: boolean;
}

export interface ExtensionFilter {
  view: ExtensionView;
  /** Free text; tokens are matched case-insensitively against id, name, description, author and tags. */
  query: string;
  /** `null` = every category. */
  category: PluginCategory | null;
  sort: ExtensionSort;
}

/**
 * Whether a plugin that needs `minHostVersion` can run on `hostVersion`. Without a host
 * version (the app running outside Tauri) nothing is enforced, as in the loader.
 */
export function hostSatisfies(
  hostVersion: string | null,
  minHostVersion: string | undefined,
): boolean {
  if (minHostVersion === undefined || hostVersion === null) return true;
  return compareVersions(hostVersion, minHostVersion) >= 0;
}

function isCategory(value: string): value is PluginCategory {
  return (PLUGIN_CATEGORIES as readonly string[]).includes(value);
}

function actionFor(
  registry: PluginRegistryEntry | undefined,
  installed: PluginEntry | undefined,
): ExtensionAction {
  if (!installed) return { kind: 'install' };
  if (installed.source === 'builtin') return { kind: 'builtin' };
  const current = installed.manifest.version;
  if (!registry) return { kind: 'installedOnly', installed: current };
  if (compareVersions(registry.version, current) > 0) {
    return { kind: 'update', installed: current, latest: registry.version };
  }
  return { kind: 'upToDate', installed: current };
}

/**
 * Merges the index with the installed plugins. Listed plugins come first in index order,
 * then the installed ones the index does not know, sorted by name.
 */
export function buildItems(
  registry: readonly PluginRegistryEntry[],
  installed: readonly PluginEntry[],
  locale: Locale,
  hostVersion: string | null,
): ExtensionItem[] {
  const chain = fallbackChain(locale);
  const installedById = new Map(installed.map((entry) => [entry.id, entry]));
  const items: ExtensionItem[] = [];
  const seen = new Set<string>();

  for (const entry of registry) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const plugin = installedById.get(entry.id);
    items.push({
      id: entry.id,
      name: resolveLocalized(entry.name, locale, chain) || entry.id,
      description: resolveLocalized(entry.description, locale, chain) ?? '',
      icon: entry.icon ?? plugin?.manifest.icon,
      author: entry.author ?? plugin?.manifest.author,
      registry: entry,
      installed: plugin,
      version: entry.version,
      categories: (entry.categories ?? []).filter(isCategory),
      tags: entry.tags ?? [],
      hostTooOld: !hostSatisfies(hostVersion, entry.minHostVersion),
      action: actionFor(entry, plugin),
    });
  }

  const unlisted = installed
    .filter((plugin) => !seen.has(plugin.id))
    .map((plugin): ExtensionItem => {
      const { manifest } = plugin;
      return {
        id: plugin.id,
        name: resolveLocalized(manifest.name, locale, chain) || plugin.id,
        description: resolveLocalized(manifest.description, locale, chain) ?? '',
        icon: manifest.icon,
        author: manifest.author,
        registry: undefined,
        installed: plugin,
        version: manifest.version,
        categories: [],
        tags: [],
        hostTooOld: false,
        action: actionFor(undefined, plugin),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));

  return [...items, ...unlisted];
}

function haystack(item: ExtensionItem): string {
  return [item.id, item.name, item.description, item.author ?? '', ...item.tags]
    .join(' ')
    .toLowerCase();
}

/** Items of a view, narrowed by the search text and category, in the requested order. */
export function filterItems(
  items: readonly ExtensionItem[],
  filter: ExtensionFilter,
  locale: Locale,
): ExtensionItem[] {
  const tokens = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  const result = items.filter((item) => {
    switch (filter.view) {
      case 'marketplace':
        if (!item.registry) return false;
        break;
      case 'installed':
        if (!item.installed) return false;
        break;
      case 'updates':
        if (item.action.kind !== 'update') return false;
        break;
    }
    if (filter.category !== null && !item.categories.includes(filter.category)) return false;
    if (tokens.length === 0) return true;
    const text = haystack(item);
    return tokens.every((token) => text.includes(token));
  });
  if (filter.sort === 'name' || filter.view === 'installed') {
    result.sort((a, b) => a.name.localeCompare(b.name, locale));
  }
  return result;
}

/** How many installed plugins the index can update (the Updates view's badge). */
export function countUpdates(items: readonly ExtensionItem[]): number {
  return items.filter((item) => item.action.kind === 'update').length;
}

/** The categories that occur among the listed items, with how many items each has. */
export function categoryCounts(items: readonly ExtensionItem[]): Map<PluginCategory, number> {
  const counts = new Map<PluginCategory, number>();
  for (const category of PLUGIN_CATEGORIES) {
    const n = items.filter((item) => item.registry && item.categories.includes(category)).length;
    if (n > 0) counts.set(category, n);
  }
  return counts;
}

/** Every version the index offers for an item, newest first; empty for unlisted plugins. */
export function versionOptions(item: ExtensionItem, hostVersion: string | null): VersionOption[] {
  const entry = item.registry;
  if (!entry) return [];
  const installedVersion = item.installed?.manifest.version;
  const latest: VersionOption = {
    version: entry.version,
    url: entry.url,
    sha256: entry.sha256,
    minHostVersion: entry.minHostVersion,
    date: undefined,
    latest: true,
    installed: installedVersion === entry.version,
    hostTooOld: !hostSatisfies(hostVersion, entry.minHostVersion),
  };
  const older = (entry.releases ?? []).map((release): VersionOption => ({
    version: release.version,
    url: release.url,
    sha256: release.sha256,
    minHostVersion: release.minHostVersion,
    date: release.date,
    latest: false,
    installed: installedVersion === release.version,
    hostTooOld: !hostSatisfies(hostVersion, release.minHostVersion),
  }));
  return [latest, ...older];
}

/**
 * The URL relative links in a Markdown document resolve against: the document's own
 * directory. `undefined` when the URL is not absolute http(s).
 */
export function documentBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/[^/]*$/, '');
    return parsed.toString();
  } catch {
    return undefined;
  }
}
