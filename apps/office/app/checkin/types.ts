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
  /**
   * The recorded finish is more than 15 minutes past the section's end:
   * paid and charged to it, flagged "Signed out late" (ADR-0184).
   */
  lateCheckOut: boolean;
  /** ADR-0184: when the office verified the late sign-out with the worker; null until then. */
  lateCheckOutVerifiedAt?: string | null;
  lateCheckOutVerifiedByName?: string | null;
  lateCheckOutNote?: string | null;
  /**
   * RULE-20 with ADR-0184, on a late sign-out only: the hours counted
   * against the worker's weekly cap for the section's Mon–Sun week (paid
   * overrun included), and the cap. Null when not late, or no cap.
   */
  weekHours?: number | null;
  weekCapHours?: number | null;
  /**
   * `check_logs.location_suspect` (20261012121200): the arrival's fix had no
   * accuracy, one wider than the geofence, or sat on the venue's centre (a
   * pasted coordinate), or an on-site check-out fix did. A flag for the
   * manager — it never refused the check-in (§5.1 decides on the geofence).
   */
  locationSuspect: boolean;
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
  /**
   * §9.5's "Flagged as" line, composed by the loader: violation name + event
   * ("Checked out early — Gala Dinner"). Optional so a row built elsewhere
   * still renders; the window composes it the same way when it is absent.
   */
  flaggedAs?: string;
}

/**
 * One late sign-out still to verify (ADR-0184), from `late_check_outs()`:
 * any section that ended in the last fortnight, not just today's board.
 */
export interface LateCheckOutRow {
  bookingId: string;
  staffName: string;
  photoUrl: string | null;
  eventTitle: string;
  venueName: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  checkInAt: string | null;
  checkOutAt: string;
  /** The finish was entered by the office resolving a No check-out. */
  finishByOffice: boolean;
  minutesPastEnd: number;
  verifiedAt: string | null;
  verifiedByName: string | null;
  note: string | null;
  /** RULE-20: the week's counted hours (overrun included) and the cap. */
  weekHours: number | null;
  weekCapHours: number | null;
}

/** What the Verify window needs, from a monitor row or the list. */
export interface LateCheckOutTarget {
  bookingId: string;
  staffName: string;
  eventTitle: string;
  roleName: string;
  endsAt: string;
  checkOutAt: string;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  note?: string | null;
  weekHours?: number | null;
  weekCapHours?: number | null;
}
