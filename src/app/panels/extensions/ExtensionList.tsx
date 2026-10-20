import { useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react';
import { CircleArrowUp, Download } from 'lucide-react';

import { Icon, resolveIcon } from '@/app/components/Icon';
import { useI18n } from '@/core/i18n/useI18n';
import { installPlugin } from '@/core/plugins/install';

import { installAttempt } from './actions';
import { ExtensionBadges } from './ExtensionBadges';
import type { ExtensionItem } from './model';

const ROW_SELECTOR = '[role="option"]';

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

interface ExtensionRowProps {
  item: ExtensionItem;
  selected: boolean;
  /** Roving tabindex: one row at a time is in the tab order. */
  tabIndex: number;
  onSelect: (id: string) => void;
}

function ExtensionRow({ item, selected, tabIndex, onSelect }: ExtensionRowProps): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const { action } = item;
  const update = action.kind === 'update';

  const install = async (event: MouseEvent<HTMLButtonElement>) => {
    // Installing from the list must not move the selection away from what the user reads.
    event.stopPropagation();
    const entry = item.registry;
    if (!entry) return;
    setBusy(true);
    try {
      await installPlugin(installAttempt(entry.url, entry.sha256), update ? { replace: true } : {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`ns-ext__row${selected ? ' ns-ext__row--selected' : ''}`}
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={() => onSelect(item.id)}
    >
      <Icon
        name={resolveIcon(item.icon) ? item.icon : 'Puzzle'}
        size={22}
        className="ns-ext__row-icon"
      />
      <div className="ns-ext__row-body">
        <div className="ns-ext__row-title">
          <span className="ns-ext__row-name">{item.name}</span>
          <span className="ns-ext__row-version">v{item.version}</span>
        </div>
        <div className="ns-ext__row-sub">
          <span className="ns-ext__row-desc">{item.description}</span>
          {item.author ? <span className="ns-ext__row-author">{item.author}</span> : null}
        </div>
      </div>
      <div className="ns-ext__row-side">
        <span className="ns-ext__row-badges">
          <ExtensionBadges item={item} dense />
        </span>
        {action.kind === 'install' || update ? (
          <button
            type="button"
            className="ns-btn ns-btn--sm ns-btn--primary"
            disabled={busy || item.hostTooOld}
            title={
              item.hostTooOld
                ? t('ext.badge.requiresHost', { version: item.registry?.minHostVersion ?? '' })
                : undefined
            }
            onClick={(event) => void install(event)}
          >
            {update ? <CircleArrowUp size={12} /> : <Download size={12} />}
            {busy
              ? t('ext.action.busy')
              : update
                ? t('ext.action.update', { version: action.latest })
                : t('ext.action.install')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface ExtensionListProps {
  items: readonly ExtensionItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Why the list is empty, already translated. */
  emptyLabel: string;
}

/** The left column: how many extensions match, then one row each. */
export function ExtensionList({
  items,
  selectedId,
  onSelect,
  emptyLabel,
}: ExtensionListProps): JSX.Element {
  const { t } = useI18n();
  const selectedIndex = items.findIndex((item) => item.id === selectedId);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Buttons inside a row keep their own keyboard behaviour.
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'option')
      return;
    const container = event.currentTarget;

    if (event.key === 'Enter' || event.key === ' ') {
      const focused = rows(container).indexOf(event.target);
      const item = items[focused];
      if (!item) return;
      event.preventDefault();
      onSelect(item.id);
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = selectedIndex >= 0 ? selectedIndex + step : step > 0 ? 0 : items.length - 1;
    const next = Math.min(items.length - 1, Math.max(0, from));
    const item = items[next];
    if (!item) return;
    onSelect(item.id);
    // The rows have not re-rendered yet, so move focus by position rather than by id.
    rows(container)[next]?.focus();
  };

  return (
    <div className="ns-ext__list-col">
      <div className="ns-ext__count">{t('ext.count', { count: items.length })}</div>
      {items.length === 0 ? (
        <div className="ns-empty">{emptyLabel}</div>
      ) : (
        <div
          className="ns-ext__list"
          role="listbox"
          aria-label={t('panel.extensions.title')}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) => (
            <ExtensionRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              tabIndex={(selectedIndex >= 0 ? index === selectedIndex : index === 0) ? 0 : -1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
