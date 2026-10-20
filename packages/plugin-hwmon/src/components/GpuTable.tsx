import type { JSX } from 'react';

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
import { gpuMemoryTitle, gpuTitle, processesTitle } from './GpuProcesses';
import { Bar } from './Meter';
import { Sparkline } from './Sparkline';

interface GpuTableProps {
  rows: readonly GpuRow[];
  /** Per slot, `history.gpuUtil[slot]`; indexed by `GpuRow.slot`. */
  series: readonly (readonly (number | undefined)[])[];
  t: Translate;
}

/**
 * The dense layout for machines with many GPUs: one 28 px row per card with a sticky
 * header, so 16 GPUs are readable at once without scrolling. The least important columns
 * drop out (widest first) as the panel gets narrower, so the table never overflows.
 */
export function GpuTable({ rows, series, t }: GpuTableProps): JSX.Element {
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
              {t('gpu.processes')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ gpu, slot }) => {
            const memPercent = ratio(gpu.memoryUsedBytes, gpu.memoryTotalBytes);
            const utilTone = utilizationTone(gpu.utilization);
            return (
              <tr key={gpu.uuid ?? gpu.busId ?? `slot-${slot}`}>
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
                <td className="ns-hwmon-col-procs" title={processesTitle(gpu, t)}>
                  {gpu.processes.length}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
