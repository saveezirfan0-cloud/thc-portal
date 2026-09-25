import { describe, expect, it } from 'vitest';
import {
  checkInWindow,
  distanceM,
  formatDistance,
  isStaticPhase,
  isTerminalPhase,
  shiftPhase,
  shiftScreenReachable,
  turnAwayPaid,
} from '../phase';

/** 17:00–23:30 UK on 14 June 2026 (BST). */
const START = '2026-06-14T16:00:00Z';
const END = '2026-06-14T22:30:00Z';
const at = (minFromStart: number) => new Date(Date.parse(START) + minFromStart * 60_000);

const shift = (over: Partial<Parameters<typeof shiftPhase>[0]['shift']> = {}) => ({
  startsAt: START,
  endsAt: END,
  confirmedAt: '2026-06-12T09:00:00Z',
  checkInAt: null,
  checkOutAt: null,
  status: 'confirmed' as const,
  cancelCause: null,
  eventCancelledAt: null,
  noCheckoutOpen: false,
  ...over,
});

describe('§5.1 which state the shift screen is in', () => {
  it('opens check-in 30 minutes before the start, not before', () => {
    expect(shiftPhase({ shift: shift(), openBreak: false, now: at(-31) })).toBe('before_window');
    expect(shiftPhase({ shift: shift(), openBreak: false, now: at(-30) })).toBe('check_in');
  });

  it('keeps the button through the grace and locks at start+30', () => {
    expect(shiftPhase({ shift: shift(), openBreak: false, now: at(29) })).toBe('check_in');
    expect(shiftPhase({ shift: shift(), openBreak: false, now: at(30) })).toBe('locked');
  });

  it('exempts a booking confirmed after the shift had started (§3.4 replacement)', () => {
    const late = shift({ confirmedAt: new Date(Date.parse(START) + 60 * 60_000).toISOString() });
    expect(shiftPhase({ shift: late, openBreak: false, now: at(120) })).toBe('check_in');
    // The exemption ends with the shift itself.
    expect(shiftPhase({ shift: late, openBreak: false, now: at(391) })).toBe('locked');
  });

  it('shows the on-shift screen once checked in, and the break state while away', () => {
    const on = shift({ checkInAt: START });
    expect(shiftPhase({ shift: on, openBreak: false, now: at(120) })).toBe('on_shift');
    expect(shiftPhase({ shift: on, openBreak: true, now: at(120) })).toBe('on_break');
  });

  it('locks check-out four hours after the end, where RULE-02 takes over', () => {
    const on = shift({ checkInAt: START });
    // 390 minutes is the shift; +240 is the RULE-02 boundary.
    expect(shiftPhase({ shift: on, openBreak: false, now: at(390 + 239) })).toBe('on_shift');
    expect(shiftPhase({ shift: on, openBreak: false, now: at(390 + 240) })).toBe('no_checkout');
    // A break left running does not keep the check-out button alive.
    expect(shiftPhase({ shift: on, openBreak: true, now: at(390 + 240) })).toBe('no_checkout');
  });

  it('is closed once a finish time exists, however it was recorded', () => {
    const done = shift({ checkInAt: START, checkOutAt: END });
    expect(shiftPhase({ shift: done, openBreak: false, now: at(1000) })).toBe('closed');
  });

  it('quotes the window the worker is told about', () => {
    const { opens, locks, confirmedAfterStart } = checkInWindow(shift());
    expect(opens.toISOString()).toBe('2026-06-14T15:30:00.000Z');
    expect(locks.toISOString()).toBe('2026-06-14T16:30:00.000Z');
    expect(confirmedAfterStart).toBe(false);
  });

  it('never quotes start+30 to a booking confirmed after the start (§3.4)', () => {
    const late = shift({ confirmedAt: new Date(Date.parse(START) + 60 * 60_000).toISOString() });
    const { locks, confirmedAfterStart } = checkInWindow(late);
    expect(confirmedAfterStart).toBe(true);
    expect(locks.toISOString()).toBe(new Date(END).toISOString());
  });
});

