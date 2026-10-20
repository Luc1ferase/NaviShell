import type { JSX } from 'react';
import { Cpu, Thermometer } from 'lucide-react';

import {
  clampPercent,
  cpuTemperatureTone,
  formatPercent,
  formatTemp,
  toneClass,
  utilizationTone,
  type Translate,
} from '../format';
import type { Snapshot } from '../types';
import { Ring, Stat } from './Meter';
import { Sparkline } from './Sparkline';

interface CoreBarsProps {
  /** Per logical CPU, same order as the platform reports them. */
  perCore: readonly number[];
  t: Translate;
}

/**
 * One 28 px bar per logical CPU in an auto-filling grid, so 8 cores spread out and 128
 * stay inside the card. Each bar carries its own `cpu3 42%` tooltip.
 */
function CoreBars({ perCore, t }: CoreBarsProps): JSX.Element {
  return (
    <div className="ns-hwmon-cores" aria-label={t('cpu.perCore')}>
      {perCore.map((value, index) => (
        <span
          // The position in the list is the core's identity; there is no other id.
          key={index}
          className={`ns-hwmon-core ${toneClass(utilizationTone(value))}`}
          title={t('cpu.coreTooltip', { index, percent: formatPercent(value) })}
        >
          <span className="ns-hwmon-core-fill" style={{ height: `${clampPercent(value)}%` }} />
        </span>
      ))}
    </div>
  );
}

interface CpuCardProps {
  cpu: Snapshot['cpu'];
  /** `history.cpu`, oldest first. */
  series: readonly (number | undefined)[];
  t: Translate;
}

export function CpuCard({ cpu, series, t }: CpuCardProps): JSX.Element {
  const pending = cpu.usage === undefined;
  const perCore = cpu.perCore;
  return (
    <section className="ns-hwmon-card">
      <header className="ns-hwmon-card-head">
        <Cpu size={14} className="ns-hwmon-card-icon" />
        <h3 className="ns-hwmon-card-title">{t('cpu.title')}</h3>
        <Stat
          icon={<Thermometer size={12} />}
          label={t('cpu.temperature')}
          value={formatTemp(cpu.tempC)}
          tone={cpuTemperatureTone(cpu.tempC)}
        />
      </header>
      <div className="ns-hwmon-card-row">
        <Ring
          value={cpu.usage}
          tone={utilizationTone(cpu.usage)}
          text={pending ? t('state.pendingShort') : formatPercent(cpu.usage)}
          caption={pending ? t('state.sampling') : t('cpu.usage')}
          ariaLabel={t('cpu.usage')}
        />
        <Sparkline
          values={series}
          tone={utilizationTone(cpu.usage)}
          className="ns-hwmon-spark-grow"
          title={t('cpu.history')}
        />
      </div>
      {perCore && perCore.length > 0 ? <CoreBars perCore={perCore} t={t} /> : null}
    </section>
  );
}
