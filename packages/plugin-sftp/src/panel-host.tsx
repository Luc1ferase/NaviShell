import type { ComponentType, JSX } from 'react';
import type { PanelProps } from '@navishell/plugin-api';
import { SftpPanel } from './SftpPanel';
import type { SftpController } from './store';

/**
 * Binds the single panel controller created in `activate` to the component the host
 * instantiates (the host only passes `panelId`, `ctx` and `api`).
 */
export function createPanelComponent(controller: SftpController): ComponentType<PanelProps> {
  function SftpPanelHost(props: PanelProps): JSX.Element {
    return <SftpPanel {...props} controller={controller} />;
  }
  SftpPanelHost.displayName = 'SftpPanelHost';
  return SftpPanelHost;
}
