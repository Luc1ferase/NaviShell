import { useState, type ReactNode } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { resolveLocalized } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { reloadPlugins, setPluginEnabled } from '@/core/plugins/loader';
import { useSettingsStore } from '@/core/stores/settings';
import { usePluginsStore, type PluginEntry } from '@/core/stores/plugins';
import { useUiStore } from '@/core/stores/ui';
import { Icon } from '@/app/components/Icon';

/** Project repository shown in the About section. */
const REPO_URL = 'https://github.com/navishell/navishell';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="ns-settings__row">
      <span className="ns-settings__row-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className="ns-settings__control">{children}</span>
    </div>
  );
}

function PluginCard({ entry }: { entry: PluginEntry }) {
  const { t, locale } = useI18n();
  const disabled = useSettingsStore((state) => state.settings.plugins.disabled);
  const [busy, setBusy] = useState(false);
  const enabled = !disabled.includes(entry.id);

  const statusClass =
    entry.status === 'error'
      ? 'ns-badge ns-badge--danger'
      : entry.status === 'active'
        ? 'ns-badge ns-badge--accent'
        : 'ns-badge';

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await setPluginEnabled(entry.id, next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ns-plugin-card">
      <Icon name={entry.manifest.icon ?? 'Plug'} size={16} />
      <div className="ns-plugin-card__body">
        <div className="ns-plugin-card__name">
          {resolveLocalized(entry.manifest.name, locale) || entry.id}
          <span className={statusClass}>{t(`plugins.status.${entry.status}`)}</span>
        </div>
        <div className="ns-plugin-card__meta">
          {entry.id} · v{entry.manifest.version}
          {entry.manifest.author ? ` · ${entry.manifest.author}` : ''} ·{' '}
          {t(`plugins.source.${entry.source}`)}
        </div>
        {entry.manifest.description ? (
          <div className="ns-plugin-card__desc">
            {resolveLocalized(entry.manifest.description, locale)}
          </div>
        ) : null}
        {entry.error ? <div className="ns-plugin-card__error">{entry.error}</div> : null}
      </div>
      <label className="ns-check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        {t('plugins.enabled')}
      </label>
    </div>
  );
}

