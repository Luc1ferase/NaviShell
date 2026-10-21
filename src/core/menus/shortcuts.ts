/**
 * Shortcut hints for menu items. Menus only display them; the bindings live wherever the
 * key is handled (xterm's custom key handler, the window keydown listener).
 */

/** Whether the app runs on macOS, where the modifier is Command and labels use symbols. */
export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.userAgent,
  );

/**
 * Formats a chord written with `Mod`, `Ctrl`, `Shift`, `Alt` and a key, e.g.
 * `Mod+Shift+C`, the way menus on this platform show it: `Ctrl+Shift+C` on Windows and
 * Linux, `⇧⌘C` on macOS. `Mod` is Command on macOS and Ctrl elsewhere.
 */
export function shortcutLabel(chord: string): string {
  const parts = chord.split('+').map((part) => part.trim());
  const key = parts.pop() ?? '';
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  if (isMac) {
    return (
      (modifiers.has('ctrl') ? '⌃' : '') +
      (modifiers.has('alt') ? '⌥' : '') +
      (modifiers.has('shift') ? '⇧' : '') +
      (modifiers.has('mod') ? '⌘' : '') +
      key.toUpperCase()
    );
  }
  const labels: string[] = [];
  if (modifiers.has('ctrl') || modifiers.has('mod')) labels.push('Ctrl');
  if (modifiers.has('alt')) labels.push('Alt');
  if (modifiers.has('shift')) labels.push('Shift');
  labels.push(key.length === 1 ? key.toUpperCase() : key);
  return labels.join('+');
}
