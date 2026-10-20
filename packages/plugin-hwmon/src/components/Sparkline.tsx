import type { JSX } from 'react';

import { toneClass, type Tone } from '../format';

interface SparklineProps {
  /** Oldest first; `undefined` points are gaps the line is drawn across. */
  values: readonly (number | undefined)[];
  /** Top of the scale. */
  max?: number;
  /** Keep at most this many of the newest points, so a narrow box stays readable. */
  maxPoints?: number;
  tone?: Tone;
  /** Extra class for the size (the SVG always fills its box). */
  className?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * A history line, drawn as a single `<polyline>` in a 0-100 box that is stretched to
 * whatever size CSS gives it (`preserveAspectRatio="none"` plus a non-scaling stroke, so
 * the line keeps its pixel width at any box ratio).
 */
export function Sparkline({
  values,
  max = 100,
  maxPoints,
  tone = 'normal',
  className,
  title,
  ariaLabel,
}: SparklineProps): JSX.Element {
  const from = maxPoints !== undefined && values.length > maxPoints ? values.length - maxPoints : 0;
  const last = values.length - 1 - from;
  const scale = max > 0 ? max : 100;
  let points = '';
  if (last > 0) {
    const parts: string[] = [];
    for (let i = 0; i <= last; i += 1) {
      const value = values[from + i];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const fraction = value <= 0 ? 0 : value >= scale ? 1 : value / scale;
      const x = ((i / last) * 100).toFixed(2);
      const y = (99 - fraction * 98).toFixed(2);
      parts.push(`${x},${y}`);
    }
    if (parts.length > 1) points = parts.join(' ');
  }
  return (
    <svg
      className={className ? `ns-hwmon-spark ${className}` : 'ns-hwmon-spark'}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel ?? title}
    >
      {title ? <title>{title}</title> : null}
      {points ? (
        <polyline
          className={`ns-hwmon-spark-line ${toneClass(tone)}`}
          points={points}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
