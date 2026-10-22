/**
 * Remote awareness for the completion plugin (issue #8).
 *
 * Three caches, all filled in the background and all optional - a cold cache just means
 * fewer candidates, never a slower keystroke:
 *
 * - **executables**: the names on the remote `PATH`, fetched once per connection,
 * - **cwd**: where each terminal currently is, learned from OSC 7 (and OSC 133/633
 *   `P;Cwd=`) when the shell emits them, else read off the prompt on screen (the
 *   `user@host:/path$` family of prompts; see {@link parsePromptCwd}),
 * - **listings**: the entries of a remote directory, for completing a path token.
 *
 * It also watches each terminal for the rest of the VS Code-style shell integration
 * reports - OSC 633 `E` (the exact command line about to run) and OSC 133 `D` (its exit
 * code) - and hands them to the controller, which is what makes history capture exact
 * instead of a reconstruction of the user's keystrokes.
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
/** Quiet period after a new terminal's first output before the hook is injected. */
const INTEGRATION_DELAY_MS = 500;
/** Quiet period after the last parsed output before the screen is read for a prompt. */
const PROMPT_SETTLE_MS = 60;
/** Separator for the `<connectionId>/<dir>` listing key; cannot occur in either part. */
const KEY_SEPARATOR = '\u0000';

const EMPTY: readonly string[] = [];

type Xterm = TerminalHandle['xterm'];

/**
 * One line that teaches bash and zsh to report what the plugin needs, as OSC sequences:
 *
 * - `OSC 7 ; file://<host><cwd> ST` after every prompt, which is what makes path
 *   completion exact (reported once immediately, too),
 * - `OSC 633 ; E ; <command> ST` just before a command runs - VS Code's "this is the
 *   command line" report, with `\`, `;` and newlines escaped as `\x5c`, `\x3b` and `\x0a`,
 * - `OSC 133 ; D ; <exit code> ST` once it has finished.
 *
 * The command line comes from the shell itself rather than from the keystrokes we saw, so
 * history stays exact through the shell's own history, Ctrl-R, Tab completion and pastes.
 *
 * zsh gets `preexec`/`precmd` hook functions; bash gets a `DEBUG` trap armed once per
 * prompt (the bash-preexec trick: `__navishell_arm` runs last in `PROMPT_COMMAND` and the
 * trap disarms itself on its first fire, so only the typed command line is reported and
 * nothing a user's own `PROMPT_COMMAND` runs). The text comes from `history 1` because
 * `$BASH_COMMAND` holds just the first element of a pipeline; a line that repeats the last
 * reported one is dropped, which is also what stops a space-prefixed command - which
 * `ignorespace` keeps out of the history file - from being reported as the previous one.
 * Where bash-preexec is already installed its hook arrays are used instead, so its `DEBUG`
 * trap (atuin, iTerm2, …) stays untouched.
 *
 * Sent with a leading space so a shell with `HISTCONTROL=ignorespace` (or zsh's
 * `HIST_IGNORE_SPACE`) keeps the line itself out of the history, and guarded by
 * `__navishell_hooked` so injecting it twice cannot install the hooks twice.
 */
const SHELL_INTEGRATION_SNIPPET =
  ` if [ -z "$__navishell_hooked" ]; then __navishell_hooked=1; __navishell_bs='\\';` +
  ` __navishell_sc=';'; __navishell_nl=$'\\n'; __navishell_eb='\\x5c'; __navishell_es='\\x3b';` +
  ` __navishell_en='\\x0a';` +
  ` __navishell_esc(){ __navishell_v=\${1//"$__navishell_bs"/$__navishell_eb};` +
  ` __navishell_v=\${__navishell_v//"$__navishell_sc"/$__navishell_es};` +
  ` __navishell_v=\${__navishell_v//"$__navishell_nl"/$__navishell_en}; };` +
  ` __navishell_osc7(){ printf '\\033]7;file://%s%s\\033\\\\'` +
  ` "\${HOSTNAME:-\${HOST:-localhost}}" "$PWD"; }; __navishell_cmd(){ __navishell_esc "$1";` +
  ` printf '\\033]633;E;%s\\033\\\\' "$__navishell_v"; };` +
  ` __navishell_precmd(){ __navishell_st=$?;` +
  ` printf '\\033]133;D;%s\\033\\\\' "$__navishell_st"; __navishell_osc7;` +
  ` return $__navishell_st; }; if [ -n "$ZSH_VERSION" ] || [ -n "$__bp_imported" ];` +
  ` then precmd_functions=(__navishell_precmd \${precmd_functions[@]});` +
  ` preexec_functions+=(__navishell_cmd); elif [ -n "$BASH_VERSION" ];` +
  ` then __navishell_debug(){ [ -n "$__navishell_armed" ] || return 0; __navishell_armed=;` +
  ` __navishell_line=$(HISTTIMEFORMAT= builtin history 1);` +
  ` __navishell_line=\${__navishell_line#*[0-9]  };` +
  ` [ -n "$__navishell_line" ] || __navishell_line=$BASH_COMMAND;` +
  ` [ "$__navishell_line" = "$__navishell_prev" ] && return 0;` +
  ` __navishell_prev=$__navishell_line; __navishell_cmd "$__navishell_line"; };` +
  ` __navishell_arm(){ __navishell_armed=1; }; trap '__navishell_debug' DEBUG;` +
  ` PROMPT_COMMAND="__navishell_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND};__navishell_arm";` +
  ` else PROMPT_COMMAND="__navishell_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi;` +
  ` __navishell_precmd;` +
  ` fi`;

