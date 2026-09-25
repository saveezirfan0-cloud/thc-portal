import Link from 'next/link';
import { Pill } from '@thc/ui';
import { STATIC_SCREEN_ACTION, TURNED_AWAY_COPY, turnedAwayMessage } from '@thc/domain';

/**
 * §3.2 strict buffer policy, RULE-15 — `wireframes/staff/shift-detail.html` (m).
 *
 * Past the headcount on an event that does not pay for its buffer, the
 * check-in press is logged and turned away, and this replaces the shift:
 * no map, no check-in, no breaks. The words are @thc/domain's
 * `TURNED_AWAY_COPY`; whether the "paid for 4 hours" sentence appears is
 * `turnedAwayMessage()` over the minutes the DATABASE gave the logged
 * attempt — the RPC's reply at the moment of the press, then
 * `staff_shift_detail().turned_away_pay_min` on every visit after it.
 */
export function TurnedAwayScreen({ turnAwayPayMin }: { turnAwayPayMin: number | null }) {
  const copy = TURNED_AWAY_COPY;
  return (
    <div className="static-screen" data-static="turned_away">
      <Pill tone={copy.tone} large>
        {copy.badge}
      </Pill>
      <h2>{copy.title}</h2>
      <p>{turnedAwayMessage(turnAwayPayMin)}</p>
      <Link className="btn primary block" href="/shifts">
        {STATIC_SCREEN_ACTION}
      </Link>
      <Link className="btn ghost block" href="/radar">
        {copy.radar}
      </Link>
    </div>
  );
}
