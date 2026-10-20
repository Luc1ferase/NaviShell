import type { JSX } from 'react';

import { DASH, formatBytes, formatBytesPair, formatPercent, type Translate } from '../format';
import type { Gpu, GpuProcess, GpuVendor } from '../types';

/** Longest tooltip we build; past this the list in the card is the better place to look. */
const TOOLTIP_LIMIT = 16;

const VENDOR_KEYS: Record<GpuVendor, string> = {
  nvidia: 'gpu.vendorNvidia',
  amd: 'gpu.vendorAmd',
  intel: 'gpu.vendorIntel',
  apple: 'gpu.vendorApple',
  other: 'gpu.vendorOther',
};

export function vendorLabel(vendor: GpuVendor, t: Translate): string {
  return t(VENDOR_KEYS[vendor]);
}

export function VendorBadge({ vendor, t }: { vendor: GpuVendor; t: Translate }): JSX.Element {
  return (
    <span className={`ns-hwmon-badge ns-hwmon-badge-${vendor}`}>{vendorLabel(vendor, t)}</span>
  );
}

/**
 * Full identity of a card for the `title` of its (ellipsised) name: vendor, bus id and
 * driver, which is where you look when two cards report the same model name.
 */
export function gpuTitle(gpu: Gpu, t: Translate): string {
  const parts = [`#${gpu.index}  ${gpu.name}`, vendorLabel(gpu.vendor, t)];
  if (gpu.busId) parts.push(`${t('gpu.busId')} ${gpu.busId}`);
  if (gpu.driver) parts.push(`${t('gpu.driver')} ${gpu.driver}`);
  return parts.join(' · ');
}

/** Memory tooltip: the fill plus the memory-bus load, when the tool reports it. */
export function gpuMemoryTitle(gpu: Gpu, t: Translate): string {
  const used = `${t('gpu.memory')} ${formatBytesPair(gpu.memoryUsedBytes, gpu.memoryTotalBytes)}`;
  if (gpu.memoryUtilization === undefined) return used;
  return `${used} · ${t('gpu.memoryUtilization')} ${formatPercent(gpu.memoryUtilization)}`;
}

/** `pid name memory` per line, for the `title` tooltip on a process count. */
export function processesTitle(gpu: Gpu, t: Translate): string {
  if (gpu.processes.length === 0) return t('gpu.noProcesses');
  const lines = gpu.processes
    .slice(0, TOOLTIP_LIMIT)
    .map(
      (process) => `${process.pid}  ${process.name ?? DASH}  ${formatBytes(process.memoryBytes)}`,
    );
  if (gpu.processes.length > TOOLTIP_LIMIT) {
    lines.push(t('gpu.moreProcesses', { count: gpu.processes.length - TOOLTIP_LIMIT }));
  }
  return lines.join('\n');
}

interface ProcessListProps {
  processes: readonly GpuProcess[];
  t: Translate;
}

/** The expanded list under a GPU card: one `pid name memory` row per compute process. */
export function ProcessList({ processes, t }: ProcessListProps): JSX.Element {
  if (processes.length === 0) {
    return <p className="ns-hwmon-proc-empty">{t('gpu.noProcesses')}</p>;
  }
  return (
    <ul className="ns-hwmon-procs-list">
      {processes.map((process) => (
        <li key={process.pid} className="ns-hwmon-procs-row">
          <span className="ns-hwmon-procs-pid">{process.pid}</span>
          <span className="ns-hwmon-procs-name" title={process.name}>
            {process.name ?? DASH}
          </span>
          <span className="ns-hwmon-procs-mem">{formatBytes(process.memoryBytes)}</span>
        </li>
      ))}
    </ul>
  );
}
