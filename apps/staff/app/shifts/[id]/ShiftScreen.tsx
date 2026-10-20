'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, GpsChip, MobileCard, Note, Pill, Timer, useTimeFormat } from '@thc/ui';
import {
  UK_ZONE,
  canCancelShift,
  effectiveStart,
  formatTimeIn,
  needsDualZone,
  viewerZone,
} from '@thc/domain';
import { CHECK_IN_FIX, TRACKING_FIX, getFix, watchFix } from '../../../lib/geo';
import type { Fix, FixFailure, FixOptions } from '../../../lib/geo';
import { CancelShift } from '../../_components/CancelShift';
import { UkTime } from '../../_components/UkTime';
import { isStaleDeploy, reloadForNewBuild } from '../../_lib/stale-deploy';
import { checkIn, checkOut, finishBreak, recordPing, startBreak } from './actions';
import type { RpcResult } from './actions';
import { formatDuration, shiftEarnings, totalBreakMinutes } from './earnings';
import {
  NoOnSiteFixScreen,
  NotAttendedScreen,
  OffSiteCheckOutScreen,
  ShiftCompleteScreen,
} from './FullScreens';
import { NOT_SENT, rpcMessage } from './messages';
import {
  checkInWindow,
  checkOutLocksAt,
  distanceM,
  formatDistance,
  isEndScreen,
  isStaticPhase,
  shiftPhase,
  turnedAwayReply,
} from './phase';
import type { ShiftPhase } from './phase';
import { checkInCountdown, directionsUrl, phoneFromContact } from './links';
import { pressCheckOut } from './press';
import { ShiftMap } from './ShiftMap';
import { StaticShiftScreen } from './StaticShiftScreen';
import { TurnedAwayScreen } from './TurnedAwayScreen';
import { useWakeLock } from './wakeLock';
import type { WakeState } from './wakeLock';
import { OfferPanel } from './OfferPanel';
import { LoadProblem } from '../../_components/LoadProblem';
import type { BookingOffer } from '../offers';
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
 *
 * The moments a worker has to read one sentence and press one button are
 * whole screens of their own (FullScreens.tsx, ADR-0036): an off-site
 * check-out, a check-out with no on-site fix, the shift complete, and
 * check-in closed. The §3.2 turn-away is `TurnedAwayScreen`.
 */

/** What the last check-out press came back with, until the worker moves on. */
interface CheckOutOutcome {
  key: string;
  recordedAt: string | null;
  pressedAt: string;
  distanceM: number | null;
}

/** RULE-01 / ADR-0095: the later of the scheduled start and the actual check-in. */
export function paidFromIso(shift: {
  startsAt: string;
  endsAt: string;
  checkInAt?: string | null;
}): string {
  if (!shift.checkInAt) return shift.startsAt;
  return effectiveStart(
    { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) },
    new Date(shift.checkInAt),
  ).toISOString();
}

