import { useSyncExternalStore } from 'react';
import type { Locale } from '@navishell/plugin-api';

import { currentLocale, onDidChangeLocale, t } from './index';

export interface UseI18n {
  locale: Locale;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function subscribe(onStoreChange: () => void): () => void {
  const subscription = onDidChangeLocale(() => onStoreChange());
  return () => subscription.dispose();
}

/**
 * Host translation hook. The active locale is an external store, so components using
 * `t()` re-render when the language changes.
 */
export function useI18n(): UseI18n {
  const locale = useSyncExternalStore(subscribe, currentLocale, currentLocale);
  return { locale, t };
}
