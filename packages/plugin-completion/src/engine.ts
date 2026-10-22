/**
 * Suggestion engine, tokenisation and popup geometry.
 *
 * Everything in this file is a pure function of its arguments (no host APIs, no DOM), so it
 * can be reasoned about and unit tested in isolation once the project gets a test runner.
 * The only state is a memoised {@link CandidateIndex} per candidate array, which is an
 * implementation detail of the pure functions below.
 */

import type { CursorPixelPosition, Locale } from '@navishell/plugin-api';
import type { DictionaryEntry } from './dictionary';

/**
 * Where a candidate came from:
 *
 * - `history`: commands the user ran, per server (or `local`),
 * - `remote`: executables on the remote `PATH` (`compgen -c`),
 * - `path`: entries of a remote directory, for the token being typed,
 * - `dict`: the built-in dictionary of common commands.
 */
export type SuggestionSource = 'history' | 'remote' | 'path' | 'dict';

export interface Suggestion {
  /** The full command line that is put on the prompt when the candidate is accepted. */
  value: string;
  /** What the popup shows: the whole line, or just the path token for `path` items. */
  label: string;
  source: SuggestionSource;
  /** Short help text; empty for everything but dictionary entries. */
  description: string;
  /** Index in {@link label} where the typed text matched, or `-1` for fuzzy matches. */
  matchStart: number;
  matchLength: number;
  score: number;
}

export interface SuggestOptions {
  /** The tracked input line (may contain leading spaces). */
  line: string;
  /** History for this terminal's server (or `local`), most recent first. */
  history: readonly string[];
  /** Executable names on the remote `PATH`; empty for local terminals. */
  remote: readonly string[];
  dictionary: readonly DictionaryEntry[];
  /** Names in the directory the current token points at; directories end with `/`. */
  paths: readonly string[];
  /** Tokenisation of {@link line}; see {@link analyzeToken}. */
  token: TokenContext;
  locale: Locale;
  /**
   * Description of a dictionary command in the current locale from the plugin's i18n
   * namespace (`dict.<command>`, filled by language packs); `undefined` falls back to the
   * built-in en / zh-CN text.
   */
  describe?: (command: string) => string | undefined;
  maxItems: number;
  minChars: number;
}

/**
 * Scores: a path candidate wins while a path is being typed, then history, then remote
 * executables, then the dictionary; exact prefix beats substring beats fuzzy.
 */
const SCORE = {
  pathPrefix: 1400,
  historyPrefix: 1000,
  remotePrefix: 840,
  dictPrefix: 700,
  historySubstring: 460,
  remoteSubstring: 380,
  dictSubstring: 300,
  historyFuzzy: 200,
  remoteFuzzy: 150,
  dictFuzzy: 120,
  /** A bare directory listing (nothing typed yet) ranks below history. */
  pathListing: 900,
} as const;

/** How many history entries still get a recency bonus. */
const RECENCY_WINDOW = 200;
/** Shortest query that may match out of order. */
const FUZZY_MIN_CHARS = 3;

interface SourceScores {
  prefix: number;
  substring: number;
  fuzzy: number;
}

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

function describe(
  entry: DictionaryEntry,
  locale: Locale,
  translate: SuggestOptions['describe'],
): string {
  const builtin = entry.description as Partial<Record<Locale, string>>;
  return translate?.(entry.command) ?? builtin[locale] ?? entry.description.en;
}

// ---------------------------------------------------------------------------
// Candidate index
// ---------------------------------------------------------------------------

/**
 * A candidate list prepared for repeated lookups: lowercased once, and bucketed by first
 * character so the prefix pass only looks at a fraction of the candidates.
 */
export interface CandidateIndex {
  readonly values: readonly string[];
  /** `values`, lowercased, same order. */
  readonly lower: readonly string[];
  /** Lowercased first character -> indices into {@link values}. */
  readonly buckets: ReadonlyMap<string, readonly number[]>;
}

