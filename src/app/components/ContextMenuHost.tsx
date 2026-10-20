import { useEffect, useLayoutEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import type { MenuItem } from '@navishell/plugin-api';

import { useUiStore } from '@/core/stores/ui';
import { Icon } from './Icon';

const MARGIN = 6;

export function ContextMenuHost() {
  const menu = useUiStore((state) => state.contextMenu);
  const hide = useUiStore((state) => state.hideContextMenu);
  const ref = useRef<HTMLDivElement | null>(null);

  // The menu is rendered hidden at the requested point, then nudged into the viewport
  // once its size is known. Writing the final position straight to the DOM keeps this a
  // one-pass layout instead of a render cascade.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!menu || !element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(menu.position.x, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(menu.position.y, window.innerHeight - height - MARGIN));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = 'visible';
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onBlur = () => hide();
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [menu, hide]);

  if (!menu) return null;

  const run = (item: MenuItem) => {
    hide();
    try {
      item.onClick?.();
    } catch (error) {
      console.error('[navishell] context menu action failed', error);
    }
  };

  return (
    <div
      ref={ref}
      className="ns-menu"
      role="menu"
      style={{ left: menu.position.x, top: menu.position.y, visibility: 'hidden' }}
    >
      {menu.items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="ns-menu__separator" role="separator" />
        ) : (
          <button
            key={item.id ?? `${item.label}-${index}`}
            type="button"
            role="menuitem"
            className={`ns-menu__item${item.danger ? ' ns-menu__item--danger' : ''}`}
            disabled={item.disabled}
            onClick={() => run(item)}
          >
            <Icon name={item.icon} size={14} />
            <span className="ns-menu__label">{item.label}</span>
            {item.checked ? (
              <Check size={12} className="ns-menu__check" aria-hidden="true" />
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
