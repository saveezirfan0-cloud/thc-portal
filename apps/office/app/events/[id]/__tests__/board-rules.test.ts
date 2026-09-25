import { describe, expect, it } from 'vitest';
import { ukInstant } from '@thc/domain';
import {
  type RowRecord,
  canToggleAutoAssign,
  cancelCounts,
  cloneSections,
  cloneTitle,
  eventResult,
  formatResult,
  payableLine,
  personLabel,
  rowPill,
  unavailableGate,
} from '../board-rules';

describe('a removed worker keeps their row, labelled "Deleted account #id" (§1.7)', () => {
  it('labels a live worker by first name and initial', () => {
    expect(
      personLabel({ first_name: 'Grace', last_name: 'Lee', removed_at: null, employee_id: 1042 }),
    ).toEqual({ name: 'Grace L.', deleted: false });
  });

  it('labels a removed worker by employee id, never "Deleted a."', () => {
    expect(
      personLabel({
        first_name: 'Deleted',
        last_name: 'account',
        removed_at: '2026-09-19T18:20:00Z',
        employee_id: 1042,
      }),
    ).toEqual({ name: 'Deleted account #1042', deleted: true });
  });

  it('says unknown when the id was never issued, as deleted_account_label() does', () => {
    expect(
      personLabel({
        first_name: 'Deleted',
        last_name: 'account',
        removed_at: 'x',
        employee_id: null,
      }).name,
    ).toBe('Deleted account #unknown');
  });
});

describe('what a cancelled booking says under Unavailable (§3.3, §3.6, RULE-04)', () => {
  it('lists only a self-cancel as rejected', () => {
    expect(unavailableGate('self_cancel')).toBe('self_cancelled');
  });

  it('lists an overlap withdrawal as booked elsewhere (§3.4)', () => {
    expect(unavailableGate('overlap_auto_withdraw')).toBe('booked_elsewhere');
  });

  it('lists nobody the office withdrew, the cutoff released, or the event cancelled', () => {
    for (const cause of [
      'office_withdraw',
      'ready_cutoff',
      'event_cancelled',
      'gdpr',
      'left',
      'blocked',
      'declined',
      'slot_taken',
      'withdrawn_by_worker',
      null,
      'nonsense',
    ]) {
      expect(unavailableGate(cause)).toBeNull();
    }
  });
});

describe('the Auto-assign switch is live in Upcoming and Ongoing (§3.4)', () => {
  it('can be flicked until the event ends', () => {
    expect(canToggleAutoAssign('upcoming')).toBe(true);
    expect(canToggleAutoAssign('ongoing')).toBe(true);
    expect(canToggleAutoAssign('completed')).toBe(false);
    expect(canToggleAutoAssign('cancelled')).toBe(false);
  });
});

function record(over: Partial<RowRecord> = {}): RowRecord {
  return {
    status: 'worked',
    noShow: false,
    checkInAt: '2026-09-19T17:52:00Z',
    checkOutAt: null,
    payableMin: null,
    unpaidBreakMin: 0,
    minutesLate: null,
    leftEarly: false,
    noCheckout: null,
    ...over,
  };
}

describe("a row's pill follows docs/07's vocabulary (§3.3)", () => {
  it('is On shift while checked in with no check-out', () => {
    expect(rowPill(record())).toEqual({ kind: 'on_shift' });
  });

  it('is Checked out once out', () => {
    expect(rowPill(record({ checkOutAt: '2026-09-20T00:34:00Z' }))).toEqual({
      kind: 'checked_out',
    });
  });

  it('is No check-out while the violation is open, Checked out once resolved', () => {
    expect(rowPill(record({ noCheckout: { id: 'v', resolved: false } }))).toEqual({
      kind: 'no_checkout',
    });
    expect(
      rowPill(
        record({ noCheckout: { id: 'v', resolved: true }, checkOutAt: '2026-09-20T00:00:00Z' }),
      ),
    ).toEqual({ kind: 'checked_out' });
  });

  it('is No show whatever else is recorded, and nothing before arrival', () => {
    expect(rowPill(record({ noShow: true }))).toEqual({ kind: 'no_show' });
    expect(rowPill(record({ status: 'confirmed', checkInAt: null }))).toBeNull();
  });
});

