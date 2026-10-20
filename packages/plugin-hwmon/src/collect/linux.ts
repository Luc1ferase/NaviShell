/**
 * The Linux collector: one POSIX shell script (dash, busybox and bash all run it) plus
 * its parser. The very same script runs on this machine and on every SSH target, so it
 * only uses `/proc`, `/sys` and optional tools guarded by `command -v`; a missing tool
 * leaves its section empty and never fails the run.
 *
 * Output layout (each section introduced by a `@@SECTION <name>` line):
 *
 * | section      | content                                                          |
 * | ------------ | ---------------------------------------------------------------- |
 * | `hostname`   | `/proc/sys/kernel/hostname`, or `hostname` where that is missing |
 * | `osrelease`  | `/etc/os-release`                                                |
 * | `kernel`     | `uname -r`                                                       |
 * | `uptime`     | `/proc/uptime`                                                   |
 * | `loadavg`    | `/proc/loadavg`                                                  |
 * | `cpuinfo`    | the `processor`/`model name`/`physical id`/`core id`/`cpu MHz` lines |
 * | `nproc`      | `nproc`                                                          |
 * | `stat`       | the `cpu` and `cpuN` lines of `/proc/stat`                       |
 * | `meminfo`    | the memory and swap lines of `/proc/meminfo`                     |
 * | `cpufreq`    | `scaling_cur_freq` of cpu0, in kHz                               |
 * | `hwmon`      | `<path>:<value>` for the `name` and `temp1_input` of every hwmon |
 * | `thermal`    | `<path>:<value>` for the `type` and `temp` of every thermal zone |
 * | `nvidiaGpus` | nvidia-smi `--query-gpu` CSV (section absent when there is no nvidia-smi) |
 * | `nvidiaRc`   | the exit status of that call                                     |
 * | `nvidiaApps` | nvidia-smi `--query-compute-apps` CSV                            |
 * | `rocmSmi`    | `rocm-smi … --json` (section absent when there is no rocm-smi)   |
 * | `amdVram`    | `<path>:<value>` for the `mem_info_vram_*` of every DRM card     |
 * | `lspci`      | the display controller lines of `lspci`                          |
 * | `df`         | `df -kP`                                                         |
 *
 * CPU utilisation is the only value that needs two samples: the parser carries the
 * `/proc/stat` counters over in its `state` and reports usage from the delta, so the
 * first snapshot of a target has no `cpu.usage` and no `cpu.perCore`.
 */

import type { Collector, Gpu, ParseResult, ScriptOutput, Snapshot } from '../types';
import { NVIDIA_APP_ARGS, NVIDIA_GPU_ARGS, parseNvidia } from './nvidia';
import { parseAmdVram, parseRocmSmi, ROCM_SMI_ARGS, type AmdVram } from './amd';
import {
  addNote,
  asRecord,
  colonKeyed,
  emptySnapshot,
  isUnder,
  kib,
  nextGpuIndex,
  num,
  NOTE_GPU_TOOL_FAILED,
  NOTE_NO_GPU_TOOL,
  NOTE_NO_GPU_UTILIZATION,
  parseDf,
  parseSysfs,
  percent,
  positive,
  sections,
  str,
  tempC,
  vendorFromName,
  withUniqueIndexes,
  type Sections,
} from './parse-utils';

