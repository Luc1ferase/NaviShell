import type { JSX } from 'react';
import { RefreshCw, Search, Settings } from 'lucide-react';

import { useI18n } from '@/core/i18n/useI18n';
import type { PluginCategory } from '@/core/ipc/contract';
import { openSettingsPanel } from '@/core/services/layout';
import { fetchPluginRegistry, useMarketplaceStore } from '@/core/stores/marketplace';
import { useUiStore } from '@/core/stores/ui';

import type { ExtensionSort, ExtensionView } from './model';

const VIEWS: readonly ExtensionView[] = ['marketplace', 'installed', 'updates'];

const SORTS: readonly ExtensionSort[] = ['default', 'name'];

export interface ExtensionsToolbarProps {
  view: ExtensionView;
  onView: (view: ExtensionView) => void;
  query: string;
  onQuery: (query: string) => void;
  sort: ExtensionSort;
  onSort: (sort: ExtensionSort) => void;
  category: PluginCategory | null;
  onCategory: (category: PluginCategory | null) => void;
  /** Categories that occur in the index, with how many extensions each has. */
  categories: Map<PluginCategory, number>;
  /** How many installed extensions the index can update. */
  updates: number;
}

/** Search, the three views, sorting and the registry shortcuts. */
export function ExtensionsToolbar({
  view,
  onView,
  query,
  onQuery,
  sort,
  onSort,
  category,
  onCategory,
  categories,
  updates,
}: ExtensionsToolbarProps): JSX.Element {
  const { t } = useI18n();
  const loading = useMarketplaceStore((state) => state.loading);
  const toast = useUiStore((state) => state.toast);

  const refresh = async () => {
    const message = await fetchPluginRegistry();
    if (message) toast(message, 'error');
  };

  return (
    <>
      <div className="ns-ext__toolbar">
        <div className="ns-ext__search">
          <Search size={14} className="ns-ext__search-icon" />
          <input
            className="ns-input ns-ext__search-input"
            type="search"
            placeholder={t('ext.search')}
            aria-label={t('ext.search')}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>

        <div className="ns-ext__views">
          {VIEWS.map((id) => (
            <button
              key={id}
              type="button"
              className="ns-ext__view"
              aria-pressed={view === id}
              onClick={() => onView(id)}
            >
              {t(`ext.view.${id}`)}
              {id === 'updates' && updates > 0 ? (
                <span
                  className="ns-badge ns-badge--accent ns-badge--xs"
                  aria-label={t('ext.updatesBadge', { count: updates })}
                >
                  {updates}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <select
          className="ns-select ns-ext__sort"
          aria-label={t('ext.sort.label')}
          title={t('ext.sort.label')}
          value={sort}
          onChange={(event) => onSort(event.target.value as ExtensionSort)}
        >
          {SORTS.map((id) => (
            <option key={id} value={id}>
              {t(`ext.sort.${id}`)}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="ns-btn ns-btn--icon"
          title={t('ext.refresh')}
          aria-label={t('ext.refresh')}
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} className={loading ? 'ns-spin' : undefined} />
        </button>

        <button
          type="button"
          className="ns-btn ns-btn--ghost ns-btn--sm"
          onClick={() => openSettingsPanel()}
        >
          <Settings size={13} />
          {t('ext.registrySettings')}
        </button>
      </div>

      {view === 'marketplace' ? (
        <div className="ns-ext__categories">
          <button
            type="button"
            className="ns-ext__chip"
            aria-pressed={category === null}
            onClick={() => onCategory(null)}
          >
            {t('ext.category.all')}
          </button>
          {[...categories].map(([id, count]) => (
            <button
              key={id}
              type="button"
              className="ns-ext__chip"
              aria-pressed={category === id}
              onClick={() => onCategory(id)}
            >
              {t(`ext.category.${id}`)}
              <span className="ns-ext__chip-count">{count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