describe('§10.4 the three dead ends replace the shift screen', () => {
  it('opens the static screen for a cancelled event (N12), whatever the clock says', () => {
    const cancelled = shift({
      status: 'cancelled',
      cancelCause: 'event_cancelled',
      eventCancelledAt: '2026-06-13T09:00:00Z',
    });
    // Inside the check-in window, where the live screen would offer the button.
    expect(shiftPhase({ shift: cancelled, openBreak: false, now: at(-10) })).toBe(
      'event_cancelled',
    );
    expect(shiftPhase({ shift: cancelled, openBreak: false, now: at(-3000) })).toBe(
      'event_cancelled',
    );
  });

  it('opens it for a cancelled event even before the booking row has caught up', () => {
    const cancelled = shift({ eventCancelledAt: '2026-06-13T09:00:00Z' });
    expect(shiftPhase({ shift: cancelled, openBreak: false, now: at(-10) })).toBe(
      'event_cancelled',
    );
  });

  it('opens the static screen for an office withdrawal (N10b)', () => {
    const withdrawn = shift({ status: 'cancelled', cancelCause: 'office_withdraw' });
    expect(shiftPhase({ shift: withdrawn, openBreak: false, now: at(-10) })).toBe('withdrawn');
  });

  it('opens it for the 12:05 release too (N6b)', () => {
    const released = shift({ status: 'cancelled', cancelCause: 'ready_cutoff' });
    expect(shiftPhase({ shift: released, openBreak: false, now: at(-10) })).toBe('withdrawn');
  });

  it('opens it for a raised No check-out even though a finish was stamped (RULE-02)', () => {
    // check_out() with no on-site fix stamps the check-in as the finish AND
    // raises the violation; the worker must see the static screen, not
    // "Shift complete" with a zero-length shift.
    const raised = shift({
      status: 'worked',
      checkInAt: START,
      checkOutAt: START,
      noCheckoutOpen: true,
    });
    expect(shiftPhase({ shift: raised, openBreak: false, now: at(200) })).toBe('no_checkout');
  });

  it('marks exactly those three as static', () => {
    expect(isStaticPhase('event_cancelled')).toBe(true);
    expect(isStaticPhase('withdrawn')).toBe(true);
    expect(isStaticPhase('no_checkout')).toBe(true);
    for (const live of ['before_window', 'check_in', 'locked', 'on_shift', 'on_break', 'closed']) {
      expect(isStaticPhase(live as Parameters<typeof isStaticPhase>[0])).toBe(false);
    }
  });
});

describe('which bookings /shifts/:id shows at all', () => {
  it('shows a booked shift and the three dead ends', () => {
    expect(shiftScreenReachable(shift())).toBe(true);
    expect(shiftScreenReachable(shift({ status: 'worked' }))).toBe(true);
    expect(
      shiftScreenReachable(shift({ status: 'cancelled', cancelCause: 'office_withdraw' })),
    ).toBe(true);
    expect(
      shiftScreenReachable(
        shift({
          status: 'cancelled',
          cancelCause: 'event_cancelled',
          eventCancelledAt: '2026-06-13T09:00:00Z',
        }),
      ),
    ).toBe(true);
  });

  it('shows nothing for the worker’s own cancel or a lapsed invitation', () => {
    expect(shiftScreenReachable(shift({ status: 'cancelled', cancelCause: 'self_cancel' }))).toBe(
      false,
    );
    expect(shiftScreenReachable(shift({ status: 'closed', cancelCause: 'declined' }))).toBe(false);
    expect(shiftScreenReachable(shift({ status: 'applied' }))).toBe(false);
  });
});

describe('§5.1 the distance line', () => {
  const venue = { lat: 51.5, lng: -0.1 };

  it('is about zero at the venue', () => {
    expect(distanceM(venue, venue)).toBe(0);
  });

  it('measures a short walk in metres', () => {
    // ~111 m north.
    expect(distanceM({ lat: 51.501, lng: -0.1 }, venue)).toBeGreaterThan(100);
    expect(distanceM({ lat: 51.501, lng: -0.1 }, venue)).toBeLessThan(120);
  });

  it('reads kilometres once it is a journey, as the copy does', () => {
    expect(formatDistance(842)).toBe('842 m');
    expect(formatDistance(1800)).toBe('1.8 km');
  });
});

describe('audit D19 · a turn-away is a state of its own, not a fresh check-in', () => {
  const away = shift({ status: 'turned_away' });

  it('stays turned away inside the window, where the clock alone would offer check-in', () => {
    expect(shiftPhase({ shift: away, openBreak: false, now: at(5) })).toBe('turned_away');
    expect(shiftPhase({ shift: away, openBreak: false, now: at(-20) })).toBe('turned_away');
  });

  it('is terminal — no map, no location request — but not one of the three §10.4 dead ends', () => {
    expect(isTerminalPhase('turned_away')).toBe(true);
    expect(isStaticPhase('turned_away')).toBe(false);
    expect(isTerminalPhase('check_in')).toBe(false);
  });

  it('is paid the flat 4 h only when the logged attempt was inside the grace (RULE-15)', () => {
    const on = (min: number) =>
      turnAwayPaid({ startsAt: START, endsAt: END, turnedAwayAt: at(min).toISOString() });
    expect(on(-10)).toBe(true);
    expect(on(29)).toBe(true);
    expect(on(30)).toBe(false);
    // No stamp: the screen cannot vouch for the pay, so it does not claim it.
    expect(turnAwayPaid({ startsAt: START, endsAt: END, turnedAwayAt: null })).toBe(false);
  });
});
