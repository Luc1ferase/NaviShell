/**
 * Remote awareness for the completion plugin (issue #8).
 *
 * Three caches, all filled in the background and all optional - a cold cache just means
 * fewer candidates, never a slower keystroke:
 *
 * - **executables**: the names on the remote `PATH`, fetched once per connection,
 * - **cwd**: where each terminal currently is, learned from OSC 7 (and OSC 133/633
 *   `P;Cwd=`) which many shells emit on their own,
 * - **listings**: the entries of a remote directory, for completing a path token.
 *
 * Nothing here ever throws into the caller: every remote call is wrapped and failures are
 * logged at debug level and treated as "no data".
 */

import type { Disposable, PluginContext, TerminalHandle } from '@navishell/plugin-api';
import type { TokenContext } from './engine';

/** `compgen -c` lists commands, aliases, functions and builtins - exactly what a user types. */
const EXECUTABLES_COMMAND = 'bash -lc "compgen -c" 2>/dev/null | sort -u | head -n 8000';
/** For hosts without bash: whatever is on `PATH`. */
const EXECUTABLES_FALLBACK = 'ls -1 $(echo $PATH | tr ":" " ") 2>/dev/null | sort -u';
const HOME_COMMAND = 'printf "%s\\n" "$HOME"';

const EXEC_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 8_000;
/** How long a directory listing is reused before it is fetched again. */
const LISTING_TTL_MS = 10_000;
const EXECUTABLES_CAP = 8000;
const LISTING_CAP = 2000;
/** Quiet period after a new terminal's first output before the OSC 7 hook is injected. */
const INTEGRATION_DELAY_MS = 500;
/** Separator for the `<connectionId>/<dir>` listing key; cannot occur in either part. */
const KEY_SEPARATOR = '\u0000';

const EMPTY: readonly string[] = [];

/**
 * One line that makes bash and zsh report their cwd through OSC 7 after every prompt, then
 * reports it once immediately. Sent with a leading space so a shell with
 * `HISTCONTROL=ignorespace` (or zsh's `HIST_IGNORE_SPACE`) keeps it out of the history.
 */
const OSC7_SNIPPET =
  ` __navishell_osc7(){ printf '\\033]7;file://%s%s\\033\\\\'` +
  ` "\${HOSTNAME:-\${HOST:-localhost}}" "$PWD"; };` +
  ` if [ -n "$ZSH_VERSION" ]; then precmd_functions+=(__navishell_osc7);` +
  ` else PROMPT_COMMAND="__navishell_osc7\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi;` +
  ` __navishell_osc7`;

/** What a connection told us about itself. */
interface ConnectionData {
  executables: readonly string[];
  /** `$HOME`, used to resolve `~` and relative paths when the cwd is unknown. */
  home: string | null;
}

interface Listing {
  entries: readonly string[];
  /** `0` until the first successful (or failed) fetch. */
  fetchedAt: number;
  pending: boolean;
}

/** The directory entries to complete against, and how they were resolved. */
export interface PathLookup {
  entries: readonly string[];
  /** `true` when a relative token was resolved against `~` because the cwd is unknown. */
  relativeToHome: boolean;
}

const NOTHING: PathLookup = { entries: EMPTY, relativeToHome: false };

export class RemoteIndex {
  private readonly connections = new Map<string, ConnectionData>();
  private readonly listings = new Map<string, Listing>();
  private readonly cwds = new Map<string, string>();
  private readonly integrated = new Set<string>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private shellIntegration = false;
  private disposed = false;

