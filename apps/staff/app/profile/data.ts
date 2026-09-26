import { cookies } from 'next/headers';
import { payableMinutes } from '@thc/domain';
import { StaffLoadError, staffDb, supabaseConfigured } from '../db';
import type { Found, Loaded } from '../data';
import type { EarningsRow, EmergencyContact, StaffProfile } from './types';
import { basePenceFor } from './payments/earnings';
import { toChangeRequest } from './change-requests';
import type { ChangeRequest } from './change-requests';

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

export { StaffLoadError, supabaseConfigured };

/**
 * The three answers a profile read can give, kept apart (audit D16, D18).
 *
 *   unconfigured  no Supabase project in this environment (docs/04). A
 *                 developer's machine; nothing to lock on, nothing to show.
 *   ok            the worker's own row.
 *   problem       the project is there and the read failed, or came back
 *                 with no row for a signed-in worker. This is NOT "no
 *                 profile": the app lock is computed from this row, so a
 *                 screen that treated it as unlocked would show a blocked
 *                 worker their shifts on the strength of a timeout. Every
 *                 caller fails CLOSED on it.
 */
export type ProfileRead =
  | { kind: 'unconfigured' }
  | { kind: 'ok'; profile: StaffProfile }
  | { kind: 'problem'; message: string };

export async function readProfile(): Promise<ProfileRead> {
  if (!supabaseConfigured()) return { kind: 'unconfigured' };
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('staff_me');
  if (error) return { kind: 'problem', message: error.message || 'staff_me failed' };
  if (!data) return { kind: 'problem', message: 'staff_me returned no row' };
  return { kind: 'ok', profile: toProfile(data as Record<string, unknown>) };
}

/**
 * The profile, or null where no project is configured. A failed read
 * THROWS (into `app/error.tsx`) rather than returning null, because null
 * used to read as "nothing to lock on" (audit D16).
 */
export async function loadProfile(): Promise<StaffProfile | null> {
  const read = await readProfile();
  if (read.kind === 'unconfigured') return null;
  if (read.kind === 'problem') throw new StaffLoadError(read.message);
  return read.profile;
}

/** One `staff_me()` object in the screens' shape. */
export function toProfile(row: Record<string, unknown>): StaffProfile {
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
  const { data, error } = await supabase.rpc('staff_earnings');
  // A failed read is not "No earnings yet" (audit D18): it goes to the
  // error boundary, which says so and offers the retry.
  if (error) throw new StaffLoadError(error.message || 'staff_earnings failed');

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
 * The emergency contact (ADR-0044) — `my_emergency_contact()`, a separate
 * read because `staff_me()` is frozen in Phase 1 (docs/19 §0.6).
 *
 * `row: null` is "none saved"; `problem` is "could not read" (audit D18),
 * and the two are never folded together: an empty form offered over a
 * contact we could not see would overwrite it, and a "not set" nudge on a
 * network error would nag a worker who has one.
 */
export async function loadEmergencyContact(): Promise<Found<EmergencyContact>> {
  if (!supabaseConfigured()) return { row: null, problem: null };
  const { data, error } = await staffDb(await cookies()).rpc('my_emergency_contact', {});
  if (error) return { row: null, problem: error.message || 'my_emergency_contact failed' };
  if (!data) return { row: null, problem: null };
  const row = data as Record<string, unknown>;
  return {
    row: {
      name: (row['name'] as string) ?? '',
      relationship: (row['relationship'] as string) ?? '',
      phone: (row['phone'] as string) ?? '',
    },
    problem: null,
  };
}

/**
 * The worker's own name / photo change requests (ADR-0045) — newest first,
 * never `decided_by` — or the failure (audit D18). A failed read is not "no
 * requests": the pending line and its Withdraw would vanish, and a second
 * form would be offered for a request already with the office.
 */
export async function loadChangeRequests(): Promise<Loaded<ChangeRequest>> {
  if (!supabaseConfigured()) return { rows: [], problem: null };
  const { data, error } = await staffDb(await cookies()).rpc('my_profile_change_requests', {});
  if (error) return { rows: [], problem: error.message || 'my_profile_change_requests failed' };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toChangeRequest), problem: null };
}

/** `staff.rejection_cause`, or null for anything `staff_me()` does not say. */
function rejectionCause(value: unknown): StaffProfile['rejectionCause'] {
  return value === 'willo' || value === 'manager' || value === 'quiz_failed' ? value : null;
}
