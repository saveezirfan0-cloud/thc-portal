import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Right-hand controls in the panel header. */
  actions?: ReactNode;
  /** Drops the default body padding, for tables that run edge to edge. */
  flush?: boolean;
  children?: ReactNode;
}

export function Panel({ title, actions, flush, className, children, ...rest }: PanelProps) {
  return (
    <section className={clsx('panel', className)} {...rest}>
      {title || actions ? (
        <div className="panel-h">
          {title ? <h3>{title}</h3> : null}
          {actions ? <div className="right">{actions}</div> : null}
        </div>
      ) : null}
      {flush ? children : <div className="panel-b">{children}</div>}
    </section>
  );
}

export type NoteTone = 'neutral' | 'cyan' | 'green' | 'amber' | 'coral' | 'purple';

export function Note({ tone = 'neutral', children }: { tone?: NoteTone; children: ReactNode }) {
  return <div className={clsx('note', tone !== 'neutral' && tone)}>{children}</div>;
}

export function Alert({ tone = 'amber', children }: { tone?: NoteTone; children: ReactNode }) {
  return (
    <div className={clsx('alert', tone !== 'neutral' && tone)} role="status">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
