import { describe, expect, it, vi } from 'vitest';
import { RTW_NOT_FOUND_REASON, rtwCheckError } from '@thc/domain';
import type { RtwCheckResult, RtwCheckSource } from '@thc/domain';
import { checkJobSecret } from '../../../_lib/auth';
import { parseUkDate, ukToday } from '../checker';
import type { CheckOutput, RightToWorkChecker } from '../checker';
import { photoPath, reportPath, runOrchestrated, runRtwCheckSweep } from '../sweep';
import type { ClaimedCheck, RecordInput } from '../sweep';

/** Every result here is SYNTHETIC (ADR-0025). */
const PDF = new TextEncoder().encode('%PDF-1.7 synthetic');
const INPUT = { shareCode: 'W123AB4CD', dateOfBirth: '1996-05-05', companyName: 'THC' };

function pass(source: RtwCheckSource, over: Partial<RtwCheckResult> = {}): RtwCheckResult {
  return {
    outcome: 'right_to_work',
    fullName: 'Marta Villanueva',
    rightToWorkUntil: '2028-03-31',
    conditions: [],
    termTimeLimitHours: null,
    referenceNumber: 'SYNTH-1',
    checkedAt: '2026-09-25T07:00:00Z',
    source,
    ...over,
  };
}

function checker(
  source: RtwCheckSource,
  ...outputs: CheckOutput[]
): RightToWorkChecker & { calls: number } {
  const c = {
    source,
    calls: 0,
    check: vi.fn(async () => {
      c.calls += 1;
      return outputs[Math.min(c.calls - 1, outputs.length - 1)]!;
    }),
  };
  return c;
}

describe('runOrchestrated — provider first, gov.uk only when it errors', () => {
  it('a provider pass with its report settles it; gov.uk never runs', async () => {
    const provider = checker('provider', { result: pass('provider'), report: PDF });
    const govuk = checker('govuk', { result: pass('govuk'), report: PDF });
    const out = await runOrchestrated(provider, govuk, INPUT);
    expect(out.tried).toEqual(['provider']);
    expect(govuk.calls).toBe(0);
  });

  it('a definitive negative from the provider is final — no fallback', async () => {
    for (const outcome of ['not_found', 'no_right_to_work'] as const) {
      const provider = checker('provider', { result: pass('provider', { outcome }), report: null });
      const govuk = checker('govuk', { result: pass('govuk'), report: PDF });
      const out = await runOrchestrated(provider, govuk, INPUT);
      expect(out.result.outcome).toBe(outcome);
      expect(govuk.calls).toBe(0);
    }
  });

  it('a provider error goes to gov.uk', async () => {
    const provider = checker('provider', {
      result: rtwCheckError('provider', 'provider_http_503'),
      report: null,
    });
    const govuk = checker('govuk', { result: pass('govuk'), report: PDF });
    const out = await runOrchestrated(provider, govuk, INPUT);
    expect(out.tried).toEqual(['provider', 'govuk']);
    expect(out.result.source).toBe('govuk');
  });

  it('a provider pass without the report §2.6 stores goes to gov.uk for one', async () => {
    const provider = checker('provider', { result: pass('provider'), report: null });
    const govuk = checker('govuk', {
      result: rtwCheckError('govuk', 'govuk_timeout'),
      report: null,
    });
    const out = await runOrchestrated(provider, govuk, INPUT);
    // gov.uk failed too: the pass (without its report) is the better answer to record.
    expect(out.result).toMatchObject({ outcome: 'right_to_work', source: 'provider' });
  });

  it('a thrown adapter is an error, never an escape', async () => {
    const provider: RightToWorkChecker = {
      source: 'provider',
      check: async () => {
        throw new Error('W123AB4CD');
      },
    };
    const out = await runOrchestrated(provider, null, INPUT);
    expect(out.result).toMatchObject({ outcome: 'error', error: 'provider_threw_error' });
  });
});

