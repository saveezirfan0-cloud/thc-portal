import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QueueRow } from '../../compliance/types';
import type { RtwCheckRow } from '../rtwCheck';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../rtwCheckActions', () => ({
  runRtwCheckAgain: vi.fn(),
  markRtwCheckReviewed: vi.fn(),
  rtwReportLink: vi.fn(),
}));

const { parseRtwCheckRow, rtwCheckView, ukStampFull } = await import('../rtwCheck');
const { queueRowCheck, verifyAllowed, verifyHint, documentLine } =
  await import('../../compliance/queue');
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
    expect(check).toMatchObject({ check_id: 'k1', document_id: 'd1', review_reason: 'why' });
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
