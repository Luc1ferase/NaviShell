/**
 * Pure formatting and derivation helpers for the hardware monitor (no host APIs, no React).
 *
 * Every formatter tolerates `undefined` and renders {@link DASH} for it, so a field a
 * platform does not report never shows up as `NaN` or `0`.
 */

import type { Gpu, GpuSort, HistoryPoint } from './types';

/** What an unavailable value looks like everywhere in this panel. */
export const DASH = '—';

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;

/** `ctx.i18n.t` narrowed to what the components need. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Semantic colour of a value. The CSS classes set `--ns-hwmon-tone`, which the bars,
 * rings and sparklines all draw with, so a tone is chosen once and applies everywhere.
 */
export type Tone = 'muted' | 'normal' | 'info' | 'warn' | 'danger';

export function toneClass(tone: Tone): string {
  return `ns-hwmon-tone-${tone}`;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

/** `used / total` as 0-100, or `undefined` when either side is missing or total is 0. */
export function ratio(used: number | undefined, total: number | undefined): number | undefined {
  if (!isNumber(used) || !isNumber(total) || total <= 0) return undefined;
  return clampPercent((used / total) * 100);
}

/** Sum of the defined values; `undefined` when none of them is. */
export function sumDefined(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (!isNumber(value)) continue;
    total += value;
    seen = true;
  }
  return seen ? total : undefined;
}

/** Mean of the defined values; `undefined` when none of them is. */
export function averageDefined(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (!isNumber(value)) continue;
    total += value;
    count += 1;
  }
  return count === 0 ? undefined : total / count;
}

/** Largest of the defined values; `undefined` when none of them is. */
export function maxDefined(values: readonly (number | undefined)[]): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (!isNumber(value)) continue;
    if (best === undefined || value > best) best = value;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** `17_179_869_184` -> `"16.0 GiB"`. */
