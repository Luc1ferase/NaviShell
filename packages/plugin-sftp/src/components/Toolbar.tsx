import { useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  House,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { SftpController, SftpState } from '../store';
import type { Translate } from '../types';

interface PathInputProps {
  /** Current remote path; used as the initial value (the panel re-keys on change). */
  path: string;
  disabled: boolean;
  placeholder: string;
  onSubmit: (value: string) => void;
}

/**
 * Editable path box. It is remounted (via `key`) whenever the panel navigates, which keeps
 * the draft value local without having to sync state in an effect.
 */
function PathInput({ path, disabled, placeholder, onSubmit }: PathInputProps): JSX.Element {
  const [value, setValue] = useState(path);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit(value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setValue(path);
      event.currentTarget.blur();
    }
  };
  return (
    <input
      className="ns-sftp-path"
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={value}
      aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

interface ToolbarProps {
  state: SftpState;
  controller: SftpController;
  t: Translate;
}

export function Toolbar({ state, controller, t }: ToolbarProps): JSX.Element {
  const disabled = state.connectionId === null;
  return (
    <div className="ns-sftp-toolbar">
      <div className="ns-sftp-toolbar-row">
        <button
          type="button"
          className="ns-sftp-icon-button"
          title={t('toolbar.back')}
          aria-label={t('toolbar.back')}
          disabled={disabled || !state.canGoBack}
          onClick={() => void controller.goBack()}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className="ns-sftp-icon-button"
          title={t('toolbar.up')}
          aria-label={t('toolbar.up')}
          disabled={disabled || state.path === '/'}
          onClick={() => void controller.goUp()}
        >
          <ArrowUp size={15} />
        </button>
        <button
          type="button"
          className="ns-sftp-icon-button"
          title={t('toolbar.home')}
          aria-label={t('toolbar.home')}
          disabled={disabled}
          onClick={() => void controller.goHome()}
        >
          <House size={15} />
        </button>
        <button
          type="button"
          className="ns-sftp-icon-button"
          title={t('toolbar.refresh')}
          aria-label={t('toolbar.refresh')}
          disabled={disabled}
          onClick={() => void controller.refresh()}
        >
          <RefreshCw size={15} className={state.loading ? 'ns-sftp-spin' : undefined} />
        </button>
        <PathInput
          key={state.path}
          path={state.path}
          disabled={disabled}
          placeholder={t('toolbar.path')}
          onSubmit={(value) => void controller.navigate(value)}
        />
      </div>
      <div className="ns-sftp-toolbar-row">
        <button
          type="button"
          className="ns-sftp-icon-button"
          title={t('toolbar.newFolder')}
          aria-label={t('toolbar.newFolder')}
          disabled={disabled}
          onClick={() => void controller.createFolder()}
        >
          <FolderPlus size={15} />
        </button>
        <button
          type="button"
          className="ns-sftp-icon-button"
          title={t('toolbar.upload')}
          aria-label={t('toolbar.upload')}
          disabled={disabled}
          onClick={() => void controller.upload()}
        >
          <Upload size={15} />
        </button>
        <button
          type="button"
          className={`ns-sftp-icon-button${state.showHidden ? ' ns-sftp-icon-button-on' : ''}`}
          title={t(state.showHidden ? 'toolbar.hideHidden' : 'toolbar.showHidden')}
          aria-label={t(state.showHidden ? 'toolbar.hideHidden' : 'toolbar.showHidden')}
          aria-pressed={state.showHidden}
          disabled={disabled}
          onClick={() => void controller.toggleHidden()}
        >
          {state.showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        {state.boundToTerminal ? (
          <span className="ns-sftp-hint" title={t('state.boundToTerminal')}>
            {t('state.boundToTerminal')}
          </span>
        ) : (
          <select
            className="ns-sftp-select"
            aria-label={t('toolbar.connection')}
            value={state.connectionId ?? ''}
            disabled={state.connections.length === 0}
            onChange={(event) => controller.selectConnection(event.target.value)}
          >
            {state.connections.length === 0 ? (
              <option value="">{t('state.noConnections')}</option>
            ) : null}
            {state.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.username}@{connection.host}:{connection.port}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
