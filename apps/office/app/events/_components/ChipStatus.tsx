import { EVENT_STATUS_LABEL, type EventStatus } from '@thc/domain';

/**
 * The status pill, small, for a calendar chip (§3.2: "the same pill appears
 * on each event's row in the List view and Calendar"). The chip's border
 * already carries the fill colour, so the pill carries the words.
 */
export function ChipStatus({ status }: { status: EventStatus }) {
  return (
    <span className={`st ${status}`} aria-label={`Status: ${EVENT_STATUS_LABEL[status]}`}>
      {EVENT_STATUS_LABEL[status]}
    </span>
  );
}
