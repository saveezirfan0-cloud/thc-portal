import { describe, expect, it, vi } from 'vitest';
import { RTW_NOT_FOUND_REASON, rtwCheckError } from '@thc/domain';
import type { RtwCheckResult, RtwCheckSource } from '@thc/domain';
import { checkJobSecret } from '../auth';
import { parseUkDate, ukToday } from '../checker';
import type { CheckOutput, RightToWorkChecker } from '../checker';
import { reportPath, runOrchestrated, runRtwCheckSweep } from '../sweep';
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
