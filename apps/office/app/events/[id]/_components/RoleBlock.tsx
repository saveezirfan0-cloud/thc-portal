'use client';

import { type ReactNode, useId, useState } from 'react';

/**
 * One role block on the event board, collapsed and expanded by its heading
 * (§3.3: "A block per role (clicking the heading collapses it)").
 *
 * The heading is a real button — keyboard and screen reader reach it — and
 * the controls on the right (the auto-assign switch, the pills) sit outside
 * it, so pressing the switch never folds the block. A block whose own window
 * is over starts collapsed, as the wireframe draws "window ended ·
 * collapsed"; the manager opens it with one click.
 */
export function RoleBlock({
  defaultOpen,
  heading,
  actions,
  children,
}: {
  defaultOpen: boolean;
  heading: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="panel role-block">
      <div className="panel-h">
        <h3 className="rsh-h">
          <button
            type="button"
            className="rsh-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((was) => !was)}
          >
            <span className="car" aria-hidden="true" />
            {heading}
          </button>
        </h3>
        {actions ? <div className="right">{actions}</div> : null}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
