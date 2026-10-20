import { useRegistryStore, type CorePanelDefinition } from '@/core/plugins/registry';
import {
  CORE_EXTENSIONS_PANEL,
  CORE_SERVERS_PANEL,
  CORE_SETTINGS_PANEL,
} from '@/core/services/layout';
import { ExtensionsPanel } from './extensions/ExtensionsPanel';
import { ServersPanel } from './ServersPanel';
import { SettingsPanel } from './SettingsPanel';

const CORE_PANELS: CorePanelDefinition[] = [
  {
    id: CORE_SERVERS_PANEL,
    titleKey: 'panel.servers.title',
    icon: 'Server',
    component: ServersPanel,
  },
  {
    id: CORE_EXTENSIONS_PANEL,
    titleKey: 'panel.extensions.title',
    icon: 'Blocks',
    component: ExtensionsPanel,
    defaultPosition: 'center',
  },
  {
    id: CORE_SETTINGS_PANEL,
    titleKey: 'panel.settings.title',
    icon: 'Settings',
    component: SettingsPanel,
    defaultPosition: 'center',
  },
];

/** Must run before the layout is restored so the panels resolve. */
export function registerCorePanels(): void {
  const registry = useRegistryStore.getState();
  for (const def of CORE_PANELS) registry.registerCorePanel(def);
}
