import { useSyncExternalStore } from 'react';
import type { AppSettings } from '../ipc/contract';
import { getSettings } from '../stores/settings';
import { createEmitter } from '../util/events';

export type ResolvedTheme = 'dark' | 'light';

const themeApplied = createEmitter<ResolvedTheme>();
/** Fires after the document switched between dark and light (settings or OS change). */
export const onDidApplyTheme = themeApplied.event;
let applied: ResolvedTheme = 'dark';

export function resolveTheme(theme: AppSettings['theme']): ResolvedTheme {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function currentTheme(): ResolvedTheme {
  return resolveTheme(getSettings().theme);
}

/** The theme the document currently shows (what `applyThemeToDocument` last set). */
export function appliedTheme(): ResolvedTheme {
  return applied;
}

export function applyThemeToDocument(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (applied === theme) return;
  applied = theme;
  themeApplied.fire(theme);
}

function subscribe(listener: () => void): () => void {
  const subscription = onDidApplyTheme(listener);
  return () => subscription.dispose();
}

/** React hook: re-renders when the document theme flips. */
export function useAppliedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, appliedTheme, appliedTheme);
}
