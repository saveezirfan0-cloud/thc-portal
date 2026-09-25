import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEP_SIGNED_IN_COOKIE, KEEP_SIGNED_IN_MAX_AGE } from '@thc/db';

/**
 * "Keep me signed in on this device" on A0 (`wireframes/backoffice/login.html:39`,
 * ADR-0030): a real checkbox, ticked by default; the sign-in obeys it; the
 * middleware's token refresh keeps obeying it; sign-out forgets it.
 */
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  createClientOptions: [] as unknown[],
  refreshWrites: [] as { name: string; value: string; options: Record<string, unknown> }[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...state.jar].map(([name, { value }]) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      state.jar.set(name, { value, options }),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: (_cookies: unknown, options?: unknown) => {
    state.createClientOptions.push(options);
    return {
      auth: {
        signInWithPassword: async () => ({
          data: { user: { app_metadata: { role: 'admin' } } },
          error: null,
        }),
        signOut: async () => ({ error: null }),
      },
    };
  },
}));
// Plays the library during a middleware refresh: it writes a fresh token
// with @supabase/ssr's own 400-day default, through whatever cookie methods
// the middleware handed it.
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: { setAll: (toSet: unknown[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        cookies.setAll(state.refreshWrites);
        return { data: { user: { app_metadata: { role: 'admin' } } } };
      },
    },
  }),
}));

const { LoginForm } = await import('../LoginForm');
const { signIn } = await import('../actions');
const { POST: signOut } = await import('../../auth/signout/route');
const { middleware } = await import('../../../middleware');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  state.jar.clear();
  state.createClientOptions = [];
  state.refreshWrites = [];
});

describe('the control (login.html:39)', () => {
  const markup = renderToStaticMarkup(<LoginForm />);
  const input = markup.match(/<input [^>]*type="checkbox"[^>]*>/)?.[0] ?? '';

  it('is a real checkbox, ticked by default, submitted as keep_signed_in', () => {
    expect(input).not.toBe('');
    expect(input).toContain('name="keep_signed_in"');
    expect(input).toContain('checked=""');
    expect(input).toContain('class="check-input"');
  });

  it('is named by its label and drawn with the design-system square', () => {
    expect(markup).toMatch(
      /<label class="check"><input [^>]*type="checkbox"[^>]*><span class="box on" aria-hidden="true"><\/span><span>Keep me signed in on this device<\/span><\/label>/,
    );
  });

  it('sits between the password and the Sign in button, as drawn', () => {
    const at = (s: string) => markup.indexOf(s);
    expect(at('Keep me signed in')).toBeGreaterThan(at('name="password"'));
    expect(at('Keep me signed in')).toBeLessThan(at('>Sign in</button>'));
  });
});

async function submit(ticked: boolean): Promise<string> {
  const fd = new FormData();
  fd.set('email', 'gisela@thehospitalitycompany.co.uk');
  fd.set('password', 'password123');
  if (ticked) fd.set('keep_signed_in', '1');
  try {
    return `RETURNED:${await signIn(null, fd)}`;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('signIn obeys the box', () => {
  it('ticked: the sign-in writes persistent cookies and remembers it', async () => {
    expect(await submit(true)).toBe('REDIRECT:/dashboard');
    expect(state.createClientOptions).toEqual([{ persistence: 'persistent' }]);
    expect(state.jar.get(KEEP_SIGNED_IN_COOKIE)?.value).toBe('1');
  });

  it('unticked: session cookies, and the preference is a session cookie too', async () => {
    expect(await submit(false)).toBe('REDIRECT:/dashboard');
    expect(state.createClientOptions).toEqual([{ persistence: 'session' }]);
    const pref = state.jar.get(KEEP_SIGNED_IN_COOKIE);
    expect(pref?.value).toBe('0');
    expect(pref?.options).not.toHaveProperty('maxAge');
    expect(pref?.options).toMatchObject({ sameSite: 'lax', secure: true, path: '/' });
  });
});

describe('middleware token refresh keeps the choice', () => {
  const refreshed = {
    name: 'sb-abc-auth-token',
    value: 'base64-fresh',
    options: { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 },
  };

  async function refreshWith(pref: string) {
    state.refreshWrites = [refreshed];
    const request = new NextRequest('http://127.0.0.1:3000/dashboard', {
      headers: { cookie: `${KEEP_SIGNED_IN_COOKIE}=${pref}; sb-abc-auth-token=base64-old` },
    });
    const response = await middleware(request);
    return response.headers.get('set-cookie') ?? '';
  }

  it('unticked: the refreshed cookie is still a session cookie', async () => {
    const header = await refreshWith('0');
    expect(header).toContain('sb-abc-auth-token=base64-fresh');
    expect(header).not.toMatch(/Max-Age|Expires/i);
  });

  it('ticked: the refreshed cookie gets a fresh 30 days', async () => {
    const header = await refreshWith('1');
    expect(header).toContain(`Max-Age=${KEEP_SIGNED_IN_MAX_AGE}`);
  });
});

describe('sign-out', () => {
  it('clears the preference', async () => {
    state.jar.set(KEEP_SIGNED_IN_COOKIE, { value: '1' });
    await signOut(new Request('http://127.0.0.1:3000/auth/signout', { method: 'POST' }));
    const pref = state.jar.get(KEEP_SIGNED_IN_COOKIE);
    expect(pref?.value).toBe('');
    expect(pref?.options).toMatchObject({ maxAge: 0, path: '/' });
  });
});
