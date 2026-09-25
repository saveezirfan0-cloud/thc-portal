import { describe, expect, it, vi } from 'vitest';
import { ExtractionError, type PageReading } from '../_lib/extract';
import { checkPaths, runOnce, type ClaimedCheck, type RunDeps } from '../_lib/run';

const claimed: ClaimedCheck = {
  checkId: 'c1',
  staffId: 's1',
  documentId: 'd1',
  shareCode: 'W123AB4CD',
  dob: '1995-01-07',
  firstName: 'Maria',
  lastName: 'Garcia',
  branch: 'work_visa',
  attempt: 1,
};

const result: PageReading = {
  pageKind: 'result',
  found: true,
  hasRightToWork: true,
  holderName: 'MARIA GARCIA',
  rightToWorkUntil: '2028-03-31',
  noTimeLimit: false,
  permissionType: 'Skilled Worker visa',
  conditions: 'They can work in the UK.',
  termTimeWeeklyHours: null,
};

function deps(overrides: Partial<RunDeps> = {}): RunDeps & {
  calls: string[];
  record: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  checkGovUk: ReturnType<typeof vi.fn>;
  readPage: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const base = {
    calls,
    claim: vi.fn(async () => {
      calls.push('claim');
      return claimed;
    }),
    belowDegreeLevel: vi.fn(async () => false),
    checkGovUk: vi.fn(async () => {
      calls.push('govuk');
      return { pdf: Buffer.from('%PDF'), photo: Buffer.from('png') };
    }),
    readPage: vi.fn(async () => {
      calls.push('claude');
      return result;
    }),
    upload: vi.fn(async (path: string) => {
      calls.push(`upload:${path}`);
    }),
    record: vi.fn(async () => {
      calls.push('record');
    }),
    fail: vi.fn(async () => {
      calls.push('fail');
    }),
    companyName: 'The Hospitality Company Ltd',
    today: () => '2026-09-28',
    budgetMs: 5_000,
  };
  return Object.assign(base, overrides) as never;
}

describe('runOnce — one gov.uk check (ADR-0025)', () => {
  it('does nothing when nothing is due', async () => {
    const d = deps({ claim: vi.fn(async () => null) });
    expect(await runOnce(d)).toEqual({ ran: false });
    expect(d.checkGovUk).not.toHaveBeenCalled();
  });

  it('runs gov.uk, then Claude, uploads the files, THEN records', async () => {
    const d = deps();
    expect(await runOnce(d)).toEqual({ ran: true, checkId: 'c1', outcome: 'pass' });
    const paths = checkPaths('s1', 'c1');
    expect(d.calls).toEqual([
      'claim',
      'govuk',
      'claude',
      `upload:${paths.report}`,
      `upload:${paths.photo}`,
      'record',
    ]);
  });

  it('fills the form with the share code, DOB and the company name — and nothing else leaves', async () => {
    const d = deps();
    await runOnce(d);
    expect(d.checkGovUk).toHaveBeenCalledWith({
      shareCode: 'W123AB4CD',
      dob: '1995-01-07',
      companyName: 'The Hospitality Company Ltd',
    });
    expect(d.readPage).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });

  it('records the result without the share code or the date of birth', async () => {
    const d = deps();
    await runOnce(d);
    const args = d.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      checkId: 'c1',
      outcome: 'pass',
      holderName: 'MARIA GARCIA',
      until: '2028-03-31',
      conditions: 'They can work in the UK.',
      reportPath: checkPaths('s1', 'c1').report,
      photoPath: checkPaths('s1', 'c1').photo,
    });
    const text = JSON.stringify(args);
    expect(text).not.toContain('W123AB4CD');
    expect(text).not.toContain('1995-01-07');
  });

  it('a name that does not match is recorded for review, not passed', async () => {
    const d = deps({ readPage: vi.fn(async () => ({ ...result, holderName: 'JOHN SMITH' })) });
    expect(await runOnce(d)).toMatchObject({ outcome: 'name_mismatch' });
  });

  it('"not found" is a result, recorded as such, with no date', async () => {
    const d = deps({
      readPage: vi.fn(async () => ({
        ...result,
        pageKind: 'not_found' as const,
        found: false,
        rightToWorkUntil: null,
      })),
    });
    expect(await runOnce(d)).toMatchObject({ outcome: 'not_found' });
    expect(d.record.mock.calls[0]![0]).toMatchObject({ outcome: 'not_found', until: null });
    expect(d.fail).not.toHaveBeenCalled();
  });

  it('a page that is not an answer (the form again, an outage) is a retryable failure', async () => {
    const d = deps({
      readPage: vi.fn(async () => ({ ...result, pageKind: 'form_error' as const })),
    });
    expect(await runOnce(d)).toEqual({ ran: true, checkId: 'c1', failed: true, retryable: true });
    expect(d.record).not.toHaveBeenCalled();
  });

  it('a gov.uk error is retried, and its message is redacted of the share code and DOB', async () => {
    const d = deps({
      checkGovUk: vi.fn(async () => {
        throw new Error('locator.fill("W12 3AB 4CD") failed near 7 January 1995');
      }),
    });
    expect(await runOnce(d)).toMatchObject({ failed: true, retryable: true });
    const [checkId, message, retryable] = d.fail.mock.calls[0]!;
    expect(checkId).toBe('c1');
    expect(retryable).toBe(true);
    expect(message).not.toMatch(/W12\s*3AB\s*4CD/i);
    expect(message).not.toContain('1995');
    expect(message).toContain('[share code]');
  });

  it('a Claude key problem is not retried: it will not fix itself', async () => {
    const d = deps({
      readPage: vi.fn(async () => {
        throw new ExtractionError('Claude refused the API key (401)', false);
      }),
    });
    expect(await runOnce(d)).toMatchObject({ failed: true, retryable: false });
  });

  it('a check that outlives its budget fails as a timeout and is retried', async () => {
    const d = deps({
      budgetMs: 20,
      checkGovUk: vi.fn(() => new Promise<never>(() => undefined)),
    });
    expect(await runOnce(d)).toMatchObject({ failed: true, retryable: true });
    expect(d.fail.mock.calls[0]![1]).toMatch(/longer than/);
  });

  it('a result without a photo records no photo path', async () => {
    const d = deps({ checkGovUk: vi.fn(async () => ({ pdf: Buffer.from('%PDF'), photo: null })) });
    await runOnce(d);
    expect(d.record.mock.calls[0]![0]).toMatchObject({ photoPath: null });
    expect(d.upload).toHaveBeenCalledTimes(1);
  });

  it('a storage failure before recording is a retryable failure, so no row points at a missing file', async () => {
    const d = deps({
      upload: vi.fn(async () => {
        throw new Error('storage upload failed');
      }),
    });
    expect(await runOnce(d)).toMatchObject({ failed: true, retryable: true });
    expect(d.record).not.toHaveBeenCalled();
  });
});
