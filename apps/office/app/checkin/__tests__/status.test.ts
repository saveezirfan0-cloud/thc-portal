import { describe, expect, it } from 'vitest';
import {
  STATUS_LABEL,
  VIOLATION_LABEL,
  breaksCell,
  missingWorkers,
  needsActualFinish,
  needsAttention,
  reclassifiesToLate,
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
  photoPath: null,
  startsAt: '2026-06-14T16:00:00Z',
  endsAt: '2026-06-14T22:30:00Z',
  checkInAt: null,
  checkOutAt: null,
  lastFixInside: null,
  lastFixAt: null,
  breaksCount: null,
  lastBreakAt: null,
  lateCheckOut: false,
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

  it('treats Not confirmed today as a variant of Due, not an alert', () => {
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
