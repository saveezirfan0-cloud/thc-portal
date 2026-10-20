import { describe, expect, it } from 'vitest';
import { staleInviteTarget } from '../stale';

/** §8 N5 deep-links /invites/:id; a tap after the invitation moved on (§10.4). */
const row = (status: string, eventCancelledAt: Date | null = null) => ({
  bookingId: 'b-1',
  status,
  eventCancelledAt,
});

describe('staleInviteTarget()', () => {
  it('leaves an open invitation on its own screen', () => {
    expect(staleInviteTarget(row('invited'))).toBeNull();
  });

  it('sends an accepted invitation to the shift, not a 404', () => {
    expect(staleInviteTarget(row('confirmed'))).toBe('/shifts/b-1');
    expect(staleInviteTarget(row('worked'))).toBe('/shifts/b-1');
    expect(staleInviteTarget(row('turned_away'))).toBe('/shifts/b-1');
  });

  it('sends an invitation whose event was cancelled to the static "cancelled" screen', () => {
    expect(staleInviteTarget(row('cancelled', new Date('2026-10-20T10:00:00Z')))).toBe(
      '/shifts/b-1',
    );
  });

  it('keeps the 404 for a declined, closed or office-withdrawn invitation', () => {
    expect(staleInviteTarget(row('closed'))).toBeNull();
    // Withdrawn by the office: N10d said so; /shifts would say "removed".
    expect(staleInviteTarget(row('cancelled'))).toBeNull();
  });
});
