import type { ITheme } from '@xterm/xterm';
import type { TerminalSettings } from '../ipc/contract';
import { resolveScheme } from './schemes';

/** The xterm palette for a terminal: the scheme the settings assign to the current UI theme. */
export function terminalTheme(settings: TerminalSettings, uiTheme: 'dark' | 'light'): ITheme {
  return { ...resolveScheme(settings.colorScheme[uiTheme], uiTheme).theme };
}
