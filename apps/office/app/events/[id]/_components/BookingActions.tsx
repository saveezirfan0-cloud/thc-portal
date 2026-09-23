'use client';

import { useState, useTransition } from 'react';
import { Button } from '@thc/ui';
import { payrollWarning } from '@thc/domain';
import { getBack, markNoShow, withdraw } from '../actions';

/**
 * Withdraw, No show and Get back — Scope §3.3.
 *
 * There is no Confirm: the worker confirms in the app. Where the shift's
 * payroll has already been exported, the warning is shown BEFORE the press
 * rather than after, because the scope's point is that the manager should
 * know the money will not follow — the correction happens in THC's finance
 * process, outside the app.
 */
export function BookingActions({
  eventId,
  bookingId,
  noShow,
  confirmed,
  payrollExported,
  withdrawable = true,
}: {
  eventId: string;
  bookingId: string;
  noShow: boolean;
  confirmed: boolean;
  payrollExported: boolean;
  /** False once the booking is `worked`: §3.6 has no edge out (canCancelBooking). */
  withdrawable?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ error: string } | { ok: true; warning?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result) setError(result.error);
    });
  };

  const confirmThen = (
    message: string | null,
    action: () => Promise<{ error: string } | { ok: true; warning?: string }>,
  ) => {
    if (message && !window.confirm(message)) return;
    run(action);
  };

  return (
    <>
      {error ? <span className="error sm">{error}</span> : null}

      {confirmed && noShow ? (
        <Button
          size="sm"
          tone="outline"
          disabled={pending}
          onClick={() =>
            confirmThen(payrollWarning('get_back', payrollExported), () =>
              getBack(eventId, bookingId),
            )
          }
        >
          Get back
        </Button>
      ) : null}

      {confirmed && !noShow ? (
        <Button
          size="sm"
          tone="ghost"
          disabled={pending}
          onClick={() =>
            confirmThen(payrollWarning('no_show', payrollExported), () =>
              markNoShow(eventId, bookingId),
            )
          }
        >
          No show
        </Button>
      ) : null}

      {withdrawable ? (
        <Button
          size="sm"
          tone="ghost"
          disabled={pending}
          onClick={() => run(() => withdraw(eventId, bookingId, confirmed))}
        >
          {confirmed ? 'Withdraw' : 'Withdraw invite'}
        </Button>
      ) : null}
    </>
  );
}
