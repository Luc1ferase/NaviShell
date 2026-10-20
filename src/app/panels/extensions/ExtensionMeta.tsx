import type { JSX, ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { useUiStore } from '@/core/stores/ui';

import type { ExtensionItem } from './model';

interface MetaRow {
  key: string;
  label: string;
  value: ReactNode;
}

/**
 * The facts about one extension, as a definition list above the tabs: short values, so a
 * responsive grid fits two or three of them per line and the README keeps the space.
 */
export function ExtensionMeta({ item }: { item: ExtensionItem }): JSX.Element | null {
  const { t } = useI18n();
  const toast = useUiStore((state) => state.toast);
  const entry = item.registry;
  const installed = item.installed;

  const reveal = async (dir: string) => {
    try {
      await revealItemInDir(dir);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const rows: MetaRow[] = [
    { key: 'id', label: t('ext.meta.id'), value: <span className="ns-mono">{item.id}</span> },
  ];
  if (entry) {
    rows.push({ key: 'version', label: t('ext.meta.version'), value: entry.version });
  }
  if (installed) {
    rows.push({
      key: 'installedVersion',
      label: t('ext.meta.installedVersion'),
      value: installed.manifest.version,
    });
  }
  if (item.author) {
    rows.push({ key: 'author', label: t('ext.meta.author'), value: item.author });
  }
  if (entry?.license) {
    rows.push({ key: 'license', label: t('ext.meta.license'), value: entry.license });
  }
  if (item.categories.length > 0) {
    rows.push({
      key: 'categories',
      label: t('ext.meta.categories'),
      value: (
        <span className="ns-ext__tags">
          {item.categories.map((category) => (
            <span key={category} className="ns-ext__tag">
              {t(`ext.category.${category}`)}
            </span>
          ))}
        </span>
      ),
    });
  }
  if (item.tags.length > 0) {
    rows.push({
      key: 'tags',
      label: t('ext.meta.tags'),
      value: (
        <span className="ns-ext__tags">
          {item.tags.map((tag) => (
            <span key={tag} className="ns-ext__tag">
              {tag}
            </span>
          ))}
        </span>
      ),
    });
  }
  if (entry?.minHostVersion) {
    rows.push({
      key: 'minHost',
      label: t('ext.meta.minHost'),
      value: t('ext.meta.minHostValue', { version: entry.minHostVersion }),
    });
  }
  if (installed && installed.source === 'external') {
    const dir = installed.dir;
    rows.push({
      key: 'path',
      label: t('ext.meta.path'),
      value: (
        <span className="ns-ext__path">
          <span className="ns-mono">{dir}</span>
          <button
            type="button"
            className="ns-btn ns-btn--icon"
            title={t('ext.meta.path')}
            aria-label={t('ext.meta.path')}
            onClick={() => void reveal(dir)}
          >
            <FolderOpen size={14} />
          </button>
        </span>
      ),
    });
  }

  if (rows.length === 0) return null;

  return (
    <dl className="ns-ext__meta">
      {rows.map((row) => (
        <div key={row.key} className="ns-ext__meta-row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
