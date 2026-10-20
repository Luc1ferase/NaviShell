/**
 * luciferase.hwmon - hardware monitor panel.
 *
 * Not bundled with NaviShell: it is installed from the plugin marketplace. It samples the
 * machine NaviShell runs on through `ctx.local.exec` and any open SSH connection through
 * `ctx.connections.exec`, and shows CPU, memory and GPUs with a layout that stays
 * readable on machines with many GPUs.
 */

import { definePlugin } from '@navishell/plugin-api';
import type { PluginContext } from '@navishell/plugin-api';

import { locales } from './locales';
import { Monitor } from './monitor';
import { createPanelComponent } from './panel-host';
import './styles.css';

const PANEL_ID = 'monitor';

let monitor: Monitor | null = null;

export default definePlugin({
  activate(ctx: PluginContext): void {
    for (const [locale, strings] of Object.entries(locales)) {
      ctx.i18n.addResources(locale, strings);
    }

    const instance = new Monitor(ctx);
    monitor = instance;
    instance.attach();

    ctx.subscriptions.push(
      ctx.panels.register({
        id: PANEL_ID,
        title: 'panel.title',
        icon: 'Cpu',
        component: createPanelComponent(instance),
        defaultPosition: 'center',
        defaultOpen: true,
      }),
      ctx.commands.register({
        id: 'open',
        title: 'command.open',
        icon: 'Cpu',
        handler: () => {
          ctx.panels.open(PANEL_ID);
        },
      }),
      ctx.commands.register({
        id: 'refresh',
        title: 'command.refresh',
        icon: 'RefreshCw',
        handler: () => instance.refresh(),
      }),
    );
  },

  deactivate(): void {
    monitor?.dispose();
    monitor = null;
  },
});
