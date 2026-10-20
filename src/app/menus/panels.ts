/**
 * The "Panels" menu: every registered panel, core ones first and then the plugins', each
 * with a check mark while it is open. Picking an entry opens the panel at its default
 * position or reveals it when it is already open, so a closed plugin panel always has a
 * way back.
 */

import type { MenuItem } from '@navishell/plugin-api';

import { t } from '@/core/i18n';
import { listPanelEntries, type PanelEntry } from '@/core/plugins/registry';
import {
  CORE_SETTINGS_PANEL,
  isPanelOpen,
  openPanel,
  openSettingsPanel,
  panelTitle,
} from '@/core/services/layout';

function itemFor(entry: PanelEntry): MenuItem {
  return {
    id: entry.fullId,
    label: panelTitle(entry),
    icon: entry.def.icon ?? (entry.kind === 'plugin' ? 'Puzzle' : 'PanelsTopLeft'),
    checked: isPanelOpen(entry.fullId),
    onClick: () => {
      if (entry.fullId === CORE_SETTINGS_PANEL) openSettingsPanel();
      else openPanel(entry.fullId);
    },
  };
}

export function panelMenuItems(): MenuItem[] {
  const entries = listPanelEntries();
  const core = entries.filter((entry) => entry.kind === 'core').map(itemFor);
  const plugins = entries.filter((entry) => entry.kind === 'plugin').map(itemFor);
  const items = [...core];
  if (plugins.length > 0) {
    if (items.length > 0) items.push({ label: '', separator: true });
    items.push(...plugins);
  }
  if (items.length === 0) items.push({ label: t('topbar.noPanels'), disabled: true });
  return items;
}
