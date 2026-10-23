'use client';

import { useState, useTransition } from 'react';
import { Alert, Switch } from '@thc/ui';
import { setExcludeFromInvoicing } from './actions';

/**
 * The client card's "Left out of invoicing" switch (ADR-0203).
 *
 * On: THC invoices this client outside the platform, so its events are not
 * listed on Ready to invoice, not exported and never issued as an invoice.
 * Payroll and reports are unaffected, and an event already on an invoice
 * stays as it is.
 *
 * Without the 'write' permission (a viewer, ADR-0060) the state is shown
 * as text, with no control the database would refuse.
 */
export function ExcludeFromInvoicing({
  clientId,
  excluded,
  canWrite,
}: {
  clientId: string;
  excluded: boolean;
  canWrite: boolean;
}) {
  const [checked, setChecked] = useState(excluded);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const description = checked ? (
    <>Left out — invoiced outside the platform; its events never reach Ready to invoice</>
  ) : (
    <>Included — its events are invoiced from the platform</>
  );

  if (!canWrite) return <span>{description}</span>;

  const change = (next: boolean) => {
    setError(null);
    setChecked(next);
    startSaving(async () => {
      const result = await setExcludeFromInvoicing(clientId, next);
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
