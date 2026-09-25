import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { signPhotos } from '../checkin/photos';
import { DIRECTORY_STATUSES } from './staff';
import type { StaffRow, StudentRow } from './types';

/**
 * Reads for /staff (§9.6, §4.5).
 *
 * `staff` carries date of birth, address, NI number and right-to-work
 * state. admin_all is the only policy that reaches more than one row, and
 * both views are security_invoker, so §11.1 holds without the screen
 * doing anything: a client sees nobody, a worker sees only themselves.
 *
 * `block_reason` is the one exception, and the sub-view it comes through
 * is not redundant. Since 20260923090000 no PostgREST role holds that
 * column on `staff` at all — a worker could otherwise read the manager's
 * internal note about themselves straight off the table (§10.1), which
 * RLS cannot prevent because policies filter rows and never columns. It
 * arrives here through `staff_block_reason_v`, an owner-rights view that
 * carries the admin gate in its own body. Delete that and this column
 * goes null for everyone, including the office.
 *
 * Only workers are read (§9.6 "A list of workers"; staff.ts
 * DIRECTORY_STATUSES): a candidate belongs to /onboarding until they are
 * compliant, a rejected applicant to its Rejected column, and both keep
 * their /staff/:id page for Reset to candidate.
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface StaffPageData {
  staff: StaffRow[];
  students: StudentRow[];
  problem: string | null;
}

const STAFF_COLUMNS =
  'id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours';

const STUDENT_COLUMNS =
  'id, display_name, employee_id, photo_path, status, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, right_to_work_until, graduated_at, wtr_optout, term_letter_verified_at, term_letter_expires_at, completion_letter_verified_at, completion_letter_in_review, below_degree_level, course_completion_date, completion_letter_status, completion_letter_rejection, completion_date_claimed, completion_effective_from, wtr_optout_cancelled_from, optout_eligible, rtw_days_left';

export async function loadStaff(): Promise<StaffPageData> {
  if (!supabaseConfigured()) {
    return {
      staff: [],
      students: [],
      problem:
        'This environment has no Supabase project, so the staff directory cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());
  const [staff, students, capUntil] = await Promise.all([
    // §9.6 "A list of workers": the pipeline's candidates and rejected
    // applicants have a profile page but are not directory rows (staff.ts
    // DIRECTORY_STATUSES; removed rows keep status = 'removed').
    supabase
      .from('staff_directory_v')
      .select(STAFF_COLUMNS)
      .in('status', [...DIRECTORY_STATUSES])
      .order('display_name')
      .returns<StaffRow[]>(),
    supabase
      .from('student_visa_v')
      .select(STUDENT_COLUMNS)
      .order('display_name')
      .returns<StudentRow[]>(),
    // The date §9.6's hover ends with ("20 h — term time until 13.12.2026")
    // is `weekly_cap_until`, which only staff_profile_v computes today
    // (20260924150000) and only for a student. Read for the students and
    // merged by id; the day staff_directory_v carries the column this read
    // goes and STAFF_COLUMNS names it.
    supabase
      .from('staff_profile_v')
      .select('id, weekly_cap_until')
      .eq('rtw_branch', 'international_student')
      .returns<{ id: string; weekly_cap_until: string | null }[]>(),
  ]);

  const error = staff.error ?? students.error;
  if (error) return { staff: [], students: [], problem: error.message };

  const until = new Map((capUntil.data ?? []).map((row) => [row.id, row.weekly_cap_until]));
  const rows = staff.data ?? [];
  // §9.6's first column is the photo. The path is signed through the
  // manager's own session, one round for the whole list; a failed signing
  // costs the face, not the row (Avatar falls back to initials).
  const photos = await signPhotos(
    supabase,
    rows.map((row) => row.photo_path),
  );

  return {
    staff: rows.map((row) => ({
      ...row,
      weekly_cap_until: until.get(row.id) ?? null,
      photo_url: row.photo_path ? (photos.get(row.photo_path) ?? null) : null,
    })),
    students: students.data ?? [],
    problem: null,
  };
}
