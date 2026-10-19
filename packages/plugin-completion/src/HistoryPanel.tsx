import { useMemo, useState } from 'react';
import type { ComponentType, JSX } from 'react';
import { CornerDownLeft, Clock } from 'lucide-react';
import type { PanelProps } from '@navishell/plugin-api';
import type { CompletionController } from './store';
import { useSharedState } from './store';

/**
 * Optional bottom panel: the recorded history of the active terminal's history bucket (its
 * server, or `local` for local shells), filterable, click to put a command on the prompt
 * without executing it.
 */
export function createHistoryPanelComponent(
  controller: CompletionController,
): ComponentType<PanelProps> {
  function HistoryPanel({ ctx }: PanelProps): JSX.Element {
    const shared = useSharedState(controller);
    const [filter, setFilter] = useState('');
    const history = controller.historyFor(shared.activeHistoryKey);
    const needle = filter.trim().toLowerCase();
    const visible = useMemo(
      () =>
        needle === ''
          ? history.slice(0, 500)
          : history.filter((command) => command.toLowerCase().includes(needle)).slice(0, 500),
      [history, needle],
    );

    return (
      <div className="ns-completion-panel">
        <div className="ns-completion-panel-head">
          <input
            className="ns-completion-filter"
            value={filter}
            spellCheck={false}
            placeholder={ctx.i18n.t('history.filter')}
            aria-label={ctx.i18n.t('history.filter')}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="ns-completion-panel-count">
            {ctx.i18n.t('history.count', { count: history.length })}
          </span>
        </div>
        {visible.length === 0 ? (
          <div className="ns-completion-panel-empty">
            <Clock size={22} />
            <span>{ctx.i18n.t('history.empty')}</span>
          </div>
        ) : (
          <div className="ns-completion-panel-list">
            {visible.map((command, index) => (
              <button
                type="button"
                key={`${index}:${command}`}
                className="ns-completion-panel-row"
                title={ctx.i18n.t('history.insert')}
                onClick={() => void controller.insertIntoActive(command)}
              >
                <CornerDownLeft size={12} className="ns-completion-panel-icon" />
                <span className="ns-completion-panel-command">{command}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  HistoryPanel.displayName = 'CompletionHistoryPanel';
  return HistoryPanel;
}
