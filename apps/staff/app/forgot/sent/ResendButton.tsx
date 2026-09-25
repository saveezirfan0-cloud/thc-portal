'use client';

import { useActionState, useEffect, useState } from 'react';
import { Alert, Button } from '@thc/ui';
import { requestReset } from '../actions';
import { RESEND_COOLDOWN_SECONDS, formatCountdown } from './resend';

/**
 * "Didn't get it? Resend in 0:48" — A2, wireframes/staff/auth.html.
 *
 * Ghost, full width, and disabled while the countdown runs; when it reaches
 * zero the label drops the timer and a press sends the same address through
 * the same action as A1, which lands back here with a fresh cookie — so the
 * worker never retypes the address (§1.7 keeps it out of the URL). A new
 * request restarts the countdown.
 */
export function ResendButton({ to }: { to: string }) {
  const [error, formAction, pending] = useActionState(requestReset, null);
  const [left, setLeft] = useState(RESEND_COOLDOWN_SECONDS);

  // Restart the clock whenever a request finishes (and on mount, a no-op).
  useEffect(() => {
    if (!pending) setLeft(RESEND_COOLDOWN_SECONDS);
  }, [pending]);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  const waiting = left > 0;
  const label = pending
    ? 'Sending…'
    : waiting
      ? `Didn’t get it? Resend in ${formatCountdown(left)}`
      : 'Didn’t get it? Resend';

  return (
    <form action={formAction} style={{ display: 'contents' }}>
      <input type="hidden" name="email" value={to} />
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button type="submit" tone="ghost" block disabled={waiting || pending} aria-live="polite">
        {label}
      </Button>
    </form>
  );
}