const SCRIPT = `LC_ALL=C
export LC_ALL
echo "@@SECTION hostname"
cat /proc/sys/kernel/hostname 2>/dev/null || hostname 2>/dev/null || true
echo "@@SECTION osrelease"
cat /etc/os-release 2>/dev/null || true
echo "@@SECTION kernel"
uname -r 2>/dev/null || true
echo "@@SECTION uptime"
cat /proc/uptime 2>/dev/null || true
echo "@@SECTION loadavg"
cat /proc/loadavg 2>/dev/null || true
echo "@@SECTION cpuinfo"
grep -E "^(processor|model name|physical id|core id|cpu MHz|Model|Hardware)[[:space:]]*:" /proc/cpuinfo 2>/dev/null || true
echo "@@SECTION nproc"
nproc 2>/dev/null || true
echo "@@SECTION stat"
grep -E "^cpu" /proc/stat 2>/dev/null || true
echo "@@SECTION meminfo"
grep -E "^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):" /proc/meminfo 2>/dev/null || true
echo "@@SECTION cpufreq"
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || true
echo "@@SECTION hwmon"
grep -sH . /sys/class/hwmon/hwmon*/name /sys/class/hwmon/hwmon*/temp1_input 2>/dev/null || true
echo "@@SECTION thermal"
grep -sH . /sys/class/thermal/thermal_zone*/type /sys/class/thermal/thermal_zone*/temp 2>/dev/null || true
TMO=
command -v timeout >/dev/null 2>&1 && TMO="timeout 8"
if command -v nvidia-smi >/dev/null 2>&1; then
  NVG=$($TMO nvidia-smi ${NVIDIA_GPU_ARGS} 2>/dev/null)
  NVRC=$?
  echo "@@SECTION nvidiaGpus"
  printf '%s\\n' "$NVG"
  echo "@@SECTION nvidiaRc"
  echo "$NVRC"
  echo "@@SECTION nvidiaApps"
  $TMO nvidia-smi ${NVIDIA_APP_ARGS} 2>/dev/null || true
fi
if command -v rocm-smi >/dev/null 2>&1; then
  echo "@@SECTION rocmSmi"
  $TMO rocm-smi ${ROCM_SMI_ARGS} 2>/dev/null || true
fi
echo "@@SECTION amdVram"
grep -sH . /sys/class/drm/card*/device/mem_info_vram_total /sys/class/drm/card*/device/mem_info_vram_used 2>/dev/null || true
echo "@@SECTION lspci"
if command -v lspci >/dev/null 2>&1; then
  lspci 2>/dev/null | grep -Ei "vga compatible controller|3d controller|display controller" || true
fi
echo "@@SECTION df"
df -kP 2>/dev/null || df -k 2>/dev/null || true
exit 0
`;

/** `/proc/stat` counters of one CPU, carried over to the next sample. */
interface CpuTimes {
  total: number;
  idle: number;
}

interface LinuxState {
  cpu: Map<string, CpuTimes>;
}

/** hwmon chips that report a CPU package temperature in `temp1_input`. */
const CPU_HWMON = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'];
/** Thermal zones that are the CPU rather than the chipset or the battery. */
const CPU_THERMAL_ZONES = ['x86_pkg_temp', 'cpu-thermal', 'soc_thermal', 'cpu_thermal'];

export const linuxCollector: Collector = {
  platform: 'linux',
  shell: 'sh',
  script: SCRIPT,
  parse: parseLinux,
};

