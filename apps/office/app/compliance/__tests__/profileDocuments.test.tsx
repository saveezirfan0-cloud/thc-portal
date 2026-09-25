import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRow, ProfileRow } from '../../staff/[id]/types';
import type { RtwCheckRow } from '../../_lib/rtwCheck';

// Outside Next there is no router, no server and no Storage.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../onboarding/actions', () => ({ documentLink: vi.fn() }));
vi.mock('../actions', () => ({
  approveCompletionLetter: vi.fn(),
  attachRtwReport: vi.fn(),
  rejectDeclaration: vi.fn(),
  rejectDocument: vi.fn(),
  reviewFacts: vi.fn(),
  setBelowDegreeLevel: vi.fn(),
  setVisaHourLimit: vi.fn(),
  startOfficeUpload: vi.fn(),
  submitOfficeCompletionLetter: vi.fn(),
  verifyDeclaration: vi.fn(),
  verifyDocument: vi.fn(),
}));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));

const { Documents } = await import('../../staff/[id]/Documents');

/**
 * /staff/:id Documents (audit item 8, D47, D31): a pending document is
 * decided on the profile with Compliance's own windows; a Student-visa
 * profile can be given a completion letter by the office; a share code
 * verified by hand can be given its gov.uk report.
 */
const PROFILE = {
  id: 's1',
  display_name: 'Amara Kalu',
  status: 'compliant',
  removed: false,
  rtw_branch: 'international_student',
  right_to_work_until: '2027-03-31',
  contract_signed_at: null,
  photo_path: null,
  photo_url: null,
} as unknown as ProfileRow;

const doc = (over: Partial<DocumentRow>): DocumentRow => ({
  id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
  review_status: 'verified',
  superseded: false,
  file_path: null,
  gov_report_path: null,
  uploaded_at: '2026-07-10T11:00:00Z',
  expiry_date: null,
  expires_on: null,
  ai_confidence: null,
  needs_manual_review: false,
  rejection_reason: null,
  reviewed_at: null,
  reviewed_by_name: null,
  share_code: null,
  right_to_work_until: null,
  rtw_no_time_limit: false,
  completion_date: null,
  awarding_institution: null,
  ...over,
});

const count = (html: string, text: string) => html.split(text).length - 1;

describe('Verify / Reject on the profile (item 8)', () => {
  it('offers Verify and Reject on a pending document, and nothing on a verified one', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[
          doc({ id: 'p', review_status: 'pending' }),
          doc({ id: 'v', review_status: 'verified' }),
        ]}
      />,
    );
    expect(count(html, '>Verify<')).toBe(1);
    expect(count(html, '>Reject<')).toBe(1);
  });

  it('approves a completion letter rather than verifying it', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[
          doc({
            doc_type: 'university_completion_letter',
            doc_label: 'Official University Completion Letter',
            review_status: 'pending',
          }),
        ]}
      />,
    );
    expect(html).toContain('>Approve<');
    expect(html).not.toContain('>Verify<');
  });

  it('leaves a share code to the automated check while it is running', () => {
    const check = {
      check_id: 'c1',
      document_id: 's',
      staff_id: 's1',
      status: 'running',
      source: null,
      outcome: null,
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: null,
      created_at: '2026-09-20T10:00:00Z',
      started_at: null,
      finished_at: null,
      right_to_work_until: null,
      no_time_limit: false,
      conditions: [],
      term_time_limit_hours: null,
      record_name: null,
      reference_number: null,
      review_reason: null,
      worker_reason: null,
      error: null,
      report_path: null,
      reviewed_at: null,
      stuck: false,
    } as RtwCheckRow;
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[
          doc({
            id: 's',
            doc_type: 'share_code_report',
            doc_label: 'Share code report',
            review_status: 'pending',
          }),
        ]}
        rtwChecks={[check]}
        rtwCheckEnabled
      />,
    );
    expect(html).not.toContain('>Verify<');
    expect(html).toContain('>Reject<');
  });

  it('offers no review on a removed profile', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={{ ...PROFILE, status: 'removed', removed: true } as ProfileRow}
        documents={[doc({ review_status: 'pending' })]}
      />,
    );
    expect(html).not.toContain('>Verify<');
    expect(html).not.toContain('>Reject<');
  });
});

describe('what the office adds itself (D47, D31)', () => {
  it('offers the completion-letter upload on a Student-visa profile', () => {
    const html = renderToStaticMarkup(<Documents profile={PROFILE} documents={[]} />);
    expect(html).toContain('Upload completion letter');
  });

  it('does not offer it while one is waiting, or off the Student route', () => {
    const waiting = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[doc({ doc_type: 'university_completion_letter', review_status: 'pending' })]}
      />,
    );
    expect(waiting).not.toContain('Upload completion letter');
    const work = renderToStaticMarkup(
      <Documents profile={{ ...PROFILE, rtw_branch: 'work_visa' } as ProfileRow} documents={[]} />,
    );
    expect(work).not.toContain('Upload completion letter');
  });

  it('offers "Attach gov.uk report" on a share code with none on file', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[
          doc({ id: 's', doc_type: 'share_code_report', doc_label: 'Share code report' }),
          doc({
            id: 't',
            doc_type: 'share_code_report',
            doc_label: 'Share code report',
            gov_report_path: 's1/share-code-report/r.pdf',
          }),
        ]}
      />,
    );
    expect(count(html, 'Attach gov.uk report')).toBe(1);
  });

  it('writes no section numbers on the screen', () => {
    const html = renderToStaticMarkup(
      <Documents profile={PROFILE} documents={[doc({ review_status: 'pending' })]} />,
    );
    expect(html).not.toMatch(/§\d/);
  });
});
