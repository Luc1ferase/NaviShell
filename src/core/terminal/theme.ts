import type { ITheme } from '@xterm/xterm';

/** xterm palettes kept in step with `src/styles/theme.css`. */
export const TERMINAL_THEME_DARK: ITheme = {
  background: '#0d1117',
  foreground: '#d7dde5',
  cursor: '#2dd4bf',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(45, 212, 191, 0.26)',
  black: '#1c222b',
  red: '#f87171',
  green: '#4ac98a',
  yellow: '#e3b341',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#2dd4bf',
  white: '#b9c1cb',
  brightBlack: '#5b6673',
  brightRed: '#ff9492',
  brightGreen: '#6ee7a8',
  brightYellow: '#f2cc60',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#5eead4',
  brightWhite: '#f0f3f6',
};

export const TERMINAL_THEME_LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0d9488',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(13, 148, 136, 0.22)',
  black: '#24292f',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#0d9488',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#116329',
  brightYellow: '#7d4e00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#0f766e',
  brightWhite: '#8c959f',
};

export function terminalTheme(theme: 'dark' | 'light'): ITheme {
  return theme === 'light' ? TERMINAL_THEME_LIGHT : TERMINAL_THEME_DARK;
}
