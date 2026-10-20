import type { ComponentType, JSX } from 'react';
import type { PanelProps } from '@navishell/plugin-api';

import { HwmonPanel } from './HwmonPanel';
import type { Monitor } from './monitor';

/**
 * Binds the monitor created in `activate` to the component the host instantiates (the
 * host only passes `panelId`, `ctx` and `api`).
 */
export function createPanelComponent(monitor: Monitor): ComponentType<PanelProps> {
  function HwmonPanelHost(props: PanelProps): JSX.Element {
    return <HwmonPanel {...props} monitor={monitor} />;
  }
  HwmonPanelHost.displayName = 'HwmonPanelHost';
  return HwmonPanelHost;
}
