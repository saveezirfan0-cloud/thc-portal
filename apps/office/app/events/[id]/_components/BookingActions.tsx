'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Pill, Textarea } from '@thc/ui';
import { payrollWarning } from '@thc/domain';
import { ActualStamp } from '../../_components/ScheduledWindow';
import { getBack, markNoShow, withdraw } from '../actions';

type Result = { error: string } | { ok: true; warning?: string };

/**
 * Withdraw, No show and Get back — Scope §3.3.
 *
 * There is no Confirm: the worker confirms in the app. No show and Get back
 * are always confirmed in a dialog (event-board.html:386-396) that names
 * the shift, states what the press does and — where THIS booking's payroll
 * line has already gone to finance — carries the §3.3 warning, so the
 * manager knows the money will not follow. The correction happens in THC's
 * finance process, outside the app.
 */
export function BookingActions({
  eventId,
  bookingId,
  name,
  shiftLine,
  status,
  noShow,
  noShowOpen,
  checkInAt,
  checkOutAt,
  confirmed,
  payrollExported,
  withdrawable = true,
}: {
  eventId: string;
  bookingId: string;
  name: string;
  /** "Gala Dinner · Waiting Staff · Fri 19 Sep · 17:00 – 23:30 UK time". */
  shiftLine: string;
  status: string;
  noShow: boolean;
  /** §3.3: the manual button is available from the shift start for two weeks. */
  noShowOpen: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  confirmed: boolean;
  /** Per booking (§9.9): this shift's line is in an exported run. */
  payrollExported: boolean;
  /** False once the booking is `worked`: §3.6 has no edge out (canCancelBooking). */
  withdrawable?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'no_show' | 'get_back' | null>(null);
  const [note, setNote] = useState('');

  const run = (action: () => Promise<Result>) => {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setDialog(null);
      setNote('');
      if (result.warning) setWarning(result.warning);
    });
  };

  const recorded = checkInAt ? (
    <>
      <b>{status === 'worked' ? 'worked' : status}</b> (check-in <ActualStamp at={checkInAt} />
      {checkOutAt ? (
        <>
          {' '}
          · check-out <ActualStamp at={checkOutAt} />
        </>
      ) : null}
      , your time)
    </>
  ) : (
    <>
      <b>{status}</b> with no check-in
    </>
  );

  return (
    <>
      {error && dialog === null ? <span className="error sm">{error}</span> : null}
      {warning ? <span className="amber sm">{warning}</span> : null}

      {confirmed && noShow ? (
        <Button size="sm" tone="primary" disabled={pending} onClick={() => setDialog('get_back')}>
          Get back
        </Button>
      ) : null}

      {/* §3.3: "The manual button becomes available the moment the shift
          starts" — before that it is not offered, not merely refused. */}
      {confirmed && !noShow && noShowOpen ? (
        <Button
          size="sm"
          tone={payrollExported ? 'danger' : 'ghost'}
          disabled={pending}
          onClick={() => setDialog('no_show')}
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

      <Modal
        open={dialog === 'no_show'}
        title={
          <span className="row" style={{ gap: 10 }}>
            Mark as No-show? <Pill tone="coral">{name}</Pill>
          </span>
        }
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending}
              onClick={() => run(() => markNoShow(eventId, bookingId))}
            >
              {pending ? 'Marking…' : 'Mark No-show'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <div className="sm">
            {shiftLine}. {name} is currently recorded as {recorded}. Marking a No-show creates a
            Violation and applies the show-rate penalty; a No-show is paid nothing (§5.2) and the
            worker stays in Confirmed, badged, with Get back beside them (§3.3).
          </div>
          {payrollExported ? (
            <Alert tone="coral">
              <b>{payrollWarning('no_show', true)}</b>
            </Alert>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={dialog === 'get_back'}
        title={
          <span className="row" style={{ gap: 10 }}>
            Get back? <Pill tone="green">{name}</Pill>
          </span>
        }
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={pending || note.trim().length === 0}
              onClick={() => run(() => getBack(eventId, bookingId, note))}
            >
              {pending ? 'Registering…' : 'Get back'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <div className="sm">
            {shiftLine}. Registers {name}&rsquo;s arrival <b>now</b> and reclassifies the No-show to{' '}
            <b>Late</b>, with the minutes late counted from this press; the normal RULE-01
            pay-window deduction applies to that check-in time (§3.3). The Violation log entry is
            closed with your note (§9.5).
          </div>
          <Textarea
            label="Note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. arrived at the loading bay, phone had died — brought in by the supervisor"
            hint="Required — every resolution carries one (§9.5)."
          />
          {payrollExported ? (
            <Alert tone="coral">
              <b>{payrollWarning('get_back', true)}</b>
            </Alert>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
