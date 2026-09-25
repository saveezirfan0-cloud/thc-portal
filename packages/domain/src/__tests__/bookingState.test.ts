import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import vectors from '../bookingState.vectors.json' with { type: 'json' };
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  CANCEL_CAUSES,
  CANCELLED_CAUSES,
  CLOSED_CAUSES,
  IllegalTransitionError,
  assertBookingTransition,
  canCancelBooking,
  canTransitionBooking,
  cancelCauseStatus,
  excludesFromEvent,
  isCancelCause,
  type BookingStatus,
  type CancelCause,
} from '../state';
import {
  BOOKING_VECTORS_PSQL,
  renderBookingStateVectors,
} from '../../../../supabase/tests/_shared/booking-state-vectors.mjs';

/**
 * The §3.6 booking machine exists twice: BOOKING_TRANSITIONS in state.ts and
 * booking_transitions() + the bookings_state_guard trigger in
 * 20260924120000_booking_state_machine.sql. Both are held to
 * bookingState.vectors.json — here, and in 490_booking_state_machine.sql
 * through the generated booking_state_vectors.psql.
 */
const edge = (from: string, to: string) => `${from}->${to}`;
const vectorEdges = new Set(vectors.edges.map((e) => edge(e.from, e.to)));

describe('booking state machine — shared vectors (TS ↔ SQL booking_transitions)', () => {
  it('models all seven states the database can hold', () => {
    expect([...BOOKING_STATUSES].sort()).toEqual([...vectors.statuses].sort());
    expect(BOOKING_STATUSES).toHaveLength(7);
  });

  it('has exactly the edges of the vectors file', () => {
    const ts = Object.entries(BOOKING_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => edge(from, to)),
    );
    expect(ts.sort()).toEqual([...vectorEdges].sort());
  });

  const pairs = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_STATUSES.map((to) => [from, to] as [BookingStatus, BookingStatus]),
  );
  it.each(pairs)('%s → %s', (from, to) => {
    const legal = from === to || vectorEdges.has(edge(from, to));
    expect(canTransitionBooking(from, to)).toBe(legal);
    if (legal) expect(() => assertBookingTransition(from, to)).not.toThrow();
    else expect(() => assertBookingTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it('every edge carries its § reference', () => {
    for (const e of vectors.edges) expect(e.ref).toMatch(/§|RULE-/);
  });

  it('supabase/tests/_shared/booking_state_vectors.psql matches bookingState.vectors.json', () => {
    expect(readFileSync(BOOKING_VECTORS_PSQL, 'utf8')).toBe(renderBookingStateVectors(vectors));
  });
});

describe('the transitions the write paths make (§3.4, §3.5, §3.6, §10.4, RULE-15)', () => {
  it.each([
    ['accept_invite', 'invited', 'confirmed'],
    ['accept_invite · slot taken', 'invited', 'closed'],
    ['decline_invite', 'invited', 'closed'],
    ['overlap auto-withdraw', 'invited', 'cancelled'],
    ['office Withdraw an invitation', 'invited', 'cancelled'],
    ['application taken forward (N10)', 'applied', 'confirmed'],
    ['withdraw_application', 'applied', 'closed'],
    ['event cancelled with an application pending (N12)', 'applied', 'cancelled'],
    ['apply_to_shift revives a closed offer', 'closed', 'applied'],
    ['attempt_check_in · accepted', 'confirmed', 'worked'],
    ['attempt_check_in · strict buffer', 'confirmed', 'turned_away'],
    ['release_unready_bookings (12:05)', 'confirmed', 'cancelled'],
  ] as const)('%s: %s → %s', (_path, from, to) => {
    expect(canTransitionBooking(from, to)).toBe(true);
  });

  it.each([
    ['a confirmed booking is not un-accepted', 'confirmed', 'invited'],
    ['a worked shift is not cancelled after the fact', 'worked', 'cancelled'],
    ['a turned-away worker is not checked in later', 'turned_away', 'worked'],
    ['a cancelled booking is not revived (RULE-04, Withdraw)', 'cancelled', 'applied'],
    ['a closed offer is not accepted, only re-applied for', 'closed', 'confirmed'],
    ['nobody is invited out of an application', 'applied', 'invited'],
  ] as const)('%s: %s → %s is refused', (_why, from, to) => {
    expect(canTransitionBooking(from, to)).toBe(false);
  });

  it('offers Withdraw only where cancelled is an edge', () => {
    expect(canCancelBooking('invited')).toBe(true);
    expect(canCancelBooking('applied')).toBe(true);
    expect(canCancelBooking('confirmed')).toBe(true);
    expect(canCancelBooking('worked')).toBe(false);
    expect(canCancelBooking('turned_away')).toBe(false);
    expect(canCancelBooking('cancelled')).toBe(false);
    expect(canCancelBooking('closed')).toBe(false);
    expect(canCancelBooking('nonsense')).toBe(false);
  });
});

describe('cancel_cause — one vocabulary (docs/14 B3)', () => {
  it('is the vectors file cause for cause, each with its one status', () => {
    expect([...CANCEL_CAUSES].sort()).toEqual(vectors.cancelCauses.map((c) => c.cause).sort());
    for (const c of vectors.cancelCauses) {
      expect(isCancelCause(c.cause)).toBe(true);
      expect(cancelCauseStatus(c.cause as CancelCause)).toBe(c.status);
    }
    expect(CANCELLED_CAUSES.length + CLOSED_CAUSES.length).toBe(CANCEL_CAUSES.length);
  });

  it('retires the old spellings, each mapped by the migration', () => {
    expect(vectors.legacyCauses).toEqual({
      withdraw: 'office_withdraw',
      cutoff: 'ready_cutoff',
      compliance_block: 'blocked',
    });
    for (const [legacy, now] of Object.entries(vectors.legacyCauses)) {
      expect(isCancelCause(legacy)).toBe(false);
      expect(isCancelCause(now)).toBe(true);
    }
  });

  it('only a self-cancel and a completed hand-over exclude the worker from the event (RULE-04, ADR-0039)', () => {
    expect(CANCEL_CAUSES.filter(excludesFromEvent)).toEqual(['self_cancel', 'handed_over']);
    expect(excludesFromEvent('handed_over')).toBe(true);
    expect(cancelCauseStatus('handed_over')).toBe('cancelled');
  });

  it('carries every literal cause the SQL write paths emit', () => {
    const dir = join(import.meta.dirname, '../../../../supabase/migrations');
    const written = new Set<string>();
    for (const file of [
      '20260921141500_auto_assign.sql',
      '20260922140000_staff_app_screens.sql',
      '20260922160000_accept_invite_event_ended.sql',
    ]) {
      const sql = readFileSync(join(dir, file), 'utf8');
      for (const m of sql.matchAll(/cancel_cause\s*=\s*'([a-z_]+)'/g)) written.add(m[1]!);
    }
    expect(written.size).toBeGreaterThan(0);
    for (const cause of written) expect(isCancelCause(cause), cause).toBe(true);
    // block_worker() writes p_cause and p_cause || '_invite' for these three.
    for (const base of ['blocked', 'left', 'gdpr']) {
      expect(isCancelCause(base)).toBe(true);
      expect(isCancelCause(`${base}_invite`)).toBe(true);
    }
  });
});