export function ShiftScreen({
  shift,
  firstName = null,
  autoCheckIn = false,
  offer = null,
  offerProblem = false,
}: {
  shift: ShiftDetail;
  /** "Shift complete — thank you, Amara". */
  firstName?: string | null;
  /**
   * The today card's "Check in" opened this screen (§10.4): once a fix
   * inside the geofence arrives, the check-in goes without a second press.
   */
  autoCheckIn?: boolean;
  /**
   * ADR-0046: the booking's open offer and the auto-assign switch
   * (`staff_booking_offers()`), for Offer this shift / Ask the office.
   */
  offer?: BookingOffer | null;
  /** `staff_booking_offers()` failed: say so, never guess the panel (audit D18). */
  offerProblem?: boolean;
}) {
  // `shift` is read straight from props, not copied into state: a press's
  // server action revalidates the page, so its response hands down the
  // booking as the server now has it, and a copy in state would keep
  // showing the check-in button to a worker who has just checked in.
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutOutcome | null>(null);
  const [now, setNow] = useState(() => new Date());
  const autoTried = useRef(false);
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
  // ADR-0085: written on the worker's own clock; which instant is unchanged.
  const format = useTimeFormat();
  const local = (iso: string) => formatTimeIn(new Date(iso), zone, format);
  const uk = (iso: string) => formatTimeIn(new Date(iso), UK_ZONE, format);
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
    if (!dead) void locate(TRACKING_FIX);
  }, [locate, dead]);

  // Go-live audit B4: while check-in is open the location line follows the
  // worker, so arriving at the door turns the button on (and the today
  // card's auto check-in goes) without a reload. Started when the 15 s tick
  // moves the screen from before_window into the window; stopped once they
  // are checked in, when the pings below take over. The press still takes
  // its own reading and the database re-checks the geofence with it.
  const watching = !dead && phase === 'check_in';
  useEffect(() => {
    if (!watching) return;
    const geo = typeof navigator === 'undefined' ? null : navigator.geolocation;
    return watchFix(
      geo,
      (next) => {
        setFix(next);
        setGpsError(null);
      },
      (why) => setGpsError(gpsSentence(why)),
    );
  }, [watching]);

  /** "Refresh location": a new reading on demand, for a watch that has gone quiet. */
  async function refreshLocation() {
    setLocating(true);
    try {
      await locate(CHECK_IN_FIX);
    } finally {
      setLocating(false);
    }
  }

  // §5.1 background tracking, as far as a PWA can do it: a fix whenever the
  // worker has the screen open during the shift. Off-site check-out reads
  // this trail, so even this much is the difference between recording their
  // real finish and falling to RULE-02 (ADR-0001, docs/06).
  const tracking = !dead && Boolean(shift.checkInAt) && !shift.checkOutAt;
  // docs/06 Option A: keep the screen on while checked in, so the pings
  // keep coming, and say so in a bar that stays up for the whole shift.
  const wake = useWakeLock(tracking);
  useEffect(() => {
    if (!tracking) return;
    let cancelled = false;
    const send = async () => {
      const f = await locate(TRACKING_FIX);
      if (!f || cancelled) return;
      try {
        await recordPing(shift.bookingId, f.lat, f.lng, f.accuracyM);
      } catch (e) {
        // A lost ping is retried by the next one. A ping refused because
        // the phone is on an older build than the server would be refused
        // every time, leaving check-out with no trail — load the new build.
        if (isStaleDeploy(e)) reloadForNewBuild();
      }
    };
    // Back from another app or a locked screen: a fix now, not up to two
    // minutes later — the gap is exactly what the trail is missing.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void send();
    };
    void send();
    const timer = setInterval(send, 120_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tracking, locate, shift.bookingId]);

  const venue = { lat: shift.venueLat, lng: shift.venueLng };
  const metres = fix ? distanceM(fix, venue) : null;
  const inside = metres !== null && metres <= shift.geofenceRadiusM;

  /**
   * One press. The fresh booking comes back inside the action's response
   * (actions.ts revalidates the page), so there is no `router.refresh()`
   * here — that was a second full render of the page after every press.
   *
   * Go-live audit B5: the button is never left reading "Checking in…". A
   * press that gets no answer — venue signal, a gateway timeout — says so
   * and asks for another press, which is safe: `attempt_check_in` answers
   * `already_checked_in`, `check_out` `already_checked_out`, the break
   * presses `already_on_break` / `not_on_break`, so a second press never
   * records anything twice. A press refused because the phone is on an
   * older build than the server reloads onto the new one.
   */
  async function run(fn: () => Promise<RpcResult>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fn();
      if ('error' in result) {
        setError(result.error);
        return null;
      }
      const away = turnedAwayReply(result.result);
      if (away) {
        setTurnedAway(away);
      } else {
        setMessage(rpcMessage(result.result, local));
      }
      return result.result;
    } catch (e) {
      if (!(isStaleDeploy(e) && reloadForNewBuild())) setError(NOT_SENT);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** A reading AT the press, then the RPC with it (§5.1). */
  async function pressCheckIn() {
    setBusy(true);
    let at: Fix | null = null;
    try {
      at = await locate(CHECK_IN_FIX);
    } finally {
      setBusy(false);
    }
    if (!at) return;
    const { lat, lng, accuracyM } = at;
    await run(() => checkIn(shift.bookingId, lat, lng, accuracyM));
  }
  // The auto check-in below runs from an effect; it calls the latest press.
  const pressRef = useRef(pressCheckIn);
  useEffect(() => {
    pressRef.current = pressCheckIn;
  });

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
  const countdown = phase === 'before_window' ? checkInCountdown(shift.startsAt, now) : null;
  const directions = directionsUrl(shift);
  const earnings = shiftEarnings(shift, now);
  const today = sameUkDay(shift.startsAt, now);
  // §5.1: the ROLE section has started (RULE-18), so check-out is open.
  const started = now >= new Date(shift.startsAt);

  // ---- whole screens first ---------------------------------------------
  const head = (
    <HeadRow
      // The worker has just pressed Check out: whatever the refreshed row
      // says now, the pill says so — except with no on-site fix (j), where
      // nothing is confirmed until the office resolves it (§5.2), so no
      // green "Checked out" sits beside "We couldn't confirm when you left".
      phase={outcome ? 'closed' : phase}
      hideState={outcome?.key === 'no_check_out_office_confirms'}
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
        paidFrom={`${uk(paidFromIso(shift))} (UK)`}
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

  // After the press's own answer, not before it. A check-out that raises
  // RULE-02 on the press — no on-site fix (§5.1), or a stale one (ADR-0035)
  // — revalidates the page with `noCheckoutOpen` set, in the same response
  // that carries the answer. Checked first, the §10.4 dead end ("We didn't
  // receive your check-out") replaced (i) and (j) the moment they were
  // due, telling a worker who HAD pressed that they had not.
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

  // RULE-04: "Cancel shift" while more than 72 h remain, as on the list card.
  const cancellable =
    phase === 'before_window' &&
    shift.status === 'confirmed' &&
    canCancelShift(new Date(shift.startsAt), now);

  return (
    <>
      {head}

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
              <span className="v">
                <OnsiteContact contact={shift.onsiteContact} />
              </span>
            </div>
          ) : null}
          {shift.notes ? (
            <div className="kv">
              <span className="k">Notes</span>
              <span className="v">{shift.notes}</span>
            </div>
          ) : null}
        </div>
        {/* Getting there and keeping it in the diary. Not on a closed
            shift — by then neither is any use. */}
        {phase !== 'closed' ? (
          <div className="shift-links">
            {directions ? (
              <a className="btn outline sm" href={directions} target="_blank" rel="noreferrer">
                Directions
              </a>
            ) : null}
            {/* A plain <a>, not <Link>: the response is a text/calendar
                file for the phone's calendar app, not a page. No `download`
                attribute — on iOS it would save to Files instead of opening
                the Add to Calendar sheet. */}
            <a className="btn outline sm" href={`/shifts/${shift.bookingId}/calendar.ics`}>
              Add to calendar
            </a>
          </div>
        ) : null}
      </MobileCard>

      <ShiftMap
        venue={venue}
        radiusM={shift.geofenceRadiusM}
        me={fix ? { lat: fix.lat, lng: fix.lng } : null}
        label={`Geofence ${shift.geofenceRadiusM} m`}
        tall={phase !== 'before_window'}
      />

      {gpsError ? <Alert tone="coral">{gpsError}</Alert> : null}
      {gps}
      {/* ADR-0152: before check-in, a way to take a new reading without
          reloading — the first one may have been on the bus, or timed out. */}
      {phase === 'before_window' || phase === 'check_in' ? (
        <div className="shift-links">
          <Button
            size="sm"
            tone="outline"
            disabled={locating || busy}
            onClick={() => void refreshLocation()}
          >
            {locating ? 'Finding you…' : 'Refresh location'}
          </Button>
        </div>
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
          {countdown ? <p className="sm countdown">{countdown}</p> : null}
          <p className="xs muted">
            Check-in opens {today ? '' : `${ukDay(window_.opens)} `}at <UkTime at={window_.opens} />
            , 30 min before the start, within {shift.geofenceRadiusM} m of the venue.
          </p>
          {shift.breaksLogged ? <BreaksBlock shift={shift} locked formatTime={local} /> : null}
          {/* ADR-0046: offer it up, or ask the office for cover. Only
              before the shift: once check-in opens it is too late for
              either, and the escalation job owns the section. */}
          {offerProblem ? (
            shift.status === 'confirmed' ? (
              <LoadProblem what="this shift’s offer" />
            ) : null
          ) : (
            <OfferPanel
              bookingId={shift.bookingId}
              startsAt={shift.startsAt}
              status={shift.status}
              offer={offer}
              now={now}
            />
          )}
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
              paid from {uk(shift.startsAt)} if you arrive before it. After {uk(shift.startsAt)}{' '}
              you’re marked Late and paid only from when you check in; at{' '}
              <UkTime at={window_.locks} /> check-in locks.
            </p>
          )}
          {shift.breaksLogged ? <BreaksBlock shift={shift} locked formatTime={local} /> : null}
        </>
      ) : null}

      {phase === 'on_shift' || phase === 'on_break' ? (
        <>
          <KeepOpenBar wake={wake} />
          {/* RULE-01: the chargeable clock runs from the later of the
              scheduled start and the check-in (ADR-0095) — a worker who
              arrived 20 minutes early has not been on the clock for them.
              Every break pauses it (§5.2b, ADR-0035 §7). */}
          <Timer>
            {formatDuration(
              Math.max(
                0,
                Math.round((now.getTime() - new Date(paidFromIso(shift)).getTime()) / 60_000) -
                  (shift.breaksLogged ? totalBreakMinutes(shift, now) : 0),
              ),
            )}
          </Timer>
          <p className="xs muted">
            Chargeable time{phase === 'on_break' ? ' · paused while you’re on a break' : ''}
          </p>
          {/* shift-detail.html (d): "Checked in 16:52 · paid from 17:00 · scheduled end 23:30".
              Paid from is the scheduled start (UK, §1.8) unless the worker
              arrived after it — then it is their check-in stamp, viewer-local. */}
          <p className="xs muted">
            Checked in {local(shift.checkInAt!)} · paid from{' '}
            {new Date(paidFromIso(shift)).getTime() === new Date(shift.startsAt).getTime() ? (
              <UkTime at={new Date(shift.startsAt)} />
            ) : (
              local(shift.checkInAt!)
            )}{' '}
            · scheduled end <UkTime at={new Date(shift.endsAt)} />
          </p>

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
                on the GPS for longer than CHECK_OUT_FIX allows (lib/geo.ts,
                audit D14): a fresh reading, or none at all — never the fix
                the screen was holding. With none, the server records the
                last on-site fix or, with none of those, raises RULE-02.

                It does wait on the START: check-in opens 30 minutes before
                it, check-out "once the shift has started", and check_out()
                refuses a press in between (check_out_not_open). */}
          <Button
            block
            size="lg"
            tone={inside ? 'green' : 'default'}
            disabled={busy || !started}
            onClick={() => void onCheckOut()}
          >
            {busy ? 'Checking out…' : 'Check out'}
          </Button>
          {started ? (
            <p className="xs muted center-note">
              Check-out works from anywhere until <UkTime at={checkOutLocksAt(shift.endsAt)} /> (4 h
              after the end) — being on site only affects the time we record.
            </p>
          ) : (
            <p className="xs muted">
              Check-out opens at {local(shift.startsAt)}
              {dual ? ` (${uk(shift.startsAt)} UK)` : ''}.
            </p>
          )}
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
  hideState = false,
}: {
  phase: ShiftPhase;
  hideState?: boolean;
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
        <Pill tone="cyan">{today ? 'Today' : 'Upcoming'}</Pill>
        {hideState ? null : state}
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

/**
 * The on-site contact as the office typed it, with any phone number in it
 * made a `tel:` link — the worker at the door needs to ring, not copy.
 */
function OnsiteContact({ contact }: { contact: string }) {
  const phone = phoneFromContact(contact);
  if (!phone) return <>{contact}</>;
  return (
    <>
      {phone.before}
      <a href={phone.href}>{phone.display}</a>
      {phone.after}
    </>
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

/**
 * docs/06 Option A's persistent bar. The app only knows where the worker is
 * while this page is open, and an off-site check-out is paid to the last
 * time it saw them on site (§5.1) — so the bar says what is at stake, not
 * just "keep the app open".
 */
export function KeepOpenBar({ wake }: { wake: WakeState }) {
  return (
    <div className="note cyan keep-open" role="status">
      <strong>Keep this screen open during your shift</strong>
      <span className="xs">
        {wake === 'on'
          ? 'Your screen will stay on while this page is open. '
          : wake === 'checking'
            ? ''
            : 'Your phone may lock the screen — if it does, open the app again. '}
        We can only see you’re on site while the app is open, and that’s what your check-out time is
        based on if you leave the venue first.
      </span>
    </div>
  );
}
