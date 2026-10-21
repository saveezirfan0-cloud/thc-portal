import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * ADR-0180 · the paused onboarding screen when the office sent the
 * declaration back, or rejected it: the update form is the first thing on
 * the screen (where N8 and DR1 land), the declaration row says why, and
 * nothing the office noted for itself is shown.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../actions', () => ({}));
vi.mock('../../documents/declaration-actions', () => ({ updateDeclaration: vi.fn() }));

const { ReviewHub } = await import('../_components/ReviewHub');

const asked = {
  declarationId: 'decl-1',
  source: 'onboarding' as const,
  status: 'details_requested' as const,
  message: 'Please tell us the date of the conviction and the sentence.',
  askedAt: '2026-10-22T09:00:00Z',
  canUpdate: true,
  pausesShifts: false,
};

describe('ReviewHub with a declaration to answer', () => {
  it('puts the update form first, with the office’s message', () => {
    const html = renderToStaticMarkup(
      <ReviewHub
        rows={[]}
        shareDoc={null}
        dob={null}
        declaration={{
          answer: true,
          status: 'details_requested',
          declaredAt: '2026-10-20T09:00:00Z',
        }}
        declarationUpdate={asked}
        today="2026-10-22"
      />,
    );
    expect(html).toContain('One document needs your attention.');
    expect(html).toContain('“Please tell us the date of the conviction and the sentence.”');
    expect(html).toContain('Send updated declaration');
    expect(html).toContain('The office needs more detail — update it above');
    expect(html).toContain('More detail needed');
    expect(html.indexOf('Send updated declaration')).toBeLessThan(
      html.indexOf('Criminal conviction declaration'),
    );
  });

  it('a rejected declaration is answered in full', () => {
    const html = renderToStaticMarkup(
      <ReviewHub
        rows={[]}
        shareDoc={null}
        dob={null}
        declaration={{ answer: true, status: 'rejected', declaredAt: '2026-10-20T09:00:00Z' }}
        declarationUpdate={{ ...asked, status: 'rejected', message: null }}
        today="2026-10-22"
      />,
    );
    expect(html).toContain('The office couldn’t accept your declaration as it was.');
    expect(html).toContain('Not accepted as it was — update it above');
  });

  it('without an answer to give, there is no form', () => {
    const html = renderToStaticMarkup(
      <ReviewHub
        rows={[]}
        shareDoc={null}
        dob={null}
        declaration={{ answer: true, status: 'pending', declaredAt: '2026-10-20T09:00:00Z' }}
        declarationUpdate={{ ...asked, status: 'pending', canUpdate: false }}
        today="2026-10-22"
      />,
    );
    expect(html).not.toContain('Send updated declaration');
    expect(html).toContain('Answered “Yes” · with the office for review');
  });
});
