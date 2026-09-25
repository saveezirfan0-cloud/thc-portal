'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, GpsChip, Note, Pill, Timer } from '@thc/ui';
import { UK_ZONE, canCancelShift, formatTimeIn, needsDualZone } from '@thc/domain';
import { CHECK_IN_FIX, TRACKING_FIX, getFix } from '../../../lib/geo';
import type { Fix, FixFailure, FixOptions } from '../../../lib/geo';
import { CancelShift } from '../../_components/CancelShift';
import { UkTime } from '../../_components/UkTime';
import { useViewerZone } from '../../_components/useViewerZone';
import { checkIn, checkOut, finishBreak, recordPing, startBreak } from './actions';
import type { RpcResult } from './actions';
import { formatDuration, shiftEarnings, totalBreakMinutes } from './earnings';
import {
  NoOnSiteFixScreen,
  NotAttendedScreen,
  OffSiteCheckOutScreen,
  ShiftCompleteScreen,
  TurnedAwayScreen,
} from './FullScreens';
import { messageFor } from './messages';
import {
  checkInWindow,
  checkOutLocksAt,
  distanceM,
  formatDistance,
  isStaticPhase,
  isTerminalPhase,
  shiftPhase,
  turnAwayPaid,
} from './phase';
import type { ShiftPhase } from './phase';
import { pressCheckOut } from './press';
import { ShiftMap } from './ShiftMap';
import { StaticShiftScreen } from './StaticShiftScreen';
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
 * It is the BODY only. The header, the bottom nav and the §10.1 app lock
 * are `StaffShell`'s, which the page wraps this in — so a blocked, on-hold
 * or leaver worker opening a deep link never gets this far.
 */

/** What the last check-out press came back with, until the worker moves on. */
interface CheckOutOutcome {
  key: string;
  recordedAt: string | null;
  pressedAt: string;
  distanceM: number | null;
}

