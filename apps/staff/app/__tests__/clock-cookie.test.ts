import { describe, expect, it, vi } from 'vitest';
import { TIME_FORMAT_COOKIE } from '@thc/domain';

/**
 * ADR-0085: the clock choice belongs to the person, not the phone. Signing
 * out clears this device's copy so the next login reads its own profile
 * rather than inheriting the last person's clock.
 */
const set = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth: { signOut } }) }));

const { POST } = await import('../auth/signout/route');

describe('POST /auth/signout', () => {
  it('ends the session, clears the clock cookie, and goes to /login', async () => {
    const response = await POST(
      new Request('https://staff.example/auth/signout', { method: 'POST' }),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      TIME_FORMAT_COOKIE,
      '',
      expect.objectContaining({ path: '/', maxAge: 0 }),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });
});
