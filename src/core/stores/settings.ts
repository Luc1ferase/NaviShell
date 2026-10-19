import { create } from 'zustand';

import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type LocalShellSettings,
  type TerminalSettings,
} from '../ipc/contract';
import { call } from '../ipc/client';
import { debounce } from '../util/fn';
import { createEmitter } from '../util/events';

/** The `updates` block of {@link AppSettings} (the contract declares it inline). */
export type UpdateSettings = AppSettings['updates'];

const settingsChanged = createEmitter<AppSettings>();
export const onDidChangeSettings = settingsChanged.event;

/** Fill in anything a stored settings file is missing (forward/backward compatibility). */
export function mergeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const terminal: TerminalSettings = { ...DEFAULT_SETTINGS.terminal, ...(raw?.terminal ?? {}) };
  const localShell: LocalShellSettings = {
    program: raw?.localShell?.program ?? DEFAULT_SETTINGS.localShell.program,
    args: raw?.localShell?.args ?? [...DEFAULT_SETTINGS.localShell.args],
  };
  return {
    locale: raw?.locale ?? DEFAULT_SETTINGS.locale,
    theme: raw?.theme ?? DEFAULT_SETTINGS.theme,
    terminal,
    localShell,
    updates: { ...DEFAULT_SETTINGS.updates, ...(raw?.updates ?? {}) },
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
  updateLocalShell(partial: Partial<LocalShellSettings>): void;
  updateUpdates(partial: Partial<UpdateSettings>): void;
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
  updateLocalShell(partial) {
    get().update((prev) => ({ ...prev, localShell: { ...prev.localShell, ...partial } }));
  },
  updateUpdates(partial) {
    get().update((prev) => ({ ...prev, updates: { ...prev.updates, ...partial } }));
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
