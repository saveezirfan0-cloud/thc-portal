import { describe, expect, it } from 'vitest';
import {
  STATUS_LABEL,
  VIOLATION_LABEL,
  arrivalLine,
  breaksCell,
  checkOutStamp,
  departureLine,
  missingWorkers,
  needsActualFinish,
  needsAttention,
  pastEndText,
  reclassifiesToLate,
  lateCheckOutToVerify,
  minutesPastEnd,
  nudgeKind,
  statusTone,
} from '../status';
import type { MonitorRow, MonitorStatus } from '../types';

const row = (over: Partial<MonitorRow> = {}): MonitorRow => ({
  bookingId: 'b',
  staffId: 's',
  eventId: 'e',
  eventTitle: 'Gala Dinner',
  roleName: 'Waiting Staff',
  staffName: 'Amara K.',
  photoUrl: null,
  startsAt: '2026-06-14T16:00:00Z',
  endsAt: '2026-06-14T22:30:00Z',
  checkInAt: null,
  checkOutAt: null,
  lastFixInside: null,
  lastFixAt: null,
  breaksCount: null,
  lastBreakAt: null,
  lateCheckOut: false,
  locationSuspect: false,
  status: 'due',
  ...over,
});

describe('§9.5 status pills', () => {
  it('has a label for every status the view can return', () => {
    const all: MonitorStatus[] = [
      'checked_out',
      'no_check_out',
      'off_site',
      'on_shift',
      'not_checked_in',
      'not_confirmed_today',
      'due',
    ];
    for (const s of all) expect(STATUS_LABEL[s]).toBeTruthy();
  });

  it('keeps a normal check-out neutral and turns a late one red', () => {
    expect(statusTone(row({ status: 'checked_out', lateCheckOut: false }))).toBe('neutral');
    expect(statusTone(row({ status: 'checked_out', lateCheckOut: true }))).toBe('coral');
  });

  it('paints the 30-minute alert and No check-out red, Off-site amber', () => {
    expect(statusTone(row({ status: 'not_checked_in' }))).toBe('coral');
    expect(statusTone(row({ status: 'no_check_out' }))).toBe('coral');
    expect(statusTone(row({ status: 'off_site' }))).toBe('amber');
    expect(statusTone(row({ status: 'on_shift' }))).toBe('green');
  });

  it('treats Day-of confirm pending as a variant of Due, not an alert', () => {
    // §3.5: the worker can still check in normally; it is visibility only.
    expect(statusTone(row({ status: 'not_confirmed_today' }))).toBe('amber');
    expect(statusTone(row({ status: 'due' }))).toBe('amber');
  });
});

describe('§9.5 needs attention', () => {
  it('is the set a manager has to act on', () => {
    expect(needsAttention(row({ status: 'not_checked_in' }))).toBe(true);
    expect(needsAttention(row({ status: 'no_check_out' }))).toBe(true);
    expect(needsAttention(row({ status: 'off_site' }))).toBe(true);
    expect(needsAttention(row({ status: 'checked_out', lateCheckOut: true }))).toBe(true);
  });

  it('leaves the quiet states alone', () => {
    expect(needsAttention(row({ status: 'on_shift' }))).toBe(false);
    expect(needsAttention(row({ status: 'due' }))).toBe(false);
    expect(needsAttention(row({ status: 'checked_out', lateCheckOut: false }))).toBe(false);
  });

  it('counts the event short only for workers past the 30-minute alert', () => {
    expect(
      missingWorkers([
        row({ status: 'not_checked_in' }),
        row({ status: 'not_checked_in' }),
        row({ status: 'due' }),
        row({ status: 'on_shift' }),
      ]),
    ).toBe(2);
  });
});

describe('§9.5 the Breaks column', () => {
  const at = (iso: string) => iso.slice(11, 16);

  it('reads as a dash where the client pays — never as 0', () => {
    // "no data" and "took no breaks" must not look the same to a manager.
    expect(breaksCell({ breaksCount: null, lastBreakAt: null }, at)).toBe('—');
  });

  it('reads 0 for a worker who genuinely took none', () => {
    expect(breaksCell({ breaksCount: 0, lastBreakAt: null }, at)).toBe('0');
  });

  it('shows the count and the most recent one', () => {
    expect(breaksCell({ breaksCount: 2, lastBreakAt: '2026-06-14T14:10:00Z' }, at)).toBe(
      '2 · last 14:10',
    );
  });
});

describe('§9.5 resolving', () => {
  it('asks for a finish time only for a No check-out', () => {
    expect(needsActualFinish('no_checkout')).toBe(true);
    expect(needsActualFinish('late')).toBe(false);
    expect(needsActualFinish('left_early')).toBe(false);
  });

  it('reclassifies only a No-show, which is what "Get back" does (§3.3)', () => {
    expect(reclassifiesToLate('no_show')).toBe(true);
    expect(reclassifiesToLate('left_geofence')).toBe(false);
  });

  it('names all five violation types', () => {
    expect(Object.keys(VIOLATION_LABEL)).toHaveLength(5);
    expect(VIOLATION_LABEL.left_geofence).toBe('Left the geofence during the shift');
  });
});