  constructor(
    private readonly ctx: PluginContext,
    /** Called when data arrived that could change the suggestions on screen. */
    private readonly onChange: () => void,
  ) {}

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.connections.clear();
    this.listings.clear();
    this.cwds.clear();
    this.integrated.clear();
  }

  // -- connections ---------------------------------------------------------

  /** Executables on a connection's `PATH`; starts the one-time fetch when the cache is cold. */
  executables(connectionId: string | null): readonly string[] {
    if (connectionId === null) return EMPTY;
    const data = this.connections.get(connectionId);
    if (!data) {
      void this.fetchConnection(connectionId);
      return EMPTY;
    }
    return data.executables;
  }

  /** Drops the caches of connections that are no longer open. */
  retainConnections(ids: readonly string[]): void {
    const live = new Set(ids);
    for (const id of [...this.connections.keys()]) {
      if (live.has(id)) continue;
      this.connections.delete(id);
      const prefix = `${id}${KEY_SEPARATOR}`;
      for (const key of [...this.listings.keys()]) {
        if (key.startsWith(prefix)) this.listings.delete(key);
      }
    }
  }

  // -- terminals -----------------------------------------------------------

  /**
   * Watches a terminal's output stream for cwd reports. The returned disposables belong to
   * the caller (the controller disposes them with the rest of the terminal's subscriptions).
   *
   * Path completion is a nicety, so a host that does not hand out a usable xterm parser
   * costs us the cwd and nothing else - it must never break opening a terminal.
   */
  trackTerminal(terminal: TerminalHandle): Disposable[] {
    try {
      const { parser } = terminal.xterm;
      return [
        // OSC 7 is the de-facto "this is my cwd" sequence. Claim it: nothing else wants it.
        parser.registerOscHandler(7, (data) => this.rememberCwd(terminal.id, parseOsc7(data))),
        // VS Code-style shell integration carries the cwd as a property. Never claim these:
        // the prompt marks in the same range may matter to someone else.
        ...[133, 633].map((ident) =>
          parser.registerOscHandler(ident, (data) => {
            this.rememberCwd(terminal.id, parseCwdProperty(data));
            return false;
          }),
        ),
      ];
    } catch (error) {
      this.ctx.log.warn('[completion] could not watch the terminal for cwd reports', error);
      return [];
    }
  }

  forgetTerminal(terminalId: string): void {
    this.cwds.delete(terminalId);
    this.integrated.delete(terminalId);
  }

  /** The last cwd a terminal reported, or `null` when it never did. */
  cwd(terminalId: string): string | null {
    return this.cwds.get(terminalId) ?? null;
  }

  // -- shell integration (opt-in) ------------------------------------------

  setShellIntegration(enabled: boolean): void {
    this.shellIntegration = enabled;
  }

  /**
   * Teaches a fresh SSH shell to emit OSC 7, once per terminal and only when the user
   * turned shell integration on. Called when the terminal first produces output, which is
   * as close to "the first prompt is up" as the plugin can get.
   */
  injectShellIntegration(terminal: TerminalHandle): void {
    if (!this.shellIntegration || this.disposed) return;
    if (terminal.kind !== 'ssh' || this.integrated.has(terminal.id)) return;
    this.integrated.add(terminal.id);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.disposed || terminal.isDisposed) return;
      void terminal.write(`${OSC7_SNIPPET}\r`).catch((error: unknown) => {
        this.ctx.log.debug('[completion] could not install the cwd hook', error);
      });
    }, INTEGRATION_DELAY_MS);
    this.timers.add(timer);
  }

  // -- paths ---------------------------------------------------------------

  /**
   * Entries to complete the current path token against, listing the directory in the
   * background when the cache is cold or older than {@link LISTING_TTL_MS}.
   */
  paths(connectionId: string | null, terminalId: string, token: TokenContext): PathLookup {
    if (connectionId === null || !token.isPath) return NOTHING;
    const data = this.connections.get(connectionId);
    if (!data) {
      void this.fetchConnection(connectionId);
      return NOTHING;
    }
    const resolved = resolveDirectory(token.dir, this.cwd(terminalId), data.home);
    if (resolved === null) return NOTHING;
    const key = `${connectionId}${KEY_SEPARATOR}${resolved.dir}`;
    const listing = this.listings.get(key);
    if (!listing || (!listing.pending && Date.now() - listing.fetchedAt > LISTING_TTL_MS)) {
      void this.fetchListing(connectionId, key, resolved.dir);
    }
    return { entries: listing?.entries ?? EMPTY, relativeToHome: resolved.relativeToHome };
  }

  // -- fetching ------------------------------------------------------------

  private rememberCwd(terminalId: string, path: string | null): boolean {
    if (path === null || this.disposed) return false;
    if (this.cwds.get(terminalId) === path) return true;
    this.cwds.set(terminalId, path);
    return true;
  }

  /** Executables and `$HOME`, once per connection. Failures leave the cache empty. */
  private async fetchConnection(connectionId: string): Promise<void> {
    if (this.connections.has(connectionId) || this.disposed) return;
    // Claim the slot before awaiting so a burst of keystrokes only fetches once.
    this.connections.set(connectionId, { executables: EMPTY, home: null });
    const [home, executables] = await Promise.all([
      this.execLines(connectionId, HOME_COMMAND, EXEC_TIMEOUT_MS),
      this.fetchExecutables(connectionId),
    ]);
    if (this.disposed || !this.connections.has(connectionId)) return;
    this.connections.set(connectionId, { executables, home: home[0] ?? null });
    this.ctx.log.debug(
      `[completion] ${executables.length} executables on ${connectionId}, home ${home[0] ?? '?'}`,
    );
    if (executables.length > 0) this.onChange();
  }

  private async fetchExecutables(connectionId: string): Promise<readonly string[]> {
    const primary = await this.execLines(connectionId, EXECUTABLES_COMMAND, EXEC_TIMEOUT_MS);
    const lines =
      primary.length > 0
        ? primary
        : await this.execLines(connectionId, EXECUTABLES_FALLBACK, EXEC_TIMEOUT_MS);
    return [...new Set(lines.filter(isCommandName))].slice(0, EXECUTABLES_CAP);
  }

  private async fetchListing(connectionId: string, key: string, dir: string): Promise<void> {
    const existing = this.listings.get(key);
    if (existing?.pending) return;
    this.listings.set(key, {
      entries: existing?.entries ?? EMPTY,
      fetchedAt: existing?.fetchedAt ?? 0,
      pending: true,
    });
    const lines = await this.execLines(connectionId, `ls -1ap -- ${quote(dir)}`, LIST_TIMEOUT_MS);
    if (this.disposed) return;
    // `-a` includes `.` and `..`, which are never worth completing; `-p` is what marks
    // directories with a trailing slash.
    const entries = lines
      .filter((entry) => entry !== './' && entry !== '../')
      .slice(0, LISTING_CAP);
    // A failed listing is cached as empty on purpose: it stops us retrying every keystroke.
    this.listings.set(key, { entries, fetchedAt: Date.now(), pending: false });
    if (entries.length > 0) this.onChange();
  }

  /** One remote command, reduced to its non-empty stdout lines. Never rejects. */
  private async execLines(
    connectionId: string,
    command: string,
    timeoutMs: number,
  ): Promise<string[]> {
    try {
      const result = await this.ctx.connections.exec(connectionId, command, { timeoutMs });
      return result.stdout
        .split('\n')
        .map((line) => line.replace(/\r$/, '').trim())
        .filter((line) => line !== '');
    } catch (error) {
      this.ctx.log.debug(`[completion] remote lookup skipped: ${command}`, error);
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers (pure)
// ---------------------------------------------------------------------------

/** Plausible command name: `compgen -c` also prints keywords such as `[[` and `}`. */
function isCommandName(name: string): boolean {
  return name.length <= 64 && /^[A-Za-z0-9_@.+:-]+$/.test(name);
}

/** Single-quote a path for the remote shell; `'` becomes `'\''`. */
export function quote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** OSC 7 payload: `file://<host><absolute path>`, percent-encoded. */
export function parseOsc7(data: string): string | null {
  const scheme = 'file://';
  if (!data.startsWith(scheme)) return null;
  const slash = data.indexOf('/', scheme.length);
  return slash < 0 ? null : decodePath(data.slice(slash));
}

/** OSC 133/633 payload: `P;Cwd=<path>` (possibly among other properties). */
export function parseCwdProperty(data: string): string | null {
  const match = /^P;(?:.*;)?Cwd=(.*)$/.exec(data);
  return match ? decodePath(match[1] ?? '') : null;
}

function decodePath(raw: string): string | null {
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // A malformed escape is not worth giving up on; use the raw value instead.
  }
  path = path.trim();
  return path.startsWith('/') ? path : null;
}

interface ResolvedDir {
  /** Absolute remote directory to list. */
  dir: string;
  relativeToHome: boolean;
}

/**
 * Turn the directory part of a token into an absolute remote path.
 *
 * `null` means there is nothing to resolve against yet (no cwd and no `$HOME`), which is
 * the state right after connecting and before the first fetch landed.
 */
export function resolveDirectory(
  dir: string,
  cwd: string | null,
  home: string | null,
): ResolvedDir | null {
  if (dir.startsWith('/')) return { dir, relativeToHome: false };
  if (dir.startsWith('~/')) {
    return home === null ? null : { dir: join(home, dir.slice(2)), relativeToHome: false };
  }
  const base = cwd ?? home;
  if (base === null) return null;
  return {
    dir: dir === '' ? base : join(base, dir),
    // The popup says so, because the guess is wrong as soon as the user has cd'ed.
    relativeToHome: cwd === null,
  };
}

function join(base: string, rest: string): string {
  if (rest === '') return base;
  return `${base.replace(/\/+$/, '')}/${rest}`;
}
