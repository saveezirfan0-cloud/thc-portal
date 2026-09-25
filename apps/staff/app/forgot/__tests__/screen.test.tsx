import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * A1 Forgot password and A2 Reset link sent against
 * wireframes/staff/auth.html (§10.2): A1's "‹ Back to sign in" at the top,
 * not under the small print; A2's two controls — "Open mail app" (outline,
 * block) and a throttled "Didn't get it? Resend in 0:NN" (ghost, block) — and
 * nothing the wireframe does not draw. The server action is stubbed.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ requestReset: vi.fn() }));

const state = vi.hoisted(() => ({
  cookie: 'amara.k@example.com' as string | undefined,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'thc_reset_sent_to' && state.cookie ? { value: state.cookie } : undefined,
  }),
  headers: async () => new Headers({ 'user-agent': state.userAgent }),
}));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect(${to})`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { default: ForgotPage } = await import('../page');
const { default: SentPage } = await import('../sent/page');

describe('A1 Forgot password (wireframes/staff/auth.html)', () => {
  const markup = renderToStaticMarkup(<ForgotPage />);

  it('puts "‹ Back to sign in" first, above the copy — not under the small print', () => {
    const back = markup.indexOf('‹ Back to sign in');
    const copy = markup.indexOf('Enter the email you signed up with');
    const smallPrint = markup.indexOf('The email comes from');
    expect(back).toBeGreaterThan(-1);
    expect(back).toBeLessThan(copy);
    expect(copy).toBeLessThan(smallPrint);
    expect(markup).toMatch(/<a href="\/login" class="sm" style="[^"]*min-height:var\(--tap-min\)/);
  });

  it('says the link is valid for the project OTP expiry, and names the §9.12 sender', () => {
    expect(markup).toContain(
      'Enter the email you signed up with and we’ll send a link to set a new one. The link is valid for 24 hours.',
    );
    expect(markup).toContain(
      'The email comes from admin@thehospitalitycompany.co.uk. If you don’t see it, check spam — or contact the office.',
    );
    expect(markup).not.toContain('60 minutes');
  });
});

describe('A2 Reset link sent (wireframes/staff/auth.html)', () => {
  it('prints the address from the cookie, in bold cyan, with the same "If … is registered" copy', async () => {
    const markup = renderToStaticMarkup(await SentPage());
    expect(markup).toContain(
      'If <b class="cyan">amara.k@example.com</b> is registered, we’ve sent a link to set a new password. It expires in 24 hours.',
    );
    expect(markup).not.toContain('60 minutes');
  });

  it('has exactly the wireframe’s two controls: Open mail app, then the throttled Resend', async () => {
    const markup = renderToStaticMarkup(await SentPage());
    const open = markup.indexOf('Open mail app');
    const resend = markup.indexOf('Didn’t get it? Resend in 1:00');
    expect(open).toBeGreaterThan(-1);
    expect(resend).toBeGreaterThan(open);
    expect(markup).toMatch(/<a class="btn outline block" href="message:\/\/">Open mail app<\/a>/);
    expect(markup).toMatch(
      /<button type="submit" class="btn ghost block" disabled="" aria-live="polite">Didn’t get it\? Resend in 1:00<\/button>/,
    );
    // The resend posts the same address through the same action — no retyping,
    // and still no address in a URL.
    expect(markup).toContain('<input type="hidden" name="email" value="amara.k@example.com"/>');
    expect(markup).not.toContain('/forgot/sent?');
    expect(markup).not.toContain('?to=');
  });

  it('draws nothing the wireframe does not: no sign-in link, no "send it again" link, no sender line', async () => {
    const markup = renderToStaticMarkup(await SentPage());
    expect(markup).not.toContain('Back to sign in');
    expect(markup).not.toContain('Send it again');
    expect(markup).not.toContain('href="/forgot"');
    expect(markup).not.toContain('Open the link on this phone');
    expect(markup).not.toContain('The email comes from');
  });

  it('leaves "Open mail app" out where there is no mail app to open (desktop)', async () => {
    const was = state.userAgent;
    state.userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0';
    try {
      const markup = renderToStaticMarkup(await SentPage());
      expect(markup).not.toContain('Open mail app');
      expect(markup).toContain('Didn’t get it? Resend in 1:00');
    } finally {
      state.userAgent = was;
    }
  });

  it('goes back to A1 when there is no cookie to show — never "that address"', async () => {
    state.cookie = undefined;
    try {
      await expect(SentPage()).rejects.toMatchObject({ to: '/forgot' });
    } finally {
      state.cookie = 'amara.k@example.com';
    }
  });

  it('does not use a literal colour, radius or font', async () => {
    const markup = renderToStaticMarkup(await SentPage());
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(|border-radius|font-family/);
  });
});
