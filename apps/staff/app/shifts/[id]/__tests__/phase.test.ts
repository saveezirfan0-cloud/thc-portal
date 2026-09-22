import { describe, expect, it } from 'vitest';
import { checkInWindow, distanceM, formatDistance, shiftPhase } from '../phase';

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
    expect(shiftPhase({ shift: on, openBreak: false, now: at(390 + 240) })).toBe(
      'check_out_locked',
    );
  });

  it('is closed once a finish time exists, however it was recorded', () => {
    const done = shift({ checkInAt: START, checkOutAt: END });
    expect(shiftPhase({ shift: done, openBreak: false, now: at(1000) })).toBe('closed');
  });

  it('quotes the window the worker is told about', () => {
    const { opens, locks } = checkInWindow(START);
    expect(opens.toISOString()).toBe('2026-06-14T15:30:00.000Z');
    expect(locks.toISOString()).toBe('2026-06-14T16:30:00.000Z');
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
