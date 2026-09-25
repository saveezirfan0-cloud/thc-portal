import { describe, expect, it, vi } from 'vitest';
import { rtwOutcomeLabel, rtwRejectReason } from '@thc/domain';
import type { RtwCheckOutcome } from '@thc/domain';
import {
  RTW_CHECKING,
  RTW_CHECK_FAILED,
  RTW_CHECK_SOURCE,
  RTW_NO_TIME_LIMIT,
  canRerunRtwCheck,
  checkReasons,
  rerunErrorMessage,
  rerunMessage,
  rtwCheckView,
  rtwChecksByDocument,
  rtwPlanLabel,
  rtwRejectPrefill,
  rtwVerifyPlan,
} from '../rtwCheck';
import type { RtwCheckRow } from '../rtwCheck';
import { readRtwChecks } from '../rtwCheckData';
import { NO_TIME_LIMIT, rtwDateValue } from '../rtw';

function row(over: Partial<RtwCheckRow> = {}): RtwCheckRow {
  return {
    document_id: 'doc-1',
    staff_id: 'staff-1',
    status: 'done',
    outcome: 'pass',
    source: 'govuk',
    // 07:12 in London (BST) — the audit stamp must say so whoever reads it.
    finished_at: '2026-09-13T06:12:00Z',
    holder_name: 'Amara Kofi',
    right_to_work_until: '2028-03-31',
    no_time_limit: false,
    conditions: 'Student — max 20 h/week in term time; full time in vacations',
    report_path: 'staff-1/rtw/report.pdf',
    photo_path: 'staff-1/rtw/photo.jpg',
    result: { reasons: [], permissionType: 'Student visa' },
    ...over,
  };
}

describe('rtwCheckView — status → what the office sees (ADR-0025)', () => {
  it('shows nothing new for no row or a cancelled check: today’s UI stands', () => {
    expect(rtwCheckView(null)).toBeNull();
    expect(rtwCheckView(undefined)).toBeNull();
    expect(rtwCheckView(row({ status: 'cancelled', outcome: null }))).toBeNull();
  });

  it('says "Checking with gov.uk…" while queued or running, and nothing else', () => {
    for (const status of ['queued', 'running'] as const) {
      const view = rtwCheckView(row({ status, outcome: null, finished_at: null }));
      expect(view).toMatchObject({
        state: 'checking',
        headline: RTW_CHECKING,
        tone: 'cyan',
        outcome: null,
        checkedAt: null,
        untilLabel: null,
        hasPhoto: false,
        hasReport: false,
      });
    }
  });

  it('a re-queued check never shows the previous result’s photo or report', () => {
    const view = rtwCheckView(row({ status: 'queued', outcome: null }));
    expect(view?.hasPhoto).toBe(false);
    expect(view?.hasReport).toBe(false);
  });

  it('sends a failed check to the manual flow', () => {
    expect(rtwCheckView(row({ status: 'failed', outcome: null }))).toMatchObject({
      state: 'failed',
      headline: RTW_CHECK_FAILED,
      outcome: null,
      hasPhoto: false,
    });
    expect(RTW_CHECK_FAILED).toBe('Couldn’t check automatically — check by hand');
  });

  it('labels every outcome with the domain’s words and tone', () => {
    const tones: Record<RtwCheckOutcome, string> = {
      pass: 'green',
      name_mismatch: 'amber',
      conditions_mismatch: 'amber',
      not_found: 'coral',
      no_right_to_work: 'coral',
    };
    for (const [outcome, tone] of Object.entries(tones) as [RtwCheckOutcome, string][]) {
      const view = rtwCheckView(row({ outcome }));
      expect(view?.headline).toBe(rtwOutcomeLabel(outcome));
      expect(view?.tone).toBe(tone);
    }
  });

  it('carries source, UK-only checked stamp, date, conditions, permission type and name', () => {
    expect(rtwCheckView(row())).toMatchObject({
      state: 'done',
      source: RTW_CHECK_SOURCE,
      checkedAt: '13/09/2026 07:12 UK time',
      rightToWorkUntil: '2028-03-31',
      untilLabel: '31/03/2028',
      noTimeLimit: false,
      conditions: 'Student — max 20 h/week in term time; full time in vacations',
      permissionType: 'Student visa',
      holderName: 'Amara Kofi',
      recommended: 'verify',
      hasPhoto: true,
      hasReport: true,
    });
    expect(RTW_CHECK_SOURCE).toBe('gov.uk · automatic check');
  });

  it('reads the stamp in GMT in winter too — never the viewer’s zone', () => {
    expect(rtwCheckView(row({ finished_at: '2026-12-01T09:05:00Z' }))?.checkedAt).toBe(
      '01/12/2026 09:05 UK time',
    );
  });

  it('shows "No time limit" when gov.uk gave no end date', () => {
    const view = rtwCheckView(row({ right_to_work_until: null, no_time_limit: true }));
    expect(view?.untilLabel).toBe(RTW_NO_TIME_LIMIT);
    expect(view?.noTimeLimit).toBe(true);
  });

  it('lists result.reasons verbatim and ignores anything that is not a sentence', () => {
    const reasons = ['gov.uk shows "A B", the profile says "C D".', 'Second.'];
    expect(rtwCheckView(row({ outcome: 'name_mismatch', result: { reasons } }))?.reasons).toEqual(
      reasons,
    );
    expect(checkReasons({ reasons: ['ok', 3, null, '  ', ' trimmed '] })).toEqual([
      'ok',
      'trimmed',
    ]);
    expect(checkReasons(null)).toEqual([]);
    expect(checkReasons({ reasons: 'not a list' })).toEqual([]);
    expect(checkReasons(['a'])).toEqual([]);
  });

  it('reads no permission type from a result without one', () => {
    expect(rtwCheckView(row({ result: {} }))?.permissionType).toBeNull();
  });

  it('treats a done row without an outcome as a failure to check, never a pass', () => {
    expect(rtwCheckView(row({ outcome: null }))?.state).toBe('failed');
  });

  it('keys by document and drops cancelled checks', () => {
    const map = rtwChecksByDocument([
      row({ document_id: 'a' }),
      row({ document_id: 'b', status: 'cancelled', outcome: null }),
      row({ document_id: 'c', status: 'running', outcome: null }),
    ]);
    expect(Object.keys(map).sort()).toEqual(['a', 'c']);
    expect(rtwChecksByDocument(null)).toEqual({});
  });
});

