import type { CancelCause, NoCheckOutState } from '@thc/domain';

/** The one shift the worker is looking at (§10.4, §5.1–5.2b). */
export interface ShiftDetail {
  bookingId: string;
  status: string;
  confirmedAt: string | null;
  /** `bookings.cancel_cause` — the N10b static screen keys on `office_withdraw`. */
  cancelCause: CancelCause | null;
  /** `events.cancelled_at` — the N12 static screen (§10.4). */
  eventCancelledAt: string | null;
  /** RULE-02: an unresolved No check-out violation — the static screen, card stays. */
  noCheckoutOpen: boolean;
  /** RULE-14: a logged Left-early violation blocks the four-hour floor, resolved or not. */
  leftEarly: boolean;
  /** `YYYY-MM-DD`, the event's date, for the static screens' "event · date · venue" line. */
  eventDate: string;
  eventTitle: string;
  venueName: string;
  venueAddress: string;
  onsiteContact: string | null;
  notes: string | null;
  dressCode: string | null;
  roleName: string;
  /** The ROLE SECTION's window (RULE-18), which is what every rule here uses. */
  startsAt: string;
  endsAt: string;
  /** The worker's own rate. Base only — never the +12.07% (§9.8). */
  payRate: number;
  venueLat: number;
  venueLng: number;
  geofenceRadiusM: number;
  /** False where the client pays for breaks: the block does not exist at all. */
  breaksLogged: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  /** RULE-02 for RULE-14: whether a No check-out violation exists and is resolved. */
  noCheckOut: NoCheckOutState;
  /**
   * RULE-15: the strict-buffer turn-away, when `attempt_check_in` logged
   * one — `attempted_at` decides the flat 4 hours (on time) or nothing.
   */
  turnedAwayAt: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
}

export type { GpsFix } from '../useGeoFix';
