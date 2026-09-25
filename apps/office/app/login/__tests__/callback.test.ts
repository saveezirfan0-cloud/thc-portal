import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /login/callback — where the Back Office's emailed reset link lands
 * (§10.2 A3). The code is exchanged for a session, and `next` is honoured
 * only as a path on this origin: an open redirect on the end of an emailed
 * link is a phishing kit signed by THC's own sender (§9.12).
 */
const fakes = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ auth: { exchangeCodeForSession: fakes.exchangeCodeForSession } }),
}));

const { GET } = await import('../callback/route');

const ORIGIN = 'https://office.example.com';
const location = (res: Response) => res.headers.get('location');

beforeEach(() => {
  fakes.exchangeCodeForSession.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /login/callback', () => {
  it('without a code, sends to A3 with error=missing and exchanges nothing', async () => {
    const res = await GET(new Request(`${ORIGIN}/login/callback`));
    expect(location(res)).toBe(`${ORIGIN}/login/reset?error=missing`);
    expect(fakes.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('a spent code sends to A3 with error=expired', async () => {
    fakes.exchangeCodeForSession.mockResolvedValue({ error: { status: 400, message: 'used' } });
    const res = await GET(new Request(`${ORIGIN}/login/callback?code=abc`));
    expect(fakes.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(location(res)).toBe(`${ORIGIN}/login/reset?error=expired`);
  });

  it('a good code lands on A3 by default', async () => {
    fakes.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(new Request(`${ORIGIN}/login/callback?code=abc`));
    expect(location(res)).toBe(`${ORIGIN}/login/reset`);
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', '/%5Cevil.com'])(
    'never follows next=%s off this origin',
    async (next) => {
      fakes.exchangeCodeForSession.mockResolvedValue({ error: null });
      const res = await GET(
        new Request(`${ORIGIN}/login/callback?code=abc&next=${encodeURIComponent(next)}`),
      );
      expect(new URL(location(res)!).origin).toBe(ORIGIN);
      expect(location(res)).toBe(`${ORIGIN}/login/reset`);
    },
  );

  it('follows a path on this origin', async () => {
    fakes.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(
      new Request(
        `${ORIGIN}/login/callback?code=abc&next=${encodeURIComponent('/login/reset?x=1')}`,
      ),
    );
    expect(location(res)).toBe(`${ORIGIN}/login/reset?x=1`);
  });
});
