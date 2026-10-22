/**
 * The active file icon theme: which of the themes plugins registered the user picked, the
 * icon it gives an entry, and a change event for the views that draw file lists.
 *
 * The choice lives in the settings (`fileIconTheme`, a `<pluginId>:<themeId>` key or
 * `null`); the themes live in the plugin registry. A chosen theme that is not registered
 * right now (its plugin is disabled, still loading, or uninstalled) means the host icons
 * are drawn, and the choice is kept so the theme comes back with its plugin.
 */

import { resolveLocalized } from '@navishell/plugin-api';
import type { FileIcon, FileIconRequest } from '@navishell/plugin-api';

import { currentLocale } from '../i18n';
import { useRegistryStore, type FileIconThemeEntry } from '../plugins/registry';
import { onDidChangeSettings, useSettingsStore } from '../stores/settings';
import { createEmitter } from '../util/events';

const themeChanged = createEmitter<void>();

/** Fires when the active theme changes, by choice or because a theme came or went. */
export const onDidChangeFileIconTheme = themeChanged.event;

/** The chosen theme's key, or `null` for the host icons. */
export function fileIconThemeKey(): string | null {
  return useSettingsStore.getState().settings.fileIconTheme;
}

/** Every registered theme, in registration order. */
export function listFileIconThemes(): FileIconThemeEntry[] {
  return useRegistryStore.getState().fileIconThemes;
}

/** The label of a theme in the current UI language. */
export function fileIconThemeLabel(entry: FileIconThemeEntry): string {
  return resolveLocalized(entry.theme.label, currentLocale()) || entry.theme.id;
}

/** The chosen theme when it is registered; `undefined` otherwise. */
export function activeFileIconTheme(): FileIconThemeEntry | undefined {
  const key = fileIconThemeKey();
  if (key === null) return undefined;
  return listFileIconThemes().find((entry) => entry.key === key);
}

export function setFileIconTheme(key: string | null): void {
  const store = useSettingsStore.getState();
  if (store.settings.fileIconTheme === key) return;
  store.update((prev) => ({ ...prev, fileIconTheme: key }));
}

/**
 * The active theme's icon for an entry. `undefined` means "draw the host's own icon": no
 * theme is active, or the theme has nothing for this entry. A theme that throws is treated
 * the same way, so one bad lookup cannot blank a file list.
 */
export function resolveFileIcon(request: FileIconRequest): FileIcon | undefined {
  const entry = activeFileIconTheme();
  if (!entry) return undefined;
  try {
    return entry.theme.icon(request) ?? undefined;
  } catch (error) {
    console.warn(`[navishell] file icon theme ${entry.key} failed`, error);
    return undefined;
  }
}

/** `data:` URL for an icon, so views can hand either shape to an `<img>`. */
export function fileIconSrc(icon: FileIcon): string {
  if ('url' in icon) return icon.url;
  return `data:image/svg+xml;utf8,${encodeURIComponent(icon.svg)}`;
}

// The event fires on every change of what `activeFileIconTheme()` would answer: the
// choice, or the set of registered themes (a theme arriving or leaving may or may not be
// the chosen one, so compare the resolved entry rather than the lists).
let lastActive: FileIconThemeEntry | undefined = activeFileIconTheme();

function notifyIfChanged(): void {
  const next = activeFileIconTheme();
  if (next === lastActive) return;
  lastActive = next;
  themeChanged.fire();
}

useRegistryStore.subscribe((state, previous) => {
  if (state.fileIconThemes !== previous.fileIconThemes) notifyIfChanged();
});
onDidChangeSettings(() => notifyIfChanged());