describe("the check-in stamp's second line (checkin.html)", () => {
  const start = '2026-10-14T16:00:00Z';
  const at = (checkInAt: string | null, locationSuspect = false) =>
    arrivalLine({ checkInAt, startsAt: start, locationSuspect });

  it("says on site, and how late against the role section's start", () => {
    expect(at('2026-10-14T16:21:30Z')).toBe('GPS · on site · 21 min late');
    expect(at('2026-10-14T15:52:00Z')).toBe('GPS · on site · early');
    expect(at('2026-10-14T16:00:40Z')).toBe('GPS · on site · on time');
  });

  it('does not call a vague fix on site (its amber pill says why)', () => {
    expect(at('2026-10-14T16:03:00Z', true)).toBe('GPS · 3 min late');
  });

  it('is nothing without a check-in', () => {
    expect(at(null)).toBeNull();
  });
});

describe('the Check-out column (ADR-0209)', () => {
  const end = '2026-10-14T22:30:00Z';
  const out = (checkOutAt: string | null, status: MonitorStatus = 'checked_out') =>
    departureLine({ status, checkOutAt, endsAt: end });

  it("says how the finish sat against the role section's end", () => {
    expect(out('2026-10-14T22:30:00Z')).toBe('on time');
    expect(out('2026-10-14T22:10:00Z')).toBe('20 min before the end');
    expect(out('2026-10-14T23:05:00Z')).toBe('35 min past the end');
    expect(out('2026-10-14T20:15:00Z')).toBe('2 h 15 min before the end');
  });

  it('shows a stamp only once the row is Checked out', () => {
    expect(checkOutStamp({ status: 'checked_out', checkOutAt: end })).toBe(end);
    // A No check-out has no finish until the office enters one (RULE-02).
    expect(checkOutStamp({ status: 'no_check_out', checkOutAt: end })).toBeNull();
    expect(checkOutStamp({ status: 'on_shift', checkOutAt: null })).toBeNull();
    expect(out(end, 'no_check_out')).toBeNull();
  });
});

describe('ADR-0184 signed out late', () => {
  const late = row({
    status: 'checked_out',
    lateCheckOut: true,
    checkOutAt: '2026-06-14T23:45:00Z',
  });

  it('is red and needs attention until the office verifies it with the worker', () => {
    expect(lateCheckOutToVerify(late)).toBe(true);
    expect(statusTone(late)).toBe('coral');
    expect(needsAttention(late)).toBe(true);
  });

  it('goes back to neutral once verified, and leaves the attention filter', () => {
    const verified = { ...late, lateCheckOutVerifiedAt: '2026-06-15T09:00:00Z' };
    expect(lateCheckOutToVerify(verified)).toBe(false);
    expect(statusTone(verified)).toBe('neutral');
    expect(needsAttention(verified)).toBe(false);
  });

  it('says how far past the end the sign-out was', () => {
    expect(minutesPastEnd(late.endsAt, late.checkOutAt!)).toBe(75);
    expect(pastEndText(75)).toBe('1 h 15 min past the end');
    expect(pastEndText(45)).toBe('45 min past the end');
    expect(pastEndText(120)).toBe('2 h past the end');
  });
});

describe('Remind (ADR-0188) — which register push a row is offered', () => {
  // 16:00–22:30 UTC; "at" is minutes from the start.
  const at = (m: number) => new Date(new Date('2026-06-14T16:00:00Z').getTime() + m * 60_000);

  it('offers check-in from 30 minutes before the start until the end', () => {
    for (const status of ['due', 'not_confirmed_today', 'not_checked_in'] as const) {
      expect(nudgeKind(row({ status }), at(-31))).toBeNull();
      expect(nudgeKind(row({ status }), at(-30))).toBe('check-in');
      expect(nudgeKind(row({ status }), at(45))).toBe('check-in');
      expect(nudgeKind(row({ status }), at(390))).toBeNull();
    }
  });

  it('offers check-out in the last 30 minutes, and N9b once the shift has ended', () => {
    for (const status of ['on_shift', 'off_site'] as const) {
      expect(nudgeKind(row({ status }), at(300))).toBeNull();
      expect(nudgeKind(row({ status }), at(360))).toBe('check-out');
      expect(nudgeKind(row({ status }), at(390))).toBe('still-on-shift');
    }
  });

  it('offers nothing once checked out, or when the button has locked (No check-out)', () => {
    expect(nudgeKind(row({ status: 'checked_out' }), at(400))).toBeNull();
    expect(nudgeKind(row({ status: 'no_check_out' }), at(700))).toBeNull();
  });
});
