/**
 * The monitor: the list of targets (this machine plus every open SSH connection), the
 * polling loop for the selected one, its history and the persisted preferences.
 *
 * Only the selected target is sampled, and only while a panel is visible and the monitor
 * is not paused. Each tick runs the platform's collector script through `ctx.local.exec`
 * (this machine) or `ctx.connections.exec` (SSH) and feeds the output to the collector's
 * parser. The UI reads an immutable {@link MonitorView} through {@link useMonitor}.
 */

import { useSyncExternalStore } from 'react';
import type {
  ConnectionInfo,
  Disposable,
  ExecResult,
  JsonValue,
  PluginContext,
} from '@navishell/plugin-api';
import { isHostError } from '@navishell/plugin-api';

import { collectorFor } from './collect';
import {
  AUTO_TABLE_GPU_COUNT,
  DEFAULT_PREFS,
  HISTORY_LENGTH,
  INTERVAL_OPTIONS,
  type Collector,
  type HistoryPoint,
  type MonitorView,
  type Platform,
  type Prefs,
  type Snapshot,
  type Target,
  type TargetId,
  type TargetState,
} from './types';

const PREFS_KEY = 'prefs';
/** Upper bound for one sample; the collectors themselves finish in well under a second. */
const SAMPLE_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 10_000;
/** See `effectiveInterval`. */
const MACOS_MIN_INTERVAL_MS = 2000;
/** Longest pause between two attempts while a target keeps failing. */
const MAX_BACKOFF_MS = 30_000;

interface CollectorBundle {
  collector: Collector;
  state: unknown;
}

