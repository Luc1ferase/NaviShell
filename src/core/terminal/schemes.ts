/**
 * Built-in terminal color schemes.
 *
 * The UI theme (dark / light) and the terminal palette are separate choices, the way
 * Windows Terminal, Tabby and Termius do it: the user picks one scheme to use while the UI
 * is dark and one while it is light, and any scheme may be used in either slot (a dark
 * terminal in a light UI is common). Palettes keep their upstream values; readability on
 * light backgrounds mostly comes from xterm's `minimumContrastRatio`, which the host sets.
 */

import type { ITheme } from '@xterm/xterm';

export type SchemeKind = 'dark' | 'light';

export interface TerminalColorScheme {
  id: string;
  /** Display name; well-known schemes keep their upstream names. */
  name: string;
  /** Whether the background is dark or light; only used to group and to fall back. */
  kind: SchemeKind;
  theme: ITheme;
}

const ANSI_SLOTS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

/** The 16 ANSI slots of a theme, in standard order. */
export function ansiColors(theme: ITheme): string[] {
  return ANSI_SLOTS.map((slot) => theme[slot] ?? '#000000');
}

interface SchemeSpec {
  id: string;
  name: string;
  kind: SchemeKind;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** Exactly 16 colors: normal black..white, then bright black..white. */
  ansi: string[];
}

function scheme(spec: SchemeSpec): TerminalColorScheme {
  const theme: ITheme = {
    background: spec.background,
    foreground: spec.foreground,
    cursor: spec.cursor,
    cursorAccent: spec.background,
    selectionBackground: spec.selection,
  };
  ANSI_SLOTS.forEach((slot, index) => {
    theme[slot] = spec.ansi[index];
  });
  return { id: spec.id, name: spec.name, kind: spec.kind, theme };
}

export const DEFAULT_DARK_SCHEME = 'navishell-dark';
export const DEFAULT_LIGHT_SCHEME = 'navishell-light';

