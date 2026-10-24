'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, toast } from '@thc/ui';
import { retryXero } from '../_lib/actions';

/** "Try again" on a Xero row that failed or does not match (`xero_retry`). */
export function XeroRetry({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="stack tight">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await retryXero(invoiceId);
            if (!result.ok) setError(result.message);
            else {
              toast(result.message ?? 'Queued for Xero again.', { tone: 'cyan' });
              router.refresh();
            }
          })
        }
      >
        {pending ? 'Queuing…' : 'Try again'}
      </Button>
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </span>
  );
}
