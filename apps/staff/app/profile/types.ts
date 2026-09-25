import type { StaffStatus } from '@thc/domain';

/**
 * What `staff_me()` hands the profile screens (§10.1).
 *
 * `blockReason` is absent by construction, not by omission: the RPC does
 * not select it. §10.1 — "The manager's reason for the block is internal
 * and is never shown to the worker" — so there is no field here for a
 * future screen to render it into by accident.
 */
export interface StaffProfile {
  staffId: string;
  firstName: string;
  lastName: string;
  employeeId: number | null;
  email: string;
  phone: string;
  homeAddress: string | null;
  photoPath: string | null;
  /** True once a selfie exists. §10.1 locks it from then on. */
  photoLocked: boolean;
  status: StaffStatus;
  blockKind: 'auto_document' | 'manual' | 'conviction_review' | null;
  leftAt: string | null;
  rtwBranch: string | null;
  /** "●●●●●●●2B", or null while no NI number is on file. */
  niMasked: string | null;
  hasNiNumber: boolean;
  rating: number | null;
  /** Show-rate, as a percentage. */
  reliability: number | null;
  quizAttempts: number;
  /**
   * Why a `rejected` row is rejected — `staff.rejection_cause`. The reason
   * itself stays internal (20260923220000); the cause picks the screen:
   * only `quiz_failed` carries E4's wording (§10.1 case 3). Null until
   * `staff_me()` exposes the column, when `appLock` falls back to counting
   * attempts. Optional so a profile built elsewhere need not carry it.
   */
  rejectionCause?: 'willo' | 'manager' | 'quiz_failed' | null;
  roles: string[];
  /** `compliance_blockers()` reasons, e.g. `document_expired:passport`. */
  blockers: string[];
  /** Checked in and not yet checked out — §10.6 step 3 disables the P45 action. */
  checkedIn: boolean;
  bank: BankDetails | null;
}

export interface BankDetails {
  accountHolder: string;
  sortCode: string;
  accountNumber: string;
  updatedAt: string;
}

/** One card in Earnings history (§10.1). Base pay only — see `staff_earnings()`. */
export interface EarningsRow {
  bookingId: string;
  eventTitle: string;
  venueName: string;
  venueAddress: string;
  roleName: string;
  startsAt: Date;
  endsAt: Date;
  /** The worker's BASE rate. The charge rate never reaches this app. */
  payRate: number;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  unpaidBreakMin: number;
  payableMin: number | null;
  /** RULE-14 lifted the figure to the four-hour minimum. */
  floorApplied: boolean;
  /** The Friday THC pays this shift on — derived, never stored. */
  payDate: string;
  basePence: number | null;
}

export type ActionResult = { ok: true; note?: string } | { ok: false; message: string };

export const HELP_EMAIL = 'admin@thehospitalitycompany.co.uk';
