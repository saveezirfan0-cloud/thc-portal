import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { loadRtwChecks } from '../_lib/rtwCheckData';
import type { Database } from '@thc/db';
import { supabaseConfigured } from '../staff/data';
import { withPhotoUrls } from '../_lib/photos';
import type {
  Application,
  BoardData,
  CandidateData,
  CandidateFacts,
  CandidateDocument,
  CandidateMoney,
  CandidateRow,
  ContractVersion,
  Declaration,
  HmrcChecklist,
  QuizAttempt,
  Reference,
  ReturningRow,
  RoleOption,
} from './types';

/**
 * Reads for /onboarding and /onboarding/:id (§2.2, §2.3).
 *
 * Everything goes through the session client. `onboarding_candidates_v`
 * and `onboarding_returning_v` are security_invoker over `staff` and
 * `applications`, which are admin_all / admin_read — so a client reads
 * nobody and a worker reads only themselves without this file doing
 * anything (380_onboarding_pipeline asserts both).
 *
 * One column is not covered by that. Since 20260923220000 no PostgREST
 * role holds `staff.rejection_reason`: a rejected candidate could
 * otherwise read the office's free-text note about themselves straight
 * off the table, and ADR-0017 keeps it out of E2/E2b/E4 precisely because
 * it is the office's. `onboarding_candidates_v` reads it back through the
 * owner-rights `staff_rejection_reason_v`, which carries the admin gate
 * in its own body. Deleting that sub-view as redundant makes this column
 * null for the office too.
 *
 * Not the same as `compliance_docs.rejection_reason`, which the worker is
 * MEANT to see — §2.6 and N8 tell them why a document was rejected so
 * they can re-upload.
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so the onboarding pipeline cannot be read. See docs/04-setup-github-vercel-supabase.md.';

/** The statuses a person holds while the kanban can show them (§2.2). */
// The DATABASE enum, which still carries `additional_info` (ADR-0013: a
// column, not a status) — the domain's StaffStatus rightly leaves it out.
const ON_BOARD: Database['public']['Enums']['staff_status'][] = [
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
  'rejected',
];

export async function loadBoard(): Promise<BoardData> {
  if (!supabaseConfigured()) {
    return { candidates: [], returning: [], roles: [], problem: NOT_CONFIGURED };
  }
  const supabase = createClient(await cookies());
  const [candidates, returning, roles] = await Promise.all([
    supabase
      .from('onboarding_candidates_v')
      .select('*')
      .in('status', ON_BOARD)
      .order('stage_entered_at')
      .returns<CandidateRow[]>(),
    supabase
      .from('onboarding_returning_v')
      .select('*')
      .order('applied_at', { ascending: false })
      .returns<ReturningRow[]>(),
    supabase.from('roles').select('id, name').order('name').returns<RoleOption[]>(),
  ]);

  const error = candidates.error ?? returning.error ?? roles.error;
  if (error) return { candidates: [], returning: [], roles: [], problem: error.message };
  return {
    // §2.7: the onboarding selfie follows them through the whole system —
    // the card too, signed here as on every other office face.
    candidates: await withPhotoUrls(candidates.data ?? []),
    returning: returning.data ?? [],
    roles: roles.data ?? [],
    problem: null,
  };
}

const EMPTY: Omit<CandidateData, 'problem'> = {
  candidate: null,
  profile: null,
  documents: [],
  declarations: [],
  references: [],
  attempts: [],
  hmrc: null,
  application: null,
  contract: null,
  roles: [],
  rtwChecks: [],
  rtwCheckEnabled: false,
};

/**
 * `staff.visa_weekly_hour_limit` is newer than the generated types (docs/14
 * §4), so the facts are read through a narrow hand-written shape.
 */
