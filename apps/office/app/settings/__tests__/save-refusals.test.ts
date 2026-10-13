import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A refused settings write reaches the screen in the office's words, never
 * as the database's raw text, which names policies and columns (security
 * round 12.10). A viewer's refusal keeps the read-only sentence.
 */
const upsert = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    error: null as null | { code?: string; message: string },
  })),
);

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('../db', () => ({ settingsDb: () => ({ from: () => ({ upsert }) }) }));

const { saveWilloReviewUrlTemplate } = await import('../actions');
const { READ_ONLY_MESSAGE } = await import('../../_lib/sessionRole');

const TEMPLATE = 'https://app.willotalent.com/review/{id}';

beforeEach(() => {
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('settings save refusals', () => {
  it('a policy refusal is generic copy, logged on the server', async () => {
    upsert.mockResolvedValueOnce({
      error: {
        code: '42501',
        message: 'new row violates row-level security policy for table "settings"',
      },
    });
    const result = await saveWilloReviewUrlTemplate(TEMPLATE);
    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ message: expect.stringContaining('row-level') });
    expect(console.error).toHaveBeenCalled();
  });

  it('a read-only login is told so', async () => {
    upsert.mockResolvedValueOnce({ error: { code: '42501', message: 'read_only' } });
    expect(await saveWilloReviewUrlTemplate(TEMPLATE)).toEqual({
      ok: false,
      message: READ_ONLY_MESSAGE,
    });
  });
});
