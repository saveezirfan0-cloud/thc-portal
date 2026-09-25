import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CandidateData, CandidateRow, ReferralRow, ReturningRow } from '../types';

/**
 * Refer a friend on the office side (ADR-0040, docs/18 §5):
 * `/onboarding/:id` "Referred by {name} ({employeeId})" → `/staff/:id`, and
 * the kanban's "Referred" chip. Both read `application_referrals` through a
 * separate admin query — `onboarding_candidates_v` is not restated.
 */

// Outside Next there is no router and no server; neither is under test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/onboarding',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../actions', () => ({
  acceptCandidate: vi.fn(),
  addQualifiedRole: vi.fn(),
  documentLink: vi.fn(),
  rejectCandidate: vi.fn(),
  rejectDeclaration: vi.fn(),
  rejectDocument: vi.fn(),
  resendActivationLink: vi.fn(),
  resolveReturning: vi.fn(),
  verifyDeclaration: vi.fn(),
  verifyDocument: vi.fn(),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const { candidateReferral, referredByLabel, referredOnBoard } = await import('../view-model');
const { loadBoardReferrals, loadCandidateReferral } = await import('../data');
const { CandidateScreen } = await import('../CandidateScreen');
const { OnboardingBoard } = await import('../OnboardingBoard');

const NOW = '2026-09-23T10:00:00Z';

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'c-1',
    first_name: 'Hana',
    last_name: 'Kowalska',
    display_name: 'Hana Kowalska',
    email: 'hana.k@example.com',
    phone: '+44 7700 900456',
    dob: '2005-04-03',
    age: 21,
    applied_age_band: '21',
    photo_path: null,
    status: 'interview_requested',
    stage_entered_at: '2026-09-20T09:00:00Z',
    onboarding_started_at: '2026-09-10T08:58:00Z',
    applied_at: '2026-09-10T08:58:00Z',
    gdpr_consent_at: '2026-09-10T08:58:00Z',
    employee_id: null,
    rtw_branch: null,
    right_to_work_until: null,
    share_code: null,
    activated: false,
    role_names: [],
    role_ids: [],
    willo_linked: false,
    willo_review_url: null,
    willo_invited_at: null,
    willo_answers_done: null,
    willo_answers_total: null,
    willo_completed_at: null,
    willo_decision: null,
    willo_decided_at: null,
    willo_decided_via: null,
    docs_total: 0,
    docs_verified: 0,
    docs_pending: 0,
    docs_rejected: 0,
    last_doc_rejected_at: null,
    docs_missing: [],
    quiz_blockers: [],
    declaration_answer: null,
    declaration_status: null,
    quiz_attempts_used: 0,
    quiz_best_score: null,
    quiz_passed_at: null,
    hmrc_submitted_at: null,
    references_count: 0,
    bank_saved: false,
    ni_entered: false,
    contract_signed_at: null,
    contract_version: null,
    rejected_at: null,
    rejected_from: null,
    rejection_cause: null,
    rejection_reason: null,
    rejected_by_name: null,
    activated_at: null,
    additional_info_done_at: null,
    quiz_scores: [],
    ...over,
  };
}

function referral(over: Partial<ReferralRow> = {}): ReferralRow {
  return {
    application_id: 'a-1',
    candidate_staff_id: 'c-1',
    referrer_staff_id: 'r-1',
    recorded_at: '2026-09-10T08:58:00Z',
    referrer: { first_name: 'Luca', last_name: 'Moretti', employee_id: 701, removed_at: null },
    ...over,
  };
}

const RETURNING: ReturningRow = {
  application_id: 'a-9',
  applied_at: '2026-09-22T09:00:00Z',
  applicant_name: 'Staff Bravo',
  matched_on: 'email_dob',
  staff_id: 's-9',
  existing_name: 'Staff Bravo',
  employee_id: 902,
  status: 'inactive',
  block_kind: null,
  block_reason: null,
  rating: null,
  reliability: null,
  shifts_worked: 0,
};

