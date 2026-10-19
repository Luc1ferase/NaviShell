import type { BootstrapStep } from '@/core/bootstrap';

const LABELS: Record<BootstrapStep, string> = {
  settings: 'Loading settings…',
  i18n: 'Preparing translations…',
  appInfo: 'Reading app info…',
  servers: 'Loading servers…',
  plugins: 'Activating plugins…',
  layout: 'Restoring layout…',
  done: 'Ready',
};

/** Shown while {@link bootstrap} runs; i18n is not available yet, so labels are plain English. */
export function Splash({ step }: { step: BootstrapStep }) {
  return (
    <div className="ns-splash">
      <div className="ns-splash__mark">NaviShell</div>
      <div className="ns-splash__bar" />
      <div className="ns-splash__step">{LABELS[step]}</div>
    </div>
  );
}
