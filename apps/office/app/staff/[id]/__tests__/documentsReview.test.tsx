// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueRow } from '../../../compliance/types';
import type { DeclarationRow, DocumentRow, ProfileRow } from '../types';
import type { RtwCheckRow } from '../../../_lib/rtwCheck';

/**
 * Verify / Reject on the /staff/:id Documents tab (§4.1, §9.6).
 *
 * The point under test is that there is ONE review path: the buttons act on
 * this worker's rows of the Needs review queue, and every click lands in
 * /compliance's own server actions — the module mocked below. The
 * onboarding module is mocked with `documentLink` only, so a stray call to
 * its verify_document wrapper would throw here.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../../onboarding/actions', () => ({ documentLink: vi.fn() }));
vi.mock('../../../_lib/rtwCheckActions', () => ({
  runRtwCheckAgain: vi.fn(),
  markRtwCheckReviewed: vi.fn(),
  rtwReportLink: vi.fn(),
  // Never settles: the photo pair stays "Loading the photos…" in these tests.
  rtwCheckPhotos: vi.fn(() => new Promise(() => {})),
}));
const ok = () => Promise.resolve({ ok: true as const, message: 'Verified.' });
vi.mock('../../../compliance/actions', () => ({
  verifyDocument: vi.fn(ok),
  rejectDocument: vi.fn(ok),
  approveCompletionLetter: vi.fn(ok),
  confirmRtwDate: vi.fn(ok),
  verifyDeclaration: vi.fn(ok),
  rejectDeclaration: vi.fn(ok),
}));

const actions = await import('../../../compliance/actions');
const { Documents } = await import('../Documents');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE = {
  id: 's1',
  status: 'compliant',
  display_name: 'Amara Kofi',
  contract_signed_at: null,
  photo_path: null,
  photo_url: null,
} as unknown as ProfileRow;

const doc = (over: Partial<DocumentRow>): DocumentRow => ({
  id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
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
  rtw_branch: 'student_visa',
  photo_path: null,
  item_type: 'passport',
  item_label: 'Passport',
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

/** Buttons with exactly this label, anywhere on the page (dialogs included). */
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

describe('which rows carry Verify / Reject', () => {
  it('a pending document on the queue has both, as the wireframe draws it', () => {
    render({ documents: [doc({})], reviewQueue: [queued({})] });
    expect(buttons('Verify')).toHaveLength(1);
    expect(buttons('Reject')).toHaveLength(1);
    expect(container.textContent).toContain('Under review');
  });

  it('a pending document the queue does not list has neither (the queue decides, §4.1)', () => {
    render({ documents: [doc({})], reviewQueue: [] });
    expect(buttons('Verify')).toHaveLength(0);
    expect(buttons('Reject')).toHaveLength(0);
  });

  it('a Rejected or Removed worker has nothing to review, and the row says why', () => {
    render({
      profile: { ...PROFILE, status: 'rejected' } as ProfileRow,
      documents: [doc({})],
      reviewQueue: [],
    });
    expect(buttons('Verify')).toHaveLength(0);
    expect(container.textContent).toContain('No longer needs review');
  });

  it('a verified document has neither', () => {
    render({ documents: [doc({ review_status: 'verified' })], reviewQueue: [] });
    expect(buttons('Verify')).toHaveLength(0);
    expect(buttons('Reject')).toHaveLength(0);
  });

  it('a share code the automated check still owns offers Reject but no hand-typed Verify (ADR-0025)', () => {
    render({
      documents: [doc({ doc_type: 'share_code_report', doc_label: 'Share code' })],
      reviewQueue: [
        queued({
          item_type: 'share_code_report',
          item_label: 'Share code',
          rtw_check_id: 'k1',
          rtw_check_status: 'failed',
          rtw_manual_allowed: false,
        }),
      ],
      rtwCheckEnabled: true,
    });
    expect(buttons('Verify')).toHaveLength(0);
    expect(buttons('Reject')).toHaveLength(1);
    expect(container.textContent).toContain('Verified by the automatic gov.uk check');
  });

  it('a share code verified without its date offers Confirm date and no Reject', () => {
    render({
      documents: [
        doc({ doc_type: 'share_code_report', doc_label: 'Share code', review_status: 'verified' }),
      ],
      reviewQueue: [
        queued({ kind: 'rtw_date', item_type: 'share_code_report', item_label: 'Share code' }),
      ],
    });
    expect(buttons('Confirm date')).toHaveLength(1);
    expect(buttons('Reject')).toHaveLength(0);
    expect(container.textContent).toContain('re-verify');
  });

  it('says so when the queue could not be read, rather than hiding the buttons silently', () => {
    render({ documents: [doc({})], reviewQueueProblem: 'permission denied' });
    expect(container.textContent).toContain('Verify / Reject are unavailable here');
  });
});

