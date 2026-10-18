import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * A2's Resend posts the same action as A1. Over the hour's three links the
 * action returns RESET_LIMIT_REACHED (ADR-0157): it shows above the button,
 * and the button stays under its cooldown rather than inviting a press.
 */
vi.mock('../actions', () => ({ requestReset: vi.fn() }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const { RESET_LIMIT_REACHED } = await import('../copy');
  return { ...actual, useActionState: () => [RESET_LIMIT_REACHED, vi.fn(), false] };
});

const { ResendButton } = await import('../sent/ResendButton');
const { RESET_LIMIT_REACHED } = await import('../copy');

describe('Resend after the limit', () => {
  it('shows the wait-an-hour message and keeps the button disabled', () => {
    const html = renderToStaticMarkup(<ResendButton to="amara.k@example.com" />);
    expect(html).toContain(RESET_LIMIT_REACHED);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('Resend in 1:00');
  });
});
