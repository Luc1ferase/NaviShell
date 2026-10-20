import { useState } from 'react';
import type { JSX } from 'react';
import { ChevronDown, ChevronRight, Fan, Gauge, ListTree, Thermometer, Zap } from 'lucide-react';

import {
  formatBytesPair,
  formatMHz,
  formatPercent,
  formatTemp,
  formatWattsPair,
  gpuTemperatureTone,
  memoryTone,
  ratio,
  utilizationTone,
  type Translate,
} from '../format';
import type { Gpu } from '../types';
import { ProcessList, VendorBadge, gpuMemoryTitle, gpuTitle, processesTitle } from './GpuProcesses';
import { Bar, Ring, Stat } from './Meter';
import { Sparkline } from './Sparkline';

interface GpuCardProps {
  gpu: Gpu;
  /** `history.gpuUtil[slot]` for this card, oldest first. */
  series: readonly (number | undefined)[];
  t: Translate;
}

/**
 * One GPU as a compact fixed-height card. Cards keep their height whether or not the
 * platform reports temperature, power or fans, so a grid of them stays on a clean baseline;
 * the process list is the only part that grows, and only when the user opens it.
 */
export function GpuCard({ gpu, series, t }: GpuCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const memPercent = ratio(gpu.memoryUsedBytes, gpu.memoryTotalBytes);
  const utilTone = utilizationTone(gpu.utilization);
  const count = gpu.processes.length;
  return (
    <article className="ns-hwmon-gpu-card">
      <header className="ns-hwmon-gpu-head">
        <span className="ns-hwmon-gpu-slot">#{gpu.index}</span>
        <span className="ns-hwmon-gpu-name" title={gpuTitle(gpu, t)}>
          {gpu.name}
        </span>
        <VendorBadge vendor={gpu.vendor} t={t} />
      </header>

      <div className="ns-hwmon-card-row">
        <Ring
          value={gpu.utilization}
          size={56}
          thickness={6}
          tone={utilTone}
          text={formatPercent(gpu.utilization)}
          caption={t('gpu.utilization')}
          ariaLabel={t('gpu.utilization')}
        />
        <Sparkline
          values={series}
          tone={utilTone}
          className="ns-hwmon-spark-grow"
          title={t('gpu.history', { index: gpu.index })}
        />
      </div>

      <div className="ns-hwmon-gauge">
        <div className="ns-hwmon-gauge-head">
          <span className="ns-hwmon-gauge-label">{t('gpu.memory')}</span>
          <span className="ns-hwmon-gauge-value">
            {formatBytesPair(gpu.memoryUsedBytes, gpu.memoryTotalBytes)}
          </span>
          <span className="ns-hwmon-gauge-percent">{formatPercent(memPercent)}</span>
        </div>
        <Bar
          value={memPercent}
          tone={memoryTone(memPercent)}
          title={gpuMemoryTitle(gpu, t)}
          ariaLabel={t('gpu.memory')}
        />
      </div>

      {/* Compact: at 240 px a card has no room for four written labels, and the icons
          (thermometer, bolt, fan, gauge) plus the tooltips carry them. */}
      <div className="ns-hwmon-gpu-stats">
        <Stat
          compact
          icon={<Thermometer size={12} />}
          label={t('gpu.temperature')}
          value={formatTemp(gpu.tempC)}
          tone={gpuTemperatureTone(gpu.tempC)}
        />
        <Stat
          compact
          icon={<Zap size={12} />}
          label={t('gpu.power')}
          value={formatWattsPair(gpu.powerW, gpu.powerLimitW)}
        />
        <Stat
          compact
          icon={<Fan size={12} />}
          label={t('gpu.fan')}
          value={formatPercent(gpu.fanPercent)}
        />
        <Stat
          compact
          icon={<Gauge size={12} />}
          label={t('gpu.clock')}
          value={formatMHz(gpu.clockMHz)}
          title={`${t('gpu.clock')} ${formatMHz(gpu.clockMHz)} · ${t('gpu.memClock')} ${formatMHz(
            gpu.memClockMHz,
          )}`}
        />
      </div>

      <button
        type="button"
        className="ns-hwmon-procs-toggle"
        title={processesTitle(gpu, t)}
        aria-expanded={open}
        disabled={count === 0}
        onClick={() => setOpen((value) => !value)}
      >
        <ListTree size={12} />
        <span className="ns-hwmon-procs-count">
          {count === 0 ? t('gpu.noProcesses') : t('gpu.processCount', { count })}
        </span>
        {count > 0 ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
      </button>
      {open && count > 0 ? <ProcessList processes={gpu.processes} t={t} /> : null}
    </article>
  );
}