describe('runRtwCheckSweep', () => {
  const row: ClaimedCheck = {
    check_id: 'c1',
    staff_id: 's1',
    document_id: 'd1',
    attempt: 1,
    max_attempts: 5,
    share_code: 'W123AB4CD',
    date_of_birth: '1996-05-05',
    first_name: 'Marta',
    last_name: 'Villanueva',
    rtw_branch: 'eu_settled',
    below_degree_level: false,
  };

  function deps(
    primary: RightToWorkChecker | null,
    over: Partial<Parameters<typeof runRtwCheckSweep>[0]> = {},
  ) {
    const recorded: RecordInput[] = [];
    const uploads: string[] = [];
    const removed: string[] = [];
    const lines: string[] = [];
    const claim = vi.fn(async () => [row]);
    return {
      recorded,
      uploads,
      removed,
      lines,
      claim,
      d: {
        primary,
        fallback: null,
        companyName: 'The Hospitality Company',
        limit: 3,
        claim,
        uploadReport: async (path: string) => {
          uploads.push(path);
        },
        removeReport: async (path: string) => {
          removed.push(path);
        },
        stillRunning: async () => true as boolean | null,
        record: async (input: RecordInput) => {
          recorded.push(input);
          return {
            status:
              input.decision.action === 'verify'
                ? 'passed'
                : input.decision.action === 'retry'
                  ? 'queued'
                  : input.decision.action === 'reject'
                    ? 'rejected'
                    : 'needs_review',
          };
        },
        now: () => new Date('2026-09-25T07:00:00Z'),
        log: (line: string) => lines.push(line),
        ...over,
      },
    };
  }

  it('claims nothing when no adapter is configured, so no attempt is spent', async () => {
    const t = deps(null);
    expect(await runRtwCheckSweep(t.d)).toEqual({ skipped: 'not_configured' });
    expect(t.claim).not.toHaveBeenCalled();
  });

  it('a pass uploads the report under the worker and records a verify', async () => {
    const t = deps(checker('provider', { result: pass('provider'), report: PDF }));
    const counts = await runRtwCheckSweep(t.d);
    expect(counts).toMatchObject({ claimed: 1, passed: 1 });
    expect(t.uploads).toEqual(['s1/share-code-report/rtw-check-c1.pdf']);
    expect(t.recorded[0]).toMatchObject({
      checkId: 'c1',
      reportPath: reportPath('s1', 'c1'),
      decision: { action: 'verify', rightToWorkUntil: '2028-03-31', noTimeLimit: false },
      error: null,
    });
  });

  it('not found is recorded as a reject with the worker-facing reason', async () => {
    const t = deps(
      checker('provider', {
        result: pass('provider', { outcome: 'not_found', fullName: null }),
        report: null,
      }),
    );
    await runRtwCheckSweep(t.d);
    expect(t.recorded[0]!.decision).toEqual({
      action: 'reject',
      workerReason: RTW_NOT_FOUND_REASON,
      officeReason: null,
    });
  });

  it('a page with two different end dates goes to the office with its report, never to a retry', async () => {
    const t = deps(
      checker('govuk', { result: rtwCheckError('govuk', 'govuk_unreadable_date'), report: PDF }),
    );
    const counts = await runRtwCheckSweep(t.d);
    expect(t.recorded[0]!.decision.action).toBe('needs_review');
    expect(t.recorded[0]!.reportPath).toBe('s1/share-code-report/rtw-check-c1.pdf');
    expect(counts).toMatchObject({ needs_review: 1, queued: 0 });
  });

  it('a missing end date is retried first; only the last attempt goes to the office, with the report', async () => {
    const noDate = checker('govuk', {
      result: rtwCheckError('govuk', 'govuk_no_expiry'),
      report: PDF,
    });
    const early = deps(noDate);
    await runRtwCheckSweep(early.d);
    expect(early.recorded[0]!.decision.action).toBe('retry');
    expect(early.uploads).toEqual([]);

    const last = deps(noDate, { claim: async () => [{ ...row, attempt: 5 }] });
    await runRtwCheckSweep(last.d);
    expect(last.recorded[0]!.decision.action).toBe('needs_review');
    expect(last.recorded[0]!.reportPath).toBe('s1/share-code-report/rtw-check-c1.pdf');
  });

  it('hands the office what the gov.uk page showed when the date could not be read', async () => {
    const t = deps(
      checker('govuk', {
        result: rtwCheckError('govuk', 'govuk_no_expiry'),
        report: PDF,
        hint: 'Status type 4 | Review due 12 August 2027',
      }),
      { claim: async () => [{ ...row, attempt: 3 }] },
    );
    await runRtwCheckSweep(t.d);
    const d = t.recorded[0]!.decision;
    expect(d.action).toBe('needs_review');
    if (d.action === 'needs_review') {
      expect(d.officeReason).toContain('Page: Status type 4 | Review due 12 August 2027');
      expect(d.officeReason.length).toBeLessThanOrEqual(500);
    }
  });

  it('keeps the office reason and adds the page lines when the page was read but the name did not match', async () => {
    const t = deps(
      checker('govuk', {
        result: {
          outcome: 'right_to_work',
          fullName: null,
          rightToWorkUntil: null,
          conditions: [],
          termTimeLimitHours: null,
          referenceNumber: null,
          checkedAt: '2026-10-06T21:00:00.000Z',
          source: 'govuk',
        },
        report: PDF,
        hint: 'Name | ▢ ▢ | They have the right to work in the UK.',
      }),
    );
    await runRtwCheckSweep(t.d);
    const d = t.recorded[0]!.decision;
    expect(d.action).toBe('needs_review');
    if (d.action === 'needs_review') {
      expect(d.officeReason).toMatch(/^The name on the gov\.uk record does not match/);
      expect(d.officeReason).toContain('Page: Name | ▢ ▢ | They have the right to work');
    }
  });

  it('runs the claimed checks a couple at a time, and records every one', async () => {
    let live = 0;
    let peak = 0;
    const slow: RightToWorkChecker = {
      source: 'provider',
      async check() {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live -= 1;
        return { result: pass('provider'), report: PDF };
      },
    };
    const rows = [1, 2, 3, 4, 5].map((n) => ({ ...row, check_id: `c${n}` }));
    const t = deps(slow, { claim: async () => rows });
    const counts = await runRtwCheckSweep(t.d);
    expect(t.recorded.map((r) => r.checkId).sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(peak).toBe(2);
    expect(counts).toMatchObject({ claimed: 5, passed: 5 });
  });

  it('a report that cannot be stored turns a pass into a retry', async () => {
    const t = deps(checker('provider', { result: pass('provider'), report: PDF }), {
      uploadReport: async () => {
        throw new Error('storage down');
      },
    });
    await runRtwCheckSweep(t.d);
    expect(t.recorded[0]!.decision).toEqual({ action: 'retry', error: 'report_upload_failed' });
    expect(t.recorded[0]!.reportPath).toBeNull();
  });

  it('a record that fails is counted and left for the lease to lapse', async () => {
    const t = deps(checker('provider', { result: pass('provider'), report: PDF }), {
      record: async () => {
        throw new Error('db down');
      },
    });
    expect(await runRtwCheckSweep(t.d)).toMatchObject({ record_errors: 1 });
  });

  it('a record that fails removes the report nothing references (QA 25.09)', async () => {
    const t = deps(checker('provider', { result: pass('provider'), report: PDF }), {
      record: async () => {
        throw new Error('refused');
      },
    });
    await runRtwCheckSweep(t.d);
    expect(t.uploads).toEqual(['s1/share-code-report/rtw-check-c1.pdf']);
    expect(t.removed).toEqual(['s1/share-code-report/rtw-check-c1.pdf']);
  });

  it('…but keeps it when the record may have landed (a lost response)', async () => {
    for (const answer of [false, null]) {
      const t = deps(checker('provider', { result: pass('provider'), report: PDF }), {
        record: async () => {
          throw new Error('network');
        },
        stillRunning: async () => answer,
      });
      await runRtwCheckSweep(t.d);
      expect(t.removed).toEqual([]);
    }
  });

  it('a retry uploads nothing, so nothing is orphaned', async () => {
    const withReport = { result: rtwCheckError('govuk', 'govuk_timeout'), report: PDF };
    const t = deps(checker('govuk', withReport));
    await runRtwCheckSweep(t.d);
    expect(t.uploads).toEqual([]);
    expect(t.recorded[0]).toMatchObject({ decision: { action: 'retry' }, reportPath: null });
  });

  describe('the gov.uk photo, for the admin to compare (ADR-0041)', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

    it('is uploaded beside the report, under the worker, and filed on the check before the record', async () => {
      const order: string[] = [];
      const t = deps(checker('govuk', { result: pass('govuk'), report: PDF, photo: PNG }), {
        uploadPhoto: async (path: string) => {
          order.push(`upload ${path}`);
        },
        attachPhoto: async (checkId: string, path: string) => {
          order.push(`attach ${checkId} ${path}`);
        },
      });
      const record = t.d.record;
      t.d.record = async (input) => {
        order.push('record');
        return record(input);
      };
      await runRtwCheckSweep(t.d);
      expect(photoPath('s1', 'c1', 1)).toBe('s1/share-code-report/rtw-check-c1-a1-photo.png');
      expect(order).toEqual([
        'upload s1/share-code-report/rtw-check-c1-a1-photo.png',
        'attach c1 s1/share-code-report/rtw-check-c1-a1-photo.png',
        'record',
      ]);
    });

    it('a photo that cannot be filed is removed, and the check still records', async () => {
      const t = deps(checker('govuk', { result: pass('govuk'), report: PDF, photo: PNG }), {
        uploadPhoto: async () => undefined,
        attachPhoto: async () => {
          throw new Error('attach failed');
        },
      });
      await runRtwCheckSweep(t.d);
      expect(t.removed).toEqual(['s1/share-code-report/rtw-check-c1-a1-photo.png']);
      expect(t.recorded).toHaveLength(1);
    });

    it('a retry keeps no photo either', async () => {
      const uploaded: string[] = [];
      const t = deps(
        checker('govuk', {
          result: rtwCheckError('govuk', 'govuk_timeout'),
          report: PDF,
          photo: PNG,
        }),
        {
          uploadPhoto: async (path: string) => {
            uploaded.push(path);
          },
          attachPhoto: async () => undefined,
        },
      );
      await runRtwCheckSweep(t.d);
      expect(uploaded).toEqual([]);
    });
  });

  it('logs no share code, date of birth or name', async () => {
    const t = deps(
      checker('provider', { result: rtwCheckError('provider', 'provider_http_503'), report: null }),
    );
    await runRtwCheckSweep(t.d);
    const all = t.lines.join('\n');
    expect(all).toContain('c1');
    for (const secret of ['W123AB4CD', '1996-05-05', 'Marta', 'Villanueva']) {
      expect(all).not.toContain(secret);
    }
    expect(t.recorded[0]).toMatchObject({
      decision: { action: 'retry' },
      error: 'provider_http_503',
    });
  });
});