/** What a connection told us about itself. */
interface ConnectionData {
  executables: readonly string[];
  /** `$HOME`, used to resolve `~` in tokens and in prompts. */
  home: string | null;
}

interface Listing {
  entries: readonly string[];
  /** `0` until the first successful (or failed) fetch. */
  fetchedAt: number;
  pending: boolean;
}

/** What the index reports back to the controller as reports land. */
export interface RemoteIndexHooks {
  /** Data arrived that could change the suggestions on screen. */
  onChange(): void;
  /**
   * Remote output has been drawn and the screen went quiet: a prompt may be up. The
   * controller calls {@link RemoteIndex.inspectPrompt} when nothing has been typed.
   */
  onScreenSettled(terminalId: string): void;
  /** A terminal's first OSC 133/633 report: a shell integration is running in it. */
  onIntegrationActive(terminalId: string): void;
  /** OSC 633 `E`: the exact command line the shell is about to run. */
  onExactCommand(terminalId: string, command: string): void;
  /** OSC 133 `D`: the command that just finished; `null` when no code was given. */
  onCommandExit(terminalId: string, exitCode: number | null): void;
}

export class RemoteIndex {
  private readonly connections = new Map<string, ConnectionData>();
  private readonly listings = new Map<string, Listing>();
  /** Exact cwd per terminal, reported by the shell (OSC 7, `P;Cwd=`). */
  private readonly cwds = new Map<string, string>();
  /** Cwd per terminal as its prompt shows it: `/abs`, `~` or `~/rel`. */
  private readonly promptCwds = new Map<string, string>();
  /** The prompt of each terminal as last seen on screen, up to the cursor. */
  private readonly prompts = new Map<string, string>();
  /** Connection of each tracked SSH terminal, to list its cwd once `$HOME` is known. */
  private readonly terminalConnections = new Map<string, string>();
  private readonly settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly integrated = new Set<string>();
  /** Terminals that have sent at least one OSC 133/633 report. */
  private readonly integrationActive = new Set<string>();
  /**
   * Terminals that have sent an OSC 633 `E`, i.e. where command capture is exact.
   * Deliberately kept apart from {@link integrationActive}: a shell that only emits
   * prompt marks says nothing about commands, so history must keep coming from
   * keystrokes there.
   */
  private readonly exactCapture = new Set<string>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private shellIntegration = false;
  private disposed = false;

