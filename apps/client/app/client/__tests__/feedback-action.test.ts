import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * leaveFeedback (§11.2, §11.5; 20261012120000): the comment is capped at
 * 2000 characters here as well as in the database, and every refusal the
 * RPC can give reaches the customer as a fixed sentence — never the
 * database's own text, which names § sections and Postgres detail.
 */
const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  error: null as null | { code?: string; message: string },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      state.calls.push({ fn, args });
      return { data: state.error ? null : 'id', error: state.error };
    },
  }),
}));

const { leaveFeedback } = await import('../events/[id]/actions');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  state.calls = [];
  state.error = null;
});

describe('leaveFeedback', () => {
  it('refuses a comment over 2000 characters without calling the database', async () => {
    const out = await leaveFeedback('e1', 'b1', 4, 'x'.repeat(2001));
    expect(out).toEqual({ ok: false, error: 'Keep your comment to 2000 characters or fewer.' });
    expect(state.calls).toEqual([]);
  });

  it('counts characters as the database does (an emoji is one)', async () => {
    const out = await leaveFeedback('e1', 'b1', 4, '👍'.repeat(2000));
    expect(out).toEqual({ ok: true });
  });

  it('sends the trimmed comment, or null for none', async () => {
    await leaveFeedback('e1', 'b1', 4, '  Polite and early  ');
    await leaveFeedback('e1', 'b1', 4, '   ');
    expect(state.calls).toEqual([
      {
        fn: 'submit_client_feedback',
        args: { p_booking_id: 'b1', p_rating: 4, p_text: 'Polite and early' },
      },
      { fn: 'submit_client_feedback', args: { p_booking_id: 'b1', p_rating: 4, p_text: null } },
    ]);
  });

  it.each([
    [
      {
        code: '22023',
        message: 'This worker has been removed (§1.7); no new feedback can be added',
      },
      'This person is no longer on our books, so feedback can no longer be left for them.',
    ],
    [
      { code: '22023', message: 'Comment must be 2000 characters or fewer' },
      'Keep your comment to 2000 characters or fewer.',
    ],
    [
      { code: '42501', message: 'That booking is not on your line-up' },
      'That booking is not on one of your events.',
    ],
    [
      { code: 'XX000', message: 'could not serialize access due to concurrent update' },
      'That could not be saved.',
    ],
  ])('maps %o to a fixed sentence', async (error, sentence) => {
    state.error = error;
    const out = await leaveFeedback('e1', 'b1', 4, 'Fine');
    expect(out).toEqual({ ok: false, error: sentence });
    expect(JSON.stringify(out)).not.toMatch(/§|serialize|line-up/);
  });

  it('says the portal is not connected without naming the vendor', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const out = await leaveFeedback('e1', 'b1', 4, 'Fine');
    expect(out).toEqual({
      ok: false,
      error: "The portal isn't connected yet. Please contact THC.",
    });
  });
});
