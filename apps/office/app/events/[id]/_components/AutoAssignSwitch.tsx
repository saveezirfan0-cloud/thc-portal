'use client';

import { useEffect, useState, useTransition } from 'react';
import { Switch } from '@thc/ui';
import { setEventAutoAssign, setRoleAutoAssign } from '../actions';

/**
 * The auto-assign switch on the event board (§3.4) — purple, default ON,
 * at event level (no `shiftId`) and at role level.
 *
 * Optimistic: the switch moves at once and moves back, with the reason,
 * if the server refuses (not an admin, event cancelled). Turning it off
 * stops the rounds; it never withdraws an open invitation (§3.6).
 */
export function AutoAssignSwitch({
  eventId,
  shiftId,
  checked,
  disabled,
  label,
  name,
}: {
  eventId: string;
  shiftId?: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  /**
   * The accessible name, where the visible label is the same on every role
   * ("Auto-assign") — "Auto-assign · Waiting Staff" tells a screen reader
   * which of the board's switches it is on.
   */
  name?: string;
}) {
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The server's word wins once it arrives: cancelling the event turns
  // auto-assign off in the database, and the switch kept showing ON until
  // a reload (release audit 14.10.2026) because `on` only ever read
  // `checked` once.
  useEffect(() => {
    setOn(checked);
  }, [checked]);

  const change = (next: boolean) => {
    setError(null);
    setOn(next);
    startTransition(async () => {
      const result = shiftId
        ? await setRoleAutoAssign(eventId, shiftId, next)
        : await setEventAutoAssign(eventId, next);
      if ('error' in result) {
        setOn(!next);
        setError(result.error);
      }
    });
  };

  return (
    <span className="row" style={{ gap: 8 }}>
      <Switch
        purple
        checked={on}
        disabled={disabled || pending}
        onChange={change}
        label={label}
        {...(name ? { 'aria-label': name } : {})}
      />
      {error ? (
        <span className="error sm" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