const STRING_INDEX = new WeakMap<readonly string[], CandidateIndex>();
const DICTIONARY_INDEX = new WeakMap<readonly DictionaryEntry[], CandidateIndex>();

function buildIndex(values: readonly string[]): CandidateIndex {
  const lower: string[] = [];
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < values.length; i += 1) {
    const low = (values[i] ?? '').toLowerCase();
    lower.push(low);
    const first = low.slice(0, 1);
    const bucket = buckets.get(first);
    if (bucket) bucket.push(i);
    else buckets.set(first, [i]);
  }
  return { values, lower, buckets };
}

/**
 * Index for a candidate array, memoised on the array itself. Callers keep their arrays
 * immutable (a new array per change), so a new array means a rebuilt index and an unchanged
 * one costs a single map lookup per keystroke.
 */
export function indexCandidates(values: readonly string[]): CandidateIndex {
  const cached = STRING_INDEX.get(values);
  if (cached) return cached;
  const index = buildIndex(values);
  STRING_INDEX.set(values, index);
  return index;
}

/** Same, for the dictionary: index `i` of the index is entry `i` of the dictionary. */
export function indexDictionary(entries: readonly DictionaryEntry[]): CandidateIndex {
  const cached = DICTIONARY_INDEX.get(entries);
  if (cached) return cached;
  const index = buildIndex(entries.map((entry) => entry.command));
  DICTIONARY_INDEX.set(entries, index);
  return index;
}

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

/** Commands whose arguments are paths even before a `/` has been typed. */
const PATH_COMMANDS: ReadonlySet<string> = new Set([
  'cd',
  'ls',
  'cat',
  'vim',
  'nano',
  'less',
  'tail',
  'head',
  'cp',
  'mv',
  'rm',
]);

export interface TokenContext {
  /** Index in the line where the token being typed starts. */
  start: number;
  /** The token being typed; empty when the line ends with a space. */
  token: string;
  /** Lowercased word before the token; `''` when the token is the first word. */
  previous: string;
  /** Directory part of {@link token}, including its trailing slash; `''` means the cwd. */
  dir: string;
  /** Name part of {@link token} that is being completed. */
  base: string;
  /** `true` when this position should be completed as a filesystem path. */
  isPath: boolean;
}

function lastTokenStart(line: string): number {
  for (let i = line.length - 1; i >= 0; i -= 1) {
    const char = line[i];
    if (char === ' ' || char === '\t') return i + 1;
  }
  return 0;
}

/**
 * Split the current token off the line and decide whether it is a path.
 *
 * Quoting and escaped spaces are deliberately not handled: the tracked line is already a
 * best-effort reconstruction, and a wrong guess only costs a directory listing nobody uses.
 */
