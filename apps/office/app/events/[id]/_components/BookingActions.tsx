'use client';

import { useState, useTransition } from 'react';
import { Button } from '@thc/ui';
import { payrollWarning } from '@thc/domain';
import { declineCover, getBack, markNoShow, openOfferToPool, withdraw } from '../actions';
import { type BoardOffer, DECLINE_COVER_PROMPT, OPEN_TO_POOL_CONFIRM } from '../board-model';

/**
 * Withdraw, No show and Get back — Scope §3.3. And, on a worker's cover
 * request (ADR-0039), Open to pool and Decline; covering the shift by hand
 * is the ordinary Withdraw, which lapses the request with the booking.
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
  offer = null,
}: {
  eventId: string;
  bookingId: string;
  noShow: boolean;
  confirmed: boolean;
  payrollExported: boolean;
  /** False once the booking is `worked`: §3.6 has no edge out (canCancelBooking). */
  withdrawable?: boolean;
  /** ADR-0039: the booking's open offer; a cover request gets two buttons. */
  offer?: BoardOffer | null;
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

      {offer?.mode === 'office' ? (
        <>
          <Button
            size="sm"
            tone="outline"
            disabled={pending}
            onClick={() =>
              confirmThen(OPEN_TO_POOL_CONFIRM, () => openOfferToPool(eventId, offer.offerId))
            }
          >
            Open to pool
          </Button>
          <Button
            size="sm"
            tone="ghost"
            disabled={pending}
            onClick={() => {
              const note = window.prompt(DECLINE_COVER_PROMPT, '');
              if (note === null) return;
              run(() => declineCover(eventId, offer.offerId, note));
            }}
          >
            Decline
          </Button>
        </>
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
