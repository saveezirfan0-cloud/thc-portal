'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, GpsChip, MobileCard, Note, Pill, StaticScreen, Timer } from '@thc/ui';
import {
  CHECK_IN_OPENS_MIN,
  NO_CHECK_OUT_AFTER_MIN,
  STATIC_SCREEN_ACTION,
  STATIC_SCREEN_CONTACT,
  STATIC_SCREEN_COPY,
  SUPPORT_EMAIL,
  UK_ZONE,
  UK_ZONE_LABEL,
  VIEWER_ZONE_LABEL,
  addMinutes,
  canCancelShift,
  displayTimeRange,
  formatHours,
  formatTimeIn,
  needsDualZone,
  sectionHours,
  staticScreenCase,
  turnedAwayMinutes,
} from '@thc/domain';
import { ActionButton } from '../../_components/ActionButton';
import { useViewerZone } from '../../_components/useViewerZone';
import { cancelShift } from '../../actions';
import { cancelUntilLine } from '../list';
import { useGeoFix } from '../useGeoFix';
import { checkIn, checkOut, finishBreak, recordPing, startBreak } from './actions';
import type { RpcResult } from './actions';
import {
  breakMinutes,
  chargeableSeconds,
  formatClock,
  formatDuration,
  formatMoney,
  openBreakSeconds,
  shiftEarnings,
} from './earnings';
import { GeofenceMap } from './GeofenceMap';
import { MESSAGES, checkedOutOffSiteMessage } from './messages';
import { checkInWindow, distanceM, formatDistance, shiftPhase } from './phase';
import type { ShiftDetail } from './types';

/**
 * The shift screen — §10.4, §5.1, §5.2b, `wireframes/staff/shift-detail.html`.
 *
 * Every decision belongs to the database. This screen asks for a GPS fix,
 * sends it, and renders what comes back; the grace, the lock, the
 * strict-buffer turn-away and which timestamp a check-out records are all
 * server side. What it decides for itself is only what to SHOW — and the
 * distance line, which is advisory: `attempt_check_in` recomputes it
 * against the venue column, and that computation is the one that counts.
 *
 * `shift` is read straight from the prop on every render. The buttons call
 * `router.refresh()`, which re-renders the server page with the new row;
 * a copy taken into state on mount would keep showing the old one.
 */
