'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Textarea } from '@thc/ui';
import { payrollWarning } from '@thc/domain';
import { declineCover, getBack, markNoShow, openOfferToPool, withdraw } from '../actions';
import {
  type BoardOffer,
  DECLINE_COVER_PROMPT,
  DECLINE_NOTE_MAX,
  OPEN_TO_POOL_CONFIRM,
  declineNoteCounter,
} from '../board-model';

type Result = { error: string } | { ok: true; warning?: string };

interface Pending {
  title: string;
  warning: string;
  confirmLabel: string;
  action: () => Promise<Result>;
}

/**
 * Withdraw, No show and Get back — Scope §3.3. And, on a worker's cover
 * request (ADR-0045), Open to pool and Decline; covering the shift by hand
 * is the ordinary Withdraw, which lapses the request with the booking.
 *
 * There is no Confirm: the worker confirms in the app. Where the shift's
 * payroll has already been exported, the §3.3 warning is shown BEFORE the
 * press, in the design system's Modal (never `window.confirm`), because the
 * scope's point is that the manager should know the money will not follow
 * — the correction happens in THC's finance process, outside the app.
 *
 * "No show" is offered only from the section's start until two weeks after
 * its end (`canMarkNoShow`, §3.3) — before the start there is nothing to
 * miss. The server action refuses outside that window too.
 */
export function BookingActions({
  eventId,
  bookingId,
  noShow,
  confirmed,
  payrollExported,
  withdrawable = true,
  noShowAllowed = false,
  offer = null,
}: {
  eventId: string;
  bookingId: string;
  noShow: boolean;
  confirmed: boolean;
  payrollExported: boolean;
  /** False once the booking is `worked`: §3.6 has no edge out (canCancelBooking). */
  withdrawable?: boolean;
  /** `canMarkNoShow` for the section: from its start to two weeks after its end. */
  noShowAllowed?: boolean;
  /** ADR-0045: the booking's open offer; a cover request gets two buttons. */
  offer?: BoardOffer | null;
}) {
  const [running, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // ADR-0045 Decline: the office's own note, asked in the Modal like every
  // other question on the board (never a browser prompt).
  const [declining, setDeclining] = useState<string | null>(null);

  const run = (action: () => Promise<Result>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result) setError(result.error);
    });
  };

  const confirmThen = (
    warning: string | null,
    title: string,
    confirmLabel: string,
    action: () => Promise<Result>,
  ) => {
    if (warning) setPending({ title, warning, confirmLabel, action });
    else run(action);
  };

  return (
    <>
      {error ? (
        <span className="error sm" role="alert">
          {error}
        </span>
      ) : null}

      {confirmed && noShow ? (
        <Button
          size="sm"
          tone="outline"
          disabled={running}
          onClick={() =>
            confirmThen(payrollWarning('get_back', payrollExported), 'Get back', 'Get back', () =>
              getBack(eventId, bookingId),
            )
          }
        >
          Get back
        </Button>
      ) : null}

      {confirmed && !noShow && noShowAllowed ? (
        <Button
          size="sm"
          tone="ghost"
          disabled={running}
          onClick={() =>
            confirmThen(
              payrollWarning('no_show', payrollExported),
              'Mark as No show',
              'Mark No show',
              () => markNoShow(eventId, bookingId),
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
            disabled={running}
            onClick={() =>
              confirmThen(OPEN_TO_POOL_CONFIRM, 'Open to pool', 'Open to pool', () =>
                openOfferToPool(eventId, offer.offerId),
              )
            }
          >
            Open to pool
          </Button>
          <Button size="sm" tone="ghost" disabled={running} onClick={() => setDeclining('')}>
            Decline
          </Button>
        </>
      ) : null}

      {withdrawable ? (
        <Button
          size="sm"
          tone="ghost"
          disabled={running}
          onClick={() => run(() => withdraw(eventId, bookingId))}
        >
          {confirmed ? 'Withdraw' : 'Withdraw invite'}
        </Button>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending?.title ?? ''}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button
              tone="primary"
              disabled={running}
              onClick={() => {
                const action = pending?.action;
                setPending(null);
                if (action) run(action);
              }}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <Alert tone="amber">{pending?.warning}</Alert>
      </Modal>

      {offer?.mode === 'office' ? (
        <Modal
          open={declining !== null}
          title="Decline cover request"
          onClose={() => setDeclining(null)}
          footer={
            <>
              <Button onClick={() => setDeclining(null)}>Cancel</Button>
              <Button
                tone="primary"
                disabled={running || (declining ?? '').length > DECLINE_NOTE_MAX}
                onClick={() => {
                  const note = declining ?? '';
                  setDeclining(null);
                  run(() => declineCover(eventId, offer.offerId, note));
                }}
              >
                Decline
              </Button>
            </>
          }
        >
          <Textarea
            label={DECLINE_COVER_PROMPT}
            value={declining ?? ''}
            onChange={(event) => setDeclining(event.target.value)}
            rows={3}
            // office_decline_cover() refuses note_too_long past 300.
            maxLength={DECLINE_NOTE_MAX}
            hint={declineNoteCounter(declining ?? '')}
          />
        </Modal>
      ) : null}
    </>
  );
}