describe('the payable line (RULE-01; event-board.html:314-330)', () => {
  it('reads "payable 8.0 h · −0:20 break"', () => {
    expect(
      payableLine(
        record({ checkOutAt: '2026-09-20T01:04:00Z', payableMin: 480, unpaidBreakMin: 20 }),
      ),
    ).toBe('payable 8.0 h · −0:20 break');
  });

  it('carries the lateness and the lost floor', () => {
    expect(payableLine(record({ checkOutAt: 'x', payableMin: 378, minutesLate: 12 }))).toBe(
      'payable 6.3 h · Late 12 min',
    );
    expect(payableLine(record({ checkOutAt: 'x', payableMin: 222, leftEarly: true }))).toBe(
      'payable 3.7 h · no 4 h floor',
    );
  });

  it('is pending while a No check-out is unresolved — never a guessed figure (RULE-02)', () => {
    expect(payableLine(record({ noCheckout: { id: 'v', resolved: false } }))).toBe(
      'payable pending',
    );
  });

  it('is nothing before a check-in', () => {
    expect(payableLine(record({ checkInAt: null }))).toBeNull();
  });
});

describe("the Completed header's Result line (event-board.html:303)", () => {
  it('counts worked, no-shows and pending check-outs, and prices the payable hours', () => {
    const result = eventResult({
      sections: [
        {
          payRate: 14,
          chargeRate: 22.97,
          confirmed: [
            record({ checkOutAt: 'x', payableMin: 390 }),
            record({ checkOutAt: 'x', payableMin: 390 }),
            record({ noShow: true, checkInAt: null }),
            record({ noCheckout: { id: 'v', resolved: false } }),
          ],
        },
      ],
    });
    expect(result.worked).toBe(3);
    expect(result.noShows).toBe(1);
    expect(result.noCheckoutsPending).toBe(1);
    expect(result.payableHours).toBe(13);
    // 13 h × £22.97 charge; pay 13 h × £14 × 1.1207 broken out (§9.8).
    expect(result.chargePence).toBe(2 * Math.round(6.5 * 22.97 * 100));
    expect(result.marginPence).toBe(result.chargePence - 2 * Math.round(6.5 * 14 * 100 * 1.1207));
    expect(formatResult(result)).toBe(
      '3 worked · 1 no-show · 1 no check-out (pending) · 13 payable h · charge £299 · margin £95',
    );
  });
});

describe('Cancel event counts what N12 reaches (§3.3, CANCEL_NOTIFIES)', () => {
  it('breaks the three out and leaves a checked-in booking alone (§3.6)', () => {
    expect(
      cancelCounts([
        {
          confirmed: [{ status: 'confirmed' }, { status: 'confirmed' }, { status: 'worked' }],
          invited: [1, 2, 3],
          applied: [1],
        },
        { confirmed: [{ status: 'confirmed' }], invited: [], applied: [1] },
      ]),
    ).toEqual({ confirmed: 3, invited: 3, applied: 2 });
  });
});

describe('Duplicate copies the roles, not the staff (§3.2)', () => {
  const source = {
    role_id: 'role-waiting',
    starts_at: ukInstant('2026-09-18', '17:00').toISOString(),
    ends_at: ukInstant('2026-09-19', '01:30').toISOString(),
    headcount: 12,
    buffer: 2,
    charge_rate: '22.97',
    pay_rate: '14.00',
    dress_code: 'Black & whites',
    auto_assign: false,
    allocation_per_hour: 14,
  };

  it('keeps the UK wall-clock times on the new date, across a BST changeover', () => {
    const [clone] = cloneSections([source], '2026-11-20');
    expect(clone!.starts_at).toBe(ukInstant('2026-11-20', '17:00').toISOString());
    expect(clone!.ends_at).toBe(ukInstant('2026-11-21', '01:30').toISOString());
    expect(clone!).toMatchObject({
      role_id: 'role-waiting',
      headcount: 12,
      buffer: 2,
      charge_rate: 22.97,
      pay_rate: 14,
      dress_code: 'Black & whites',
      auto_assign: false,
      allocation_per_hour: 14,
    });
  });

  it('carries no booking, no id and no event id of its own', () => {
    const [clone] = cloneSections([source], '2026-09-19');
    expect(Object.keys(clone!)).not.toContain('id');
    expect(Object.keys(clone!)).not.toContain('event_id');
    expect(Object.keys(clone!)).not.toContain('bookings');
  });

  it('names the clone after the source until the manager renames it', () => {
    expect(cloneTitle('Trade Expo · Day 1')).toBe('Trade Expo · Day 1 (copy)');
  });
});
