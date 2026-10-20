import { useCallback, useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { PanelProps } from '@navishell/plugin-api';

import { CpuCard } from './components/CpuCard';
import { DiskList } from './components/DiskList';
import { GpuSection } from './components/GpuSection';
import { MemoryCard } from './components/MemoryCard';
import { Overview } from './components/Overview';
import { Toolbar } from './components/Toolbar';
import { cpuSeries, memorySeries } from './format';
import { gpuTableFor, useMonitor, type Monitor } from './monitor';

export interface HwmonPanelProps extends PanelProps {
  monitor: Monitor;
}

/**
 * The hardware dashboard: a toolbar, the host's identity, CPU and memory side by side,
 * then the GPU section (cards or a dense table, depending on how many there are) and the
 * disks.
 *
 * The panel owns no data of its own; it renders the monitor's view and tells the monitor
 * when it is on screen, which is what gates the polling loop.
 */
export function HwmonPanel({ ctx, api, monitor }: HwmonPanelProps): JSX.Element {
  const view = useMonitor(monitor);
  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => ctx.i18n.t(key, options),
    [ctx],
  );

  // Nothing is sampled unless a panel says it is visible, so this is the on/off switch of
  // the whole plugin: hidden tab, closed panel or unmounted panel all stop the polling.
  useEffect(() => {
    monitor.setVisible(api.isVisible);
    const subscription = api.onDidVisibilityChange((visible) => monitor.setVisible(visible));
    return () => {
      subscription.dispose();
      monitor.setVisible(false);
    };
  }, [api, monitor]);

  const selected = view.selected;
  const snapshot = selected?.latest;
  const history = selected?.history;
  const cpuHistory = useMemo(() => cpuSeries(history ?? []), [history]);
  const memoryHistory = useMemo(() => memorySeries(history ?? []), [history]);
  const gpus = snapshot?.gpus ?? [];
  const notes = snapshot?.notes ?? [];
  const showDisks = view.prefs.showDisks && (snapshot?.disks.length ?? 0) > 0;

  return (
    <div className="ns-hwmon-panel">
      <Toolbar view={view} monitor={monitor} gpuCount={gpus.length} t={t} />
      <div className="ns-hwmon-body">
        {selected?.status === 'error' ? (
          <div className="ns-hwmon-banner" role="alert">
            <TriangleAlert size={14} className="ns-hwmon-banner-icon" />
            <span className="ns-hwmon-banner-text">{selected.error ?? t('error.title')}</span>
            <button
              type="button"
              className="ns-hwmon-button"
              onClick={() => monitor.reset(selected.target.id)}
            >
              {t('toolbar.retry')}
            </button>
          </div>
        ) : null}

        {notes.length > 0 ? (
          <p className="ns-hwmon-notes" aria-label={t('panel.notes')}>
            {notes.map((note) => t(note)).join(' · ')}
          </p>
        ) : null}

        {snapshot ? (
          <>
            <Overview snapshot={snapshot} t={t} />
            <div className="ns-hwmon-cards">
              <CpuCard cpu={snapshot.cpu} series={cpuHistory} t={t} />
              <MemoryCard memory={snapshot.memory} series={memoryHistory} t={t} />
            </div>
            <GpuSection
              gpus={gpus}
              history={history ?? []}
              sort={view.prefs.gpuSort}
              table={gpuTableFor(view.prefs.gpuView, gpus.length)}
              t={t}
            />
            {showDisks ? <DiskList disks={snapshot.disks} t={t} /> : null}
          </>
        ) : selected?.status === 'error' ? null : (
          <p className="ns-hwmon-empty">{t('state.waitingFirstSample')}</p>
        )}
      </div>
    </div>
  );
}
