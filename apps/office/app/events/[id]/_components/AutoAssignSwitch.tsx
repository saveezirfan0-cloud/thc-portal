'use client';

import { useState, useTransition } from 'react';
import { Switch } from '../../_components/Switch';
import { setAutoAssign } from '../actions';

/**
 * The purple Auto-assign switch on the board (§3.4; event-board.html:129,
 * 137, 244, 257) — at event level in the header and on every role,
 * through the Ongoing state. Optimistic: the track flips on the press and
 * flips back with the reason if the database refuses.
 */
export function AutoAssignSwitch({
  eventId,
  sectionId,
  checked,
  label,
  disabled,
}: {
  eventId: string;
  /** Omitted for the event-level switch. */
  sectionId?: string;
  checked: boolean;
  label: string;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setError(null);
    setOn(next);
    startTransition(async () => {
      const result = await setAutoAssign(
        eventId,
        sectionId ? { level: 'section', sectionId } : { level: 'event' },
        next,
      );
      if ('error' in result) {
        setOn(!next);
        setError(result.error);
      }
    });
  };

  return (
    <span className="row" style={{ gap: 8 }}>
      <Switch checked={on} onChange={toggle} label={label} disabled={disabled || pending} />
      {!on ? <span className="muted xs">off</span> : null}
      {error ? <span className="error xs">{error}</span> : null}
    </span>
  );
}
