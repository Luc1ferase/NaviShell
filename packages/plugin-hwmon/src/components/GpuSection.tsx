import { useMemo } from 'react';
import type { JSX } from 'react';
import { Fan, Gpu as GpuIcon, ListTree, MemoryStick, Thermometer, Zap } from 'lucide-react';

import {
  averageDefined,
  formatBytesPair,
  formatPercent,
  formatTemp,
  formatWattsPair,
  gpuSeriesBySlot,
  gpuTemperatureTone,
  maxDefined,
  memoryTone,
  ratio,
  sortGpuRows,
  sumDefined,
  utilizationTone,
  type Translate,
} from '../format';
import type { Gpu, GpuSort, HistoryPoint } from '../types';
import { GpuCard } from './GpuCard';
import { GpuTable } from './GpuTable';
import { Stat } from './Meter';

interface SummaryProps {
  gpus: readonly Gpu[];
  t: Translate;
}

/**
 * The one line that answers "what is the whole box doing": how many cards, how loaded,
 * how much memory and power they take together and how hot the worst one runs.
 */
function Summary({ gpus, t }: SummaryProps): JSX.Element {
  const averageUtil = averageDefined(gpus.map((gpu) => gpu.utilization));
  const memUsed = sumDefined(gpus.map((gpu) => gpu.memoryUsedBytes));
  const memTotal = sumDefined(gpus.map((gpu) => gpu.memoryTotalBytes));
  const memPercent = ratio(memUsed, memTotal);
  const power = sumDefined(gpus.map((gpu) => gpu.powerW));
  const powerLimit = sumDefined(gpus.map((gpu) => gpu.powerLimitW));
  const hottest = maxDefined(gpus.map((gpu) => gpu.tempC));
  const averageFan = averageDefined(gpus.map((gpu) => gpu.fanPercent));
  const processes = gpus.reduce((total, gpu) => total + gpu.processes.length, 0);
  return (
    <div className="ns-hwmon-summary">
      <Stat icon={<GpuIcon size={12} />} label={t('gpu.count')} value={String(gpus.length)} />
      <Stat
        label={t('gpu.avgUtilization')}
        value={formatPercent(averageUtil)}
        tone={utilizationTone(averageUtil)}
      />
      <Stat
        icon={<MemoryStick size={12} />}
        label={t('gpu.totalMemory')}
        value={`${formatBytesPair(memUsed, memTotal)} · ${formatPercent(memPercent)}`}
        tone={memoryTone(memPercent)}
      />
      <Stat
        icon={<Zap size={12} />}
        label={t('gpu.totalPower')}
        value={formatWattsPair(power, powerLimit)}
      />
      <Stat
        icon={<Thermometer size={12} />}
        label={t('gpu.hottest')}
        value={formatTemp(hottest)}
        tone={gpuTemperatureTone(hottest)}
      />
      <Stat icon={<Fan size={12} />} label={t('gpu.fan')} value={formatPercent(averageFan)} />
      <Stat icon={<ListTree size={12} />} label={t('gpu.processes')} value={String(processes)} />
    </div>
  );
}

interface GpuSectionProps {
  gpus: readonly Gpu[];
  history: readonly HistoryPoint[];
  sort: GpuSort;
  /** `gpuTableFor(prefs.gpuView, gpus.length)`. */
  table: boolean;
  t: Translate;
}

export function GpuSection({ gpus, history, sort, table, t }: GpuSectionProps): JSX.Element {
  const count = gpus.length;
  const rows = useMemo(() => sortGpuRows(gpus, sort), [gpus, sort]);
  const series = useMemo(() => gpuSeriesBySlot(history, count), [history, count]);

  return (
    <section className="ns-hwmon-section">
      <header className="ns-hwmon-section-head">
        <GpuIcon size={14} className="ns-hwmon-card-icon" />
        <h3 className="ns-hwmon-card-title">{t('gpu.title')}</h3>
      </header>
      {count === 0 ? (
        <p className="ns-hwmon-empty">{t('state.noGpu')}</p>
      ) : (
        <>
          <Summary gpus={gpus} t={t} />
          {table ? (
            <GpuTable rows={rows} series={series} t={t} />
          ) : (
            <div className="ns-hwmon-gpu-grid">
              {rows.map(({ gpu, slot }) => (
                <GpuCard
                  key={gpu.uuid ?? gpu.busId ?? `slot-${slot}`}
                  gpu={gpu}
                  series={series[slot] ?? []}
                  t={t}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
