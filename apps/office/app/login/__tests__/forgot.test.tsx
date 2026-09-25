import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RESET_SENDER } from '../forgot/copy';

/**
 * A1 Forgot password and A2 Reset link sent against
 * wireframes/backoffice/login.html:59-80 (§10.2, §9.12, §1.7). The server
 * action is stubbed; this is what the screens say.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../forgot/actions', () => ({ requestReset: vi.fn() }));

const { ForgotFields } = await import('../forgot/ForgotForm');
const { default: ForgotPage } = await import('../forgot/page');
const { SentBody } = await import('../forgot/sent/SentBody');
const { default: SentPage } = await import('../forgot/sent/page');

const noop = () => {};

describe('A1 Forgot password (login.html:59-69)', () => {
  it('is headed "Reset your password" on the Back Office card', () => {
    const page = renderToStaticMarkup(<ForgotPage />);
    expect(page).toContain('<h2>Reset your password</h2>');
    expect(page).toContain('<div class="sub">Back Office</div>');
  });

  it('names the §9.12 sender and offers the button and the way back', () => {
    const markup = renderToStaticMarkup(
      <ForgotFields error={null} pending={false} action={noop} />,
    );
    expect(markup).toContain('Enter the email you sign in with.');
    expect(markup).toContain(`<span class="mono">${RESET_SENDER}</span>`);
    expect(RESET_SENDER).toBe('admin@thehospitalitycompany.co.uk');
    expect(markup).toContain('>Send reset link</button>');
    expect(markup).toContain('<a href="/login" class="sm">← Back to sign in</a>');
    const email = markup.match(/<input [^>]*name="email"[^>]*>/)?.[0] ?? '';
    expect(email).toContain('type="email"');
    expect(markup).toMatch(/<form [^>]*style="[^"]*gap:var\(--sp-16\)/);
  });
});

describe('A2 Reset link sent (login.html:72-80)', () => {
  const to = 'gisela@thehospitalitycompany.co.uk';
  const markup = renderToStaticMarkup(<SentBody to={to} />);

  it('is a green alert with the wireframe wording and the 60-minute validity', () => {
    expect(markup).toContain('<div class="alert green" role="status">');
    expect(markup).toContain('<b>Check your inbox.</b>');
    expect(markup).toContain(`If an account exists for <span class="mono">${to}</span>`);
    expect(markup).toContain('a reset link is on its way. It is valid for 60 minutes.');
    expect(markup).toContain(`The email comes from <span class="mono">${RESET_SENDER}</span>`);
    expect(markup).toContain('<a href="/login" class="btn block">Back to sign in</a>');
  });

  it('says the same thing whether or not the address exists (§1.7)', () => {
    // The screen has no idea whether the address is registered, so the
    // markup can only ever differ by the address itself.
    const other = renderToStaticMarkup(<SentBody to="nobody@example.com" />);
    expect(other.replace('nobody@example.com', to)).toBe(markup);
    expect(markup).not.toMatch(/no account|not registered|unknown/i);
  });

  it('renders the page with the address from the query', async () => {
    const page = renderToStaticMarkup(await SentPage({ searchParams: Promise.resolve({ to }) }));
    expect(page).toContain('<h2>Reset link sent</h2>');
    expect(page).toContain(`<span class="mono">${to}</span>`);
    const bare = renderToStaticMarkup(await SentPage({ searchParams: Promise.resolve({}) }));
    expect(bare).toContain('If an account exists for that address');
  });
});
