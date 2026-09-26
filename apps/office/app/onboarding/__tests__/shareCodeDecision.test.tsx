// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RtwCheckRow } from '../../_lib/rtwCheck';
import type { CandidateData, CandidateDocument, CandidateRow } from '../types';

/**
 * ADR-0041 on /onboarding/:id: the gov.uk check waits for the admin. A check
 * that recommends Verify shows gov.uk's date read-only and Verify sends
 * exactly that; one that recommends Reject opens the Reject box with its
 * suggested N8 text, editable. The fixtures are candidate.test.tsx's.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const ok = () => Promise.resolve({ ok: true as const, message: 'Done.' });
vi.mock('../actions', () => ({
  verifyDocument: vi.fn(ok),
  rejectDocument: vi.fn(ok),
  documentLink: vi.fn(),
}));
vi.mock('../../compliance/actions', () => ({}));
vi.mock('../../_lib/rtwCheckActions', () => ({
  runRtwCheckAgain: vi.fn(),
  markRtwCheckReviewed: vi.fn(),
  rtwReportLink: vi.fn(),
  rtwCheckPhotos: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const actions = await import('../actions');
const { CandidateScreen } = await import('../CandidateScreen');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW = {
  id: 'c-1',
  display_name: 'Hana Kowalska',
  email: 'hana.k@example.com',
  phone: '+44 7700 900456',
  dob: '2005-04-03',
  photo_path: null,
  photo_url: null,
  status: 'documents',
  stage_entered_at: '2026-09-20T09:00:00Z',
  onboarding_started_at: '2026-09-10T08:58:00Z',
  applied_at: '2026-09-10T08:58:00Z',
  employee_id: null,
  rtw_branch: 'international_student',
  right_to_work_until: '2027-03-31',
  share_code: 'W4K7P9Q2X',
  activated: true,
  role_names: ['Waiting Staff'],
  role_ids: ['r1'],
  willo_review_url: null,
  docs_total: 3,
  docs_verified: 0,
  docs_pending: 3,
  docs_rejected: 0,
  docs_missing: [],
  quiz_blockers: [],
  declaration_answer: false,
  declaration_status: 'verified',
  quiz_attempts_used: 0,
  quiz_best_score: null,
  rejection_cause: null,
  rejected_at: null,
} as unknown as CandidateRow;

const doc = (over: Partial<CandidateDocument>): CandidateDocument => ({
  id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
  review_status: 'pending',
  superseded: false,
  file_path: 'c-1/passport/p.pdf',
  uploaded_at: '2026-09-20T09:00:00Z',
  expiry_date: null,
  expires_on: null,
  ai_confidence: null,
  needs_manual_review: false,
  rejection_reason: null,
  reviewed_at: null,
  reviewed_by_name: null,
  share_code: null,
  gov_report_path: null,
  right_to_work_until: null,
  rtw_no_time_limit: false,
  term_dates: null,
  completion_date: null,
  awarding_institution: null,
  ...over,
});

const data = (over: Partial<CandidateData> = {}): CandidateData => ({
  candidate: ROW,
  profile: null,
  documents: [
    doc({ id: 'ni', doc_type: 'ni_evidence', doc_label: 'NI evidence' }),
    doc({
      id: 'sc',
      doc_type: 'share_code_report',
      doc_label: 'Share code report',
      share_code: 'W4K7P9Q2X',
    }),
  ],
  declarations: [],
  references: [],
  attempts: [],
  hmrc: null,
  application: null,
  contract: null,
  roles: [],
  rtwChecks: [],
  rtwCheckEnabled: false,
  facts: { niNumber: 'QQ123456C', belowDegreeLevel: false, visaHourLimit: null },
  problem: null,
  ...over,
});

const check = (over: Partial<RtwCheckRow>): RtwCheckRow => ({
  check_id: 'k1',
  document_id: 'sc',
  staff_id: 'c-1',
  status: 'needs_review',
  source: 'govuk',
  outcome: 'right_to_work',
  attempts: 1,
  max_attempts: 5,
  next_attempt_at: null,
  created_at: '2026-09-20T09:00:00Z',
  started_at: '2026-09-20T09:01:00Z',
  finished_at: '2026-09-20T09:02:00Z',
  right_to_work_until: '2028-03-31',
  no_time_limit: false,
  conditions: [],
  term_time_limit_hours: null,
  record_name: null,
  reference_number: null,
  review_reason:
    'gov.uk confirms a right to work until 31.03.2028. Compare the gov.uk photo with the worker’s selfie, then Verify.',
  worker_reason: null,
  error: null,
  report_path: 'c-1/share-code-report/rtw-check-k1.pdf',
  reviewed_at: null,
  stuck: false,
  recommendation: 'verify',
  photo_path: 'c-1/share-code-report/rtw-check-k1-photo.png',
  suggested_reason: null,
  ...over,
});

const shareOnly = (c: RtwCheckRow) =>
  data({
    documents: [
      doc({
        id: 'sc',
        doc_type: 'share_code_report',
        doc_label: 'Share code report',
        share_code: 'W4K7P9Q2X',
        right_to_work_until: '2028-03-31',
      }),
    ],
    rtwCheckEnabled: true,
    rtwChecks: [c],
  });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(d: CandidateData) {
  act(() => {
    root.render(<CandidateScreen data={d} now="2026-09-23T10:00:00Z" />);
  });
}

function buttons(label: string, scope: ParentNode = document.body): HTMLButtonElement[] {
  return [...scope.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
}

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('nothing to click');
  await act(async () => {
    el.click();
  });
}

function shareCard(): HTMLElement {
  const card = [...container.querySelectorAll<HTMLElement>('.pdfcard')].find((el) =>
    el.textContent?.includes('gov.uk right-to-work report'),
  );
  if (!card) throw new Error('no share code card');
  return card;
}

describe('the share code on the candidate profile (ADR-0041)', () => {
  it('verify: gov.uk’s date read-only, and Verify sends exactly it', async () => {
    render(shareOnly(check({})));
    const card = shareCard();
    expect(card.textContent).toContain('Passed — compare the photo');
    expect(card.textContent).toContain('31.03.2028');
    expect(card.textContent).toContain('Compare the photos before you verify');
    expect(card.querySelector('input[type="date"]')).toBeNull();
    await click(buttons('Verify', card)[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('c-1', 'sc', {
      periods: null,
      expiry: '2028-03-31',
    });
  });

  it('verify on settled status sends the no-time-limit value (EU settled branch)', async () => {
    const settled = shareOnly(check({ right_to_work_until: null, no_time_limit: true }));
    render({ ...settled, candidate: { ...ROW, rtw_branch: 'eu_settled' } as CandidateRow });
    const card = shareCard();
    expect(card.textContent).toContain('no time limit — settled status');
    await click(buttons('Verify', card)[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('c-1', 'sc', {
      periods: null,
      expiry: 'infinity',
    });
  });

  it('no time limit on a branch that cannot have it: Verify held, with the reason', () => {
    render(shareOnly(check({ right_to_work_until: null, no_time_limit: true })));
    const verify = buttons('Verify', shareCard())[0]!;
    expect(verify.disabled).toBe(true);
    expect(verify.title).toMatch(/EU settled status/);
  });

  it('review: the date is typed, as before', () => {
    render(shareOnly(check({ recommendation: 'review', review_reason: 'Name differs.' })));
    expect(shareCard().querySelector('input[type="date"]')).not.toBeNull();
  });

  it('reject: the Reject box opens with the suggested reason, editable', async () => {
    const suggested = 'We could not find your share code on gov.uk — please re-enter it.';
    render(
      shareOnly(
        check({
          outcome: 'not_found',
          right_to_work_until: null,
          recommendation: 'reject',
          review_reason: 'gov.uk found no record for this share code and date of birth.',
          suggested_reason: suggested,
        }),
      ),
    );
    const card = shareCard();
    expect(card.textContent).toContain('Recommend reject');
    expect(buttons('Verify', card)).toHaveLength(1);
    expect(container.textContent).not.toContain(suggested);
    await click(buttons('Reject', card)[0]);
    const textarea = document.body.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!;
    expect(textarea.value).toBe(suggested);
    await click(buttons('Reject document')[0]);
    expect(actions.rejectDocument).toHaveBeenCalledExactlyOnceWith('c-1', 'sc', suggested);
  });
});
