import { useMemo, useState, type JSX } from 'react';
import type { Locale } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { installPlugin } from '@/core/plugins/install';
import { useUiStore } from '@/core/stores/ui';

import { installAttempt } from './actions';
import { versionOptions, type ExtensionItem, type VersionOption } from './model';

/**
 * `YYYY-MM-DD` as a local calendar date. `new Date('2026-10-20')` would be UTC midnight and
 * show as the 19th west of Greenwich.
 */
function formatDate(date: string | undefined, locale: Locale): string {
  const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!match) return date ?? '';
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(parsed.getTime())) return date ?? '';
  return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export interface ExtensionVersionsProps {
  item: ExtensionItem;
  hostVersion: string | null;
}

/** Every version the index offers for one extension, each installable on its own. */
export function ExtensionVersions({ item, hostVersion }: ExtensionVersionsProps): JSX.Element {
  const { t, locale } = useI18n();
  const confirm = useUiStore((state) => state.confirm);
  /** The version currently being installed, so only its button says "working". */
  const [busy, setBusy] = useState<string | null>(null);

  const options = useMemo(() => versionOptions(item, hostVersion), [item, hostVersion]);
  const installedVersion = item.installed?.manifest.version;
  // A built-in is never installed over: an external copy would shadow it.
  const locked = item.action.kind === 'builtin';

  const install = async (option: VersionOption) => {
    // Downgrading or picking an older release overwrites the install, which the generic
    // replace prompt would not describe (it does not know which version is coming).
    if (installedVersion !== undefined && installedVersion !== option.version) {
      const confirmed = await confirm({
        title: t('ext.confirm.versionTitle'),
        message: t('ext.confirm.versionMessage', {
          installed: installedVersion,
          version: option.version,
        }),
        okLabel: t('ext.confirm.versionOk'),
      });
      if (!confirmed) return;
    }
    setBusy(option.version);
    try {
      await installPlugin(
        installAttempt(option.url, option.sha256),
        installedVersion === undefined ? {} : { replace: true },
      );
    } finally {
      setBusy(null);
    }
  };

  if (options.length === 0) {
    return <div className="ns-empty">{t('ext.detail.noVersions')}</div>;
  }

  return (
    <table className="ns-ext__versions">
      <tbody>
        {options.map((option) => (
          <tr key={option.version}>
            <th scope="row">
              <span className="ns-mono">{option.version}</span>
              {option.latest ? (
                <span className="ns-badge ns-badge--xs">{t('ext.versions.latest')}</span>
              ) : null}
              {option.installed ? (
                <span className="ns-badge ns-badge--accent ns-badge--xs">
                  {t('ext.versions.installed')}
                </span>
              ) : null}
            </th>
            <td className="ns-ext__versions-date">{formatDate(option.date, locale)}</td>
            <td className="ns-ext__versions-host">
              {option.minHostVersion
                ? t('ext.versions.requires', { version: option.minHostVersion })
                : ''}
            </td>
            <td className="ns-ext__versions-action">
              <button
                type="button"
                className="ns-btn ns-btn--sm"
                disabled={locked || option.installed || option.hostTooOld || busy !== null}
                title={
                  option.hostTooOld
                    ? t('ext.badge.requiresHost', { version: option.minHostVersion ?? '' })
                    : undefined
                }
                onClick={() => void install(option)}
              >
                {busy === option.version
                  ? t('ext.action.busy')
                  : t('ext.action.installVersion', { version: option.version })}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
