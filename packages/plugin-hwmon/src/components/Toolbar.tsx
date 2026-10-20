import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { HardDrive, LayoutGrid, Pause, Play, RefreshCw, Rows3, Sparkles } from 'lucide-react';

import { formatAgo, type Translate } from '../format';
import type { Monitor } from '../monitor';
import { INTERVAL_OPTIONS, type GpuSort, type GpuView, type MonitorView } from '../types';

interface UpdatedAgoProps {
  /** `Snapshot.at` of the newest sample, or `undefined` before the first one. */
  at: number | undefined;
  t: Translate;
}

/**
 * The "updated 3s ago" label. It owns the only clock in the panel: a one second timer
 * that re-renders this span and nothing else.
 */
function UpdatedAgo({ at, t }: UpdatedAgoProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const text =
    at === undefined ? t('toolbar.never') : t('toolbar.updatedAgo', { ago: formatAgo(now - at) });
  return <span className="ns-hwmon-ago">{text}</span>;
}

const GPU_VIEWS: readonly { value: GpuView; labelKey: string }[] = [
  { value: 'auto', labelKey: 'toolbar.gpuViewAuto' },
  { value: 'cards', labelKey: 'toolbar.gpuViewCards' },
  { value: 'table', labelKey: 'toolbar.gpuViewTable' },
];

const GPU_SORTS: readonly { value: GpuSort; labelKey: string }[] = [
  { value: 'index', labelKey: 'toolbar.gpuSortIndex' },
  { value: 'utilization', labelKey: 'toolbar.gpuSortUtilization' },
  { value: 'memory', labelKey: 'toolbar.gpuSortMemory' },
  { value: 'temperature', labelKey: 'toolbar.gpuSortTemperature' },
];

function gpuViewIcon(view: GpuView): JSX.Element {
  if (view === 'cards') return <LayoutGrid size={14} />;
  if (view === 'table') return <Rows3 size={14} />;
  return <Sparkles size={14} />;
}

interface ToolbarProps {
  view: MonitorView;
  monitor: Monitor;
  /** Number of GPUs in the newest snapshot; the GPU controls hide when there are none. */
  gpuCount: number;
  t: Translate;
}

export function Toolbar({ view, monitor, gpuCount, t }: ToolbarProps): JSX.Element {
  const selected = view.selected;
  const status = selected?.status ?? 'idle';
  const statusKey = view.paused ? 'paused' : status;
  const statusText = t(`state.${statusKey}`);

  return (
    <div className="ns-hwmon-toolbar">
      <select
        className="ns-hwmon-select ns-hwmon-target"
        aria-label={t('toolbar.target')}
        title={selected?.target.detail ?? selected?.target.label ?? t('toolbar.target')}
        value={view.selectedId}
        onChange={(event) => monitor.select(event.target.value as MonitorView['selectedId'])}
      >
        {view.targets.map((entry) => (
          <option key={entry.target.id} value={entry.target.id} title={entry.target.detail}>
            {entry.target.label}
          </option>
        ))}
      </select>

      <span
        className={`ns-hwmon-dot ns-hwmon-dot-${statusKey}`}
        title={statusText}
        aria-label={statusText}
        role="img"
      />
      <UpdatedAgo at={selected?.latest?.at} t={t} />

      <span className="ns-hwmon-toolbar-gap" />

      <select
        className="ns-hwmon-select ns-hwmon-select-narrow"
        aria-label={t('toolbar.interval')}
        title={t('toolbar.interval')}
        value={view.prefs.intervalMs}
        onChange={(event) => monitor.setPrefs({ intervalMs: Number(event.target.value) })}
      >
        {INTERVAL_OPTIONS.map((ms) => (
          <option key={ms} value={ms}>
            {t('toolbar.intervalSeconds', { seconds: ms / 1000 })}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="ns-hwmon-icon-button"
        title={t(view.paused ? 'toolbar.resume' : 'toolbar.pause')}
        aria-label={t(view.paused ? 'toolbar.resume' : 'toolbar.pause')}
        aria-pressed={view.paused}
        onClick={() => monitor.setPaused(!view.paused)}
      >
        {view.paused ? <Play size={14} /> : <Pause size={14} />}
      </button>

      <button
        type="button"
        className="ns-hwmon-icon-button"
        title={t('toolbar.refresh')}
        aria-label={t('toolbar.refresh')}
        onClick={() => monitor.refresh()}
      >
        <RefreshCw size={14} className={status === 'sampling' ? 'ns-hwmon-spin' : undefined} />
      </button>

      <button
        type="button"
        className={`ns-hwmon-icon-button${view.prefs.showDisks ? ' ns-hwmon-icon-button-on' : ''}`}
        title={t(view.prefs.showDisks ? 'toolbar.hideDisks' : 'toolbar.showDisks')}
        aria-label={t(view.prefs.showDisks ? 'toolbar.hideDisks' : 'toolbar.showDisks')}
        aria-pressed={view.prefs.showDisks}
        onClick={() => monitor.setPrefs({ showDisks: !view.prefs.showDisks })}
      >
        <HardDrive size={14} />
      </button>

      {gpuCount > 0 ? (
        <>
          <span className="ns-hwmon-segmented" role="group" aria-label={t('toolbar.gpuView')}>
            {GPU_VIEWS.map((option) => {
              const active = view.prefs.gpuView === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`ns-hwmon-icon-button${active ? ' ns-hwmon-icon-button-on' : ''}`}
                  title={t(option.labelKey)}
                  aria-label={t(option.labelKey)}
                  aria-pressed={active}
                  onClick={() => monitor.setPrefs({ gpuView: option.value })}
                >
                  {gpuViewIcon(option.value)}
                </button>
              );
            })}
          </span>
          <select
            className="ns-hwmon-select ns-hwmon-select-narrow"
            aria-label={t('toolbar.gpuSort')}
            title={t('toolbar.gpuSort')}
            value={view.prefs.gpuSort}
            onChange={(event) => monitor.setPrefs({ gpuSort: event.target.value as GpuSort })}
          >
            {GPU_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
