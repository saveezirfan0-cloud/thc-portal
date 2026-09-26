import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QueueRow } from '../../compliance/types';
import type { RtwCheckRow } from '../rtwCheck';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../rtwCheckActions', () => ({
  runRtwCheckAgain: vi.fn(),
  markRtwCheckReviewed: vi.fn(),
  rtwReportLink: vi.fn(),
  // Never settles: the photo pair stays "Loading the photos…" in these tests.
  rtwCheckPhotos: vi.fn(() => new Promise(() => {})),
}));

const { parseRtwCheckRow, rtwCheckView, rtwLockedLabel, rtwLockedValue, ukStampFull } =
  await import('../rtwCheck');
const {
  queueRowCheck,
  queueRowLockedUntil,
  rejectPrefill,
  verifyAllowed,
  verifyHint,
  documentLine,
  withLatestCheck,
} = await import('../../compliance/queue');
const { RtwCheckPanel } = await import('../../_components/RtwCheckPanel');

/** ADR-0025. Every value here is synthetic. */
const row = (over: Partial<RtwCheckRow> = {}): RtwCheckRow => ({
  check_id: 'k1',
  document_id: 'd1',
  staff_id: 's1',
  status: 'passed',
  source: 'provider',
  outcome: 'right_to_work',
  attempts: 1,
  max_attempts: 5,
  next_attempt_at: null,
  created_at: '2026-09-25T06:10:00Z',
  started_at: '2026-09-25T06:11:00Z',
  finished_at: '2026-09-25T06:12:00Z',
  right_to_work_until: '2028-03-31',
  no_time_limit: false,
  conditions: ['They can work up to 20 hours a week during term time.'],
  term_time_limit_hours: 20,
  record_name: 'Amara Kofi',
  reference_number: 'SYNTH-1',
  review_reason: null,
  worker_reason: null,
  error: null,
  report_path: 's1/share-code-report/rtw-check-k1.pdf',
  reviewed_at: null,
  stuck: false,
  recommendation: null,
  photo_path: null,
  suggested_reason: null,
  ...over,
});

describe('rtwCheckView', () => {
  it('a pass: green, the date as the reminder expiry, the conditions, the report', () => {
    const view = rtwCheckView(row(), { docStatus: 'verified', enabled: true });
    expect(view.status).toEqual({ tone: 'green', label: 'Passed' });
    expect(view.lines.map((l) => l.k)).toEqual([
      'Checked',
      'Right to work until',
      'Conditions',
      'Name on the record',
      'gov.uk reference',
    ]);
    expect(view.lines[0]!.v).toBe('25.09.2026 07:12 UK time · right-to-work provider');
    expect(view.lines[1]!.v).toMatch(/^31\.03\.2028 — the expiry used for reminders/);
    expect(view.hasReport).toBe(true);
    expect(view.canRunAgain).toBe(false);
    expect(view.manualAllowed).toBe(false);
  });

  it('in flight: no Verify, no Run again, and it says it is checking', () => {
    const view = rtwCheckView(row({ status: 'running', outcome: null, finished_at: null }), {
      docStatus: 'pending',
      enabled: true,
    });
    expect(view.inFlight).toBe(true);
    expect(view.canRunAgain).toBe(false);
    expect(view.manualAllowed).toBe(false);
    expect(view.lines[0]!.v).toMatch(/^checking with gov\.uk…/);
  });

  it('a failed attempt waiting to retry says when', () => {
    const view = rtwCheckView(
      row({
        status: 'queued',
        attempts: 2,
        next_attempt_at: '2026-09-25T09:00:00Z',
        outcome: 'error',
      }),
      { docStatus: 'pending', enabled: true },
    );
    expect(view.lines[0]!.v).toBe('attempt 2 of 5 failed · next try 25.09.2026 10:00 UK time');
  });

  it('stuck (the runner is not running): surfaced, with the hand-typed date (QA 25.09)', () => {
    const view = rtwCheckView(
      row({ status: 'queued', outcome: null, finished_at: null, report_path: null, stuck: true }),
      { docStatus: 'pending', enabled: true },
    );
    expect(view.status).toEqual({ tone: 'coral', label: 'Not running' });
    expect(view.reason).toMatch(/has not run/);
    expect(view.manualAllowed).toBe(true);
    expect(view.canRunAgain).toBe(false);
  });

  it('needs review: the reason, the hand-typed date allowed, Run again offered', () => {
    const view = rtwCheckView(
      row({ status: 'needs_review', review_reason: 'Name does not match.' }),
      {
        docStatus: 'pending',
        enabled: true,
      },
    );
    expect(view.reason).toBe('Name does not match.');
    expect(view.manualAllowed).toBe(true);
    expect(view.canRunAgain).toBe(true);
    expect(view.canMarkReviewed).toBe(false);
  });

  it('no right to work, document rejected: Mark reviewed, once', () => {
    const r = row({
      status: 'needs_review',
      outcome: 'no_right_to_work',
      right_to_work_until: null,
    });
    expect(rtwCheckView(r, { docStatus: 'rejected', enabled: true }).canMarkReviewed).toBe(true);
    expect(
      rtwCheckView(
        { ...r, reviewed_at: '2026-09-25T08:00:00Z' },
        { docStatus: 'rejected', enabled: true },
      ).canMarkReviewed,
    ).toBe(false);
    // A read-only profile is not the place to clear it.
    expect(rtwCheckView(r, { docStatus: 'read_only', enabled: true }).canMarkReviewed).toBe(false);
  });

  it('switched off: the manual date as before (ADR-0018), no Run again', () => {
    const view = rtwCheckView(null, { docStatus: 'pending', enabled: false });
    expect(view.status).toBeNull();
    expect(view.manualAllowed).toBe(true);
    expect(view.canRunAgain).toBe(false);
  });

  it('on, never run (filed before it was switched on): Run gov.uk check, no manual date', () => {
    const view = rtwCheckView(null, { docStatus: 'pending', enabled: true });
    expect(view.canRunAgain).toBe(true);
    expect(view.manualAllowed).toBe(false);
  });

  it('settled status reads as no time limit', () => {
    const view = rtwCheckView(row({ right_to_work_until: null, no_time_limit: true }), {
      docStatus: 'verified',
      enabled: true,
    });
    expect(view.lines.find((l) => l.k === 'Right to work until')!.v).toBe(
      'no time limit (settled status)',
    );
  });

  it('parses the view row defensively', () => {
    expect(parseRtwCheckRow({ status: 'bogus' })).toBeNull();
    expect(
      parseRtwCheckRow({ ...row(), conditions: ['a', 3], source: 'elsewhere' } as unknown as Record<
        string,
        unknown
      >),
    ).toMatchObject({ conditions: ['a'], source: null });
  });

  it('stamps are UK time (§1.8)', () => {
    expect(ukStampFull('2026-01-15T09:05:00Z')).toBe('15.01.2026 09:05 UK time');
  });
});