export function parseLinux(output: ScriptOutput, state: unknown): ParseResult {
  const snapshot = emptySnapshot(output.at);
  const blocks = sections(output.stdout);
  readHost(blocks, snapshot);
  const cpuTimes = readCpu(blocks, snapshot, previousState(state));
  readMemory(blocks, snapshot);
  readGpus(blocks, snapshot);
  snapshot.disks = parseDf(blocks.lines('df'), keepDisk);
  return { snapshot, state: { cpu: cpuTimes } satisfies LinuxState };
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

function readHost(blocks: Sections, snapshot: Snapshot): void {
  snapshot.host.hostname = str(blocks.first('hostname'));
  const release = parseOsRelease(blocks.lines('osrelease'));
  const name = release.get('NAME');
  const version = release.get('VERSION') ?? release.get('VERSION_ID');
  snapshot.host.os =
    str(release.get('PRETTY_NAME')) ??
    (name !== undefined && version !== undefined ? `${name} ${version}` : str(name));
  snapshot.host.kernel = str(blocks.first('kernel'));
  const uptime = num(firstField(blocks.first('uptime')));
  if (uptime !== undefined && uptime >= 0) snapshot.host.uptimeSec = Math.round(uptime);
  const load = (blocks.first('loadavg') ?? '').trim().split(/[ \t]+/);
  const [one, five, fifteen] = [num(load[0]), num(load[1]), num(load[2])];
  if (one !== undefined && five !== undefined && fifteen !== undefined) {
    snapshot.host.loadAvg = [one, five, fifteen];
  }
}

/** `KEY=value` with optional quotes, the format of `/etc/os-release`. */
function parseOsRelease(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    const quote = value.slice(0, 1);
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key && !map.has(key)) map.set(key, value);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

function readCpu(
  blocks: Sections,
  snapshot: Snapshot,
  previous: LinuxState | undefined,
): Map<string, CpuTimes> {
  const info = parseCpuinfo(blocks.lines('cpuinfo'));
  const times = parseProcStat(blocks.lines('stat'));
  const statCount = [...times.keys()].filter((key) => key !== 'cpu').length;
  snapshot.cpu.model = info.model;
  const threads = info.processors || statCount || num(blocks.first('nproc'));
  if (threads) snapshot.cpu.threads = threads;
  const cores = info.cores || num(blocks.first('nproc')) || threads;
  if (cores) snapshot.cpu.cores = cores;

  const freqKHz = positive(blocks.first('cpufreq'));
  const freqMHz = freqKHz !== undefined ? Math.round(freqKHz / 1000) : info.averageMHz;
  if (freqMHz !== undefined) snapshot.cpu.freqMHz = Math.round(freqMHz);

  snapshot.cpu.tempC = readTemperature(blocks);

  const usage = usageDelta(times.get('cpu'), previous?.cpu.get('cpu'));
  if (usage !== undefined) snapshot.cpu.usage = usage;
  const perCore = perCoreUsage(times, previous?.cpu);
  if (perCore) snapshot.cpu.perCore = perCore;
  return times;
}

interface CpuInfo {
  model?: string;
  /** Number of `processor` blocks. */
  processors: number;
  /** Distinct `physical id`/`core id` pairs, 0 when the kernel reports neither. */
  cores: number;
  averageMHz?: number;
}

function parseCpuinfo(lines: string[]): CpuInfo {
  const pairs = new Set<string>();
  const clocks: number[] = [];
  let processors = 0;
  let modelName: string | undefined;
  let board: string | undefined;
  let physical: string | undefined;
  let core: string | undefined;
  const flush = (): void => {
    if (physical !== undefined && core !== undefined) pairs.add(`${physical}/${core}`);
    physical = undefined;
    core = undefined;
  };
  for (const line of lines) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    switch (key) {
      case 'processor':
        flush();
        processors += 1;
        break;
      case 'model name':
        modelName ??= str(value);
        break;
      case 'model':
      case 'hardware':
        board ??= str(value);
        break;
      case 'physical id':
        physical = value;
        break;
      case 'core id':
        core = value;
        break;
      case 'cpu mhz': {
        const mhz = positive(value);
        if (mhz !== undefined) clocks.push(mhz);
        break;
      }
      default:
        break;
    }
  }
  flush();
  const info: CpuInfo = { processors, cores: pairs.size };
  const model = modelName ?? board;
  if (model !== undefined) info.model = model;
  if (clocks.length > 0) {
    info.averageMHz = clocks.reduce((sum, value) => sum + value, 0) / clocks.length;
  }
  return info;
}

/** The `cpu`/`cpuN` lines of `/proc/stat`: name, then the jiffies per state. */
function parseProcStat(lines: string[]): Map<string, CpuTimes> {
  const times = new Map<string, CpuTimes>();
  for (const line of lines) {
    const fields = line.trim().split(/[ \t]+/);
    const name = fields[0];
    if (name === undefined || !/^cpu[0-9]*$/.test(name) || times.has(name)) continue;
    let total = 0;
    let idle = 0;
    for (let i = 1; i < fields.length; i += 1) {
      const value = num(fields[i]);
      if (value === undefined) continue;
      total += value;
      // user nice system idle iowait irq softirq steal …: idle and iowait are field 4 and 5.
      if (i === 4 || i === 5) idle += value;
    }
    if (total > 0) times.set(name, { total, idle });
  }
  return times;
}

