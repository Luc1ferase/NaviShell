/**
 * nvidia-smi, shared by the Linux and the Windows collector.
 *
 * Both run the same two queries, because `nvidia-smi.exe` ships with the Windows driver
 * in System32 and prints exactly what the Linux binary prints:
 *
 * ```
 * 0, NVIDIA GeForce RTX 4090, 00000000:01:00.0, GPU-1b4…, 12, 3, 1536, 24564, 41, 32.11, 450.00, 30, 2520, 10501, 550.120
 * GPU-1b4…, 4312, python, 1024
 * ```
 *
 * Every field can be `[N/A]`, `[Not Supported]` or `N/A` instead of a number (consumer
 * cards have no power limit readout, vGPUs have no fan), so each one is coerced on its
 * own and simply stays absent when the driver has nothing to say.
 */

import type { Gpu, GpuProcess } from '../types';
import { mib, num, percent, positive, splitCsvLine, str, tempC, toLines } from './parse-utils';

/** The `--query-gpu=` field list; the parser below depends on this exact order. */
export const NVIDIA_GPU_QUERY =
  'index,name,pci.bus_id,uuid,utilization.gpu,utilization.memory,memory.used,memory.total,' +
  'temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,clocks.mem,driver_version';

/** The `--query-compute-apps=` field list. */
export const NVIDIA_APP_QUERY = 'gpu_uuid,pid,process_name,used_memory';

/** The output format both queries use; PowerShell needs it as its own argument. */
export const NVIDIA_CSV_FORMAT = '--format=csv,noheader,nounits';

/** Ready-made argument strings, so the two scripts cannot drift apart. */
export const NVIDIA_GPU_ARGS = `--query-gpu=${NVIDIA_GPU_QUERY} ${NVIDIA_CSV_FORMAT}`;
export const NVIDIA_APP_ARGS = `--query-compute-apps=${NVIDIA_APP_QUERY} ${NVIDIA_CSV_FORMAT}`;

const GPU_FIELDS = 15;
const APP_FIELDS = 4;

/**
 * The GPUs of one `--query-gpu` run, with the compute processes of one
 * `--query-compute-apps` run attached by UUID. Unparsable lines (warnings such as
 * "No devices were found") are skipped.
 */
export function parseNvidia(gpuCsv: string, appCsv: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of toLines(gpuCsv)) {
    const gpu = parseGpuRow(line, gpus.length);
    if (gpu) gpus.push(gpu);
  }
  attachProcesses(gpus, appCsv);
  return gpus;
}

function parseGpuRow(line: string, position: number): Gpu | undefined {
  if (!line.includes(',')) return undefined;
  const fields = rejoinName(splitCsvLine(line), GPU_FIELDS, 1);
  if (fields.length < 5) return undefined;
  const index = num(fields[0]);
  const name = str(fields[1]);
  // A row without an index and without a name is a warning, not a GPU.
  if (index === undefined && name === undefined) return undefined;
  return {
    index: index ?? position,
    vendor: 'nvidia',
    name: name ?? `NVIDIA GPU ${index ?? position}`,
    busId: str(fields[2]),
    uuid: str(fields[3]),
    utilization: percent(fields[4]),
    memoryUtilization: percent(fields[5]),
    memoryUsedBytes: mib(fields[6]),
    memoryTotalBytes: positive(mib(fields[7])),
    tempC: tempC(fields[8]),
    powerW: num(fields[9]),
    powerLimitW: positive(num(fields[10])),
    fanPercent: percent(fields[11]),
    clockMHz: positive(num(fields[12])),
    memClockMHz: positive(num(fields[13])),
    driver: str(fields[14]),
    processes: [],
  };
}

function attachProcesses(gpus: Gpu[], appCsv: string): void {
  if (gpus.length === 0) return;
  const byUuid = new Map<string, Gpu>();
  for (const gpu of gpus) if (gpu.uuid) byUuid.set(gpu.uuid, gpu);
  for (const line of toLines(appCsv)) {
    if (!line.includes(',')) continue;
    const fields = rejoinName(splitCsvLine(line), APP_FIELDS, 2);
    if (fields.length < 2) continue;
    const pid = num(fields[1]);
    if (pid === undefined || pid <= 0) continue;
    const uuid = str(fields[0]);
    // Drivers that do not report a UUID per process still work on single-GPU machines.
    const gpu = (uuid ? byUuid.get(uuid) : undefined) ?? (gpus.length === 1 ? gpus[0] : undefined);
    if (!gpu) continue;
    const process: GpuProcess = { pid };
    const name = str(fields[2]);
    if (name !== undefined) process.name = name;
    const memoryBytes = mib(fields[3]);
    if (memoryBytes !== undefined) process.memoryBytes = memoryBytes;
    gpu.processes.push(process);
  }
}

/**
 * nvidia-smi does not quote its CSV, so a comma inside a process name or a card name
 * produces extra fields; they belong to `nameIndex`.
 */
function rejoinName(fields: string[], expected: number, nameIndex: number): string[] {
  if (fields.length <= expected) return fields;
  const extra = fields.length - expected;
  const merged = fields.slice(0, nameIndex);
  merged.push(
    fields
      .slice(nameIndex, nameIndex + extra + 1)
      .join(', ')
      .trim(),
  );
  merged.push(...fields.slice(nameIndex + extra + 1));
  return merged;
}
