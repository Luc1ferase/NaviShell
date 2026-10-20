/**
 * Helpers shared by the platform collectors.
 *
 * The POSIX collectors print a `@@SECTION <name>` marker line before each group of
 * findings, so that a tool which is missing only empties its own section instead of
 * shifting everything behind it; {@link sections} splits such output back into named
 * blocks. Everything else here is defensive coercion: the parsers have to survive
 * truncated output, `[N/A]` placeholders and PowerShell handing numbers over as strings.
 */

import type { Disk, Gpu, GpuVendor, Snapshot } from '../types';

export const SECTION_MARK = '@@SECTION';

/** The i18n keys of `Snapshot.notes` that collectors may emit. */
export const NOTE_NO_GPU_TOOL = 'note.noGpuTool';
export const NOTE_GPU_TOOL_FAILED = 'note.gpuToolFailed';
export const NOTE_NO_GPU_UTILIZATION = 'note.noGpuUtilization';

/** How the tools spell "this value does not exist here". */
const UNAVAILABLE = new Set([
  '',
  '-',
  'n/a',
  '[n/a]',
  'not supported',
  '[not supported]',
  'unknown',
  '[unknown error]',
  '[insufficient permissions]',
]);

export function isUnavailable(value: string): boolean {
  return UNAVAILABLE.has(value.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** A finite number, or undefined for everything else (empty, `[N/A]`, prose, NaN). */
export function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (isUnavailable(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Like {@link num}, but zero and negatives also count as "unknown" (sizes, clocks). */
export function positive(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** A percentage, clamped into 0..100 and rounded to one decimal. */
export function percent(value: unknown): number | undefined {
  const parsed = num(value);
  if (parsed === undefined) return undefined;
  return round1(clamp(parsed, 0, 100));
}

/** A temperature in °C, dropped when no sensor could plausibly report it. */
export function tempC(value: unknown): number | undefined {
  const parsed = num(value);
  if (parsed === undefined || parsed <= -40 || parsed >= 150) return undefined;
  return round1(parsed);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A non-empty trimmed string, or undefined. */
export function str(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  return isUnavailable(raw) ? undefined : raw;
}

/** KiB (the unit of /proc/meminfo, `df -k` and the Win32 memory counters) to bytes. */
export function kib(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : Math.round(parsed * 1024);
}

/** MiB (nvidia-smi memory, Win32_PageFileUsage) to bytes. */
export function mib(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : Math.round(parsed * 1024 * 1024);
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

/**
 * A human size with a binary unit to bytes: `8 GB`, `1536 MB` (system_profiler),
 * `2048.00M` (`vm.swapusage`). A bare number is taken as bytes.
 */
export function parseSize(value: unknown): number | undefined {
  const raw = str(value);
  if (raw === undefined) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]*)$/.exec(raw);
  if (!match) return undefined;
  const amount = num(match[1]);
  if (amount === undefined) return undefined;
  const unit = (match[2] ?? '').toLowerCase();
  const factor = unit === '' ? 1 : SIZE_UNITS[unit];
  return factor === undefined ? undefined : Math.round(amount * factor);
}

// ---------------------------------------------------------------------------
// Lines and sections
// ---------------------------------------------------------------------------

/** Splits on newlines and drops the `\r` an SSH pty or PowerShell leaves behind. */
export function toLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

export interface Sections {
  /** Whether the script printed the section at all (i.e. whether the tool exists). */
  has(name: string): boolean;
  lines(name: string): string[];
  text(name: string): string;
  first(name: string): string | undefined;
}

/** Splits `@@SECTION <name>` delimited output; a repeated name keeps its last block. */
export function sections(stdout: string): Sections {
  const blocks = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of toLines(stdout)) {
    if (line.startsWith(SECTION_MARK)) {
      const name = line.slice(SECTION_MARK.length).trim();
      if (!name) {
        current = undefined;
        continue;
      }
      current = [];
      blocks.set(name, current);
      continue;
    }
    if (current) current.push(line);
  }
  for (const [name, lines] of blocks) blocks.set(name, trimBlank(lines));
  return {
    has: (name) => blocks.has(name),
    lines: (name) => blocks.get(name) ?? [],
    text: (name) => (blocks.get(name) ?? []).join('\n'),
    first: (name) => blocks.get(name)?.[0],
  };
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start += 1;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return lines.slice(start, end);
}

/** `key value …` lines (the `sysctl` loop) into a map keyed by the first word. */
export function spaceKeyed(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const match = /^(\S+)[ \t]+(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (key === undefined || map.has(key)) continue;
    map.set(key, (match[2] ?? '').trim());
  }
  return map;
}

/** `Key: value` lines (/proc/meminfo, `sw_vers`, `vm_stat`) into a map. */
export function colonKeyed(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!key || map.has(key)) continue;
    map.set(key, line.slice(at + 1).trim());
  }
  return map;
}

/**
 * `<dir>/<file>:<value>` lines, the output of `grep -H . <sysfs files>`, grouped by
 * directory: one `grep` reads a whole sysfs class, where a shell loop would need two
 * `cat` processes per device.
 */
export function parseSysfs(lines: string[]): Map<string, Map<string, string>> {
  const devices = new Map<string, Map<string, string>>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const path = line.slice(0, colon);
    const slash = path.lastIndexOf('/');
    const file = path.slice(slash + 1);
    if (slash <= 0 || !file) continue;
    const directory = path.slice(0, slash);
    let values = devices.get(directory);
    if (!values) {
      values = new Map<string, string>();
      devices.set(directory, values);
    }
    if (!values.has(file)) values.set(file, line.slice(colon + 1).trim());
  }
  return devices;
}

/**
 * One CSV row into trimmed fields. nvidia-smi does not quote its output, but a process
 * name may still contain a comma, so callers that know the field count rejoin the middle.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char ?? '';
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      fields.push(field.trim());
      field = '';
      continue;
    }
    field += char ?? '';
  }
  fields.push(field.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// JSON (rocm-smi, system_profiler, the Windows script)
// ---------------------------------------------------------------------------

/** JSON.parse of the first `{…}` or `[…]` in the output; undefined when there is none. */
export function parseJsonLoose(text: string): unknown {
  const start = firstIndexOf(text, '{', '[');
  if (start < 0) return undefined;
  const closing = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(closing);
  if (end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function firstIndexOf(text: string, ...chars: string[]): number {
  let found = -1;
  for (const char of chars) {
    const at = text.indexOf(char);
    if (at >= 0 && (found < 0 || at < found)) found = at;
  }
  return found;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** PowerShell collapses one-element arrays into the element itself; this undoes it. */
export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  return value === null || value === undefined ? [] : [value];
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** The snapshot every parser starts from: empty, but never missing a collection. */
export function emptySnapshot(at: number): Snapshot {
  return { at, host: {}, cpu: {}, memory: {}, gpus: [], disks: [], notes: [] };
}

export function addNote(snapshot: Snapshot, key: string): void {
  if (!snapshot.notes.includes(key)) snapshot.notes.push(key);
}

/** Guesses the vendor from a marketing name, for the tool-less GPU listings. */
export function vendorFromName(name: string): GpuVendor {
  const text = name.toLowerCase();
  if (/nvidia|geforce|quadro|tesla|\brtx\b|\bgtx\b|titan/.test(text)) return 'nvidia';
  if (/\bamd\b|radeon|\bati\b|firepro|advanced micro devices/.test(text)) return 'amd';
  if (/intel|\biris\b|\barc\b|\buhd\b|\bhd graphics\b/.test(text)) return 'intel';
  if (/apple/.test(text)) return 'apple';
  return 'other';
}

/** The index to give the next GPU appended to a list a tool has already numbered. */
export function nextGpuIndex(gpus: Gpu[]): number {
  let next = 0;
  for (const gpu of gpus) if (gpu.index >= next) next = gpu.index + 1;
  return next;
}

/** Keeps each tool's own numbering unless it would hand two GPUs the same index. */
export function withUniqueIndexes(gpus: Gpu[]): Gpu[] {
  const indexes = new Set(gpus.map((gpu) => gpu.index));
  if (indexes.size === gpus.length) return gpus;
  return gpus.map((gpu, position) => ({ ...gpu, index: position }));
}

// ---------------------------------------------------------------------------
// df
// ---------------------------------------------------------------------------

/**
 * `df -kP` rows, which both POSIX collectors share. The device name (`map auto_home`)
 * and the mount point may contain spaces, so the numeric columns anchor the match
 * instead of a field count. `keep` decides which filesystems are real.
 */
export function parseDf(
  lines: string[],
  keep: (filesystem: string, mount: string) => boolean,
): Disk[] {
  const disks: Disk[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const match =
      /^(.+?)[ \t]+(-?\d+)[ \t]+(-?\d+)[ \t]+(-?\d+)[ \t]+(\S+)[ \t]+(\/.*?)[ \t]*$/.exec(line);
    if (!match) continue;
    const filesystem = (match[1] ?? '').trim();
    const mount = (match[6] ?? '').trim();
    const totalBytes = kib(match[2]);
    const usedBytes = kib(match[3]);
    if (totalBytes === undefined || usedBytes === undefined) continue;
    if (totalBytes <= 0 || seen.has(mount)) continue;
    if (!keep(filesystem, mount)) continue;
    seen.add(mount);
    disks.push({
      mount,
      filesystem: str(filesystem),
      totalBytes,
      usedBytes: clamp(usedBytes, 0, totalBytes),
    });
  }
  return disks;
}

/** Whether `mount` is `prefix` or sits below it. */
export function isUnder(mount: string, prefix: string): boolean {
  return mount === prefix || mount.startsWith(`${prefix}/`);
}
