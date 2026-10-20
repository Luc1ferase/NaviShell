/**
 * How the terminal `fontFamily` setting maps onto the font picker in Settings.
 *
 * The setting stays a plain CSS `font-family` list, so xterm and the Rust side need no
 * changes. The picker writes one of three shapes:
 * - the default stack ({@link DEFAULT_FONT_STACK}) for "Automatic",
 * - `"<family>", <default stack>` when a font was picked from the installed list, so glyphs
 *   the chosen font lacks (CJK, symbols, box drawing) still fall back sensibly,
 * - anything else typed by hand ("Custom").
 */

import { DEFAULT_SETTINGS } from '../ipc/contract';

export const DEFAULT_FONT_STACK = DEFAULT_SETTINGS.terminal.fontFamily;

export type FontChoice = { kind: 'auto' } | { kind: 'family'; name: string } | { kind: 'custom' };

/** CSS `font-family` value for a picked family, with the default stack as fallbacks. */
export function fontFamilyFor(name: string): string {
  return `"${name.replace(/["\\]/g, '')}", ${DEFAULT_FONT_STACK}`;
}

/** Classifies a stored `fontFamily` value into what the picker should show. */
export function parseFontFamily(value: string): FontChoice {
  const trimmed = value.trim();
  if (trimmed === DEFAULT_FONT_STACK) return { kind: 'auto' };
  const match = /^"([^"]+)",\s*([\s\S]*)$/.exec(trimmed);
  const name = match?.[1];
  if (name !== undefined && match?.[2] === DEFAULT_FONT_STACK) return { kind: 'family', name };
  return { kind: 'custom' };
}