export class Monitor {
  private readonly ctx: PluginContext;
  private readonly targets = new Map<TargetId, TargetState>();
  private readonly collectors = new Map<TargetId, CollectorBundle>();
  private selectedId: TargetId = 'local';
  private prefs: Prefs = { ...DEFAULT_PREFS };
  private paused = false;
  /** Panels report their visibility; nothing is sampled while no panel shows the monitor. */
  private visible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sampling = false;
  /** Consecutive failed samples of the selected target; drives the backoff. */
  private failures = 0;
  private disposed = false;
  private view: MonitorView;
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: Disposable[] = [];

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    this.view = this.buildView();
  }

  // -- lifecycle -------------------------------------------------------------

  attach(): void {
    this.targets.set('local', {
      target: this.localTarget(),
      status: 'idle',
      history: [],
      sampleCount: 0,
    });
    this.syncConnections(this.ctx.connections.list());
    this.subscriptions.push(
      this.ctx.connections.onDidChange((list) => this.syncConnections(list)),
      this.ctx.i18n.onDidChangeLocale(() => {
        this.update('local', (current) => ({ ...current, target: this.localTarget() }));
      }),
    );
    this.emit();
    void this.loadPrefs();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.listeners.clear();
  }

  // -- store API (React) -------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getView = (): MonitorView => this.view;

  // -- controls ----------------------------------------------------------------

  select(id: TargetId): void {
    if (!this.targets.has(id) || id === this.selectedId) return;
    this.selectedId = id;
    this.failures = 0;
    this.emit();
    this.schedule(0);
  }

  /** Sample the selected target now (the regular cadence continues afterwards). */
  refresh(): void {
    this.schedule(0);
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.emit();
    if (paused) this.clearTimer();
    else this.schedule(0);
  }

  /** Called by the panel with its own visibility; sampling only happens while visible. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.schedule(0);
    else this.clearTimer();
  }

  setPrefs(patch: Partial<Prefs>): void {
    const next = normalisePrefs({ ...this.prefs, ...patch });
    const intervalChanged = next.intervalMs !== this.prefs.intervalMs;
    this.prefs = next;
    this.emit();
    if (intervalChanged && this.timer) this.schedule(this.effectiveInterval());
    void this.ctx.storage.set(PREFS_KEY, next as unknown as JsonValue).catch((error: unknown) => {
      this.ctx.log.warn('could not save preferences', error);
    });
  }

  /** Forget the collector of a target so its platform is probed again (e.g. after an error). */
  reset(id: TargetId): void {
    this.collectors.delete(id);
    if (id === this.selectedId) this.failures = 0;
    this.update(id, (current) => ({
      ...current,
      status: 'idle',
      error: undefined,
      history: [],
      sampleCount: 0,
    }));
    if (id === this.selectedId) this.schedule(0);
  }

  // -- targets -------------------------------------------------------------------

  private localTarget(): Target {
    return {
      id: 'local',
      kind: 'local',
      label: this.ctx.i18n.t('target.local'),
      platform: this.ctx.local.platform,
    };
  }

  private syncConnections(connections: ConnectionInfo[]): void {
    const seen = new Set<TargetId>(['local']);
    for (const connection of connections) {
      const id: TargetId = `ssh:${connection.id}`;
      seen.add(id);
      const server = this.ctx.servers.get(connection.serverId);
      const target: Target = {
        id,
        kind: 'ssh',
        label: server?.name ?? connection.host,
        detail: `${connection.username}@${connection.host}:${connection.port}`,
        platform: this.targets.get(id)?.target.platform,
      };
      const existing = this.targets.get(id);
      this.targets.set(
        id,
        existing
          ? { ...existing, target }
          : { target, status: 'idle', history: [], sampleCount: 0 },
      );
    }
    for (const id of [...this.targets.keys()]) {
      if (seen.has(id)) continue;
      this.targets.delete(id);
      this.collectors.delete(id);
    }
    if (!this.targets.has(this.selectedId)) {
      this.selectedId = 'local';
      this.schedule(0);
    }
    this.emit();
  }

  // -- sampling ------------------------------------------------------------------

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (this.disposed || this.paused || !this.visible) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      await this.sample(this.selectedId);
    } finally {
      this.sampling = false;
      this.schedule(this.effectiveInterval());
    }
  }

  /**
   * The configured interval, except on macOS where one sample already takes ~1.5 s
   * (`top -l 2` and `system_profiler`), so anything under 2 s would never stop sampling,
   * doubled per consecutive failure up to {@link MAX_BACKOFF_MS}.
   */
  private effectiveInterval(): number {
    const platform = this.targets.get(this.selectedId)?.target.platform;
    const base =
      platform === 'macos'
        ? Math.max(this.prefs.intervalMs, MACOS_MIN_INTERVAL_MS)
        : this.prefs.intervalMs;
    // Back off while the target keeps failing (hung tool, dead connection) so neither
    // the log nor the remote is hammered every tick; a success, `select` or `reset`
    // restores the cadence.
    return Math.min(base * 2 ** Math.min(this.failures, 4), MAX_BACKOFF_MS);
  }

  private async sample(id: TargetId): Promise<void> {
    const entry = this.targets.get(id);
    if (!entry) return;
    if (!entry.latest) this.update(id, (current) => ({ ...current, status: 'sampling' }));
    try {
      const bundle = await this.ensureCollector(id, entry.target);
      const result = await this.run(entry.target, bundle.collector);
      const at = Date.now();
      const parsed = bundle.collector.parse({ ...result, at }, bundle.state);
      bundle.state = parsed.state;
      if (!this.targets.has(id)) return; // the connection closed meanwhile
      this.failures = 0;
      this.update(id, (current) => ({
        ...current,
        status: 'ok',
        error: undefined,
        latest: parsed.snapshot,
        history: pushHistory(current.history, parsed.snapshot),
        sampleCount: current.sampleCount + 1,
      }));
    } catch (error) {
      if (!this.targets.has(id)) return;
      this.ctx.log.warn(`sampling ${id} failed`, error);
      this.failures += 1;
      this.update(id, (current) => ({ ...current, status: 'error', error: errorText(error) }));
    }
  }

  private async ensureCollector(id: TargetId, target: Target): Promise<CollectorBundle> {
    const cached = this.collectors.get(id);
    if (cached) return cached;
    const platform = target.kind === 'local' ? this.ctx.local.platform : await this.probe(target);
    const collector = collectorFor(platform);
    if (!collector) {
      throw new Error(this.ctx.i18n.t('error.unsupportedPlatform', { platform }));
    }
    const bundle: CollectorBundle = { collector, state: undefined };
    this.collectors.set(id, bundle);
    this.update(id, (current) => ({ ...current, target: { ...current.target, platform } }));
    return bundle;
  }

  /** `uname -s` on an SSH target: Linux and macOS are supported, anything else is not. */
  private async probe(target: Target): Promise<Platform> {
    const result = await this.ctx.connections.exec(connectionIdOf(target.id), 'uname -s', {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const name = result.stdout.trim().toLowerCase();
    if (name.startsWith('linux')) return 'linux';
    if (name.startsWith('darwin')) return 'macos';
    return 'other';
  }

  private run(target: Target, collector: Collector): Promise<ExecResult> {
    if (target.kind === 'local') {
      if (collector.shell === 'powershell') {
        return this.ctx.local.exec(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-OutputFormat',
            'Text',
            '-EncodedCommand',
            encodePowerShell(collector.script),
          ],
          { timeoutMs: SAMPLE_TIMEOUT_MS },
        );
      }
      return this.ctx.local.exec('sh', ['-c', collector.script], { timeoutMs: SAMPLE_TIMEOUT_MS });
    }
    // The remote login shell may be anything (bash, zsh, fish); `sh -c '…'` with the
    // script single-quoted is the one spelling they all agree on.
    return this.ctx.connections.exec(
      connectionIdOf(target.id),
      `sh -c '${collector.script.replace(/'/g, `'\\''`)}'`,
      { timeoutMs: SAMPLE_TIMEOUT_MS },
    );
  }

  // -- state plumbing --------------------------------------------------------------

  private update(id: TargetId, change: (current: TargetState) => TargetState): void {
    const current = this.targets.get(id);
    if (!current) return;
    this.targets.set(id, change(current));
    this.emit();
  }

  private async loadPrefs(): Promise<void> {
    try {
      const stored = await this.ctx.storage.get<JsonValue>(PREFS_KEY);
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        this.prefs = normalisePrefs({ ...this.prefs, ...(stored as Partial<Prefs>) });
        this.emit();
      }
    } catch (error) {
      this.ctx.log.warn('could not load preferences', error);
    }
  }

  private buildView(): MonitorView {
    const targets = [...this.targets.values()];
    return {
      targets,
      selectedId: this.selectedId,
      selected: this.targets.get(this.selectedId),
      prefs: this.prefs,
      paused: this.paused,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.view = this.buildView();
    for (const listener of this.listeners) listener();
  }
}

/** React binding: re-renders on every change of the monitor's view. */
export function useMonitor(monitor: Monitor): MonitorView {
  return useSyncExternalStore(monitor.subscribe, monitor.getView, monitor.getView);
}

/** Whether the GPU section should render as a table for `count` GPUs under `view`. */
export function gpuTableFor(view: Prefs['gpuView'], count: number): boolean {
  if (view === 'table') return true;
  if (view === 'cards') return false;
  return count >= AUTO_TABLE_GPU_COUNT;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectionIdOf(id: TargetId): string {
  return id.startsWith('ssh:') ? id.slice(4) : id;
}

function pushHistory(history: HistoryPoint[], snapshot: Snapshot): HistoryPoint[] {
  const point: HistoryPoint = {
    at: snapshot.at,
    cpu: snapshot.cpu.usage,
    memUsedBytes: snapshot.memory.usedBytes,
    memTotalBytes: snapshot.memory.totalBytes,
    gpuUtil: snapshot.gpus.map((gpu) => gpu.utilization),
    gpuMemUsedBytes: snapshot.gpus.map((gpu) => gpu.memoryUsedBytes),
  };
  const next = history.length >= HISTORY_LENGTH ? history.slice(1) : history.slice();
  next.push(point);
  return next;
}

function normalisePrefs(prefs: Prefs): Prefs {
  return {
    intervalMs: INTERVAL_OPTIONS.includes(prefs.intervalMs)
      ? prefs.intervalMs
      : DEFAULT_PREFS.intervalMs,
    gpuView: ['auto', 'cards', 'table'].includes(prefs.gpuView) ? prefs.gpuView : 'auto',
    gpuSort: ['index', 'utilization', 'memory', 'temperature'].includes(prefs.gpuSort)
      ? prefs.gpuSort
      : 'index',
    showDisks: typeof prefs.showDisks === 'boolean' ? prefs.showDisks : true,
  };
}

function errorText(error: unknown): string {
  if (isHostError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** `-EncodedCommand` wants the script as base64 of its UTF-16LE bytes. */
function encodePowerShell(script: string): string {
  let binary = '';
  for (let i = 0; i < script.length; i += 1) {
    const code = script.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
}
