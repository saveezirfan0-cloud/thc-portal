import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, Button, GpsChip, Note, Pill } from '@thc/ui';
import { SUPPORT_EMAIL } from '@thc/domain';
import { formatDuration, formatMoney } from './earnings';
import type { Earnings } from './earnings';
import { NO_ON_SITE_FIX, checkedOutOffSiteMessage } from './messages';
import { formatDistance } from './phase';

/**
 * The shift screen's whole-screen states — `wireframes/staff/shift-detail.html`
 * (i) off-site check-out, (j) no on-site fix, (k) shift complete, (l) check-in
 * closed. The (m) buffer turn-away is `TurnedAwayScreen.tsx`, whose copy is
 * @thc/domain's.
 *
 * Each REPLACES the live screen rather than sitting on it as a one-line
 * banner: they are the moments a worker needs to read a sentence and press
 * one obvious button, not scan a screen still offering check-in. Pure
 * markup — the times arrive formatted, the decisions arrive made — so each
 * can be rendered and asserted on its own.
 */

/** (i) §5.1 — pressed away from the venue; the last on-site fix is the finish. */
export function OffSiteCheckOutScreen({
  head,
  distanceM,
  checkedIn,
  paidFrom,
  lastOnSite,
  pressedAt,
  onContinue,
}: {
  head: ReactNode;
  distanceM: number | null;
  /** Viewer-local (§1.8, an actual stamp). */
  checkedIn: string | null;
  /** The scheduled start, UK. */
  paidFrom: string;
  lastOnSite: string | null;
  pressedAt: string;
  onContinue: () => void;
}) {
  return (
    <div className="shift-full" data-full="off_site">
      {head}
      {distanceM !== null ? (
        <GpsChip inside={false}>You’re {formatDistance(distanceM)} from the venue</GpsChip>
      ) : null}
      <Alert tone="amber">
        <b>{checkedOutOffSiteMessage(lastOnSite)}</b>
      </Alert>
      <div className="kvs sum">
        {checkedIn ? (
          <div className="kv">
            <span className="k">Checked in</span>
            <span className="v">
              {checkedIn} · paid from {paidFrom}
            </span>
          </div>
        ) : null}
        {lastOnSite ? (
          <div className="kv">
            <span className="k">Last on site</span>
            <span className="v">{lastOnSite} (GPS)</span>
          </div>
        ) : null}
        <div className="kv">
          <span className="k">Pressed at</span>
          <span className="v">{pressedAt} · not used</span>
        </div>
      </div>
      <Button block size="lg" tone="primary" onClick={onContinue}>
        Continue to summary
      </Button>
    </div>
  );
}

/** (j) RULE-02 second trigger — off site, and no on-site fix after check-in. */
export function NoOnSiteFixScreen({
  head,
  distanceM,
  checkedIn,
  onOk,
}: {
  head: ReactNode;
  distanceM: number | null;
  checkedIn: string | null;
  onOk: () => void;
}) {
  return (
    <div className="shift-full" data-full="no_on_site_fix">
      {head}
      {distanceM !== null ? (
        <GpsChip inside={false}>You’re {formatDistance(distanceM)} from the venue</GpsChip>
      ) : null}
      <Alert tone="coral">
        <b>{NO_ON_SITE_FIX}</b>
      </Alert>
      <p className="xs muted">
        {checkedIn ? `Your check-in at ${checkedIn} was recorded on site, but` : 'We'} have no
        location after it. Rather than record a zero-length shift, the office will enter your real
        finish time.
      </p>
      <Button block size="lg" tone="primary" onClick={onOk}>
        OK, I understand
      </Button>
    </div>
  );
}

/** (k) §5.1 — the check-out confirmation, base rate only (§9.8). */
export function ShiftCompleteScreen({
  firstName,
  checkedOutAt,
  window,
  earnings,
}: {
  firstName: string | null;
  /** Viewer-local (§1.8). */
  checkedOutAt: string;
  /** "17:00 – 23:30" UK. */
  window: string;
  earnings: Earnings;
}) {
  return (
    <div className="shift-full" data-full="complete">
      <div className="static-screen">
        <Pill tone="green" large>
          Checked out · {checkedOutAt}
        </Pill>
        <h2>Shift complete — thank you{firstName ? `, ${firstName}` : ''}</h2>
      </div>
      <div className="kvs sum">
        <div className="kv">
          <span className="k">Worked</span>
          <span className="v">
            {window} · {formatDuration(earnings.workedMin + earnings.unpaidBreakMin)}
          </span>
        </div>
        {earnings.unpaidBreakMin > 0 ? (
          <div className="kv">
            <span className="k">Unpaid break</span>
            <span className="v">− {formatDuration(earnings.unpaidBreakMin)}</span>
          </div>
        ) : null}
        <div className="kv">
          <span className="k">Payable</span>
          <span className="v">{formatDuration(earnings.payableMin)}</span>
        </div>
        <div className="kv">
          <span className="k">Hourly rate</span>
          <span className="v">{formatMoney(earnings.hourlyRatePence)} / h</span>
        </div>
      </div>
      {earnings.floorApplied ? (
        <Note>Short shifts are paid a four-hour minimum, so that is what this comes to.</Note>
      ) : null}
      <div className="tblock earn-total">
        <span className="lab">Total earnings for this shift</span>
        <span className="earn">{formatMoney(earnings.totalPence)}</span>
        <span className="xs muted">before tax · base rate only</span>
      </div>
      <p className="sm muted center-note">
        Your hours are sent to the office as a timesheet. You’re paid the Friday after the week you
        worked.
      </p>
      <Link className="btn primary block lg" href="/shifts">
        Done
      </Link>
    </div>
  );
}

/** (l) §5.1 — check-in locked: an automatic No-show. */
export function NotAttendedScreen({
  head,
  gps,
  lockedAt,
  confirmedAfterStart,
}: {
  head: ReactNode;
  gps: ReactNode;
  /** The lock time, already labelled "(UK)". */
  lockedAt: ReactNode;
  /** §3.4: booked after the start, so the lock was the END, not start+30. */
  confirmedAfterStart: boolean;
}) {
  return (
    <div className="shift-full" data-full="not_attended">
      {head}
      {gps}
      <Button block size="lg" tone="primary" disabled>
        Check-in closed
      </Button>
      <Alert tone="coral">
        <b>You’ve been marked as not attended — contact the office.</b>
        <br />
        <span className="xs">
          {confirmedAfterStart ? (
            <>Check-in closed at {lockedAt}, when your shift ended.</>
          ) : (
            <>Check-in closed at {lockedAt}, 30 minutes after your start time.</>
          )}{' '}
          If you’re on site, a manager can register your arrival: {SUPPORT_EMAIL}
        </span>
      </Alert>
    </div>
  );
}
