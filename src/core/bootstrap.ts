/**
 * Startup sequence: settings -> i18n -> theme -> app info -> servers -> plugins -> layout.
 *
 * Every step is individually guarded: a failing step degrades the app, it never stops it
 * from rendering.
 */

import type { JsonValue } from '@navishell/plugin-api';

import { call, errorMessage } from './ipc/client';
import { DEFAULT_SETTINGS, type AppSettings } from './ipc/contract';
import { initI18n, resolveLocale } from './i18n';
import { loadPlugins } from './plugins/loader';
import { syncConnections } from './services/connect';
import { loadServers } from './services/servers';
import { applyThemeToDocument, resolveTheme } from './services/theme';
import { mergeSettings, useSettingsStore } from './stores/settings';

export type BootstrapStep =
  'settings' | 'i18n' | 'appInfo' | 'servers' | 'plugins' | 'layout' | 'done';

export interface BootstrapResult {
  settings: AppSettings;
  /** Saved dockview layout, or `null` when there is none. */
  layout: JsonValue | null;
  /** Non-fatal problems, surfaced as toasts once the UI is up. */
  warnings: string[];
}

export interface BootstrapOptions {
  onStep?: (step: BootstrapStep) => void;
  /** Runs once i18n is ready and before any plugin is activated. */
  beforePlugins?: () => void;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const { onStep, beforePlugins } = options;
  const warnings: string[] = [];

  onStep?.('settings');
  let settings = DEFAULT_SETTINGS;
  try {
    settings = mergeSettings(await call('settings_get', {}));
  } catch (error) {
    warnings.push(`settings_get: ${errorMessage(error)}`);
  }
  useSettingsStore.getState().hydrate(settings);
  applyThemeToDocument(resolveTheme(settings.theme));

  onStep?.('i18n');
  try {
    await initI18n(resolveLocale(settings.locale));
  } catch (error) {
    warnings.push(`i18n: ${errorMessage(error)}`);
  }

  onStep?.('appInfo');
  try {
    useSettingsStore.getState().setAppInfo(await call('app_info', {}));
  } catch (error) {
    warnings.push(`app_info: ${errorMessage(error)}`);
  }

  onStep?.('servers');
  try {
    await loadServers();
  } catch (error) {
    warnings.push(`servers_list: ${errorMessage(error)}`);
  }
  try {
    await syncConnections();
  } catch (error) {
    warnings.push(`ssh_list_connections: ${errorMessage(error)}`);
  }

  try {
    beforePlugins?.();
  } catch (error) {
    warnings.push(`host registration: ${errorMessage(error)}`);
  }

  onStep?.('plugins');
  await loadPlugins();

  onStep?.('layout');
  let layout: JsonValue | null = null;
  try {
    layout = await call('layout_get', {});
  } catch (error) {
    warnings.push(`layout_get: ${errorMessage(error)}`);
  }

  onStep?.('done');
  return { settings: useSettingsStore.getState().settings, layout, warnings };
}