describe('rtwVerifyPlan — gov.uk’s date read-only, or typed by the reviewer', () => {
  const pass = rtwCheckView(row());

  it('a passing check supplies the date read-only', () => {
    const plan = rtwVerifyPlan(pass, 'international_student', '2028-03-31');
    expect(plan).toEqual({ mode: 'govuk', date: '2028-03-31', noTimeLimit: false });
    expect(rtwPlanLabel(plan)).toBe('31/03/2028');
    expect(rtwDateValue(plan.date, plan.noTimeLimit)).toBe('2028-03-31');
  });

  it('uses gov.uk’s date even when the document carries a different one', () => {
    expect(rtwVerifyPlan(pass, 'work_visa', '2027-01-01').date).toBe('2028-03-31');
  });

  it('pre-selects settled — no time limit on the EU settled branch', () => {
    const settled = rtwCheckView(row({ right_to_work_until: null, no_time_limit: true }));
    const plan = rtwVerifyPlan(settled, 'eu_settled', null);
    expect(plan).toEqual({ mode: 'govuk', date: '', noTimeLimit: true });
    expect(rtwPlanLabel(plan)).toBe('Settled — no time limit');
    expect(rtwDateValue(plan.date, plan.noTimeLimit)).toBe(NO_TIME_LIMIT);
  });

  it('falls back to manual when no time limit is off the settled branch (the DB would refuse)', () => {
    const settled = rtwCheckView(row({ right_to_work_until: null, no_time_limit: true }));
    expect(rtwVerifyPlan(settled, 'international_student', null)).toEqual({
      mode: 'manual',
      date: '',
      noTimeLimit: false,
    });
  });

  it('asks for the date by hand without a passing check, pre-filled from the document', () => {
    const cases = [
      null,
      rtwCheckView(row({ status: 'queued', outcome: null })),
      rtwCheckView(row({ status: 'failed', outcome: null })),
      rtwCheckView(row({ outcome: 'name_mismatch' })),
      rtwCheckView(row({ outcome: 'conditions_mismatch' })),
      rtwCheckView(row({ outcome: 'not_found', right_to_work_until: null })),
      rtwCheckView(row({ outcome: 'no_right_to_work' })),
    ];
    for (const check of cases) {
      expect(rtwVerifyPlan(check, 'work_visa', '2027-06-30')).toEqual({
        mode: 'manual',
        date: '2027-06-30',
        noTimeLimit: false,
      });
      expect(rtwVerifyPlan(check, 'work_visa', null).date).toBe('');
    }
  });
});