describe('every click lands in /compliance’s own actions', () => {
  it('Verify on a passport verifies it at once', async () => {
    render({ documents: [doc({})], reviewQueue: [queued({})] });
    await click(buttons('Verify')[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('d1');
  });

  it('Verify on a visa asks for its expiry first, then sends it', async () => {
    render({
      documents: [doc({ id: 'd2', doc_type: 'visa_document', doc_label: 'Visa' })],
      reviewQueue: [
        queued({
          item_id: 'd2',
          item_type: 'visa_document',
          item_label: 'Visa',
          expiry_date: '2027-06-30',
        }),
      ],
    });
    await click(buttons('Verify')[0]);
    expect(actions.verifyDocument).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain('Visa expiry');
    await click(buttons('Verify', dialog())[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('d2', { expiry: '2027-06-30' });
  });

  it('Verify on a completion letter opens the approval with both dates', async () => {
    render({
      documents: [
        doc({ id: 'd3', doc_type: 'university_completion_letter', doc_label: 'Completion letter' }),
      ],
      reviewQueue: [
        queued({
          item_id: 'd3',
          item_type: 'university_completion_letter',
          item_label: 'Completion letter',
          completion_date_claimed: '2026-07-10',
          staff_right_to_work_until: '2028-03-31',
        }),
      ],
    });
    await click(buttons('Verify')[0]);
    expect(dialog().getAttribute('aria-label')).toBe('Approve completion letter');
    await click(buttons('Approve', dialog())[0]);
    expect(actions.approveCompletionLetter).toHaveBeenCalledExactlyOnceWith(
      'd3',
      '2026-07-10',
      '2028-03-31',
    );
    expect(actions.verifyDocument).not.toHaveBeenCalled();
  });

  it('Reject needs a worker-facing reason, then sends it (N8)', async () => {
    render({ documents: [doc({})], reviewQueue: [queued({})] });
    await click(buttons('Reject')[0]);
    const submit = buttons('Reject document', dialog())[0]!;
    expect(submit.disabled).toBe(true);
    expect(dialog().textContent).toContain('push N8');
    type(dialog().querySelector('textarea')!, 'Photo page is cut off');
    expect(submit.disabled).toBe(false);
    await click(submit);
    expect(actions.rejectDocument).toHaveBeenCalledExactlyOnceWith('d1', 'Photo page is cut off');
  });

  it('the declaration keeps its Verify / Reject, through the same dialogs', async () => {
    const declaration: DeclarationRow = {
      id: 'x2',
      source: 'in_employment',
      answer: true,
      details: null,
      conviction_date: null,
      review_status: 'pending',
      declared_at: '2026-09-20T10:00:00Z',
      reviewed_at: null,
    };
    const row = queued({
      kind: 'declaration',
      item_id: 'x2',
      item_type: 'criminal_declaration',
      item_label: 'Criminal Record declaration',
      declaration_source: 'in_employment',
    });
    render({ declarations: [declaration], reviewQueue: [row] });
    await click(buttons('Verify')[0]);
    expect(actions.verifyDeclaration).toHaveBeenCalledExactlyOnceWith('x2');

    await click(buttons('Reject')[0]);
    expect(dialog().textContent).toContain('The worker is not told through the app');
    type(dialog().querySelector('textarea')!, 'Offence relevant to the role');
    await click(buttons('Reject declaration', dialog())[0]);
    expect(actions.rejectDeclaration).toHaveBeenCalledExactlyOnceWith(
      'x2',
      'Offence relevant to the role',
    );
  });
});

describe('ADR-0041: the admin decides every gov.uk check', () => {
  const shareDoc = doc({ doc_type: 'share_code_report', doc_label: 'Share code' });
  const check = (over: Partial<RtwCheckRow>): RtwCheckRow => ({
    check_id: 'k1',
    document_id: 'd1',
    staff_id: 's1',
    status: 'needs_review',
    source: 'govuk',
    outcome: 'right_to_work',
    attempts: 1,
    max_attempts: 5,
    next_attempt_at: null,
    created_at: '2026-09-25T06:10:00Z',
    started_at: '2026-09-25T06:11:00Z',
    finished_at: '2026-09-25T06:12:00Z',
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
    report_path: 's1/share-code-report/rtw-check-k1.pdf',
    reviewed_at: null,
    stuck: false,
    recommendation: 'verify',
    photo_path: 's1/share-code-report/rtw-check-k1-photo.png',
    suggested_reason: null,
    ...over,
  });
  const shareRow = (over: Partial<QueueRow> = {}) =>
    queued({
      item_type: 'share_code_report',
      item_label: 'Share code',
      rtw_check_id: 'k1',
      rtw_check_status: 'needs_review',
      rtw_check_outcome: 'right_to_work',
      rtw_check_until: '2028-03-31',
      rtw_manual_allowed: true,
      ...over,
    });

  it('verify: gov.uk’s date is shown read-only and sent exactly on Verify', async () => {
    render({
      documents: [shareDoc],
      rtwChecks: [check({})],
      rtwCheckEnabled: true,
      reviewQueue: [shareRow()],
    });
    expect(container.textContent).toContain('Recommend verify — compare the photo');
    expect(container.textContent).toContain('Compare the photos before you verify');
    await click(buttons('Verify')[0]);
    const box = dialog();
    expect(box.querySelector('input[type="date"]')).toBeNull();
    expect(box.querySelector('[data-testid="rtw-locked-until"]')?.textContent).toContain(
      '31.03.2028',
    );
    expect(box.textContent).toContain('recommends Verify');
    await click(buttons('Verify', box)[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('d1', {
      rightToWorkUntil: '2028-03-31',
    });
  });

  it('verify on settled status sends the no-time-limit value', async () => {
    render({
      documents: [shareDoc],
      rtwChecks: [check({ right_to_work_until: null, no_time_limit: true })],
      rtwCheckEnabled: true,
      reviewQueue: [
        shareRow({
          rtw_branch: 'eu_settled',
          rtw_check_until: null,
          rtw_check_no_time_limit: true,
        }),
      ],
    });
    await click(buttons('Verify')[0]);
    expect(dialog().textContent).toContain('no time limit — settled status');
    expect(dialog().querySelector('input[type="checkbox"]')).toBeNull();
    await click(buttons('Verify', dialog())[0]);
    expect(actions.verifyDocument).toHaveBeenCalledExactlyOnceWith('d1', {
      rightToWorkUntil: 'infinity',
    });
  });

  it('review: the date is still typed by the admin', async () => {
    render({
      documents: [shareDoc],
      rtwChecks: [check({ recommendation: 'review', review_reason: 'Name differs.' })],
      rtwCheckEnabled: true,
      reviewQueue: [shareRow()],
    });
    await click(buttons('Verify')[0]);
    expect(dialog().querySelector('input[type="date"]')).not.toBeNull();
    expect(dialog().querySelector('[data-testid="rtw-locked-until"]')).toBeNull();
  });

  it('reject: the Reject box opens with the suggested reason, editable', async () => {
    const suggested = 'We could not find your share code on gov.uk — please re-enter it.';
    render({
      documents: [shareDoc],
      rtwChecks: [
        check({
          outcome: 'not_found',
          right_to_work_until: null,
          recommendation: 'reject',
          review_reason: 'gov.uk found no record for this share code and date of birth.',
          suggested_reason: suggested,
        }),
      ],
      rtwCheckEnabled: true,
      reviewQueue: [shareRow({ rtw_check_outcome: 'not_found', rtw_check_until: null })],
    });
    expect(container.textContent).toContain('Recommend reject');
    // Office-only until the admin rejects: not on the page before Reject is opened.
    expect(container.textContent).not.toContain(suggested);
    await click(buttons('Reject')[0]);
    const textarea = dialog().querySelector('textarea')!;
    expect(textarea.value).toBe(suggested);
    expect(dialog().textContent).toContain('recommends Reject');
    type(textarea, 'Share code not found — please check it and enter it again.');
    await click(buttons('Reject document', dialog())[0]);
    expect(actions.rejectDocument).toHaveBeenCalledExactlyOnceWith(
      'd1',
      'Share code not found — please check it and enter it again.',
    );
  });

  it('a stale check (not the one the queue names) lends nothing', async () => {
    render({
      documents: [shareDoc],
      rtwChecks: [check({ check_id: 'k0', recommendation: 'reject', suggested_reason: 'x' })],
      rtwCheckEnabled: true,
      reviewQueue: [shareRow()],
    });
    await click(buttons('Reject')[0]);
    expect(dialog().querySelector('textarea')!.value).toBe('');
  });
});
