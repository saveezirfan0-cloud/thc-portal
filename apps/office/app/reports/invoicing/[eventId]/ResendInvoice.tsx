'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@thc/ui';
import { resendInvoice } from '../../actions';

/**
 * "Send again" (ADR-0176): the same invoice and timesheets, to the client
 * card's invoice emails as they are now — for an email that failed, or one
 * the client says never arrived. The database refuses while the last email
 * is still on its way, so a double click never sends two.
 */
export function ResendInvoice({
  invoiceId,
  eventId,
  retry = false,
}: {
  invoiceId: string;
  eventId: string;
  /** The job gave up on drawing it: the same action starts it again. */
  retry?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const result = await resendInvoice(invoiceId, eventId);
    setBusy(false);
    if ('error' in result) setError(result.error);
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div>
        <Button size="sm" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : retry ? 'Try again' : 'Send again'}
        </Button>{' '}
        <span className="muted sm">
          {retry
            ? 'the next run prepares and emails it'
            : 'to the invoice emails on the client card now'}
        </span>
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </div>
  );
}
