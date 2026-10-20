import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import type { PageReply } from '@thc/db/paged';
import { signStaffPhotos } from '../_lib/photos';
import type { StaffRow, StudentRow } from './types';
import { readProblem } from '../_lib/dbError';

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
  'id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express, thc_shifts_enabled, payroll_id';

const STUDENT_COLUMNS =
  'id, display_name, employee_id, photo_path, status, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, right_to_work_until, graduated_at, wtr_optout, term_letter_verified_at, term_letter_expires_at, completion_letter_verified_at, completion_letter_in_review, below_degree_level, course_completion_date, completion_letter_status, completion_letter_rejection, completion_date_claimed, completion_effective_from, wtr_optout_cancelled_from, optout_eligible, rtw_days_left';

/** Every worker, candidate and leaver the office will ever hold, with room to spare. */
export const DIRECTORY_CEILING = 20_000;

interface DirectoryQuery {
  order(column: string): DirectoryQuery;
  range(from: number, to: number): unknown;
}
interface DirectoryClient {
  from(view: string): { select(columns: string): DirectoryQuery };
}
interface PhoneQuery {
  is(column: 'removed_at', value: null): PhoneQuery;
  order(column: 'id'): PhoneQuery;
  range(from: number, to: number): unknown;
}
interface PhoneClient {
  from(table: 'staff'): { select(columns: 'id, phone'): PhoneQuery };
}

export async function loadStaff(): Promise<StaffPageData> {
  if (!supabaseConfigured()) {
    return {
      staff: [],
      students: [],
      problem:
        'This environment has no Supabase project, so the staff directory cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies()) as unknown as DirectoryClient;
  // PostgREST answers at most max_rows (1000) per request, without an
  // error, and the directory passes that with the roster still to arrive:
  // whoever sorted last by name dropped off the list, its search, its filter
  // counts and the Send push picker (go-live audit 17.10.2026, B3). Both
  // views are read in pages, by name and then id so no two rows tie across a
  // page boundary, as /staff/roster already reads invite_roster.
  const pageOf = <T>(view: string, columns: string) =>
    readAllPages<T>(
      (range) =>
        supabase
          .from(view)
          .select(columns)
          .order('display_name')
          .order('id')
          .range(range.from, range.to) as unknown as PromiseLike<PageReply<T>>,
      { what: 'staff', key: (row) => (row as { id: string }).id, ceiling: DIRECTORY_CEILING },
    );
  // The phone is searched, never printed (owner request, 20.10.2026), so it
  // is read straight off `staff` — two plain columns, no computed history —
  // rather than added to the view every other directory read shares. A
  // removed worker's number is anonymised and is not read at all.
  const phonesOf = () =>
    readAllPages<{ id: string; phone: string | null }>(
      (range) =>
        (supabase as unknown as PhoneClient)
          .from('staff')
          .select('id, phone')
          .is('removed_at', null)
          .order('id')
          .range(range.from, range.to) as unknown as PromiseLike<
          PageReply<{ id: string; phone: string | null }>
        >,
      { what: 'staff phones', key: (row) => row.id, ceiling: DIRECTORY_CEILING },
    );
  const [staff, students, phoneRows] = await Promise.all([
    pageOf<StaffRow>('staff_directory_v', STAFF_COLUMNS),
    pageOf<StudentRow>('student_visa_v', STUDENT_COLUMNS),
    phonesOf(),
  ]);

  const error = staff.error ?? students.error;
  if (error) return { staff: [], students: [], problem: readProblem(error) };
  // A failed phone read costs the phone search only, never the directory.
  const phones = new Map(
    (phoneRows.error ? [] : (phoneRows.data ?? [])).map((r) => [r.id, r.phone]),
  );

  // The selfie is a key in the private `photos` bucket, not a URL: both
  // lists are signed in one batch, and a path that cannot be signed leaves
  // that row on initials (_lib/photos.ts).
  const staffRows = staff.data ?? [];
  const studentRows = students.data ?? [];
  const urls = await signStaffPhotos([
    ...staffRows.map((row) => row.photo_path),
    ...studentRows.map((row) => row.photo_path),
  ]);
  const url = (path: string | null) => (path ? (urls.get(path) ?? null) : null);

  return {
    staff: staffRows.map((row) => ({
      ...row,
      phone: phones.get(row.id) ?? null,
      photo_url: url(row.photo_path),
    })),
    students: studentRows.map((row) => ({ ...row, photo_url: url(row.photo_path) })),
    problem: null,
  };
}
