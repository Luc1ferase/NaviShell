/**
 * Suggestion engine and popup geometry.
 *
 * Everything in this file is a pure function of its arguments (no host APIs, no DOM), so it
 * can be reasoned about and unit tested in isolation once the project gets a test runner.
 */

import type { CursorPixelPosition, Locale } from '@navishell/plugin-api';
import type { DictionaryEntry } from './dictionary';

export type SuggestionSource = 'history' | 'dict';

export interface Suggestion {
  /** The full command that will be sent to the shell when accepted. */
  value: string;
  source: SuggestionSource;
  /** Short help text; empty for history entries. */
  description: string;
  /** Index in `value` where the typed text matched, or `-1` for fuzzy matches. */
  matchStart: number;
  matchLength: number;
  score: number;
}

export interface SuggestOptions {
  /** The tracked input line (may contain leading spaces). */
  line: string;
  /** Per-server history, most recent first. */
  history: readonly string[];
  dictionary: readonly DictionaryEntry[];
  locale: Locale;
  maxItems: number;
  minChars: number;
}

/** Scores: exact prefix beats substring beats fuzzy; history beats the dictionary. */
const SCORE = {
  historyPrefix: 1000,
  dictPrefix: 700,
  historySubstring: 460,
  dictSubstring: 300,
  historyFuzzy: 200,
  dictFuzzy: 120,
} as const;

/** How many history entries still get a recency bonus. */
const RECENCY_WINDOW = 200;

function lengthPenalty(value: string): number {
  return Math.min(value.length, 80) / 8;
}

/**
 * `true` when every character of `query` appears in `value` in order.
 * Used as the last-resort match so typos such as `dkr ps` still find `docker ps`.
 */
export function isSubsequence(query: string, value: string): boolean {
  if (query.length === 0) return true;
  let index = 0;
  for (const char of value) {
    if (char === query[index]) {
      index += 1;
      if (index === query.length) return true;
    }
  }
  return false;
}

function describe(entry: DictionaryEntry, locale: Locale): string {
  return entry.description[locale] ?? entry.description.en;
}

/**
 * Candidate list for the current input line: history prefix matches first (recency
 * weighted), then dictionary prefix matches, then substring and fuzzy matches.
 */
export function suggest(options: SuggestOptions): Suggestion[] {
  const { history, dictionary, locale, maxItems, minChars } = options;
  const query = options.line.replace(/^\s+/, '');
  if (query.length < Math.max(1, minChars)) return [];
  const needle = query.toLowerCase();

  const best = new Map<string, Suggestion>();
  const offer = (candidate: Suggestion): void => {
    if (candidate.value === query) return;
    const previous = best.get(candidate.value);
    if (!previous || previous.score < candidate.score) best.set(candidate.value, candidate);
  };

  history.forEach((value, index) => {
    const recency = Math.max(0, RECENCY_WINDOW - index);
    const haystack = value.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at === 0) {
      offer({
        value,
        source: 'history',
        description: '',
        matchStart: 0,
        matchLength: query.length,
        score: SCORE.historyPrefix + recency - lengthPenalty(value),
      });
    } else if (at > 0) {
      offer({
        value,
        source: 'history',
        description: '',
        matchStart: at,
        matchLength: query.length,
        score: SCORE.historySubstring + recency - lengthPenalty(value),
      });
    } else if (isSubsequence(needle, haystack)) {
      offer({
        value,
        source: 'history',
        description: '',
        matchStart: -1,
        matchLength: 0,
        score: SCORE.historyFuzzy + recency / 4 - lengthPenalty(value),
      });
    }
  });

  for (const entry of dictionary) {
    const haystack = entry.command.toLowerCase();
    const at = haystack.indexOf(needle);
    const base = {
      value: entry.command,
      source: 'dict' as const,
      description: describe(entry, locale),
    };
    if (at === 0) {
      offer({
        ...base,
        matchStart: 0,
        matchLength: query.length,
        score: SCORE.dictPrefix + (entry.sub ? 0 : 25) - lengthPenalty(entry.command),
      });
    } else if (at > 0) {
      offer({
        ...base,
        matchStart: at,
        matchLength: query.length,
        score: SCORE.dictSubstring - lengthPenalty(entry.command),
      });
    } else if (needle.length >= 3 && isSubsequence(needle, haystack)) {
      offer({
        ...base,
        matchStart: -1,
        matchLength: 0,
        score: SCORE.dictFuzzy - lengthPenalty(entry.command),
      });
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, Math.max(1, maxItems));
}

// ---------------------------------------------------------------------------
// Remote history parsing
// ---------------------------------------------------------------------------

const ZSH_EXTENDED = /^: \d+:\d+;/;

/**
 * Parse concatenated `~/.bash_history` / `~/.zsh_history` content.
 *
 * Handles the zsh extended format (`: <ts>:<n>;cmd`), drops `#`-prefixed timestamp lines,
 * trims and de-duplicates, and returns the commands most-recent-first (history files are
 * written oldest-first).
 */
export function parseRemoteHistory(raw: string): string[] {
  const commands: string[] = [];
  for (const rawLine of raw.split('\n')) {
    let line = rawLine.replace(/\r$/, '');
    if (ZSH_EXTENDED.test(line)) {
      const separator = line.indexOf(';');
      if (separator >= 0) line = line.slice(separator + 1);
    }
    line = line.trim();
    if (line === '' || line.startsWith('#')) continue;
    commands.push(line);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const command = commands[i];
    if (command === undefined || seen.has(command)) continue;
    seen.add(command);
    result.push(command);
  }
  return result;
}

/** Most-recent-first history with `command` moved to the front and duplicates removed. */
export function pushHistory(history: readonly string[], command: string, cap: number): string[] {
  const next = [command, ...history.filter((item) => item !== command)];
  return next.length > cap ? next.slice(0, cap) : next;
}

// ---------------------------------------------------------------------------
// Popup geometry
// ---------------------------------------------------------------------------

export interface PopupLayout {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  /** `true` when the popup had to be drawn above the cursor row. */
  flipped: boolean;
}

export interface PopupMetrics {
  rowHeight: number;
  width: number;
  /** Vertical padding + border of the popup box. */
  chrome: number;
  /** Minimum distance kept to the terminal edges. */
  margin: number;
}

export const DEFAULT_METRICS: PopupMetrics = {
  rowHeight: 26,
  width: 380,
  chrome: 30,
  margin: 4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Place the popup one row below the cursor, flipping above when it would not fit and
 * clamping both axes to the terminal element.
 */
export function computeLayout(
  cursor: CursorPixelPosition,
  container: { width: number; height: number },
  itemCount: number,
  metrics: PopupMetrics = DEFAULT_METRICS,
): PopupLayout {
  const { rowHeight, chrome, margin } = metrics;
  const width = clamp(metrics.width, 160, Math.max(160, container.width - margin * 2));
  const wanted = Math.max(1, itemCount) * rowHeight + chrome;
  const below = cursor.y + cursor.cellHeight + 2;
  const spaceBelow = container.height - below - margin;
  const spaceAbove = cursor.y - margin - 2;
  const flipped = wanted > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = Math.max(rowHeight, Math.min(wanted, flipped ? spaceAbove : spaceBelow));
  const top = flipped ? Math.max(margin, cursor.y - maxHeight - 2) : below;
  return {
    left: clamp(cursor.x, margin, Math.max(margin, container.width - width - margin)),
    top: clamp(top, margin, Math.max(margin, container.height - maxHeight - margin)),
    width,
    maxHeight,
    flipped,
  };
}
