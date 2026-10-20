/**
 * The macOS collector: one `/bin/sh` script (bash 3.2 in POSIX mode) plus its parser.
 * It only uses tools that are part of the system — `sysctl`, `sw_vers`, `top`, `vm_stat`,
 * `system_profiler`, `ioreg`, `df` — and prints each one into its own `@@SECTION`.
 *
 * | section      | content                                                            |
 * | ------------ | ------------------------------------------------------------------ |
 * | `sysctl`     | `<key> <value>` for the CPU, memory and page-size keys             |
 * | `swvers`     | `sw_vers` (ProductName, ProductVersion, BuildVersion)              |
 * | `kernel`     | `uname -r`                                                         |
 * | `hostname`   | `hostname`                                                         |
 * | `loadavg`    | `sysctl -n vm.loadavg`, i.e. `{ 1.50 1.60 1.70 }`                  |
 * | `boottime`   | `sysctl -n kern.boottime`, i.e. `{ sec = 1729…, usec = 0 } …`       |
 * | `cpuusage`   | the last `CPU usage:` line of `top -l 2 -n 0 -s 1`                 |
 * | `vmstat`     | `vm_stat`                                                          |
 * | `swapusage`  | `sysctl -n vm.swapusage`                                           |
 * | `displays`   | `system_profiler SPDisplaysDataType -json`                         |
 * | `ioreg`      | the `"Device Utilization %"=N` matches of the IOAccelerator nodes   |
 * | `df`         | `df -kP`                                                           |
 *
 * CPU utilisation comes from `top`'s own two samples, so it needs no carry-over state
 * and is already present in the first snapshot; the price is the one second `top` waits.
 * macOS exposes no per-core utilisation and no CPU temperature without a kernel
 * extension, so both stay absent.
 */

import type { Collector, Gpu, ParseResult, ScriptOutput, Snapshot } from '../types';
import {
  addNote,
  asArray,
  asRecord,
  clamp,
  colonKeyed,
  emptySnapshot,
  isUnder,
  NOTE_NO_GPU_UTILIZATION,
  num,
  parseDf,
  parseJsonLoose,
  parseSize,
  percent,
  positive,
  round1,
  sections,
  spaceKeyed,
  str,
  toLines,
  vendorFromName,
  type Sections,
} from './parse-utils';

const SCRIPT = `LC_ALL=C
export LC_ALL
echo "@@SECTION sysctl"
for k in machdep.cpu.brand_string hw.physicalcpu hw.logicalcpu hw.memsize hw.pagesize hw.cpufrequency hw.cpufrequency_max; do
  printf '%s %s\\n' "$k" "$(sysctl -n $k 2>/dev/null)"
done
echo "@@SECTION swvers"
sw_vers 2>/dev/null || true
echo "@@SECTION kernel"
uname -r 2>/dev/null || true
echo "@@SECTION hostname"
hostname 2>/dev/null || true
echo "@@SECTION loadavg"
sysctl -n vm.loadavg 2>/dev/null || true
echo "@@SECTION boottime"
sysctl -n kern.boottime 2>/dev/null || true
echo "@@SECTION cpuusage"
top -l 2 -n 0 -s 1 2>/dev/null | grep "CPU usage" | tail -1 || true
echo "@@SECTION vmstat"
vm_stat 2>/dev/null || true
echo "@@SECTION swapusage"
sysctl -n vm.swapusage 2>/dev/null || true
echo "@@SECTION displays"
system_profiler SPDisplaysDataType -json 2>/dev/null || true
echo "@@SECTION ioreg"
ioreg -r -d 1 -c IOAccelerator 2>/dev/null | grep -o '"Device Utilization %"=[0-9]*' || true
echo "@@SECTION df"
df -kP 2>/dev/null || true
exit 0
`;

export const macosCollector: Collector = {
  platform: 'macos',
  shell: 'sh',
  script: SCRIPT,
  parse: parseMacos,
};

