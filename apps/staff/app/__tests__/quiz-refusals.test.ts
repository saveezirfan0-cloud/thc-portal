import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0150 · a client's quiz comes before the confirmation. The database
 * answers `quiz_required` with the quiz's id from accept_invite, apply_to_shift
 * and take_offered_shift; the Staff App's refusal dialog turns that into
 * "Pass the quiz first" with a way to the quiz, and keeps every other
 * refusal as it was.
 */
const rpc = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('../db', () => ({
  staffDb: () => ({ rpc }),
  supabaseConfigured: () => true,
}));

const { acceptInvite, applyForShift, takeOfferedShift } = await import('../actions');

const quizRequired = (extra: Record<string, unknown> = { quizId: 'q-1' }) => ({
  data: { ok: false, reason: 'quiz_required', ...extra },
  error: null,
});

beforeEach(() => rpc.mockReset());

describe('quiz_required', () => {
  it.each([
    ['accept', () => acceptInvite('b1'), 'before they can be confirmed on a shift'],
    ['apply', () => applyForShift('s1'), 'before they can apply for or take one of its shifts'],
    ['take', () => takeOfferedShift('o1'), 'before they can apply for or take one of its shifts'],
  ])('%s: says so and takes the worker to the quiz', async (_name, press, words) => {
    rpc.mockResolvedValue(quizRequired());
    const result = await press();
    expect(result).toMatchObject({
      refusal: {
        title: 'Pass the quiz first',
        action: { label: 'Take the quiz', href: '/quiz/q-1' },
      },
    });
    expect('refusal' in result && result.refusal.body).toContain(words);
  });

  it('without a quiz id it is still the same words, with no link to nowhere', async () => {
    rpc.mockResolvedValue(quizRequired({}));
    const result = await acceptInvite('b1');
    expect('refusal' in result && result.refusal.title).toBe('Pass the quiz first');
    expect('refusal' in result && result.refusal.action).toBeUndefined();
  });

  it('another refusal carries no quiz link', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'taken', quizId: 'q-1' }, error: null });
    const result = await acceptInvite('b1');
    expect('refusal' in result && result.refusal.action).toBeUndefined();
  });
});
