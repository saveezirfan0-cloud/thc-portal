'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, Panel, useVisibleInterval } from '@thc/ui';
import { retryExtraction } from '../actions';
import { extractionErrorText } from '../view-model';

/** The job could not be read. Shows why, and reads the files again on request. */
export function ErrorView({
  jobId,
  error,
  canAct,
}: {
  jobId: string;
  error: string | null;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // After Retry the status flips on the server a moment later: keep looking.
  useVisibleInterval(() => {
    if (busy) router.refresh();
  }, 2000);

  async function retry() {
    setBusy(true);
    setMessage(null);
    const result = await retryExtraction(jobId);
    if ('error' in result) {
      setBusy(false);
      setMessage(result.error);
      return;
    }
    router.refresh();
    // If the files fail again at once the page is still in error: stop waiting.
    setTimeout(() => setBusy(false), 30_000);
  }

  return (
    <Panel title="The files could not be read">
      <div className="stack">
        <Alert tone="coral">{extractionErrorText(error)}</Alert>
        <p className="sm muted">
          Retry reads the same files again. If it fails again, upload a clearer copy — a straight-on
          photo or the original spreadsheet reads best.
        </p>
        {message ? <Alert tone="coral">{message}</Alert> : null}
        <div className="row pr-actions">
          <Button tone="primary" disabled={!canAct || busy} onClick={retry}>
            {busy ? 'Reading again…' : 'Retry'}
          </Button>
          <Link className="btn" href="/invoices/process">
            Upload again
          </Link>
        </div>
      </div>
    </Panel>
  );
}