  constructor(
    private readonly ctx: PluginContext,
    private readonly hooks: RemoteIndexHooks,
  ) {}

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    for (const timer of this.settleTimers.values()) clearTimeout(timer);
    this.timers.clear();
    this.settleTimers.clear();
    this.connections.clear();
    this.listings.clear();
    this.terminalConnections.clear();
    this.cwds.clear();
    this.promptCwds.clear();
    this.prompts.clear();
    this.integrated.clear();
    this.integrationActive.clear();
    this.exactCapture.clear();
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
   * Watches a terminal's output stream for shell integration reports: the cwd, the exact
   * command lines and their exit codes. SSH terminals are also watched for lulls in their
   * output, when the prompt can be read off the screen. The returned disposables belong to
   * the caller (the controller disposes them with the rest of the terminal's subscriptions).
   *
   * All of this is a nicety, so a host that does not hand out a usable xterm costs us the
   * reports and nothing else - it must never break opening a terminal.
   */
  trackTerminal(terminal: TerminalHandle): Disposable[] {
    try {
      const { parser } = terminal.xterm;
      const subscriptions: Disposable[] = [
        // OSC 7 is the de-facto "this is my cwd" sequence. Claim it: nothing else wants it.
        parser.registerOscHandler(7, (data) => this.rememberCwd(terminal.id, parseOsc7(data))),
        // VS Code-style shell integration: the cwd as a property, the exact command line
        // (`E`) and its exit code (`D`). Never claim these - the prompt marks in the same
        // range may matter to someone else.
        ...[133, 633].map((ident) =>
          parser.registerOscHandler(ident, (data) => {
            this.handleIntegrationReport(terminal.id, data);
            return false;
          }),
        ),
      ];
      if (terminal.kind === 'ssh' && terminal.connectionId !== null) {
        this.terminalConnections.set(terminal.id, terminal.connectionId);
        // `onWriteParsed` fires once output has reached the buffer (xterm writes
        // asynchronously), which is when the screen can be read. A prompt may arrive in
        // several chunks, so wait for a short lull and read it whole.
        subscriptions.push(terminal.xterm.onWriteParsed(() => this.scheduleSettle(terminal)));
      }
      return subscriptions;
    } catch (error) {
      this.ctx.log.warn('[completion] could not watch the terminal for cwd reports', error);
      return [];
    }
  }

  forgetTerminal(terminalId: string): void {
    const timer = this.settleTimers.get(terminalId);
    if (timer) clearTimeout(timer);
    this.settleTimers.delete(terminalId);
    this.terminalConnections.delete(terminalId);
    this.cwds.delete(terminalId);
    this.promptCwds.delete(terminalId);
    this.prompts.delete(terminalId);
    this.integrated.delete(terminalId);
    this.integrationActive.delete(terminalId);
    this.exactCapture.delete(terminalId);
  }

  /** `true` once a terminal has reported a command line, so its history can be exact. */
  hasExactCapture(terminalId: string): boolean {
    return this.exactCapture.has(terminalId);
  }

  private scheduleSettle(terminal: TerminalHandle): void {
    if (this.disposed) return;
    const existing = this.settleTimers.get(terminal.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.settleTimers.delete(terminal.id);
      if (this.disposed || terminal.isDisposed) return;
      this.hooks.onScreenSettled(terminal.id);
    }, PROMPT_SETTLE_MS);
    this.settleTimers.set(terminal.id, timer);
  }

  /**
   * Reads the line the cursor is on and, when it is a prompt that shows the working
   * directory, remembers that directory for the terminal and starts listing it, so the
   * entries are there by the time a path is typed. Only called while nothing is typed on
   * the line: a half-typed `cat >` must not pass for a prompt.
   *
   * `typing` is `true` for the first keystroke of a command line - the one moment the text
   * before the cursor is known to be the prompt. It is then remembered as the prompt even
   * when no directory could be read from it, which is what lets {@link typedLine} find a
   * line the shell itself completed.
   *
   * A terminal whose shell reports its cwd is left alone: that report is exact.
   */
  inspectPrompt(terminal: TerminalHandle, typing: boolean): void {
    if (this.disposed || terminal.kind !== 'ssh' || this.cwds.has(terminal.id)) return;
    const text = textBeforeCursor(terminal.xterm);
    if (text === null) return;
    const shown = parsePromptCwd(text);
    if (typing && text !== '') this.prompts.set(terminal.id, text);
    if (shown === null) return;
    this.prompts.set(terminal.id, text);
    if (this.promptCwds.get(terminal.id) !== shown) {
      this.promptCwds.set(terminal.id, shown);
      this.ctx.log.debug(`[completion] prompt of ${terminal.id} shows ${shown}`);
    }
    const { connectionId } = terminal;
    if (connectionId === null) return;
    const data = this.connections.get(connectionId);
    if (!data) {
      void this.fetchConnection(connectionId);
      return;
    }
    const cwd = this.resolveCwd(terminal.id, data.home);
    if (cwd !== null) this.ensureListing(connectionId, cwd);
  }

  /**
   * What follows the prompt on the cursor's line, or `null` when the line does not start
   * with the prompt last seen in this terminal. How the controller recovers the input line
   * after the shell changed it (Tab completion, history recall).
   */
  typedLine(terminal: TerminalHandle): string | null {
    const prompt = this.prompts.get(terminal.id);
    if (prompt === undefined || prompt === '') return null;
    const text = textBeforeCursor(terminal.xterm);
    if (text === null || !text.startsWith(prompt)) return null;
    return text.slice(prompt.length);
  }

