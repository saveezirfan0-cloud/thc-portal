import Link from 'next/link';
import { Pill } from '@thc/ui';
import {
  STATIC_SCREEN_ACTION,
  STATIC_SCREEN_CONTACT_LEAD,
  STATIC_SCREEN_COPY,
  SUPPORT_EMAIL,
  UK_ZONE,
  formatDateIn,
  formatTimeIn,
} from '@thc/domain';
import type { StaticScreenCase } from '@thc/domain';
import type { ShiftDetail } from './types';

/**
 * §10.4's three dead ends, `wireframes/staff/shift-detail.html` (n1–n3).
 *
 * Instead of the shift screen, not on top of it: no map, no distance line,
 * no check-in or check-out, no breaks block. The copy is @thc/domain's
 * `STATIC_SCREEN_COPY`, confirmed with THC (01.09.2026), and not restated
 * here. Every case carries the same contact line and the one button, which
 * goes back to the list — for a cancelled event or a withdrawal that list no
 * longer has the card; for No check-out it does, until a manager resolves it.
 */
export function StaticShiftScreen({
  kind,
  shift,
  localTime,
}: {
  kind: StaticScreenCase;
  shift: Pick<ShiftDetail, 'eventTitle' | 'venueName' | 'startsAt' | 'endsAt' | 'checkInAt'>;
  /** Actual stamps are viewer-local only (§1.8). */
  localTime: (iso: string) => string;
}) {
  const copy = STATIC_SCREEN_COPY[kind];
  const uk = (iso: string) => formatTimeIn(new Date(iso), UK_ZONE);
  const day = formatDateIn(new Date(shift.startsAt), UK_ZONE, { weekday: 'short' });

  // The wireframe's summary line: enough to tell WHICH shift this was, which
  // matters most for a stale push opened days later.
  const summary =
    kind === 'no_checkout'
      ? [
          shift.eventTitle,
          `${uk(shift.startsAt)} – ${uk(shift.endsAt)} UK`,
          shift.checkInAt ? `checked in ${localTime(shift.checkInAt)}` : null,
        ]
      : kind === 'withdrawn'
        ? [shift.eventTitle, day, `${uk(shift.startsAt)} – ${uk(shift.endsAt)} UK`]
        : [shift.eventTitle, day, shift.venueName];

  return (
    <div className="static-screen" data-static={kind}>
      <Pill tone={copy.tone} large>
        {copy.badge}
      </Pill>
      <h2>{copy.title}</h2>
      {copy.body ? <p>{copy.body}</p> : null}
      <p>{summary.filter(Boolean).join(' · ')}</p>
      <p className="xs">
        {STATIC_SCREEN_CONTACT_LEAD} <b className="cyan">{SUPPORT_EMAIL}</b>
      </p>
      <Link className="btn primary block lg" href="/shifts">
        {STATIC_SCREEN_ACTION}
      </Link>
    </div>
  );
}
