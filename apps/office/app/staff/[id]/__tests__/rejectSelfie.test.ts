import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reject the profile selfie (ADR-0094). The action goes through the
 * manager's SESSION (the function checks the role and the audit row names
 * auth.uid()), asks for the reason again on the server, and turns the
 * database's refusals into words a manager can act on.
 */

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as { message: string } | null,
}));
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { rejectSelfie } = await import('../actions');

beforeEach(() => {
  rpc.mockClear();
  revalidatePath.mockClear();
  rpc.mockResolvedValue({ error: null });
});

describe('rejectSelfie', () => {
  it('calls office_reject_selfie with the trimmed reason and refreshes both profiles', async () => {
    expect(await rejectSelfie('s1', '  Face not visible  ')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('office_reject_selfie', {
      p_staff: 's1',
      p_reason: 'Face not visible',
    });
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining(['/staff/s1', '/staff', '/onboarding', '/onboarding/s1']),
    );
  });

  it('asks for a reason before it asks the database', async () => {
    expect(await rejectSelfie('s1', '   ')).toEqual({
      ok: false,
      message: 'A reason is required — the worker reads it.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('holds the reason to 300 characters, as the database does', async () => {
    expect(await rejectSelfie('s1', 'x'.repeat(301))).toEqual({
      ok: false,
      message: 'Keep the reason to 300 characters.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['no_photo', 'no profile selfie to reject'],
    ['not_active', 'has left, been rejected or been removed'],
    ['not_authorised', 'Only the office can do this.'],
    ['read_only', 'read-only'],
    ['staff_not_found', 'could not be found'],
  ])('explains %s', async (code, words) => {
    rpc.mockResolvedValueOnce({ error: { message: code } });
    const result = await rejectSelfie('s1', 'Not clear');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(words);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
