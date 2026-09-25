// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RtwCheckRow } from '../../../_lib/rtwCheck';
import type { QueueRow } from '../../../compliance/types';
import type { DocumentRow, ProfileRow } from '../types';

/**
 * What the Documents tab adds to /compliance's one review path
 * (20260930130100 / 20260930130400):
 *
 *   · the NI number beside NI evidence, and the NI check row once the
 *     number arrives — Matches / Reject (D43);
 *   · the course level or a visa's hours limit beside the Verify that
 *     says so (D32, D36);
 *   · the office's own evidence: "Attach gov.uk report" on the manual path
 *     (D31) and "Upload completion letter" for a student (D47).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../../onboarding/actions', () => ({ documentLink: vi.fn() }));
vi.mock('../../../_lib/rtwCheckActions', () => ({
  runRtwCheckAgain: vi.fn(),
  markRtwCheckReviewed: vi.fn(),
  rtwReportLink: vi.fn(),
}));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
const ok = () => Promise.resolve({ ok: true as const, message: 'Done.' });
vi.mock('../../../compliance/actions', () => ({
  verifyDocument: vi.fn(ok),
  rejectDocument: vi.fn(ok),
  approveCompletionLetter: vi.fn(ok),
  confirmRtwDate: vi.fn(ok),
  verifyDeclaration: vi.fn(ok),
  rejectDeclaration: vi.fn(ok),
  resolveNiCheck: vi.fn(ok),
  attachRtwReport: vi.fn(ok),
  setBelowDegreeLevel: vi.fn(ok),
  setVisaHourLimit: vi.fn(ok),
  startOfficeUpload: vi.fn(ok),
  submitOfficeCompletionLetter: vi.fn(ok),
}));

const actions = await import('../../../compliance/actions');
const { Documents } = await import('../Documents');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE = {
  id: 's1',
  status: 'compliant',
  rtw_branch: 'uk_irish',
  display_name: 'Amara Kofi',
  contract_signed_at: null,
  photo_path: null,
  photo_url: null,
} as unknown as ProfileRow;

const doc = (over: Partial<DocumentRow>): DocumentRow => ({
  id: 'd1',
  doc_type: 'ni_evidence',
  doc_label: 'NI evidence',
  review_status: 'pending',
  superseded: false,
  file_path: null,
  gov_report_path: null,
  uploaded_at: '2026-09-24T10:00:00Z',
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

/** One row of compliance_review_queue_v. Every value is synthetic. */
const queued = (over: Partial<QueueRow>): QueueRow => ({
  kind: 'document',
  item_id: 'd1',
  staff_id: 's1',
  display_name: 'Amara Kofi',
  employee_id: 873,
  status: 'compliant',
  is_candidate: false,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'uk_irish',
  photo_path: null,
  item_type: 'ni_evidence',
  item_label: 'NI evidence',
  submitted_at: '2026-09-24T10:00:00Z',
  file_path: null,
  ai_confidence: null,
  needs_manual_review: false,
  expiry_date: null,
  term_dates: null,
  doc_right_to_work_until: null,
  share_code: null,
  awarding_institution: null,
  is_reupload: false,
  previous_rejection: null,
  declaration_source: null,
  declaration_details: null,
  conviction_date: null,
  staff_right_to_work_until: null,
  evidence_form: null,
  completion_date_claimed: null,
  mime_type: null,
  size_bytes: null,
  review_reason: null,
  manual_review_reason: null,
  ...over,
});

