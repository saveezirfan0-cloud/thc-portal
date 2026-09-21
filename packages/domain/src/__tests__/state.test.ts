import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUSES,
  IllegalTransitionError,
  STAFF_STATUSES,
  assertBookingTransition,
  assertStaffTransition,
  canTransitionBooking,
  canTransitionStaff,
  excludesFromEvent,
  isBookable,
} from '../state';

describe('staff state machine (§2.12)', () => {
  it('walks the happy path from application to compliant', () => {
    const path = [
      'interview_requested',
      'interview_completed',
      'documents',
      'quiz',
      'contract',
      'compliant',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionStaff(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('treats removed as terminal and irreversible', () => {
    for (const status of STAFF_STATUSES) {
      expect(canTransitionStaff('removed', status)).toBe(false);
    }
  });

  it('lets a blocked worker be unblocked but never a leaver', () => {
    expect(canTransitionStaff('blocked', 'compliant')).toBe(true);
    expect(canTransitionStaff('inactive', 'compliant')).toBe(false);
  });

  it('leaves inactive only by Reset to candidate', () => {
    expect(canTransitionStaff('inactive', 'interview_requested')).toBe(true);
    expect(canTransitionStaff('inactive', 'documents')).toBe(false);
  });

  it('never skips the quiz or the contract', () => {
    expect(canTransitionStaff('documents', 'compliant')).toBe(false);
    expect(canTransitionStaff('quiz', 'compliant')).toBe(false);
  });

  it('only compliant workers are bookable', () => {
    for (const status of STAFF_STATUSES) {
      expect(isBookable(status)).toBe(status === 'compliant');
    }
  });

  it('throws a typed error on an illegal transition', () => {
    expect(() => assertStaffTransition('removed', 'compliant')).toThrow(IllegalTransitionError);
    expect(() => assertStaffTransition('compliant', 'blocked')).not.toThrow();
  });
});

describe('booking state machine (§3.6)', () => {
  it('goes invited → confirmed → worked', () => {
    expect(canTransitionBooking('invited', 'confirmed')).toBe(true);
    expect(canTransitionBooking('confirmed', 'worked')).toBe(true);
  });

  it('never jumps straight from invited to worked', () => {
    expect(canTransitionBooking('invited', 'worked')).toBe(false);
  });

  it('treats worked and cancelled as terminal', () => {
    for (const status of BOOKING_STATUSES) {
      expect(canTransitionBooking('worked', status)).toBe(false);
      expect(canTransitionBooking('cancelled', status)).toBe(false);
    }
  });

  it('only a self-cancel excludes the worker from the event (RULE-04)', () => {
    expect(excludesFromEvent('self_cancel')).toBe(true);
    expect(excludesFromEvent('office_withdraw')).toBe(false);
    expect(excludesFromEvent('ready_cutoff')).toBe(false);
  });

  it('throws a typed error on an illegal transition', () => {
    expect(() => assertBookingTransition('worked', 'cancelled')).toThrow(IllegalTransitionError);
  });
});
