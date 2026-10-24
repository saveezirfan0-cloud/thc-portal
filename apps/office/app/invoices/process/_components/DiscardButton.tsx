'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@thc/ui';
import { discardJob } from '../actions';

/**
 * Discard a job that is waiting for review (the stale-jobs problem of the
 * old tool, audit §10.12). The database allows reviewing → complete; this
 * screen additionally refuses while approved rows would be lost.
 */
export function DiscardButton({
  jobId,
  label,
  approved,
  disabled,
}: {
  jobId: string;
  label: string;
  approved: number | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = (approved ?? 0) > 0;

  async function discard() {
    setBusy(true);
    setError(null);
    const result = await discardJob(jobId);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        tone="ghost"
        disabled={disabled}
        aria-label={`Discard ${label}`}
        title={
          blocked
            ? `${approved} approved row${approved === 1 ? '' : 's'} — open the job to invoice or reject them first`
            : 'Discard this job'
        }
        onClick={() => setOpen(true)}
      >
        Discard
      </Button>
      {open ? (
        <Modal
          open
          title="Discard this job?"
          onClose={() => setOpen(false)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Keep it
              </Button>
              <Button tone="danger" solid onClick={discard} disabled={busy || blocked}>
                {busy ? 'Discarding…' : 'Discard job'}
              </Button>
            </>
          }
        >
          <div className="stack">
            <p className="sm">
              <b>{label}</b> leaves the Needs review list. Nothing is invoiced and no invoice number
              is taken. The uploaded files are kept.
            </p>
            {blocked ? (
              <Alert tone="amber">
                {approved} approved row{approved === 1 ? '' : 's'} would be lost, so this job cannot
                be discarded. Open it and invoice the approved rows, or reject them first.
              </Alert>
            ) : (
              <p className="sm muted">
                Only a job with no approved or invoiced rows can be discarded.
              </p>
            )}
            {error ? <Alert tone="coral">{error}</Alert> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
