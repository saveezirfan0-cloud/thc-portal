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
export function ResendInvoice({ invoiceId, eventId }: { invoiceId: string; eventId: string }) {
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
          {busy ? 'Sending…' : 'Send again'}
        </Button>{' '}
        <span className="muted sm">to the invoice emails on the client card now</span>
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </div>
  );
}
