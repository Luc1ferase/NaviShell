import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { getCurrentWindow, type Window } from '@tauri-apps/api/window';

import { useI18n } from '@/core/i18n/useI18n';

/**
 * `getCurrentWindow()` reads globals Tauri injects into the WebView, so it throws in a
 * plain browser. The bar still renders there; the buttons just do nothing.
 */
function hostWindow(): Window | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/** Window IPC is best-effort here: a denied permission must not escape the handler. */
function act(action: (win: Window) => Promise<void>): void {
  const win = hostWindow();
  if (win) void action(win).catch(() => {});
}

/**
 * The glyphs are drawn here rather than taken from an icon set: VS Code's window controls
 * are 10px hairlines on half-pixel coordinates, which is what keeps them crisp at 1x.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function WindowControls() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  // The restore glyph has to follow the real window state, which the user can also change
  // by snapping or double-clicking a drag region, so every resize re-reads it.
  useEffect(() => {
    const win = hostWindow();
    if (!win) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {});
    };

    sync();
    void win
      .onResized(sync)
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="ns-window-controls">
      {/* Native controls are not in the tab order, and neither are these. */}
      <button
        type="button"
        className="ns-window-controls__btn"
        onClick={() => act((win) => win.minimize())}
        title={t('titlebar.minimize')}
        aria-label={t('titlebar.minimize')}
        tabIndex={-1}
      >
        <Glyph>
          <path d="M0 5.5h10" />
        </Glyph>
      </button>

      <button
        type="button"
        className="ns-window-controls__btn"
        onClick={() => act((win) => win.toggleMaximize())}
        title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        tabIndex={-1}
      >
        {maximized ? (
          <Glyph>
            {/* The back square minus the edges the front one covers. */}
            <path d="M3.5 3.5V0.5h6v6h-3" />
            <rect x="0.5" y="3.5" width="6" height="6" />
          </Glyph>
        ) : (
          <Glyph>
            <rect x="0.5" y="0.5" width="9" height="9" />
          </Glyph>
        )}
      </button>

      <button
        type="button"
        className="ns-window-controls__btn ns-window-controls__btn--close"
        onClick={() => act((win) => win.close())}
        title={t('titlebar.close')}
        aria-label={t('titlebar.close')}
        tabIndex={-1}
      >
        <Glyph>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </Glyph>
      </button>
    </div>
  );
}
