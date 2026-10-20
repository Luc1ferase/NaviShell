import type { JSX, ReactNode } from 'react';

import { clampPercent, toneClass, type Tone } from '../format';

interface BarProps {
  /** 0-100; `undefined` leaves the track empty instead of drawing a zero. */
  value: number | undefined;
  tone?: Tone;
  title?: string;
  ariaLabel?: string;
  /** `thin` for table rows, `thick` for the memory bar. */
  size?: 'thin' | 'normal' | 'thick';
  className?: string;
}

/** A horizontal fill bar; the fill takes its colour from the tone class. */
export function Bar({
  value,
  tone = 'normal',
  title,
  ariaLabel,
  size = 'normal',
  className,
}: BarProps): JSX.Element {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? clampPercent(value) : 0;
  const classes = ['ns-hwmon-bar', `ns-hwmon-bar-${size}`, toneClass(tone)];
  if (className) classes.push(className);
  return (
    <div
      className={classes.join(' ')}
      title={title}
      role="progressbar"
      aria-label={ariaLabel ?? title}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(percent) : undefined}
    >
      <div className="ns-hwmon-bar-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

interface RingProps {
  /** 0-100; `undefined` draws the track only. */
  value: number | undefined;
  /** Outer diameter in pixels. */
  size?: number;
  thickness?: number;
  tone?: Tone;
  /** Centre text; pass the pending marker while the first sample is still running. */
  text: string;
  /** Small line under the centre text. */
  caption?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * A ring gauge: a track circle plus an arc drawn with `stroke-dasharray`, with the value
 * as HTML in the middle so it uses the host's UI font.
 */
export function Ring({
  value,
  size = 72,
  thickness = 7,
  tone = 'normal',
  text,
  caption,
  title,
  ariaLabel,
}: RingProps): JSX.Element {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? clampPercent(value) : 0;
  const offset = circumference * (1 - percent / 100);
  return (
    <div
      className={`ns-hwmon-ring ${toneClass(tone)}`}
      style={{ width: size, height: size }}
      title={title}
      role="progressbar"
      aria-label={ariaLabel ?? title}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(percent) : undefined}
    >
      <svg className="ns-hwmon-ring-svg" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="ns-hwmon-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
        />
        <circle
          className="ns-hwmon-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="ns-hwmon-ring-text">
        <span className="ns-hwmon-ring-value-text">{text}</span>
        {caption ? <span className="ns-hwmon-ring-caption">{caption}</span> : null}
      </span>
    </div>
  );
}

interface StatProps {
  icon?: ReactNode;
  label: string;
  value: string;
  tone?: Tone;
  title?: string;
  /** Drop the written label and let the icon carry it; the label stays in the tooltip. */
  compact?: boolean;
}

/** One small `icon label value` cell, used in the GPU cards and the summary strip. */
export function Stat({ icon, label, value, tone, title, compact }: StatProps): JSX.Element {
  return (
    <span className="ns-hwmon-stat" title={title ?? `${label} ${value}`}>
      {icon ? <span className="ns-hwmon-stat-icon">{icon}</span> : null}
      {compact ? null : <span className="ns-hwmon-stat-label">{label}</span>}
      <span
        className={
          tone ? `ns-hwmon-stat-value ns-hwmon-text ${toneClass(tone)}` : 'ns-hwmon-stat-value'
        }
      >
        {value}
      </span>
    </span>
  );
}
