import type { ComponentType, JSX, MouseEvent } from 'react';
import { BookOpen, Clock } from 'lucide-react';
import type { CursorPixelPosition, TerminalOverlayProps } from '@navishell/plugin-api';
import { computeLayout } from './engine';
import type { Suggestion } from './engine';
import type { CompletionController } from './store';
import { useTerminalState } from './store';

/** Used when the host cannot report a cursor position (e.g. the terminal is detached). */
const FALLBACK_CURSOR: CursorPixelPosition = {
  x: 0,
  y: 0,
  cellWidth: 8,
  cellHeight: 17,
  col: 0,
  row: 0,
};

function Highlighted({ suggestion }: { suggestion: Suggestion }): JSX.Element {
  const { value, matchStart, matchLength } = suggestion;
  if (matchStart < 0 || matchLength <= 0) return <>{value}</>;
  const end = matchStart + matchLength;
  return (
    <>
      {value.slice(0, matchStart)}
      <mark className="ns-completion-match">{value.slice(matchStart, end)}</mark>
      {value.slice(end)}
    </>
  );
}

export function createOverlayComponent(
  controller: CompletionController,
): ComponentType<TerminalOverlayProps> {
  function CompletionOverlay({ terminal, ctx }: TerminalOverlayProps): JSX.Element | null {
    const state = useTerminalState(controller, terminal.id);
    if (!state.visible || state.suggestions.length === 0) return null;

    const container =
      state.container.width > 0 && state.container.height > 0
        ? state.container
        : { width: 640, height: 400 };
    const layout = computeLayout(
      state.cursor ?? FALLBACK_CURSOR,
      container,
      state.suggestions.length,
    );

    const onPick = (event: MouseEvent<HTMLButtonElement>, index: number): void => {
      // Keep the terminal focused: never let the click steal it.
      event.preventDefault();
      event.stopPropagation();
      void controller.accept(terminal.id, index);
    };

    return (
      <div
        className={`ns-completion-popup${layout.flipped ? ' ns-completion-popup-above' : ''}`}
        style={{
          left: `${layout.left}px`,
          top: `${layout.top}px`,
          width: `${layout.width}px`,
          maxHeight: `${layout.maxHeight}px`,
        }}
        role="listbox"
        aria-label={ctx.i18n.t('popup.label')}
      >
        {state.suggestions.map((suggestion, index) => (
          <button
            type="button"
            key={suggestion.value}
            role="option"
            aria-selected={index === state.selected}
            className={`ns-completion-item${index === state.selected ? ' ns-completion-item-active' : ''}`}
            onMouseDown={(event) => onPick(event, index)}
            onMouseEnter={() => controller.select(terminal.id, index)}
          >
            <span className="ns-completion-source" aria-hidden="true">
              {suggestion.source === 'history' ? <Clock size={12} /> : <BookOpen size={12} />}
            </span>
            <span className="ns-completion-text">
              <Highlighted suggestion={suggestion} />
            </span>
            <span className="ns-completion-badge">
              {ctx.i18n.t(suggestion.source === 'history' ? 'badge.history' : 'badge.dict')}
            </span>
            {suggestion.description ? (
              <span className="ns-completion-description">{suggestion.description}</span>
            ) : null}
          </button>
        ))}
        <div className="ns-completion-hints">
          <span>{ctx.i18n.t('hint.navigate')}</span>
          <span>{ctx.i18n.t('hint.accept')}</span>
          <span>{ctx.i18n.t('hint.dismiss')}</span>
        </div>
      </div>
    );
  }
  CompletionOverlay.displayName = 'CompletionOverlay';
  return CompletionOverlay;
}