describe('rtwRejectPrefill — the worker-facing reason for N8', () => {
  it('pre-fills not_found and no_right_to_work from the domain', () => {
    for (const outcome of ['not_found', 'no_right_to_work'] as const) {
      const text = rtwRejectPrefill(rtwCheckView(row({ outcome })));
      expect(text).toBe(rtwRejectReason(outcome));
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('starts empty for every other outcome, a running or failed check, and no check', () => {
    for (const outcome of ['pass', 'name_mismatch', 'conditions_mismatch'] as const) {
      expect(rtwRejectPrefill(rtwCheckView(row({ outcome })))).toBe('');
    }
    expect(rtwRejectPrefill(rtwCheckView(row({ status: 'running', outcome: null })))).toBe('');
    expect(rtwRejectPrefill(rtwCheckView(row({ status: 'failed', outcome: null })))).toBe('');
    expect(rtwRejectPrefill(null)).toBe('');
  });
});

describe('Run check again', () => {
  it('is offered on a pending share code report only', () => {
    const doc = {
      doc_type: 'share_code_report',
      review_status: 'pending',
      share_code: 'W12345678',
    };
    expect(canRerunRtwCheck(doc)).toBe(true);
    expect(canRerunRtwCheck({ ...doc, review_status: 'verified' })).toBe(false);
    expect(canRerunRtwCheck({ ...doc, review_status: 'rejected' })).toBe(false);
    expect(canRerunRtwCheck({ ...doc, doc_type: 'visa_document' })).toBe(false);
    expect(canRerunRtwCheck({ ...doc, share_code: null })).toBe(false);
    expect(canRerunRtwCheck({ ...doc, share_code: '  ' })).toBe(false);
  });

  it('words each answer of rerun_rtw_check', () => {
    expect(rerunMessage({ ok: true, checkId: 'c', alreadyQueued: false })).toMatchObject({
      ok: true,
      message: expect.stringMatching(/queued/i),
    });
    expect(rerunMessage({ ok: true, checkId: 'c', alreadyQueued: true })).toMatchObject({
      ok: true,
      message: expect.stringMatching(/already queued/i),
    });
    expect(rerunMessage({ ok: false, reason: 'not_enabled' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/switched off/i),
    });
  });

  it('words each refusal', () => {
    expect(rerunErrorMessage('not_authorised')).toMatch(/Only the office/);
    expect(rerunErrorMessage('not_pending')).toMatch(/already been verified or rejected/);
    expect(rerunErrorMessage('not_a_share_code')).toMatch(/Only a share code report/);
    expect(rerunErrorMessage('document_not_found')).toMatch(/no longer exists/);
    expect(rerunErrorMessage('something else')).toBe('something else');
  });
});

describe('readRtwChecks — the session read, degrading to the manual flow', () => {
  function client(response: { data: RtwCheckRow[] | null; error: { message: string } | null }) {
    const eq = vi.fn(async (_column: string, _value: string) => response);
    const inFn = vi.fn(async (_column: string, _values: string[]) => response);
    const select = vi.fn((_columns: string) => ({ eq, in: inFn }));
    const from = vi.fn((_table: string) => ({ select }));
    return { client: { from }, from, select, eq, in: inFn };
  }

  it('reads a worker’s checks by staff id', async () => {
    const c = client({ data: [row()], error: null });
    const map = await readRtwChecks(c.client, { staffId: 'staff-1' });
    expect(c.from).toHaveBeenCalledWith('rtw_checks');
    expect(c.select.mock.calls[0]?.[0]).not.toMatch(/share_code|dob/);
    expect(c.eq).toHaveBeenCalledWith('staff_id', 'staff-1');
    expect(map['doc-1']?.state).toBe('done');
  });

  it('reads the queue’s checks by document id, once each', async () => {
    const c = client({ data: [], error: null });
    await readRtwChecks(c.client, { documentIds: ['a', 'b', 'a'] });
    expect(c.in).toHaveBeenCalledWith('document_id', ['a', 'b']);
  });

  it('does not query for an empty queue', async () => {
    const c = client({ data: [], error: null });
    expect(await readRtwChecks(c.client, { documentIds: [] })).toEqual({});
    expect(c.from).not.toHaveBeenCalled();
  });

  it('returns no checks on an error or a throw, never a failed page', async () => {
    const c = client({ data: null, error: { message: 'relation "rtw_checks" does not exist' } });
    expect(await readRtwChecks(c.client, { staffId: 's' })).toEqual({});
    const throwing = {
      from: () => {
        throw new Error('boom');
      },
    };
    expect(await readRtwChecks(throwing, { staffId: 's' })).toEqual({});
  });
});
