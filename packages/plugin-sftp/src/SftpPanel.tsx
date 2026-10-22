import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { LoaderCircle, Plug, Server, TriangleAlert } from 'lucide-react';
import type { FileIconRequest, MenuItem, PanelProps, SftpEntry } from '@navishell/plugin-api';
import { EmptyState } from './components/EmptyState';
import { EntryList } from './components/EntryList';
import { FileEditor } from './components/FileEditor';
import { Toolbar } from './components/Toolbar';
import { TransferList } from './components/TransferList';
import { isHidden } from './format';
import type { SftpController } from './store';
import { useSftpState } from './store';

export interface SftpPanelProps extends PanelProps {
  controller: SftpController;
}

export function SftpPanel({ ctx, controller }: SftpPanelProps): JSX.Element {
  const state = useSftpState(controller);
  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => ctx.i18n.t(key, options),
    [ctx],
  );

  const entries = useMemo(
    () => (state.showHidden ? state.entries : state.entries.filter((entry) => !isHidden(entry))),
    [state.entries, state.showHidden],
  );

  // Redraw the list when the user picks another file icon theme (or its plugin comes or goes).
  const [iconTheme, setIconTheme] = useState(0);
  useEffect(() => {
    const subscription = ctx.fileIcons.onDidChangeTheme(() => setIconTheme((n) => n + 1));
    return () => subscription.dispose();
  }, [ctx]);
  const themeIcon = useCallback(
    (request: FileIconRequest) => ctx.fileIcons.resolve(request),
    // The theme is not an input of the lookup, but a new theme needs a new callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, iconTheme],
  );

  const showMenu = useCallback(
    (entry: SftpEntry, position: { x: number; y: number }) => {
      const items: MenuItem[] = [
        {
          id: 'open',
          label: t('menu.open'),
          icon: 'ExternalLink',
          onClick: () => void controller.open(entry),
        },
        {
          id: 'download',
          label: t('menu.download'),
          icon: 'Download',
          disabled: entry.kind === 'dir',
          onClick: () => void controller.download(entry),
        },
        { separator: true, label: '' },
        {
          id: 'rename',
          label: t('menu.rename'),
          icon: 'Pencil',
          onClick: () => void controller.rename(entry),
        },
        {
          id: 'delete',
          label: t('menu.delete'),
          icon: 'Trash',
          danger: true,
          onClick: () => void controller.remove(entry),
        },
        { separator: true, label: '' },
        {
          id: 'copyPath',
          label: t('menu.copyPath'),
          icon: 'Copy',
          onClick: () => void controller.copyPath(entry),
        },
        {
          id: 'refresh',
          label: t('menu.refresh'),
          icon: 'RefreshCw',
          onClick: () => void controller.refresh(),
        },
      ];
      ctx.ui.showContextMenu(items, position);
    },
    [controller, ctx, t],
  );

  const body = ((): JSX.Element => {
    if (state.connectionId === null) {
      return state.connections.length === 0 ? (
        <EmptyState
          icon={<Server size={28} />}
          title={t('state.noConnections')}
          hint={t('state.noConnectionsHint')}
        />
      ) : (
        <EmptyState icon={<Plug size={28} />} title={t('state.pickConnection')} />
      );
    }
    if (state.error !== null) {
      return (
        <EmptyState icon={<TriangleAlert size={28} />} title={state.error}>
          <button
            type="button"
            className="ns-sftp-button"
            onClick={() => void controller.refresh()}
          >
            {t('toolbar.refresh')}
          </button>
        </EmptyState>
      );
    }
    if (state.loading && state.entries.length === 0) {
      return (
        <EmptyState
          icon={<LoaderCircle size={28} className="ns-sftp-spin" />}
          title={t('state.loading')}
        />
      );
    }
    if (entries.length === 0) {
      const hiddenOnly = state.entries.length > 0;
      return (
        <EmptyState
          icon={<Server size={28} />}
          title={t(hiddenOnly ? 'state.hiddenOnly' : 'state.empty')}
        />
      );
    }
    return (
      <EntryList
        entries={entries}
        selected={state.selected}
        locale={ctx.i18n.locale}
        t={t}
        themeIcon={themeIcon}
        onSelect={(entry) => controller.select(entry.path)}
        onOpen={(entry) => void controller.open(entry)}
        onContextMenu={showMenu}
        onUp={() => void controller.goUp()}
        onRename={(entry) => void controller.rename(entry)}
        onDelete={(entry) => void controller.remove(entry)}
      />
    );
  })();

  return (
    <div className="ns-sftp-panel">
      <Toolbar state={state} controller={controller} t={t} />
      <div className="ns-sftp-body">
        {body}
        {state.viewer ? <FileEditor viewer={state.viewer} controller={controller} t={t} /> : null}
      </div>
      <TransferList transfers={state.transfers} controller={controller} t={t} />
    </div>
  );
}