describe('the Compliance queue', () => {
  const base = {
    kind: 'document',
    item_id: 'd1',
    staff_id: 's1',
    item_type: 'share_code_report',
    submitted_at: '2026-09-25T06:00:00Z',
  } as unknown as QueueRow;

  it('offers Verify on a share code only when the hand-typed date is allowed', () => {
    expect(verifyAllowed({ ...base, rtw_manual_allowed: false })).toBe(false);
    expect(verifyHint({ ...base, rtw_manual_allowed: false })).toMatch(/automatic gov\.uk check/);
    expect(verifyAllowed({ ...base, rtw_manual_allowed: true })).toBe(true);
    expect(verifyAllowed({ ...base, item_type: 'passport', rtw_manual_allowed: null })).toBe(true);
    expect(verifyAllowed({ ...base, kind: 'rtw_check' })).toBe(false);
  });

  it('carries the latest check into the shared panel', () => {
    expect(queueRowCheck(base)).toBeNull();
    const check = queueRowCheck({
      ...base,
      rtw_check_id: 'k1',
      rtw_check_status: 'needs_review',
      rtw_check_reason: 'why',
      rtw_check_until: '2028-03-31',
      rtw_checked_at: '2026-09-25T06:12:00Z',
    });
    expect(check).toMatchObject({
      check_id: 'k1',
      document_id: 'd1',
      review_reason: 'why',
      stuck: false,
    });
    expect(
      queueRowCheck({
        ...base,
        rtw_check_id: 'k2',
        rtw_check_status: 'queued',
        rtw_manual_allowed: true,
      })?.stuck,
    ).toBe(true);
  });

  it('words the no-right-to-work item', () => {
    expect(documentLine({ ...base, kind: 'rtw_check' })).toMatch(/no right to work/);
  });
});

