/**
 * navishell.sftp - right-docked SFTP file manager.
 *
 * The panel follows the active terminal's connection and falls back to a dropdown of open
 * connections. All remote work goes through `ctx.connections.sftp(connectionId)`.
 */

import { definePlugin } from '@navishell/plugin-api';
import type { PluginContext } from '@navishell/plugin-api';
import { en, zhCN } from './locales';
import { createPanelComponent } from './panel-host';
import { SftpController } from './store';
import './styles.css';

const PANEL_ID = 'explorer';

let controller: SftpController | null = null;

export default definePlugin({
  activate(ctx: PluginContext): void {
    ctx.i18n.addResources('en', en);
    ctx.i18n.addResources('zh-CN', zhCN);

    const instance = new SftpController(ctx);
    controller = instance;
    instance.attach();

    ctx.subscriptions.push(
      ctx.panels.register({
        id: PANEL_ID,
        title: 'panel.title',
        icon: 'FolderTree',
        component: createPanelComponent(instance),
        defaultPosition: 'right',
        defaultOpen: true,
        defaultSize: 340,
      }),
    );

    ctx.subscriptions.push(
      ctx.commands.register({
        id: 'open',
        title: 'command.open',
        icon: 'FolderTree',
        handler: () => {
          ctx.panels.open(PANEL_ID);
        },
      }),
    );

    ctx.subscriptions.push(
      ctx.commands.register({
        id: 'refresh',
        title: 'command.refresh',
        icon: 'RefreshCw',
        handler: () => instance.refresh(),
      }),
    );

    void instance.start();
  },

  deactivate(): void {
    controller?.dispose();
    controller = null;
  },
});
