import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PASSWORD_HINT, REMEMBER_LABEL, WRONG_CREDENTIALS } from '../copy';

/**
 * A0 Sign in and its error state against wireframes/backoffice/login.html
 * (§1.4, §10.2): the "Forgot password?" hint under Password, the ticked
 * "Keep me signed in on this device" box, and an error state that marks
 * both fields red with text under the password only — and no empty live
 * region under the email. The server action is stubbed.
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

/** The `<input …>` tag carrying `name="…"`, whatever order React emits its attributes in. */
const inputTag = (markup: string, name: string) =>
  markup.match(new RegExp(`<input [^>]*name="${name}"[^>]*>`))?.[0] ?? '';

describe('A0 Sign in (wireframes/backoffice/login.html:31-42)', () => {
  const markup = renderToStaticMarkup(<LoginFields error={null} pending={false} action={noop} />);

  it('says "Back Office" under the name and keeps the footer sentence', async () => {
    const page = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(page).toContain('<div class="sub">Back Office</div>');
    expect(page).toContain('Staff use the mobile app');
  });

  it('puts "Forgot password?" as the hint under the Password field (login.html:38)', () => {
    expect(markup).toMatch(
      /<span class="hint"><a href="\/login\/forgot">Forgot password\?<\/a><\/span>/,
    );
    // Under the password, not the email: the hint follows the password input.
    const password = markup.indexOf(inputTag(markup, 'password'));
    const hint = markup.indexOf('Forgot password?');
    expect(hint).toBeGreaterThan(password);
  });

  it('offers "Keep me signed in on this device", ticked by default (login.html:39)', () => {
    const box = inputTag(markup, 'remember');
    expect(box).toContain('type="checkbox"');
    expect(box).toContain('checked=""');
    expect(markup).toContain(`<span class="box on"`);
    expect(markup).toContain(REMEMBER_LABEL);
    // Between the password and the button, as the wireframe orders them.
    expect(markup.indexOf(REMEMBER_LABEL)).toBeGreaterThan(markup.indexOf('Forgot password?'));
    expect(markup.indexOf(REMEMBER_LABEL)).toBeLessThan(markup.indexOf('>Sign in</button>'));
  });

  it('labels both fields so getByLabel("Password") holds', () => {
    for (const name of ['email', 'password']) {
      const [, id] = inputTag(markup, name).match(/ id="([^"]+)"/) ?? [];
      expect(id).toBeTruthy();
      expect(markup).toContain(`for="${id}"`);
    }
  });

  it('has no error border, no live region and no error text before an attempt', () => {
    expect(inputTag(markup, 'email')).toContain('class="input"');
    expect(inputTag(markup, 'password')).toContain('class="input"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain(PASSWORD_HINT);
  });

  it('carries `next` as a hidden field only when there is one', () => {
    expect(
      renderToStaticMarkup(
        <LoginFields error={null} pending={false} action={noop} next="/reports" />,
      ),
    ).toContain('<input type="hidden" name="next" value="/reports"/>');
    expect(markup).not.toContain('name="next"');
  });

  it('spaces the form with the token, not a pixel literal', () => {
    expect(markup).toMatch(/<form [^>]*style="[^"]*gap:var\(--sp-16\)/);
    expect(markup).not.toMatch(/gap:16px/);
  });

  it('does not use a literal colour, radius or font', () => {
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(|border-radius|font-family/);
  });
});

describe('A0 · wrong password (login.html:45-56)', () => {
  const markup = renderToStaticMarkup(
    <LoginFields error={WRONG_CREDENTIALS} pending={false} action={noop} />,
  );

  it('is one coral alert with the wireframe sentence', () => {
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).toContain(`<div class="alert coral" role="status">${WRONG_CREDENTIALS}</div>`);
  });

  it('marks the email red with NOTHING under it — no empty live region', () => {
    const email = inputTag(markup, 'email');
    expect(email).toContain('aria-invalid="true"');
    expect(email).toContain('class="input err"');
    // The only role="alert" is the password's sentence: one, and it says something.
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/role="alert">\s*<\/span>/);
    // Nothing sits between the email input and the end of its field.
    expect(markup).toMatch(new RegExp(`${email.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}</div>`));
  });

  it('marks the password red with its sentence AND the Forgot hint (login.html:53)', () => {
    const password = inputTag(markup, 'password');
    expect(password).toContain('aria-invalid="true"');
    expect(password).toContain('class="input err"');
    expect(markup).toContain(`<span class="error" role="alert">${PASSWORD_HINT}</span>`);
    expect(markup).toContain(
      '<span class="hint"><a href="/login/forgot">Forgot password?</a></span>',
    );
    expect(markup.indexOf(PASSWORD_HINT)).toBeLessThan(markup.indexOf('Forgot password?'));
  });
});
