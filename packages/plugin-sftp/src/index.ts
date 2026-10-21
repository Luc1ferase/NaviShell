/**
 * navishell.sftp - right-docked SFTP file manager.
 *
 * The panel follows the active terminal's connection and falls back to a dropdown of open
 * connections. Local shell terminals have no connection, so they are ignored and leave the
 * panel where it was. All remote work goes through `ctx.connections.sftp(connectionId)`.
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

    // The panel follows the active terminal, so opening it from a terminal's menu shows
    // that host; from a server's menu a terminal is opened first, which makes it active.
    ctx.subscriptions.push(
      ctx.menus.register('terminal', ({ terminal }) =>
        terminal.kind === 'ssh'
          ? [
              {
                id: 'browse',
                label: ctx.i18n.t('menu.browseHere'),
                icon: 'FolderTree',
                onClick: () => ctx.panels.open(PANEL_ID),
              },
            ]
          : [],
      ),
      ctx.menus.register('server', ({ server }) => [
        {
          id: 'explorer',
          label: ctx.i18n.t('menu.openExplorer'),
          icon: 'FolderTree',
          onClick: () => {
            void ctx.servers
              .openTerminal(server.id)
              .then(() => ctx.panels.open(PANEL_ID))
              .catch((error: unknown) => ctx.log.warn('could not open a terminal', error));
          },
        },
      ]),
    );

    void instance.start();
  },

  deactivate(): void {
    controller?.dispose();
    controller = null;
  },
});
