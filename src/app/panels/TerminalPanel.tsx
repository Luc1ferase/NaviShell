import { useEffect, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { useTerminalsStore } from '@/core/stores/terminals';
import { useUiStore } from '@/core/stores/ui';
import {
  openTerminalForServer,
  reconnectTerminal,
  setActiveTerminal,
} from '@/core/terminal/manager';

export interface TerminalPanelParams {
  terminalId: string;
  serverId: string;
  serverName: string;
}

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
  const { terminalId, serverId, serverName } = props.params;
  const { t } = useI18n();
  const record = useTerminalsStore((state) => state.records[terminalId]);
  const toast = useUiStore((state) => state.toast);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const session = record?.session;

  // Adopt the session DOM; the session itself outlives this component.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !session) return;
    session.mount(host);
    if (props.api.isActive) session.focus();
    return () => session.unmount();
  }, [session, props.api]);

  // Focus and resize when the tab becomes active / visible.
  useEffect(() => {
    if (!session) return;
    const active = props.api.onDidActiveChange((event) => {
      if (!event.isActive) return;
      setActiveTerminal(terminalId);
      session.refit();
      session.focus();
    });
    const visible = props.api.onDidVisibilityChange(() => session.refit());
    const dimensions = props.api.onDidDimensionsChange(() => session.refit());
    if (props.api.isActive) setActiveTerminal(terminalId);
    return () => {
      active.dispose();
      visible.dispose();
      dimensions.dispose();
    };
  }, [session, props.api, terminalId]);

  const reconnect = () => {
    void reconnectTerminal(serverId, record ? terminalId : undefined).catch((error) => {
      const message = errorMessage(error);
      if (message) toast(message, 'error');
    });
  };

  if (!record) {
    // Restored from a saved layout: the PTY from the previous run is gone.
    return (
      <div className="ns-placeholder">
        <strong>{t('terminal.sessionEnded')}</strong>
        <span>{serverName}</span>
        <div className="ns-term-exit__actions">
          <button
            type="button"
            className="ns-btn ns-btn--primary"
            onClick={() => {
              void openTerminalForServer(serverId)
                .then(() => props.api.close())
                .catch((error) => {
                  const message = errorMessage(error);
                  if (message) toast(message, 'error');
                });
            }}
          >
            {t('terminal.reconnect')}
          </button>
          <button type="button" className="ns-btn" onClick={() => props.api.close()}>
            {t('common.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ns-terminal-panel">
      <div ref={hostRef} style={{ height: '100%' }} />
      {record.exited ? (
        <div className="ns-term-exit">
          <span className="ns-term-exit__title">
            {record.exited.connectionLost
              ? t('terminal.connectionLost')
              : t('terminal.sessionEnded')}
          </span>
          <span className="ns-term-exit__detail">
            {record.exited.exitCode === null
              ? serverName
              : t('terminal.exitCode', { code: record.exited.exitCode })}
          </span>
          <div className="ns-term-exit__actions">
            <button type="button" className="ns-btn ns-btn--primary" onClick={reconnect}>
              {t('terminal.reconnect')}
            </button>
            <button type="button" className="ns-btn" onClick={() => props.api.close()}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
