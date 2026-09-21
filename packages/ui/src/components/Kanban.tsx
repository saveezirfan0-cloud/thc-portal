import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * The onboarding pipeline (§2.2): six equal columns, Interview requested →
 * Interview completed → Documents → Quiz → Additional info → Contract. The
 * column header is a label and a count over a 2px rule, accent on the first
 * column and the divider colour on the rest.
 */
export function Kanban({ children }: { children: ReactNode }) {
  return <div className="kanban">{children}</div>;
}

export function KanbanColumn({
  title,
  count,
  accent,
  children,
}: {
  title: ReactNode;
  count?: number;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={clsx('kcol', accent && 'accent')}>
      <header className="kh">
        <span className="t">{title}</span>
        {count !== undefined ? <span className="n">{count}</span> : null}
      </header>
      <div className="kb">{children}</div>
    </section>
  );
}

export function KanbanCard({
  onOpen,
  /** §2.12 duplicate check: matches an existing record, flagged in purple. */
  returning,
  children,
}: {
  onOpen?: () => void;
  returning?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx('kcard', returning && 'returning')}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      {children}
    </div>
  );
}
