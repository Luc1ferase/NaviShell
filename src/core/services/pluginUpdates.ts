/**
 * Background plugin update checks.
 *
 * A little after startup, and every few hours while the app runs, the marketplace index is
 * fetched (unless a fresh copy is already in the marketplace store) and compared with the
 * installed plugins. Whatever the index lists at a newer version is an "update": the top
 * bar and the status bar badge the count, the Extensions panel lists them under Updates,
 * and a toast announces the ones not announced before. With `plugins.autoUpdate` on, the
 * updates this host supports are installed instead. Failures stay silent here; Settings >
 * Plugins shows the last outcome and offers a manual check.
 */

import { useMemo } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { resolveLocalized } from '@navishell/plugin-api';
import { create } from 'zustand';

import { currentLocale, fallbackChain, t } from '../i18n';
import { call, errorMessage } from '../ipc/client';
import type { PluginRegistryEntry } from '../ipc/contract';
import { installPlugin } from '../plugins/install';
import { fetchPluginRegistry, useMarketplaceStore } from '../stores/marketplace';
import { usePluginsStore, type PluginEntry } from '../stores/plugins';
import { getSettings, useSettingsStore } from '../stores/settings';
import { useUiStore } from '../stores/ui';
import { compareVersions } from '../util/fn';
import { openExtensionsPanel } from './layout';

/** The first check waits for the app to settle; nobody needs the badge in the first seconds. */
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** An index fetched more recently than this (by the panel, say) is reused, not refetched. */
const FRESH_FOR_MS = 10 * 60 * 1000;

export interface PluginUpdate {
  id: string;
  /** Localized display name, for toasts. */
  name: string;
  installed: string;
  latest: string;
  url: string;
  sha256: string | undefined;
  minHostVersion: string | undefined;
}

export interface PluginUpdatesStore {
  checking: boolean;
  /** When the last check finished (ms since epoch); `null` before the first one. */
  checkedAt: number | null;
  /** Message of the last failed check; cleared by a successful one. */
  error: string | null;
  begin(): void;
  finish(error: string | null): void;
}

export const usePluginUpdatesStore = create<PluginUpdatesStore>((set) => ({
  checking: false,
  checkedAt: null,
  error: null,
  begin() {
    set({ checking: true });
  },
  finish(error) {
    set({ checking: false, checkedAt: Date.now(), error });
  },
}));

/** Whether a plugin that needs `minHostVersion` runs on `hostVersion` (unknown host: yes). */
function hostSatisfies(hostVersion: string | null, minHostVersion: string | undefined): boolean {
  if (minHostVersion === undefined || hostVersion === null) return true;
  return compareVersions(hostVersion, minHostVersion) >= 0;
}

/**
 * The installed external plugins the index lists at a newer version, in index order. Ones
 * that need a newer host are included (the user should know), but never auto-installed.
 */
export function availablePluginUpdates(
  registry: readonly PluginRegistryEntry[],
  installed: readonly PluginEntry[],
): PluginUpdate[] {
  const locale = currentLocale();
  const chain = fallbackChain(locale);
  const updates: PluginUpdate[] = [];
  for (const entry of registry) {
    const plugin = installed.find((candidate) => candidate.id === entry.id);
    if (!plugin || plugin.source !== 'external') continue;
    if (compareVersions(entry.version, plugin.manifest.version) <= 0) continue;
    updates.push({
      id: entry.id,
      name: resolveLocalized(entry.name, locale, chain) || entry.id,
      installed: plugin.manifest.version,
      latest: entry.version,
      url: entry.url,
      sha256: entry.sha256,
      minHostVersion: entry.minHostVersion,
    });
  }
  return updates;
}

function currentUpdates(): PluginUpdate[] {
  const registry = useMarketplaceStore.getState().registry;
  return availablePluginUpdates(registry?.plugins ?? [], usePluginsStore.getState().entries);
}

/** The updates the cached index offers for the installed plugins; recomputed as either changes. */
export function usePluginUpdates(): PluginUpdate[] {
  const registry = useMarketplaceStore((state) => state.registry);
  const entries = usePluginsStore((state) => state.entries);
  return useMemo(
    () => availablePluginUpdates(registry?.plugins ?? [], entries),
    [registry, entries],
  );
}

/**
 * Fetches the index (unless a fresh copy exists and `force` is not set), installs what
 * `plugins.autoUpdate` allows, and resolves to the updates still pending, or to `null`
 * when the fetch failed or a check is already running. The outcome is kept in
 * {@link usePluginUpdatesStore} for the Settings tab.
 */
export async function checkPluginUpdates(
  options: { force?: boolean } = {},
): Promise<PluginUpdate[] | null> {
  const store = usePluginUpdatesStore.getState();
  if (store.checking) return null;
  store.begin();
  try {
    const market = useMarketplaceStore.getState();
    const fresh =
      market.registry !== null &&
      market.fetchedAt !== null &&
      Date.now() - market.fetchedAt < FRESH_FOR_MS;
    if (options.force || !fresh) {
      const error = await fetchPluginRegistry();
      if (error) {
        usePluginUpdatesStore.getState().finish(error);
        return null;
      }
    }
    if (getSettings().plugins.autoUpdate) await installUpdates(currentUpdates());
    usePluginUpdatesStore.getState().finish(null);
    return currentUpdates();
  } catch (error) {
    usePluginUpdatesStore.getState().finish(errorMessage(error));
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
/** `<id>@<version>` pairs already announced with a toast, so a version is announced once. */
const announced = new Set<string>();

/**
 * Starts the periodic checks (once per app start). Honours `settings.plugins.checkUpdates`
 * live: switching it on schedules a check, switching it off cancels the pending one.
 */
export function startPluginUpdateChecks(): void {
  if (started) return;
  started = true;
  if (!isTauri()) return;
  schedule(FIRST_CHECK_DELAY_MS);
  useSettingsStore.subscribe((state, previous) => {
    if (state.settings.plugins.checkUpdates === previous.settings.plugins.checkUpdates) return;
    schedule(FIRST_CHECK_DELAY_MS);
  });
}

function schedule(delayMs: number): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!getSettings().plugins.checkUpdates) return;
  timer = setTimeout(() => {
    timer = null;
    void runScheduledCheck().finally(() => schedule(CHECK_INTERVAL_MS));
  }, delayMs);
}

async function runScheduledCheck(): Promise<void> {
  const updates = await checkPluginUpdates();
  if (!updates || updates.length === 0) return;
  // Auto-update has installed what it could by now; what is left (everything, when it
  // is off) is announced once per version.
  const unannounced = updates.filter((update) => !announced.has(`${update.id}@${update.latest}`));
  if (unannounced.length === 0) return;
  for (const update of updates) announced.add(`${update.id}@${update.latest}`);
  useUiStore
    .getState()
    .toast(t('plugins.updates.toastAvailable', { count: updates.length }), 'info', {
      label: t('plugins.updates.view'),
      run: () => openExtensionsPanel('updates'),
    });
}

/** Installs the updates this host supports, one after the other; each reports its own toast. */
async function installUpdates(updates: PluginUpdate[]): Promise<void> {
  const hostVersion = useSettingsStore.getState().appInfo?.version ?? null;
  for (const update of updates) {
    if (!hostSatisfies(hostVersion, update.minHostVersion)) continue;
    await installPlugin(
      (replace) =>
        call('plugins_install_from_url', {
          url: update.url,
          ...(update.sha256 ? { sha256: update.sha256 } : {}),
          ...(replace ? { replace: true } : {}),
        }),
      { replace: true },
    );
  }
}
