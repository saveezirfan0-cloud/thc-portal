import { describe, expect, it } from 'vitest';
import {
  CANCEL_NOTIFIES,
  NO_SHOW_WINDOW_DAYS,
  canMarkNoShow,
  confirmedBadge,
  isNotifiedOnCancel,
  openSlots,
  orderSections,
  payrollWarning,
  roleBoardHeader,
  showsCandidatePools,
} from '../board';
import { ukRoleWindow, ukInstant } from '../time';

const DATE = '2026-09-18';
const shift = ukRoleWindow(DATE, '17:00', '23:30');

describe('the role section header counts confirmed only (§3.3)', () => {
  it('reads "9 confirmed · 4 invited · 3 open of 12"', () => {
    expect(roleBoardHeader({ confirmed: 9, invited: 4, headcount: 12, buffer: 2 })).toBe(
      '9 confirmed · 4 invited · 3 open of 12',
    );
  });

  it('measures open against headcount, never headcount + buffer', () => {
    const counts = { confirmed: 12, invited: 0, headcount: 12, buffer: 2 };
    expect(openSlots(counts)).toBe(0);
    expect(roleBoardHeader(counts)).toContain('0 open of 12');
  });

  it('does not go negative once the buffer seats are taken too', () => {
    expect(openSlots({ confirmed: 14, invited: 0, headcount: 12, buffer: 2 })).toBe(0);
  });

  it('counts invitations separately — they never fill a slot', () => {
    const counts = { confirmed: 0, invited: 9, headcount: 12, buffer: 2 };
    expect(openSlots(counts)).toBe(12);
    expect(roleBoardHeader(counts)).toBe('0 confirmed · 9 invited · 12 open of 12');
  });
});

describe('Invited and Potential pool are hidden, not emptied (§3.3)', () => {
  const full = { confirmed: 12, invited: 0, headcount: 12, buffer: 2 };
  const short = { confirmed: 10, invited: 0, headcount: 12, buffer: 2 };

  it('hides them on an Upcoming role that is fully confirmed with nobody invited', () => {
    // event-board.html, "Upcoming · filling": Chef 2 confirmed · 0 invited ·
    // 0 open of 2 (+0) → "Invited · Potential pool — hidden entirely — role
    // fully confirmed and stable (§3.3)".
    expect(
      showsCandidatePools('upcoming', { confirmed: 2, invited: 0, headcount: 2, buffer: 0 }),
    ).toBe(false);
    expect(showsCandidatePools('upcoming', full)).toBe(false);
  });

  it('shows them on an Upcoming role while it has open or invited slots', () => {
    // Kitchen Porter on the same board: 2 confirmed · 3 invited · 1 open of 3.
    expect(
      showsCandidatePools('upcoming', { confirmed: 2, invited: 3, headcount: 3, buffer: 1 }),
    ).toBe(true);
    expect(showsCandidatePools('upcoming', short)).toBe(true);
    expect(showsCandidatePools('upcoming', { ...full, invited: 1 })).toBe(true);
  });

  it('hides them on an Ongoing event with no shortfall', () => {
    expect(showsCandidatePools('ongoing', full)).toBe(false);
  });

  it('brings them back when a shortfall reopens mid-event', () => {
    // A no-show or a departure leaves the role short-handed, and the manager
    // still has to fill it.
    expect(showsCandidatePools('ongoing', short)).toBe(true);
  });

  it('keeps them while invitations are still outstanding', () => {
    expect(showsCandidatePools('ongoing', { ...full, invited: 2 })).toBe(true);
  });

  it('hides them outright once the event is Completed or Cancelled', () => {
    expect(showsCandidatePools('completed', short)).toBe(false);
    expect(showsCandidatePools('cancelled', short)).toBe(false);
  });
});

describe('a no-show stays inside Confirmed (§3.3)', () => {
  it('is badged rather than moved to a list of its own', () => {
    expect(confirmedBadge({ noShow: true, confirmedAfterStart: false })).toBe('no_show');
    expect(confirmedBadge({ noShow: false, confirmedAfterStart: false })).toBeNull();
  });
});

describe('the manual No-show window (§3.3)', () => {
  it('is closed before the shift starts — there is nothing to miss yet', () => {
    expect(canMarkNoShow(shift, ukInstant(DATE, '16:59'))).toBe(false);
  });

  it('opens the moment the shift starts', () => {
    expect(canMarkNoShow(shift, shift.startsAt)).toBe(true);
  });

  it('stays open for two weeks after the shift ends, for the next pay run', () => {
    const almost = new Date(shift.endsAt.getTime() + NO_SHOW_WINDOW_DAYS * 86_400_000 - 1000);
    expect(canMarkNoShow(shift, almost)).toBe(true);
    expect(NO_SHOW_WINDOW_DAYS).toBe(14);
  });

  it('closes once that window has passed', () => {
    const after = new Date(shift.endsAt.getTime() + (NO_SHOW_WINDOW_DAYS + 1) * 86_400_000);
    expect(canMarkNoShow(shift, after)).toBe(false);
  });
});

describe('neither action corrects a payroll run already sent (§3.3)', () => {
  it('warns that a No-show will not reverse the payment', () => {
    expect(payrollWarning('no_show', true)).toContain('will not reverse the payment');
    expect(payrollWarning('no_show', true)).toContain('notify Finance');
  });

  it('warns the mirror image on Get back', () => {
    expect(payrollWarning('get_back', true)).toContain('will not add the payment');
  });

  it('says nothing at all when no export has gone out', () => {
    expect(payrollWarning('no_show', false)).toBeNull();
    expect(payrollWarning('get_back', false)).toBeNull();
  });
});

describe('the board reads like the running order of the day (§3.3)', () => {
  it('orders role sections by their own start, earliest first', () => {
    const waiting = { id: 'waiting', ...ukRoleWindow(DATE, '17:00', '23:30') };
    const chef = { id: 'chef', ...ukRoleWindow(DATE, '07:00', '15:00') };
    const kp = { id: 'kp', ...ukRoleWindow(DATE, '09:00', '17:00') };
    expect(orderSections([waiting, chef, kp]).map((s) => s.id)).toEqual(['chef', 'kp', 'waiting']);
  });

  it('leaves the input alone', () => {
    const sections = [
      { id: 'b', ...ukRoleWindow(DATE, '17:00', '23:30') },
      { id: 'a', ...ukRoleWindow(DATE, '07:00', '15:00') },
    ];
    orderSections(sections);
    expect(sections.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('cancelling reaches the Radar applicants too (§3.3)', () => {
  it('notifies confirmed, invited AND anyone with an open application', () => {
    expect([...CANCEL_NOTIFIES]).toEqual(['confirmed', 'invited', 'applied']);
    for (const status of CANCEL_NOTIFIES) expect(isNotifiedOnCancel(status)).toBe(true);
  });

  it('leaves out those already off the event', () => {
    expect(isNotifiedOnCancel('cancelled')).toBe(false);
    expect(isNotifiedOnCancel('worked')).toBe(false);
  });
});
