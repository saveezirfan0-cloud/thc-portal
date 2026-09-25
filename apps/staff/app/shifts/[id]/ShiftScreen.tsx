'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, GpsChip, MobileCard, Note, Pill, Timer } from '@thc/ui';
import { UK_ZONE, formatTimeIn, needsDualZone, viewerZone } from '@thc/domain';
import { checkIn, checkOut, finishBreak, recordPing, startBreak } from './actions';
import { rpcMessage } from './messages';
import { shiftEarnings, formatDuration, formatMoney, totalBreakMinutes } from './earnings';
import {
  checkInWindow,
  distanceM,
  formatDistance,
  isEndScreen,
  isStaticPhase,
  shiftPhase,
  turnedAwayReply,
} from './phase';
import { StaticShiftScreen } from './StaticShiftScreen';
import { TurnedAwayScreen } from './TurnedAwayScreen';
import type { GpsFix, ShiftDetail } from './types';

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
export function ShiftScreen({ shift }: { shift: ShiftDetail }) {
  const router = useRouter();
  // `shift` is read straight from props, not copied into state: after a
  // press, `router.refresh()` hands down the booking as the server now has
  // it, and a copy in state would keep showing the check-in button to a
  // worker who has just checked in.
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // §3.2: the RPC's own answer to a press it turned away, so "Thanks for
  // coming" is on screen the moment the reply lands rather than after the
  // refresh. Its minutes are the database's (RULE-15), never this clock's.
  const [turnedAway, setTurnedAway] = useState<{ payMin: number | null } | null>(null);

  // The clock moves the screen through its own states — the check-in window
  // opening, the grace elapsing — with no write behind them.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const openBreak = shift.breaks.find((b) => b.endedAt === null) ?? null;
  const phase = shiftPhase({ shift, openBreak: Boolean(openBreak), now });
  // §10.4's dead ends and the §3.2 turn-away have no map and nothing to
  // press, so they do not ask for the worker's location either.
  const dead = isEndScreen(phase) || turnedAway !== null;
  const zone = viewerZone();
  const local = (iso: string) => formatTimeIn(new Date(iso), zone);
  const uk = (iso: string) => formatTimeIn(new Date(iso), UK_ZONE);
  const dual = needsDualZone(zone);

  const locate = useCallback(async (): Promise<GpsFix | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError(
        'This device cannot share its location, so check-in cannot verify you are on site.',
      );
      return null;
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Math.round(pos.coords.accuracy),
          };
          setFix(next);
          setGpsError(null);
          resolve(next);
        },
        () => {
          setGpsError(
            'Location is off. Turn it on for this app — check-in has to verify you are at the venue.',
          );
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
      );
    });
  }, []);

  useEffect(() => {
    if (!dead) void locate();
  }, [locate, dead]);

  // §5.1 background tracking, as far as a PWA can do it: a fix whenever the
  // worker has the screen open during the shift. Off-site check-out reads
  // this trail, so even this much is the difference between recording their
  // real finish and falling to RULE-02 (ADR-0001, docs/06).
  useEffect(() => {
    if (dead || !shift.checkInAt || shift.checkOutAt) return;
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
  }, [dead, locate, shift.bookingId, shift.checkInAt, shift.checkOutAt]);

  const metres = fix ? distanceM(fix, { lat: shift.venueLat, lng: shift.venueLng }) : null;
  const inside = metres !== null && metres <= shift.geofenceRadiusM;

  async function run(
    fn: () => Promise<{ error: string } | { ok: true; result: Record<string, unknown> }>,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await fn();
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    const away = turnedAwayReply(result.result);
    if (away) {
      setTurnedAway(away);
    } else {
      setMessage(rpcMessage(result.result, local));
    }
    router.refresh();
  }

  const window_ = checkInWindow(shift.startsAt);
  const earnings = shiftEarnings(shift, now);
  // §5.1: the ROLE section has started (RULE-18), so check-out is open.
  const started = now >= new Date(shift.startsAt);

  if (isStaticPhase(phase)) {
    return <StaticShiftScreen kind={phase} shift={shift} localTime={local} />;
  }

  // §3.2 strict buffer. Once the refresh has the booking as `turned_away`
  // the row's own RULE-15 minutes win; until then, the RPC's reply.
  if (phase === 'turned_away' || turnedAway) {
    return (
      <TurnedAwayScreen
        turnAwayPayMin={
          phase === 'turned_away' ? shift.turnedAwayPayMin : (turnedAway?.payMin ?? null)
        }
      />
    );
  }

  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <Pill tone="cyan">{sameUkDay(shift.startsAt, now) ? 'Today' : 'Upcoming'}</Pill>
        <span className="ml-auto mono sm">
          {uk(shift.startsAt)} – {uk(shift.endsAt)} UK
        </span>
      </div>
      {dual ? (
        <p className="xs muted">
          {local(shift.startsAt)} – {local(shift.endsAt)} your time
        </p>
      ) : null}

      <MobileCard title="Where">
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
        </div>
      </MobileCard>

      {gpsError ? <Alert tone="coral">{gpsError}</Alert> : null}
      {metres !== null ? (
        <GpsChip inside={inside}>
          {inside ? (
            <>
              <b>On site</b> · {formatDistance(metres)} from the venue centre
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
      {message ? (
        <Alert tone={message.startsWith('We couldn') ? 'coral' : 'amber'}>{message}</Alert>
      ) : null}

      {/* ---- the buttons, one phase at a time (§5.1) ---- */}
      {phase === 'before_window' ? (
        <>
          <Button block size="lg" tone="primary" disabled>
            Check in — verify GPS
          </Button>
          <p className="xs muted">
            Check-in opens at {uk(window_.opens.toISOString())} UK, within {shift.geofenceRadiusM} m
            of the venue.
          </p>
          {shift.breaksLogged ? <BreaksBlock shift={shift} locked formatTime={local} /> : null}
        </>
      ) : null}

      {phase === 'check_in' ? (
        <>
          <Button
            block
            size="lg"
            tone="primary"
            disabled={!inside || busy}
            onClick={() => fix && run(() => checkIn(shift.bookingId, fix.lat, fix.lng))}
          >
            {busy ? 'Checking in…' : 'Check in — verify GPS'}
          </Button>
          <p className="xs muted">
            Check-in window {uk(window_.opens.toISOString())} – {uk(window_.locks.toISOString())}.
            You’re paid from {uk(shift.startsAt)} whenever you arrive before it; after{' '}
            {uk(shift.startsAt)} you’re marked Late; at {uk(window_.locks.toISOString())} check-in
            locks.
          </p>
          {shift.breaksLogged ? <BreaksBlock shift={shift} locked formatTime={local} /> : null}
        </>
      ) : null}

      {phase === 'locked' ? (
        <Alert tone="coral">
          <b>You’ve been marked as not attended — contact the office.</b>
          <br />
          <span className="xs">
            Check-in closed at {uk(window_.locks.toISOString())}, 30 minutes after your start time.
            If you’re on site, a manager can register your arrival.
          </span>
        </Alert>
      ) : null}

      {phase === 'on_shift' || phase === 'on_break' ? (
        <>
          <Timer>
            {formatDuration(
              Math.max(
                0,
                Math.round((now.getTime() - new Date(shift.checkInAt!).getTime()) / 60_000) -
                  (shift.breaksLogged ? totalBreakMinutes(shift, now) : 0),
              ),
            )}
          </Timer>
          <p className="xs muted">
            Chargeable time{phase === 'on_break' ? ' · paused while you’re on a break' : ''}
          </p>

          {shift.breaksLogged ? (
            <BreaksBlock
              shift={shift}
              onBreak={Boolean(openBreak)}
              busy={busy}
              onStart={() => run(() => startBreak(shift.bookingId))}
              onFinish={() => run(() => finishBreak(shift.bookingId))}
              formatTime={local}
            />
          ) : (
            <Note>
              Breaks are paid by this client — take them as your manager on site directs. Nothing to
              log.
            </Note>
          )}

          {/* §5.1: check-out works from ANYWHERE. With no fix at all —
                location off, no signal, a phone that never answers — the
                press still goes to check_out() without coordinates, and the
                server records the last on-site fix or, with none, raises
                RULE-02. The button never waits on the GPS.

                It does wait on the START: check-in opens 30 minutes before
                it, check-out "once the shift has started", and check_out()
                refuses a press in between (check_out_not_open). */}
          <Button
            block
            size="lg"
            disabled={busy || !started}
            onClick={() =>
              run(async () => {
                const at = fix ?? (await locate());
                return checkOut(shift.bookingId, at?.lat ?? null, at?.lng ?? null);
              })
            }
          >
            {busy ? 'Checking out…' : 'Check out'}
          </Button>
          {started ? null : (
            <p className="xs muted">
              Check-out opens at {local(shift.startsAt)}
              {dual ? ` (${uk(shift.startsAt)} UK)` : ''}.
            </p>
          )}
        </>
      ) : null}

      {phase === 'closed' && earnings ? (
        <MobileCard title="Shift complete">
          <div className="kvs sum">
            <div className="kv">
              <span className="k">Worked</span>
              <span className="v">
                {uk(shift.startsAt)} – {uk(shift.endsAt)} ·{' '}
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
          <p className="sm muted" style={{ textAlign: 'center' }}>
            Your hours are sent to the office as a timesheet. You’re paid the Friday after the week
            you worked.
          </p>
        </MobileCard>
      ) : null}
    </>
  );
}

/**
 * §5.2b. The block exists only where the client does not pay for breaks.
 *
 * Before check-in it is drawn locked — "Start break" disabled with the hint
 * "Unlocks after check-in" (wireframe states (b), (c), (e)): you cannot be
 * on a break for a shift you have not started, and start_break() refuses
 * the press (not_checked_in). The >6 h banner shows either way, so the
 * worker knows before the shift that a break is expected.
 */
function BreaksBlock({
  shift,
  locked = false,
  onBreak = false,
  busy = false,
  onStart,
  onFinish,
  formatTime,
}: {
  shift: ShiftDetail;
  locked?: boolean;
  onBreak?: boolean;
  busy?: boolean;
  onStart?: () => void;
  onFinish?: () => void;
  formatTime: (iso: string) => string;
}) {
  const longShift =
    new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime() > 6 * 3600_000;

  return (
    <MobileCard title="Breaks" badge="Unpaid by client">
      {longShift ? (
        <Alert tone="amber">
          A break will be applied to all shifts over 6 hours — please check with your Manager on
          site
        </Alert>
      ) : null}
      <Button
        block
        size="lg"
        tone={onBreak ? 'primary' : 'outline'}
        disabled={busy || locked}
        onClick={onBreak ? onFinish : onStart}
      >
        {onBreak ? 'Finish break — back to work' : 'Start break'}
      </Button>
      {locked ? (
        <p className="xs muted" style={{ textAlign: 'center' }}>
          Unlocks after check-in
        </p>
      ) : shift.breaks.length === 0 ? (
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
    </MobileCard>
  );
}

function sameUkDay(iso: string, now: Date): boolean {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: UK_ZONE });
  return fmt(new Date(iso)) === fmt(now);
}
