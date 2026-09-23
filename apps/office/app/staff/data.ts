import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { StaffRow, StudentRow } from './types';

/**
 * Reads for /staff (§9.6, §4.5).
 *
 * `staff` carries date of birth, address, NI number and right-to-work
 * state. admin_all is the only policy that reaches more than one row, and
 * both views are security_invoker, so §11.1 holds without the screen
 * doing anything: a client sees nobody, a worker sees only themselves.
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
  const [staff, students] = await Promise.all([
    supabase
      .from('staff_directory_v')
      .select(STAFF_COLUMNS)
      .order('display_name')
      .returns<StaffRow[]>(),
    supabase
      .from('student_visa_v')
      .select(STUDENT_COLUMNS)
      .order('display_name')
      .returns<StudentRow[]>(),
  ]);

  const error = staff.error ?? students.error;
  if (error) return { staff: [], students: [], problem: error.message };

  return { staff: staff.data ?? [], students: students.data ?? [], problem: null };
}
