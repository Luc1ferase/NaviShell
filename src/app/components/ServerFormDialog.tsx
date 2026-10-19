import { useEffect, useState } from 'react';
import { FolderOpen, Server } from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import type { AuthMethod, AuthMethodType, ServerRecord } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import {
  credentialExists,
  deleteCredential,
  saveServer,
  setCredential,
} from '@/core/services/servers';
import { useServersStore } from '@/core/stores/servers';
import { useSettingsStore } from '@/core/stores/settings';
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

const AUTH_TYPES: AuthMethodType[] = ['password', 'key', 'agent'];

interface FormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  group: string;
  color: string;
  authType: AuthMethodType;
  keyPath: string;
  password: string;
  savePassword: boolean;
  passphrase: string;
  savePassphrase: boolean;
  /** Empty string = direct connection. */
  jumpServerId: string;
}

function initialValues(state: ServerFormState): FormValues {
  const source = state.server ?? state.draft;
  const auth = source?.auth;
  return {
    name: source?.name ?? '',
    host: source?.host ?? '',
    port: String(source?.port ?? 22),
    username: source?.username ?? '',
    group: source?.group ?? '',
    color: source?.color ?? '',
    authType: auth?.type ?? 'password',
    keyPath: auth?.type === 'key' ? auth.keyPath : '',
    password: '',
    savePassword: true,
    passphrase: '',
    savePassphrase: true,
    jumpServerId: source?.jumpServerId ?? '',
  };
}

function ServerForm({ state }: { state: ServerFormState }) {
  const { t } = useI18n();
  const close = useUiStore((store) => store.closeServerForm);
  const toast = useUiStore((store) => store.toast);
  const servers = useServersStore((store) => store.servers);
  const platform = useSettingsStore((store) => store.appInfo?.platform);
  const [values, setValues] = useState<FormValues>(() => initialValues(state));
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [hasStoredPassphrase, setHasStoredPassphrase] = useState(false);
  const [busy, setBusy] = useState(false);

  const editing: ServerRecord | undefined = state.server;

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void credentialExists(editing.id, 'password')
      .then((exists) => {
        if (!cancelled) setHasStoredPassword(exists);
      })
      .catch(() => undefined);
    void credentialExists(editing.id, 'passphrase')
      .then((exists) => {
        if (!cancelled) setHasStoredPassphrase(exists);
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
    (values.authType !== 'key' || values.keyPath.trim().length > 0) &&
    !busy;

  const buildAuth = (): AuthMethod => {
    switch (values.authType) {
      case 'key':
        return { type: 'key', keyPath: values.keyPath.trim() };
      case 'agent':
        return { type: 'agent' };
      default:
        return { type: 'password' };
    }
  };

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
        auth: buildAuth(),
        jumpServerId: values.jumpServerId || null,
      });
      if (values.authType === 'password' && values.password && values.savePassword) {
        await setCredential(saved.id, values.password, 'password');
      }
      if (values.authType === 'key' && values.passphrase && values.savePassphrase) {
        await setCredential(saved.id, values.passphrase, 'passphrase');
      }
      toast(t('servers.saved', { name: saved.name }), 'success');
      close();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearStored = async (kind: 'password' | 'passphrase') => {
    if (!editing) return;
    try {
      await deleteCredential(editing.id, kind);
      if (kind === 'password') setHasStoredPassword(false);
      else setHasStoredPassphrase(false);
      toast(
        kind === 'password' ? t('servers.passwordCleared') : t('servers.passphraseCleared'),
        'success',
      );
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const browseKey = async () => {
    try {
      // `open` types its result from the literal option values, which a runtime-built
      // options object cannot express.
      const selection = (await openFileDialog({
        title: t('servers.form.pickKey'),
        multiple: false,
        directory: false,
      })) as string | string[] | null;
      const path = Array.isArray(selection) ? selection[0] : selection;
      if (path) set('keyPath', path);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const jumpCandidates = servers.filter((candidate) => candidate.id !== editing?.id);

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
        <span className="ns-field__label">{t('servers.form.authMethod')}</span>
        <select
          className="ns-select"
          value={values.authType}
          onChange={(event) => set('authType', event.target.value as AuthMethodType)}
        >
          {AUTH_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`servers.auth.${type}`)}
            </option>
          ))}
        </select>
      </label>

      {values.authType === 'password' ? (
        <>
          <label className="ns-field">
            <span className="ns-field__label">{t('servers.form.password')}</span>
            <input
              className="ns-input"
              type="password"
              autoComplete="new-password"
              placeholder={
                hasStoredPassword
                  ? t('servers.form.passwordStored')
                  : t('servers.form.passwordEmpty')
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
                onClick={() => void clearStored('password')}
              >
                {t('servers.form.clearCredential')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {values.authType === 'key' ? (
        <>
          <div className="ns-field">
            <span className="ns-field__label">{t('servers.form.keyPath')}</span>
            <div className="ns-input-row">
              <input
                className="ns-input ns-input--mono"
                placeholder={t('servers.form.keyPathPlaceholder')}
                value={values.keyPath}
                onChange={(event) => set('keyPath', event.target.value)}
              />
              <button type="button" className="ns-btn" onClick={() => void browseKey()}>
                <FolderOpen size={14} />
                {t('servers.form.browse')}
              </button>
            </div>
            <span className="ns-field__hint">{t('servers.form.keyPathHint')}</span>
          </div>

          <label className="ns-field">
            <span className="ns-field__label">{t('servers.form.passphrase')}</span>
            <input
              className="ns-input"
              type="password"
              autoComplete="new-password"
              placeholder={
                hasStoredPassphrase
                  ? t('servers.form.passphraseStored')
                  : t('servers.form.passphraseEmpty')
              }
              value={values.passphrase}
              onChange={(event) => set('passphrase', event.target.value)}
            />
            <span className="ns-field__hint">{t('servers.form.passphraseHint')}</span>
          </label>

          <label className="ns-check">
            <input
              type="checkbox"
              checked={values.savePassphrase}
              onChange={(event) => set('savePassphrase', event.target.checked)}
            />
            {t('servers.form.savePassphraseToKeychain')}
          </label>

          {hasStoredPassphrase ? (
            <div className="ns-about-row">
              <span className="ns-badge ns-badge--accent">{t('servers.form.hasPassphrase')}</span>
              <button
                type="button"
                className="ns-btn ns-btn--sm ns-btn--danger"
                onClick={() => void clearStored('passphrase')}
              >
                {t('servers.form.clearPassphrase')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {values.authType === 'agent' ? (
        <p className="ns-dialog__message">
          {platform === 'windows'
            ? t('servers.form.agentHintWindows')
            : t('servers.form.agentHintUnix')}
        </p>
      ) : null}

      <label className="ns-field">
        <span className="ns-field__label">{t('servers.form.jumpServer')}</span>
        <select
          className="ns-select"
          value={values.jumpServerId}
          onChange={(event) => set('jumpServerId', event.target.value)}
        >
          <option value="">{t('servers.form.jumpServerDirect')}</option>
          {jumpCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} — {candidate.username}@{candidate.host}:{candidate.port}
            </option>
          ))}
        </select>
        <span className="ns-field__hint">{t('servers.form.jumpServerHint')}</span>
      </label>

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
