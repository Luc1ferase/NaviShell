import type { JSX } from 'react';
import { Save, X } from 'lucide-react';
import type { SftpController, ViewerState } from '../store';
import type { Translate } from '../types';

interface FileEditorProps {
  viewer: ViewerState;
  controller: SftpController;
  t: Translate;
}

/**
 * Quick read/edit view for small text files, shown as a sheet over the entry list. Only
 * used when the editor plugin (`navishell.editor`) is disabled; otherwise files open there.
 */
export function FileEditor({ viewer, controller, t }: FileEditorProps): JSX.Element {
  return (
    <div className="ns-sftp-editor">
      <div className="ns-sftp-editor-head">
        <span className="ns-sftp-editor-title" title={viewer.path}>
          {t('viewer.title', { name: viewer.name })}
          {viewer.dirty ? ' *' : ''}
        </span>
        <button
          type="button"
          className="ns-sftp-icon-button ns-sftp-icon-button-small"
          title={t('viewer.save')}
          aria-label={t('viewer.save')}
          disabled={viewer.loading || viewer.saving || !viewer.dirty}
          onClick={() => void controller.saveEditor()}
        >
          <Save size={14} />
        </button>
        <button
          type="button"
          className="ns-sftp-icon-button ns-sftp-icon-button-small"
          title={t('viewer.close')}
          aria-label={t('viewer.close')}
          onClick={() => controller.closeEditor()}
        >
          <X size={14} />
        </button>
      </div>
      {viewer.loading ? (
        <div className="ns-sftp-editor-loading">{t('viewer.loading')}</div>
      ) : (
        <textarea
          className="ns-sftp-editor-area"
          spellCheck={false}
          value={viewer.content}
          aria-label={viewer.path}
          onChange={(event) => controller.editorChanged(event.target.value)}
        />
      )}
    </div>
  );
}
