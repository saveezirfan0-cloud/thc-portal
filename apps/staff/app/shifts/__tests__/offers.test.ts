import { describe, expect, it } from 'vitest';
import { ACCEPT_REFUSAL_COPY, APPLY_REFUSAL_COPY, TAKE_OFFER_REFUSALS } from '@thc/domain';
import {
  COVER_LEAD,
  COVER_REFUSAL_COPY,
  COVER_REQUESTED,
  OFFER_REFUSAL_COPY,
  offerDialogBody,
  offeredCardLine,
  offeredChip,
  offerPanel,
  takeRefusalCopy,
  ukDateTime,
  ukShortDateTime,
} from '../offers';
import { toBookingOffer, toOpenOffer } from '../offers-data';
import { HANDED_OVER_COPY } from '../[id]/messages';
import { isStaticPhase, shiftPhase, shiftScreenReachable } from '../[id]/phase';

/**
 * Offer up a shift in the Staff App — ADR-0039, docs/18 §4,
 * wireframes/staff/offer-shift.html.
 */

/** Tue 23 Sep 2026, 16:00 UK (BST). */
const START = new Date('2026-09-23T15:00:00Z');
const hoursBefore = (h: number, ms = 0) => new Date(START.getTime() - h * 3_600_000 - ms);

const offerOn = { autoAssign: true, offerId: null, mode: null } as const;

describe('which offer panel a confirmed shift shows (RULE-04 boundary)', () => {
  const booking = { status: 'confirmed', startsAt: START };

  it('offers it to other workers while MORE than 72 hours remain, auto-assign on', () => {
    expect(offerPanel(booking, offerOn, hoursBefore(72, 1))).toBe('offer');
  });

  it('at exactly 72 hours only the office can arrange cover', () => {
    expect(offerPanel(booking, offerOn, hoursBefore(72))).toBe('cover');
    expect(offerPanel(booking, offerOn, hoursBefore(2))).toBe('cover');
  });

  it('with auto-assign off it is the office however far out', () => {
    expect(offerPanel(booking, { ...offerOn, autoAssign: false }, hoursBefore(500))).toBe('cover');
  });

  it('an open offer shows its chip; an open cover request shows "Cover requested"', () => {
    const now = hoursBefore(100);
    expect(offerPanel(booking, { autoAssign: true, offerId: 'o1', mode: 'pool' }, now)).toBe(
      'offered',
    );
    expect(offerPanel(booking, { autoAssign: true, offerId: 'o1', mode: 'office' }, now)).toBe(
      'cover_requested',
    );
  });

  it('nothing once the shift has started, or for a booking that is not confirmed', () => {
    expect(offerPanel(booking, offerOn, START)).toBe('none');
    expect(offerPanel({ status: 'worked', startsAt: START }, offerOn, hoursBefore(100))).toBe(
      'none',
    );
  });
});

describe('the words, as docs/18 §4 fixes them', () => {
  it('the Offer dialog, verbatim, closing 72 hours before the start in UK time', () => {
    expect(offerDialogBody(START)).toBe(
      "We'll offer this shift to other workers. You stay booked until someone takes it — then it's theirs, and you can't be booked on this event again. Offers close Sun 20 Sep, 16:00 (UK time), 72 hours before the start.",
    );
  });

  it('the chip and the card line (wireframe (c), (d))', () => {
    const expires = new Date('2026-09-20T15:00:00Z');
    expect(offeredChip(expires)).toBe('Offered · open until Sun 20, 16:00');
    expect(offeredCardLine(expires)).toBe('Offered to other workers · open until Sun 20, 16:00');
    expect(ukShortDateTime(expires)).toBe('Sun 20, 16:00');
    expect(ukDateTime(expires)).toBe('Sun 20 Sep, 16:00');
  });

  it('Ask the office for cover, and what the worker reads after', () => {
    expect(COVER_LEAD).toBe("Can't make it?");
    expect(COVER_REQUESTED).toBe(
      "Cover requested — the office will be in touch. You're still booked until they confirm.",
    );
  });

  it('the handed-over screen', () => {
    expect(HANDED_OVER_COPY.title).toBe("You handed this shift over — it's now someone else's.");
    expect(HANDED_OVER_COPY.badge).toBe('Handed over');
  });
});

