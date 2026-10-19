/**
 * navishell.completion - inline command suggestions for every terminal.
 *
 * Sources, in ranking order: entries of the remote directory a path token points at,
 * command history (per server, or `local` for local shells, seeded once per session from
 * the remote `~/.bash_history` / `~/.zsh_history`), the executables on the remote `PATH`,
 * and a built-in dictionary of common commands and subcommands. The popup lives in the
 * terminal overlay layer; keys are only intercepted while it is visible.
 *
 * Path completion needs the shell's working directory, and exact history needs the command
 * the shell really ran. Both are read from whatever a shell reports on its own (OSC 7, and
 * the VS Code-style OSC 133/633 marks); the opt-in `toggleShellIntegration` command installs
 * a hook in new SSH shells that makes bash and zsh report the cwd after every prompt, the
 * command line before it runs and its exit code afterwards.
 */

import { definePlugin } from '@navishell/plugin-api';
import type { PluginContext } from '@navishell/plugin-api';
import { createHistoryPanelComponent } from './HistoryPanel';
import { createOverlayComponent } from './CompletionOverlay';
import { en, zhCN } from './locales';
import { CompletionController } from './store';
import './styles.css';

const HISTORY_PANEL_ID = 'history';

let controller: CompletionController | null = null;

export default definePlugin({
  activate(ctx: PluginContext): void {
    ctx.i18n.addResources('en', en);
    ctx.i18n.addResources('zh-CN', zhCN);

    const instance = new CompletionController(ctx);
    controller = instance;
    instance.attach();

    ctx.subscriptions.push(ctx.terminals.registerOverlay(createOverlayComponent(instance)));
    ctx.subscriptions.push(ctx.terminals.registerKeyHandler(instance.handleKey));

    ctx.subscriptions.push(
      ctx.panels.register({
        id: HISTORY_PANEL_ID,
        title: 'panel.history',
        icon: 'Clock',
        component: createHistoryPanelComponent(instance),
        defaultPosition: 'bottom',
        defaultOpen: false,
        defaultSize: 200,
      }),
    );

    ctx.subscriptions.push(
      ctx.commands.register({
        id: 'toggle',
        title: 'command.toggle',
        icon: 'Sparkles',
        handler: async () => {
          const enabled = await instance.toggle();
          ctx.ui.toast(ctx.i18n.t(enabled ? 'toast.enabled' : 'toast.disabled'), 'info');
          return enabled;
        },
      }),
    );

    ctx.subscriptions.push(
      ctx.commands.register({
        id: 'toggleShellIntegration',
        title: 'command.shellIntegration',
        icon: 'Route',
        handler: async () => {
          const enabled = await instance.toggleShellIntegration();
          ctx.ui.toast(
            ctx.i18n.t(enabled ? 'toast.integrationEnabled' : 'toast.integrationDisabled'),
            'info',
          );
          return enabled;
        },
      }),
    );

    ctx.subscriptions.push(
      ctx.commands.register({
        id: 'showHistory',
        title: 'command.history',
        icon: 'Clock',
        handler: () => {
          ctx.panels.open(HISTORY_PANEL_ID);
        },
      }),
    );

    void instance.start();
  },

  deactivate(): void {
    controller?.dispose();
    controller = null;
  },
});
