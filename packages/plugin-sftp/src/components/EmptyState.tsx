import type { JSX, ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  hint?: string;
  children?: ReactNode;
}

export function EmptyState({ icon, title, hint, children }: EmptyStateProps): JSX.Element {
  return (
    <div className="ns-sftp-empty">
      <span className="ns-sftp-empty-icon">{icon}</span>
      <p className="ns-sftp-empty-title">{title}</p>
      {hint ? <p className="ns-sftp-empty-hint">{hint}</p> : null}
      {children}
    </div>
  );
}
