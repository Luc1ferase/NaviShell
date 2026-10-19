import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Shown with the error message, e.g. the plugin or panel id. */
  label: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

/** Keeps a broken plugin component from taking the whole window down. */
export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[navishell] ${this.props.label} crashed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="ns-placeholder">
        <strong>{this.props.label}</strong>
        <span className="ns-mono">{this.state.message}</span>
      </div>
    );
  }
}
