import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('../../staff/[id]/actions', () => ({ rejectSelfie: vi.fn() }));

const { RejectSelfie } = await import('../RejectSelfie');

/** ADR-0096: the "Profile selfie" row's one action. */
describe('RejectSelfie', () => {
  it('is a Reject button, and nothing else until it is pressed', () => {
    const html = renderToStaticMarkup(<RejectSelfie staffId="s1" name="Amara Okafor" />);
    expect(html).toContain('Reject');
    expect(html).not.toContain('Reject profile selfie');
  });

  it('can be disabled when the row is a past phase', () => {
    const html = renderToStaticMarkup(<RejectSelfie staffId="s1" name="Amara Okafor" disabled />);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
