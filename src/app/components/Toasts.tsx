import { X } from 'lucide-react';

import { useI18n } from '@/core/i18n/useI18n';
import { useUiStore } from '@/core/stores/ui';
import { Icon } from './Icon';

const TOAST_ICON = {
  info: 'Info',
  success: 'CircleCheck',
  warning: 'TriangleAlert',
  error: 'CircleAlert',
} as const;

export function Toasts() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);
  const { t } = useI18n();

  if (toasts.length === 0) return null;

  return (
    <div className="ns-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const action = toast.action;
        return (
          <div key={toast.id} className={`ns-toast ns-toast--${toast.kind}`}>
            <Icon name={TOAST_ICON[toast.kind]} size={15} />
            <span className="ns-toast__message">{toast.message}</span>
            {action ? (
              <button
                type="button"
                className="ns-btn ns-btn--sm ns-toast__action"
                onClick={() => {
                  dismiss(toast.id);
                  action.run();
                }}
              >
                {action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="ns-btn ns-btn--icon ns-btn--sm"
              aria-label={t('common.dismiss')}
              onClick={() => dismiss(toast.id)}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
