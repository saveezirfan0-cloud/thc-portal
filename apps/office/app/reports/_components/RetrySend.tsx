'use client';

import { useState, useTransition } from 'react';
import { Button } from '@thc/ui';
import { retryFinanceSend } from '../actions';

/** The wireframe's "Retry send" on a failed Monday run (§9.9 send status). */
export function RetrySend({ sendId }: { sendId: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <Button
        size="sm"
        tone="danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryFinanceSend(sendId);
            setMessage('error' in result ? result.error : 'Queued again.');
          })
        }
      >
        {pending ? 'Retrying…' : 'Retry send'}
      </Button>
      {message ? <span className="muted sm">{message}</span> : null}
    </>
  );
}
