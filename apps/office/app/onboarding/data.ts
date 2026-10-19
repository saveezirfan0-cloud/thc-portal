import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import { loadRtwChecks } from '../_lib/rtwCheckData';
import type { Database } from '@thc/db';
import { supabaseConfigured } from '../staff/data';
import { withPhotoUrls } from '../_lib/photos';
import type {
  Application,
  BoardCandidateRow,
  BoardData,
  CandidateData,
  CandidateFacts,
  CandidateDocument,
  CandidateMoney,
  CandidateReferral,
  CandidateRow,
  ChaserState,
  ContractVersion,
  Declaration,
  HmrcChecklist,
  InterviewOverride,
  SpudbrosSkipFailure,
  QuizAttempt,
  Reference,
  ReferralRow,
  ReferredOnBoard,
  ReturningRow,
  RoleOption,
  ClientOption,
  CandidateQualification,
} from './types';
import { candidateReferral, referredOnBoard } from './view-model';
import { readProblem } from '../_lib/dbError';

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

// ---------------------------------------------------------------------
// Refer a friend (ADR-0047) — a separate admin read of
// `application_referrals`, NOT a column on `onboarding_candidates_v`
// (frozen in Phase 1, docs/19 §0.6). The table has one admin_read policy
// and nothing else (20260930200100), so this is the office's alone.
//
// A failed read never takes the pipeline down — but it is not "nobody was
// referred" either (audit D18): it comes back as `problem`, and the board
// and the candidate screen each say the referrals could not be read.
// Typed by a narrow local interface until the Phase 2 type regen.
// ---------------------------------------------------------------------
type ReferralAnswer = PromiseLike<{
  data: ReferralRow[] | null;
  error: { message: string } | null;
}>;

export interface ReferralReader {
  from(table: 'application_referrals'): {
    select(columns: string): {
      in(column: 'candidate_staff_id', values: string[]): ReferralAnswer;
      eq(column: 'candidate_staff_id', value: string): ReferralAnswer;
    };
  };
}

/** The FK is named because `application_referrals` points at `staff` twice. */
const REFERRAL_COLUMNS =
  'application_id, candidate_staff_id, referrer_staff_id, recorded_at, ' +
  'referrer:staff!application_referrals_referrer_staff_id_fkey(first_name, last_name, employee_id, removed_at)';

/** Ids per request: keeps `in.(…)` well inside any URL limit. */
const REFERRAL_CHUNK = 100;

/** Far past any intake THC runs; past it the board says so instead of hiding cards. */
const BOARD_CEILING = 20_000;