describe('refusals', () => {
  it('every take refusal is answered in Radar’s existing words — no new wording', () => {
    const existing = new Set(
      [...Object.values(APPLY_REFUSAL_COPY), ...Object.values(ACCEPT_REFUSAL_COPY)].map(
        (c) => c.title,
      ),
    );
    for (const reason of TAKE_OFFER_REFUSALS) {
      const copy = takeRefusalCopy(reason);
      expect(copy, reason).toBeDefined();
      expect(existing.has(copy!.title), reason).toBe(true);
    }
    // Wireframe (j): taken by someone else first reads as a shift that filled.
    expect(takeRefusalCopy('offer_not_open')).toEqual(APPLY_REFUSAL_COPY.full);
    expect(takeRefusalCopy('overlap')).toEqual(APPLY_REFUSAL_COPY.booked_elsewhere);
  });

  it('every offer_shift and request_cover refusal has words', () => {
    for (const reason of [
      'too_late',
      'auto_assign_off',
      'already_offered',
      'not_confirmed',
      'event_cancelled',
    ]) {
      expect(OFFER_REFUSAL_COPY[reason], reason).toBeDefined();
    }
    for (const reason of [
      'use_offer',
      'note_too_long',
      'already_offered',
      'section_started',
      'not_confirmed',
      'event_cancelled',
    ]) {
      expect(COVER_REFUSAL_COPY[reason], reason).toBeDefined();
    }
  });
});

describe('the handed-over static screen (cancel cause handed_over)', () => {
  const handed = {
    startsAt: START.toISOString(),
    endsAt: new Date(START.getTime() + 10 * 3_600_000).toISOString(),
    confirmedAt: null,
    checkInAt: null,
    checkOutAt: null,
    status: 'cancelled' as const,
    cancelCause: 'handed_over' as const,
    eventCancelledAt: null,
    noCheckoutOpen: false,
  };

  it('is reachable and static — no map, no check-in', () => {
    expect(shiftScreenReachable(handed)).toBe(true);
    const phase = shiftPhase({ shift: handed, openBreak: false, now: hoursBefore(1) });
    expect(phase).toBe('handed_over');
    expect(isStaticPhase(phase)).toBe(true);
  });

  it('a self-cancel is still not a screen of the worker’s', () => {
    expect(shiftScreenReachable({ ...handed, cancelCause: 'self_cancel' })).toBe(false);
  });
});

describe('reading the offer RPCs', () => {
  it('staff_booking_offers() rows', () => {
    expect(
      toBookingOffer({
        booking_id: 'b1',
        auto_assign: true,
        offer_id: 'o1',
        offer_mode: 'office',
        offer_expires_at: '2026-09-23T15:00:00Z',
        offer_note: 'Exam',
      }),
    ).toEqual({
      bookingId: 'b1',
      autoAssign: true,
      offerId: 'o1',
      mode: 'office',
      expiresAt: new Date('2026-09-23T15:00:00Z'),
      note: 'Exam',
    });
    expect(
      toBookingOffer({ booking_id: 'b2', auto_assign: false, offer_id: null, offer_mode: null }),
    ).toMatchObject({ offerId: null, mode: null, expiresAt: null, autoAssign: false });
  });

  it('staff_open_offers() rows carry no offerer at all', () => {
    const offer = toOpenOffer({
      offer_id: 'o1',
      shift_id: 's1',
      event_id: 'e1',
      event_title: 'Awards Night',
      event_date: '2026-09-23',
      role: 'Waiting Staff',
      starts_at: '2026-09-23T15:00:00Z',
      ends_at: '2026-09-24T01:00:00Z',
      pay_rate: '14.00',
      dress_code: 'Black tie',
      venue_name: 'The Dorchester',
      venue_address: '53 Park Lane',
      distance_km: '4.1',
      expires_at: '2026-09-20T15:00:00Z',
      qualified: true,
      venue_lat: 51.5,
      venue_lng: -0.15,
      geofence_radius_m: 150,
      home_lat: null,
      home_lng: null,
    });
    expect(offer).toMatchObject({ payRate: 14, distanceKm: 4.1, qualified: true, homeLat: null });
    expect(Object.keys(offer).some((k) => /offer(ed)?By|staff/i.test(k))).toBe(false);
  });
});
