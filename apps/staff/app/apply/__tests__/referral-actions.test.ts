import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * apply() with `/apply?ref=` (ADR-0040, docs/18 §5).
 *
 *   - the code travels on the service-role path ONLY, as the 8th argument
 *     of submit_application_as_caller (20260930140000);
 *   - the anon `submit_application` never receives one;
 *   - a malformed code is dropped, never an error;
 *   - with or without a code the applicant gets the same answer: the
 *     redirect to "Check your inbox";
 *   - a database that does not yet know the 8th argument costs nobody
 *     their application.
 */
const sessionRpc = vi.hoisted(() => vi.fn());
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
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc: sessionRpc }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));

const { apply } = await import('../actions');
const { INITIAL_STATE } = await import('../form');

function form(ref?: string): FormData {
  const data = new FormData();
  data.set('firstName', 'Nia');
  data.set('lastName', 'Okafor');
  data.set('email', ' Nia@Example.com ');
  data.set('dialCode', '+44');
  data.set('mobile', '07700 900123');
  data.set('dob', '1999-03-03');
  data.set('consent', 'on');
  if (ref !== undefined) data.set('ref', ref);
  return data;
}

async function submit(data: FormData): Promise<string> {
  try {
    const state = await apply(INITIAL_STATE, data);
    return `STATE ${JSON.stringify(state)}`;
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
  sessionRpc.mockResolvedValue({ error: null });
  adminRpc.mockResolvedValue({ error: null });
});
afterEach(() => {
  process.env = { ...saved };
});

describe('apply() — the referral code on the service-role path', () => {
  it('passes a valid code as p_referral_code, normalised', async () => {
    expect(await submit(form(' k7m4q2xp '))).toBe('REDIRECT /apply/submitted');
    expect(adminRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = adminRpc.mock.calls[0]!;
    expect(fn).toBe('submit_application_as_caller');
    expect(args).toMatchObject({ p_email: 'nia@example.com', p_referral_code: 'K7M4Q2XP' });
    expect(sessionRpc).not.toHaveBeenCalled();
  });

  it('sends no p_referral_code at all without a code — the 7-argument call, unchanged', async () => {
    expect(await submit(form())).toBe('REDIRECT /apply/submitted');
    const [, args] = adminRpc.mock.calls[0]!;
    expect(args).not.toHaveProperty('p_referral_code');
  });

  it('drops a malformed code silently: the application still goes, with no code', async () => {
    for (const bad of ['', 'IO01ABCD', 'K7M4Q2X', '<script>', 'K7M4Q2XPZ']) {
      adminRpc.mockClear();
      expect(await submit(form(bad))).toBe('REDIRECT /apply/submitted');
      expect(adminRpc.mock.calls[0]![1]).not.toHaveProperty('p_referral_code');
    }
  });

  it('answers the applicant identically with or without a code', async () => {
    const withCode = await submit(form('K7M4Q2XP'));
    const without = await submit(form());
    expect(withCode).toBe(without);
  });

  it('refuses in the same words with or without a code — the database decides, not the code', async () => {
    adminRpc.mockResolvedValue({
      error: {
        code: '22023',
        message: 'Too many applications from these details. Please try again later.',
      },
    });
    const withCode = await submit(form('K7M4Q2XP'));
    const without = await submit(form());
    expect(withCode).toBe(without);
    expect(withCode).toContain('Too many applications from these details.');
  });

  it('retries without the code when the database does not know the 8th argument yet', async () => {
    adminRpc
      .mockResolvedValueOnce({
        error: { code: 'PGRST202', message: 'Could not find the function' },
      })
      .mockResolvedValueOnce({ error: null });
    expect(await submit(form('K7M4Q2XP'))).toBe('REDIRECT /apply/submitted');
    expect(adminRpc).toHaveBeenCalledTimes(2);
    expect(adminRpc.mock.calls[0]![1]).toHaveProperty('p_referral_code', 'K7M4Q2XP');
    expect(adminRpc.mock.calls[1]![1]).not.toHaveProperty('p_referral_code');
  });

  it('does not retry any other refusal', async () => {
    adminRpc.mockResolvedValue({
      error: { code: '22023', message: 'You must be 18 or over to apply.' },
    });
    await submit(form('K7M4Q2XP'));
    expect(adminRpc).toHaveBeenCalledTimes(1);
  });
});

describe('apply() — the anon path never carries a code', () => {
  it('calls submit_application with its six arguments only', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await submit(form('K7M4Q2XP'))).toBe('REDIRECT /apply/submitted');
    expect(adminRpc).not.toHaveBeenCalled();
    const [fn, args] = sessionRpc.mock.calls[0]!;
    expect(fn).toBe('submit_application');
    expect(Object.keys(args).sort()).toEqual([
      'p_consent',
      'p_dob',
      'p_email',
      'p_first_name',
      'p_last_name',
      'p_phone',
    ]);
  });
});
