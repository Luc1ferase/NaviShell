/**
 * The Windows collector: one Windows PowerShell 5.1 script that queries CIM and prints a
 * single compressed JSON document, plus the parser for it.
 *
 * Everything goes through `Get-CimInstance` rather than `Get-Counter`, which would spend
 * a second on its own sampling interval, and each query sits in its own `try` with
 * `$ErrorActionPreference = 'SilentlyContinue'`, so a class that is unavailable (the ACPI
 * thermal zone usually is) only drops its own key. The document looks like:
 *
 * ```json
 * {"hostname":"PC","os":{"caption":"Microsoft Windows 11 Pro","version":"10.0.26100",
 *   "uptimeSec":91234,"totalKB":"33400000","freeKB":"12000000"},
 *  "cpu":{"name":"AMD Ryzen 9 7950X","cores":16,"threads":32,"maxMHz":4500,"curMHz":3892},
 *  "cpuUsage":[{"name":"0","value":12},{"name":"_Total","value":9}],
 *  "pageFile":[{"allocMB":2048,"usedMB":130}],"thermal":[3031],
 *  "disks":[{"id":"C:","fs":"NTFS","size":"1023463407616","free":"402653184000"}],
 *  "nvidia":{"present":true,"rc":0,"gpus":["0, NVIDIA …"],"apps":["GPU-… , 42, …"]},
 *  "video":[{"name":"NVIDIA GeForce RTX 4090","driver":"32.0.15.6094","pnp":"PCI\\VEN_10DE…","ram":"4293918720"}]}
 * ```
 *
 * Numbers arrive as numbers or as strings depending on the CIM type, single-element
 * arrays arrive as the element itself, and any key may be missing or null; the parser
 * therefore coerces every value and never indexes blindly.
 *
 * NVIDIA cards come from `nvidia-smi` (which ships with the driver in System32) with live
 * counters; every other adapter is listed name-only from `Win32_VideoController`, with
 * `note.noGpuUtilization`. Their VRAM comes from the display class registry key, whose
 * `HardwareInformation.qwMemorySize` is a 64-bit value; `AdapterRAM` is only the fallback
 * because it is a 32-bit field that saturates near 4 GiB (a 12 GiB card reports 3.99 GiB).
 *
 * Every CIM call selects just the properties it needs: a bare `Win32_Processor` costs
 * 1.1 s and a bare `Win32_OperatingSystem` 0.7 s on a desktop, both around 20 ms with a
 * property list. For the same reason nvidia-smi is looked up by path instead of through
 * `Get-Command`, which spends 0.4 s walking `PATH` when there is no NVIDIA driver.
 */

import type {
  Collector,
  Disk,
  Gpu,
  GpuVendor,
  ParseResult,
  ScriptOutput,
  Snapshot,
} from '../types';
import { NVIDIA_APP_QUERY, NVIDIA_CSV_FORMAT, NVIDIA_GPU_QUERY, parseNvidia } from './nvidia';
import {
  addNote,
  asArray,
  asRecord,
  clamp,
  emptySnapshot,
  kib,
  mib,
  nextGpuIndex,
  NOTE_GPU_TOOL_FAILED,
  NOTE_NO_GPU_UTILIZATION,
  num,
  parseJsonLoose,
  percent,
  positive,
  round1,
  str,
  tempC,
  vendorFromName,
  withUniqueIndexes,
} from './parse-utils';

const SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
$out = @{}
$out.hostname = $env:COMPUTERNAME
try {
  $os = Get-CimInstance -Query 'SELECT Caption,Version,LastBootUpTime,TotalVisibleMemorySize,FreePhysicalMemory FROM Win32_OperatingSystem'
  if ($os) {
    $uptime = $null
    if ($os.LastBootUpTime) { $uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds) }
    $out.os = @{
      caption = [string]$os.Caption
      version = [string]$os.Version
      uptimeSec = $uptime
      totalKB = [string]$os.TotalVisibleMemorySize
      freeKB = [string]$os.FreePhysicalMemory
    }
  }
} catch { }
try {
  $cpus = @(Get-CimInstance -Query 'SELECT Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,CurrentClockSpeed FROM Win32_Processor')
  if ($cpus.Count -gt 0) {
    $cores = 0
    $threads = 0
    $maxMHz = 0
    $curMHz = 0
    foreach ($cpu in $cpus) {
      if ($cpu.NumberOfCores) { $cores = $cores + $cpu.NumberOfCores }
      if ($cpu.NumberOfLogicalProcessors) { $threads = $threads + $cpu.NumberOfLogicalProcessors }
      if ($cpu.MaxClockSpeed -gt $maxMHz) { $maxMHz = $cpu.MaxClockSpeed }
      if ($cpu.CurrentClockSpeed -gt $curMHz) { $curMHz = $cpu.CurrentClockSpeed }
    }
    $out.cpu = @{
      name = [string]$cpus[0].Name
      cores = $cores
      threads = $threads
      maxMHz = $maxMHz
      curMHz = $curMHz
    }
  }
} catch { }
try {
  $out.cpuUsage = @(Get-CimInstance -Query 'SELECT Name,PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor' |
    ForEach-Object { @{ name = [string]$_.Name; value = [string]$_.PercentProcessorTime } })
} catch { }
try {
  $out.pageFile = @(Get-CimInstance -Query 'SELECT AllocatedBaseSize,CurrentUsage FROM Win32_PageFileUsage' |
    ForEach-Object { @{ allocMB = [string]$_.AllocatedBaseSize; usedMB = [string]$_.CurrentUsage } })
} catch { }
try {
  $out.thermal = @(Get-CimInstance -Namespace root/wmi -Query 'SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature' |
    ForEach-Object { [string]$_.CurrentTemperature })
} catch { }
try {
  $out.disks = @(Get-CimInstance -Query 'SELECT DeviceID,FileSystem,Size,FreeSpace FROM Win32_LogicalDisk WHERE DriveType = 3' |
    ForEach-Object { @{
      id = [string]$_.DeviceID
      fs = [string]$_.FileSystem
      size = [string]$_.Size
      free = [string]$_.FreeSpace
    } })
} catch { }
try {
  $out.video = @(Get-CimInstance -Query 'SELECT Name,DriverVersion,PNPDeviceID,AdapterRAM FROM Win32_VideoController' |
    ForEach-Object { @{
      name = [string]$_.Name
      driver = [string]$_.DriverVersion
      pnp = [string]$_.PNPDeviceID
      ram = [string]$_.AdapterRAM
    } })
} catch { }
try {
  $out.vram = @(Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' |
    ForEach-Object { @{
      name = [string]$_.DriverDesc
      bytes = [string]$_.'HardwareInformation.qwMemorySize'
    } })
} catch { }
$smi = $null
foreach ($candidate in @("$env:SystemRoot\\System32\\nvidia-smi.exe", "$env:ProgramFiles\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe")) {
  if (Test-Path -LiteralPath $candidate) { $smi = $candidate; break }
}
if ($smi) {
  try {
    $gpuCsv = @(& $smi '--query-gpu=${NVIDIA_GPU_QUERY}' '${NVIDIA_CSV_FORMAT}' 2>$null)
    $code = $LASTEXITCODE
    $appCsv = @(& $smi '--query-compute-apps=${NVIDIA_APP_QUERY}' '${NVIDIA_CSV_FORMAT}' 2>$null)
    $out.nvidia = @{ present = $true; rc = $code; gpus = $gpuCsv; apps = $appCsv }
  } catch { }
}
ConvertTo-Json -InputObject $out -Compress -Depth 6
`;

export const windowsCollector: Collector = {
  platform: 'windows',
  shell: 'powershell',
  script: SCRIPT,
  parse: parseWindows,
};

export function parseWindows(output: ScriptOutput, _state: unknown): ParseResult {
  const snapshot = emptySnapshot(output.at);
  const root = asRecord(parseJsonLoose(output.stdout));
  if (!root) return { snapshot };
  readHost(root, snapshot);
  readCpu(root, snapshot);
  readMemory(root, snapshot);
  readGpus(root, snapshot);
  snapshot.disks = readDisks(root);
  return { snapshot };
}

// ---------------------------------------------------------------------------
// Host, CPU, memory
// ---------------------------------------------------------------------------

function readHost(root: Record<string, unknown>, snapshot: Snapshot): void {
  snapshot.host.hostname = str(root['hostname']);
  const os = asRecord(root['os']) ?? {};
  const caption = str(os['caption']);
  if (caption !== undefined) snapshot.host.os = caption.replace(/^Microsoft[ \t]+/i, '');
  snapshot.host.kernel = str(os['version']);
  const uptime = num(os['uptimeSec']);
  if (uptime !== undefined && uptime >= 0) snapshot.host.uptimeSec = Math.round(uptime);
}

function readCpu(root: Record<string, unknown>, snapshot: Snapshot): void {
  const cpu = asRecord(root['cpu']) ?? {};
  snapshot.cpu.model = str(cpu['name']);
  const cores = positive(cpu['cores']);
  if (cores !== undefined) snapshot.cpu.cores = cores;
  const threads = positive(cpu['threads']);
  if (threads !== undefined) snapshot.cpu.threads = threads;
  const freq = positive(cpu['curMHz']) ?? positive(cpu['maxMHz']);
  if (freq !== undefined) snapshot.cpu.freqMHz = Math.round(freq);

  const instances: { name: string; value: number | undefined }[] = [];
  for (const entry of asArray(root['cpuUsage'])) {
    const record = asRecord(entry);
    const name = str(record?.['name']);
    if (name === undefined) continue;
    instances.push({ name, value: percent(record?.['value']) });
  }
  // `_Total` is the machine; `0`, `1`, … (or `0,0`, `0,1`, … beyond 64 logical CPUs) are
  // the individual ones, and the per-group totals are called `0,_Total`.
  const perCore = instances
    .filter((entry) => !entry.name.includes('_Total'))
    .sort((left, right) => compareInstances(left.name, right.name))
    .map((entry) => entry.value ?? 0);
  const total = instances.find((entry) => entry.name === '_Total')?.value;
  if (total !== undefined) snapshot.cpu.usage = total;
  else if (perCore.length > 0) {
    snapshot.cpu.usage = round1(perCore.reduce((sum, value) => sum + value, 0) / perCore.length);
  }
  if (perCore.length > 0) snapshot.cpu.perCore = perCore;

  const temperatures = asArray(root['thermal'])
    .map((value) => tempC(kelvinTenths(value)))
    .filter((value): value is number => value !== undefined);
  if (temperatures.length > 0) snapshot.cpu.tempC = Math.max(...temperatures);
}

/** `MSAcpi_ThermalZoneTemperature` reports tenths of a Kelvin. */
function kelvinTenths(value: unknown): number | undefined {
  const tenths = positive(value);
  return tenths === undefined ? undefined : tenths / 10 - 273.15;
}

/** `"0"` before `"1"` before `"10"`, and `"0,5"` before `"1,0"`. */
function compareInstances(left: string, right: string): number {
  const [leftGroup, leftCpu] = instanceOrder(left);
  const [rightGroup, rightCpu] = instanceOrder(right);
  return leftGroup === rightGroup ? leftCpu - rightCpu : leftGroup - rightGroup;
}

function instanceOrder(name: string): [number, number] {
  const parts = name.split(',');
  if (parts.length < 2) return [0, num(parts[0]) ?? 0];
  return [num(parts[0]) ?? 0, num(parts[1]) ?? 0];
}

function readMemory(root: Record<string, unknown>, snapshot: Snapshot): void {
  const os = asRecord(root['os']) ?? {};
  const total = positive(kib(os['totalKB']));
  const available = kib(os['freeKB']);
  if (total !== undefined) snapshot.memory.totalBytes = total;
  if (available !== undefined) {
    snapshot.memory.availableBytes = total === undefined ? available : Math.min(available, total);
  }
  if (total !== undefined && available !== undefined) {
    snapshot.memory.usedBytes = Math.max(0, total - Math.min(available, total));
  }

  let swapTotal: number | undefined;
  let swapUsed: number | undefined;
  for (const entry of asArray(root['pageFile'])) {
    const record = asRecord(entry);
    if (!record) continue;
    const allocated = mib(record['allocMB']);
    const used = mib(record['usedMB']);
    if (allocated !== undefined) swapTotal = (swapTotal ?? 0) + allocated;
    if (used !== undefined) swapUsed = (swapUsed ?? 0) + used;
  }
  if (swapTotal !== undefined) snapshot.memory.swapTotalBytes = swapTotal;
  if (swapUsed !== undefined) {
    snapshot.memory.swapUsedBytes =
      swapTotal === undefined ? swapUsed : Math.min(swapUsed, swapTotal);
  }
}

// ---------------------------------------------------------------------------
// GPUs
// ---------------------------------------------------------------------------

function readGpus(root: Record<string, unknown>, snapshot: Snapshot): void {
  const gpus: Gpu[] = [];
  const vram = readVram(root);
  const nvidia = asRecord(root['nvidia']);
  if (nvidia) {
    const parsed = parseNvidia(joinLines(nvidia['gpus']), joinLines(nvidia['apps']));
    const code = num(nvidia['rc']);
    if (code !== undefined ? code !== 0 : parsed.length === 0) {
      addNote(snapshot, NOTE_GPU_TOOL_FAILED);
    }
    gpus.push(...parsed);
  }
  const live = gpus.length;

  for (const entry of asArray(root['video'])) {
    const card = asRecord(entry);
    const name = str(card?.['name']);
    if (!card || name === undefined) continue;
    const vendor = vendorFromPnp(str(card['pnp'])) ?? vendorFromName(name);
    // The NVIDIA cards are already in the list, with live counters.
    if (vendor === 'nvidia' && live > 0) continue;
    const gpu: Gpu = { index: nextGpuIndex(gpus), vendor, name, processes: [] };
    const driver = str(card['driver']);
    if (driver !== undefined) gpu.driver = driver;
    const ram = vram.get(name.toLowerCase()) ?? positive(card['ram']);
    if (ram !== undefined) gpu.memoryTotalBytes = ram;
    gpus.push(gpu);
  }
  if (gpus.length > live) addNote(snapshot, NOTE_NO_GPU_UTILIZATION);
  snapshot.gpus = withUniqueIndexes(gpus);
}

/**
 * `HardwareInformation.qwMemorySize` per display driver, keyed by the lower-cased
 * `DriverDesc`, which is the same string as `Win32_VideoController.Name`.
 */
function readVram(root: Record<string, unknown>): Map<string, number> {
  const vram = new Map<string, number>();
  for (const entry of asArray(root['vram'])) {
    const record = asRecord(entry);
    const name = str(record?.['name'])?.toLowerCase();
    const bytes = positive(record?.['bytes']);
    if (name === undefined || bytes === undefined || vram.has(name)) continue;
    vram.set(name, bytes);
  }
  return vram;
}

/** The lines of a `nvidia-smi` run as the script captured them, as one block of text. */
function joinLines(value: unknown): string {
  return asArray(value)
    .map((line) => (typeof line === 'string' ? line : ''))
    .join('\n');
}

function vendorFromPnp(pnp: string | undefined): GpuVendor | undefined {
  if (pnp === undefined) return undefined;
  const id = pnp.toUpperCase();
  if (id.includes('VEN_10DE')) return 'nvidia';
  if (id.includes('VEN_1002') || id.includes('VEN_1022')) return 'amd';
  if (id.includes('VEN_8086')) return 'intel';
  return undefined;
}

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------

function readDisks(root: Record<string, unknown>): Disk[] {
  const disks: Disk[] = [];
  for (const entry of asArray(root['disks'])) {
    const record = asRecord(entry);
    const mount = str(record?.['id']);
    const totalBytes = positive(record?.['size']);
    if (!record || mount === undefined || totalBytes === undefined) continue;
    const free = num(record['free']) ?? 0;
    const disk: Disk = {
      mount,
      totalBytes,
      usedBytes: clamp(totalBytes - free, 0, totalBytes),
    };
    const filesystem = str(record['fs']);
    if (filesystem !== undefined) disk.filesystem = filesystem;
    disks.push(disk);
  }
  return disks;
}
