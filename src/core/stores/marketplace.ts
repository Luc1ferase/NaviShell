/**
 * The plugin registry index ("marketplace") shown in the Extensions panel; the index URL
 * is set in Settings > Plugins.
 *
 * The index is fetched on demand through `plugins_fetch_registry` and cached for the rest
 * of the app session; editing the registry URL drops the cache ({@link clearPluginRegistry}).
 */

import { create } from 'zustand';

import { call, errorMessage } from '../ipc/client';
import type { PluginRegistry } from '../ipc/contract';
import { getSettings } from './settings';

export interface MarketplaceStore {
  /** The last successfully fetched index, or `null` when there is none (yet). */
  registry: PluginRegistry | null;
  loading: boolean;
  /** Message of the last failed fetch; cleared when a fetch starts or succeeds. */
  error: string | null;
  /** Registry URL the cached index came from (`null` = the default URL). */
  source: string | null;
  /** Whether a fetch already ran in this app session (the auto-fetch runs once). */
  requested: boolean;
  begin(): void;
  succeed(registry: PluginRegistry, source: string | null): void;
  fail(message: string): void;
  /** Forget the cached index (keeps `requested`, so Settings does not refetch by itself). */
  clear(): void;
}

export const useMarketplaceStore = create<MarketplaceStore>((set) => ({
  registry: null,
  loading: false,
  error: null,
  source: null,
  requested: false,
  begin() {
    set({ loading: true, error: null, requested: true });
  },
  succeed(registry, source) {
    set({ registry, source, loading: false, error: null });
  },
  fail(message) {
    set({ loading: false, error: message });
  },
  clear() {
    set({ registry: null, source: null, error: null });
  },
}));

/**
 * A malformed index could repeat an id; the first entry wins, so the list keeps stable
 * React keys and one id maps to one action.
 */
function normalize(registry: PluginRegistry): PluginRegistry {
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : [];
  const seen = new Set<string>();
  return {
    ...registry,
    plugins: plugins.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }),
  };
}

/**
 * Fetch the configured registry index. Resolves to the error message when the fetch
 * failed (it is also kept in the store for the inline message), otherwise to `null`.
 */
export async function fetchPluginRegistry(): Promise<string | null> {
  const store = useMarketplaceStore.getState();
  if (store.loading) return null;
  const url = getSettings().plugins.registryUrl;
  store.begin();
  try {
    const registry = await call('plugins_fetch_registry', { url: url ?? undefined });
    useMarketplaceStore.getState().succeed(normalize(registry), url);
    return null;
  } catch (error) {
    const message = errorMessage(error);
    useMarketplaceStore.getState().fail(message);
    return message;
  }
}

/** Fetch the index once per app session; later calls are no-ops. */
export async function ensurePluginRegistry(): Promise<void> {
  if (useMarketplaceStore.getState().requested) return;
  await fetchPluginRegistry();
}

/** Drop the cached index, e.g. after the registry URL changed. */
export function clearPluginRegistry(): void {
  useMarketplaceStore.getState().clear();
}