function candidateData(over: Partial<CandidateData> = {}): CandidateData {
  return {
    candidate: candidate(),
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
    problem: null,
    ...over,
  };
}

// ---------------------------------------------------------------------
// view-model
// ---------------------------------------------------------------------
describe('candidateReferral() / referredByLabel()', () => {
  it('reads "Referred by {name} ({employeeId})"', () => {
    const r = candidateReferral([referral()])!;
    expect(r.referrerId).toBe('r-1');
    expect(referredByLabel(r)).toBe('Referred by Luca Moretti (THC-00701)');
  });

  it('takes the most recent referral when there are several', () => {
    const r = candidateReferral([
      referral({ recorded_at: '2025-01-01T09:00:00Z', referrer_staff_id: 'old' }),
      referral({ recorded_at: '2026-09-10T09:00:00Z', referrer_staff_id: 'new' }),
    ]);
    expect(r?.referrerId).toBe('new');
  });

  it('reads "Deleted account #id" for a removed referrer (§1.7), with no second id', () => {
    const r = candidateReferral([
      referral({
        referrer: {
          first_name: 'x',
          last_name: 'y',
          employee_id: 701,
          removed_at: '2026-09-01T00:00:00Z',
        },
      }),
    ])!;
    expect(referredByLabel(r)).toBe('Referred by Deleted account #701');
  });

  it('survives a referrer row it cannot read', () => {
    expect(referredByLabel(candidateReferral([referral({ referrer: null })])!)).toBe(
      'Referred by Deleted account',
    );
  });

  it('is null with no referral', () => {
    expect(candidateReferral([])).toBeNull();
  });
});

describe('referredOnBoard()', () => {
  it('collects candidates and applications, once each', () => {
    expect(
      referredOnBoard([
        referral(),
        referral({ application_id: 'a-2' }),
        referral({ application_id: 'a-9', candidate_staff_id: 's-9' }),
      ]),
    ).toEqual({ candidates: ['c-1', 's-9'], applications: ['a-1', 'a-2', 'a-9'] });
  });
});

// ---------------------------------------------------------------------
// data — the separate admin query
// ---------------------------------------------------------------------
function reader(
  answer: (
    column: string,
    value: unknown,
  ) => { data: ReferralRow[] | null; error: { message: string } | null },
) {
  const calls: { table: string; columns: string; column: string; value: unknown }[] = [];
  return {
    calls,
    from(table: 'application_referrals') {
      return {
        select(columns: string) {
          const run = (column: string, value: unknown) => {
            calls.push({ table, columns, column, value });
            return Promise.resolve(answer(column, value));
          };
          return { in: run, eq: run };
        },
      };
    },
  };
}

describe('loadBoardReferrals()', () => {
  it('reads application_referrals, naming the referrer FK, in chunks', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `s-${i}`);
    const db = reader((_, value) => ({
      data: (value as string[]).includes('s-7')
        ? [referral({ candidate_staff_id: 's-7', application_id: 'a-7' })]
        : [],
      error: null,
    }));
    const referred = await loadBoardReferrals(db, ids);
    expect(db.calls).toHaveLength(3);
    expect(db.calls.every((call) => call.table === 'application_referrals')).toBe(true);
    expect(db.calls[0]!.columns).toContain('staff!application_referrals_referrer_staff_id_fkey');
    expect(db.calls.every((call) => call.column === 'candidate_staff_id')).toBe(true);
    expect(referred).toEqual({ candidates: ['s-7'], applications: ['a-7'] });
  });

  it('draws no chip rather than an error when the read fails', async () => {
    const db = reader(() => ({ data: null, error: { message: 'permission denied' } }));
    expect(await loadBoardReferrals(db, ['c-1'])).toEqual({ candidates: [], applications: [] });
  });

  it('asks nothing for an empty board', async () => {
    const db = reader(() => ({ data: [], error: null }));
    expect(await loadBoardReferrals(db, [])).toEqual({ candidates: [], applications: [] });
    expect(db.calls).toHaveLength(0);
  });
});

