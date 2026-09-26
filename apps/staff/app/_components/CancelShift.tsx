import { UK_ZONE, cancelDeadline, formatDateTimeIn } from '@thc/domain';
import { ActionButton } from './ActionButton';
import { cancelShift } from '../actions';

/**
 * "Cancel shift" — RULE-04, §10.4, `wireframes/staff/shifts.html` and
 * `shift-detail.html` (a). One implementation for the list card and the
 * shift screen, so the dialog's words cannot drift between them.
 *
 * Available strictly while more than 72 hours remain (`canCancelShift`, the
 * caller's check) and it bars the worker from this EVENT permanently — said
 * as a second sentence, after the one §10.4 fixes word for word.
 * `self_cancel_booking()` refuses a late press on its own, so this is the
 * offer, not the gate.
 */
export function CancelShift({
  bookingId,
  startsAt,
  onDone,
}: {
  bookingId: string;
  startsAt: Date;
  /** The shift screen leaves for the list: the booking is no longer theirs. */
  onDone?: string;
}) {
  return (
    <div className="row" style={{ gap: 'var(--sp-8)', alignItems: 'center' }}>
      <span className="xs muted">
        Cancel available until {formatDateTimeIn(cancelDeadline(startsAt), UK_ZONE)} (UK), 72 h
        before the start
      </span>
      <span style={{ marginLeft: 'auto' }}>
        <ActionButton
          label="Cancel shift"
          tone="ghost"
          size="sm"
          action={cancelShift.bind(null, bookingId)}
          {...(onDone ? { onDone } : {})}
          confirm={{
            title: 'Cancel this shift?',
            body: 'We’ll offer this shift to the next person on the list. This can’t be undone. You also won’t be able to take any shift on this event again.',
            confirmLabel: 'Yes, cancel shift',
            keepLabel: 'Keep my shift',
          }}
        />
      </span>
    </div>
  );
}
