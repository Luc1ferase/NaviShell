/** Small helpers on the loaded text: indentation guess, line endings, sizes, errors. */

export type LineEnding = 'lf' | 'crlf';

export interface IndentGuess {
  kind: 'spaces' | 'tabs';
  /** Spaces per level, or the display width of a tab. */
  size: number;
}

const DEFAULT_INDENT: IndentGuess = { kind: 'spaces', size: 4 };
const SAMPLE_LINES = 400;

/**
 * Guesses the indentation: tabs when most indented lines start with one, else the most
 * common change in leading spaces between consecutive non-blank lines among 2, 4 and 8
 * (ties keep 4). Files with nothing indented get the default.
 */
export function guessIndent(text: string): IndentGuess {
  let tabs = 0;
  let spaces = 0;
  const votes: Record<number, number> = { 2: 0, 4: 0, 8: 0 };
  let previous = 0;
  let seen = 0;
  let pos = 0;
  while (pos < text.length && seen < SAMPLE_LINES) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end);
    pos = end + 1;
    if (line.trim() === '') continue;
    if (line.startsWith('\t')) {
      tabs += 1;
      seen += 1;
      continue;
    }
    let width = 0;
    while (width < line.length && line.charCodeAt(width) === 32) width += 1;
    if (width > 0) {
      spaces += 1;
      seen += 1;
    }
    const delta = Math.abs(width - previous);
    if (delta === 2 || delta === 4 || delta === 8) votes[delta] = (votes[delta] ?? 0) + 1;
    previous = width;
  }
  if (tabs === 0 && spaces === 0) return DEFAULT_INDENT;
  if (tabs > spaces) return { kind: 'tabs', size: DEFAULT_INDENT.size };
  let best = 4;
  for (const candidate of [2, 8]) {
    if ((votes[candidate] ?? 0) > (votes[best] ?? 0)) best = candidate;
  }
  return { kind: 'spaces', size: best };
}

export function detectLineEnding(text: string): LineEnding {
  return text.includes('\r\n') ? 'crlf' : 'lf';
}

/** CodeMirror keeps LF internally; put the file's own line ending back for saving. */
export function withLineEnding(text: string, eol: LineEnding): string {
  return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

/** The message of an `Error` or of a `{ message }` IPC error; anything else stringified. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