describe('the job secret', () => {
  const SECRET = 's'.repeat(40);
  it('refuses everything when the secret is unset or too short', () => {
    expect(checkJobSecret(`Bearer ${SECRET}`, undefined)).toBe('not_configured');
    expect(checkJobSecret('Bearer short', 'short')).toBe('not_configured');
  });
  it('accepts exactly the secret, as a bearer token', () => {
    expect(checkJobSecret(`Bearer ${SECRET}`, SECRET)).toBe('ok');
    expect(checkJobSecret(`bearer ${SECRET}`, SECRET)).toBe('ok');
    expect(checkJobSecret(`Bearer ${SECRET}x`, SECRET)).toBe('unauthorised');
    expect(checkJobSecret(SECRET, SECRET)).toBe('unauthorised');
    expect(checkJobSecret(null, SECRET)).toBe('unauthorised');
  });
});

describe('dates', () => {
  it('parses what both services print, and nothing impossible', () => {
    expect(parseUkDate('31 March 2028')).toBe('2028-03-31');
    expect(parseUkDate('1 Sept 2027')).toBe('2027-09-01');
    expect(parseUkDate('31/02/2028')).toBeNull();
    expect(parseUkDate('31 Marchx 2028')).toBeNull();
    expect(parseUkDate(20280331)).toBeNull();
  });
  it('knows the UK day', () => {
    expect(ukToday(new Date('2026-03-29T23:30:00Z'))).toBe('2026-03-30');
  });
});
