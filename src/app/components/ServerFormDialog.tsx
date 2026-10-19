import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import type { ServerRecord } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import {
  credentialExists,
  deleteCredential,
  saveServer,
  setCredential,
} from '@/core/services/servers';
import { useUiStore, type ServerFormState } from '@/core/stores/ui';
import { DialogShell } from './Dialogs';

const COLORS = [
  '#2dd4bf',
  '#58a6ff',
  '#bc8cff',
  '#f87171',
  '#e3b341',
  '#4ac98a',
  '#fb923c',
  '#94a3b8',
];

interface FormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  group: string;
  color: string;
  password: string;
  savePassword: boolean;
}

function initialValues(state: ServerFormState): FormValues {
  const source = state.server ?? state.draft;
  return {
    name: source?.name ?? '',
    host: source?.host ?? '',
    port: String(source?.port ?? 22),
    username: source?.username ?? '',
    group: source?.group ?? '',
    color: source?.color ?? '',
    password: '',
    savePassword: true,
  };
}

function ServerForm({ state }: { state: ServerFormState }) {
  const { t } = useI18n();
  const close = useUiStore((store) => store.closeServerForm);
  const toast = useUiStore((store) => store.toast);
  const [values, setValues] = useState<FormValues>(() => initialValues(state));
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const editing: ServerRecord | undefined = state.server;

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void credentialExists(editing.id)
      .then((exists) => {
        if (!cancelled) setHasStoredPassword(exists);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [editing]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const canSubmit =
    values.name.trim().length > 0 &&
    values.host.trim().length > 0 &&
    values.username.trim().length > 0 &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const port = Number.parseInt(values.port, 10);
      const saved = await saveServer({
        id: editing?.id,
        name: values.name.trim(),
        host: values.host.trim(),
        port: Number.isFinite(port) && port > 0 ? port : 22,
        username: values.username.trim(),
        group: values.group.trim() || undefined,
        color: values.color || undefined,
        tags: editing?.tags,
        auth: { type: 'password' },
      });
      if (values.password && values.savePassword) {
        await setCredential(saved.id, values.password);
      }
      toast(t('servers.saved', { name: saved.name }), 'success');
      close();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearStoredPassword = async () => {
    if (!editing) return;
    try {
      await deleteCredential(editing.id);
      setHasStoredPassword(false);
      toast(t('servers.passwordCleared'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  return (
    <DialogShell
      wide
      title={editing ? t('servers.form.editTitle') : t('servers.form.createTitle')}
      icon={<Server size={16} />}
      onCancel={close}
      onSubmit={() => void submit()}
      actions={
        <>
          <button type="button" className="ns-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="ns-btn ns-btn--primary" disabled={!canSubmit}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="ns-field">
        <span className="ns-field__label">{t('servers.form.name')}</span>
        <input
          className="ns-input"
          autoFocus
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
        />
      </label>

      <div className="ns-field-row">
        <label className="ns-field">
          <span className="ns-field__label">{t('servers.form.host')}</span>
          <input
            className="ns-input ns-input--mono"
            value={values.host}
            onChange={(event) => set('host', event.target.value)}
          />
        </label>
        <label className="ns-field">
          <span className="ns-field__label">{t('servers.form.port')}</span>
          <input
            className="ns-input ns-input--mono"
            inputMode="numeric"
            value={values.port}
            onChange={(event) => set('port', event.target.value)}
          />
        </label>
      </div>

      <div className="ns-field-row">
        <label className="ns-field">
          <span className="ns-field__label">{t('servers.form.username')}</span>
          <input
            className="ns-input ns-input--mono"
            value={values.username}
            onChange={(event) => set('username', event.target.value)}
          />
        </label>
        <label className="ns-field">
          <span className="ns-field__label">{t('servers.form.group')}</span>
          <input
            className="ns-input"
            value={values.group}
            onChange={(event) => set('group', event.target.value)}
          />
        </label>
      </div>

      <label className="ns-field">
        <span className="ns-field__label">{t('servers.form.password')}</span>
        <input
          className="ns-input"
          type="password"
          autoComplete="new-password"
          placeholder={
            hasStoredPassword ? t('servers.form.passwordStored') : t('servers.form.passwordEmpty')
          }
          value={values.password}
          onChange={(event) => set('password', event.target.value)}
        />
        <span className="ns-field__hint">{t('servers.form.passwordHint')}</span>
      </label>

      <label className="ns-check">
        <input
          type="checkbox"
          checked={values.savePassword}
          onChange={(event) => set('savePassword', event.target.checked)}
        />
        {t('servers.form.saveToKeychain')}
      </label>

      {hasStoredPassword ? (
        <div className="ns-about-row">
          <span className="ns-badge ns-badge--accent">{t('servers.form.hasCredential')}</span>
          <button
            type="button"
            className="ns-btn ns-btn--sm ns-btn--danger"
            onClick={() => void clearStoredPassword()}
          >
            {t('servers.form.clearCredential')}
          </button>
        </div>
      ) : null}

      <div className="ns-field">
        <span className="ns-field__label">{t('servers.form.color')}</span>
        <div className="ns-color-row">
          <button
            type="button"
            className="ns-color-swatch"
            style={{ color: 'var(--ns-fg-subtle)' }}
            aria-pressed={values.color === ''}
            aria-label={t('servers.form.noColor')}
            onClick={() => set('color', '')}
          />
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="ns-color-swatch"
              style={{ color }}
              aria-pressed={values.color === color}
              aria-label={color}
              onClick={() => set('color', color)}
            />
          ))}
        </div>
      </div>
    </DialogShell>
  );
}

export function ServerFormDialog() {
  const state = useUiStore((store) => store.serverForm);
  if (!state) return null;
  return <ServerForm key={state.server?.id ?? 'new'} state={state} />;
}