interface FactsRead {
  from(table: 'staff'): {
    select(columns: string): {
      eq(
        column: 'id',
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: {
            ni_number: string | null;
            below_degree_level: boolean | null;
            visa_weekly_hour_limit: number | null;
          } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

const MONEY_COLUMNS =
  'weekly_cap_hours, weekly_cap_band, weekly_cap_until, term_dates, ni_number_masked, ' +
  'bank_account_holder, bank_sort_code_masked, bank_account_masked, bank_updated_at, ' +
  'home_address, wtr_optout';

export async function loadCandidate(id: string): Promise<CandidateData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };
  const supabase = createClient(await cookies());

  const [
    candidate,
    profile,
    documents,
    declarations,
    references,
    attempts,
    hmrc,
    application,
    roles,
    rtw,
    facts,
  ] = await Promise.all([
    supabase.from('onboarding_candidates_v').select('*').eq('id', id).maybeSingle<CandidateRow>(),
    supabase
      .from('staff_profile_v')
      .select(MONEY_COLUMNS)
      .eq('id', id)
      .maybeSingle<CandidateMoney>(),
    supabase
      .from('staff_documents_v')
      .select('*')
      .eq('staff_id', id)
      .order('uploaded_at', { ascending: false })
      .returns<CandidateDocument[]>(),
    // §1.5: declarations are a history, never overwritten — oldest first.
    // Through the admin-gated owner-rights view: review_note is not
    // selectable off the table by any PostgREST role (§10.7, 20260929140000).
    // Same columns as the table, so it is typed as the table until the
    // generated types are regenerated with the view in them.
    supabase
      .from('criminal_declarations_office_v' as 'criminal_declarations')
      .select(
        'id, source, answer, details, conviction_date, review_status, declared_at, reviewed_at, review_note, superseded',
      )
      .eq('staff_id', id)
      .order('declared_at')
      .returns<Declaration[]>(),
    supabase
      .from('staff_references')
      .select('id, name, relationship, phone, email')
      .eq('staff_id', id)
      .returns<Reference[]>(),
    supabase
      .from('quiz_attempts')
      .select('id, attempt_no, score, passed, taken_at')
      .eq('staff_id', id)
      .order('taken_at')
      .returns<QuizAttempt[]>(),
    supabase
      .from('hmrc_checklists')
      .select(
        'q1_other_job, q2_pension, q3_since_6_april, statement, student_loan, postgraduate_loan, declared, submitted_at',
      )
      .eq('staff_id', id)
      .eq('superseded', false)
      .maybeSingle<HmrcChecklist>(),
    supabase
      .from('applications')
      .select('created_at, consented_at, outcome, matched_on')
      .eq('staff_id', id)
      .order('created_at')
      .limit(1)
      .maybeSingle<Application>(),
    supabase.from('roles').select('id, name').order('name').returns<RoleOption[]>(),
    // The automated gov.uk check (ADR-0025); best-effort, never an error panel.
    loadRtwChecks(supabase, id),
    // D43: the full NI number beside the NI evidence; D32/D36: the conditions.
    (supabase as unknown as FactsRead)
      .from('staff')
      .select('ni_number, below_degree_level, visa_weekly_hour_limit')
      .eq('id', id)
      .maybeSingle(),
  ]);

  const error =
    candidate.error ??
    profile.error ??
    documents.error ??
    declarations.error ??
    references.error ??
    attempts.error ??
    hmrc.error ??
    application.error ??
    roles.error;
  if (error) return { ...EMPTY, problem: error.message };

  const raw = candidate.data ?? null;
  // §2.12 step 3: the previous period's attempts are history, not this
  // period's quiz. They stay in the database; the profile shows the live set.
  const live = (attempts.data ?? []).filter(
    (attempt) =>
      raw !== null && Date.parse(attempt.taken_at) >= Date.parse(raw.onboarding_started_at),
  );

  // §2.7: "the selfie avatar taken during onboarding follows them through
  // the whole system" — the key in the private bucket becomes a short-lived
  // URL here, the same way every other office face does (_lib/photos.ts).
  const [row] = raw ? await withPhotoUrls([raw]) : [null];

  // §2.11: the agreement the candidate read, so the reviewer sees the text
  // they ticked, not a description of it. The table's admin policy gates it.
  // Before signature it is the version in force now — what
  // current_contract_version() hands the wizard (20260923120000).
  let contract: ContractVersion | null = null;
  if (row && (row.status === 'contract' || row.status === 'compliant')) {
    const query = supabase
      .from('contract_versions')
      .select('version, title, body, is_placeholder')
      .lte('published_at', new Date().toISOString());
    const version = await (
      row.contract_version
        ? query.eq('version', row.contract_version)
        : query.order('published_at', { ascending: false }).order('version', { ascending: false })
    )
      .limit(1)
      .maybeSingle<ContractVersion>();
    if (version.error) return { ...EMPTY, problem: version.error.message };
    contract = version.data ?? null;
  }

  return {
    candidate: row,
    profile: profile.data ?? null,
    documents: documents.data ?? [],
    declarations: declarations.data ?? [],
    references: references.data ?? [],
    attempts: live,
    hmrc: hmrc.data ?? null,
    application: application.data ?? null,
    contract,
    roles: roles.data ?? [],
    rtwChecks: rtw.checks,
    rtwCheckEnabled: rtw.enabled,
    facts: facts.error || !facts.data ? null : toFacts(facts.data),
    problem: null,
  };
}

function toFacts(row: {
  ni_number: string | null;
  below_degree_level: boolean | null;
  visa_weekly_hour_limit: number | null;
}): CandidateFacts {
  return {
    niNumber: row.ni_number,
    belowDegreeLevel: row.below_degree_level === true,
    visaHourLimit: row.visa_weekly_hour_limit,
  };
}