export function ShiftScreen({
  shift,
  firstName = null,
  autoCheckIn = false,
}: {
  shift: ShiftDetail;
  /** "Shift complete — thank you, Amara". */
  firstName?: string | null;
  /**
   * The today card's "Check in" opened this screen (§10.4): once a fix
   * inside the geofence arrives, the check-in goes without a second press.
   */
  autoCheckIn?: boolean;
}) {
  const router = useRouter();
  // `shift` is read straight from props, not copied into state: after a
  // press, `router.refresh()` hands down the booking as the server now has
  // it, and a copy in state would keep showing the check-in button to a
  // worker who has just checked in.
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutOutcome | null>(null);
  const [now, setNow] = useState(() => new Date());
  const autoTried = useRef(false);

  // The clock moves the screen through its own states — the check-in window
  // opening, the grace elapsing — with no write behind them.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const openBreak = shift.breaks.find((b) => b.endedAt === null) ?? null;
  const phase = shiftPhase({ shift, openBreak: Boolean(openBreak), now });
  // §10.4's dead ends and the turn-away have no map and nothing to press,
  // so they do not ask for the worker's location either.
  const terminal = isTerminalPhase(phase);
  const zone = useViewerZone();
  const local = (iso: string) => formatTimeIn(new Date(iso), zone);
  const uk = (iso: string) => formatTimeIn(new Date(iso), UK_ZONE);
  const dual = needsDualZone(zone);

  const locate = useCallback(async (options: FixOptions): Promise<Fix | null> => {
    const geo = typeof navigator === 'undefined' ? null : navigator.geolocation;
    const next = await getFix(geo, options, (why) => setGpsError(gpsSentence(why)));
    if (next) {
      setFix(next);
      setGpsError(null);
    }
    return next;
  }, []);

  useEffect(() => {
    if (!terminal) void locate(TRACKING_FIX);
  }, [locate, terminal]);

  // §5.1 background tracking, as far as a PWA can do it: a fix whenever the
  // worker has the screen open during the shift. Off-site check-out reads
  // this trail, so even this much is the difference between recording their
  // real finish and falling to RULE-02 (ADR-0001, docs/06).
  useEffect(() => {
    if (terminal || !shift.checkInAt || shift.checkOutAt) return;
    let cancelled = false;
    const send = async () => {
      const f = await locate(TRACKING_FIX);
      if (f && !cancelled) await recordPing(shift.bookingId, f.lat, f.lng);
    };
    void send();
    const timer = setInterval(send, 120_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [terminal, locate, shift.bookingId, shift.checkInAt, shift.checkOutAt]);

  const venue = { lat: shift.venueLat, lng: shift.venueLng };
  const metres = fix ? distanceM(fix, venue) : null;
  const inside = metres !== null && metres <= shift.geofenceRadiusM;

  async function run(fn: () => Promise<RpcResult>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await fn();
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return null;
    }
    setMessage(messageFor(String(result.result.messageKey ?? '')));
    router.refresh();
    return result.result;
  }

  /** A reading AT the press, then the RPC with it (§5.1). */
  async function pressCheckIn() {
    setBusy(true);
    const at = await locate(CHECK_IN_FIX);
    setBusy(false);
    if (!at) return;
    await run(() => checkIn(shift.bookingId, at.lat, at.lng));
  }
  // The auto check-in below runs from an effect; it calls the latest press.
  const pressRef = useRef(pressCheckIn);
  pressRef.current = pressCheckIn;

  /**
   * Audit D14: never the fix the screen was holding. A worker who opened
   * the screen on site and pressed Check out later from the bus stop would
   * otherwise send the on-site reading and be paid to now. A fresh reading
   * (8 s, nothing cached) or no coordinates at all — with none, the server
   * records the last on-site fix from the ping trail, or raises RULE-02.
   * The button never waits longer than that on the GPS.
   */
  async function onCheckOut() {
    const pressedAt = new Date().toISOString();
    const pressed: { fix: Fix | null } = { fix: null };
    const result = await run(async () => {
      const { fix: fresh, result: answer } = await pressCheckOut(shift.bookingId, {
        locate,
        checkOut,
      });
      pressed.fix = fresh;
      return answer;
    });
    const at = pressed.fix;
    if (!result) return;
    const key = String(result['messageKey'] ?? '');
    if (key === 'checked_out_off_site' || key === 'no_check_out_office_confirms') {
      setMessage(null);
      setOutcome({
        key,
        recordedAt: typeof result['recordedAt'] === 'string' ? result['recordedAt'] : null,
        pressedAt,
        distanceM:
          typeof result['distanceM'] === 'number'
            ? Math.round(result['distanceM'])
            : at
              ? distanceM(at, venue)
              : null,
      });
    }
  }

  // The today card's "Check in": verification starts on arrival, and the
  // press goes by itself once the worker is inside the circle — once only.
  useEffect(() => {
    if (!autoCheckIn || autoTried.current || phase !== 'check_in' || !inside || busy) return;
    autoTried.current = true;
    void pressRef.current();
  }, [autoCheckIn, phase, inside, busy]);

  const window_ = checkInWindow(shift);
  const earnings = shiftEarnings(shift, now);
  const today = sameUkDay(shift.startsAt, now);

  // ---- whole screens first ---------------------------------------------
  if (isStaticPhase(phase)) {
    return <StaticShiftScreen kind={phase} shift={shift} localTime={local} />;
  }
  if (phase === 'turned_away') {
    return <TurnedAwayScreen paid={turnAwayPaid(shift)} />;
  }

  const head = (
    <HeadRow
      phase={phase}
      today={today}
      venueName={shift.venueName}
      startsAt={shift.startsAt}
      endsAt={shift.endsAt}
      uk={uk}
      local={local}
      dual={dual}
    />
  );

  if (outcome?.key === 'checked_out_off_site') {
    return (
      <OffSiteCheckOutScreen
        head={head}
        distanceM={outcome.distanceM}
        checkedIn={shift.checkInAt ? local(shift.checkInAt) : null}
        paidFrom={`${uk(shift.startsAt)} (UK)`}
        lastOnSite={outcome.recordedAt ? local(outcome.recordedAt) : null}
        pressedAt={local(outcome.pressedAt)}
        onContinue={() => setOutcome(null)}
      />
    );
  }
  if (outcome?.key === 'no_check_out_office_confirms') {
    return (
      <NoOnSiteFixScreen
        head={head}
        distanceM={outcome.distanceM}
        checkedIn={shift.checkInAt ? local(shift.checkInAt) : null}
        onOk={() => setOutcome(null)}
      />
    );
  }

  if (phase === 'closed' && shift.checkOutAt && earnings) {
    return (
      <ShiftCompleteScreen
        firstName={firstName}
        checkedOutAt={local(shift.checkOutAt)}
        window={`${uk(shift.startsAt)} – ${uk(shift.endsAt)}`}
        earnings={earnings}
      />
    );
  }

  const gps =
    metres !== null ? (
      <GpsChip inside={inside}>
        {inside ? (
          <>
            <b>On site</b> · {formatDistance(metres)} from the venue centre
          </>
        ) : (
          <>
            <b>You’re {formatDistance(metres)} from the venue.</b>{' '}
            {phase === 'on_shift' || phase === 'on_break'
              ? 'Check-out still works from anywhere.'
              : `Check-in opens within ${shift.geofenceRadiusM} m of ${shift.venueName}.`}
          </>
        )}
      </GpsChip>
    ) : null;

  if (phase === 'locked') {
    return (
      <NotAttendedScreen
        head={head}
        gps={gps}
        lockedAt={<UkTime at={window_.locks} />}
        confirmedAfterStart={window_.confirmedAfterStart}
      />
    );
  }

  const beforeCheckIn = phase === 'before_window' || phase === 'check_in';
  const cancellable =
    phase === 'before_window' &&
    shift.status === 'confirmed' &&
    canCancelShift(new Date(shift.startsAt), now);

  return (
    <>
      {head}

      <div className="kvs">
        <div className="kv">
          <span className="k">Venue</span>
          <span className="v">
            {shift.venueName}, {shift.venueAddress}
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

      <ShiftMap
        venue={venue}
        radiusM={shift.geofenceRadiusM}
        me={fix ? { lat: fix.lat, lng: fix.lng } : null}
        label={`Geofence ${shift.geofenceRadiusM} m`}
        tall={phase !== 'before_window'}
      />

      {gpsError ? <Alert tone="coral">{gpsError}</Alert> : null}
      {gps}

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {message ? <Alert tone="amber">{message}</Alert> : null}

      {/* ---- the buttons, one phase at a time (§5.1) ---- */}
      {phase === 'before_window' ? (
        <>
          <Button block size="lg" tone="primary" disabled>
            Check in — verify GPS
          </Button>
          <p className="xs muted">
            Check-in opens {today ? '' : `${ukDay(window_.opens)} `}at <UkTime at={window_.opens} />
            , 30 min before the start, within {shift.geofenceRadiusM} m of the venue.
          </p>
        </>
      ) : null}

      {phase === 'check_in' ? (
        <>
          <Button
            block
            size="lg"
            tone="primary"
            disabled={!inside || busy}
            onClick={() => void pressCheckIn()}
          >
            {busy ? 'Checking in…' : 'Check in — verify GPS'}
          </Button>
          {window_.confirmedAfterStart ? (
            // §3.4: booked after the start, so start+30 is not their lock
            // and quoting it would tell them they are already too late.
            <p className="xs muted">
              You were booked after this shift started, so check-in stays open until{' '}
              <UkTime at={window_.locks} />, the end of the shift.
            </p>
          ) : (
            <p className="xs muted">
              Check-in window <UkTime at={window_.opens} /> – <UkTime at={window_.locks} />. You’re
              paid from {uk(shift.startsAt)} whenever you arrive before it; after{' '}
              {uk(shift.startsAt)} you’re marked Late; at <UkTime at={window_.locks} /> check-in
              locks.
            </p>
          )}
        </>
      ) : null}

      {beforeCheckIn && shift.breaksLogged ? <BreaksBlock shift={shift} locked /> : null}

      {phase === 'on_shift' || phase === 'on_break' ? (
        <>
          {openBreak ? (
            <div className="tblock brk">
              <span className="lab">Break · running</span>
              <Timer>{formatDuration(minutesSince(openBreak.startedAt, now))}</Timer>
              <span className="xs muted">Break started {local(openBreak.startedAt)}</span>
            </div>
          ) : null}
          <div className={openBreak ? 'tblock paused' : 'tblock'}>
            <span className="lab">
              {openBreak ? 'Chargeable time · paused' : 'On shift · chargeable time'}
            </span>
            <Timer>
              {formatDuration(
                Math.max(
                  0,
                  minutesSince(shift.checkInAt!, now) -
                    (shift.breaksLogged ? totalBreakMinutes(shift, now) : 0),
                ),
              )}
            </Timer>
            <span className="xs muted">
              {openBreak
                ? 'Resumes when you finish your break'
                : `Checked in ${local(shift.checkInAt!)} · paid from ${uk(shift.startsAt)} (UK) · scheduled end ${uk(shift.endsAt)} (UK)`}
            </span>
          </div>

          {shift.breaksLogged ? (
            <BreaksBlock
              shift={shift}
              onBreak={Boolean(openBreak)}
              busy={busy}
              onStart={() => void run(() => startBreak(shift.bookingId))}
              onFinish={() => void run(() => finishBreak(shift.bookingId))}
              formatTime={local}
            />
          ) : (
            <Note>
              Breaks are paid by this client — take them as your manager on site directs. Nothing to
              log.
            </Note>
          )}

          {/* §5.1: check-out works from ANYWHERE, and the press never waits
              on the GPS for longer than CHECK_OUT_FIX allows. */}
          <Button
            block
            size="lg"
            tone={inside ? 'green' : 'default'}
            disabled={busy}
            onClick={() => void onCheckOut()}
          >
            {busy ? 'Checking out…' : 'Check out'}
          </Button>
          <p className="xs muted center-note">
            Check-out works from anywhere until <UkTime at={checkOutLocksAt(shift.endsAt)} /> (4 h
            after the end) — being on site only affects the time we record.
          </p>
        </>
      ) : null}

      {cancellable ? (
        <CancelShift
          bookingId={shift.bookingId}
          startsAt={new Date(shift.startsAt)}
          onDone="/shifts"
        />
      ) : null}
    </>
  );
}

/** Pills and the scheduled window: "Today · Confirmed · 17:00 – 23:30 UK". */
function HeadRow({
  phase,
  today,
  venueName,
  startsAt,
  endsAt,
  uk,
  local,
  dual,
}: {
  phase: ShiftPhase;
  today: boolean;
  venueName: string;
  startsAt: string;
  endsAt: string;
  uk: (iso: string) => string;
  local: (iso: string) => string;
  dual: boolean;
}) {
  const state =
    phase === 'on_break' ? (
      <Pill tone="amber" dot>
        On break
      </Pill>
    ) : phase === 'on_shift' ? (
      <Pill tone="green" dot>
        Checked in
      </Pill>
    ) : phase === 'locked' ? (
      <Pill tone="coral">Not attended</Pill>
    ) : phase === 'closed' ? (
      <Pill tone="green">Checked out</Pill>
    ) : (
      <Pill tone="green">Confirmed</Pill>
    );

  return (
    <>
      <div className="row" style={{ gap: 'var(--sp-8)' }}>
        {today ? <Pill tone="cyan">Today</Pill> : null}
        {state}
        {today ? null : <Pill>{venueName}</Pill>}
        <span className="ml-auto mono sm">
          {today ? '' : `${ukDay(new Date(startsAt))} · `}
          {uk(startsAt)} – {uk(endsAt)} UK
        </span>
      </div>
      {dual ? (
        <p className="xs muted">
          {local(startsAt)} – {local(endsAt)} your time
        </p>
      ) : null}
    </>
  );
}

/**
 * §5.2b. The block exists only where the client does not pay for breaks.
 * Before check-in it is shown and disabled — "Unlocks after check-in",
 * because nobody can be on a break for a shift they have not started.
 */
function BreaksBlock(
  props:
    | { shift: ShiftDetail; locked: true }
    | {
        shift: ShiftDetail;
        locked?: false;
        onBreak: boolean;
        busy: boolean;
        onStart: () => void;
        onFinish: () => void;
        formatTime: (iso: string) => string;
      },
) {
  const { shift } = props;
  const longShift =
    new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime() > 6 * 3600_000;
  const warning = longShift ? (
    <Alert tone="amber">
      A break will be applied to all shifts over 6 hours — please check with your Manager on site
    </Alert>
  ) : null;

  if (props.locked) {
    return (
      <div className="mcard breaks-off" data-breaks="locked">
        <div className="h">
          <div className="t">Breaks</div>
          <Pill>Unpaid by client</Pill>
        </div>
        {warning}
        <Button block disabled>
          Start break
        </Button>
        <p className="xs muted center-note">Unlocks after check-in</p>
      </div>
    );
  }

  const { onBreak, busy, onStart, onFinish, formatTime } = props;
  return (
    <div className="mcard" data-breaks="live">
      <div className="h">
        <div className="t">Breaks</div>
        <Pill>Unpaid by client</Pill>
      </div>
      {warning}
      <Button
        block
        size="lg"
        tone={onBreak ? 'primary' : 'outline'}
        disabled={busy}
        onClick={onBreak ? onFinish : onStart}
      >
        {onBreak ? 'Finish break — back to work' : 'Start break'}
      </Button>
      {shift.breaks.length === 0 ? (
        <p className="xs muted">
          No breaks logged yet. Break time is deducted from your hours. You can take more than one.
        </p>
      ) : (
        <ul className="mobile-list">
          {shift.breaks.map((b, i) => (
            <li key={b.id} className="mrow">
              <span className="sm">Break {i + 1}</span>
              <span className="right mono sm">
                {formatTime(b.startedAt)} – {b.endedAt ? formatTime(b.endedAt) : 'now'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function gpsSentence(why: FixFailure): string {
  switch (why) {
    case 'unsupported':
      return 'This device cannot share its location, so check-in cannot verify you are on site.';
    case 'denied':
      return 'Location is off. Turn it on for this app — check-in has to verify you are at the venue.';
    default:
      return 'We couldn’t get your location just now. Move somewhere with a clearer view of the sky and try again.';
  }
}

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
}

function sameUkDay(iso: string, now: Date): boolean {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: UK_ZONE });
  return fmt(new Date(iso)) === fmt(now);
}

/** "Tue 23 Sep", the UK calendar day. */
function ukDay(at: Date): string {
  return at.toLocaleDateString('en-GB', {
    timeZone: UK_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
