import { Plus, Server, Settings as SettingsIcon } from 'lucide-react';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { openSettingsPanel } from '@/core/services/layout';
import { useServersStore } from '@/core/stores/servers';
import { useSettingsStore } from '@/core/stores/settings';
import { useUiStore } from '@/core/stores/ui';
import { revealOrOpenTerminal } from '@/core/terminal/manager';

export function HomePanel() {
  const { t } = useI18n();
  const servers = useServersStore((state) => state.servers);
  const appInfo = useSettingsStore((state) => state.appInfo);
  const openServerForm = useUiStore((state) => state.openServerForm);
  const toast = useUiStore((state) => state.toast);

  const connect = (serverId: string) => {
    void revealOrOpenTerminal(serverId).catch((error) => {
      const message = errorMessage(error);
      if (message) toast(message, 'error');
    });
  };

  return (
    <div className="ns-home">
      <div>
        <h1 className="ns-home__title">{t('home.title')}</h1>
        <p className="ns-home__subtitle">
          {t('home.subtitle')}
          {appInfo ? ` · v${appInfo.version}` : ''}
        </p>
      </div>

      <div>
        <div className="ns-panel__section-title">{t('home.quickConnect')}</div>
        {servers.length === 0 ? (
          <div className="ns-home__grid">
            <button type="button" className="ns-home__card" onClick={() => openServerForm()}>
              <span className="ns-home__card-name">
                <Plus size={14} />
                {t('home.addFirstServer')}
              </span>
              <span className="ns-home__card-addr">{t('home.addFirstServerHint')}</span>
            </button>
          </div>
        ) : (
          <div className="ns-home__grid">
            {servers.slice(0, 12).map((server) => (
              <button
                key={server.id}
                type="button"
                className="ns-home__card"
                onClick={() => connect(server.id)}
              >
                <span className="ns-home__card-name">
                  <Server size={14} color={server.color ?? 'var(--ns-accent)'} />
                  {server.name}
                </span>
                <span className="ns-home__card-addr">
                  {server.username}@{server.host}:{server.port}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="ns-panel__section-title">{t('home.hints')}</div>
        <ul className="ns-home__hints">
          <li>{t('home.hint.doubleClick')}</li>
          <li>
            {t('home.hint.copyPaste')} <span className="ns-kbd">Ctrl+Shift+C</span> /{' '}
            <span className="ns-kbd">Ctrl+Shift+V</span>
          </li>
          <li>{t('home.hint.rightClick')}</li>
          <li>{t('home.hint.dock')}</li>
          <li>{t('home.hint.plugins')}</li>
        </ul>
        <p>
          <button type="button" className="ns-btn" onClick={openSettingsPanel}>
            <SettingsIcon size={14} />
            {t('home.openSettings')}
          </button>
        </p>
      </div>
    </div>
  );
}
