/** The §9.5 monitor's shapes. `checkin_monitor_v` resolves the status in SQL. */

/** Every Status the monitor can show. §9.5 has no separate No-show pill. */
export type MonitorStatus =
  | 'checked_out'
  | 'no_check_out'
  | 'off_site'
  | 'on_shift'
  | 'not_checked_in'
  | 'not_confirmed_today'
  | 'due';

export interface MonitorRow {
  bookingId: string;
  staffId: string;
  eventId: string;
  eventTitle: string;
  roleName: string;
  staffName: string;
  /** A short-lived signed URL for the selfie (`_lib/photos.ts`); null → initials. */
  photoUrl: string | null;
  /** The ROLE SECTION's window (RULE-18), never the event's. */
  startsAt: string;
  endsAt: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  lastFixInside: boolean | null;
  lastFixAt: string | null;
  /** NULL — not 0 — where the client pays for breaks (§9.5). */
  breaksCount: number | null;
  lastBreakAt: string | null;
  lateCheckOut: boolean;
  status: MonitorStatus;
}

export type ViolationType = 'no_show' | 'late' | 'left_early' | 'left_geofence' | 'no_checkout';

export interface ViolationRow {
  id: string;
  bookingId: string;
  staffName: string;
  /** A short-lived signed URL for the selfie (`_lib/photos.ts`); null → initials. */
  photoUrl: string | null;
  eventTitle: string;
  venueName: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  type: ViolationType;
  detectedAt: string;
  minutesLate: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  actualFinishAt: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  /** RULE-06: the shift is already in an export, so a change cannot be topped up. */
  payrollExported: boolean;
}
