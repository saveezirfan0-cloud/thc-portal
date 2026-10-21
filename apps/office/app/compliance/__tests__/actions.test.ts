import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The review actions /compliance and the /staff/:id Documents tab share
 * (§4.1). Who may review is the database's answer, not this file's: every
 * call goes through the MANAGER'S OWN SESSION — never the service key — so
 * compliance_verify_document() / compliance_reject_document() can refuse a
 * caller who is not an admin (assert_reviewer → `not_authorised`), and the
 * reviewer's identity is the audit stamp (§1.8).
 */
const rpc = vi.fn();
const createClient = vi.fn(() => ({ rpc }));
const createAdminClient = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { rejectDocument, verifyDocument } = await import('../actions');

beforeEach(() => {
  rpc.mockReset();
  createClient.mockClear();
});

describe('verifyDocument', () => {
  it('calls the one Verify RPC on the session client, with the confirmed date', async () => {
    rpc.mockResolvedValue({ data: { status: 'compliant' }, error: null });
    const result = await verifyDocument('d2', { expiry: '2027-06-30' });
    expect(result.ok).toBe(true);
    expect(createClient).toHaveBeenCalledOnce();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_verify_document', {
      p_doc: 'd2',
      p_expiry: '2027-06-30',
    });
  });

  it('passes the share code’s right-to-work-until under its own name', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await verifyDocument('d4', { rightToWorkUntil: 'infinity' });
    expect(rpc).toHaveBeenCalledWith('compliance_verify_document', {
      p_doc: 'd4',
      p_right_to_work_until: 'infinity',
    });
  });

  it('a caller who is not an admin is refused by the database, in words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_authorised' } });
    expect(await verifyDocument('d1')).toEqual({
      ok: false,
      message: 'Only the office can review documents.',
    });
  });

  it('reports the §4.3 re-check’s unblock', async () => {
    rpc.mockResolvedValue({ data: { unblocked: true }, error: null });
    const result = await verifyDocument('d1');
    expect(result).toEqual({ ok: true, message: 'Verified. Everything is in order — unblocked.' });
  });
});

describe('verifyDocument on a term letter (ADR-0178)', () => {
  it('sends the confirmed holiday periods as p_term_dates, half-open, from/to only', async () => {
    rpc.mockResolvedValue({ data: { status: 'compliant' }, error: null });
    const result = await verifyDocument('d3', {
      termDates: [
        { from: '2026-08-16', to: '2027-01-17' },
        { from: '2027-06-12', to: '2027-09-26' },
      ],
      noHolidays: false,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_verify_document', {
      p_doc: 'd3',
      p_term_dates: ['[2026-08-16,2027-01-18)', '[2027-06-12,2027-09-27)'],
    });
    expect(result).toEqual({
      ok: true,
      message:
        'Verified. 2 holiday periods confirmed: 48 hours a week in them, the term-time limit outside them.',
    });
  });

  it('sends an empty list when the reviewer ticked that the letter shows no holidays', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const result = await verifyDocument('d3', { termDates: [], noHolidays: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_verify_document', {
      p_doc: 'd3',
      p_term_dates: [],
    });
    expect(result.ok && result.message).toBe(
      'Verified. No holidays on the letter: 20 hours a week (10 below degree level) all year.',
    );
  });

  it('refuses no periods without the tick, and an incomplete or backwards one, before the database', async () => {
    expect(await verifyDocument('d3', { termDates: [] })).toEqual({
      ok: false,
      message: 'Tick to confirm the letter shows no holidays, or add the periods it shows.',
    });
    expect(await verifyDocument('d3', { termDates: [{ from: '2026-08-16', to: '' }] })).toEqual({
      ok: false,
      message: 'Period 1 needs both dates.',
    });
    expect(
      await verifyDocument('d3', { termDates: [{ from: '2027-01-17', to: '2026-08-16' }] }),
    ).toEqual({ ok: false, message: 'Period 1 ends before it starts.' });
    expect(
      await verifyDocument('d3', { termDates: [{ from: '2026-08-16', to: '2072-01-17' }] }),
    ).toEqual({
      ok: false,
      message: 'Period 1 runs for more than a year — check the year of each date.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('puts the database’s refusals of a period in words', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'range lower bound must be less than or equal to range upper bound' },
    });
    expect(
      await verifyDocument('d3', { termDates: [{ from: '2026-08-16', to: '2027-01-17' }] }),
    ).toEqual({ ok: false, message: 'A holiday period ends before it starts — check its dates.' });
    rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'term_dates_implausible: a holiday period on this letter runs for more than a year',
      },
    });
    expect(
      await verifyDocument('d3', { termDates: [{ from: '2026-08-16', to: '2027-01-17' }] }),
    ).toEqual({
      ok: false,
      message: 'A holiday period cannot run for more than a year — check the year of each date.',
    });
  });

  it('leaves p_term_dates out for any other document', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await verifyDocument('d1');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_verify_document', { p_doc: 'd1' });
  });
});

describe('rejectDocument', () => {
  it('refuses an empty reason before reaching the database', async () => {
    const result = await rejectDocument('d1', '   ');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason to the one Reject RPC (N8 fires there)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await rejectDocument('d1', '  Photo page is cut off ');
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_reject_document', {
      p_doc: 'd1',
      p_reason: 'Photo page is cut off',
    });
  });

  it('a caller who is not an admin is refused', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_authorised' } });
    expect(await rejectDocument('d1', 'blurred')).toEqual({
      ok: false,
      message: 'Only the office can review documents.',
    });
  });
});
