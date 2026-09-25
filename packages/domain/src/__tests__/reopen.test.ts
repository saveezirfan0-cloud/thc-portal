import { describe, expect, it } from 'vitest';
import {
  CANCEL_CAUSES,
  bookingReopenableBy,
  canTransitionBooking,
  excludesFromEvent,
  type Reopener,
} from '../state';

/**
 * Who may reopen an ended booking row (§3.6, §3.4, §10.4; D33, ADR-0031).
 * booking_reopenable_by() in 20260929110100 is the same table, asserted
 * cause for cause in supabase/tests/616_additive_rounds_and_reopen.sql.
 */
const EXPECTED: Record<string, Reopener> = {
  // cancelled
  office_withdraw: 'person',
  ready_cutoff: 'person',
  self_cancel: 'never',
  overlap_auto_withdraw: 'anyone',
  event_cancelled: 'never',
  blocked: 'anyone',
  blocked_invite: 'anyone',
  left: 'anyone',
  left_invite: 'anyone',
  gdpr: 'never',
  gdpr_invite: 'never',
  // closed
  slot_taken: 'anyone',
  declined: 'person',
  withdrawn_by_worker: 'person',
};

const CLOSED = ['slot_taken', 'declined', 'withdrawn_by_worker'];

describe('bookingReopenableBy', () => {
  it('classifies every cause in the §3.6 vocabulary', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...CANCEL_CAUSES].sort());
    for (const cause of CANCEL_CAUSES) {
      const status = CLOSED.includes(cause) ? 'closed' : 'cancelled';
      expect(bookingReopenableBy(status, cause), cause).toBe(EXPECTED[cause]);
    }
  });

  it('of the causes a worker or the office brings about, only self-cancel bars for good (RULE-04, §3.6)', () => {
    const never = CANCEL_CAUSES.filter((c) => EXPECTED[c] === 'never');
    // The other three are dead ends rather than exclusions: the event is
    // cancelled, or the person is gone (GDPR).
    expect(never.filter(excludesFromEvent)).toEqual(['self_cancel']);
    expect([...never].sort()).toEqual(['event_cancelled', 'gdpr', 'gdpr_invite', 'self_cancel']);
  });

  it('a live row is not reopened: that is already_has_booking', () => {
    for (const status of ['invited', 'applied', 'confirmed', 'worked', 'turned_away']) {
      expect(bookingReopenableBy(status, null)).toBeNull();
    }
  });

  it('a legacy ended row with no cause counts as a decision, reopened by a person only', () => {
    expect(bookingReopenableBy('cancelled', null)).toBe('person');
    expect(bookingReopenableBy('closed', null)).toBe('person');
  });

  it('every reopen is an edge of the state machine, and nothing skips the fresh offer', () => {
    for (const from of ['cancelled', 'closed'] as const) {
      expect(canTransitionBooking(from, 'invited')).toBe(true);
      expect(canTransitionBooking(from, 'applied')).toBe(true);
      expect(canTransitionBooking(from, 'confirmed')).toBe(false);
    }
  });
});
