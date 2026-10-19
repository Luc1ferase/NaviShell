import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyRound, ShieldAlert, TriangleAlert } from 'lucide-react';

import { useI18n } from '@/core/i18n/useI18n';
import {
  useUiStore,
  type DialogRequest,
  type HostKeyRequest,
  type PasswordRequest,
} from '@/core/stores/ui';
import type { ConfirmOptions, PromptOptions } from '@navishell/plugin-api';

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

interface DialogShellProps {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  wide?: boolean;
  onCancel: () => void;
  onSubmit?: () => void;
}

export function DialogShell({
  title,
  icon,
  children,
  actions,
  wide,
  onCancel,
  onSubmit,
}: DialogShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  return (
    <div
      className="ns-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className={`ns-dialog${wide ? ' ns-dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="ns-dialog__header">
          {icon}
          <span>{title}</span>
        </div>
        <div className="ns-dialog__body">{children}</div>
        <div className="ns-dialog__actions">{actions}</div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

function ConfirmDialog({
  options,
  settle,
}: {
  options: ConfirmOptions;
  settle: (value: boolean) => void;
}) {
  const { t } = useI18n();
  // Destructive confirmations deliberately do not accept Enter: the user has to click.
  return (
    <DialogShell
      title={options.title}
      icon={options.danger ? <TriangleAlert size={16} color="var(--ns-danger)" /> : undefined}
      onCancel={() => settle(false)}
      onSubmit={options.danger ? undefined : () => settle(true)}
      actions={
        <>
          <button
            type="button"
            className="ns-btn"
            autoFocus={options.danger}
            onClick={() => settle(false)}
          >
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type={options.danger ? 'button' : 'submit'}
            className={`ns-btn ${options.danger ? 'ns-btn--danger' : 'ns-btn--primary'}`}
            autoFocus={!options.danger}
            onClick={options.danger ? () => settle(true) : undefined}
          >
            {options.okLabel ?? t('common.ok')}
          </button>
        </>
      }
    >
      {options.message ? <p className="ns-dialog__message">{options.message}</p> : null}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function PromptDialog({
  options,
  settle,
}: {
  options: PromptOptions;
  settle: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(options.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <DialogShell
      title={options.title}
      onCancel={() => settle(null)}
      onSubmit={() => settle(value)}
      actions={
        <>
          <button type="button" className="ns-btn" onClick={() => settle(null)}>
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button type="submit" className="ns-btn ns-btn--primary">
            {options.okLabel ?? t('common.ok')}
          </button>
        </>
      }
    >
      {options.message ? <p className="ns-dialog__message">{options.message}</p> : null}
      <input
        ref={inputRef}
        className="ns-input"
        type={options.password ? 'password' : 'text'}
        placeholder={options.placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordDialog({
  options,
  settle,
}: {
  options: PasswordRequest;
  settle: (value: { password: string; savePassword: boolean } | null) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [save, setSave] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <DialogShell
      title={options.title}
      icon={<KeyRound size={16} />}
      onCancel={() => settle(null)}
      onSubmit={() => settle({ password, savePassword: save })}
      actions={
        <>
          <button type="button" className="ns-btn" onClick={() => settle(null)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="ns-btn ns-btn--primary">
            {t('dialog.password.connect')}
          </button>
        </>
      }
    >
      {options.message ? <p className="ns-dialog__message">{options.message}</p> : null}
      <input
        ref={inputRef}
        className="ns-input"
        type="password"
        autoComplete="current-password"
        placeholder={t('dialog.password.placeholder')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {options.offerSave ? (
        <label className="ns-check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          {t('dialog.password.save')}
        </label>
      ) : null}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Host key
// ---------------------------------------------------------------------------

function HostKeyDialog({
  options,
  settle,
}: {
  options: HostKeyRequest;
  settle: (value: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      wide
      title={options.title}
      icon={<ShieldAlert size={16} color="var(--ns-danger)" />}
      onCancel={() => settle(false)}
      actions={
        <>
          <button type="button" className="ns-btn" autoFocus onClick={() => settle(false)}>
            {options.cancelLabel}
          </button>
          <button type="button" className="ns-btn ns-btn--danger" onClick={() => settle(true)}>
            {options.okLabel}
          </button>
        </>
      }
    >
      <div className="ns-warning-box">
        <TriangleAlert size={16} />
        <span>{options.message}</span>
      </div>
      <div className="ns-fingerprint">
        <span className="ns-fingerprint__label">{t('dialog.hostKey.host')}</span>
        <span className="ns-fingerprint__value">{options.host}</span>
      </div>
      {options.expectedFingerprint ? (
        <div className="ns-fingerprint">
          <span className="ns-fingerprint__label">{t('dialog.hostKey.expected')}</span>
          <span className="ns-fingerprint__value">{options.expectedFingerprint}</span>
        </div>
      ) : null}
      <div className="ns-fingerprint ns-fingerprint--danger">
        <span className="ns-fingerprint__label">{t('dialog.hostKey.received')}</span>
        <span className="ns-fingerprint__value">{options.fingerprint}</span>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export function DialogHost() {
  const dialogs = useUiStore((state) => state.dialogs);
  const settleDialog = useUiStore((state) => state.settleDialog);
  const request: DialogRequest | undefined = dialogs[0];

  if (!request) return null;

  const settle = (value: unknown) => settleDialog(request.id, value);

  switch (request.kind) {
    case 'confirm':
      return <ConfirmDialog key={request.id} options={request.options} settle={settle} />;
    case 'prompt':
      return <PromptDialog key={request.id} options={request.options} settle={settle} />;
    case 'password':
      return <PasswordDialog key={request.id} options={request.options} settle={settle} />;
    case 'hostKey':
      return <HostKeyDialog key={request.id} options={request.options} settle={settle} />;
    default:
      return null;
  }
}
