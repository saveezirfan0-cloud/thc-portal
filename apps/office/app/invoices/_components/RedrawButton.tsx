'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, toast } from '@thc/ui';
import { redrawInvoice } from '../_lib/actions';

/**
 * "Re-draw" on a timesheet invoice whose PDF failed or is still drawing. The
 * number and the lines are final already; this only draws the file again.
 */
export function RedrawButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="stack tight">
      <Button
        tone="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await redrawInvoice(invoiceId);
            if (!result.ok) setError(result.message);
            else toast(result.message ?? 'Invoice drawn.', { tone: 'green' });
            router.refresh();
          })
        }
      >
        {pending ? 'Drawing…' : 'Re-draw'}
      </Button>
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </span>
  );
}
