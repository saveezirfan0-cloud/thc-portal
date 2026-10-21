'use client';

import { useState, useTransition } from 'react';
import { Alert, Button } from '@thc/ui';
import { formatDateAdded } from '../../_lib/addedBy';
import { archiveClient, restoreClient } from './actions';

/**
 * The client card's Archive / Restore control (ADR-0185).
 *
 * Archiving takes a client off the active Clients list and out of the Shift
 * Builder's picker. It removes nothing — the rate card, qualified staff,
 * events, invoices and History all stay, and Restore undoes it — which is
 * why it does not break §9.7's "no Delete".
 *
 * A client with an event today or later cannot be archived: the button says
 * so instead of offering something the database would refuse. Without the
 * 'write' permission (a viewer, ADR-0060) the state is shown, with no
 * control.
 */
export function ArchiveClient({
  clientId,
  name,
  archivedAt,
  upcoming,
  canWrite,
}: {
  clientId: string;
  name: string;
  /** `clients.archived_at`; null while the client is live. */
  archivedAt: string | null;
  /** Events today or later that are not cancelled. */
  upcoming: number;
  canWrite: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const run = (action: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setError(null);
    startSaving(async () => {
      const result = await action(clientId);
      if (result.ok) setConfirming(false);
      else setError(result.message);
    });
  };

  if (archivedAt !== null) {
    return (
      <div className="stack tight">
        <Alert tone="amber">
          <b>Archived on {formatDateAdded(archivedAt)}.</b> {name} is hidden from the Clients list
          and cannot be picked for a new event. Its events, rate card and invoices are untouched.
          {canWrite ? (
            <>
              {' '}
              <Button size="sm" onClick={() => run(restoreClient)} disabled={saving}>
                Restore client
              </Button>
            </>
          ) : null}
        </Alert>
        {error ? <Alert tone="coral">{error}</Alert> : null}
      </div>
    );
  }

  if (!canWrite) return null;

  if (upcoming > 0) {
    return (
      <span className="muted xs">
        Can&rsquo;t be archived yet — {upcoming} {upcoming === 1 ? 'event' : 'events'} today or
        later. Finish or cancel {upcoming === 1 ? 'it' : 'them'} first.
      </span>
    );
  }

  return (
    <span className="stack tight">
      {confirming ? (
        <span className="row wrap">
          <span className="sm">
            Archive {name}? It leaves the active Clients list and the Shift Builder. Nothing is
            deleted, and you can restore it.
          </span>
          <Button size="sm" tone="danger" onClick={() => run(archiveClient)} disabled={saving}>
            Archive
          </Button>
          <Button size="sm" tone="ghost" onClick={() => setConfirming(false)} disabled={saving}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button size="sm" tone="ghost" onClick={() => setConfirming(true)}>
          Archive client
        </Button>
      )}
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </span>
  );
}