export function parseMacos(output: ScriptOutput, _state: unknown): ParseResult {
  const snapshot = emptySnapshot(output.at);
  const blocks = sections(output.stdout);
  const sysctl = spaceKeyed(blocks.lines('sysctl'));
  readHost(blocks, snapshot);
  readCpu(blocks, sysctl, snapshot);
  readMemory(blocks, sysctl, snapshot);
  readGpus(blocks, snapshot);
  snapshot.disks = parseDf(blocks.lines('df'), keepDisk);
  return { snapshot };
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

function readHost(blocks: Sections, snapshot: Snapshot): void {
  snapshot.host.hostname = str(blocks.first('hostname'));
  const versions = colonKeyed(blocks.lines('swvers'));
  const product = str(versions.get('ProductName'));
  const version = str(versions.get('ProductVersion'));
  snapshot.host.os = version === undefined ? product : `${product ?? 'macOS'} ${version}`;
  snapshot.host.kernel = str(blocks.first('kernel'));

  const load = /^[{ \t]*([0-9.]+)[ \t]+([0-9.]+)[ \t]+([0-9.]+)/.exec(
    blocks.first('loadavg') ?? '',
  );
  const [one, five, fifteen] = [num(load?.[1]), num(load?.[2]), num(load?.[3])];
  if (one !== undefined && five !== undefined && fifteen !== undefined) {
    snapshot.host.loadAvg = [one, five, fifteen];
  }

  const bootSec = num(/sec[ \t]*=[ \t]*(\d+)/.exec(blocks.first('boottime') ?? '')?.[1]);
  if (bootSec !== undefined && bootSec > 0) {
    const uptime = Math.round(snapshot.at / 1000 - bootSec);
    if (uptime >= 0) snapshot.host.uptimeSec = uptime;
  }
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

function readCpu(blocks: Sections, sysctl: Map<string, string>, snapshot: Snapshot): void {
  snapshot.cpu.model = str(sysctl.get('machdep.cpu.brand_string'));
  const cores = positive(sysctl.get('hw.physicalcpu'));
  if (cores !== undefined) snapshot.cpu.cores = cores;
  const threads = positive(sysctl.get('hw.logicalcpu'));
  if (threads !== undefined) snapshot.cpu.threads = threads;
  // Intel Macs report the nominal clock in Hz; Apple Silicon reports nothing at all.
  const hz = positive(sysctl.get('hw.cpufrequency')) ?? positive(sysctl.get('hw.cpufrequency_max'));
  if (hz !== undefined) snapshot.cpu.freqMHz = Math.round(hz / 1_000_000);

  // "CPU usage: 3.84% user, 7.69% sys, 88.46% idle"
  const line = blocks.first('cpuusage') ?? '';
  const idle = num(/([0-9.]+)%[ \t]*idle/.exec(line)?.[1]);
  if (idle !== undefined) {
    snapshot.cpu.usage = round1(clamp(100 - idle, 0, 100));
    return;
  }
  const user = num(/([0-9.]+)%[ \t]*user/.exec(line)?.[1]);
  const system = num(/([0-9.]+)%[ \t]*sys/.exec(line)?.[1]);
  if (user !== undefined && system !== undefined) {
    snapshot.cpu.usage = round1(clamp(user + system, 0, 100));
  }
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function readMemory(blocks: Sections, sysctl: Map<string, string>, snapshot: Snapshot): void {
  const total = positive(sysctl.get('hw.memsize'));
  if (total !== undefined) snapshot.memory.totalBytes = total;

  const stats = colonKeyed(blocks.lines('vmstat'));
  const pages = (key: string): number | undefined => num((stats.get(key) ?? '').replace(/\.$/, ''));
  const pageSize =
    positive(sysctl.get('hw.pagesize')) ??
    positive(/page size of (\d+) bytes/.exec(blocks.text('vmstat'))?.[1]);
  const active = pages('Pages active');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor') ?? 0;
  if (pageSize !== undefined && active !== undefined && wired !== undefined) {
    const used = (active + wired + compressed) * pageSize;
    snapshot.memory.usedBytes = total === undefined ? used : Math.min(used, total);
    if (total !== undefined) {
      snapshot.memory.availableBytes = Math.max(0, total - Math.min(used, total));
    }
  }

  // "total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)"
  const swap = blocks.first('swapusage') ?? '';
  const swapTotal = parseSize(/total[ \t]*=[ \t]*([0-9.]+[A-Za-z]*)/.exec(swap)?.[1]);
  const swapUsed = parseSize(/used[ \t]*=[ \t]*([0-9.]+[A-Za-z]*)/.exec(swap)?.[1]);
  if (swapTotal !== undefined) snapshot.memory.swapTotalBytes = swapTotal;
  if (swapUsed !== undefined) {
    snapshot.memory.swapUsedBytes =
      swapTotal === undefined ? swapUsed : Math.min(swapUsed, swapTotal);
  }
}

// ---------------------------------------------------------------------------
// GPUs
// ---------------------------------------------------------------------------

/** `sppci_vendor_amd`, `sppci_vendor_Apple`, `0x1002`, … to a vendor. */
const VENDOR_IDS: Record<string, Gpu['vendor']> = {
  '0x1002': 'amd',
  '0x10de': 'nvidia',
  '0x8086': 'intel',
  '0x106b': 'apple',
};

function readGpus(blocks: Sections, snapshot: Snapshot): void {
  const root = asRecord(parseJsonLoose(blocks.text('displays')));
  const entries = asArray(root?.['SPDisplaysDataType']);
  const utilisation = toLines(blocks.text('ioreg'))
    .map((line) => percent(/=(\d+)/.exec(line)?.[1]))
    .filter((value): value is number => value !== undefined);

  const gpus: Gpu[] = [];
  for (const entry of entries) {
    const card = asRecord(entry);
    if (!card) continue;
    const name = str(card['sppci_model']) ?? str(card['_name']);
    if (name === undefined) continue;
    const gpu: Gpu = { index: gpus.length, vendor: vendorOf(card, name), name, processes: [] };
    const vram = parseSize(card['spdisplays_vram']) ?? parseSize(card['spdisplays_vram_shared']);
    if (vram !== undefined) gpu.memoryTotalBytes = vram;
    gpus.push(gpu);
  }

  // One utilisation reading per accelerator, in ioreg's order; only trust the pairing
  // when the counts line up, or when there is a single GPU and a single reading.
  if (utilisation.length === gpus.length || (gpus.length === 1 && utilisation.length >= 1)) {
    gpus.forEach((gpu, position) => {
      const value = utilisation[position];
      if (value !== undefined) gpu.utilization = value;
    });
  }

  if (gpus.length > 0 && gpus.some((gpu) => gpu.utilization === undefined)) {
    addNote(snapshot, NOTE_NO_GPU_UTILIZATION);
  }
  snapshot.gpus = gpus;
}

function vendorOf(card: Record<string, unknown>, name: string): Gpu['vendor'] {
  const raw = (str(card['sppci_vendor']) ?? str(card['spdisplays_vendor']) ?? '').toLowerCase();
  const byId = VENDOR_IDS[raw];
  if (byId !== undefined) return byId;
  const tail = raw.replace(/^sppci_vendor_/, '');
  if (tail.includes('nvidia')) return 'nvidia';
  if (tail.includes('amd') || tail.includes('ati')) return 'amd';
  if (tail.includes('intel')) return 'intel';
  if (tail.includes('apple')) return 'apple';
  return vendorFromName(name);
}

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------

/** The synthetic volumes macOS mounts next to the real ones. */
const SYNTHETIC_MOUNTS = [
  '/dev',
  '/System/Volumes/Hardware',
  '/System/Volumes/Preboot',
  '/System/Volumes/Recovery',
  '/System/Volumes/Update',
  '/System/Volumes/VM',
  '/System/Volumes/iSCPreboot',
  '/System/Volumes/xarts',
  '/private/var/vm',
];

function keepDisk(filesystem: string, mount: string): boolean {
  const name = filesystem.toLowerCase();
  if (name === 'devfs' || name === 'autofs' || name === 'none' || name.startsWith('map ')) {
    return false;
  }
  return !SYNTHETIC_MOUNTS.some((prefix) => isUnder(mount, prefix));
}
