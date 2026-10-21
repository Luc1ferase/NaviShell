import { useMemo, useState, type MouseEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import type { MenuItem, ServerRecord } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { withMenuContributions } from '@/core/menus/contributions';
import { menuPositionFor } from '@/core/menus/guard';
import { deleteServer, duplicateInput, saveServer } from '@/core/services/servers';
import { useServersStore } from '@/core/stores/servers';
import { useUiStore } from '@/core/stores/ui';
import { openTerminalForServer, revealOrOpenTerminal } from '@/core/terminal/manager';

function matches(server: ServerRecord, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [server.name, server.host, server.username, server.group ?? '', ...(server.tags ?? [])]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function ServersPanel() {
  const { t } = useI18n();
  const servers = useServersStore((state) => state.servers);
  const toast = useUiStore((state) => state.toast);
  const confirm = useUiStore((state) => state.confirm);
  const showContextMenu = useUiStore((state) => state.showContextMenu);
  const openServerForm = useUiStore((state) => state.openServerForm);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const filtered = servers.filter((server) => matches(server, query));
    const byGroup = new Map<string, ServerRecord[]>();
    for (const server of filtered) {
      const key = server.group?.trim() || '';
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(server);
      else byGroup.set(key, [server]);
    }
    return [...byGroup.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b);
    });
  }, [servers, query]);

  const report = (error: unknown) => {
    const message = errorMessage(error);
    if (message) toast(message, 'error');
  };

  /** "Connect": reveal the server's terminal, or open its first one. */
  const connect = (serverId: string) => {
    void revealOrOpenTerminal(serverId).catch(report);
  };

  /** "New terminal": always open another shell on the same connection. */
  const newTerminal = (serverId: string) => {
    void openTerminalForServer(serverId).catch(report);
  };

  const removeServer = async (server: ServerRecord) => {
    const ok = await confirm({
      title: t('servers.delete.title'),
      message: t('servers.delete.message', { name: server.name }),
      okLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteServer(server.id);
      toast(t('servers.deleted', { name: server.name }), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const duplicate = async (server: ServerRecord) => {
    try {
      const copy = await saveServer(
        duplicateInput(server, t('servers.duplicateName', { name: server.name })),
      );
      toast(t('servers.saved', { name: copy.name }), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const openMenu = (event: MouseEvent, server: ServerRecord) => {
    event.preventDefault();
    setSelected(server.id);
    const items: MenuItem[] = [
      {
        id: 'connect',
        label: t('servers.menu.connect'),
        icon: 'Cable',
        onClick: () => connect(server.id),
      },
      {
        id: 'new-terminal',
        label: t('servers.menu.newTerminal'),
        icon: 'SquareTerminal',
        onClick: () => newTerminal(server.id),
      },
      { separator: true, label: '' },
      {
        id: 'edit',
        label: t('servers.menu.edit'),
        icon: 'Pencil',
        onClick: () => openServerForm({ server }),
      },
      {
        id: 'duplicate',
        label: t('servers.menu.duplicate'),
        icon: 'Copy',
        onClick: () => void duplicate(server),
      },
    ];
    showContextMenu(
      [
        ...withMenuContributions(items, 'server', { server }),
        { separator: true, label: '' },
        {
          id: 'delete',
          label: t('servers.menu.delete'),
          icon: 'Trash2',
          danger: true,
          onClick: () => void removeServer(server),
        },
      ],
      menuPositionFor(event.nativeEvent, event.currentTarget),
    );
  };

  /** The empty part of the list: only adding makes sense there. */
  const openListMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    showContextMenu(
      [{ id: 'add', label: t('servers.add'), icon: 'Plus', onClick: () => openServerForm() }],
      menuPositionFor(event.nativeEvent, event.currentTarget),
    );
  };

  return (
    <div className="ns-panel">
      <div className="ns-panel__toolbar">
        <Search size={13} color="var(--ns-fg-subtle)" />
        <input
          className="ns-input"
          value={query}
          placeholder={t('servers.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="ns-btn ns-btn--icon"
          title={t('servers.add')}
          aria-label={t('servers.add')}
          onClick={() => openServerForm()}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="ns-panel__body" onContextMenu={openListMenu}>
        {groups.length === 0 ? (
          <div className="ns-empty">
            {servers.length === 0 ? t('servers.empty') : t('servers.noMatches')}
          </div>
        ) : (
          groups.map(([group, entries]) => (
            <div key={group || '__ungrouped__'}>
              <div className="ns-panel__section-title">{group || t('servers.ungrouped')}</div>
              {entries.map((server) => {
                const jump = server.jumpServerId
                  ? servers.find((candidate) => candidate.id === server.jumpServerId)
                  : undefined;
                return (
                  <div
                    key={server.id}
                    className="ns-server-row"
                    role="option"
                    tabIndex={0}
                    aria-selected={selected === server.id}
                    onClick={() => setSelected(server.id)}
                    onDoubleClick={() => connect(server.id)}
                    onContextMenu={(event) => openMenu(event, server)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        connect(server.id);
                      }
                    }}
                  >
                    <span
                      className="ns-server-row__dot"
                      style={{ color: server.color ?? 'var(--ns-fg-subtle)' }}
                    />
                    <span className="ns-server-row__text">
                      <span className="ns-server-row__name">
                        <span className="ns-server-row__name-text">{server.name}</span>
                        <span className="ns-badge ns-badge--xs">
                          {t(`servers.auth.${server.auth.type}`)}
                        </span>
                      </span>
                      <span className="ns-server-row__addr">
                        {server.username}@{server.host}:{server.port}
                        {jump ? ` · ${t('servers.via', { name: jump.name })}` : ''}
                      </span>
                    </span>
                    <span className="ns-server-row__actions">
                      <button
                        type="button"
                        className="ns-btn ns-btn--sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          connect(server.id);
                        }}
                      >
                        {t('servers.connect')}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