describe('RtwCheckPanel', () => {
  it('draws the check with its buttons', () => {
    const html = renderToStaticMarkup(
      <RtwCheckPanel
        row={row({ status: 'needs_review', review_reason: 'Name does not match.' })}
        docId="d1"
        docStatus="pending"
        enabled
      />,
    );
    expect(html).toContain('Automatic gov.uk check');
    expect(html).toContain('Needs review');
    expect(html).toContain('Name does not match.');
    expect(html).toContain('Download gov.uk report');
    expect(html).toContain('Run check again');
  });

  it('draws nothing with no check and nothing to do', () => {
    expect(
      renderToStaticMarkup(<RtwCheckPanel row={null} docId="d1" docStatus="verified" enabled />),
    ).toBe('');
  });
});

describe('ADR-0041: every result waits for the admin', () => {
  const verifyRec = (over: Partial<RtwCheckRow> = {}) =>
    row({
      status: 'needs_review',
      source: 'govuk',
      recommendation: 'verify',
      review_reason:
        'gov.uk confirms a right to work until 31.03.2028. Compare the gov.uk photo with the worker’s selfie, then Verify.',
      photo_path: 's1/share-code-report/rtw-check-k1-photo.png',
      ...over,
    });
  const rejectRec = (over: Partial<RtwCheckRow> = {}) =>
    row({
      status: 'needs_review',
      source: 'govuk',
      outcome: 'not_found',
      right_to_work_until: null,
      conditions: [],
      recommendation: 'reject',
      review_reason: 'gov.uk found no record for this share code and date of birth.',
      suggested_reason: 'We could not find your share code on gov.uk — please re-enter it.',
      ...over,
    });

  it('verify: cyan "Recommend verify — compare the photo", the gov.uk date locked while pending', () => {
    const view = rtwCheckView(verifyRec(), { docStatus: 'pending', enabled: true });
    expect(view.status).toEqual({ tone: 'cyan', label: 'Recommend verify — compare the photo' });
    expect(view.recommendation).toBe('verify');
    expect(view.lockedUntil).toEqual({ date: '2028-03-31', noTimeLimit: false });
    expect(view.suggestedReason).toBeNull();
    // Still the needs-review semantics underneath (the one Verify path).
    expect(view.manualAllowed).toBe(true);
  });

  it('verify on settled status locks "no time limit"', () => {
    const view = rtwCheckView(verifyRec({ right_to_work_until: null, no_time_limit: true }), {
      docStatus: 'pending',
      enabled: true,
    });
    expect(view.lockedUntil).toEqual({ date: null, noTimeLimit: true });
    expect(rtwLockedValue(view.lockedUntil!)).toBe('infinity');
    expect(rtwLockedLabel(view.lockedUntil!)).toBe('no time limit — settled status');
  });

  it('lockedUntil is only for verify on a pending document', () => {
    for (const docStatus of ['verified', 'rejected', 'read_only', 'superseded']) {
      expect(rtwCheckView(verifyRec(), { docStatus, enabled: true }).lockedUntil).toBeNull();
    }
    expect(
      rtwCheckView(rejectRec(), { docStatus: 'pending', enabled: true }).lockedUntil,
    ).toBeNull();
    expect(
      rtwCheckView(verifyRec({ recommendation: 'review' }), { docStatus: 'pending', enabled: true })
        .lockedUntil,
    ).toBeNull();
    expect(
      rtwCheckView(verifyRec({ recommendation: null }), { docStatus: 'pending', enabled: true })
        .lockedUntil,
    ).toBeNull();
    // A verify recommendation with no date to confirm falls back to typing it.
    expect(
      rtwCheckView(verifyRec({ right_to_work_until: null }), {
        docStatus: 'pending',
        enabled: true,
      }).lockedUntil,
    ).toBeNull();
  });

  it('reject: amber "Recommend reject" and the office-only suggested reason', () => {
    const view = rtwCheckView(rejectRec(), { docStatus: 'pending', enabled: true });
    expect(view.status).toEqual({ tone: 'amber', label: 'Recommend reject' });
    expect(view.suggestedReason).toBe(
      'We could not find your share code on gov.uk — please re-enter it.',
    );
    expect(view.lockedUntil).toBeNull();
    // Never shown as the worker's own "asked to re-enter" line.
    expect(view.lines.map((l) => l.k)).not.toContain('Worker asked to re-enter');
  });

  it('review / none: unchanged', () => {
    const review = rtwCheckView(
      row({ status: 'needs_review', recommendation: 'review', review_reason: 'Name differs.' }),
      { docStatus: 'pending', enabled: true },
    );
    expect(review.status).toEqual({ tone: 'coral', label: 'Needs review' });
    expect(review.suggestedReason).toBeNull();
    expect(review.lockedUntil).toBeNull();
    expect(
      rtwCheckView(row({ status: 'needs_review' }), { docStatus: 'pending', enabled: true }).status,
    ).toEqual({ tone: 'coral', label: 'Needs review' });
    // A passed check (admin_confirms off) is the plain pass.
    expect(
      rtwCheckView(row({ recommendation: 'verify' }), { docStatus: 'verified', enabled: true })
        .status,
    ).toEqual({ tone: 'green', label: 'Passed' });
  });

  it('parses the new columns, and reads their absence as null', () => {
    const before = { ...row() } as Record<string, unknown>;
    delete before['recommendation'];
    delete before['photo_path'];
    delete before['suggested_reason'];
    expect(parseRtwCheckRow(before)).toMatchObject({
      recommendation: null,
      photo_path: null,
      suggested_reason: null,
    });
    expect(
      parseRtwCheckRow({
        ...rejectRec({ photo_path: 's1/share-code-report/p.png' }),
      } as unknown as Record<string, unknown>),
    ).toMatchObject({
      recommendation: 'reject',
      photo_path: 's1/share-code-report/p.png',
      suggested_reason: 'We could not find your share code on gov.uk — please re-enter it.',
    });
    expect(
      parseRtwCheckRow({ ...row(), recommendation: 'approve', suggested_reason: '' } as Record<
        string,
        unknown
      >),
    ).toMatchObject({ recommendation: null, suggested_reason: null });
  });

  describe('on the queue', () => {
    const base = {
      kind: 'document',
      item_id: 'd1',
      staff_id: 's1',
      item_type: 'share_code_report',
      submitted_at: '2026-09-25T06:00:00Z',
      rtw_check_id: 'k1',
      rtw_check_status: 'needs_review',
      rtw_check_outcome: 'right_to_work',
      rtw_check_until: '2028-03-31',
      rtw_manual_allowed: true,
    } as unknown as QueueRow;

    it('merges the latest check by document — only the same check', () => {
      const merged = withLatestCheck(base, verifyRec());
      expect(merged.rtw_check_recommendation).toBe('verify');
      expect(merged.rtw_check_photo_path).toBe('s1/share-code-report/rtw-check-k1-photo.png');
      expect(withLatestCheck(base, verifyRec({ check_id: 'k0' }))).toBe(base);
      expect(withLatestCheck(base, undefined)).toBe(base);
      expect(
        withLatestCheck({ ...base, item_type: 'passport' }, verifyRec()).rtw_check_recommendation,
      ).toBeUndefined();
      expect(queueRowCheck(merged)).toMatchObject({ recommendation: 'verify' });
    });

    it('locks gov.uk’s date on a verify recommendation, and says what Verify does', () => {
      const merged = withLatestCheck(base, verifyRec());
      expect(queueRowLockedUntil(merged)).toEqual({ date: '2028-03-31', noTimeLimit: false });
      expect(verifyHint(merged)).toMatch(/Verify confirms the date gov\.uk returned/);
      expect(queueRowLockedUntil(base)).toBeNull();
      expect(queueRowLockedUntil({ ...merged, kind: 'rtw_date' })).toBeNull();
    });

    it('pre-fills Reject with the suggested reason on a reject recommendation only', () => {
      const rejected = withLatestCheck(
        { ...base, rtw_check_outcome: 'not_found', rtw_check_until: null },
        rejectRec(),
      );
      expect(rejectPrefill(rejected)).toBe(
        'We could not find your share code on gov.uk — please re-enter it.',
      );
      expect(verifyHint(rejected)).toMatch(/reason is pre-filled/);
      expect(rejectPrefill(withLatestCheck(base, verifyRec()))).toBe('');
      expect(rejectPrefill(base)).toBe('');
      expect(rejectPrefill({ ...rejected, item_type: 'passport' })).toBe('');
    });
  });

  it('the panel sets the photos beside each other on a finished check', () => {
    const html = renderToStaticMarkup(
      <RtwCheckPanel row={verifyRec()} docId="d1" docStatus="pending" enabled />,
    );
    expect(html).toContain('Recommend verify — compare the photo');
    expect(html).toContain('Compare the photos before you verify');
    expect(html).toContain('rtwcheck-reason verify');
    // Never a storage path in the markup: the server action signs it.
    expect(html).not.toContain('rtw-check-k1-photo.png');
  });

  it('no photos while the check is in flight', () => {
    const html = renderToStaticMarkup(
      <RtwCheckPanel
        row={row({ status: 'running', outcome: null, finished_at: null })}
        docId="d1"
        docStatus="pending"
        enabled
      />,
    );
    expect(html).not.toContain('Compare the photos');
  });
});
