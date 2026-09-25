import { cookies } from 'next/headers';
import { payableMinutes } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import type { EarningsRow, EmergencyContact, StaffProfile } from './types';
import { basePenceFor } from './payments/earnings';

/**
 * Everything the profile screens read — §10.1.
 *
 * Two RPCs, both `security definer` and both resolving the caller
 * themselves (`staff_caller()`), so nothing in this file names a worker:
 * there is no id here for a forged request to swap. That is the same
 * pattern `apps/staff/app/data.ts` uses for the working screens, and for
 * the same reason — the staff role holds a SELECT policy on its own `staff`
 * row and on `bookings`, and nothing on `shift_requirements`, `events` or
 * `roles`, which carry the charge rate and every other worker's record.
 */

export { supabaseConfigured };

export async function loadProfile(): Promise<StaffProfile | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data } = await supabase.rpc('staff_me');
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    staffId: row['staffId'] as string,
    firstName: (row['firstName'] as string) ?? '',
    lastName: (row['lastName'] as string) ?? '',
    employeeId: row['employeeId'] === null ? null : Number(row['employeeId']),
    email: (row['email'] as string) ?? '',
    phone: (row['phone'] as string) ?? '',
    homeAddress: (row['homeAddress'] as string) ?? null,
    photoPath: (row['photoPath'] as string) ?? null,
    photoLocked: Boolean(row['photoLocked']),
    status: row['status'] as StaffProfile['status'],
    blockKind: (row['blockKind'] as StaffProfile['blockKind']) ?? null,
    leftAt: (row['leftAt'] as string) ?? null,
    rtwBranch: (row['rtwBranch'] as string) ?? null,
    niMasked: (row['niMasked'] as string) ?? null,
    hasNiNumber: Boolean(row['hasNiNumber']),
    rating: row['rating'] === null ? null : Number(row['rating']),
    reliability: row['reliability'] === null ? null : Number(row['reliability']),
    quizAttempts: Number(row['quizAttempts'] ?? 0),
    rejectionCause: rejectionCause(row['rejectionCause']),
    roles: (row['roles'] as string[]) ?? [],
    blockers: (row['blockers'] as string[]) ?? [],
    checkedIn: Boolean(row['checkedIn']),
    bank: row['bank']
      ? {
          accountHolder: (row['bank'] as Record<string, string>)['accountHolder'] ?? '',
          sortCode: (row['bank'] as Record<string, string>)['sortCode'] ?? '',
          accountNumber: (row['bank'] as Record<string, string>)['accountNumber'] ?? '',
          updatedAt: (row['bank'] as Record<string, string>)['updatedAt'] ?? '',
        }
      : null,
  };
}

/**
 * Earnings history (§10.1).
 *
 * The payable figure is recomputed here with `payableMinutes` from
 * `@thc/domain` rather than trusted from the row, even though
 * `staff_earnings()` already returns the SQL function's answer. Both are
 * kept because they are the two implementations §9.9's payroll export and
 * this screen respectively run on, and `pay.vectors.json` asserts they
 * agree: if a worker's card and their payslip ever differ, that difference
 * shows up in CI rather than in a phone call.
 */
export async function loadEarnings(): Promise<EarningsRow[]> {
  if (!supabaseConfigured()) return [];
  const supabase = staffDb(await cookies());
  const { data } = await supabase.rpc('staff_earnings');

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const startsAt = new Date(row['starts_at'] as string);
    const endsAt = new Date(row['ends_at'] as string);
    const checkInAt = row['check_in_at'] ? new Date(row['check_in_at'] as string) : null;
    const checkOutAt = row['check_out_at'] ? new Date(row['check_out_at'] as string) : null;
    const unpaidBreakMin = Number(row['unpaid_break_min'] ?? 0);
    const payRate = Number(row['pay_rate'] ?? 0);

    const settled =
      checkInAt && checkOutAt
        ? payableMinutes({
            shift: { startsAt, endsAt },
            checkInAt,
            checkOutAt,
            unpaidBreakMin,
            // RULE-14. Both blockers on the four-hour floor come from the
            // row, so this and `payable_minutes()` are given identical
            // inputs and cannot reach different answers.
            leftEarlyViolation: Boolean(row['left_early']),
            noCheckOut: (row['no_check_out'] as 'none' | 'unresolved' | 'resolved') ?? 'none',
          })
        : null;

    const payableMin = settled?.payableMin ?? null;

    return {
      bookingId: row['booking_id'] as string,
      eventTitle: (row['event_title'] as string) ?? '',
      venueName: (row['venue_name'] as string) ?? '',
      venueAddress: (row['venue_address'] as string) ?? '',
      roleName: (row['role_name'] as string) ?? '',
      startsAt,
      endsAt,
      payRate,
      checkInAt,
      checkOutAt,
      unpaidBreakMin,
      payableMin,
      floorApplied: settled?.floorApplied ?? false,
      payDate: row['pay_date'] as string,
      basePence: payableMin === null ? null : basePenceFor(payableMin, payRate),
    };
  });
}

/**
 * The emergency contact (ADR-0037) — `my_emergency_contact()`, a separate
 * read because `staff_me()` is frozen in Phase 1 (docs/18 §0.6). Null when
 * none is saved; `undefined` when the read failed, so the Profile hub can
 * leave its "not set" nudge off rather than nag on a network error.
 */
export async function loadEmergencyContact(): Promise<EmergencyContact | null | undefined> {
  if (!supabaseConfigured()) return undefined;
  const { data, error } = await staffDb(await cookies()).rpc('my_emergency_contact', {});
  if (error) return undefined;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    name: (row['name'] as string) ?? '',
    relationship: (row['relationship'] as string) ?? '',
    phone: (row['phone'] as string) ?? '',
  };
}

/** `staff.rejection_cause`, or null for anything `staff_me()` does not say. */
function rejectionCause(value: unknown): StaffProfile['rejectionCause'] {
  return value === 'willo' || value === 'manager' || value === 'quiz_failed' ? value : null;
}
