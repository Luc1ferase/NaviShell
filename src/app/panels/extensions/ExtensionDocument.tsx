import type { JSX } from 'react';

import { useI18n } from '@/core/i18n/useI18n';
import { retryRemoteText, useRemoteText } from '@/core/stores/remoteText';

import { Markdown } from './Markdown';
import { documentBaseUrl } from './model';

export interface ExtensionDocumentProps {
  /** Raw Markdown URL from the index; `undefined` when the index lists none. */
  url: string | undefined;
  /** Shown above the empty notice when there is no document (the description). */
  fallback?: string;
  /** `ext.detail.noReadme` or `ext.detail.noChangelog`. */
  emptyLabel: string;
}

/** One Markdown document of the detail pane, with its loading and error states. */
export function ExtensionDocument({
  url,
  fallback,
  emptyLabel,
}: ExtensionDocumentProps): JSX.Element {
  const { t } = useI18n();
  const { text, error, loading } = useRemoteText(url);

  if (url === undefined) {
    return (
      <>
        {fallback ? <p className="ns-ext__lead">{fallback}</p> : null}
        <div className="ns-empty">{emptyLabel}</div>
      </>
    );
  }

  if (error !== null) {
    return (
      <div className="ns-ext__doc-status">
        <span>{t('ext.detail.loadFailed', { message: error })}</span>
        <button type="button" className="ns-btn ns-btn--sm" onClick={() => retryRemoteText(url)}>
          {t('ext.detail.retry')}
        </button>
      </div>
    );
  }

  // `text === null` while the fetch has not been started yet by the store's effect.
  if (loading || text === null) {
    return <div className="ns-empty">{t('ext.detail.loading')}</div>;
  }

  return <Markdown source={text} baseUrl={documentBaseUrl(url)} />;
}
