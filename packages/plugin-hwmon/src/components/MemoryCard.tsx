import type { JSX } from 'react';
import { MemoryStick } from 'lucide-react';

import {
  DASH,
  formatBytes,
  formatBytesPair,
  formatPercent,
  memoryTone,
  ratio,
  type Translate,
} from '../format';
import type { Snapshot } from '../types';
import { Bar, Stat } from './Meter';
import { Sparkline } from './Sparkline';

interface MemoryCardProps {
  memory: Snapshot['memory'];
  /** `history` mapped to used/total percentages, oldest first. */
  series: readonly (number | undefined)[];
  t: Translate;
}

export function MemoryCard({ memory, series, t }: MemoryCardProps): JSX.Element {
  const usedPercent = ratio(memory.usedBytes, memory.totalBytes);
  const swapPercent = ratio(memory.swapUsedBytes, memory.swapTotalBytes);
  const hasSwap = (memory.swapTotalBytes ?? 0) > 0;
  const tone = memoryTone(usedPercent);
  return (
    <section className="ns-hwmon-card">
      <header className="ns-hwmon-card-head">
        <MemoryStick size={14} className="ns-hwmon-card-icon" />
        <h3 className="ns-hwmon-card-title">{t('memory.title')}</h3>
        <Stat
          label={t('memory.available')}
          value={formatBytes(memory.availableBytes)}
          title={`${t('memory.available')} ${formatBytes(memory.availableBytes)}`}
        />
      </header>

      <div className="ns-hwmon-gauge">
        <div className="ns-hwmon-gauge-head">
          <span className="ns-hwmon-gauge-label">{t('memory.used')}</span>
          <span className="ns-hwmon-gauge-value">
            {formatBytesPair(memory.usedBytes, memory.totalBytes)}
          </span>
          <span className="ns-hwmon-gauge-percent">{formatPercent(usedPercent)}</span>
        </div>
        <Bar value={usedPercent} tone={tone} size="thick" ariaLabel={t('memory.used')} />
      </div>

      <Sparkline
        values={series}
        tone={tone}
        className="ns-hwmon-spark-wide"
        title={t('memory.history')}
      />

      <div className="ns-hwmon-gauge">
        <div className="ns-hwmon-gauge-head">
          <span className="ns-hwmon-gauge-label">{t('memory.swap')}</span>
          <span className="ns-hwmon-gauge-value">
            {hasSwap ? formatBytesPair(memory.swapUsedBytes, memory.swapTotalBytes) : DASH}
          </span>
          <span className="ns-hwmon-gauge-percent">
            {hasSwap ? formatPercent(swapPercent) : t('memory.noSwap')}
          </span>
        </div>
        <Bar
          value={hasSwap ? swapPercent : undefined}
          tone={memoryTone(swapPercent)}
          ariaLabel={t('memory.swap')}
        />
      </div>
    </section>
  );
}
