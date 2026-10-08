import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0104 · loading and clearing the invite list.
 *
 *   · the pasted sheet is parsed on the server and the ROWS go to
 *     load_invite_roster() through the manager's own session;
 *   · a sheet with no Group column is never sent;
 *   · refusals are sentences, not codes;
 *   · remove_invite_roster_entries() takes ids, or null for all.
 */
const rpc = vi.hoisted(() =>
  vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as { message: string } | null,
  })),
);

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { loadRoster, removeRosterEntries, REASON_TEXT } = await import('../actions');

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { loaded: 2, updated: 1, held: [], skipped: [] }, error: null });
});

const SHEET =
  'Email,First name,Last name,Payroll ID,Group\nsam@x.co,Sam,Spud,1641A,spud\nnia@x.co,Nia,Norm,1500,thc';

describe('loadRoster', () => {
  it('sends the parsed rows and hands the report back', async () => {
    const result = await loadRoster(SHEET);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('load_invite_roster');
    expect(args['p_rows']).toEqual([
      {
        email: 'sam@x.co',
        first_name: 'Sam',
        last_name: 'Spud',
        payroll_id: '1641A',
        group: 'spud',
      },
      { email: 'nia@x.co', first_name: 'Nia', last_name: 'Norm', payroll_id: '1500', group: 'thc' },
    ]);
    expect(result).toEqual({ ok: true, report: { loaded: 2, updated: 1, held: [], skipped: [] } });
  });

  it('never sends a sheet with no Group column', async () => {
    const result = await loadRoster('Email,Payroll ID\nsam@x.co,1');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never sends a header with nobody under it', async () => {
    const result = await loadRoster('Email,Group');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('names a refusal in a sentence, never the code', async () => {
    for (const code of ['read_only', 'not_authorised', 'too_many_rows']) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: code } });
      const result = await loadRoster(SHEET);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).not.toBe(code);
    }
  });

  it('keeps the reason on every row the database did not take', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        loaded: 1,
        updated: 0,
        held: [{ email: 'busy@x.co', reason: 'has_upcoming_shifts' }],
        skipped: [{ email: 'bad', reason: 'bad_email' }],
      },
      error: null,
    });
    const result = await loadRoster(SHEET);
    expect(result.ok && result.report.held[0]?.reason).toBe('has_upcoming_shifts');
    expect(result.ok && result.report.skipped[0]?.reason).toBe('bad_email');
  });

  it('has a sentence for every reason the database gives', () => {
    for (const reason of [
      'bad_email',
      'group_unknown',
      'bad_payroll_id',
      'duplicate_email_in_file',
      'duplicate_payroll_id_in_file',
      'payroll_id_taken',
      'has_upcoming_shifts',
      'already_marked_spudbros',
    ]) {
      expect(REASON_TEXT[reason], reason).toBeTruthy();
    }
  });
});

describe('removeRosterEntries', () => {
  it('removes the ids given', async () => {
    rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect(await removeRosterEntries(['a', 'b'])).toEqual({ ok: true, removed: 2 });
    expect(rpc).toHaveBeenCalledWith('remove_invite_roster_entries', { p_ids: ['a', 'b'] });
  });

  it('null removes every one waiting', async () => {
    rpc.mockResolvedValueOnce({ data: 5, error: null });
    expect(await removeRosterEntries(null)).toEqual({ ok: true, removed: 5 });
    expect(rpc).toHaveBeenCalledWith('remove_invite_roster_entries', { p_ids: null });
  });

  it('a viewer is told, in words', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'read_only' } });
    const result = await removeRosterEntries(null);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/read-only/);
  });
});
