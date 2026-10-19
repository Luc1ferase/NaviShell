/**
 * Renders every registered terminal overlay into every live terminal's overlay layer.
 *
 * The overlay layer is a detached-but-owned DOM node of the session, so portals keep
 * working while a terminal tab is hidden or being moved between groups.
 */

import { createPortal } from 'react-dom';

import { useRegistryStore } from '@/core/plugins/registry';
import { useTerminalsStore } from '@/core/stores/terminals';
import { PluginErrorBoundary } from './ErrorBoundary';

export function TerminalOverlayHost() {
  const records = useTerminalsStore((state) => state.records);
  const order = useTerminalsStore((state) => state.order);
  const overlays = useRegistryStore((state) => state.overlays);

  if (overlays.length === 0) return null;

  return (
    <>
      {order.map((terminalId) => {
        const record = records[terminalId];
        if (!record || record.session.isDisposed) return null;
        return createPortal(
          <>
            {overlays.map((overlay) => {
              const Component = overlay.component;
              return (
                <PluginErrorBoundary key={overlay.key} label={overlay.pluginId}>
                  <Component terminal={record.session} ctx={overlay.ctx} />
                </PluginErrorBoundary>
              );
            })}
          </>,
          record.session.overlayElement,
          terminalId,
        );
      })}
    </>
  );
}