  /** The terminal's cwd: the shell's own report when there is one, else the prompt's. */
  private resolveCwd(terminalId: string, home: string | null): string | null {
    const exact = this.cwds.get(terminalId);
    if (exact !== undefined) return exact;
    const shown = this.promptCwds.get(terminalId);
    if (shown === undefined) return null;
    if (shown.startsWith('/')) return shown;
    if (home === null) return null;
    return shown === '~' ? home : join(home, shown.slice(2));
  }

  /**
   * An OSC 133/633 report landed: `E` carries the command line about to run, `D` the exit
   * code of the one that ended, `P;Cwd=` the working directory. Anything else is another
   * integration's business (prompt marks) and only counts as proof that one is running.
   */
  private handleIntegrationReport(terminalId: string, data: string): void {
    if (this.disposed) return;
    if (!this.integrationActive.has(terminalId)) {
      this.integrationActive.add(terminalId);
      this.hooks.onIntegrationActive(terminalId);
    }
    const command = parseCommandReport(data);
    if (command !== null) {
      this.exactCapture.add(terminalId);
      this.hooks.onExactCommand(terminalId, command);
      return;
    }
    const exit = parseExitReport(data);
    if (exit !== null) {
      this.hooks.onCommandExit(terminalId, exit.exitCode);
      return;
    }
    this.rememberCwd(terminalId, parseCwdProperty(data));
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
      void terminal.write(`${SHELL_INTEGRATION_SNIPPET}\r`).catch((error: unknown) => {
        this.ctx.log.debug('[completion] shell integration hook not installed', error);
      });
    }, INTEGRATION_DELAY_MS);
    this.timers.add(timer);
  }

  // -- paths ---------------------------------------------------------------

  /**
   * Entries to complete the current path token against, listing the directory in the
   * background when the cache is cold or older than {@link LISTING_TTL_MS}. Empty while
   * the directory cannot be known (a relative token in a terminal whose cwd nobody has
   * told us): nothing is guessed, and the shell's own completion is a Tab away.
   */
  paths(connectionId: string | null, terminalId: string, token: TokenContext): readonly string[] {
    if (connectionId === null || !token.isPath) return EMPTY;
    const data = this.connections.get(connectionId);
    if (!data) {
      void this.fetchConnection(connectionId);
      return EMPTY;
    }
    const dir = resolveDirectory(token.dir, this.resolveCwd(terminalId, data.home), data.home);
    return dir === null ? EMPTY : this.ensureListing(connectionId, dir);
  }

  /** The cached entries of a directory; starts a fetch when the cache is cold or stale. */
  private ensureListing(connectionId: string, dir: string): readonly string[] {
    const key = `${connectionId}${KEY_SEPARATOR}${dir}`;
    const listing = this.listings.get(key);
    if (!listing || (!listing.pending && Date.now() - listing.fetchedAt > LISTING_TTL_MS)) {
      void this.fetchListing(connectionId, key, dir);
    }
    return listing?.entries ?? EMPTY;
  }

  // -- fetching ------------------------------------------------------------

  private rememberCwd(terminalId: string, path: string | null): boolean {
    if (path === null || this.disposed) return false;
    // The shell's own report makes the prompt irrelevant from now on.
    this.promptCwds.delete(terminalId);
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
    const data: ConnectionData = { executables, home: home[0] ?? null };
    this.connections.set(connectionId, data);
    this.ctx.log.debug(
      `[completion] ${executables.length} executables on ${connectionId}, home ${data.home ?? '?'}`,
    );
    if (executables.length > 0) this.hooks.onChange();
    // Prompts read before `$HOME` was known can be resolved now: list those directories.
    for (const [terminalId, owner] of this.terminalConnections) {
      if (owner !== connectionId) continue;
      const cwd = this.resolveCwd(terminalId, data.home);
      if (cwd !== null) this.ensureListing(connectionId, cwd);
    }
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
    if (entries.length > 0) this.hooks.onChange();
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

/**
 * Undo the escaping of an OSC 633 payload: `\xNN` becomes the character it stands for.
 * A single pass, so a command that itself contained the text `\x3b` (which the shell
 * escaped to `\x5cx3b`) comes back unharmed.
 */
export function unescapeOsc633(payload: string): string {
  return payload.replace(/\\x[0-9a-fA-F]{2}/g, (match) =>
    String.fromCharCode(Number.parseInt(match.slice(2), 16)),
  );
}

/** OSC 633 payload `E;<escaped command>`: the exact command line about to run. */
export function parseCommandReport(data: string): string | null {
  if (!data.startsWith('E;')) return null;
  return unescapeOsc633(data.slice(2));
}

/**
 * OSC 133/633 payload `D[;<exit code>]`: the command that just finished. `null` means this
 * was not a `D` report at all; a `D` without a readable code yields a `null` exit code.
 */
export function parseExitReport(data: string): { exitCode: number | null } | null {
  if (data !== 'D' && !data.startsWith('D;')) return null;
  const code = Number.parseInt(data.slice(2), 10);
  return { exitCode: Number.isNaN(code) ? null : code };
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

// ---------------------------------------------------------------------------
// The screen (pure, given an xterm)
// ---------------------------------------------------------------------------

/**
 * The cursor's line up to the cursor, joined with the rows it wrapped from, so a long
 * prompt or command line reads as one string. `null` in the alternate screen (vim, less):
 * nothing there is a prompt.
 */
export function textBeforeCursor(xterm: Xterm): string | null {
  const buffer = xterm.buffer.active;
  if (buffer.type === 'alternate') return null;
  let y = buffer.baseY + buffer.cursorY;
  let line = buffer.getLine(y);
  if (!line) return null;
  let text = line.translateToString(false, 0, buffer.cursorX);
  while (line.isWrapped && y > 0) {
    y -= 1;
    line = buffer.getLine(y);
    if (!line) break;
    text = line.translateToString(false) + text;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Prompts (pure)
// ---------------------------------------------------------------------------

/** A prompt ends with one of these (`$ `, `# `, `% `, `> `, `❯ `)… */
const PROMPT_END = /[$#%>❯›»λ]\s*$/u;
/** …or starts with one (oh-my-zsh's `➜`), when nothing marks its end. */
const PROMPT_START = /^[➜❯λ»]/u;
/**
 * What prompts hang after the directory: a git branch (`(master)`, `git:(master) ✗`),
 * a venv or conda environment, the time, an exit status.
 */
const PROMPT_DECORATION = /\s*(?:git:\([^()]*\)|\([^()]*\)|\[[^[\]]*\]|\{[^{}]*\}|[✗✔✘✓×*!?+]+)$/u;
/** `user@host:/path` or `user@host:~/path`, the directory running to the end (spaces allowed). */
const HOST_PATH = /@[^\s@:]+:((?:~|\/)[^:[\]()$#%>❯›»λ]*)$/u;
/** The last word (after whitespace, `:`, `[` or `(`) when it is an absolute or `~` path. */
const LAST_PATH = /(?:^|[\s:[(])((?:~|\/)[^\s:[\]()]*)$/u;

/**
 * The working directory a prompt line shows, as it shows it - `/abs`, `~` or `~/rel` - or
 * `null` when the line does not look like a prompt showing one.
 *
 * Covers the common shapes: `user@host:/path$`, `[user@host ~]$`, `/path $`, `➜  ~`,
 * with venv, git-branch, time or status decorations after the directory, in bash and zsh
 * alike. Prompts that show only the directory's name (`\W`, `%1~`) yield `null`: a name is
 * not a location, and guessing one would list the wrong directory.
 */
export function parsePromptCwd(line: string): string | null {
  const text = line.trimEnd();
  const end = PROMPT_END.exec(text);
  if (end) return promptPath(text.slice(0, end.index));
  return PROMPT_START.test(text) ? promptPath(text) : null;
}

/** The directory at the end of a prompt's text (the prompt symbol already removed). */
function promptPath(text: string): string | null {
  let rest = text.trimEnd();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // A closing bracket may belong to a group opened before the directory: `[user@host ~]`.
    const bare = rest.replace(/[\])}]+$/u, '').trimEnd();
    const path = HOST_PATH.exec(bare)?.[1] ?? LAST_PATH.exec(bare)?.[1];
    if (path !== undefined) return path.length > 1 ? path.replace(/\/+$/u, '') : path;
    const stripped = rest.replace(PROMPT_DECORATION, '');
    if (stripped === rest) return null;
    rest = stripped;
  }
  return null;
}

/**
 * Turn the directory part of a token into an absolute remote path, or `null` when it
 * cannot be known: a relative token while the terminal's cwd is unknown, or `~` before
 * `$HOME` arrived. Nothing is guessed - a listing of the wrong directory is worse than
 * none, and the shell's own completion is a Tab away.
 */
export function resolveDirectory(
  dir: string,
  cwd: string | null,
  home: string | null,
): string | null {
  if (dir.startsWith('/')) return dir;
  if (dir.startsWith('~/')) return home === null ? null : join(home, dir.slice(2));
  if (cwd === null) return null;
  return dir === '' ? cwd : join(cwd, dir);
}

function join(base: string, rest: string): string {
  if (rest === '') return base;
  return `${base.replace(/\/+$/, '')}/${rest}`;
}
