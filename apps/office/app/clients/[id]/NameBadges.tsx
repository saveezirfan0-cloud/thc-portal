'use client';

import { useState, useTransition } from 'react';
import { Alert, Switch } from '@thc/ui';
import { setNameBadges } from './actions';

/**
 * The client card's Name badges switch (ADR-0081).
 *
 * On: every Allocation Timesheet for this client goes with a second PDF —
 * a THC name badge for each person on it, the THC logo at the top and the
 * first name under it, ten to an A4 page — for the client to print, cut
 * out and put in its own badge holders. Both the event page's Send and the
 * automatic send the day before carry it. The Completed Allocation
 * Timesheet never does: it goes after the event.
 *
 * Without the 'write' permission (a viewer, ADR-0060) the state is shown
 * as text, with no control the database would refuse.
 */
export function NameBadges({
  clientId,
  on,
  canWrite,
}: {
  clientId: string;
  on: boolean;
  canWrite: boolean;
}) {
  const [checked, setChecked] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const description = checked ? (
    <>
      On — the Allocation Timesheet email carries a THC name badge for everyone on it, to print and
      cut out
    </>
  ) : (
    <>Off — the Allocation Timesheet goes on its own</>
  );

  if (!canWrite) return <span>{description}</span>;

  const change = (next: boolean) => {
    setError(null);
    setChecked(next);
    startSaving(async () => {
      const result = await setNameBadges(clientId, next);
      if (!result.ok) {
        setChecked(!next);
        setError(result.message);
      }
    });
  };

  return (
    <span className="stack tight">
      <Switch checked={checked} onChange={change} disabled={saving} label={description} />
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </span>
  );
}