function usageDelta(now: CpuTimes | undefined, before: CpuTimes | undefined): number | undefined {
  if (!now || !before) return undefined;
  const total = now.total - before.total;
  const idle = now.idle - before.idle;
  if (total <= 0) return undefined;
  return percent(((total - idle) / total) * 100);
}

function perCoreUsage(
  times: Map<string, CpuTimes>,
  previous: Map<string, CpuTimes> | undefined,
): number[] | undefined {
  if (!previous) return undefined;
  const names = [...times.keys()]
    .filter((name) => name !== 'cpu')
    .sort((left, right) => (num(left.slice(3)) ?? 0) - (num(right.slice(3)) ?? 0));
  if (names.length === 0) return undefined;
  const values: number[] = [];
  let measured = 0;
  for (const name of names) {
    const usage = usageDelta(times.get(name), previous.get(name));
    if (usage !== undefined) measured += 1;
    values.push(usage ?? 0);
  }
  return measured > 0 ? values : undefined;
}

function readTemperature(blocks: Sections): number | undefined {
  const chips = readSensors(blocks.lines('hwmon'), 'name', 'temp1_input');
  for (const wanted of CPU_HWMON) {
    const temperature = milliCelsius(chips.get(wanted));
    if (temperature !== undefined) return temperature;
  }
  const zones = readSensors(blocks.lines('thermal'), 'type', 'temp');
  for (const wanted of CPU_THERMAL_ZONES) {
    const temperature = milliCelsius(zones.get(wanted));
    if (temperature !== undefined) return temperature;
  }
  return undefined;
}

/** Sensor readings keyed by the lower-cased chip name or zone type. */
function readSensors(lines: string[], label: string, reading: string): Map<string, string> {
  const sensors = new Map<string, string>();
  for (const values of parseSysfs(lines).values()) {
    const name = str(values.get(label))?.toLowerCase();
    const value = values.get(reading);
    if (name === undefined || value === undefined || sensors.has(name)) continue;
    sensors.set(name, value);
  }
  return sensors;
}

