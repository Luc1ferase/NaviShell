import { Fragment, useState, type JSX, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

import {
  formatBytesPair,
  formatMHz,
  formatPercent,
  formatTemp,
  formatWattsPair,
  gpuTemperatureTone,
  memoryTone,
  ratio,
  toneClass,
  utilizationTone,
  type GpuRow,
  type Translate,
} from '../format';
import { ProcessList, gpuMemoryTitle, gpuTitle, processesTitle } from './GpuProcesses';
import { Bar } from './Meter';
import { Sparkline } from './Sparkline';

/** Columns of the table; the detail row spans them all. */
const COLUMN_COUNT = 10;

interface GpuTableProps {
  rows: readonly GpuRow[];
  /** Per slot, `history.gpuUtil[slot]`; indexed by `GpuRow.slot`. */
  series: readonly (readonly (number | undefined)[])[];
  t: Translate;
}

function rowKey(row: GpuRow): string {
  return row.gpu.uuid ?? row.gpu.busId ?? `slot-${row.slot}`;
}

/**
 * The dense layout for machines with many GPUs: one 28 px row per card with a sticky
 * header, so 16 GPUs are readable at once without scrolling. The least important columns
 * drop out (widest first) as the panel gets narrower, so the table never overflows.
 *
 * Clicking a row (or its process count) unfolds the GPU's compute processes underneath
 * it, the same `pid name memory` list the cards show; the header's process column
 * expands or collapses every GPU at once.
 */
export function GpuTable({ rows, series, t }: GpuTableProps): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const expandable = rows.filter((row) => row.gpu.processes.length > 0).map(rowKey);
  const allOpen = expandable.length > 0 && expandable.every((key) => open.has(key));

  const toggle = (key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAll = () => {
    setOpen(allOpen ? new Set() : new Set(expandable));
  };

  return (
    <div className="ns-hwmon-table-wrap">
      <table className="ns-hwmon-table">
        <thead>
          <tr>
            <th className="ns-hwmon-col-slot" scope="col">
              {t('gpu.index')}
            </th>
            <th className="ns-hwmon-col-name" scope="col">
              {t('gpu.name')}
            </th>
            <th className="ns-hwmon-col-util" scope="col">
              {t('gpu.utilization')}
            </th>
            <th className="ns-hwmon-col-spark" scope="col">
              <span className="ns-hwmon-sr">{t('gpu.historyColumn')}</span>
            </th>
            <th className="ns-hwmon-col-mem" scope="col">
              {t('gpu.memory')}
            </th>
            <th className="ns-hwmon-col-temp" scope="col">
              {t('gpu.temperature')}
            </th>
            <th className="ns-hwmon-col-power" scope="col">
              {t('gpu.power')}
            </th>
            <th className="ns-hwmon-col-fan" scope="col">
              {t('gpu.fan')}
            </th>
            <th className="ns-hwmon-col-clock" scope="col">
              {t('gpu.clock')}
            </th>
            <th className="ns-hwmon-col-procs" scope="col">
              <button
                type="button"
                className="ns-hwmon-procs-all"
                title={t(allOpen ? 'gpu.collapseAll' : 'gpu.expandAll')}
                aria-label={t(allOpen ? 'gpu.collapseAll' : 'gpu.expandAll')}
                disabled={expandable.length === 0}
                onClick={toggleAll}
              >
                {t('gpu.processes')}
                {allOpen ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { gpu, slot } = row;
            const key = rowKey(row);
            const count = gpu.processes.length;
            const isOpen = count > 0 && open.has(key);
            const memPercent = ratio(gpu.memoryUsedBytes, gpu.memoryTotalBytes);
            const utilTone = utilizationTone(gpu.utilization);
            const onToggle = (event: MouseEvent) => {
              event.stopPropagation();
              if (count > 0) toggle(key);
            };
            return (
              <Fragment key={key}>
                <tr
                  className={`${count > 0 ? 'ns-hwmon-row-expandable' : ''}${isOpen ? ' ns-hwmon-row-open' : ''}`}
                  onClick={onToggle}
                >
                  <td className="ns-hwmon-col-slot">
                    <span className="ns-hwmon-gpu-slot">#{gpu.index}</span>
                  </td>
                  <td className="ns-hwmon-col-name">
                    <span className="ns-hwmon-cell-name" title={gpuTitle(gpu, t)}>
                      {gpu.name}
                    </span>
                  </td>
                  <td className="ns-hwmon-col-util">
                    <span className="ns-hwmon-cell-meter">
                      <Bar
                        value={gpu.utilization}
                        tone={utilTone}
                        size="thin"
                        ariaLabel={t('gpu.utilization')}
                      />
                      <span className={`ns-hwmon-cell-num ns-hwmon-text ${toneClass(utilTone)}`}>
                        {formatPercent(gpu.utilization)}
                      </span>
                    </span>
                  </td>
                  <td className="ns-hwmon-col-spark">
                    <Sparkline
                      values={series[slot] ?? []}
                      maxPoints={60}
                      tone={utilTone}
                      className="ns-hwmon-spark-cell"
                      title={t('gpu.history', { index: gpu.index })}
                    />
                  </td>
                  <td className="ns-hwmon-col-mem">
                    <span className="ns-hwmon-cell-meter">
                      <Bar
                        value={memPercent}
                        tone={memoryTone(memPercent)}
                        size="thin"
                        title={gpuMemoryTitle(gpu, t)}
                        ariaLabel={t('gpu.memory')}
                      />
                      <span className="ns-hwmon-cell-bytes">
                        {formatBytesPair(gpu.memoryUsedBytes, gpu.memoryTotalBytes)}
                      </span>
                    </span>
                  </td>
                  <td
                    className={`ns-hwmon-col-temp ns-hwmon-text ${toneClass(gpuTemperatureTone(gpu.tempC))}`}
                  >
                    {formatTemp(gpu.tempC)}
                  </td>
                  <td className="ns-hwmon-col-power">
                    {formatWattsPair(gpu.powerW, gpu.powerLimitW)}
                  </td>
                  <td className="ns-hwmon-col-fan">{formatPercent(gpu.fanPercent)}</td>
                  <td className="ns-hwmon-col-clock">{formatMHz(gpu.clockMHz)}</td>
                  <td className="ns-hwmon-col-procs">
                    <button
                      type="button"
                      className="ns-hwmon-procs-toggle ns-hwmon-procs-toggle-cell"
                      title={processesTitle(gpu, t)}
                      aria-label={t('gpu.toggleProcesses', { index: gpu.index })}
                      aria-expanded={isOpen}
                      disabled={count === 0}
                      onClick={onToggle}
                    >
                      {count}
                      {count > 0 ? (
                        isOpen ? (
                          <ChevronDown size={11} />
                        ) : (
                          <ChevronRight size={11} />
                        )
                      ) : null}
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="ns-hwmon-table-detail">
                    <td colSpan={COLUMN_COUNT}>
                      <ProcessList processes={gpu.processes} t={t} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
