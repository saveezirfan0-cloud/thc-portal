import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { ENTRY_COLUMNS, managerName } from '../../feedback/data';
import { loadStaffViolationLog } from '../../checkin/data';
import { signStaffPhotos } from '../../_lib/photos';
import { loadRtwChecks } from '../../_lib/rtwCheckData';
import type { FeedbackEntry } from '../../feedback/types';
import type { QueueRow } from '../../compliance/types';
import { readChangeRequests } from '../requests/data';
import type {
  AvailabilityRow,
  ClientOption,
  EmergencyContact,
  Referrals,
  DeclarationRow,
  DocumentRow,
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
 * Every read in one round of `Promise.all`, because the profile is a dozen
 * independent lists (plus the signed-in manager's name) and serialising
 * them would show the manager a blank page for as long as the slowest one
 * takes. Every view but two is security_invoker, so the gate is `staff`'s
 * own RLS: a client sees nobody here and a worker sees only themselves.
 * The exceptions are feedback_entries_v, which returns rows to an admin
 * only (ADR-0016), and `block_reason`, which no PostgREST role holds on
 * `staff` since 20260923090000 and which reaches this screen through the
 * owner-rights `staff_block_reason_v` — see the note in ../data.ts before
 * touching it.
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
  managerName: null,
};

const PROFILE_COLUMNS =
  'id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, ' +
  'rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, ' +
  'unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, ' +
  'email, phone, dob, home_address, share_code, ni_number_masked, has_ni_number, term_dates, ' +
  'weekly_cap_until, weekly_worked_hours, ' +
  'contract_signed_at, contract_version, joined_at, quiz_attempts, bank_account_holder, ' +
  'bank_sort_code_masked, bank_account_masked, bank_updated_at, hmrc_statement, hmrc_student_loan, ' +
  'hmrc_postgraduate_loan, hmrc_declared_at, shifts_worked, no_shows, feedback_count, ' +
  'documents_pending, qualification_count';

/** Typed by hand until `gen:types` runs against the live project (docs/14 §4). */
interface ActivatedRpc {
  rpc(
    fn: 'staff_account_activated',
    args: { p_staff: string },
  ): PromiseLike<{ data: boolean | null; error: unknown }>;
}

/**
 * The docs/19 office reads (20260930203000): definers with the admin check
 * in their own body — the tables are admin_read, but the cards also name
 * who saved or referred, from `profiles`/`staff`, which a plain select could
 * not. Typed by hand until `gen:types` (docs/19 §8, Phase 2.1).
 */
type RpcError = { message: string } | null;
interface AdditionsRpc {
  rpc(
    fn: 'office_emergency_contact',
    args: { p_staff: string },
  ): PromiseLike<{ data: EmergencyContact | null; error: RpcError }>;
  rpc(
    fn: 'office_staff_referrals',
    args: { p_staff: string },
  ): PromiseLike<{ data: Referrals | null; error: RpcError }>;
  rpc(
    fn: 'office_staff_unavailability',
    args: { p_staff: string },
  ): PromiseLike<{ data: AvailabilityRow[] | null; error: RpcError }>;
}

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
    manager,
    activated,
    location,
    violationDetails,
    rtw,
    reviewQueue,
    emergency,
    referrals,
    availability,
    changeRequests,
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
    // feedback_entries_v rather than staff_feedback_v: it names every
    // author — §9.10 wants the manager's own name on an office entry — and
    // carries the editable/deletable answers the tab's buttons follow
    // (20260923140000, ADR-0016).
    supabase
      .from('feedback_entries_v')
      .select(ENTRY_COLUMNS)
      .eq('staff_id', id)
      .order('created_at', { ascending: false })
      .returns<FeedbackEntry[]>(),
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
    managerName(supabase),
    // Resend activation link (20260924110000): only someone who never
    // activated is offered it. A failed read hides the button, nothing more.
    (supabase as unknown as ActivatedRpc).rpc('staff_account_activated', { p_staff: id }),
    // The address changed but the pin could not follow (20260926110000).
    // Read off `staff` through admin_all; a failed read shows nothing.
    supabase
      .from('staff')
      .select('home_location_stale')
      .eq('id', id)
      .maybeSingle<{ home_location_stale: boolean }>(),
    // The Shifts tab opens the /checkin detail window and Resolve (§9.6),
    // so it reads the entries through the monitor's own query.
    loadStaffViolationLog(supabase, id),
    // The automated gov.uk check on share codes (ADR-0025). Best-effort.
    loadRtwChecks(supabase, id),
    // Needs review (§4.1), this worker's rows: the Documents tab's Verify /
    // Reject act on exactly what /compliance lists, with the same columns.
    supabase
      .from('compliance_review_queue_v')
      .select('*')
      .eq('staff_id', id)
      .order('submitted_at', { ascending: true })
      .returns<QueueRow[]>(),
    // docs/19 additions. Each fails on its own — a card that cannot be read
    // says so; it never takes the profile down.
    (supabase as unknown as AdditionsRpc).rpc('office_emergency_contact', { p_staff: id }),
    (supabase as unknown as AdditionsRpc).rpc('office_staff_referrals', { p_staff: id }),
    (supabase as unknown as AdditionsRpc).rpc('office_staff_unavailability', { p_staff: id }),
    readChangeRequests(supabase, { staffId: id }),
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

  // The header selfie: a private-bucket key, signed here (_lib/photos.ts).
  const photoPath = profile.data?.photo_path ?? null;
  const photoUrl = photoPath ? ((await signStaffPhotos([photoPath])).get(photoPath) ?? null) : null;

  return {
    profile: profile.data ? { ...profile.data, photo_url: photoUrl } : null,
    documents: documents.data ?? [],
    rtwChecks: rtw.checks,
    rtwCheckEnabled: rtw.enabled,
    // A failed read must not take the whole profile down; the tab says why
    // there are no review buttons instead.
    reviewQueue: reviewQueue.error ? [] : (reviewQueue.data ?? []),
    reviewQueueProblem: reviewQueue.error ? reviewQueue.error.message : null,
    qualifications: qualifications.data ?? [],
    shifts: shifts.data ?? [],
    violations: violations.data ?? [],
    violationDetails: violationDetails.error ? undefined : violationDetails.rows,
    feedback: feedback.data ?? [],
    references: references.data ?? [],
    declarations: declarations.data ?? [],
    roles: roles.data ?? [],
    clients: clients.data ?? [],
    managerName: manager,
    activated: activated.error ? null : (activated.data ?? null),
    locationStale: location.error ? null : (location.data?.home_location_stale ?? null),
    emergencyContact: emergency.error ? null : (emergency.data ?? null),
    emergencyContactProblem: emergency.error ? emergency.error.message : null,
    referrals: referrals.error ? null : (referrals.data ?? null),
    referralsProblem: referrals.error ? referrals.error.message : null,
    availability: availability.error ? [] : (availability.data ?? []),
    availabilityProblem: availability.error ? availability.error.message : null,
    changeRequests: changeRequests.rows,
    changeRequestsProblem: changeRequests.problem,
    problem: null,
  };
}