// prettier-ignore
export const TERMINAL_SCHEMES: readonly TerminalColorScheme[] = [
  // -- dark ----------------------------------------------------------------
  scheme({
    id: DEFAULT_DARK_SCHEME,
    name: 'NaviShell Dark',
    kind: 'dark',
    background: '#0d1117',
    foreground: '#d7dde5',
    cursor: '#2dd4bf',
    selection: 'rgba(45, 212, 191, 0.26)',
    ansi: [
      '#1c222b', '#f87171', '#4ac98a', '#e3b341', '#58a6ff', '#bc8cff', '#2dd4bf', '#b9c1cb',
      '#5b6673', '#ff9492', '#6ee7a8', '#f2cc60', '#79c0ff', '#d2a8ff', '#5eead4', '#f0f3f6',
    ],
  }),
  scheme({
    id: 'one-half-dark',
    name: 'One Half Dark',
    kind: 'dark',
    background: '#282c34',
    foreground: '#dcdfe4',
    cursor: '#a3b3cc',
    selection: '#474e5d',
    ansi: [
      '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
      '#5d677a', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
    ],
  }),
  scheme({
    id: 'dracula',
    name: 'Dracula',
    kind: 'dark',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selection: '#44475a',
    ansi: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
    ],
  }),
  scheme({
    id: 'nord',
    name: 'Nord',
    kind: 'dark',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selection: '#434c5e',
    ansi: [
      '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
    ],
  }),
  scheme({
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    kind: 'dark',
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selection: '#665c54',
    ansi: [
      '#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2',
    ],
  }),
  scheme({
    id: 'monokai',
    name: 'Monokai',
    kind: 'dark',
    background: '#272822',
    foreground: '#fdfff1',
    cursor: '#c0c1b5',
    selection: '#57584f',
    ansi: [
      '#272822', '#f92672', '#a6e22e', '#e6db74', '#fd971f', '#ae81ff', '#66d9ef', '#fdfff1',
      '#6e7066', '#f92672', '#a6e22e', '#e6db74', '#fd971f', '#ae81ff', '#66d9ef', '#fdfff1',
    ],
  }),
  scheme({
    id: 'tomorrow-night',
    name: 'Tomorrow Night',
    kind: 'dark',
    background: '#1d1f21',
    foreground: '#c5c8c6',
    cursor: '#c5c8c6',
    selection: '#373b41',
    ansi: [
      '#1d1f21', '#cc6666', '#b5bd68', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#c5c8c6',
      '#969896', '#cc6666', '#b5bd68', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#ffffff',
    ],
  }),
  scheme({
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    kind: 'dark',
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selection: 'rgba(245, 224, 220, 0.3)',
    ansi: [
      '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f7aec2', '#c2ecbf', '#fcd682', '#aeccfc', '#f398da', '#b1eae1', '#a6adc8',
    ],
  }),
  scheme({
    id: 'solarized-dark',
    name: 'Solarized Dark',
    kind: 'dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    selection: '#073642',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
    ],
  }),
  scheme({
    id: 'campbell',
    name: 'Campbell',
    kind: 'dark',
    background: '#0c0c0c',
    foreground: '#cccccc',
    cursor: '#ffffff',
    selection: 'rgba(255, 255, 255, 0.3)',
    ansi: [
      '#0c0c0c', '#c50f1f', '#13a10e', '#c19c00', '#0037da', '#881798', '#3a96dd', '#cccccc',
      '#767676', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#f2f2f2',
    ],
  }),
  // -- light ---------------------------------------------------------------
  scheme({
    id: DEFAULT_LIGHT_SCHEME,
    name: 'NaviShell Light',
    kind: 'light',
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#0f766e',
    selection: 'rgba(15, 118, 110, 0.22)',
    ansi: [
      '#24292f', '#cf222e', '#116329', '#9a6700', '#0969da', '#8250df', '#0f766e', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#7d4e00', '#0550ae', '#6639ba', '#0d9488', '#8c959f',
    ],
  }),
  scheme({
    id: 'github-light',
    name: 'GitHub Light',
    kind: 'light',
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#0969da',
    selection: 'rgba(9, 105, 218, 0.2)',
    ansi: [
      '#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f',
    ],
  }),
  scheme({
    id: 'one-half-light',
    name: 'One Half Light',
    kind: 'light',
    background: '#fafafa',
    foreground: '#383a42',
    cursor: '#a5b4e5',
    selection: '#bfceff',
    ansi: [
      '#383a42', '#e45649', '#50a14f', '#c18401', '#0184bc', '#a626a4', '#0997b3', '#bababa',
      '#4f525e', '#e06c75', '#98c379', '#d8b36e', '#61afef', '#c678dd', '#56b6c2', '#ffffff',
    ],
  }),
  scheme({
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    kind: 'light',
    background: '#fbf1c7',
    foreground: '#3c3836',
    cursor: '#3c3836',
    selection: '#d5c4a1',
    ansi: [
      '#fbf1c7', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64',
      '#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#3c3836',
    ],
  }),
  scheme({
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    kind: 'light',
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    selection: 'rgba(220, 138, 120, 0.3)',
    ansi: [
      '#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
      '#6c6f85', '#e7103f', '#46b02f', '#e49931', '#3878f6', '#ef95d7', '#19a1a8', '#bcc0cc',
    ],
  }),
  scheme({
    id: 'solarized-light',
    name: 'Solarized Light',
    kind: 'light',
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    selection: '#eee8d5',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
    ],
  }),
];

const BY_ID = new Map(TERMINAL_SCHEMES.map((entry) => [entry.id, entry]));

/** Schemes of one kind, in display order. */
export function schemesOfKind(kind: SchemeKind): TerminalColorScheme[] {
  return TERMINAL_SCHEMES.filter((entry) => entry.kind === kind);
}

/** Look a scheme up by id; an unknown id (removed scheme, typo) falls back to the default of `kind`. */
export function resolveScheme(id: string | undefined, kind: SchemeKind): TerminalColorScheme {
  const found = id ? BY_ID.get(id) : undefined;
  if (found) return found;
  const fallbackId = kind === 'light' ? DEFAULT_LIGHT_SCHEME : DEFAULT_DARK_SCHEME;
  // Both defaults are declared in TERMINAL_SCHEMES above.
  return BY_ID.get(fallbackId) as TerminalColorScheme;
}
