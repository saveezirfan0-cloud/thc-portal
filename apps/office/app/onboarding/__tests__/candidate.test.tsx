import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONTRACT_VERSION_CLAUSE_28_PENDING } from '@thc/domain';
import type { CandidateData, CandidateDocument, CandidateRow } from '../types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../actions', () => ({}));
vi.mock('../../compliance/actions', () => ({}));
vi.mock('../../_lib/rtwCheckActions', () => ({}));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const { CandidateScreen } = await import('../CandidateScreen');

/**
 * /onboarding/:id at the Documents phase: the NI number beside the NI
 * evidence in full (D43), the course level for a student (D32), the office's
 * completion-letter upload (D47) and the gov.uk report on the manual path
 * (D31) — and no builder annotations on the screen.
 */
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

const render = (d: CandidateData) =>
  renderToStaticMarkup(<CandidateScreen data={d} now="2026-09-23T10:00:00Z" />);

describe('the candidate profile, Documents phase', () => {
  it('D43: shows the full NI number beside the NI evidence', () => {
    expect(render(data())).toContain('NI number on the profile: QQ 12 34 56 C');
  });

  it('D43: says when it is not entered yet, and that the document comes back', () => {
    const html = render(
      data({ facts: { niNumber: null, belowDegreeLevel: false, visaHourLimit: null } }),
    );
    expect(html).toContain('No NI number entered yet');
    expect(html).toContain('comes back to Needs review');
  });

  it('D32: offers the course level for a student', () => {
    expect(render(data())).toContain('Course is below degree level');
  });

  it('D47: offers the office’s completion-letter upload for a student', () => {
    expect(render(data())).toContain('Upload completion letter');
  });

  it('D31: offers "Attach gov.uk report" on a share code with none on file', () => {
    expect(render(data())).toContain('Attach gov.uk report');
    const attached = render(
      data({
        documents: [
          doc({
            id: 'sc',
            doc_type: 'share_code_report',
            doc_label: 'Share code report',
            gov_report_path: 'c-1/share-code-report/r.pdf',
          }),
        ],
      }),
    );
    expect(attached).not.toContain('Attach gov.uk report');
  });

  it('D31: not while the automated check owns the share code', () => {
    const owned = render(
      data({
        rtwCheckEnabled: true,
        rtwChecks: [
          {
            check_id: 'k1',
            document_id: 'sc',
            staff_id: 'c-1',
            status: 'queued',
            source: null,
            outcome: null,
            attempts: 0,
            max_attempts: 5,
            next_attempt_at: null,
            created_at: '2026-09-20T09:00:00Z',
            started_at: null,
            finished_at: null,
            right_to_work_until: null,
            no_time_limit: false,
            conditions: null,
            term_time_limit_hours: null,
            record_name: null,
            reference_number: null,
            review_reason: null,
            worker_reason: null,
            error: null,
            report_path: null,
            reviewed_at: null,
            stuck: false,
            recommendation: null,
            photo_path: null,
            suggested_reason: null,
          },
        ],
      }),
    );
    expect(owned).not.toContain('Attach gov.uk report');
  });

  it('D43: says NI evidence verified before the number is waiting to be compared', () => {
    const html = render(
      data({
        documents: [
          doc({
            id: 'ni',
            doc_type: 'ni_evidence',
            doc_label: 'NI evidence',
            review_status: 'verified',
            ni_recheck: true,
          }),
        ],
      }),
    );
    expect(html).toContain('waiting in Needs review to be compared');
  });

  it('shows Willo not connected as a neutral, disabled button', () => {
    const html = render(data({ candidate: { ...ROW, status: 'interview_completed' } }));
    expect(html).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Review interview on Willo — not connected/,
    );
  });

  it('renders no builder annotations', () => {
    const html = render(data());
    expect(html).not.toContain('class="annot');
    expect(html).not.toContain('ml-auto annot');
  });
});

describe('the candidate profile, Contract phase (§2.11)', () => {
  const signed = (version: string) =>
    render(
      data({
        candidate: {
          ...ROW,
          status: 'compliant',
          contract_version: version,
          contract_signed_at: '2026-09-26T09:00:00Z',
        } as CandidateData['candidate'],
        contract: {
          version,
          title: 'Agreement',
          body: '1. PARTIES.\n\n28. DUTY TO DISCLOSE CRIMINAL CONVICTIONS. Declare any unspent criminal conviction.',
          is_placeholder: true,
        },
      }),
    );

  it('names clause 28 only for THC’s agreement, the version it was added to', () => {
    expect(signed(CONTRACT_VERSION_CLAUSE_28_PENDING)).toContain(
      'Clause 28, the ongoing duty to disclose an unspent conviction, is awaiting THC’s approval.',
    );
  });

  it('any other flagged version gets the generic placeholder note', () => {
    const html = signed('placeholder-2026-09');
    expect(html).toContain('Placeholder wording until THC supplies the agreement text.');
    expect(html).not.toContain('Clause 28');
  });
});
