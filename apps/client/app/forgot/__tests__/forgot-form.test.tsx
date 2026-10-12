import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/** A1's form (wireframes/client/login.html, "Forgot password (A1)"). */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ requestReset: vi.fn() }));

const { ForgotForm } = await import('../ForgotForm');

describe('the forgot-password form', () => {
  const markup = renderToStaticMarkup(<ForgotForm />);

  it('lays out with the shared auth-form class, no inline styles', () => {
    expect(markup).toMatch(/^<form[^>]*class="auth-form"/);
    expect(markup).not.toContain('style=');
  });

  it('marks "Back to sign in" as an auth link, the 44px finger target on a phone', () => {
    expect(markup).toContain('<a href="/login" class="xs auth-link">← Back to sign in</a>');
  });
});
