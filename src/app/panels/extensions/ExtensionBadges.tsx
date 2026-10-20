import type { JSX } from 'react';
import { TriangleAlert } from 'lucide-react';

import { useI18n } from '@/core/i18n/useI18n';

import type { ExtensionItem } from './model';

export interface ExtensionBadgesProps {
  item: ExtensionItem;
  /** Dense list rows use the smaller pill. */
  dense?: boolean;
  /** The detail header also warns that the host is too old; the list row does not. */
  hostWarning?: boolean;
}

/**
 * The state pills of one extension: what the install state is, plus whether the installed
 * plugin is switched off or failed to load.
 */
export function ExtensionBadges({
  item,
  dense = false,
  hostWarning = false,
}: ExtensionBadgesProps): JSX.Element | null {
  const { t } = useI18n();
  const size = dense ? ' ns-badge--xs' : '';
  const { action, installed } = item;
  const badges: JSX.Element[] = [];

  switch (action.kind) {
    case 'update':
      badges.push(
        <span key="update" className={`ns-badge ns-badge--accent${size}`}>
          {t('ext.badge.update')}
        </span>,
      );
      break;
    case 'upToDate':
    case 'installedOnly':
      badges.push(
        <span key="installed" className={`ns-badge${size}`}>
          {t('ext.badge.installed')}
        </span>,
      );
      break;
    case 'builtin':
      badges.push(
        <span key="builtin" className={`ns-badge${size}`}>
          {t('ext.badge.builtin')}
        </span>,
      );
      break;
    case 'install':
      break;
  }

  if (installed?.status === 'disabled') {
    badges.push(
      <span key="disabled" className={`ns-badge${size}`}>
        {t('ext.badge.disabled')}
      </span>,
    );
  }
  if (installed?.status === 'error') {
    badges.push(
      <span
        key="error"
        className={`ns-badge ns-badge--danger${size}`}
        title={installed.error ?? undefined}
      >
        {t('ext.badge.error')}
      </span>,
    );
  }
  if (hostWarning && item.hostTooOld) {
    badges.push(
      <span key="host" className={`ns-badge ns-badge--warning ns-badge--icon${size}`}>
        <TriangleAlert size={11} />
        {t('ext.badge.requiresHost', { version: item.registry?.minHostVersion ?? '' })}
      </span>,
    );
  }

  if (badges.length === 0) return null;
  return <>{badges}</>;
}
