import { create } from 'zustand';

import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type TerminalSettings,
} from '../ipc/contract';
import { call } from '../ipc/client';
import { debounce } from '../util/fn';
import { createEmitter } from '../util/events';

const settingsChanged = createEmitter<AppSettings>();
export const onDidChangeSettings = settingsChanged.event;

/** Fill in anything a stored settings file is missing (forward/backward compatibility). */
export function mergeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const terminal: TerminalSettings = { ...DEFAULT_SETTINGS.terminal, ...(raw?.terminal ?? {}) };
  return {
    locale: raw?.locale ?? DEFAULT_SETTINGS.locale,
    theme: raw?.theme ?? DEFAULT_SETTINGS.theme,
    terminal,
    plugins: {
      disabled: raw?.plugins?.disabled ?? [],
      seenPanels: raw?.plugins?.seenPanels ?? [],
    },
    closeConnectionWithLastTerminal:
      raw?.closeConnectionWithLastTerminal ?? DEFAULT_SETTINGS.closeConnectionWithLastTerminal,
  };
}

const persist = debounce((settings: AppSettings) => {
  void call('settings_set', { settings }).catch((error) => {
    console.error('[navishell] failed to persist settings', error);
  });
}, 300);

export interface SettingsStore {
  settings: AppSettings;
  appInfo: AppInfo | null;
  /** Load settings without writing them back. */
  hydrate(settings: AppSettings): void;
  setAppInfo(info: AppInfo | null): void;
  /** Apply a change and persist it. */
  update(mutate: (prev: AppSettings) => AppSettings): void;
  updateTerminal(partial: Partial<TerminalSettings>): void;
  markPanelSeen(panelId: string): void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  appInfo: null,
  hydrate(settings) {
    set({ settings });
    settingsChanged.fire(settings);
  },
  setAppInfo(info) {
    set({ appInfo: info });
  },
  update(mutate) {
    const next = mutate(get().settings);
    set({ settings: next });
    settingsChanged.fire(next);
    persist(next);
  },
  updateTerminal(partial) {
    get().update((prev) => ({ ...prev, terminal: { ...prev.terminal, ...partial } }));
  },
  markPanelSeen(panelId) {
    const { settings } = get();
    if (settings.plugins.seenPanels.includes(panelId)) return;
    get().update((prev) => ({
      ...prev,
      plugins: { ...prev.plugins, seenPanels: [...prev.plugins.seenPanels, panelId] },
    }));
  },
}));

export function getSettings(): AppSettings {
  return useSettingsStore.getState().settings;
}

export function getAppInfo(): AppInfo | null {
  return useSettingsStore.getState().appInfo;
}

export function flushSettings(): void {
  persist.flush();
}
