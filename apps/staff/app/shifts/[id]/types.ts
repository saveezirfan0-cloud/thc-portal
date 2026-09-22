/** The one shift the worker is looking at (§10.4, §5.1–5.2b). */
export interface ShiftDetail {
  bookingId: string;
  status: string;
  confirmedAt: string | null;
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
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
}

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}
