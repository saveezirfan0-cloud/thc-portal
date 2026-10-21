'use client';

import { useState, useTransition } from 'react';
import { Alert, Switch } from '@thc/ui';
import { setClientOneOff } from './actions';

/**
 * The client card's One-off client switch (ADR-0186).
 *
 * On: this client is not expected to order again (a private event). The
 * pickers the office clears workers from — the candidate's Client
 * qualification panel and the profile's "+ Add client" — stop leading with
 * it, and the Clients directory files it under One-off. It gates nothing:
 * an event can still be built for it, its qualified staff stay qualified
 * and auto-assign ignores the flag.
 *
 * Without the 'write' permission (a viewer, ADR-0060) the state is shown
 * as text, with no control the database would refuse.
 */
export function OneOffClient({
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
    <>On — not expected to order again; left out of the lists workers are qualified from</>
  ) : (
    <>Off — a regular client</>
  );

  if (!canWrite) return <span>{description}</span>;

  const change = (next: boolean) => {
    setError(null);
    setChecked(next);
    startSaving(async () => {
      const result = await setClientOneOff(clientId, next);
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
