import { Blocks, Settings as SettingsIcon, SquareTerminal } from 'lucide-react';

import { useI18n } from '@/core/i18n/useI18n';
import { openExtensionsPanel, openSettingsPanel } from '@/core/services/layout';
import { usePluginUpdates } from '@/core/services/pluginUpdates';
import { useSettingsStore } from '@/core/stores/settings';
import { MenuBar } from './MenuBar';
import { WindowControls } from './WindowControls';

/**
 * The app's own title bar, replacing the OS one. `data-tauri-drag-region` sits on the
 * header and on the two inert areas only: Tauri starts a drag when the mousedown target
 * itself carries the attribute, so the buttons in between stay clickable, and a
 * double-click on a drag region toggles maximize without any code of ours.
 *
 * Decorations are off on Windows only, so that is the only platform that draws its own
 * window controls. macOS keeps the traffic lights over an overlay title bar (hence the
 * reserved space) and Linux keeps its native decorations.
 */
export function TitleBar() {
  const { t } = useI18n();
  const platform = useSettingsStore((state) => state.appInfo?.platform);
  const pluginUpdates = usePluginUpdates().length;

  return (
    <header
      className={platform === 'macos' ? 'ns-titlebar ns-titlebar--mac' : 'ns-titlebar'}
      data-tauri-drag-region
    >
      <div className="ns-titlebar__brand" data-tauri-drag-region>
        <SquareTerminal size={16} />
      </div>

      <MenuBar />

      <div className="ns-titlebar__drag" data-tauri-drag-region>
        NaviShell
      </div>

      <div className="ns-titlebar__actions">
        <button
          type="button"
          className="ns-btn ns-btn--icon ns-titlebar__ext"
          onClick={() => openExtensionsPanel(pluginUpdates > 0 ? 'updates' : undefined)}
          title={
            pluginUpdates > 0
              ? t('topbar.extensionsUpdatesTooltip', { count: pluginUpdates })
              : t('topbar.extensionsTooltip')
          }
        >
          <Blocks size={16} />
          {pluginUpdates > 0 ? (
            <span className="ns-badge ns-badge--accent ns-badge--xs">{pluginUpdates}</span>
          ) : null}
        </button>

        <button
          type="button"
          className="ns-btn ns-btn--icon"
          onClick={openSettingsPanel}
          title={t('topbar.settings')}
        >
          <SettingsIcon size={16} />
        </button>
      </div>

      {platform === 'windows' ? <WindowControls /> : null}
    </header>
  );
}
