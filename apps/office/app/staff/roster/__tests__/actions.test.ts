import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0107 · loading and clearing the invite list.
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

const { loadRoster, removeRosterEntries } = await import('../actions');
const { REASON_TEXT } = await import('../reasons');

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
      'name_mismatch',
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

describe('linkRosterEntry (ADR-0123)', () => {
  it('links the list row to the staff record through the manager’s session', async () => {
    rpc.mockResolvedValue({
      data: { payrollId: '7153', group: 'thc', spudbros: 'unchanged' },
      error: null,
    });
    const { linkRosterEntry } = await import('../actions');
    const result = await linkRosterEntry('entry-1', 'staff-1');
    expect(rpc).toHaveBeenCalledWith('link_invite_roster_entry', {
      p_entry: 'entry-1',
      p_staff: 'staff-1',
      p_confirm_name: false,
    });
    expect(result).toEqual({ ok: true, payrollId: '7153', spudbros: 'unchanged' });
  });

  it('passes the office’s word that two different names are the same person (ADR-0143)', async () => {
    rpc.mockResolvedValue({ data: { payrollId: '7053', spudbros: 'unchanged' }, error: null });
    const { linkRosterEntry } = await import('../actions');
    await linkRosterEntry('entry-2', 'staff-2', true);
    expect(rpc).toHaveBeenCalledWith('link_invite_roster_entry', {
      p_entry: 'entry-2',
      p_staff: 'staff-2',
      p_confirm_name: true,
    });
  });

  it('turns each refusal into a sentence', async () => {
    const { linkRosterEntry } = await import('../actions');
    for (const code of [
      'name_mismatch',
      'payroll_id_taken',
      'has_other_payroll_id',
      'not_permitted',
      'unknown_entry',
    ]) {
      rpc.mockResolvedValue({ data: null, error: { message: code } });
      const result = await linkRosterEntry('e', 's');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toBe(code);
    }
  });
});

describe('linkRosterEntries (ADR-0144)', () => {
  const items = [
    { entryId: 'e1', staffId: 's1', confirmName: true },
    { entryId: 'e2', staffId: 's2', confirmName: false },
    { entryId: 'e3', staffId: 's3', confirmName: false },
  ];

  it('links each row through the same RPC, one at a time, and a refusal never stops the others', async () => {
    rpc
      .mockResolvedValueOnce({ data: { spudbros: 'unchanged' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'payroll_id_taken' } })
      .mockResolvedValueOnce({ data: { spudbros: 'held_upcoming_shifts' }, error: null });
    const { linkRosterEntries } = await import('../actions');
    const result = await linkRosterEntries(items);
    expect(rpc.mock.calls).toEqual([
      ['link_invite_roster_entry', { p_entry: 'e1', p_staff: 's1', p_confirm_name: true }],
      ['link_invite_roster_entry', { p_entry: 'e2', p_staff: 's2', p_confirm_name: false }],
      ['link_invite_roster_entry', { p_entry: 'e3', p_staff: 's3', p_confirm_name: false }],
    ]);
    expect(result).toEqual({
      ok: true,
      linked: 2,
      heldSpudbros: 1,
      failed: [
        {
          entryId: 'e2',
          message: 'Somebody else already has this Payroll ID. Check who on the Staff page.',
        },
      ],
    });
  });

  it('stops at once when the login itself may not link', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_permitted' } });
    const { linkRosterEntries } = await import('../actions');
    const result = await linkRosterEntries(items);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      message: 'Only an owner or manager can change Payroll IDs.',
    });
  });

  it('sends nothing when nothing is ticked', async () => {
    const { linkRosterEntries } = await import('../actions');
    expect((await linkRosterEntries([])).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('setRemindersEnabled (ADR-0123)', () => {
  it('turns the daily reminder off, and says how many queued ones it stopped', async () => {
    rpc.mockResolvedValue({ data: { enabled: false, cancelled: 412 }, error: null });
    const { setRemindersEnabled } = await import('../actions');
    const result = await setRemindersEnabled(false);
    expect(rpc).toHaveBeenCalledWith('set_invite_roster_reminders', { p_enabled: false });
    expect(result).toEqual({ ok: true, enabled: false, cancelled: 412 });
  });

  it('refuses a read-only login in a sentence', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'read_only' } });
    const { setRemindersEnabled } = await import('../actions');
    const result = await setRemindersEnabled(true);
    expect(result).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
  });
});
