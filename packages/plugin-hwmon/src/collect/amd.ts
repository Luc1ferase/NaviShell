/**
 * rocm-smi, used by the Linux collector only (there is no ROCm build for Windows that
 * ships `rocm-smi`, and macOS has no AMD compute stack).
 *
 * `rocm-smi … --json` prints one object per card, keyed `card0`, `card1`, … (older
 * builds write `card:0`), plus a `system` entry with the driver version. The labels
 * inside a card differ between ROCm 4, 5 and 6, so every value is looked up by a
 * tolerant key predicate instead of an exact name:
 *
 * ```json
 * {"card0":{"GPU ID":"0x73bf","Unique ID":"0x7…","GPU use (%)":"12",
 *           "GPU memory use (%)":"34","Temperature (Sensor edge) (C)":"45.0",
 *           "Average Graphics Package Power (W)":"35.0","Fan speed (%)":"22",
 *           "sclk clock speed:":"(1500Mhz)","Card series":"Navi 21"},
 *  "system":{"Driver version":"6.7.0"}}
 * ```
 *
 * Memory in bytes comes from the `mem_info_vram_total` and `mem_info_vram_used` files
 * of `/sys/class/drm/card<N>/device` when the
 * JSON has no byte counters, which is the common case for the queries we run.
 */

import type { Gpu } from '../types';
import {
  asRecord,
  num,
  parseJsonLoose,
  parseSysfs,
  percent,
  positive,
  str,
  tempC,
} from './parse-utils';

/** The one rocm-smi invocation the Linux script runs. */
export const ROCM_SMI_ARGS =
  '--showid --showproductname --showuse --showmemuse --showtemp --showpower --showfan ' +
  '--showclocks --json';

/** VRAM of one DRM card, read from sysfs (bytes). */
export interface AmdVram {
  totalBytes?: number;
  usedBytes?: number;
}

/**
 * The `mem_info_vram_total`/`mem_info_vram_used` lines of the `amdVram` section into a
 * map keyed by the DRM card number, which is also how rocm-smi numbers its `cardN`
 * entries.
 */
export function parseAmdVram(lines: string[]): Map<number, AmdVram> {
  const vram = new Map<number, AmdVram>();
  for (const [directory, values] of parseSysfs(lines)) {
    const card = num(/card(\d+)/.exec(directory)?.[1]);
    if (card === undefined || vram.has(card)) continue;
    const entry: AmdVram = {};
    const totalBytes = positive(values.get('mem_info_vram_total'));
    if (totalBytes !== undefined) entry.totalBytes = totalBytes;
    const usedBytes = num(values.get('mem_info_vram_used'));
    if (usedBytes !== undefined && usedBytes >= 0) entry.usedBytes = usedBytes;
    vram.set(card, entry);
  }
  return vram;
}

/** The AMD GPUs of one rocm-smi run; an empty list when the output made no sense. */
export function parseRocmSmi(json: string, vram: Map<number, AmdVram>): Gpu[] {
  const root = asRecord(parseJsonLoose(json));
  if (!root) return [];
  const driver = field(asRecord(root['system']) ?? {}, (key) => key.includes('driver version'));
  const cards: { card: number; record: Record<string, unknown> }[] = [];
  for (const [key, value] of Object.entries(root)) {
    const card = num(/^card:?[ \t]*(\d+)$/i.exec(key)?.[1]);
    const record = asRecord(value);
    if (card === undefined || !record) continue;
    cards.push({ card, record });
  }
  cards.sort((left, right) => left.card - right.card);
  return cards.map((entry, position) => toGpu(entry.card, entry.record, vram, driver, position));
}

function toGpu(
  card: number,
  record: Record<string, unknown>,
  vram: Map<number, AmdVram>,
  driver: string | undefined,
  position: number,
): Gpu {
  const memory = vram.get(card) ?? {};
  const name =
    field(record, (key) => key.includes('card series')) ??
    field(record, (key) => key.includes('card model')) ??
    field(record, (key) => key.includes('device name') || key.includes('market name')) ??
    field(record, (key) => key.includes('card sku')) ??
    `AMD GPU ${card}`;
  const gpu: Gpu = {
    index: position,
    vendor: 'amd',
    name,
    processes: [],
  };
  assign(
    gpu,
    'busId',
    field(record, (key) => key.includes('pci bus')),
  );
  assign(
    gpu,
    'uuid',
    field(record, (key) => key.includes('unique id')),
  );
  assign(
    gpu,
    'utilization',
    percent(field(record, (key) => key.includes('gpu use') && !key.includes('memory'))),
  );
  assign(
    gpu,
    'memoryUtilization',
    percent(field(record, (key) => key.includes('memory use') || key.includes('memory util'))),
  );
  assign(
    gpu,
    'memoryTotalBytes',
    positive(field(record, (key) => key.includes('vram total memory'))) ?? memory.totalBytes,
  );
  assign(
    gpu,
    'memoryUsedBytes',
    positive(field(record, (key) => key.includes('vram total used memory'))) ?? memory.usedBytes,
  );
  assign(
    gpu,
    'tempC',
    tempC(field(record, (key) => key.includes('sensor edge'))) ??
      tempC(field(record, (key) => key.includes('sensor junction'))) ??
      tempC(field(record, (key) => key.startsWith('temperature'))),
  );
  assign(
    gpu,
    'powerW',
    num(field(record, (key) => key.includes('average graphics package power'))) ??
      num(field(record, (key) => key.includes('socket graphics package power'))) ??
      num(
        field(
          record,
          (key) =>
            key.includes('power') &&
            key.includes('(w)') &&
            !key.includes('max') &&
            !key.includes('cap'),
        ),
      ),
  );
  assign(
    gpu,
    'powerLimitW',
    positive(field(record, (key) => key.includes('max graphics package power'))) ??
      positive(field(record, (key) => key.includes('power cap'))),
  );
  assign(
    gpu,
    'fanPercent',
    percent(field(record, (key) => key.includes('fan speed') && key.includes('%'))),
  );
  assign(
    gpu,
    'clockMHz',
    parseClock(field(record, (key) => key.includes('sclk clock speed'))) ??
      parseClock(field(record, (key) => key.includes('sclk'))),
  );
  assign(
    gpu,
    'memClockMHz',
    parseClock(field(record, (key) => key.includes('mclk clock speed'))) ??
      parseClock(field(record, (key) => key.includes('mclk'))),
  );
  assign(gpu, 'driver', driver);
  return gpu;
}

/** Sets an optional field only when there is a value, so keys stay absent otherwise. */
function assign<K extends keyof Gpu>(gpu: Gpu, key: K, value: Gpu[K] | undefined): void {
  if (value !== undefined) gpu[key] = value;
}

/** The first value whose (lower-cased) key matches, skipping `N/A` placeholders. */
function field(
  record: Record<string, unknown>,
  match: (key: string) => boolean,
): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (!match(key.toLowerCase())) continue;
    const text = str(value);
    if (text !== undefined) return text;
  }
  return undefined;
}

/** `(1500Mhz)`, `1500Mhz`, `1.5Ghz` to MHz. */
function parseClock(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /([0-9]+(?:\.[0-9]+)?)[ \t]*([mg])hz/i.exec(value);
  const amount = num(match?.[1]);
  if (amount === undefined) return undefined;
  const mhz = (match?.[2] ?? 'm').toLowerCase() === 'g' ? amount * 1000 : amount;
  return positive(Math.round(mhz));
}
