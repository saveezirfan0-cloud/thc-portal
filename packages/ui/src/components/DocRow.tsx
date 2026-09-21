import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type DocState = 'pending' | 'review' | 'verified' | 'rejected' | 'expired';

export interface DocRowProps {
  title: ReactNode;
  /** Secondary line: expiry, uploaded-at, extraction confidence. */
  meta?: ReactNode;
  state?: DocState;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function DocRow({ title, meta, state = 'pending', icon, actions }: DocRowProps) {
  return (
    <div className={clsx('docrow', state)}>
      {icon ? <span className="ico">{icon}</span> : null}
      <div>
        <div className="t">{title}</div>
        {meta ? <div className="m">{meta}</div> : null}
      </div>
      {actions ? <div className="right">{actions}</div> : null}
    </div>
  );
}
