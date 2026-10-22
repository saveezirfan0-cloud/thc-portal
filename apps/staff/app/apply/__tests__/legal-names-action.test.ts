import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * apply() and the name as printed on the passport (ADR-0189).
 *
 *   - the server action is the second gate: a form edited to send "M." as the
 *     surname never reaches the database;
 *   - the first and middle names go to submit_application_as_caller as the one
 *     `p_first_name` they are stored in, whitespace tidied and nothing else
 *     changed;
 *   - a refusal names the field and keeps what the person typed.
 */
const adminRpc = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
);

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));

const { apply } = await import('../actions');
const { INITIAL_STATE } = await import('../form');

function form(names: { first?: string; middle?: string; last?: string }): FormData {
  const data = new FormData();
  data.set('firstName', names.first ?? 'Marc');
  if (names.middle !== undefined) data.set('middleName', names.middle);
  data.set('lastName', names.last ?? 'Martinez');
  data.set('email', 'marc@example.com');
  data.set('dialCode', '+44');
  data.set('mobile', '07700 900123');
  data.set('dob', '1999-03-03');
  data.set('consent', 'on');
  return data;
}

const saved = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  adminRpc.mockResolvedValue({ error: null });
});
afterEach(() => {
  process.env = { ...saved };
});

describe('apply() — names in full', () => {
  it('refuses an initial for a surname without calling the database', async () => {
    const state = await apply(INITIAL_STATE, form({ last: 'M.' }));
    expect(state.errors.lastName).toMatch(/in full, as it appears on your passport/);
    expect(Object.keys(state.errors)).toEqual(['lastName']);
    expect(state.values.lastName).toBe('M.');
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('refuses an initial for a first or middle name too', async () => {
    const first = await apply(INITIAL_STATE, form({ first: 'J' }));
    expect(first.errors.firstName).toMatch(/not an initial/);
    const middle = await apply(INITIAL_STATE, form({ middle: 'J.' }));
    expect(middle.errors.middleName).toMatch(/not initials/);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('sends first and middle names as the one given-names value', async () => {
    await expect(
      apply(INITIAL_STATE, form({ first: ' Marc ', middle: '  Antoni  Joan', last: ' Martinez ' })),
    ).rejects.toThrow('REDIRECT /apply/submitted');
    const [, args] = adminRpc.mock.calls[0]!;
    expect(args).toMatchObject({ p_first_name: 'Marc Antoni Joan', p_last_name: 'Martinez' });
  });

  it('sends just the first name when there is no middle name, and when the field is absent', async () => {
    await expect(apply(INITIAL_STATE, form({ middle: '' }))).rejects.toThrow('REDIRECT');
    await expect(apply(INITIAL_STATE, form({}))).rejects.toThrow('REDIRECT');
    for (const [, args] of adminRpc.mock.calls) {
      expect(args).toMatchObject({ p_first_name: 'Marc' });
    }
  });

  it('shows the applicant the database’s own words if it refuses a name the form let through', async () => {
    adminRpc.mockResolvedValueOnce({
      error: {
        code: '22023',
        message: 'Enter your surname in full, as it appears on your passport.',
      },
    });
    const state = await apply(INITIAL_STATE, form({}));
    expect(state.failure).toBe('Enter your surname in full, as it appears on your passport.');
  });
});
