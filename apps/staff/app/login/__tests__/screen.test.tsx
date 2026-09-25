import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * A0 Login and A0 · wrong password against wireframes/staff/auth.html
 * (§10.2): the hero sub-line, the footer sentence with the §9.12 sender,
 * the `show` addon on the password, and an error state that is ONE alert
 * plus a red border on the password only. The server action is stubbed —
 * this is about what the screen says, not the sign-in itself.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ signIn: vi.fn() }));

const { LoginFields } = await import('../LoginForm');
const { default: Page } = await import('../page');

const noop = () => {};
const WRONG = 'Email or password is incorrect. Try again or reset your password.';

/** The `<input …>` tag carrying `name="…"`, whatever order React emits its attributes in. */
const inputTag = (markup: string, name: string) =>
  markup.match(new RegExp(`<input [^>]*name="${name}"[^>]*>`))?.[0] ?? '';

describe('A0 Login (wireframes/staff/auth.html)', () => {
  it('says "Staff app" under the name and the wireframe footer, sender included', async () => {
    const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain('<div class="sub">Staff app</div>');
    expect(markup).toContain(
      'No account yet? Your login is created when the office accepts your interview — look for the activation email from admin@thehospitalitycompany.co.uk.',
    );
    expect(markup).not.toContain('New here?');
  });

  it('gives the password the `show` addon as a real, stateful button', () => {
    const markup = renderToStaticMarkup(<LoginFields error={null} pending={false} action={noop} />);
    expect(markup).toContain('class="input-row"');
    expect(markup).toMatch(
      /<button type="button" class="addon"[^>]*aria-pressed="false"[^>]*>show<\/button>/,
    );
    // The button controls the field it sits beside.
    const password = inputTag(markup, 'password');
    expect(password).toContain('type="password"');
    const [, inputId] = password.match(/ id="([^"]+)"/) ?? [];
    expect(inputId).toBeTruthy();
    expect(markup).toContain(`aria-controls="${inputId}"`);
    // The label still points at the input, so getByLabel('Password') holds.
    expect(markup).toContain(`<label class="label" for="${inputId}">Password</label>`);
    // Not narrower than the tap floor, expressed as the token.
    expect(markup).toMatch(/class="addon"[^>]*min-width:var\(--tap-min\)/);
  });

  it('keeps "Forgot password?" under the button at the tap floor', () => {
    const markup = renderToStaticMarkup(<LoginFields error={null} pending={false} action={noop} />);
    expect(markup).toMatch(
      /<a href="\/forgot" class="sm" style="[^"]*min-height:var\(--tap-min\)[^"]*">Forgot password\?<\/a>/,
    );
  });

  it('carries `next` as a hidden field only when there is one', () => {
    expect(
      renderToStaticMarkup(
        <LoginFields error={null} pending={false} action={noop} next="/shifts" />,
      ),
    ).toContain('<input type="hidden" name="next" value="/shifts"/>');
    expect(
      renderToStaticMarkup(<LoginFields error={null} pending={false} action={noop} />),
    ).not.toContain('name="next"');
  });

  it('does not use a literal colour, radius or font', () => {
    const markup = renderToStaticMarkup(
      <LoginFields error={WRONG} pending={false} action={noop} />,
    );
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(|border-radius|font-family/);
  });
});

describe('A0 · wrong password', () => {
  const markup = renderToStaticMarkup(<LoginFields error={WRONG} pending={false} action={noop} />);

  it('is one coral alert with the wireframe sentence', () => {
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).toContain(`<div class="alert coral" role="status">${WRONG}</div>`);
  });

  it('marks only the password, and prints nothing under it', () => {
    const password = inputTag(markup, 'password');
    expect(password).toContain('aria-invalid="true"');
    expect(password).toContain('class="input err"');
    const email = inputTag(markup, 'email');
    expect(email).toContain('class="input"');
    expect(email).not.toContain('aria-invalid');
    // No second line — and no empty live region for a screen reader to announce.
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('case-sensitive');
  });
});
