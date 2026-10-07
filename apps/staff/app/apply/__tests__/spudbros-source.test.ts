import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * apply() from `/apply/spudbros` (ADR-0103).
 *
 *   - the marker travels as the 9th argument, p_source, and only the value
 *     'spudbros' is ever sent — anything else is the ordinary application;
 *   - an ordinary /apply sends none, so its call is unchanged;
 *   - a database that does not yet know p_source does NOT get the call again
 *     without it, unlike a referral: an unmarked SpudBros applicant would be
 *     open to THC shifts, so the applicant is told to try again;
 *   - with a referral code too, both go.
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
const { INITIAL_STATE, applySourceFrom } = await import('../form');

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set('firstName', 'Nina');
  data.set('lastName', 'Spud');
  data.set('email', 'nina@example.com');
  data.set('dialCode', '+44');
  data.set('mobile', '07700 900123');
  data.set('dob', '1999-03-03');
  data.set('consent', 'on');
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

async function submit(data: FormData): Promise<string> {
  try {
    return `STATE ${JSON.stringify(await apply(INITIAL_STATE, data))}`;
  } catch (e) {
    return (e as Error).message;
  }
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

describe('applySourceFrom', () => {
  it('knows one source, and only by its exact name', () => {
    expect(applySourceFrom('spudbros')).toBe('spudbros');
    for (const other of ['SpudBros', ' spudbros', 'spudbros ', '', 'other', null, undefined, 1]) {
      expect(applySourceFrom(other)).toBeNull();
    }
  });
});

describe('apply() — the SpudBros Express source', () => {
  it('sends p_source = spudbros from /apply/spudbros', async () => {
    expect(await submit(form({ source: 'spudbros' }))).toBe('REDIRECT /apply/submitted');
    expect(adminRpc).toHaveBeenCalledTimes(1);
    expect(adminRpc.mock.calls[0]![1]).toMatchObject({
      p_email: 'nina@example.com',
      p_source: 'spudbros',
    });
  });

  it('sends no p_source from the ordinary /apply', async () => {
    expect(await submit(form())).toBe('REDIRECT /apply/submitted');
    expect(adminRpc.mock.calls[0]![1]).not.toHaveProperty('p_source');
  });

  it('drops an unknown source — the ordinary application', async () => {
    expect(await submit(form({ source: 'admin' }))).toBe('REDIRECT /apply/submitted');
    expect(adminRpc.mock.calls[0]![1]).not.toHaveProperty('p_source');
  });

  it('sends the source and a referral code together', async () => {
    await submit(form({ source: 'spudbros', ref: 'k7m4q2xp' }));
    expect(adminRpc.mock.calls[0]![1]).toMatchObject({
      p_source: 'spudbros',
      p_referral_code: 'K7M4Q2XP',
    });
  });

  it('does not retry without the marker when the database does not know p_source', async () => {
    adminRpc.mockResolvedValue({
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const answer = await submit(form({ source: 'spudbros' }));
    expect(answer).toMatch(/^STATE /);
    expect(adminRpc).toHaveBeenCalledTimes(1);
  });

  it('still retries a referral-only call without the code, as before', async () => {
    adminRpc
      .mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'no such function' } })
      .mockResolvedValueOnce({ error: null });
    expect(await submit(form({ ref: 'K7M4Q2XP' }))).toBe('REDIRECT /apply/submitted');
    expect(adminRpc).toHaveBeenCalledTimes(2);
  });
});
