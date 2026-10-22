'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@thc/ui';
import { useConfirm } from '../../_components/useConfirm';
import { archiveClientRecord, restoreClientRecord } from '../actions';

/**
 * Archive / Restore on the client card (ADR-0195).
 *
 * Archiving takes nothing away (§9.7: a client is never removed): the client
 * leaves the default directory list and the Shift Builder's picker, and its
 * rate card, qualified staff, events, invoices and History stay. The database
 * refuses a client with an event today or later; the sentence says what to do.
 */
export function ArchiveClient({
  clientId,
  name,
  archivedAt,
  canWrite,
}: {
  clientId: string;
  name: string;
  archivedAt: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  if (!canWrite) return null;

  const run = (action: typeof archiveClientRecord) => {
    setError(null);
    startSaving(async () => {
      const result = await action(clientId);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <>
      {archivedAt ? (
        <Button size="sm" onClick={() => run(restoreClientRecord)} disabled={saving}>
          Restore
        </Button>
      ) : (
        <Button
          size="sm"
          tone="ghost"
          disabled={saving}
          onClick={() =>
            confirm.ask({
              title: `Archive ${name}?`,
              body: (
                <>
                  {name} stops showing in the client list and the Shift Builder. Its events, rate
                  card, qualified staff, invoices and History all stay, and Restore brings it back.
                  A client with an event today or later cannot be archived.
                </>
              ),
              confirm: 'Archive client',
              onConfirm: () => run(archiveClientRecord),
            })
          }
        >
          Archive
        </Button>
      )}
      {error ? <Alert tone="coral">{error}</Alert> : null}
      {confirm.dialog}
    </>
  );
}
