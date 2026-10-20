import type { JSX } from 'react';
import { HardDrive } from 'lucide-react';

import { formatBytesPair, formatPercent, memoryTone, ratio, type Translate } from '../format';
import type { Disk } from '../types';
import { Bar } from './Meter';

interface DiskListProps {
  disks: readonly Disk[];
  t: Translate;
}

/** Mount points as one compact row each; the filesystem goes in the row's tooltip. */
export function DiskList({ disks, t }: DiskListProps): JSX.Element {
  return (
    <section className="ns-hwmon-section">
      <header className="ns-hwmon-section-head">
        <HardDrive size={14} className="ns-hwmon-card-icon" />
        <h3 className="ns-hwmon-card-title">{t('disk.title')}</h3>
      </header>
      {disks.length === 0 ? (
        <p className="ns-hwmon-empty">{t('state.noDisks')}</p>
      ) : (
        <ul className="ns-hwmon-disks">
          {disks.map((disk) => {
            const percent = ratio(disk.usedBytes, disk.totalBytes);
            const detail = disk.filesystem
              ? `${disk.mount} · ${t('disk.filesystem')} ${disk.filesystem}`
              : disk.mount;
            return (
              <li key={disk.mount} className="ns-hwmon-disk">
                <span className="ns-hwmon-disk-mount" title={detail}>
                  {disk.mount}
                </span>
                <Bar
                  value={percent}
                  tone={memoryTone(percent)}
                  size="thin"
                  ariaLabel={disk.mount}
                />
                <span className="ns-hwmon-disk-bytes">
                  {formatBytesPair(disk.usedBytes, disk.totalBytes)}
                </span>
                <span className="ns-hwmon-disk-percent">{formatPercent(percent)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