describe('loadCandidateReferral()', () => {
  it('reads this candidate only', async () => {
    const db = reader(() => ({ data: [referral()], error: null }));
    const r = await loadCandidateReferral(db, 'c-1');
    expect(db.calls[0]).toMatchObject({ column: 'candidate_staff_id', value: 'c-1' });
    expect(r && referredByLabel(r)).toBe('Referred by Luca Moretti (THC-00701)');
  });

  it('is null, not an error panel, when the read fails', async () => {
    const db = reader(() => ({ data: null, error: { message: 'boom' } }));
    expect(await loadCandidateReferral(db, 'c-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------
describe('/onboarding/:id — "Referred by"', () => {
  it('shows who referred them, linking to the referrer’s profile', () => {
    const html = renderToStaticMarkup(
      <CandidateScreen
        data={candidateData({ referral: candidateReferral([referral()]) })}
        now={NOW}
      />,
    );
    expect(html).toContain('href="/staff/r-1"');
    expect(html).toContain('Referred by Luca Moretti (THC-00701)');
  });

  it('shows it on a later phase too', () => {
    const html = renderToStaticMarkup(
      <CandidateScreen
        data={candidateData({
          candidate: candidate({ status: 'documents', rtw_branch: 'uk_irish' }),
          referral: candidateReferral([referral()]),
        })}
        now={NOW}
      />,
    );
    expect(html).toContain('Referred by Luca Moretti (THC-00701)');
  });

  it('shows nothing about referrals for someone who was not referred', () => {
    const html = renderToStaticMarkup(<CandidateScreen data={candidateData()} now={NOW} />);
    expect(html).not.toContain('Referred by');
  });
});

describe('/onboarding — the "Referred" chip', () => {
  const board = (referred?: { candidates: string[]; applications: string[] }) =>
    renderToStaticMarkup(
      <OnboardingBoard
        data={{
          candidates: [
            candidate(),
            candidate({
              id: 'c-2',
              display_name: 'Tom Price',
              first_name: 'Tom',
              last_name: 'Price',
            }),
          ],
          returning: [RETURNING],
          roles: [],
          ...(referred ? { referred } : {}),
          problem: null,
        }}
        now={NOW}
        applyUrl={null}
      />,
    );
  const chips = (html: string) => (html.match(/>Referred</g) ?? []).length;

  // One card per segment.
  const card = (html: string, name: string) =>
    html
      .split(/class="kcard/)
      .slice(1)
      .find((segment) => segment.includes(name)) ?? '';

  it('marks exactly the referred candidate', () => {
    // What the database writes since 20260930150300: a referral row for a
    // new candidate's application only (ADR-0040, security finding #5).
    const html = board({ candidates: ['c-1'], applications: ['a-1'] });
    expect(chips(html)).toBe(1);
    expect(card(html, 'Hana Kowalska')).toContain('>Referred<');
    expect(card(html, 'Tom Price')).not.toContain('>Referred<');
    expect(card(html, 'Returning applicant')).not.toContain('>Referred<');
  });

  it('marks a returning card by ITS application, not by the person', () => {
    // s-9 was referred on an earlier, candidate_created application; their
    // returning application recorded nothing, so its card carries no chip.
    expect(chips(board({ candidates: ['s-9'], applications: ['a-old'] }))).toBe(0);
  });

  it('still marks a returning card for a row recorded before 20260930150300', () => {
    const html = board({ candidates: ['s-9'], applications: ['a-9'] });
    expect(chips(html)).toBe(1);
    expect(card(html, 'Returning applicant')).toContain('>Referred<');
  });

  it('draws no chip when there are no referrals, or the read failed', () => {
    expect(chips(board())).toBe(0);
    expect(chips(board({ candidates: [], applications: [] }))).toBe(0);
  });

  it('never names the referrer on the card', () => {
    expect(board({ candidates: ['c-1'], applications: [] })).not.toContain('Referred by');
  });
});
