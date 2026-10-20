/**
 * Shared data model of the hardware monitor.
 *
 * Collectors (`src/collect/*`) turn one script run on a target into a {@link Snapshot};
 * the `Monitor` (`src/monitor.ts`) keeps one {@link TargetState} per target and the UI
 * only ever reads a {@link MonitorView}. Every optional field means "not available on
 * this target"; the UI renders a dash for it instead of guessing.
 */

export type Platform = 'windows' | 'macos' | 'linux' | 'other';

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';

export interface GpuProcess {
  pid: number;
  /** Process name or command line when the tool reports it. */
  name?: string;
  /** GPU memory used by the process. */
  memoryBytes?: number;
}

export interface Gpu {
  /** Zero-based position in the tool's own ordering (the nvidia-smi index). */
  index: number;
  vendor: GpuVendor;
  name: string;
  busId?: string;
  uuid?: string;
  /** Core / SM utilisation, 0-100. */
  utilization?: number;
  /** Memory-controller utilisation, 0-100. */
  memoryUtilization?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  tempC?: number;
  powerW?: number;
  powerLimitW?: number;
  fanPercent?: number;
  /** Graphics / SM clock. */
  clockMHz?: number;
  memClockMHz?: number;
  driver?: string;
  /** Compute processes on this GPU; empty when the tool cannot tell. */
  processes: GpuProcess[];
}

export interface Disk {
  mount: string;
  filesystem?: string;
  totalBytes: number;
  usedBytes: number;
}

export interface Snapshot {
  /** Unix epoch milliseconds, taken when the script's output arrived. */
  at: number;
  host: {
    hostname?: string;
    /** Human readable OS name, e.g. "Ubuntu 22.04.4 LTS", "Windows 11 Pro", "macOS 15.1". */
    os?: string;
    kernel?: string;
    uptimeSec?: number;
    loadAvg?: [number, number, number];
  };
  cpu: {
    model?: string;
    /** Physical cores. */
    cores?: number;
    /** Logical CPUs. */
    threads?: number;
    /** Overall utilisation 0-100 over the interval since the previous sample; absent on the first. */
    usage?: number;
    /** Per logical CPU, same scale and the same first-sample caveat. */
    perCore?: number[];
    /** Current (or, failing that, nominal) clock. */
    freqMHz?: number;
    tempC?: number;
  };
  memory: {
    totalBytes?: number;
    usedBytes?: number;
    availableBytes?: number;
    swapTotalBytes?: number;
    swapUsedBytes?: number;
  };
  gpus: Gpu[];
  disks: Disk[];
  /**
   * Non-fatal problems met while sampling, as i18n keys of this plugin's `note.*` group
   * (for example `note.noGpuTool`). The UI translates and lists them.
   */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

export interface ScriptOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** When the output arrived (becomes `Snapshot.at`). */
  at: number;
}

export interface ParseResult {
  snapshot: Snapshot;
  /** Opaque carry-over for the next `parse` on the same target (e.g. the last /proc/stat). */
  state?: unknown;
}

/**
 * One platform's way of sampling: a script the target's shell runs on every tick and a
 * parser for what it printed. Scripts must print whatever is available and never fail
 * as a whole because one tool (nvidia-smi, sensors, …) is missing.
 */
export interface Collector {
  platform: Platform;
  /** `sh` = POSIX shell script (dash-compatible), `powershell` = Windows PowerShell 5.1+. */
  shell: 'sh' | 'powershell';
  script: string;
  parse(output: ScriptOutput, state: unknown): ParseResult;
}

// ---------------------------------------------------------------------------
// Monitor state (what the UI reads)
// ---------------------------------------------------------------------------

export type TargetId = 'local' | `ssh:${string}`;

export interface Target {
  id: TargetId;
  kind: 'local' | 'ssh';
  /** "This machine" (localised) or the server name. */
  label: string;
  /** `user@host:port` for SSH targets. */
  detail?: string;
  /** Known once the first sample ran (SSH targets are probed with `uname -s`). */
  platform?: Platform;
}

export interface HistoryPoint {
  at: number;
  cpu?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  /** Indexed like `Snapshot.gpus`. */
  gpuUtil: (number | undefined)[];
  gpuMemUsedBytes: (number | undefined)[];
}

export type TargetStatus = 'idle' | 'sampling' | 'ok' | 'error';

export interface TargetState {
  target: Target;
  status: TargetStatus;
  /** Set while `status` is `error`; already human readable. */
  error?: string;
  latest?: Snapshot;
  /** Oldest first, at most {@link HISTORY_LENGTH} points. */
  history: HistoryPoint[];
  sampleCount: number;
}

export type GpuView = 'auto' | 'cards' | 'table';
export type GpuSort = 'index' | 'utilization' | 'memory' | 'temperature';

export interface Prefs {
  intervalMs: number;
  /** `auto` = cards up to {@link AUTO_TABLE_GPU_COUNT} - 1 GPUs, table from there on. */
  gpuView: GpuView;
  gpuSort: GpuSort;
  showDisks: boolean;
}

export interface MonitorView {
  targets: TargetState[];
  selectedId: TargetId;
  selected: TargetState | undefined;
  prefs: Prefs;
  paused: boolean;
}

export const HISTORY_LENGTH = 120;
export const INTERVAL_OPTIONS: readonly number[] = [1000, 2000, 5000, 10_000];
export const AUTO_TABLE_GPU_COUNT = 6;
export const DEFAULT_PREFS: Prefs = {
  intervalMs: 2000,
  gpuView: 'auto',
  gpuSort: 'index',
  showDisks: true,
};
