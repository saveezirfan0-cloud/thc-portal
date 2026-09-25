'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Pill, Textarea } from '@thc/ui';
import { cancelEvent } from '../actions';
import type { CancelCounts } from '../board-rules';

/**
 * Cancel event — Scope §3.3 (event-board.html:357-370).
 *
 * The reason is mandatory, the same pattern as a manual Block (§9.6). The
 * modal lists the five consequences in the wireframe's words, because four
 * of them are invisible from this screen, breaks the counts out (confirmed,
 * invited, open Radar applicants — CANCEL_NOTIFIES), and carries the
 * on-the-day edge case. The button is disabled once the event is Completed:
 * there is nothing left to cancel, and the finance views would replace
 * every actual line with scheduled hours (event-board.html:307).
 */
export function CancelEvent({
  eventId,
  title,
  dateLabel,
  counts,
  disabled,
}: {
  eventId: string;
  title: string;
  /** "Fri 19 Sep 2026". */
  dateLabel: string;
  counts: CancelCounts;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelEvent(eventId, reason);
      if ('error' in result) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <Button
        size="sm"
        tone="danger"
        disabled={disabled}
        title={disabled ? 'This event has ended' : undefined}
        onClick={() => setOpen(true)}
      >
        Cancel event
      </Button>

      <Modal
        open={open}
        title={
          <span className="row" style={{ gap: 10 }}>
            Cancel event{' '}
            <Pill tone="coral">
              {title} · {dateLabel}
            </Pill>
          </span>
        }
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Keep event
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || reason.trim().length === 0}
              onClick={submit}
            >
              {pending ? 'Cancelling…' : 'Cancel event'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <Textarea
            label={
              <>
                Reason <span className="coral">*</span>
              </>
            }
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why has the client cancelled? (mandatory, free text — same pattern as manual Block)"
            hint="Required. Shown on the event in the list and the calendar (§3.3)."
          />
          <span className="label">What happens on confirm (§3.3)</span>
          <ol className="consq">
            <li>
              The event is marked <b>Cancelled</b> — it stays in the list and calendar, greyed out
              with a Cancelled label; it is not deleted.
            </li>
            <li>
              <b>{counts.confirmed} confirmed</b>, <b>{counts.invited} invited</b> and{' '}
              <b>
                {counts.applied} open Radar {counts.applied === 1 ? 'applicant' : 'applicants'}
              </b>{' '}
              get push N12 &ldquo;This event has been cancelled&rdquo; — no manual round needed.
            </li>
            <li>
              All their bookings move to cancelled; open invitations are withdrawn; auto-assign
              stops for this event immediately.
            </li>
            <li>
              Excluded from financial reports — no margin, revenue or payroll, since no work
              happened (cancelled before the day).
            </li>
            <li>No Allocation Sheet or Timesheet is generated or sent.</li>
          </ol>
          <Alert>
            Edge case: if the client cancels <b>on the day</b> or after staff have checked in, the{' '}
            <b>scheduled</b> hours are billed to the client in full and every affected worker is
            paid their full scheduled hours — this overrides point 4.
          </Alert>
        </div>
      </Modal>
    </>
  );
}