export function analyzeToken(line: string): TokenContext {
  const start = lastTokenStart(line);
  const token = line.slice(start);
  const before = line.slice(0, start).trimEnd();
  const previous = before.slice(lastTokenStart(before)).toLowerCase();
  const slash = token.lastIndexOf('/');
  const dir = slash >= 0 ? token.slice(0, slash + 1) : '';
  const base = slash >= 0 ? token.slice(slash + 1) : token;
  const isPath = token.includes('/') || token.startsWith('~') || PATH_COMMANDS.has(previous);
  return { start, token, previous, dir, base, isPath };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Candidate list for the current input line: path entries while a path is being typed,
 * then history prefix matches (recency weighted), remote executables and the dictionary,
 * and finally substring and fuzzy matches from the same three sources.
 */
export function suggest(options: SuggestOptions): Suggestion[] {
  const { token, locale, maxItems, minChars } = options;
  const query = options.line.replace(/^\s+/, '');
  if (query.length < Math.max(1, minChars)) return [];
  const needle = query.toLowerCase();
  const first = needle.slice(0, 1);

  const best = new Map<string, Suggestion>();
  const offer = (candidate: Suggestion): void => {
    if (candidate.value === query) return;
    const previous = best.get(candidate.value);
    if (!previous || previous.score < candidate.score) best.set(candidate.value, candidate);
  };

  /**
   * Three passes over one source: the first-character bucket for prefix matches, then a
   * full scan for substring and fuzzy matches - which is only paid for when the cheap pass
   * did not already fill the popup.
   */
  const scan = (
    index: CandidateIndex,
    source: SuggestionSource,
    scores: SourceScores,
    bonus?: (position: number) => number,
    description?: (position: number) => string,
  ): void => {
    const { values, lower } = index;
    for (const i of index.buckets.get(first) ?? []) {
      const value = values[i];
      if (value === undefined || !lower[i]?.startsWith(needle)) continue;
      offer({
        value,
        label: value,
        source,
        description: description?.(i) ?? '',
        matchStart: 0,
        matchLength: query.length,
        score: scores.prefix + (bonus?.(i) ?? 0) - lengthPenalty(value),
      });
    }
    if (best.size >= maxItems * 2) return;
    const fuzzy = needle.length >= FUZZY_MIN_CHARS;
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      const haystack = lower[i];
      if (value === undefined || haystack === undefined) continue;
      // Position 0 is what the prefix pass above already offered.
      const at = haystack.indexOf(needle, 1);
      if (at > 0) {
        offer({
          value,
          label: value,
          source,
          description: description?.(i) ?? '',
          matchStart: at,
          matchLength: query.length,
          score: scores.substring + (bonus?.(i) ?? 0) - lengthPenalty(value),
        });
      } else if (at < 0 && fuzzy && isSubsequence(needle, haystack)) {
        offer({
          value,
          label: value,
          source,
          description: description?.(i) ?? '',
          matchStart: -1,
          matchLength: 0,
          score: scores.fuzzy + (bonus?.(i) ?? 0) / 4 - lengthPenalty(value),
        });
      }
    }
  };

  if (token.isPath) offerPaths(options, offer);

  const history = indexCandidates(options.history);
  scan(
    history,
    'history',
    {
      prefix: SCORE.historyPrefix,
      substring: SCORE.historySubstring,
      fuzzy: SCORE.historyFuzzy,
    },
    (position) => Math.max(0, RECENCY_WINDOW - position),
  );

  if (options.remote.length > 0) {
    scan(indexCandidates(options.remote), 'remote', {
      prefix: SCORE.remotePrefix,
      substring: SCORE.remoteSubstring,
      fuzzy: SCORE.remoteFuzzy,
    });
  }

  const dictionary = options.dictionary;
  scan(
    indexDictionary(dictionary),
    'dict',
    { prefix: SCORE.dictPrefix, substring: SCORE.dictSubstring, fuzzy: SCORE.dictFuzzy },
    (position) => (dictionary[position]?.sub === false ? 25 : 0),
    (position) => {
      const entry = dictionary[position];
      return entry ? describe(entry, locale, options.describe) : '';
    },
  );

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, Math.max(1, maxItems));
}

/**
 * Path candidates: the listing is already scoped to the directory the token points at, so
 * only the name part has to match. Hidden entries stay hidden until the user types a dot.
 */
function offerPaths(options: SuggestOptions, offer: (candidate: Suggestion) => void): void {
  const { token, paths } = options;
  if (paths.length === 0) return;
  const base = token.base.toLowerCase();
  const prefix = options.line.slice(0, token.start);
  const hidden = token.base.startsWith('.');
  const directoriesFirst = token.previous === 'cd';
  const score = token.base === '' ? SCORE.pathListing : SCORE.pathPrefix;
  for (const entry of paths) {
    if (!hidden && entry.startsWith('.')) continue;
    if (!entry.toLowerCase().startsWith(base)) continue;
    const label = token.dir + entry;
    offer({
      value: prefix + label,
      label,
      source: 'path',
      description: '',
      matchStart: token.dir.length,
      matchLength: token.base.length,
      score: score + (directoriesFirst && entry.endsWith('/') ? 20 : 0) - lengthPenalty(entry),
    });
  }
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
