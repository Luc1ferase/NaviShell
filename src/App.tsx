import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { JsonValue } from '@navishell/plugin-api';

import { registerHostCommands } from '@/app/hostCommands';
import { ContextMenuHost } from '@/app/components/ContextMenuHost';
import { DialogHost } from '@/app/components/Dialogs';
import { ServerFormDialog } from '@/app/components/ServerFormDialog';
import { Splash } from '@/app/components/Splash';
import { StatusBar } from '@/app/components/StatusBar';
import { TerminalOverlayHost } from '@/app/components/TerminalOverlayHost';
import { TitleBar } from '@/app/components/TitleBar';
import { Toasts } from '@/app/components/Toasts';
import { DockLayout } from '@/app/layout/DockLayout';
import { registerCorePanels } from '@/app/panels/corePanels';
import { bootstrap, type BootstrapStep } from '@/core/bootstrap';
import { onDidChangeLocale, setLocale, resolveLocale } from '@/core/i18n';
import { errorMessage, listenHost } from '@/core/ipc/client';
import { installContextMenuGuard } from '@/core/menus/guard';
import { handleAuthPrompt } from '@/core/services/connect';
import { flushLayoutPersist, refreshPanelTitles } from '@/core/services/layout';
import { applyThemeToDocument, resolveTheme } from '@/core/services/theme';
import { runStartupUpdateCheck } from '@/core/services/updater';
import { startPluginUpdateChecks } from '@/core/services/pluginUpdates';
import { flushSettings, getSettings, onDidChangeSettings } from '@/core/stores/settings';
import { useUiStore } from '@/core/stores/ui';
import {
  applyTerminalSettings,
  disposeAllTerminals,
  handleConnectionClosed,
  handleTerminalExit,
  openLocalTerminal,
} from '@/core/terminal/manager';

type Phase = 'loading' | 'ready';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [step, setStep] = useState<BootstrapStep>('settings');
  const [savedLayout, setSavedLayout] = useState<JsonValue | null>(null);
  const started = useRef(false);

  // -- startup -------------------------------------------------------------
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    registerCorePanels();

    void bootstrap({
      onStep: setStep,
      beforePlugins: registerHostCommands,
    })
      .then((result) => {
        setSavedLayout(result.layout);
        setPhase('ready');
        // Plugins are up by now; the check is silent unless it finds something.
        void runStartupUpdateCheck();
        startPluginUpdateChecks();
        if (result.warnings.length > 0) {
          console.warn('[navishell] startup warnings', result.warnings);
          if (isTauri()) {
            for (const warning of result.warnings) {
              useUiStore.getState().toast(warning, 'warning');
            }
          }
        }
      })
      .catch((error) => {
        console.error('[navishell] startup failed', error);
        setPhase('ready');
      });
  }, []);

  // -- host events ---------------------------------------------------------
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;

    const register = (promise: Promise<() => void>) => {
      void promise
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch((error) => console.warn('[navishell] event listener failed', error));
    };

    register(listenHost('terminal:exit', (p) => handleTerminalExit(p.terminalId, p.exitCode)));
    register(listenHost('connection:closed', (p) => handleConnectionClosed(p.connectionId)));
    // Keyboard-interactive rounds arrive while `ssh_connect` is still pending.
    register(listenHost('auth:prompt', (p) => void handleAuthPrompt(p)));

    return () => {
      disposed = true;
      for (const unlisten of unlisteners.splice(0)) unlisten();
    };
  }, []);

  // -- global shortcuts ----------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Shift+` opens a local shell. Captured before xterm sees the key.
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      if (event.code !== 'Backquote' && event.key !== '`' && event.key !== '~') return;
      event.preventDefault();
      event.stopPropagation();
      void openLocalTerminal().catch((error) => {
        const message = errorMessage(error);
        if (message) useUiStore.getState().toast(message, 'error');
      });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // -- context menus -------------------------------------------------------
  // Right clicks nobody handled get the app's own menus (or none), never the WebView's.
  useEffect(() => installContextMenuGuard(), []);

  // -- settings / locale / theme reactions ---------------------------------
  useEffect(() => {
    let previous = getSettings();

    const settingsSubscription = onDidChangeSettings((next) => {
      if (next.theme !== previous.theme) {
        applyThemeToDocument(resolveTheme(next.theme));
      }
      if (next.locale !== previous.locale) {
        void setLocale(resolveLocale(next.locale));
      }
      if (next.terminal !== previous.terminal || next.theme !== previous.theme) {
        applyTerminalSettings();
      }
      previous = next;
    });

    const localeSubscription = onDidChangeLocale(() => refreshPanelTitles());

    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const onSystemThemeChange = () => {
      if (getSettings().theme === 'system') {
        applyThemeToDocument(resolveTheme('system'));
        applyTerminalSettings();
      }
    };
    media?.addEventListener('change', onSystemThemeChange);

    return () => {
      settingsSubscription.dispose();
      localeSubscription.dispose();
      media?.removeEventListener('change', onSystemThemeChange);
    };
  }, []);

  // -- teardown ------------------------------------------------------------
  useEffect(() => {
    const onBeforeUnload = () => {
      flushSettings();
      flushLayoutPersist();
      disposeAllTerminals();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (phase === 'loading') return <Splash step={step} />;

  return (
    <div className="ns-app">
      <TitleBar />
      <div className="ns-app__body">
        <DockLayout savedLayout={savedLayout} />
      </div>
      <StatusBar />

      <TerminalOverlayHost />
      <DialogHost />
      <ServerFormDialog />
      <ContextMenuHost />
      <Toasts />
    </div>
  );
}
