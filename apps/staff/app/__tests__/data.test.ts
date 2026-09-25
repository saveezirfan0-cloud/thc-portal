import { describe, expect, it, vi } from 'vitest';
import type { BookingRow } from '../data';

/**
 * The pure rules in `data.ts` (§10.4, §10.1, §3.4): which invitations the
 * list still offers (RULE-16), what the Shifts badge counts, and the amber
 * overlap pre-warning an invitation carries before Accept.
 */
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { openInvites, overlapWarning, shiftsBadge } = await import('../data');

const NOW = new Date('2026-09-15T12:00:00Z');

const booking = (over: Partial<BookingRow> = {}): BookingRow => ({
  bookingId: over.bookingId ?? 'b',
  status: 'invited',
  source: 'auto',
  createdAt: NOW,
  confirmedAt: null,
  dayBeforeConfirmedAt: null,
  onDayConfirmedAt: null,
  reconfirmRequired: false,
  reconfirmReason: null,
  appliedAt: null,
  cancelCause: null,
  shiftId: 's',
  startsAt: new Date('2026-09-19T17:00:00Z'),
  endsAt: new Date('2026-09-20T00:00:00Z'),
  payRate: 15.5,
  dressCode: 'Black tie',
  headcount: 8,
  buffer: 1,
  confirmedCount: 2,
  role: 'Bar Staff',
  eventId: 'e',
  eventTitle: 'Product Launch — Bar',
  eventDate: '2026-09-19',
  venueName: 'Mandarin Oriental',
  venueAddress: '66 Knightsbridge, SW1X 7LA',
  eventCancelledAt: null,
  distanceKm: 3.4,
  onsiteContact: null,
  notes: null,
  paysBreaks: null,
  noCheckoutOpen: false,
  hoursLimit: false,
  weekStart: '2026-09-14',
  bookedHours: 8,
  capHours: 20,
  ...over,
});

describe('openInvites — RULE-16, the list side (§10.4)', () => {
  it('keeps an open invitation whose section has not ended', () => {
    expect(openInvites([booking({ bookingId: 'live' })], NOW).map((b) => b.bookingId)).toEqual([
      'live',
    ]);
  });

  it('drops one whose event has ended, even though nobody answered it', () => {
    const ended = booking({
      bookingId: 'ended',
      startsAt: new Date('2026-09-14T17:00:00Z'),
      endsAt: new Date('2026-09-14T23:00:00Z'),
    });
    expect(openInvites([ended], NOW)).toEqual([]);
  });

  it('drops one whose event the office cancelled (N12)', () => {
    const cancelled = booking({ bookingId: 'c', eventCancelledAt: new Date('2026-09-15T09:00Z') });
    expect(openInvites([cancelled], NOW)).toEqual([]);
  });

  it('is only ever about invitations — confirmed, applied and closed rows are not offered', () => {
    const rows = (['confirmed', 'applied', 'closed', 'cancelled', 'worked'] as const).map(
      (status) => booking({ bookingId: status, status }),
    );
    expect(openInvites(rows, NOW)).toEqual([]);
  });

  it('a section ending at exactly now is over', () => {
    expect(openInvites([booking({ endsAt: NOW })], NOW)).toEqual([]);
  });
});

describe('shiftsBadge — one reading for every tab (§10.1)', () => {
  it('counts the bookings the My shifts list shows: confirmed and worked', () => {
    const rows = (
      ['confirmed', 'worked', 'invited', 'applied', 'closed', 'cancelled', 'confirmed'] as const
    ).map((status) => booking({ status }));
    expect(shiftsBadge(rows)).toBe(3);
  });

  it('is zero with nothing booked', () => {
    expect(shiftsBadge([booking({ status: 'invited' })])).toBe(0);
  });
});

describe('overlapWarning — the amber line before Accept (§3.4, invites.html:57)', () => {
  // Awards Night · Waiting Staff, Tue 23 · 16:00 – 02:00 UK (BST = UTC+1).
  const heldAwards = booking({
    bookingId: 'held',
    status: 'confirmed',
    eventTitle: 'Awards Night',
    role: 'Waiting Staff',
    venueName: 'The Dorchester',
    venueAddress: '53 Park Lane, W1K 1QA',
    startsAt: new Date('2026-09-22T15:00:00Z'),
    endsAt: new Date('2026-09-23T01:00:00Z'),
  });

  it('names the confirmed booking the invitation overlaps, with its UK window', () => {
    const invite = booking({
      bookingId: 'inv',
      eventTitle: 'Awards Night',
      role: 'Bar Staff',
      venueName: 'The Dorchester',
      venueAddress: '53 Park Lane, W1K 1QA',
      startsAt: new Date('2026-09-22T16:00:00Z'),
      endsAt: new Date('2026-09-23T01:00:00Z'),
    });
    expect(overlapWarning(invite, [heldAwards, invite])).toBe(
      'Overlaps your confirmed Awards Night · Waiting Staff 16:00 – 02:00',
    );
  });

  it('a different venue under two hours away is warned about too', () => {
    const invite = booking({
      bookingId: 'inv',
      venueName: 'Mandarin Oriental',
      startsAt: new Date('2026-09-23T02:00:00Z'), // 90 min after the held one ends
      endsAt: new Date('2026-09-23T06:00:00Z'),
    });
    expect(overlapWarning(invite, [heldAwards])).toBe(
      'Within 2 h of your confirmed Awards Night · Waiting Staff 16:00 – 02:00 at another venue',
    );
  });

  it('back-to-back at the same venue is fine', () => {
    const invite = booking({
      bookingId: 'inv',
      venueName: 'The Dorchester',
      venueAddress: '53 Park Lane, W1K 1QA',
      startsAt: new Date('2026-09-23T01:00:00Z'),
      endsAt: new Date('2026-09-23T05:00:00Z'),
    });
    expect(overlapWarning(invite, [heldAwards])).toBeNull();
  });

  it('only CONFIRMED bookings count — other invitations and applications never block', () => {
    const invite = booking({
      bookingId: 'inv',
      startsAt: heldAwards.startsAt,
      endsAt: heldAwards.endsAt,
    });
    const asInvited = { ...heldAwards, status: 'invited' as const };
    const asApplied = { ...heldAwards, status: 'applied' as const };
    expect(overlapWarning(invite, [asInvited, asApplied])).toBeNull();
  });

  it('nothing to warn about with the calendar clear', () => {
    const invite = booking({
      bookingId: 'inv',
      startsAt: new Date('2026-09-25T07:00:00Z'),
      endsAt: new Date('2026-09-25T15:00:00Z'),
    });
    expect(overlapWarning(invite, [heldAwards])).toBeNull();
  });
});