export function SettingsPanel() {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const appInfo = useSettingsStore((state) => state.appInfo);
  const update = useSettingsStore((state) => state.update);
  const updateTerminal = useSettingsStore((state) => state.updateTerminal);
  const plugins = usePluginsStore((state) => state.entries);
  const toast = useUiStore((state) => state.toast);
  const [reloading, setReloading] = useState(false);

  const openPluginsFolder = async () => {
    if (!appInfo) return;
    try {
      await revealItemInDir(appInfo.paths.pluginsDir);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const doReload = async () => {
    setReloading(true);
    try {
      await reloadPlugins();
      toast(t('plugins.reloaded'), 'success');
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="ns-panel">
      <div className="ns-panel__body">
        <div className="ns-settings">
          <h2 className="ns-settings__title">{t('settings.title')}</h2>

          <section className="ns-settings__section">
            <h3>{t('settings.general')}</h3>
            <Row label={t('settings.localeLabel')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={settings.locale}
                onChange={(event) =>
                  update((prev) => ({
                    ...prev,
                    locale: event.target.value as typeof prev.locale,
                  }))
                }
              >
                <option value="system">{t('settings.locale.system')}</option>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </Row>
            <Row label={t('settings.themeLabel')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={settings.theme}
                onChange={(event) =>
                  update((prev) => ({ ...prev, theme: event.target.value as typeof prev.theme }))
                }
              >
                <option value="dark">{t('settings.theme.dark')}</option>
                <option value="light">{t('settings.theme.light')}</option>
                <option value="system">{t('settings.theme.system')}</option>
              </select>
            </Row>
            <Row label={t('settings.closeWithLastTerminal')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.closeConnectionWithLastTerminal}
                  onChange={(event) =>
                    update((prev) => ({
                      ...prev,
                      closeConnectionWithLastTerminal: event.target.checked,
                    }))
                  }
                />
                {t('settings.closeWithLastTerminalHint')}
              </label>
            </Row>
          </section>

          <section className="ns-settings__section">
            <h3>{t('settings.terminal')}</h3>
            <Row label={t('settings.fontFamily')}>
              <input
                className="ns-input ns-input--mono"
                value={settings.terminal.fontFamily}
                onChange={(event) => updateTerminal({ fontFamily: event.target.value })}
              />
            </Row>
            <Row label={t('settings.fontSize')}>
              <input
                className="ns-input ns-settings__control--narrow"
                type="number"
                min={8}
                max={32}
                value={settings.terminal.fontSize}
                onChange={(event) => updateTerminal({ fontSize: Number(event.target.value) || 14 })}
              />
            </Row>
            <Row label={t('settings.lineHeight')}>
              <input
                className="ns-input ns-settings__control--narrow"
                type="number"
                min={1}
                max={2.5}
                step={0.05}
                value={settings.terminal.lineHeight}
                onChange={(event) =>
                  updateTerminal({ lineHeight: Number(event.target.value) || 1.2 })
                }
              />
            </Row>
            <Row label={t('settings.cursorStyle')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={settings.terminal.cursorStyle}
                onChange={(event) =>
                  updateTerminal({
                    cursorStyle: event.target.value as 'block' | 'underline' | 'bar',
                  })
                }
              >
                <option value="block">{t('settings.cursor.block')}</option>
                <option value="underline">{t('settings.cursor.underline')}</option>
                <option value="bar">{t('settings.cursor.bar')}</option>
              </select>
            </Row>
            <Row label={t('settings.cursorBlink')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.terminal.cursorBlink}
                  onChange={(event) => updateTerminal({ cursorBlink: event.target.checked })}
                />
                {t('settings.cursorBlinkHint')}
              </label>
            </Row>
            <Row label={t('settings.scrollback')}>
              <input
                className="ns-input ns-settings__control--narrow"
                type="number"
                min={100}
                max={200000}
                step={100}
                value={settings.terminal.scrollback}
                onChange={(event) =>
                  updateTerminal({ scrollback: Number(event.target.value) || 5000 })
                }
              />
            </Row>
            <Row label={t('settings.webgl')} hint={t('settings.webglHint')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.terminal.webgl}
                  onChange={(event) => updateTerminal({ webgl: event.target.checked })}
                />
                {t('settings.webglToggle')}
              </label>
            </Row>
            <Row label={t('settings.termType')} hint="TERM">
              <input
                className="ns-input ns-input--mono ns-settings__control--narrow"
                value={settings.terminal.termType}
                onChange={(event) => updateTerminal({ termType: event.target.value })}
              />
            </Row>
          </section>

          <section className="ns-settings__section">
            <h3>{t('settings.plugins')}</h3>
            <div className="ns-panel__toolbar" style={{ padding: '0 0 8px', border: 0 }}>
              <button
                type="button"
                className="ns-btn"
                disabled={!appInfo}
                onClick={() => void openPluginsFolder()}
              >
                <FolderOpen size={14} />
                {t('plugins.openFolder')}
              </button>
              <button
                type="button"
                className="ns-btn"
                disabled={reloading}
                onClick={() => void doReload()}
              >
                <RefreshCw size={14} />
                {t('plugins.reload')}
              </button>
            </div>
            {appInfo ? <div className="ns-mono">{appInfo.paths.pluginsDir}</div> : null}
            {plugins.length === 0 ? (
              <div className="ns-empty">{t('plugins.none')}</div>
            ) : (
              plugins.map((entry) => <PluginCard key={entry.id} entry={entry} />)
            )}
          </section>

          <section className="ns-settings__section">
            <h3>{t('settings.about')}</h3>
            <div className="ns-about-row">
              <span>{t('about.version')}</span>
              <span>{appInfo?.version ?? '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.platform')}</span>
              <span>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.appData')}</span>
              <span className="ns-mono">{appInfo?.paths.appData ?? '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.logs')}</span>
              <span className="ns-mono">{appInfo?.paths.logsDir ?? '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.repository')}</span>
              <button
                type="button"
                className="ns-link"
                onClick={() => {
                  void openUrl(REPO_URL).catch((error) => toast(errorMessage(error), 'error'));
                }}
              >
                {REPO_URL}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
