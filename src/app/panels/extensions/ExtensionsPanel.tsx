/**
 * The Extensions panel: the marketplace index merged with the installed plugins, as a
 * list plus a detail pane (README, changelog, versions).
 *
 * The panel owns the filter and the selection and nothing else; what an item is and what
 * its buttons do is resolved in `model.ts`.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';

import { useI18n } from '@/core/i18n/useI18n';
import type { PluginCategory } from '@/core/ipc/contract';
import type { CorePanelProps } from '@/core/plugins/registry';
import { ensurePluginRegistry, useMarketplaceStore } from '@/core/stores/marketplace';
import { usePluginsStore } from '@/core/stores/plugins';
import { useSettingsStore } from '@/core/stores/settings';

import { ExtensionDetail } from './ExtensionDetail';
import { ExtensionList } from './ExtensionList';
import { ExtensionsToolbar } from './ExtensionsToolbar';
import {
  buildItems,
  categoryCounts,
  countUpdates,
  filterItems,
  type ExtensionSort,
  type ExtensionView,
} from './model';

export function ExtensionsPanel(_props: CorePanelProps): JSX.Element {
  const { t, locale } = useI18n();
  const registry = useMarketplaceStore((state) => state.registry);
  const loading = useMarketplaceStore((state) => state.loading);
  const error = useMarketplaceStore((state) => state.error);
  const entries = usePluginsStore((state) => state.entries);
  const hostVersion = useSettingsStore((state) => state.appInfo?.version ?? null);

  const [view, setView] = useState<ExtensionView>('marketplace');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PluginCategory | null>(null);
  const [sort, setSort] = useState<ExtensionSort>('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Once per app session; Settings may have fetched the index already.
  useEffect(() => {
    void ensurePluginRegistry();
  }, []);

  const items = useMemo(
    () => buildItems(registry?.plugins ?? [], entries, locale, hostVersion),
    [registry, entries, locale, hostVersion],
  );
  const listed = useMemo(
    () => filterItems(items, { view, query, category, sort }, locale),
    [items, view, query, category, sort, locale],
  );
  const updates = useMemo(() => countUpdates(items), [items]);
  const categories = useMemo(() => categoryCounts(items), [items]);

  // Derived rather than stored, so a selection the current view no longer lists drops
  // away by itself instead of needing an effect to clear it.
  const selected = listed.find((item) => item.id === selectedId) ?? null;

  let emptyLabel: string;
  if (!registry && loading) emptyLabel = t('ext.loading');
  else if (!registry && !error) emptyLabel = t('ext.notLoaded');
  else emptyLabel = t(`ext.empty.${view}`);

  return (
    <div className={`ns-panel ns-ext${selected ? ' ns-ext--detail-open' : ''}`}>
      <ExtensionsToolbar
        view={view}
        onView={setView}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        category={category}
        onCategory={setCategory}
        categories={categories}
        updates={updates}
      />

      {/* The index failing does not take the installed extensions down with it. */}
      {error ? <div className="ns-ext__error">{t('ext.failed', { message: error })}</div> : null}

      <div className="ns-ext__body">
        <ExtensionList
          items={listed}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          emptyLabel={emptyLabel}
        />
        <div className="ns-ext__detail-col">
          {selected ? (
            <ExtensionDetail
              key={selected.id}
              item={selected}
              hostVersion={hostVersion}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="ns-ext__placeholder">{t('ext.select')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
