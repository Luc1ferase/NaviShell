import type { JSX } from 'react';
import { Clock, Cpu, Gauge, Monitor, Server, Terminal } from 'lucide-react';

import { DASH, formatLoadAvg, formatMHz, formatUptime, type Translate } from '../format';
import type { Snapshot } from '../types';

interface MetaProps {
  icon: JSX.Element;
  label: string;
  value: string;
  /** Full text for values that may be ellipsised. */
  title?: string;
}

function Meta({ icon, label, value, title }: MetaProps): JSX.Element {
  return (
    <span className="ns-hwmon-meta" title={title ?? `${label}: ${value}`}>
      <span className="ns-hwmon-meta-icon">{icon}</span>
      <span className="ns-hwmon-meta-label">{label}</span>
      <span className="ns-hwmon-meta-value">{value}</span>
    </span>
  );
}

/** `8 cores / 16 threads`, or whichever half the platform reported. */
function coreText(cores: number | undefined, threads: number | undefined, t: Translate): string {
  if (cores !== undefined && threads !== undefined)
    return t('cpu.coresThreads', { cores, threads });
  if (cores !== undefined) return t('cpu.coresOnly', { cores });
  if (threads !== undefined) return t('cpu.threadsOnly', { threads });
  return DASH;
}

interface OverviewProps {
  snapshot: Snapshot;
  t: Translate;
}

/** The identity strip above the cards: who this machine is and how long it has been up. */
export function Overview({ snapshot, t }: OverviewProps): JSX.Element {
  const { host, cpu } = snapshot;
  const model = cpu.model ?? DASH;
  return (
    <div className="ns-hwmon-overview" aria-label={t('panel.overview')}>
      <Meta icon={<Server size={13} />} label={t('panel.hostname')} value={host.hostname ?? DASH} />
      <Meta icon={<Monitor size={13} />} label={t('panel.os')} value={host.os ?? DASH} />
      <Meta icon={<Terminal size={13} />} label={t('panel.kernel')} value={host.kernel ?? DASH} />
      <Meta
        icon={<Clock size={13} />}
        label={t('panel.uptime')}
        value={formatUptime(host.uptimeSec)}
      />
      <Meta
        icon={<Gauge size={13} />}
        label={t('cpu.loadAvg')}
        value={formatLoadAvg(host.loadAvg)}
      />
      <Meta
        icon={<Cpu size={13} />}
        label={t('cpu.model')}
        value={`${model} · ${coreText(cpu.cores, cpu.threads, t)} · ${formatMHz(cpu.freqMHz)}`}
        title={model}
      />
    </div>
  );
}
