/**
 * Plugin contributions to the host's context menus.
 *
 * A plugin registers a provider for a menu id (`ctx.menus.register('terminal', ...)`);
 * when the host opens that menu it asks every provider for items and appends them, each
 * plugin's group behind a separator, in registration order. A provider that throws is
 * logged and skipped so one plugin cannot take the menu down.
 */

import type { MenuContexts, MenuId, MenuItem } from '@navishell/plugin-api';

import { useRegistryStore } from '../plugins/registry';

const SEPARATOR: MenuItem = { label: '', separator: true };

/** The items every plugin contributes to `menu`, grouped per plugin; empty when none. */
export function collectMenuContributions<K extends MenuId>(
  menu: K,
  context: MenuContexts[K],
): MenuItem[] {
  const items: MenuItem[] = [];
  for (const entry of useRegistryStore.getState().menuProviders) {
    if (entry.menu !== menu) continue;
    let contributed: MenuItem[];
    try {
      contributed = entry.provider(context);
    } catch (error) {
      console.error(`[navishell] menu provider of ${entry.pluginId} failed`, error);
      continue;
    }
    if (!Array.isArray(contributed) || contributed.length === 0) continue;
    if (items.length > 0) items.push(SEPARATOR);
    items.push(...contributed);
  }
  return items;
}

/** `base` followed by the plugin contributions to `menu`, separated when there are any. */
export function withMenuContributions<K extends MenuId>(
  base: MenuItem[],
  menu: K,
  context: MenuContexts[K],
): MenuItem[] {
  const contributed = collectMenuContributions(menu, context);
  if (contributed.length === 0) return base;
  return base.length > 0 ? [...base, SEPARATOR, ...contributed] : contributed;
}
