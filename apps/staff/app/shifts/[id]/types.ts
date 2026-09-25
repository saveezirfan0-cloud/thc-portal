import type { CancelCause, StaffBookingStatus } from '@thc/domain';

/** The one shift the worker is looking at (§10.4, §5.1–5.2b). */
export interface ShiftDetail {
  bookingId: string;
  status: StaffBookingStatus;
  confirmedAt: string | null;
  eventTitle: string;
  /** The event's date, `YYYY-MM-DD`, for the static screens' summary line. */
  eventDate: string;
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
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
  /** §10.4's three dead ends — `staticScreenCase()` reads these. */
  eventCancelledAt: string | null;
  cancelCause: CancelCause | null;
  /** An unresolved RULE-02 No check-out violation stands on this booking. */
  noCheckoutOpen: boolean;
  /**
   * §3.2 strict buffer policy: the logged turn-away attempt
   * (`check_logs.attempted_at`), null where there was none.
   */
  turnedAwayAt: string | null;
  /**
   * RULE-15's minutes for that attempt as SQL decided them
   * (`turned_away_minutes()`): 240 inside the grace, 0 after it, null
   * without a turn-away. The "paid for 4 hours" sentence reads this, never
   * the phone's clock.
   */
  turnedAwayPayMin: number | null;
}

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}