export function formatBytes(bytes: number | undefined): string {
  if (!isNumber(bytes) || bytes < 0) return DASH;
  if (bytes >= TIB) return `${(bytes / TIB).toFixed(1)} TiB`;
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GiB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

/**
 * A used/total pair in one unit, picked from the larger side:
 * `"12.3 / 24.0 GiB"`. Falls back to two independent values when only one is known.
 */
export function formatBytesPair(used: number | undefined, total: number | undefined): string {
  if (!isNumber(used) || !isNumber(total)) {
    return `${formatBytes(used)} / ${formatBytes(total)}`;
  }
  const scale = total >= TIB ? TIB : total >= GIB ? GIB : total >= MIB ? MIB : KIB;
  const unit = scale === TIB ? 'TiB' : scale === GIB ? 'GiB' : scale === MIB ? 'MiB' : 'KiB';
  return `${(used / scale).toFixed(1)} / ${(total / scale).toFixed(1)} ${unit}`;
}

export function formatPercent(value: number | undefined, digits = 0): string {
  if (!isNumber(value)) return DASH;
  return `${value.toFixed(digits)}%`;
}

export function formatTemp(celsius: number | undefined): string {
  if (!isNumber(celsius)) return DASH;
  return `${Math.round(celsius)} °C`;
}

export function formatWatts(watts: number | undefined): string {
  if (!isNumber(watts)) return DASH;
  return `${watts < 10 ? watts.toFixed(1) : Math.round(watts)} W`;
}

/** A used/limit watt pair: `"243 / 450 W"`. */
export function formatWattsPair(watts: number | undefined, limit: number | undefined): string {
  if (!isNumber(watts) && !isNumber(limit)) return DASH;
  if (!isNumber(limit)) return formatWatts(watts);
  const left = isNumber(watts) ? Math.round(watts).toString() : DASH;
  return `${left} / ${Math.round(limit)} W`;
}

/** `2850` -> `"2.85 GHz"`, `900` -> `"900 MHz"`. */
export function formatMHz(mhz: number | undefined): string {
  if (!isNumber(mhz) || mhz <= 0) return DASH;
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(2)} GHz`;
  return `${Math.round(mhz)} MHz`;
}

/** `276_720` -> `"3d 4h 12m"`; below an hour it keeps seconds. */
export function formatUptime(seconds: number | undefined): string {
  if (!isNumber(seconds) || seconds < 0) return DASH;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

/** An age in milliseconds as a compact `"5s"` / `"3m"` / `"2h"` / `"4d"`. */
export function formatAgo(ms: number | undefined): string {
  if (!isNumber(ms)) return DASH;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `[0.42, 1.1, 0.88]` -> `"0.42  1.10  0.88"`. */
export function formatLoadAvg(load: readonly [number, number, number] | undefined): string {
  if (!load) return DASH;
  return load.map((value) => (isNumber(value) ? value.toFixed(2) : DASH)).join('  ');
}

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

/** Utilisation scale: idle is muted, busy is the accent, nearly saturated warns. */
export function utilizationTone(percent: number | undefined): Tone {
  if (!isNumber(percent)) return 'muted';
  if (percent >= 90) return 'warn';
  if (percent < 10) return 'muted';
  return 'normal';
}

/** Memory fill scale: the last tenth warns, because that is where things get killed. */
export function memoryTone(percent: number | undefined): Tone {
  if (!isNumber(percent)) return 'muted';
  if (percent >= 90) return 'warn';
  return 'normal';
}

export function temperatureTone(
  celsius: number | undefined,
  warnAt: number,
  dangerAt: number,
): Tone {
  if (!isNumber(celsius)) return 'muted';
  if (celsius >= dangerAt) return 'danger';
  if (celsius >= warnAt) return 'warn';
  return 'normal';
}

/** CPU packages throttle around 90 °C, so 70/85 is the useful pair. */
export function cpuTemperatureTone(celsius: number | undefined): Tone {
  return temperatureTone(celsius, 70, 85);
}

/** GPUs idle hotter than CPUs and start slowing down earlier. */
export function gpuTemperatureTone(celsius: number | undefined): Tone {
  return temperatureTone(celsius, 75, 85);
}

// ---------------------------------------------------------------------------
// GPU ordering and history series
// ---------------------------------------------------------------------------

/** A GPU together with its position in `Snapshot.gpus`, which indexes the history. */
export interface GpuRow {
  gpu: Gpu;
  /** Position in `Snapshot.gpus` / `HistoryPoint.gpuUtil`, kept across sorting. */
  slot: number;
}

function sortKey(gpu: Gpu, sort: GpuSort): number | undefined {
  switch (sort) {
    case 'utilization':
      return gpu.utilization;
    case 'memory':
      return ratio(gpu.memoryUsedBytes, gpu.memoryTotalBytes);
    case 'temperature':
      return gpu.tempC;
    case 'index':
      return gpu.index;
  }
}

/**
 * Orders the GPUs for display: `index` ascending, every other key descending with the
 * cards that report nothing last, ties broken by index so the order stays stable.
 */
export function sortGpuRows(gpus: readonly Gpu[], sort: GpuSort): GpuRow[] {
  const rows: GpuRow[] = gpus.map((gpu, slot) => ({ gpu, slot }));
  if (sort === 'index') return rows.sort((a, b) => a.gpu.index - b.gpu.index);
  return rows.sort((a, b) => {
    const left = sortKey(a.gpu, sort);
    const right = sortKey(b.gpu, sort);
    if (left === undefined && right === undefined) return a.gpu.index - b.gpu.index;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    if (left !== right) return right - left;
    return a.gpu.index - b.gpu.index;
  });
}

export const EMPTY_SERIES: readonly (number | undefined)[] = [];

export function cpuSeries(history: readonly HistoryPoint[]): (number | undefined)[] {
  return history.map((point) => point.cpu);
}

/** Memory history as a percentage, which is what a sparkline can actually show. */
export function memorySeries(history: readonly HistoryPoint[]): (number | undefined)[] {
  return history.map((point) => ratio(point.memUsedBytes, point.memTotalBytes));
}

export function gpuUtilSeries(
  history: readonly HistoryPoint[],
  slot: number,
): (number | undefined)[] {
  return history.map((point) => point.gpuUtil[slot]);
}

/**
 * The utilisation history of every GPU in one pass over the history, indexed by slot
 * (so sorted rows can still find their own line).
 */
export function gpuSeriesBySlot(
  history: readonly HistoryPoint[],
  count: number,
): (number | undefined)[][] {
  const series: (number | undefined)[][] = [];
  for (let slot = 0; slot < count; slot += 1) series.push([]);
  for (const point of history) {
    for (let slot = 0; slot < count; slot += 1) series[slot]?.push(point.gpuUtil[slot]);
  }
  return series;
}