/** sysfs reports temperatures in thousandths of a degree. */
function milliCelsius(value: string | undefined): number | undefined {
  const milli = num(value);
  return milli === undefined ? undefined : tempC(milli / 1000);
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function readMemory(blocks: Sections, snapshot: Snapshot): void {
  const meminfo = colonKeyed(blocks.lines('meminfo'));
  const value = (key: string): number | undefined => kib(firstField(meminfo.get(key)));
  const total = value('MemTotal');
  const available =
    value('MemAvailable') ?? sum([value('MemFree'), value('Buffers'), value('Cached')]);
  if (total !== undefined) snapshot.memory.totalBytes = total;
  if (available !== undefined) {
    snapshot.memory.availableBytes = total === undefined ? available : Math.min(available, total);
  }
  if (total !== undefined && available !== undefined) {
    snapshot.memory.usedBytes = Math.max(0, total - Math.min(available, total));
  }
  const swapTotal = value('SwapTotal');
  const swapFree = value('SwapFree');
  if (swapTotal !== undefined) snapshot.memory.swapTotalBytes = swapTotal;
  if (swapTotal !== undefined && swapFree !== undefined) {
    snapshot.memory.swapUsedBytes = Math.max(0, swapTotal - Math.min(swapFree, swapTotal));
  }
}

/** The sum, or undefined when every part is missing; missing parts count as zero. */
function sum(values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length === 0 ? undefined : known.reduce((left, right) => left + right, 0);
}

function firstField(line: string | undefined): string | undefined {
  return line?.trim().split(/[ \t]+/)[0];
}

// ---------------------------------------------------------------------------
// GPUs
// ---------------------------------------------------------------------------

function readGpus(blocks: Sections, snapshot: Snapshot): void {
  const hasNvidiaSmi = blocks.has('nvidiaGpus');
  const hasRocmSmi = blocks.has('rocmSmi');
  const gpus: Gpu[] = [];

  if (hasNvidiaSmi) {
    const nvidia = parseNvidia(blocks.text('nvidiaGpus'), blocks.text('nvidiaApps'));
    const code = num(blocks.first('nvidiaRc'));
    if (code !== undefined ? code !== 0 : nvidia.length === 0) {
      addNote(snapshot, NOTE_GPU_TOOL_FAILED);
    }
    gpus.push(...nvidia);
  }

  const vram = parseAmdVram(blocks.lines('amdVram'));
  if (hasRocmSmi) {
    const before = gpus.length;
    const offset = nextGpuIndex(gpus);
    for (const gpu of parseRocmSmi(blocks.text('rocmSmi'), vram)) {
      gpus.push({ ...gpu, index: gpu.index + offset });
    }
    if (gpus.length === before) addNote(snapshot, NOTE_GPU_TOOL_FAILED);
  }

  if (gpus.length === 0) {
    const listed = parseLspci(blocks.lines('lspci'), vram);
    if (listed.length > 0) {
      gpus.push(...listed);
      addNote(snapshot, hasNvidiaSmi || hasRocmSmi ? NOTE_NO_GPU_UTILIZATION : NOTE_NO_GPU_TOOL);
    }
  }

  snapshot.gpus = withUniqueIndexes(gpus);
}

/**
 * The display controllers `lspci` knows, when no vendor tool is installed: names only,
 * plus the VRAM size of the AMD cards when sysfs happens to expose as many as were
 * listed.
 */
function parseLspci(lines: string[], vram: Map<number, AmdVram>): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of lines) {
    const at = line.indexOf(': ');
    if (at <= 0) continue;
    const slot = line
      .slice(0, at)
      .trim()
      .split(/[ \t]+/)[0];
    const name = line
      .slice(at + 2)
      .replace(/[ \t]*\(rev [^)]*\)[ \t]*$/i, '')
      .trim();
    if (!name) continue;
    const gpu: Gpu = { index: gpus.length, vendor: vendorFromName(name), name, processes: [] };
    const busId = str(slot);
    if (busId !== undefined) gpu.busId = busId;
    gpus.push(gpu);
  }
  const amd = gpus.filter((gpu) => gpu.vendor === 'amd');
  const sizes = [...vram.keys()].sort((left, right) => left - right);
  if (amd.length > 0 && amd.length === sizes.length) {
    sizes.forEach((card, position) => {
      const gpu = amd[position];
      const entry = vram.get(card);
      if (!gpu || !entry) return;
      if (entry.totalBytes !== undefined) gpu.memoryTotalBytes = entry.totalBytes;
      if (entry.usedBytes !== undefined) gpu.memoryUsedBytes = entry.usedBytes;
    });
  }
  return gpus;
}

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------

/** Kernel and image filesystems, which carry no interesting free space. */
const PSEUDO_FILESYSTEMS = new Set([
  'binfmt_misc',
  'bpf',
  'cgroup',
  'cgroup2',
  'configfs',
  'debugfs',
  'devpts',
  'devtmpfs',
  'efivarfs',
  'fusectl',
  'hugetlbfs',
  'mqueue',
  'none',
  'nsfs',
  'overlay',
  'overlayfs',
  'proc',
  'pstore',
  'ramfs',
  'rootfs',
  'run',
  'securityfs',
  'shm',
  'squashfs',
  'sysfs',
  'systemd-1',
  'tmpfs',
  'tracefs',
  'udev',
]);

const PSEUDO_MOUNTS = ['/dev', '/proc', '/run', '/snap', '/sys'];

function keepDisk(filesystem: string, mount: string): boolean {
  if (PSEUDO_FILESYSTEMS.has(filesystem.toLowerCase())) return false;
  return !PSEUDO_MOUNTS.some((prefix) => isUnder(mount, prefix));
}

/** The `/proc/stat` counters of the previous sample, if this target had one. */
function previousState(state: unknown): LinuxState | undefined {
  const record = asRecord(state);
  const cpu = record?.['cpu'];
  // Only ever produced by `parseLinux` above, so the element type is known.
  return cpu instanceof Map ? { cpu: cpu as Map<string, CpuTimes> } : undefined;
}