export async function loadBoardReferrals(
  reader: ReferralReader,
  staffIds: readonly string[],
): Promise<{ referred: ReferredOnBoard; problem: string | null }> {
  const ids = [...new Set(staffIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += REFERRAL_CHUNK)
    chunks.push(ids.slice(i, i + REFERRAL_CHUNK));
  try {
    const answers = await Promise.all(
      chunks.map((chunk) =>
        reader
          .from('application_referrals')
          .select(REFERRAL_COLUMNS)
          .in('candidate_staff_id', chunk),
      ),
    );
    const failed = answers.find((answer) => answer.error)?.error;
    if (failed) return { referred: referredOnBoard([]), problem: readProblem(failed) };
    return {
      referred: referredOnBoard(answers.flatMap((answer) => answer.data ?? [])),
      problem: null,
    };
  } catch (error) {
    return { referred: referredOnBoard([]), problem: messageOf(error) };
  }
}

export async function loadCandidateReferral(
  reader: ReferralReader,
  staffId: string,
): Promise<{ referral: CandidateReferral | null; problem: string | null }> {
  try {
    const answer = await reader
      .from('application_referrals')
      .select(REFERRAL_COLUMNS)
      .eq('candidate_staff_id', staffId);
    return answer.error
      ? { referral: null, problem: readProblem(answer.error) }
      : { referral: candidateReferral(answer.data ?? []), problem: null };
  } catch (error) {
    return { referral: null, problem: messageOf(error) };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? readProblem(error.message) : 'the read failed';
}

// ---------------------------------------------------------------------
// Onboarding chasers (ADR-0071) — a separate read of
// `onboarding_chaser_state()`, a Back Office-only definer (20261001212000),
// for the same reason as the referrals: the pipeline view is not restated.
// A failed read is said out loud, never shown as "nobody was reminded".
// ---------------------------------------------------------------------
interface ChaserQuery extends PromiseLike<{
  data: ChaserState[] | null;
  error: { message: string } | null;
}> {
  order(column: string): ChaserQuery;
  range(from: number, to: number): ChaserQuery;
}

export interface ChaserReader {
  rpc(fn: 'onboarding_chaser_state'): ChaserQuery;
}

export async function loadBoardChasers(
  reader: ChaserReader,
): Promise<{ chasers: Record<string, ChaserState>; problem: string | null }> {
  try {
    // One row per candidate in the pipeline: past 1000 at full intake, so it
    // is paged like the board itself (go-live audit H3) — a card cut off
    // here would read "never reminded".
    const answer = await readAllPages<ChaserState>(
      (range) =>
        reader
          .rpc('onboarding_chaser_state')
          .order('staff_id')
          .order('track')
          .range(range.from, range.to),
      { what: 'reminder states', ceiling: BOARD_CEILING },
    );
    if (answer.error) return { chasers: {}, problem: readProblem(answer.error) };
    return {
      chasers: Object.fromEntries(answer.data.map((row) => [row.staff_id, row])),
      problem: null,
    };
  } catch (error) {
    return { chasers: {}, problem: messageOf(error) };
  }
}

/**
 * The board names its columns: everything on `onboarding_candidates_v` but
 * `quiz_blockers`, which only the candidate screen reads. The view is
 * flattened into the query, so a column left out is never computed — and
 * that one runs compliance_blockers() and onboarding_documents_missing()
 * per row. Read with `*` for the whole pipeline it was most of the 4 s that
 * timed /onboarding out at 220 candidates (20261012120000).
 */
const BOARD_COLUMN_LIST = [
  'id',
  'first_name',
  'last_name',
  'display_name',
  'email',
  'phone',
  'dob',
  'age',
  'applied_age_band',
  'photo_path',
  'status',
  'stage_entered_at',
  'onboarding_started_at',
  'applied_at',
  'gdpr_consent_at',
  'employee_id',
  'rtw_branch',
  'right_to_work_until',
  'share_code',
  'activated',
  'role_names',
  'role_ids',
  'willo_linked',
  'willo_review_url',
  'willo_invited_at',
  'willo_answers_done',
  'willo_answers_total',
  'willo_completed_at',
  'willo_decision',
  'willo_decided_at',
  'willo_decided_via',
  'docs_total',
  'docs_verified',
  'docs_pending',
  'docs_rejected',
  'last_doc_rejected_at',
  'docs_missing',
  'declaration_answer',
  'declaration_status',
  'quiz_attempts_used',
  'quiz_best_score',
  'quiz_passed_at',
  'hmrc_submitted_at',
  'references_count',
  'bank_saved',
  'ni_entered',
  'contract_signed_at',
  'contract_version',
  'rejected_at',
  'rejected_from',
  'rejection_cause',
  'rejection_reason',
  'rejected_by_name',
  'activated_at',
  'additional_info_done_at',
  'quiz_scores',
  'spudbros_express',
  'thc_shifts_enabled',
  'payroll_id',
] as const satisfies readonly (keyof BoardCandidateRow)[];
// Fails to compile when a column is added to BoardCandidateRow but not
// here (photo_url is signed on the server, not read).
const BOARD_COLUMNS_COMPLETE: Exclude<
  keyof BoardCandidateRow,
  (typeof BOARD_COLUMN_LIST)[number] | 'photo_url'
> extends never
  ? true
  : false = true;
void BOARD_COLUMNS_COMPLETE;
const BOARD_COLUMNS = BOARD_COLUMN_LIST.join(', ');

export async function loadBoard(): Promise<BoardData> {
  if (!supabaseConfigured()) {
    return { candidates: [], returning: [], roles: [], problem: NOT_CONFIGURED };
  }
  const supabase = createClient(await cookies());
  // The chaser read needs nothing from the others, so it starts with them
  // instead of waiting behind the referrals.
  const chasersRead = loadBoardChasers(supabase as unknown as ChaserReader);
  // Go-live audit H3: the board passes PostgREST's 1000-row cap once the
  // invite roster arrives (~1,300 candidates), and the cut — newest stage
  // first — would drop the OLDEST candidates without a word. Every card is
  // read, in pages, in a total order (the id breaks ties); a column with
  // hundreds of cards is the board's to fold, never the read's to hide.
  const [candidates, returning, roles] = await Promise.all([
    readAllPages<BoardCandidateRow>(
      (range) =>
        supabase
          .from('onboarding_candidates_v')
          .select(BOARD_COLUMNS)
          .in('status', ON_BOARD)
          .order('stage_entered_at', { ascending: false })
          .order('id', { ascending: true })
          .range(range.from, range.to)
          .returns<BoardCandidateRow[]>(),
      { what: 'candidates', key: (row) => row.id, ceiling: BOARD_CEILING },
    ),
    readAllPages<ReturningRow>(
      (range) =>
        supabase
          .from('onboarding_returning_v')
          .select('*')
          .order('applied_at', { ascending: false })
          .order('application_id', { ascending: true })
          .range(range.from, range.to)
          .returns<ReturningRow[]>(),
      { what: 'returning applicants', key: (row) => row.application_id, ceiling: BOARD_CEILING },
    ),
    supabase.from('roles').select('id, name').order('name').returns<RoleOption[]>(),
  ]);

  const error = candidates.error ?? returning.error ?? roles.error;
  if (error) return { candidates: [], returning: [], roles: [], problem: readProblem(error) };
  const [referrals, chasers] = await Promise.all([
    loadBoardReferrals(supabase as unknown as ReferralReader, [
      ...(candidates.data ?? []).map((row) => row.id),
      ...(returning.data ?? []).map((row) => row.staff_id),
    ]),
    chasersRead,
  ]);
  return {
    // §2.7: the onboarding selfie follows them through the whole system —
    // the card too, signed here as on every other office face.
    candidates: await withPhotoUrls(candidates.data ?? []),
    returning: returning.data ?? [],
    roles: roles.data ?? [],
    referred: referrals.referred,
    referredProblem: referrals.problem,
    chasers: chasers.chasers,
    chasersProblem: chasers.problem,
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
export interface FactsRead {
  from(table: 'staff' | 'staff_identity_v'): {
    select(columns: string): {
      eq(
        column: 'id' | 'staff_id',
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

interface FactsRow {
  ni_number: string | null;
  below_degree_level: boolean | null;
  visa_weekly_hour_limit: number | null;
  languages: string[] | null;
}

/**
 * D43's full NI number beside the NI evidence, and D32/D36's conditions.
 * Since ADR-0163 no API role may read `staff.ni_number` off the table, so
 * the number comes from the owner-rights `staff_identity_v` (admin only)
 * and the rest from `staff` — two reads, answered as the one row the
 * candidate screen always had. Either failing fails the card, never the page.
 */
export async function loadCandidateFacts(
  reader: FactsRead,
  staffId: string,
): Promise<{ data: FactsRow | null; error: { message: string } | null }> {
  const [rest, identity] = await Promise.all([
    reader
      .from('staff')
      .select('below_degree_level, visa_weekly_hour_limit, languages')
      .eq('id', staffId)
      .maybeSingle(),
    reader.from('staff_identity_v').select('ni_number').eq('staff_id', staffId).maybeSingle(),
  ]);
  const error = rest.error ?? identity.error;
  if (error) return { data: null, error };
  if (!rest.data) return { data: null, error: null };
  return {
    data: {
      ni_number: typeof identity.data?.['ni_number'] === 'string' ? identity.data['ni_number'] : null,
      below_degree_level: (rest.data['below_degree_level'] as boolean | null) ?? null,
      visa_weekly_hour_limit: (rest.data['visa_weekly_hour_limit'] as number | null) ?? null,
      languages: (rest.data['languages'] as string[] | null) ?? null,
    },
    error: null,
  };
}

/** audit_log through a narrow shape, for the one row ADR-0077 (and ADR-0118) reads. */
interface OverrideRead {
  from(table: 'audit_log'): {
    select(columns: string): {
      eq(
        column: 'entity_id',
        value: string,
      ): {
        eq(
          column: 'action',
          value: string,
        ): {
          order(
            column: 'at',
            options: { ascending: boolean },
          ): {
            limit(count: number): {
              maybeSingle(): PromiseLike<{
                data: {
                  at: string;
                  data: { reason?: unknown; byName?: unknown; error?: unknown } | null;
                } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
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
    clients,
    qualifications,
    rtw,
    referral,
    facts,
    override,
    skipFailure,
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
    supabase
      .from('staff_declarations_v')
      .select(
        'id, source, answer, details, conviction_date, review_status, declared_at, reviewed_at, reviewed_by_name, review_note, superseded',
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
    // §9.6: the clients to qualify the candidate at, and what they already hold.
    supabase.from('clients').select('id, name').order('name').returns<ClientOption[]>(),
    supabase
      .from('staff_client_qualifications_v')
      .select('id, client_id, client_name, role_id, role_name, do_not_return')
      .eq('staff_id', id)
      .order('client_name')
      .returns<CandidateQualification[]>(),
    // The automated gov.uk check (ADR-0025); best-effort, never an error panel.
    loadRtwChecks(supabase, id),
    // Who referred them (ADR-0047); best-effort, never an error panel.
    loadCandidateReferral(supabase as unknown as ReferralReader, id),
    // D43: the full NI number beside the NI evidence; D32/D36: the conditions.
    loadCandidateFacts(supabase as unknown as FactsRead, id),
    // ADR-0077: who marked the interview complete without Willo, and why.
    // Best-effort, like the two above: a failed read only loses the line.
    (supabase as unknown as OverrideRead)
      .from('audit_log')
      .select('at, data')
      .eq('entity_id', id)
      .eq('action', 'interview_marked_complete')
      .order('at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // ADR-0118: the latest time the SpudBros sweep could not move them to
    // Documents. Best-effort, like the override above.
    (supabase as unknown as OverrideRead)
      .from('audit_log')
      .select('at, data')
      .eq('entity_id', id)
      .eq('action', 'spudbros_skip_failed')
      .order('at', { ascending: false })
      .limit(1)
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
  if (error) return { ...EMPTY, problem: readProblem(error) };

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
    if (version.error) return { ...EMPTY, problem: readProblem(version.error) };
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
    clients: clients.data ?? [],
    // Best-effort: a failed read only empties the list; the role panel still works.
    qualifications: qualifications.error ? [] : (qualifications.data ?? []),
    rtwChecks: rtw.checks,
    rtwCheckEnabled: rtw.enabled,
    dobClaims: rtw.dobClaims,
    referral: referral.referral,
    referralProblem: referral.problem,
    facts: facts.error || !facts.data ? null : toFacts(facts.data),
    interviewOverride: override.error || !override.data ? null : toOverride(override.data),
    spudbrosSkipFailure:
      skipFailure.error || !skipFailure.data || !row
        ? null
        : toSkipFailure(skipFailure.data, row.onboarding_started_at),
    problem: null,
  };
}

function toFacts(row: FactsRow): CandidateFacts {
  return {
    niNumber: row.ni_number,
    belowDegreeLevel: row.below_degree_level === true,
    visaHourLimit: row.visa_weekly_hour_limit,
    languages: row.languages ?? null,
  };
}

function toOverride(row: {
  at: string;
  data: { reason?: unknown; byName?: unknown } | null;
}): InterviewOverride {
  return {
    at: row.at,
    byName: typeof row.data?.byName === 'string' ? row.data.byName : null,
    reason: typeof row.data?.reason === 'string' ? row.data.reason : '',
  };
}

/** The latest `spudbros_skip_failed` row of this onboarding period (ADR-0118). */
function toSkipFailure(
  row: { at: string; data: { error?: unknown } | null },
  periodStart: string,
): SpudbrosSkipFailure | null {
  if (Date.parse(row.at) < Date.parse(periodStart)) return null;
  return { at: row.at, error: typeof row.data?.error === 'string' ? row.data.error : '' };
}
