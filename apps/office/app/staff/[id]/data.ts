import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import type {
  ClientOption,
  DeclarationRow,
  DocumentRow,
  FeedbackRow,
  ProfileData,
  ProfileRow,
  QualificationRow,
  ReferenceRow,
  RoleOption,
  ShiftRow,
  ViolationRow,
} from './types';

/**
 * Reads for /staff/:id (§9.6).
 *
 * Eleven queries in one round of `Promise.all`, because the profile is
 * eleven independent lists and serialising them would show the manager a
 * blank page for as long as the slowest one takes. Every view is
 * security_invoker, so the gate is `staff`'s own RLS: a client sees
 * nobody here and a worker sees only themselves.
 *
 * A missing profile is `profile: null` with no problem string — the page
 * turns that into a 404 rather than an error panel, because a worker who
 * does not exist is not a fault the manager can act on.
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so the profile cannot be read. See docs/04-setup-github-vercel-supabase.md.';

const EMPTY: Omit<ProfileData, 'problem'> = {
  profile: null,
  documents: [],
  qualifications: [],
  shifts: [],
  violations: [],
  feedback: [],
  references: [],
  declarations: [],
  roles: [],
  clients: [],
};

const PROFILE_COLUMNS =
  'id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, ' +
  'rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, ' +
  'unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, ' +
  'email, phone, dob, home_address, share_code, ni_number_masked, has_ni_number, term_dates, ' +
  'weekly_cap_until, ' +
  'contract_signed_at, contract_version, joined_at, quiz_attempts, bank_account_holder, ' +
  'bank_sort_code_masked, bank_account_masked, bank_updated_at, hmrc_statement, hmrc_student_loan, ' +
  'hmrc_postgraduate_loan, hmrc_declared_at, shifts_worked, no_shows, feedback_count, ' +
  'documents_pending, qualification_count';

export async function loadProfile(id: string): Promise<ProfileData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());

  const [
    profile,
    documents,
    qualifications,
    shifts,
    violations,
    feedback,
    references,
    declarations,
    roles,
    clients,
  ] = await Promise.all([
    supabase.from('staff_profile_v').select(PROFILE_COLUMNS).eq('id', id).maybeSingle<ProfileRow>(),
    supabase
      .from('staff_documents_v')
      .select('*')
      .eq('staff_id', id)
      .order('uploaded_at', { ascending: false })
      .returns<DocumentRow[]>(),
    supabase
      .from('staff_client_qualifications_v')
      .select('*')
      .eq('staff_id', id)
      .order('client_name')
      .returns<QualificationRow[]>(),
    supabase
      .from('staff_shift_history_v')
      .select('*')
      .eq('staff_id', id)
      .order('starts_at', { ascending: false })
      .returns<ShiftRow[]>(),
    supabase
      .from('staff_violations_v')
      .select('*')
      .eq('staff_id', id)
      .order('detected_at', { ascending: false })
      .returns<ViolationRow[]>(),
    supabase
      .from('staff_feedback_v')
      .select('*')
      .eq('staff_id', id)
      .order('created_at', { ascending: false })
      .returns<FeedbackRow[]>(),
    supabase
      .from('staff_references')
      .select('id, name, relationship, phone, email')
      .eq('staff_id', id)
      .returns<ReferenceRow[]>(),
    // §1.5: declarations are a history, never edited or overwritten, so
    // this is oldest first — the onboarding answer, then anything
    // declared later from the app (§10.7).
    supabase
      .from('criminal_declarations')
      .select(
        'id, source, answer, details, conviction_date, review_status, declared_at, reviewed_at',
      )
      .eq('staff_id', id)
      .order('declared_at')
      .returns<DeclarationRow[]>(),
    supabase.from('roles').select('id, name').order('name').returns<RoleOption[]>(),
    supabase.from('clients').select('id, name').order('name').returns<ClientOption[]>(),
  ]);

  const error =
    profile.error ??
    documents.error ??
    qualifications.error ??
    shifts.error ??
    violations.error ??
    feedback.error ??
    references.error ??
    declarations.error ??
    roles.error ??
    clients.error;
  if (error) return { ...EMPTY, problem: error.message };

  return {
    profile: profile.data ?? null,
    documents: documents.data ?? [],
    qualifications: qualifications.data ?? [],
    shifts: shifts.data ?? [],
    violations: violations.data ?? [],
    feedback: feedback.data ?? [],
    references: references.data ?? [],
    declarations: declarations.data ?? [],
    roles: roles.data ?? [],
    clients: clients.data ?? [],
    problem: null,
  };
}