const check = (over: Partial<RtwCheckRow>): RtwCheckRow => ({
  check_id: 'k1',
  document_id: 'd5',
  staff_id: 's1',
  status: 'passed',
  source: 'provider',
  outcome: 'right_to_work',
  attempts: 1,
  max_attempts: 5,
  next_attempt_at: null,
  created_at: '2026-09-24T10:00:00Z',
  started_at: null,
  finished_at: '2026-09-24T10:01:00Z',
  right_to_work_until: '2030-01-01',
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
  ...over,
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

function render(props: Partial<Parameters<typeof Documents>[0]>) {
  act(() => {
    root.render(<Documents profile={PROFILE} documents={[]} {...props} />);
  });
}

function buttons(label: string, scope: ParentNode = container): HTMLButtonElement[] {
  return [...scope.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
}

function dialog(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('no dialog open');
  return el;
}

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('nothing to click');
  await act(async () => {
    el.click();
  });
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the NI number beside its evidence (D43)', () => {
  it('Verify on NI evidence shows the full number first, then verifies', async () => {
    render({ documents: [doc({})], reviewQueue: [queued({ ni_number: 'QQ123456C' })] });
    await click(buttons('Verify')[0]);
    expect(actions.verifyDocument).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain('QQ 12 34 56 C');
    await click(buttons('Verify', dialog())[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('d1', {});
  });

  it('with no number yet, says it comes back to compare once it is entered', async () => {
    render({ documents: [doc({})], reviewQueue: [queued({ ni_number: null })] });
    await click(buttons('Verify')[0]);
    expect(dialog().textContent).toContain('comes back to Needs review');
  });

  it('the NI check row offers Matches and Reject on the verified evidence', async () => {
    render({
      documents: [doc({ review_status: 'verified' })],
      reviewQueue: [queued({ kind: 'ni_check', ni_number: 'QQ123456C' })],
    });
    expect(container.textContent).toContain('compare NI number');
    await click(buttons('Matches')[0]);
    expect(actions.resolveNiCheck).toHaveBeenCalledExactlyOnceWith('d1', true);
    expect(actions.verifyDocument).not.toHaveBeenCalled();

    await click(buttons('Reject')[0]);
    expect(dialog().getAttribute('aria-label')).toBe('NI number does not match');
    type(dialog().querySelector('textarea')!, 'Different number on the letter');
    await click(buttons('Reject document', dialog())[0]);
    expect(actions.resolveNiCheck).toHaveBeenLastCalledWith(
      'd1',
      false,
      'Different number on the letter',
    );
    expect(actions.rejectDocument).not.toHaveBeenCalled();
  });
});

describe('the conditions beside a Verify (D32, D36)', () => {
  it('a work visa’s Verify carries its hours limit, pre-filled from the file', async () => {
    render({
      profile: { ...PROFILE, rtw_branch: 'work_visa' } as ProfileRow,
      documents: [doc({ id: 'd2', doc_type: 'visa_document', doc_label: 'Visa' })],
      reviewQueue: [
        queued({
          item_id: 'd2',
          item_type: 'visa_document',
          item_label: 'Visa',
          rtw_branch: 'work_visa',
          expiry_date: '2027-06-30',
          visa_weekly_hour_limit: 20,
        }),
      ],
    });
    await click(buttons('Verify')[0]);
    expect(dialog().textContent).toContain('Weekly hours limit on the visa');
    await click(buttons('Verify', dialog())[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith(
      'd2',
      { expiry: '2027-06-30' },
      { staffId: 's1', visaHourLimit: '20' },
    );
  });

  it('a student’s term letter asks for the course level', async () => {
    render({
      profile: { ...PROFILE, rtw_branch: 'international_student' } as ProfileRow,
      documents: [doc({ id: 'd4', doc_type: 'university_term_dates_letter', doc_label: 'Letter' })],
      reviewQueue: [
        queued({
          item_id: 'd4',
          item_type: 'university_term_dates_letter',
          item_label: 'Letter',
          rtw_branch: 'international_student',
          below_degree_level: false,
        }),
      ],
    });
    await click(buttons('Verify')[0]);
    const box = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    await act(async () => {
      box.click();
    });
    await click(buttons('Verify', dialog())[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith(
      'd4',
      {},
      { staffId: 's1', belowDegreeLevel: true },
    );
  });
});

describe('the office’s own evidence (D31, D47)', () => {
  const share = doc({
    id: 'd5',
    doc_type: 'share_code_report',
    doc_label: 'Share code',
    review_status: 'verified',
  });

  it('offers "Attach gov.uk report" on a hand-verified share code with none on file', () => {
    render({ documents: [share], rtwCheckEnabled: false });
    expect(buttons('Attach gov.uk report')).toHaveLength(1);
  });

  it('not while the automated check owns it, and not once a report is on file', () => {
    render({ documents: [share], rtwChecks: [check({})], rtwCheckEnabled: true });
    expect(buttons('Attach gov.uk report')).toHaveLength(0);
    render({ documents: [{ ...share, gov_report_path: 's1/share-code-report/r.pdf' }] });
    expect(buttons('Attach gov.uk report')).toHaveLength(0);
  });

  it('once the check needs review, the office may attach the report it downloaded', () => {
    render({
      documents: [share],
      rtwChecks: [check({ status: 'needs_review' })],
      rtwCheckEnabled: true,
    });
    expect(buttons('Attach gov.uk report')).toHaveLength(1);
  });

  it('offers "Upload completion letter" on a student’s profile only', () => {
    render({ profile: { ...PROFILE, rtw_branch: 'international_student' } as ProfileRow });
    expect(buttons('Upload completion letter')).toHaveLength(1);
    render({ profile: { ...PROFILE, rtw_branch: 'work_visa' } as ProfileRow });
    expect(buttons('Upload completion letter')).toHaveLength(0);
  });
});
