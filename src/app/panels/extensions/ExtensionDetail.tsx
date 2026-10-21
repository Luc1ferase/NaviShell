import { useState, type JSX, type ReactNode } from 'react';
import { ArrowLeft, CircleArrowUp, Download, ExternalLink, Trash2 } from 'lucide-react';

import { Icon, resolveIcon } from '@/app/components/Icon';
import { useI18n } from '@/core/i18n/useI18n';
import { installPlugin } from '@/core/plugins/install';
import { useSettingsStore } from '@/core/stores/settings';
import { useUiStore } from '@/core/stores/ui';

import { installAttempt, openExternal, toggleExtension, uninstallExtension } from './actions';
import { ExtensionBadges } from './ExtensionBadges';
import { ExtensionDocument } from './ExtensionDocument';
import { ExtensionMeta } from './ExtensionMeta';
import { ExtensionVersions } from './ExtensionVersions';
import type { ExtensionItem } from './model';

type DetailTab = 'details' | 'changelog' | 'versions';

const TABS: readonly DetailTab[] = ['details', 'changelog', 'versions'];

/** Which header action is running; the others are disabled while one is. */
type RunningAction = 'install' | 'toggle' | 'uninstall';

export interface ExtensionDetailProps {
  item: ExtensionItem;
  hostVersion: string | null;
  /** Clears the selection; only reachable in the one-column layout. */
  onBack: () => void;
}

/**
 * Everything about one extension: what it is, what the buttons do to it, and its own
 * documents. Mounted keyed by the item id, so the tab resets with the selection.
 */
export function ExtensionDetail({ item, hostVersion, onBack }: ExtensionDetailProps): JSX.Element {
  const { t } = useI18n();
  const toast = useUiStore((state) => state.toast);
  const disabledIds = useSettingsStore((state) => state.settings.plugins.disabled);
  const [tab, setTab] = useState<DetailTab>('details');
  const [running, setRunning] = useState<RunningAction | null>(null);

  const { action, installed, registry: entry } = item;
  const busy = running !== null;
  const enabled = installed !== undefined && !disabledIds.includes(item.id);
  const requiresHost = t('ext.badge.requiresHost', { version: entry?.minHostVersion ?? '' });

  /** A finished install reloads the plugins, so the panel re-renders with the new state. */
  const install = async (replace: boolean) => {
    if (!entry) return;
    setRunning('install');
    try {
      await installPlugin(
        installAttempt(entry.url, entry.sha256),
        replace ? { replace: true } : {},
      );
    } finally {
      setRunning(null);
    }
  };

  const toggle = async () => {
    setRunning('toggle');
    try {
      await toggleExtension(item, !enabled);
    } finally {
      setRunning(null);
    }
  };

  const uninstall = async () => {
    setRunning('uninstall');
    try {
      await uninstallExtension(item);
    } finally {
      setRunning(null);
    }
  };

  let primary: ReactNode = null;
  switch (action.kind) {
    case 'install':
      primary = (
        <button
          type="button"
          className="ns-btn ns-btn--primary"
          disabled={busy || item.hostTooOld}
          title={item.hostTooOld ? requiresHost : undefined}
          onClick={() => void install(false)}
        >
          <Download size={14} />
          {running === 'install' ? t('ext.action.busy') : t('ext.action.install')}
        </button>
      );
      break;
    case 'update':
      primary = (
        <button
          type="button"
          className="ns-btn ns-btn--primary"
          disabled={busy || item.hostTooOld}
          title={item.hostTooOld ? requiresHost : undefined}
          onClick={() => void install(true)}
        >
          <CircleArrowUp size={14} />
          {running === 'install'
            ? t('ext.action.busy')
            : t('ext.action.update', { version: action.latest })}
        </button>
      );
      break;
    case 'upToDate':
    case 'installedOnly':
    case 'builtin':
      // The state pill above already says "Installed" / "Built-in"; the only actions left
      // are enable/disable and uninstall.
      break;
  }

  const homepage = entry?.homepage;
  const repository = entry?.repository;

  return (
    <div className="ns-ext__detail">
      <button type="button" className="ns-btn ns-btn--sm ns-ext__back" onClick={onBack}>
        <ArrowLeft size={13} />
        {t('ext.back')}
      </button>

      <header className="ns-ext__head">
        <Icon
          name={resolveIcon(item.icon) ? item.icon : 'Puzzle'}
          size={40}
          className="ns-ext__head-icon"
        />
        <div className="ns-ext__head-body">
          <h2 className="ns-ext__title">{item.name}</h2>
          <div className="ns-ext__subtitle">
            {[item.author, item.id, `v${item.version}`].filter(Boolean).join(' · ')}
          </div>
          <div className="ns-ext__badges">
            <ExtensionBadges item={item} hostWarning />
          </div>
          <div className="ns-ext__actions">
            {primary}
            {installed ? (
              <button
                type="button"
                className="ns-btn"
                disabled={busy}
                onClick={() => void toggle()}
              >
                {running === 'toggle'
                  ? t('ext.action.busy')
                  : enabled
                    ? t('ext.action.disable')
                    : t('ext.action.enable')}
              </button>
            ) : null}
            {installed?.source === 'external' ? (
              <button
                type="button"
                className="ns-btn ns-btn--danger"
                disabled={busy}
                onClick={() => void uninstall()}
              >
                <Trash2 size={14} />
                {running === 'uninstall' ? t('ext.action.busy') : t('ext.action.uninstall')}
              </button>
            ) : null}
            {homepage || repository ? (
              <span className="ns-ext__links" role="group" aria-label={t('ext.meta.links')}>
                {homepage ? (
                  <button
                    type="button"
                    className="ns-link ns-ext__link"
                    onClick={() => void openExternal(homepage, (m) => toast(m, 'error'))}
                  >
                    <ExternalLink size={12} />
                    {t('ext.meta.homepage')}
                  </button>
                ) : null}
                {repository ? (
                  <button
                    type="button"
                    className="ns-link ns-ext__link"
                    onClick={() => void openExternal(repository, (m) => toast(m, 'error'))}
                  >
                    <ExternalLink size={12} />
                    {t('ext.meta.repository')}
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <ExtensionMeta item={item} />

      <div className="ns-ext__tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`ns-ext-tab-${id}`}
            className="ns-ext__tab"
            aria-selected={tab === id}
            aria-controls="ns-ext-tabpanel"
            onClick={() => setTab(id)}
          >
            {t(`ext.tab.${id}`)}
          </button>
        ))}
      </div>

      <div
        className="ns-ext__tabpanel"
        id="ns-ext-tabpanel"
        role="tabpanel"
        aria-labelledby={`ns-ext-tab-${tab}`}
      >
        {tab === 'details' ? (
          <>
            {entry?.screenshots && entry.screenshots.length > 0 ? (
              <div className="ns-ext__shots">
                {/* The host keeps only http(s) URLs in `screenshots`. */}
                {entry.screenshots.map((url) => (
                  <img key={url} className="ns-ext__shot" src={url} alt="" loading="lazy" />
                ))}
              </div>
            ) : null}
            <ExtensionDocument
              url={entry?.readme}
              fallback={item.description}
              emptyLabel={t('ext.detail.noReadme')}
            />
          </>
        ) : null}
        {tab === 'changelog' ? (
          <ExtensionDocument url={entry?.changelog} emptyLabel={t('ext.detail.noChangelog')} />
        ) : null}
        {tab === 'versions' ? <ExtensionVersions item={item} hostVersion={hostVersion} /> : null}
      </div>
    </div>
  );
}
