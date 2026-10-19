import type { AppSettings } from '../ipc/contract';
import { getSettings } from '../stores/settings';

export type ResolvedTheme = 'dark' | 'light';

export function resolveTheme(theme: AppSettings['theme']): ResolvedTheme {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function currentTheme(): ResolvedTheme {
  return resolveTheme(getSettings().theme);
}

export function applyThemeToDocument(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