export function ShiftScreen({
  shift,
  firstName,
}: {
  shift: ShiftDetail;
  /** For "Shift complete — thank you, Amara" (wireframe (k)). */
  firstName?: string | null;
}) {
  const router = useRouter();
  const zone = useViewerZone();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'locating' | 'sending'>('idle');
  const [pressed, setPressed] = useState<PressedOffSite | null>(null);
  const [now, setNow] = useState(() => new Date());

  const openBreak = shift.breaks.find((b) => b.endedAt === null) ?? null;
  const phase = shiftPhase({ shift, openBreak: Boolean(openBreak), now });
  const onShift = phase === 'on_shift' || phase === 'on_break';
  const staticCase = staticScreenCase(asStaffBooking(shift));

  // The clock moves the screen through its own states — the check-in window
  // opening, the grace elapsing — with no write behind them. On shift it
  // ticks by the second, because the counter does (wireframe (d)).
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), onShift ? 1_000 : 15_000);
    return () => clearInterval(timer);
  }, [onShift]);

  // A live fix while the worker is walking in (the chip goes green without a
  // reload) and for the whole shift (Option A tracking, ADR-0001).
  const { fix, gpsError, locate } = useGeoFix(phase === 'check_in' || onShift);

  // §5.1 background tracking, as far as a PWA can do it: a fix every two
  // minutes while the screen is open. Off-site check-out reads this trail,
  // so even this much is the difference between recording their real finish
  // and falling to RULE-02 (ADR-0001, docs/06 Option A).
  useEffect(() => {
    if (!onShift) return;
    let cancelled = false;
    const send = async () => {
      const f = await locate();
      if (f && !cancelled) await recordPing(shift.bookingId, f.lat, f.lng);
    };
    void send();
    const timer = setInterval(send, 120_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [locate, shift.bookingId, onShift]);

  // docs/06 Option A: keep the screen awake for the shift, and take the lock
  // back whenever the worker returns to the app.
  useWakeLock(onShift);

  const venue = { lat: shift.venueLat, lng: shift.venueLng };
  const metres = fix ? distanceM(fix, venue) : null;
  const inside = metres !== null && metres <= shift.geofenceRadiusM;
  const dual = needsDualZone(zone);
  const local = (iso: string | Date) => formatTimeIn(new Date(iso), zone);
  const uk = (iso: string | Date) => formatTimeIn(new Date(iso), UK_ZONE);
  const range = displayTimeRange(new Date(shift.startsAt), new Date(shift.endsAt), zone);
  const window_ = checkInWindow(shift.startsAt);
  const today = sameUkDay(shift.startsAt, now);
  const ended = now.getTime() >= new Date(shift.endsAt).getTime();
  const earnings = shiftEarnings(shift, now);

  /** A press: a FRESH fix at the moment of the tap, then the RPC. */
  async function press(fn: (lat: number, lng: number) => Promise<RpcResult>) {
    setError(null);
    setMessage(null);
    setBusy('locating');
    const fresh = await locate();
    if (!fresh) {
      setBusy('idle');
      return;
    }
    setBusy('sending');
    await handle(fn(fresh.lat, fresh.lng), fresh);
  }

  async function run(fn: () => Promise<RpcResult>) {
    setError(null);
    setMessage(null);
    setBusy('sending');
    await handle(fn(), null);
  }

  async function handle(call: Promise<RpcResult>, fresh: { lat: number; lng: number } | null) {
    const result = await call;
    setBusy('idle');
    if ('error' in result) {
      setError(result.error);
      return;
    }
    const key = String(result.result.messageKey ?? '');
    const recordedAt =
      typeof result.result.recordedAt === 'string' ? result.result.recordedAt : null;
    if (key === 'checked_out_off_site' || key === 'no_check_out_office_confirms') {
      // Wireframe (i)/(j): the off-site press has its own screen before the
      // summary, and it is shown from the RPC's answer, not re-derived.
      setPressed({
        kind: key === 'checked_out_off_site' ? 'off_site' : 'no_fix',
        recordedAt,
        pressedAt: new Date().toISOString(),
        metres: fresh ? distanceM(fresh, venue) : metres,
      });
    } else {
      setMessage(MESSAGES[key] ?? null);
    }
    router.refresh();
  }

  // ---- the static screens (§10.4): no map, no buttons, no breaks ----------
  if (staticCase === 'event_cancelled' || staticCase === 'withdrawn') {
    const copy = STATIC_SCREEN_COPY[staticCase];
    return (
      <StaticScreen
        title={copy.title}
        actions={
          <>
            <Pill tone="coral" large>
              {staticCase === 'event_cancelled' ? 'Cancelled' : 'Withdrawn'}
            </Pill>
            <p>
              {shift.eventTitle} · {ukDayLabel(shift.startsAt)} · {shift.venueName}
            </p>
            <p className="xs">{STATIC_SCREEN_CONTACT}</p>
            <Link href="/shifts" className="btn primary block">
              {STATIC_SCREEN_ACTION}
            </Link>
          </>
        }
      >
        {copy.body}
      </StaticScreen>
    );
  }

  if (phase === 'check_out_locked') {
    const copy = STATIC_SCREEN_COPY.no_checkout;
    return (
      <StaticScreen
        title={copy.title}
        actions={
          <>
            <Pill tone="amber" large>
              Awaiting the office
            </Pill>
            <p>
              {shift.eventTitle} · {range.primary}
              {shift.checkInAt ? ` · checked in ${local(shift.checkInAt)}` : ''}
            </p>
            <p className="xs">{STATIC_SCREEN_CONTACT}</p>
            <Link href="/shifts" className="btn primary block">
              {STATIC_SCREEN_ACTION}
            </Link>
          </>
        }
      >
        {copy.body}
      </StaticScreen>
    );
  }

  if (phase === 'turned_away') {
    const paid = shift.turnedAwayAt
      ? turnedAwayMinutes(
          { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) },
          new Date(shift.turnedAwayAt),
        ) > 0
      : false;
    return (
      <StaticScreen
        title="Thanks for coming"
        actions={
          <>
            <Pill tone="amber" large>
              Not needed today
            </Pill>
            <Link href="/shifts" className="btn primary block">
              {STATIC_SCREEN_ACTION}
            </Link>
            <Link href="/radar" className="btn ghost block">
              Open Radar
            </Link>
          </>
        }
      >
        {MESSAGES[paid ? 'turned_away_paid' : 'turned_away_unpaid']} Please check your app for other
        shifts.
      </StaticScreen>
    );
  }

  // ---- the off-site press, before the summary (wireframe (i)/(j)) ---------
  if (pressed) {
    const paidFrom = shift.checkInAt
      ? uk(effectiveStartOf(shift, shift.checkInAt))
      : uk(shift.startsAt);
    return (
      <>
        <div className="row">
          <Pill>{shift.venueName}</Pill>
          <span className="ml-auto mono sm">{range.primary}</span>
        </div>
        {pressed.metres !== null ? (
          <GpsChip inside={false}>You’re {formatDistance(pressed.metres)} from the venue</GpsChip>
        ) : null}
        {pressed.kind === 'off_site' ? (
          <>
            <Alert tone="amber">
              <b>
                {checkedOutOffSiteMessage(pressed.recordedAt ? local(pressed.recordedAt) : null)}
              </b>
            </Alert>
            <div className="kvs sum">
              <div className="kv">
                <span className="k">Checked in</span>
                <span className="v">
                  {shift.checkInAt ? local(shift.checkInAt) : '—'} · paid from {paidFrom}
                </span>
              </div>
              <div className="kv">
                <span className="k">Last on site</span>
                <span className="v">
                  {pressed.recordedAt ? local(pressed.recordedAt) : '—'} (background GPS)
                </span>
              </div>
              <div className="kv">
                <span className="k">Pressed at</span>
                <span className="v">{local(pressed.pressedAt)} · not used</span>
              </div>
            </div>
            <Button block size="lg" tone="primary" onClick={() => setPressed(null)}>
              Continue to summary
            </Button>
          </>
        ) : (
          <>
            <Alert tone="coral">
              <b>{MESSAGES.no_check_out_office_confirms}</b>
            </Alert>
            <p className="xs muted">
              Your check-in{shift.checkInAt ? ` at ${local(shift.checkInAt)}` : ''} was recorded on
              site, but we have no location after it. Rather than record a zero-length shift, the
              office will enter your real finish time.
            </p>
            <Button block size="lg" tone="primary" onClick={() => setPressed(null)}>
              {STATIC_SCREEN_ACTION}
            </Button>
          </>
        )}
      </>
    );
  }

  // ---- the check-out confirmation (wireframe (k)) --------------------------
  if (phase === 'closed') {
    return (
      <>
        <div className="static-screen head">
          <Pill tone="green" large>
            Checked out · {shift.checkOutAt ? local(shift.checkOutAt) : '—'}
          </Pill>
          <h2>Shift complete — thank you{firstName ? `, ${firstName}` : ''}</h2>
        </div>
        {earnings ? (
          <>
            <div className="kvs sum">
              <div className="kv">
                <span className="k">Worked</span>
                <span className="v">
                  {uk(earnings.paidFrom)} – {uk(earnings.paidTo)} ·{' '}
                  {formatDuration(earnings.workedMin + earnings.unpaidBreakMin)}
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
          </>
        ) : (
          <Note tone="amber">
            Your pay for this shift is confirmed by the office once your finish time is settled.
          </Note>
        )}
        <p className="sm muted center">
          Your hours are sent to the office as a timesheet. You’re paid the Friday after the week
          you worked.
        </p>
        <Link href="/shifts" className="btn primary block lg">
          Done
        </Link>
      </>
    );
  }

  // ---- the working screen -------------------------------------------------
  const mapLabel = `${shift.venueName} · geofence ${shift.geofenceRadiusM} m`;
  const showMap = phase === 'before_window' || phase === 'check_in' || (onShift && ended);

  return (
    <>
      {/* The pill row changes with the state (docs/07 vocabulary). */}
      <div className="row">
        {phase === 'on_shift' ? (
          <Pill tone="green" dot>
            Checked in
          </Pill>
        ) : phase === 'on_break' ? (
          <Pill tone="amber" dot>
            On break
          </Pill>
        ) : (
          <>
            {today ? <Pill tone="cyan">Today</Pill> : null}
            {phase === 'locked' ? (
              <Pill tone="coral">Not attended</Pill>
            ) : (
              <Pill tone="green">Confirmed</Pill>
            )}
          </>
        )}
        {onShift && ended ? (
          <Pill tone="cyan">Shift ended {uk(shift.endsAt)}</Pill>
        ) : !today || onShift ? (
          <Pill>{shift.venueName}</Pill>
        ) : null}
        <span className="ml-auto mono sm">
          {today || onShift ? range.primary : ukDayLabel(shift.startsAt)}
        </span>
      </div>
      {!today && !onShift ? (
        <div className="row">
          <span className="detail-hours">{range.primary}</span>
          <span className="ml-auto sm muted">
            {formatHours(
              sectionHours({ startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) }),
            )}{' '}
            · £{shift.payRate.toFixed(2)}/h
          </span>
        </div>
      ) : null}
      {dual && range.secondary ? <p className="xs muted">{range.secondary}</p> : null}

      {onShift ? (
        <>
          {phase === 'on_break' ? (
            <div className="tblock brk">
              <span className="lab">Break · running</span>
              <Timer>{formatClock(openBreakSeconds(shift, now))}</Timer>
              <span className="xs muted">
                Break started {openBreak ? local(openBreak.startedAt) : ''}
              </span>
            </div>
          ) : null}
          <div className={`tblock${phase === 'on_break' ? ' paused' : ''}`}>
            <span className="lab">
              {phase === 'on_break' ? 'Chargeable time · paused' : 'On shift · chargeable time'}
            </span>
            <Timer>{formatClock(chargeableSeconds(shift, now))}</Timer>
            <span className="xs muted">
              {phase === 'on_break'
                ? 'Resumes when you finish your break'
                : onShiftLine(shift, ended, local, uk)}
            </span>
          </div>
          <Note tone="cyan">
            Keep this screen open during your shift — the app can only track your location while it
            is open.
          </Note>
        </>
      ) : null}

      {!onShift ? (
        <MobileCard title="Where">
          <div className="kvs">
            <div className="kv">
              <span className="k">Venue</span>
              <span className="v">
                {shift.venueName}, {shift.venueAddress}
                <br />
                <a className="xs" href={mapsHref(shift)} target="_blank" rel="noreferrer">
                  Open in Maps ↗
                </a>
              </span>
            </div>
            {shift.dressCode ? (
              <div className="kv">
                <span className="k">Dress code</span>
                <span className="v">{shift.dressCode}</span>
              </div>
            ) : null}
            {shift.onsiteContact ? (
              <div className="kv">
                <span className="k">On-site contact</span>
                <span className="v">{shift.onsiteContact}</span>
              </div>
            ) : null}
            {shift.notes ? (
              <div className="kv">
                <span className="k">Notes</span>
                <span className="v">{shift.notes}</span>
              </div>
            ) : null}
            <div className="kv">
              <span className="k">Rate</span>
              <span className="v">£{shift.payRate.toFixed(2)} per hour · base rate</span>
            </div>
          </div>
        </MobileCard>
      ) : null}

      {showMap ? (
        <GeofenceMap venue={venue} radiusM={shift.geofenceRadiusM} fix={fix} label={mapLabel} />
      ) : null}

      {gpsError ? <Alert tone="coral">{gpsError}</Alert> : null}
      {metres !== null ? (
        <GpsChip inside={inside}>
          {inside ? (
            onShift ? (
              ended ? (
                <>
                  <b>On site</b> · {formatDistance(metres)} from the venue centre — your check-out
                  time will be recorded as now
                </>
              ) : (
                <>On site · background tracking on for the whole shift</>
              )
            ) : (
              <>
                <b>On site</b> · {formatDistance(metres)} from the venue centre
              </>
            )
          ) : onShift ? (
            <>
              <b>You’re {formatDistance(metres)} from the venue.</b> Check-out from here uses your
              last time on site.
            </>
          ) : (
            <>
              <b>You’re {formatDistance(metres)} from the venue.</b> Check-in opens within{' '}
              {shift.geofenceRadiusM} m of {shift.venueName}.
            </>
          )}
        </GpsChip>
      ) : null}

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {message ? <Alert tone="amber">{message}</Alert> : null}

      {/* ---- the buttons, one phase at a time (§5.1) ---- */}
      {phase === 'before_window' ? (
        <>
          <Button block size="lg" tone="primary" disabled>
            Check in — verify GPS
          </Button>
          <p className="xs muted">
            Check-in opens {today ? 'at' : `${ukDayLabel(shift.startsAt)} at`} {uk(window_.opens)}{' '}
            {UK_ZONE_LABEL} ({CHECK_IN_OPENS_MIN} min before start), within {shift.geofenceRadiusM}{' '}
            m of the venue.{' '}
            {shift.breaksLogged
              ? 'Breaks: unpaid by this client — the Breaks block unlocks after check-in.'
              : 'Breaks: paid by this client — nothing to log.'}
          </p>
        </>
      ) : null}

      {phase === 'check_in' ? (
        <>
          <Button
            block
            size="lg"
            tone="primary"
            disabled={!inside || busy !== 'idle'}
            onClick={() => void press((lat, lng) => checkIn(shift.bookingId, lat, lng))}
          >
            {busy === 'locating'
              ? 'Locating…'
              : busy === 'sending'
                ? 'Checking in…'
                : 'Check in — verify GPS'}
          </Button>
          <p className="xs muted">
            Check-in window {uk(window_.opens)} – {uk(window_.locks)} {UK_ZONE_LABEL}
            {dual
              ? ` (${local(window_.opens)} – ${local(window_.locks)} ${VIEWER_ZONE_LABEL})`
              : ''}
            . You’re paid from {uk(shift.startsAt)} whenever you arrive before it; after{' '}
            {uk(shift.startsAt)} you’re marked Late; at {uk(window_.locks)} check-in locks (§5.1).
          </p>
        </>
      ) : null}

      {phase === 'locked' ? (
        <>
          <Button block size="lg" tone="primary" disabled>
            Check-in closed
          </Button>
          <Alert tone="coral">
            <b>You’ve been marked as not attended — contact the office.</b>
            <br />
            <span className="xs">
              Check-in closed at {uk(window_.locks)} {UK_ZONE_LABEL}, 30 minutes after your start
              time. If you’re on site, a manager can register your arrival: {SUPPORT_EMAIL}
            </span>
          </Alert>
        </>
      ) : null}

      {/* §5.2b: the Breaks block is on the screen before check-in too, with
          Start break disabled and the hint — the worker can see the policy
          before they are on shift. Not on the No-show screen. */}
      {shift.breaksLogged && phase !== 'locked' ? (
        <BreaksBlock
          shift={shift}
          unlocked={onShift}
          onBreak={phase === 'on_break'}
          ended={ended}
          busy={busy !== 'idle'}
          onStart={() => void run(() => startBreak(shift.bookingId))}
          onFinish={() => void run(() => finishBreak(shift.bookingId))}
          formatTime={local}
        />
      ) : null}
      {!shift.breaksLogged && onShift ? (
        <div className="kvs">
          <div className="kv">
            <span className="k">Breaks</span>
            <span className="v">
              Paid by this client — take them as your manager on site directs. Nothing to log.
            </span>
          </div>
        </div>
      ) : null}

      {onShift ? (
        <>
          <Button
            block
            size="lg"
            {...(inside ? { tone: 'green' as const } : {})}
            disabled={busy !== 'idle'}
            onClick={() => void press((lat, lng) => checkOut(shift.bookingId, lat, lng))}
          >
            {busy === 'locating' ? 'Locating…' : busy === 'sending' ? 'Checking out…' : 'Check out'}
          </Button>
          <p className="xs muted center">
            Check-out works from anywhere until{' '}
            {uk(addMinutes(new Date(shift.endsAt), NO_CHECK_OUT_AFTER_MIN))} {UK_ZONE_LABEL}
            {dual
              ? ` (${local(addMinutes(new Date(shift.endsAt), NO_CHECK_OUT_AFTER_MIN))} ${VIEWER_ZONE_LABEL})`
              : ''}{' '}
            (4 h after the end) — being on site only affects the time we record.
          </p>
          {shift.onsiteContact ? (
            <div className="kvs">
              <div className="kv">
                <span className="k">On-site contact</span>
                <span className="v">{shift.onsiteContact}</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* RULE-04, as the list card has it: strictly while more than 72 h remain. */}
      {!onShift && shift.status === 'confirmed' && canCancelShift(new Date(shift.startsAt), now) ? (
        <div className="row">
          <span className="xs muted cancel-until">
            <span>{cancelUntilLine(new Date(shift.startsAt), zone).primary}</span>
            {cancelUntilLine(new Date(shift.startsAt), zone).secondary ? (
              <span className="sub">
                {cancelUntilLine(new Date(shift.startsAt), zone).secondary}
              </span>
            ) : null}
          </span>
          <span className="ml-auto">
            <ActionButton
              label="Cancel shift"
              tone="ghost"
              size="sm"
              action={cancelShift.bind(null, shift.bookingId)}
              confirm={{
                title: 'Cancel this shift?',
                body: 'We’ll offer this shift to the next person on the list. This can’t be undone. You also won’t be able to take any shift on this event again.',
                confirmLabel: 'Cancel shift',
                keepLabel: 'Keep it',
              }}
            />
          </span>
        </div>
      ) : null}
    </>
  );
}

/** The off-site check-out press, as the RPC answered it (wireframe (i)/(j)). */
interface PressedOffSite {
  kind: 'off_site' | 'no_fix';
  recordedAt: string | null;
  pressedAt: string;
  metres: number | null;
}

/**
 * The sub-line under the counter (wireframe (d)/(h)): the check-in is the
 * worker's own clock, the paid-from and scheduled end are UK (§1.8).
 */
function onShiftLine(
  shift: ShiftDetail,
  ended: boolean,
  local: (iso: string | Date) => string,
  uk: (iso: string | Date) => string,
): string {
  const checkedIn = shift.checkInAt ? `Checked in ${local(shift.checkInAt)}` : 'Checked in';
  if (ended) {
    const done = shift.breaks.filter((b) => b.endedAt !== null);
    const mins = done.reduce((t, b) => t + breakMinutes(b.startedAt, b.endedAt!), 0);
    const breaks = done.length
      ? ` · ${done.length} break${done.length === 1 ? '' : 's'} (${mins} min)`
      : '';
    return `${checkedIn}${breaks} · paid up to ${uk(shift.endsAt)} ${UK_ZONE_LABEL} — checking out within 15 min of the end doesn’t add time (RULE-01)`;
  }
  const from = shift.checkInAt ? uk(effectiveStartOf(shift, shift.checkInAt)) : uk(shift.startsAt);
  return `${checkedIn} · paid from ${from} ${UK_ZONE_LABEL} (RULE-01) · scheduled end ${uk(shift.endsAt)}`;
}

/** RULE-01: the paid start for a given check-in — early never pays early. */
function effectiveStartOf(shift: ShiftDetail, checkInAt: string): Date {
  const start = new Date(shift.startsAt);
  const at = new Date(checkInAt);
  if (at <= start) return start;
  const grace = addMinutes(start, 30);
  return at < grace ? start : at;
}

/** §5.2b. The block exists only where the client does not pay for breaks. */
function BreaksBlock({
  shift,
  unlocked,
  onBreak,
  ended,
  busy,
  onStart,
  onFinish,
  formatTime,
}: {
  shift: ShiftDetail;
  /** False before check-in: disabled, "Unlocks after check-in". */
  unlocked: boolean;
  onBreak: boolean;
  ended: boolean;
  busy: boolean;
  onStart: () => void;
  onFinish: () => void;
  formatTime: (iso: string) => string;
}) {
  const longShift =
    new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime() > 6 * 3600_000;
  const another = shift.breaks.length > 0 && !onBreak;

  return (
    <MobileCard title="Breaks" badge={<Pill>Unpaid by client</Pill>}>
      {longShift ? (
        <Alert tone="amber">
          A break will be applied to all shifts over 6 hours — please check with your Manager on
          site
        </Alert>
      ) : null}
      {!unlocked ? (
        <>
          <Button block disabled>
            Start break
          </Button>
          <p className="xs muted center">Unlocks after check-in</p>
        </>
      ) : (
        <>
          {shift.breaks.length === 0 ? null : (
            <ul className="mobile-list">
              {shift.breaks.map((b, i) => (
                <li key={b.id} className="mrow">
                  <span className="sm">Break {i + 1}</span>
                  <span className={`right mono sm${b.endedAt ? '' : ' amber'}`}>
                    {formatTime(b.startedAt)} –{' '}
                    {b.endedAt
                      ? `${formatTime(b.endedAt)} · ${breakMinutes(b.startedAt, b.endedAt)} min`
                      : 'now'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button
            block
            {...(another ? { size: 'sm' as const } : { size: 'lg' as const })}
            {...(onBreak
              ? { tone: 'primary' as const }
              : another
                ? {}
                : { tone: 'outline' as const })}
            disabled={busy}
            onClick={onBreak ? onFinish : onStart}
          >
            {onBreak
              ? 'Finish break — back to work'
              : another
                ? 'Start another break'
                : 'Start break'}
          </Button>
          {shift.breaks.length === 0 ? (
            <p className="xs muted">
              No breaks logged yet. Break time is deducted from your hours. You can take more than
              one.
            </p>
          ) : ended && !onBreak ? (
            <p className="xs muted">
              Still available until you check out, even after the scheduled end (§5.2b).
            </p>
          ) : onBreak ? (
            <p className="xs muted center">
              Breaks are shown in the Comments column of the timesheet the client signs (§11.3).
            </p>
          ) : null}
        </>
      )}
    </MobileCard>
  );
}

/**
 * docs/06 Option A: the Screen Wake Lock during an active shift, taken back
 * on every return to the tab (the browser releases it when the page hides).
 */
function useWakeLock(active: boolean) {
  const sentinel = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        sentinel.current = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (low battery, not allowed): the "keep this screen open" bar
        // is the fallback and is always shown.
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel.current?.release();
      sentinel.current = null;
    };
  }, [active]);
}

function asStaffBooking(shift: ShiftDetail) {
  return {
    status: shift.status as Parameters<typeof staticScreenCase>[0]['status'],
    startsAt: new Date(shift.startsAt),
    endsAt: new Date(shift.endsAt),
    dayBeforeConfirmedAt: null,
    onDayConfirmedAt: null,
    reconfirmRequired: false,
    cancelCause: shift.cancelCause,
    eventCancelledAt: shift.eventCancelledAt ? new Date(shift.eventCancelledAt) : null,
    noCheckoutOpen: shift.noCheckoutOpen,
  };
}

function sameUkDay(iso: string, now: Date): boolean {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: UK_ZONE });
  return fmt(new Date(iso)) === fmt(now);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 23 Sep" — the wireframe's date, in the UK calendar (§1.8). */
export function ukDayLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${MONTHS[Number(get('month')) - 1]}`;
}

/** "Open in Maps ↗" — the venue's own point when known, its address otherwise. */
function mapsHref(shift: ShiftDetail): string {
  const query =
    shift.venueLat || shift.venueLng
      ? `${shift.venueLat},${shift.venueLng}`
      : `${shift.venueName}, ${shift.venueAddress}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
