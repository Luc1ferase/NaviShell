import { useMemo, type JSX, type MouseEvent } from 'react';

import { renderMarkdown } from '@/core/plugins/markdown';
import { useUiStore } from '@/core/stores/ui';

import { openExternal } from './actions';

export interface MarkdownProps {
  source: string;
  /** Directory the document lives in, so relative images and links resolve. */
  baseUrl?: string;
}

/**
 * A plugin's README or changelog. The HTML comes out of the sanitizer, which strips
 * scripts, styles and anything that could reach outside the document; links are left
 * inert on purpose and opened in the system browser from here, because an in-app
 * navigation would replace the app's own document.
 */
export function Markdown({ source, baseUrl }: MarkdownProps): JSX.Element {
  const toast = useUiStore((state) => state.toast);
  const html = useMemo(() => renderMarkdown(source, baseUrl), [source, baseUrl]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    // Nothing in the app can handle a link from third-party Markdown, so every click is
    // swallowed here even when the href turns out not to be openable.
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (!/^https?:/i.test(href)) return;
    void openExternal(href, (message) => toast(message, 'error'));
  };

  return (
    <div
      className="ns-md"
      onClick={onClick}
      // Sanitized by `renderMarkdown`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
