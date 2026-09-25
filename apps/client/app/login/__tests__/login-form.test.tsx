import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The sign-in card against wireframes/client/login.html:60-66 and :123-126
 * (§1.4): the "Show" reveal on the password, "Keep me signed in on this
 * device" ticked by default, and in the error state ONE generic sentence —
 * both fields red, nothing under the password pointing at it.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ signIn: vi.fn() }));

const { LoginForm } = await import('../LoginForm');
const { REMEMBER_LABEL, WRONG_CREDENTIALS } = await import('../copy');

describe('the client sign-in form (§1.4)', () => {
  const markup = renderToStaticMarkup(<LoginForm />);

  it('welds a "Show" toggle to the password field', () => {
    const row =
      /<div class="input-row"><input type="password" id="([^"]+)" class="input"[^>]*name="password"[^>]*\/><button type="button" class="addon" style="cursor:pointer" aria-pressed="false" aria-controls="([^"]+)">Show<\/button><\/div>/.exec(
        markup,
      );
    expect(row, 'password field with the Show addon').not.toBeNull();
    // The button controls the very field it sits beside.
    expect(row![2]).toBe(row![1]);
  });

  it('offers "Keep me signed in on this device", ticked by default', () => {
    expect(REMEMBER_LABEL).toBe('Keep me signed in on this device');
    expect(markup).toContain(
      `<input type="checkbox" class="check-input" name="keep_signed_in" checked="" value="1"/><span class="box on" aria-hidden="true"></span><span>${REMEMBER_LABEL}</span>`,
    );
  });

  it('keeps Forgot password? and the footer-free Sign in button', () => {
    expect(markup).toContain('href="/forgot"');
    expect(markup).toContain('>Sign in</button>');
  });

  it('never carries a per-field hint that points at the password', () => {
    // The generic sentence is the alert the action returns; the form adds
    // no second message. login.html:123-125 — both inputs `err`, one alert.
    expect(markup).not.toContain('case-sensitive');
    expect(WRONG_CREDENTIALS).toBe(
      'The email or password is incorrect. Check both and try again, or reset your password.',
    );
  });
});
