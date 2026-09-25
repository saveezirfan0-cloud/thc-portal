import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server loader for the worker's gov.uk check line (ADR-0025): the
 * domain's words for every status, and silence on every failure.
 */

const rpc = vi.fn();
const configured = vi.fn(() => true);

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('../../db', () => ({
  staffDb: () => ({ rpc }),
  supabaseConfigured: () => configured(),
}));

const { loadRtwCheckLine, toRtwCheckLine } = await import('../rtwCheckLine');

const AT = '2026-09-23T10:05:00+00:00';

describe('toRtwCheckLine — rtwCheckWorkerLine()’s words, per status', () => {
  it.each([
    [{ status: 'queued', outcome: null, checkedAt: null }, 'Checking with gov.uk…'],
    [{ status: 'running', outcome: null, checkedAt: null }, 'Checking with gov.uk…'],
    [
      { status: 'done', outcome: 'pass', checkedAt: AT },
      'Checked with gov.uk — the office is confirming it.',
    ],
    [
      { status: 'done', outcome: 'name_mismatch', checkedAt: AT },
      'Checked with gov.uk — the office is reviewing the result.',
    ],
    [
      { status: 'done', outcome: 'conditions_mismatch', checkedAt: AT },
      'Checked with gov.uk — the office is reviewing the result.',
    ],
    [
      { status: 'done', outcome: 'not_found', checkedAt: AT },
      'Checked with gov.uk — the office is reviewing the result.',
    ],
    [
      { status: 'done', outcome: 'no_right_to_work', checkedAt: AT },
      'Checked with gov.uk — the office is reviewing the result.',
    ],
    [
      { status: 'failed', outcome: null, checkedAt: AT },
      'We couldn’t check with gov.uk automatically — the office will check it by hand.',
    ],
  ] as const)('%o', (check, line) => {
    expect(toRtwCheckLine(check)).toEqual({ line, checkedAt: check.checkedAt });
  });

  it('a cancelled check, or none, says nothing', () => {
    expect(toRtwCheckLine({ status: 'cancelled', outcome: null, checkedAt: null })).toBeNull();
    expect(toRtwCheckLine(null)).toBeNull();
  });
});

describe('loadRtwCheckLine', () => {
  beforeEach(() => {
    rpc.mockReset();
    configured.mockReturnValue(true);
  });

  it('calls my_rtw_check() and words the answer', async () => {
    rpc.mockResolvedValue({
      data: { status: 'queued', outcome: null, checkedAt: null },
      error: null,
    });
    await expect(loadRtwCheckLine()).resolves.toEqual({
      line: 'Checking with gov.uk…',
      checkedAt: null,
    });
    expect(rpc).toHaveBeenCalledWith('my_rtw_check');
  });

  it('no check yet (the job is off) is null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(loadRtwCheckLine()).resolves.toBeNull();
  });

  it('degrades silently: not configured, an RPC error, or a throw', async () => {
    configured.mockReturnValue(false);
    await expect(loadRtwCheckLine()).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();

    configured.mockReturnValue(true);
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function my_rtw_check() does not exist' },
    });
    await expect(loadRtwCheckLine()).resolves.toBeNull();

    rpc.mockRejectedValue(new Error('fetch failed'));
    await expect(loadRtwCheckLine()).resolves.toBeNull();
  });
});
